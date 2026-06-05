import { db } from '../db.js';

const client = () => db.client;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_KEY     = import.meta.env.VITE_GROQ_API_KEY;

async function recolectarContexto() {
  const hoy = new Date().toISOString().split('T')[0];
  const inicioSemana = new Date();
  inicioSemana.setDate(inicioSemana.getDate() - 7);
  const semanaStr = inicioSemana.toISOString().split('T')[0];

  // Paso 1: logística plana (sin joins — FK anidados no declarados en Supabase)
  const { data: logRaw } = await client()
    .from('Logistica')
    .select('id, fase, venta_id, usa_bodega_nom, usa_bodega_fecha, col_bodega_fecha, int_fecha_estimada, cli_fecha_recibido, cli_fecha_envio, fecha_envio, fecha_actualizacion')
    .order('id', { ascending: true });
  const seguimientosData = logRaw || [];

  // Paso 2: ventas de esos seguimientos (plana, sin join)
  const ventaIds = seguimientosData.map(l => l.venta_id).filter(Boolean);
  let ventasPlana = {};
  if (ventaIds.length > 0) {
    const { data: vd } = await client()
      .from('Ventas')
      .select('id, cliente_id, valor_total_cop, saldo_pendiente')
      .in('id', ventaIds);
    if (vd) vd.forEach(v => { ventasPlana[v.id] = v; });
  }

  // Paso 3: clientes de esas ventas (plana, sin join)
  const clienteIds = Object.values(ventasPlana).map(v => v.cliente_id).filter(Boolean);
  let clientesPlana = {};
  if (clienteIds.length > 0) {
    const { data: cd } = await client()
      .from('Clientes')
      .select('id, nombre, telefono, whatsapp')
      .in('id', clienteIds);
    if (cd) cd.forEach(c => { clientesPlana[c.id] = c; });
  }

  // Paso 4: combinar seguimientos con venta y cliente
  const seguimientosEnriquecidos = seguimientosData.map(l => {
    const venta   = ventasPlana[l.venta_id] || null;
    const cliente = venta ? (clientesPlana[venta.cliente_id] || null) : null;
    return { ...l, venta, cliente };
  });

  // Paso 5: resto de queries en paralelo (ventas sin join de clientes)
  const [ventas, ventasSemana, clientes, productos, abonos, viaje, trm, ventasRecientes, ventasHistoricas] = await Promise.all([
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, abonos_acumulados, estado_orden, trm_cotizada, ganancia_calculada, fecha, producto_id'),
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, abonos_acumulados, estado_orden, ganancia_calculada, fecha').gte('fecha', semanaStr),
    client().from('Clientes').select('id, nombre, telefono, whatsapp, ciudad, fecha_registro'),
    client().from('Productos').select('id, nombre_producto, categoria, marca, precio_cop, precio_usd, stock_medellin, stock_miami, stock_transito, estado_producto, ganancia_calculada'),
    client().from('Abonos').select('id, venta_id, valor, metodo_pago, fecha').gte('fecha', semanaStr),
    client().from('viajes').select('*').eq('estado', 'activo').maybeSingle(),
    client().from('trm_historico').select('valor, fuente').eq('fecha', hoy).maybeSingle(),
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, estado_orden, fecha, cliente_id, producto_id').gte('fecha', semanaStr).order('fecha', { ascending: false }).limit(10),
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, estado_orden, fecha, cliente_id, producto_id').order('fecha', { ascending: false }).limit(5),
  ]);

  const ventasAll       = ventas.data      || [];
  const ventasSemanaDat = ventasSemana.data || [];
  const clientesData    = clientes.data    || [];
  const productosData   = productos.data   || [];
  const abonosData      = abonos.data      || [];

  // Mapas planos para lookup (todos los clientes y productos ya cargados)
  const clientesMap  = {};
  clientesData.forEach(c => { clientesMap[c.id] = c; });
  const productosMap = {};
  productosData.forEach(p => { productosMap[p.id] = p; });

  // Análisis de ventas por marca y categoría (histórico completo desde ventasAll)
  const ventasPorMarca     = {};
  const ventasPorCategVtas = {};
  ventasAll.forEach(v => {
    const prod = productosMap[v.producto_id];
    if (prod?.marca)     { ventasPorMarca[prod.marca]         = (ventasPorMarca[prod.marca]         || 0) + 1; }
    if (prod?.categoria) { ventasPorCategVtas[prod.categoria] = (ventasPorCategVtas[prod.categoria] || 0) + 1; }
  });
  const topMarcas = Object.entries(ventasPorMarca)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([m, n]) => `${m}: ${n} ventas`).join(', ') || 'sin datos';
  const topCategoriasVtas = Object.entries(ventasPorCategVtas)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([c, n]) => `${c}: ${n} ventas`).join(', ') || 'sin datos';

  // Últimas ventas con cliente + producto — usa ventasHistoricas (últimas 5 sin filtro de fecha)
  const ultimasVentas = (ventasHistoricas.data || []).map(v => {
    const cli  = clientesMap[v.cliente_id];
    const prod = productosMap[v.producto_id];
    return {
      id:        v.id,
      cliente:   cli?.nombre           || 'Sin nombre',
      producto:  prod?.nombre_producto || 'No especificado',
      categoria: prod?.categoria       || '',
      valor:     v.valor_total_cop,
      fecha:     v.fecha,
      estado:    v.estado_orden,
      saldo:     v.saldo_pendiente,
    };
  });

  const listaUltimasVentas = ultimasVentas.slice(0, 5).map(v => {
    const valor    = `$${Number(v.valor).toLocaleString('es-CO')} COP`;
    const saldo    = parseFloat(v.saldo || 0) > 0
      ? `(debe $${Number(v.saldo).toLocaleString('es-CO')})`
      : '(pagado)';
    const producto = v.categoria ? `${v.producto} (${v.categoria})` : v.producto;
    return `${v.fecha} · ${v.cliente} · ${producto} · ${valor} · ${saldo}`;
  }).join('\n  - ');

  // Helper: lista legible de pedidos (máx 10) — fecha extraída del ID (timestamp prefix)
  const buildLista = (items) => {
    if (!items.length) return 'ninguno';
    return items.slice(0, 10).map(s => {
      const nombre    = s.cliente?.nombre || 'Sin nombre';
      const valor     = s.venta?.valor_total_cop
        ? `$${Number(s.venta.valor_total_cop).toLocaleString('es-CO')} COP` : '';
      const wa        = s.cliente?.whatsapp || s.cliente?.telefono || '';
      const tsStr     = s.id?.replace('LOG', '');
      const fechaRegistro = tsStr && !isNaN(tsStr)
        ? new Date(parseInt(tsStr)).toLocaleDateString('es-CO')
        : (s.fecha_envio || '');
      const faseCorta = s.fase?.split('(')[0]?.trim() || '';
      return [fechaRegistro, nombre, valor, wa ? `WA: ${wa}` : '', faseCorta].filter(Boolean).join(' · ');
    }).join('\n  - ');
  };

  // Ventas métricas (desde ventasAll — query completa sin join)
  const totalVentasSemana = ventasSemanaDat.reduce((s, v) => s + parseFloat(v.valor_total_cop || 0), 0);
  const totalCartera      = ventasAll.reduce((s, v) => s + parseFloat(v.saldo_pendiente || 0), 0);
  const ventasConSaldo    = ventasAll.filter(v => parseFloat(v.saldo_pendiente || 0) > 0);
  const gananciasSemana   = ventasSemanaDat.reduce((s, v) => s + parseFloat(v.ganancia_calculada || 0), 0);

  // Cartera detallada: ventasPlana + clientesPlana (ya cargados, sin joins)
  const ventasConSaldoLog = Object.values(ventasPlana).filter(v => parseFloat(v.saldo_pendiente || 0) > 0);
  const listaCartera = ventasConSaldoLog.slice(0, 10).map(v => {
    const clt    = clientesPlana[v.cliente_id];
    const nombre = clt?.nombre || 'Sin nombre';
    const saldo  = `$${Number(v.saldo_pendiente).toLocaleString('es-CO')} COP`;
    const wa     = clt?.whatsapp || clt?.telefono || '';
    return [nombre, saldo, wa ? `WA: ${wa}` : ''].filter(Boolean).join(' · ');
  }).join('\n  - ');

  // Abonos semana
  const totalAbonosSemana = abonosData.reduce((s, a) => s + parseFloat(a.valor || 0), 0);

  // Clientes métricas
  const clientesNuevosSemana = clientesData.filter(c => c.fecha_registro >= semanaStr).length;
  const ciudades = {};
  clientesData.forEach(c => {
    const ciudad = c.ciudad || 'Sin ciudad';
    ciudades[ciudad] = (ciudades[ciudad] || 0) + 1;
  });
  const topCiudad = Object.entries(ciudades).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  // Productos métricas
  const productosSinStock = productosData.filter(p =>
    parseFloat(p.stock_medellin || 0) + parseFloat(p.stock_miami || 0) === 0);
  const valorInventario = productosData.reduce((s, p) =>
    s + (parseFloat(p.precio_cop || 0) * parseFloat(p.stock_medellin || 0)), 0);
  const margenPromedio = productosData.length
    ? (productosData.reduce((s, p) => s + parseFloat(p.ganancia_calculada || 0), 0) / productosData.length).toFixed(1)
    : 0;
  const categorias = {};
  productosData.forEach(p => {
    const cat = p.categoria || 'Sin categoría';
    categorias[cat] = (categorias[cat] || 0) + 1;
  });
  const topCategorias = Object.entries(categorias)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([cat, n]) => `${cat} (${n})`).join(', ');

  // Logística — filtrado por campo `fase` (fases confirmadas en producción)
  const fase1      = seguimientosEnriquecidos.filter(s => s.fase?.includes('1.'));
  const fase2      = seguimientosEnriquecidos.filter(s => s.fase?.includes('2.'));
  const fase3      = seguimientosEnriquecidos.filter(s => s.fase?.includes('3.'));
  const entregados = seguimientosEnriquecidos.filter(s => s.cli_fecha_recibido !== null && s.cli_fecha_recibido !== undefined);
  const activos    = seguimientosEnriquecidos.filter(s => !s.cli_fecha_recibido);

  // Viaje activo
  const viajeData = viaje.data || null;
  let viajeInfo = null;
  if (viajeData) {
    const gastoNegocio = [
      'gasto_tiquetes','gasto_hotel','gasto_flete','gasto_overweight',
      'gasto_vehiculo','gasto_gasolina','gasto_telefonia','gasto_cajas',
      'gasto_compras_outlet','gasto_otros',
    ].reduce((s, k) => s + parseFloat(viajeData[k] || 0), 0);
    const gastoPersonal = [
      'gasto_alimentacion','gasto_parques','gasto_compras_personales','gasto_personales_otros',
    ].reduce((s, k) => s + parseFloat(viajeData[k] || 0), 0);
    viajeInfo = {
      nombre:             viajeData.nombre,
      destino:            viajeData.destino,
      fecha_inicio:       viajeData.fecha_inicio,
      dias: Math.floor((new Date() - new Date(viajeData.fecha_inicio)) / 86400000),
      modo_distribucion:  viajeData.modo_distribucion,
      gasto_negocio_usd:  gastoNegocio.toFixed(2),
      gasto_personal_usd: gastoPersonal.toFixed(2),
      gasto_total_usd:    (gastoNegocio + gastoPersonal).toFixed(2),
    };
  }

  console.log('JaraBot contexto cargado:', {
    ventasAll: ventasAll.length, ventasSemana: ventasSemanaDat.length,
    clientes: clientesData.length, productos: productosData.length,
    abonos: abonosData.length, seguimientos: seguimientosEnriquecidos.length,
    fase1: fase1.length, fase2: fase2.length, fase3: fase3.length,
    clientesEnriquecidos: Object.keys(clientesPlana).length,
  });

  return {
    fecha_hoy: hoy,
    trm_actual: trm.data?.valor || window.JARAPP_TRM || 3700,
    trm_fuente: trm.data?.fuente || 'manual',
    ventas: {
      total_historico:       ventasAll.length,
      semana_cantidad:       ventasSemanaDat.length,
      semana_cop:            totalVentasSemana,
      semana_ganancias:      gananciasSemana,
      cartera_total:         totalCartera,
      cartera_clientes:      ventasConSaldo.length,
      lista_cartera:         listaCartera,
      abonos_semana_cop:      totalAbonosSemana,
      abonos_semana_cantidad: abonosData.length,
      lista_ultimas_ventas:   listaUltimasVentas,
      ultima_venta_cliente:   ultimasVentas[0]?.cliente  || 'N/A',
      ultima_venta_fecha:     ultimasVentas[0]?.fecha    || 'N/A',
      ultima_venta_valor:     ultimasVentas[0]?.valor    || 0,
      top_marcas:             topMarcas,
      top_categorias_ventas:  topCategoriasVtas,
    },
    clientes: {
      total:         clientesData.length,
      nuevos_semana: clientesNuevosSemana,
      top_ciudad:    topCiudad,
    },
    productos: {
      total:                productosData.length,
      sin_stock:            productosSinStock.length,
      disponibles_bogota:   productosData.filter(p => parseFloat(p.stock_medellin || 0) > 0).length,
      en_miami:             productosData.filter(p => parseFloat(p.stock_miami    || 0) > 0).length,
      en_transito:          productosData.filter(p => parseFloat(p.stock_transito || 0) > 0).length,
      valor_inventario_cop: valorInventario,
      margen_promedio:      margenPromedio,
      top_categorias:       topCategorias,
    },
    logistica: {
      total_activos:      activos.length,
      fase1_comprado:     { cantidad: fase1.length, detalle: buildLista(fase1) },
      fase2_transito_usa: { cantidad: fase2.length, detalle: buildLista(fase2) },
      fase3_bodega_usa:   { cantidad: fase3.length, detalle: buildLista(fase3) },
      entregados:         entregados.length,
    },
    viaje_activo: viajeInfo,
  };
}

