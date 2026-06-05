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

  const [ventas, ventasSemana, clientes, productos, abonos, logistica, viaje, trm] = await Promise.all([
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, abonos_acumulados, estado_orden, trm_cotizada, ganancia_calculada, fecha'),
    client().from('Ventas').select('id, valor_total_cop, saldo_pendiente, abonos_acumulados, estado_orden, ganancia_calculada, fecha').gte('fecha', semanaStr),
    client().from('Clientes').select('id, nombre, telefono, whatsapp, ciudad, fecha_registro'),
    client().from('Productos').select('id, nombre_producto, categoria, marca, precio_cop, precio_usd, stock_medellin, stock_miami, stock_transito, estado_producto, ganancia_calculada'),
    client().from('Abonos').select('id, venta_id, valor, metodo_pago, fecha').gte('fecha', semanaStr),
    client().from('Logistica').select('id, fase, cli_estado_entrega, cli_fecha_recibido, comprado_viaje_encargos'),
    client().from('viajes').select('*').eq('estado', 'activo').maybeSingle(),
    client().from('trm_historico').select('valor, fuente').eq('fecha', hoy).maybeSingle(),
  ]);

  const ventasAll     = ventas.data      || [];
  const ventasSemanaDat = ventasSemana.data || [];
  const clientesData  = clientes.data    || [];
  const productosData = productos.data   || [];
  const abonosData    = abonos.data      || [];
  const logisticaData = logistica.data   || [];

  // Ventas métricas
  const totalVentasSemana  = ventasSemanaDat.reduce((s, v) => s + parseFloat(v.valor_total_cop || 0), 0);
  const totalCartera       = ventasAll.reduce((s, v) => s + parseFloat(v.saldo_pendiente || 0), 0);
  const ventasConSaldo     = ventasAll.filter(v => parseFloat(v.saldo_pendiente || 0) > 0);
  const gananciasSemana    = ventasSemanaDat.reduce((s, v) => s + parseFloat(v.ganancia_calculada || 0), 0);

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

  // Logística métricas
  const pedidosActivos    = logisticaData.filter(l => !l.cli_fecha_recibido);
  const pedidosEntregados = logisticaData.filter(l =>  l.cli_fecha_recibido);

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
    abonos: abonosData.length, logistica: logisticaData.length,
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
      abonos_semana_cop:     totalAbonosSemana,
      abonos_semana_cantidad: abonosData.length,
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
      pedidos_activos:    pedidosActivos.length,
      pedidos_entregados: pedidosEntregados.length,
    },
    viaje_activo: viajeInfo,
  };
}

const SYSTEM_PROMPT = (ctx) => `Eres JaraBot, el asistente interno de Importaciones Jarapo.
Conoces el negocio al 100%: importamos productos desde EEUU (calzado, ropa, accesorios, vitaminas, tecnología, perfumes, bolsos, relojes, electrónicos) para vender en Colombia.
Modelo de negocio: 35% de anticipo para apartar productos. Viajes a EEUU (principalmente Orlando) 3 veces al año.
Canales: Instagram y WhatsApp. Clientes B2C (personas) y B2B (revendedores emprendedores).

═══ DATOS REALES DEL NEGOCIO · ${ctx.fecha_hoy} ═══

💱 TRM: $${Number(ctx.trm_actual).toLocaleString('es-CO')} COP/USD (fuente: ${ctx.trm_fuente})

💰 VENTAS ESTA SEMANA:
- Ventas realizadas: ${ctx.ventas.semana_cantidad}
- Total facturado: $${Number(ctx.ventas.semana_cop).toLocaleString('es-CO')} COP
- Ganancias semana: $${Number(ctx.ventas.semana_ganancias).toLocaleString('es-CO')} COP
- Abonos recibidos: ${ctx.ventas.abonos_semana_cantidad} pagos por $${Number(ctx.ventas.abonos_semana_cop).toLocaleString('es-CO')} COP

📊 CARTERA:
- Clientes con saldo pendiente: ${ctx.ventas.cartera_clientes}
- Total cartera por cobrar: $${Number(ctx.ventas.cartera_total).toLocaleString('es-CO')} COP
- Total ventas históricas: ${ctx.ventas.total_historico}

👥 CLIENTES:
- Total registrados: ${ctx.clientes.total}
- Nuevos esta semana: ${ctx.clientes.nuevos_semana}
- Ciudad principal: ${ctx.clientes.top_ciudad}

📦 INVENTARIO:
- Total productos catálogo: ${ctx.productos.total}
- Disponibles en Bogotá: ${ctx.productos.disponibles_bogota}
- En Miami: ${ctx.productos.en_miami}
- En tránsito: ${ctx.productos.en_transito}
- Sin stock: ${ctx.productos.sin_stock}
- Valor inventario Bogotá: $${Number(ctx.productos.valor_inventario_cop).toLocaleString('es-CO')} COP
- Margen promedio catálogo: ${ctx.productos.margen_promedio}%
- Top categorías: ${ctx.productos.top_categorias}

🚚 LOGÍSTICA:
- Pedidos activos en proceso: ${ctx.logistica.pedidos_activos}
- Pedidos entregados: ${ctx.logistica.pedidos_entregados}

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