const SYSTEM_PROMPT = (ctx) => `Eres JaraBot, el asistente interno de Importaciones Jarapo.
Conoces el negocio al 100%: importamos productos desde EEUU (calzado, ropa, accesorios, vitaminas, tecnología, perfumes, bolsos, relojes, electrónicos) para vender en Colombia.
Modelo de negocio: 35% de anticipo para apartar productos. Viajes a EEUU 3 veces al año para comprar y traer mercancía.
Canales: Instagram y WhatsApp. Clientes B2C (personas) y B2B (revendedores emprendedores).

═══ DATOS REALES DEL NEGOCIO · ${ctx.fecha_hoy} ═══

💱 TRM: $${Number(ctx.trm_actual).toLocaleString('es-CO')} COP/USD (fuente: ${ctx.trm_fuente})

💰 VENTAS ESTA SEMANA:
- Ventas realizadas: ${ctx.ventas.semana_cantidad}
- Total facturado: $${Number(ctx.ventas.semana_cop).toLocaleString('es-CO')} COP
- Ganancias semana: $${Number(ctx.ventas.semana_ganancias).toLocaleString('es-CO')} COP
- Abonos recibidos: ${ctx.ventas.abonos_semana_cantidad} pagos por $${Number(ctx.ventas.abonos_semana_cop).toLocaleString('es-CO')} COP

📋 ÚLTIMAS 5 VENTAS (más reciente primero):
  - ${ctx.ventas.lista_ultimas_ventas || 'sin ventas recientes'}

📊 CARTERA DETALLADA (clientes con saldo pendiente):
  - ${ctx.ventas.lista_cartera || 'Sin cartera pendiente'}
Total cartera: $${Number(ctx.ventas.cartera_total).toLocaleString('es-CO')} COP · ${ctx.ventas.cartera_clientes} clientes · Total ventas históricas: ${ctx.ventas.total_historico}

📊 ANÁLISIS DE VENTAS HISTÓRICAS:
- Top marcas más vendidas: ${ctx.ventas.top_marcas}
- Top categorías más vendidas: ${ctx.ventas.top_categorias_ventas}

👥 CLIENTES:
- Total registrados: ${ctx.clientes.total}
- Nuevos esta semana: ${ctx.clientes.nuevos_semana}
- Ciudad principal: ${ctx.clientes.top_ciudad}

📦 INVENTARIO:
- Total productos catálogo: ${ctx.productos.total}
- Disponibles en Bogotá: ${ctx.productos.disponibles_bogota}
- En EEUU (bodega): ${ctx.productos.en_miami}
- En tránsito: ${ctx.productos.en_transito}
- Sin stock: ${ctx.productos.sin_stock}
- Valor inventario Bogotá: $${Number(ctx.productos.valor_inventario_cop).toLocaleString('es-CO')} COP
- Margen promedio catálogo: ${ctx.productos.margen_promedio}%
- Top categorías: ${ctx.productos.top_categorias}

🚚 SEGUIMIENTOS — Estado actual (${ctx.logistica.total_activos} pedidos activos):

📋 Fase 1 · Comprado esperando tracking USA (${ctx.logistica.fase1_comprado.cantidad}):
  - ${ctx.logistica.fase1_comprado.detalle}

🚛 Fase 2 · En tránsito hacia bodega USA (${ctx.logistica.fase2_transito_usa.cantidad}):
  - ${ctx.logistica.fase2_transito_usa.detalle}

🏭 Fase 3 · En bodega USA listos para enviar (${ctx.logistica.fase3_bodega_usa.cantidad}):
  - ${ctx.logistica.fase3_bodega_usa.detalle}

✅ Entregados histórico: ${ctx.logistica.entregados}

IMPORTANTE: Cuando pregunten "¿cuáles pedidos están en bodega USA?" responde listando los clientes de Fase 3.

${ctx.viaje_activo ? `✈️ VIAJE ACTIVO — ${ctx.viaje_activo.nombre}:
- Destino: ${ctx.viaje_activo.destino} · Días activo: ${ctx.viaje_activo.dias}
- Gastos negocio: $${ctx.viaje_activo.gasto_negocio_usd} USD
- Gastos personales: $${ctx.viaje_activo.gasto_personal_usd} USD
- Total viaje: $${ctx.viaje_activo.gasto_total_usd} USD` : '✈️ Sin viaje activo actualmente'}

═══════════════════════════════════════

Responde en español colombiano informal pero profesional. Sé directo, concreto y útil.
Cuando des cifras en COP úsalas con formato colombiano ($1.234.567).
Si preguntan algo que no está en los datos, dilo honestamente.
Máximo 3 párrafos por respuesta salvo que pidan un listado detallado.`;

export const JaraBotService = {
  historial: [],

  async preguntar(mensaje) {
    const contexto = await recolectarContexto();

    this.historial.push({ role: 'user', content: mensaje });
    if (this.historial.length > 20) this.historial = this.historial.slice(-20);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(contexto) },
          ...this.historial,
        ],
        temperature: 0.7,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API error: ${err}`);
    }

    const data = await response.json();
    const respuesta = data.choices[0].message.content;
    this.historial.push({ role: 'assistant', content: respuesta });
    return respuesta;
  },

  limpiarHistorial() {
    this.historial = [];
  },
};
