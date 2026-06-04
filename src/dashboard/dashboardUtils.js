// src/dashboard/dashboardUtils.js
// Pure calculation engine — no DOM, no Chart.js, no side effects

// ─────────────────────────────────────────────
// 1. FORMATO Y PARSEO
// ─────────────────────────────────────────────

/**
 * Formatea un número como pesos colombianos: $1.250.000
 * @param {number} n
 * @returns {string}
 */
export const formatCOP = (n) => {
  const num = Number(n);
  if (isNaN(num)) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
};

/**
 * Formatea un porcentaje con coma decimal: '12,5%'
 * @param {number} n
 * @param {number} dec
 * @returns {string}
 */
export const formatPct = (n, dec = 1) => {
  const num = Number(n);
  if (isNaN(num)) return '0%';
  return num.toFixed(dec).replace('.', ',') + '%';
};

/**
 * Parsea un string de fecha a objeto Date.
 * Soporta: ISO, dd/mm/yyyy, timestamps numéricos.
 * @param {string|number|Date} s
 * @returns {Date|null}
 */
export const parseDate = (s) => {
  if (!s) return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  if (typeof s === 'number') return new Date(s);
  const str = String(s).trim();

  // dd/mm/yyyy o dd-mm-yyyy
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ISO 8601 y otros formatos estándar
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt;
};

/**
 * Retorna 'YYYY-MM' desde un objeto Date.
 * @param {Date} d
 * @returns {string}
 */
export const monthKey = (d) => {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

/**
 * Retorna 'Ene 25' desde 'YYYY-MM'.
 * @param {string} key
 * @returns {string}
 */
export const monthLabel = (key) => {
  if (!key || !key.includes('-')) return '';
  const [y, m] = key.split('-');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthIndex = Number(m) - 1;
  if (monthIndex < 0 || monthIndex > 11) return key;
  return `${months[monthIndex]} ${String(y).slice(2)}`;
};

// ─────────────────────────────────────────────
// 2. AGRUPACIÓN Y FILTROS
// ─────────────────────────────────────────────

/**
 * Agrupa un array y suma valueField por mes.
 * @param {Array} arr
 * @param {string} dateField - campo de fecha en cada elemento
 * @param {string} valueField - campo numérico a sumar
 * @returns {Array<{ key: string, label: string, total: number }>}
 */
export const groupByMonth = (arr, dateField, valueField) => {
  if (!Array.isArray(arr)) return [];
  const map = {};
  for (const item of arr) {
    const d = parseDate(item[dateField]);
    if (!d) continue;
    const key = monthKey(d);
    if (!map[key]) map[key] = 0;
    map[key] += Number(item[valueField]) || 0;
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => ({ key, label: monthLabel(key), total }));
};

/**
 * Filtra un array por rango de fechas inclusive.
 * @param {Array} arr
 * @param {string|Function} dateField - campo o función extractora
 * @param {Date|string|null} desde
 * @param {Date|string|null} hasta
 * @returns {Array}
 */
export const applyDateFilter = (arr, dateField, desde, hasta) => {
  if (!Array.isArray(arr)) return [];
  const desdeDate = desde ? parseDate(desde) : null;
  const hastaDate = hasta ? parseDate(hasta) : null;

  // Normalizar hasta al final del día
  if (hastaDate) hastaDate.setHours(23, 59, 59, 999);

  return arr.filter((item) => {
    const raw = typeof dateField === 'function' ? dateField(item) : item[dateField];
    const d = parseDate(raw);
    if (!d) return false;
    if (desdeDate && d < desdeDate) return false;
    if (hastaDate && d > hastaDate) return false;
    return true;
  });
};

/**
 * Comprueba si un item cae en un año/mes específico.
 * @param {object} item
 * @param {string} field
 * @param {number} year
 * @param {number} month - 1-indexed
 * @returns {boolean}
 */
export const inMonthRange = (item, field, year, month) => {
  const d = parseDate(item[field]);
  if (!d) return false;
  return d.getFullYear() === year && d.getMonth() + 1 === month;
};

// ─────────────────────────────────────────────
// 3. KPIs PRINCIPALES
// ─────────────────────────────────────────────

/**
 * Calcula KPIs del dashboard para el período dado.
 * @param {object} data - { ventas, abonos, gastos, compras, envios }
 * @param {Date|string} desde
 * @param {Date|string} hasta
 * @returns {object}
 */
export const calcularKPIs = (data, desde, hasta) => {
  const { ventas = [], abonos = [], gastos = [], compras = [], envios = [] } = data;

  const desdeDate = desde ? parseDate(desde) : null;
  const hastaDate = hasta ? parseDate(hasta) : null;

  // Duración del período
  const duracionMs = desdeDate && hastaDate ? hastaDate - desdeDate : 0;

  // Período anterior
  let desdeAnt = null;
  let hastaAnt = null;
  if (desdeDate && hastaDate) {
    hastaAnt = new Date(desdeDate.getTime() - 1);
    desdeAnt = new Date(hastaAnt.getTime() - duracionMs);
  }

  const filtrarPeriodo = (arr, field) => applyDateFilter(arr, field, desdeDate, hastaDate);
  const filtrarAnterior = (arr, field) => applyDateFilter(arr, field, desdeAnt, hastaAnt);

  const sumar = (arr, field) => arr.reduce((acc, x) => acc + (Number(x[field]) || 0), 0);

  // Período actual
  const ventasFiltradas  = filtrarPeriodo(ventas, 'fecha');
  const abonosFiltrados  = filtrarPeriodo(abonos, 'fecha');
  const gastosFiltrados  = filtrarPeriodo(gastos, 'fecha');
  const comprasFiltradas = filtrarPeriodo(compras, 'fecha_orden');

  const facturado   = sumar(ventasFiltradas,  'total');
  const cobrado     = sumar(abonosFiltrados,  'monto');
  const gastosMonto = sumar(gastosFiltrados,  'monto');
  const comprasUSA  = sumar(comprasFiltradas, 'total_usd_cop');
  const egresos     = gastosMonto + comprasUSA;
  const balance     = cobrado - egresos;
  const margenPct   = cobrado > 0 ? (balance / cobrado) * 100 : 0;

  // Cartera: ventas no cobradas completamente
  const cartera = ventas.reduce((acc, v) => {
    const totalVenta  = Number(v.total) || 0;
    const cobradoVenta = abonos
      .filter((a) => a.venta_id === v.id)
      .reduce((s, a) => s + (Number(a.monto) || 0), 0);
    const saldo = totalVenta - cobradoVenta;
    return acc + (saldo > 0 ? saldo : 0);
  }, 0);

  // Período anterior
  const ventasAnt  = filtrarAnterior(ventas,  'fecha');
  const abonosAnt  = filtrarAnterior(abonos,  'fecha');
  const gastosAnt  = filtrarAnterior(gastos,  'fecha');
  const comprasAnt = filtrarAnterior(compras, 'fecha_orden');

  const facturadoAnt = sumar(ventasAnt,  'total');
  const cobradoAnt   = sumar(abonosAnt,  'monto');
  const egresosAnt   = sumar(gastosAnt,  'monto') + sumar(comprasAnt, 'total_usd_cop');

  const varPct = (actual, anterior) => {
    if (anterior === 0) return actual > 0 ? 100 : 0;
    return ((actual - anterior) / Math.abs(anterior)) * 100;
  };

  const varFacturado = varPct(facturado, facturadoAnt);
  const varCobrado   = varPct(cobrado,   cobradoAnt);
  const varEgresos   = varPct(egresos,   egresosAnt);

  // Conteos
  const numVentas       = ventasFiltradas.length;
  const numAbonos       = abonosFiltrados.length;
  const numEnviosActivos = envios.filter((e) =>
    ['en_transito', 'en_bodega', 'pendiente'].includes(e.estado)
  ).length;

  // Por mes — últimos 12 meses
  const now = new Date();
  const porMes = [];
  for (let i = 11; i >= 0; i--) {
    const ref   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key   = monthKey(ref);
    const mes   = monthLabel(key);
    const yy    = ref.getFullYear();
    const mm    = ref.getMonth() + 1;

    const vM  = ventas.filter((x)  => inMonthRange(x, 'fecha', yy, mm));
    const aM  = abonos.filter((x)  => inMonthRange(x, 'fecha', yy, mm));
    const gM  = gastos.filter((x)  => inMonthRange(x, 'fecha', yy, mm));
    const cM  = compras.filter((x) => inMonthRange(x, 'fecha_orden', yy, mm));

    const fM  = sumar(vM, 'total');
    const cbM = sumar(aM, 'monto');
    const gMt = sumar(gM, 'monto');
    const cpM = sumar(cM, 'total_usd_cop');
    const egM = gMt + cpM;
    const blM = cbM - egM;
    const mpM = cbM > 0 ? (blM / cbM) * 100 : 0;

    porMes.push({
      mes, key,
      facturado: fM, cobrado: cbM,
      gastos: gMt, compras: cpM,
      egresos: egM, balance: blM,
      margenPct: mpM,
    });
  }

  return {
    facturado, cobrado, cartera,
    gastos: gastosMonto, comprasUSA, egresos,
    balance, margenPct,
    varFacturado, varCobrado, varEgresos,
    numVentas, numAbonos, numEnviosActivos,
    porMes,
  };
};

// ─────────────────────────────────────────────
// 4. CARTERA Y AGING
// ─────────────────────────────────────────────

/**
 * Calcula cartera con aging por tramos.
 * @param {Array} ventas
 * @param {Array} clientes
 * @param {object} metas - { plazo_vencimiento_factura }
 * @returns {object}
 */
export const calcularCarteraAging = (ventas, clientes, metas = {}) => {
  const plazoDefault = Number(metas?.plazo_vencimiento_factura) || 30;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const clienteMap = {};
  (clientes || []).forEach((c) => { clienteMap[c.id] = c; });

  const tramos = { '0-30': [], '31-60': [], '61-90': [], '+90': [] };
  let total = 0;
  let totalVencida = 0;
  let totalCorriente = 0;

  const porClienteMap = {};

  for (const venta of ventas || []) {
    const totalVenta   = Number(venta.total) || 0;
    const cobradoVenta = 0; // calculado externamente si se necesita, aquí usamos saldo_pendiente
    const saldo = venta.saldo_pendiente != null
      ? Number(venta.saldo_pendiente)
      : totalVenta - cobradoVenta;

    if (saldo <= 0) continue;

    // Determinar fecha vencimiento
    let fechaVenc;
    if (venta.fecha_vencimiento) {
      fechaVenc = parseDate(venta.fecha_vencimiento);
    } else {
      const fechaEmision = parseDate(venta.fecha);
      if (!fechaEmision) continue;
      const plazo = Number(venta.plazo_vencimiento_factura) || plazoDefault;
      fechaVenc = new Date(fechaEmision.getTime() + plazo * 86400000);
    }

    if (!fechaVenc) continue;

    const diasVencida = Math.floor((hoy - fechaVenc) / 86400000);
    const cliente = clienteMap[venta.cliente_id] || {};
    const clienteNombre = cliente.nombre || venta.cliente_nombre || `Cliente ${venta.cliente_id}`;
    const clienteId = venta.cliente_id;

    const entry = {
      clienteId,
      clienteNombre,
      saldo,
      dias: diasVencida,
      ventaId: venta.id,
      fecha: venta.fecha,
    };

    total += saldo;

    let tramoKey;
    if (diasVencida <= 0) {
      tramoKey = '0-30'; // corriente o recién vencida
      totalCorriente += saldo;
    } else if (diasVencida <= 30) {
      tramoKey = '0-30';
      totalVencida += saldo;
    } else if (diasVencida <= 60) {
      tramoKey = '31-60';
      totalVencida += saldo;
    } else if (diasVencida <= 90) {
      tramoKey = '61-90';
      totalVencida += saldo;
    } else {
      tramoKey = '+90';
      totalVencida += saldo;
    }

    tramos[tramoKey].push(entry);

    if (!porClienteMap[clienteId]) {
      porClienteMap[clienteId] = {
        nombre: clienteNombre,
        clienteId,
        t0_30: 0, t31_60: 0, t61_90: 0, t90plus: 0,
        total: 0,
      };
    }
    porClienteMap[clienteId].total += saldo;
    if (tramoKey === '0-30')  porClienteMap[clienteId].t0_30   += saldo;
    if (tramoKey === '31-60') porClienteMap[clienteId].t31_60  += saldo;
    if (tramoKey === '61-90') porClienteMap[clienteId].t61_90  += saldo;
    if (tramoKey === '+90')   porClienteMap[clienteId].t90plus += saldo;
  }

  const porCliente = Object.values(porClienteMap).map((c) => {
    let riesgo = 'BAJO';
    if (c.t90plus > 0 || c.t61_90 > c.t0_30) riesgo = 'ALTO';
    else if (c.t31_60 > 0) riesgo = 'MEDIO';
    return { ...c, riesgo };
  }).sort((a, b) => b.total - a.total);

  return { total, totalVencida, totalCorriente, tramos, porCliente };
};

// ─────────────────────────────────────────────
// 5. FLUJO DE CAJA PROYECTADO
// ─────────────────────────────────────────────

/**
 * Proyecta flujo de caja a 30/60/90 días.
 * @param {object} data - { ventas, abonos, gastos, compras, envios }
 * @param {object} metas
 * @returns {object}
 */
export const calcularFlujoCajaProyectado = (data, metas = {}) => {
  const { ventas = [], abonos = [], gastos = [], compras = [], envios = [] } = data;
  const umbralMinimo = Number(metas?.umbral_caja_minimo) || 5_000_000;

  // Saldo actual: abonos totales - egresos históricos
  const totalAbonos = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const totalGastos = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalCompras = compras.reduce((s, c) => s + (Number(c.total_usd_cop) || 0), 0);
  const saldoActual = totalAbonos - totalGastos - totalCompras;

  // Gastos promedio últimos 3 meses
  const now = new Date();
  const hace3meses = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const gastosRecientes = gastos.filter((g) => {
    const d = parseDate(g.fecha);
    return d && d >= hace3meses;
  });
  const comprasRecientes = compras.filter((c) => {
    const d = parseDate(c.fecha_orden);
    return d && d >= hace3meses;
  });
  const totalEgresosRecientes =
    gastosRecientes.reduce((s, g) => s + (Number(g.monto) || 0), 0) +
    comprasRecientes.reduce((s, c) => s + (Number(c.total_usd_cop) || 0), 0);
  const gastosPromedioMes = totalEgresosRecientes / 3;

  // Cobros esperados por tramo (probabilidad)
  const aging = calcularCarteraAging(ventas, [], metas);
  const prob = { '0-30': 0.85, '31-60': 0.65, '61-90': 0.40, '+90': 0.15 };
  let cobrosEsperados30 = 0;
  for (const [tramo, entries] of Object.entries(aging.tramos)) {
    const montoTramo = entries.reduce((s, e) => s + e.saldo, 0);
    cobrosEsperados30 += montoTramo * (prob[tramo] || 0);
  }

  // Egresos comprometidos: compras activas sin entregar
  const egresosComprometidos = envios
    .filter((e) => ['en_transito', 'pendiente'].includes(e.estado))
    .reduce((s, e) => s + (Number(e.costo_total_cop) || 0), 0);

  const proyeccion30 = saldoActual + cobrosEsperados30 - gastosPromedioMes - egresosComprometidos;
  const proyeccion60 = proyeccion30 + cobrosEsperados30 * 0.5 - gastosPromedioMes;
  const proyeccion90 = proyeccion60 + cobrosEsperados30 * 0.3 - gastosPromedioMes;

  let semaforoLiquidez = 'verde';
  if (proyeccion30 < umbralMinimo) semaforoLiquidez = 'rojo';
  else if (proyeccion30 < umbralMinimo * 1.5) semaforoLiquidez = 'amarillo';

  return {
    saldoActual,
    gastosPromedioMes,
    cobrosEsperados30,
    egresosComprometidos,
    proyeccion30,
    proyeccion60,
    proyeccion90,
    semaforoLiquidez,
    umbralMinimo,
  };
};

// ─────────────────────────────────────────────
// 6. MÁRGENES POR PRODUCTO
// ─────────────────────────────────────────────

/**
 * Calcula márgenes brutos por producto.
 * @param {Array} ventas
 * @param {Array} productos
 * @param {object} parametros - { margen_meta_pct }
 * @returns {Array}
 */
export const calcularMargenesPorProducto = (ventas, productos, parametros = {}) => {
  const prodMap = {};
  (productos || []).forEach((p) => { prodMap[p.id] = p; });

  const statsMap = {};
  for (const venta of ventas || []) {
    const items = venta.items || venta.detalle || [];
    for (const item of items) {
      const pid = item.producto_id;
      if (!statsMap[pid]) statsMap[pid] = { unidades: 0, revenue: 0 };
      statsMap[pid].unidades += Number(item.cantidad) || 0;
      statsMap[pid].revenue  += Number(item.subtotal || item.total || 0);
    }
  }

  return Object.entries(statsMap).map(([pid, st]) => {
    const prod = prodMap[pid] || {};
    const precioCOP      = Number(prod.precio_cop || prod.precio || 0);
    const costoEstimado  = Number(prod.costo_estimado) || precioCOP * 0.65;
    const precioVenta    = st.unidades > 0 ? st.revenue / st.unidades : precioCOP;
    const margenBruto    = precioVenta - costoEstimado;
    const margenPct      = precioVenta > 0 ? (margenBruto / precioVenta) * 100 : 0;

    let clasificacion = 'estandar';
    if (margenPct > 25)  clasificacion = 'estrella';
    if (margenPct < 15)  clasificacion = 'critico';

    return {
      productoId: pid,
      nombre:     prod.nombre     || `Producto ${pid}`,
      sku:        prod.sku        || '',
      categoria:  prod.categoria  || '',
      marca:      prod.marca      || '',
      precioVenta,
      costoEstimado,
      margenBruto,
      margenPct,
      unidades:   st.unidades,
      revenue:    st.revenue,
      clasificacion,
    };
  }).sort((a, b) => b.revenue - a.revenue);
};

// ─────────────────────────────────────────────
// 7. SCORE DE SALUD
// ─────────────────────────────────────────────

/**
 * Calcula score de salud del negocio (0-100 por dimensión).
 * @param {object} data
 * @param {object} kpis - resultado de calcularKPIs
 * @param {object} metas
 * @returns {object}
 */
export const calcularScoreSalud = (data, kpis, metas = {}) => {
  const { ventas = [], abonos = [], gastos = [], compras = [], envios = [], productos = [] } = data;
  const metaMargen    = Number(metas?.meta_margen_pct) || 20;
  const umbralStock   = Number(metas?.umbral_stock_minimo) || 5;
  const diasSinCompra = Number(metas?.dias_alerta_sin_compra) || 60;

  // — LIQUIDEZ —
  const flujoLocal = calcularFlujoCajaProyectado(data, metas);
  const aging  = calcularCarteraAging(ventas, [], metas);
  const gastosMes = flujoLocal.gastosPromedioMes;
  const proy30    = flujoLocal.proyeccion30;

  let liquidez = 100;
  if (proy30 < gastosMes)        liquidez -= 40;
  if (proy30 < gastosMes * 0.5)  liquidez -= 20;
  const cartera90plus = (aging.tramos['+90'] || []).reduce((s, e) => s + (e.saldo||0), 0);
  // kpis.porMes puede ser undefined si se llama con un objeto inline
  const porMes = Array.isArray(kpis?.porMes) ? kpis.porMes : [];
  const cobradoMes = porMes[porMes.length - 1]?.cobrado || kpis?.totalCob || 1;
  if (cartera90plus > cobradoMes * 0.3) liquidez -= 20;
  liquidez = Math.max(0, Math.min(100, liquidez));

  // — CARTERA —
  const totalCartera = aging.total || 1;
  const pctCorriente = aging.totalCorriente / totalCartera;
  const pctRiesgo    = (aging.tramos['+90'].reduce((s, e) => s + e.saldo, 0) +
                        aging.tramos['61-90'].reduce((s, e) => s + e.saldo, 0)) / totalCartera;
  let carteraScore = pctCorriente * 100 - pctRiesgo * 50;
  carteraScore = Math.max(0, Math.min(100, carteraScore));

  // — LOGISTICA —
  const totalEnvios    = envios.length || 1;
  const entregados     = envios.filter((e) => e.estado === 'entregado').length;
  const retrasados     = envios.filter((e) => e.estado === 'retrasado' || e.dias_retraso > 0).length;
  const onTime         = entregados / totalEnvios;
  let logistica        = onTime * 100 - retrasados * 30;
  logistica = Math.max(0, Math.min(100, logistica));

  // — RENTABILIDAD —
  const margenActual   = kpis?.margenPct || 0;
  const rentabilidad   = Math.min(100, metaMargen > 0 ? (margenActual / metaMargen) * 100 : 0);

  // — CONTROL —
  const skusBajoStock = (productos || []).filter(
    (p) => Number(p.stock_actual || p.stock || 0) < umbralStock
  ).length;
  const cotizPendientes = (ventas || []).filter(
    (v) => v.estado === 'cotizacion' || v.estado === 'pendiente'
  ).length;
  const enviosRetrasados = retrasados;
  const hoy = new Date();
  const clienteMap = {};
  (ventas || []).forEach((v) => {
    const d = parseDate(v.fecha);
    if (!d || !v.cliente_id) return;
    if (!clienteMap[v.cliente_id] || d > clienteMap[v.cliente_id]) {
      clienteMap[v.cliente_id] = d;
    }
  });
  const clientesMora = Object.values(clienteMap).filter(
    (ultima) => (hoy - ultima) / 86400000 > diasSinCompra
  ).length;

  let control = 100;
  control -= Math.min(25, skusBajoStock    * 5);
  control -= Math.min(25, cotizPendientes  * 3);
  control -= Math.min(25, enviosRetrasados * 4);
  control -= Math.min(25, clientesMora     * 3);
  control = Math.max(0, Math.min(100, control));

  // — GLOBAL (ponderado) —
  const global = Math.round(
    liquidez      * 0.25 +
    carteraScore  * 0.25 +
    logistica     * 0.15 +
    rentabilidad  * 0.20 +
    control       * 0.15
  );

  return {
    liquidez:      Math.round(liquidez),
    cartera:       Math.round(carteraScore),
    logistica:     Math.round(logistica),
    rentabilidad:  Math.round(rentabilidad),
    control:       Math.round(control),
    global,
  };
};

// ─────────────────────────────────────────────
// 8. ALERTAS
// ─────────────────────────────────────────────

/**
 * Genera alertas ordenadas por criticidad.
 * @param {object} data
 * @param {object} kpis
 * @param {object} flujo
 * @param {object} metas
 * @returns {Array}
 */
export const generarAlertas = (data, kpis, flujo, metas = {}) => {
  const { ventas = [], envios = [], clientes = [], cotizaciones = [] } = data;
  const alertas = [];
  const now = new Date();
  const ts  = now.toISOString();

  const aging = calcularCarteraAging(ventas, clientes, metas);
  const diasCotizSinRespuesta = Number(metas?.dias_alerta_cotizacion) || 5;
  const diasClienteSinCompra  = Number(metas?.dias_alerta_sin_compra)  || 30;
  const diasEnvioRetraso      = Number(metas?.dias_alerta_envio)       || 7;
  const umbralGastosVar       = Number(metas?.umbral_variacion_gastos)  || 10;

  // ── CRÍTICAS ──────────────────────────────

  // Cartera +90 días
  const cartera90 = aging.tramos['+90'];
  if (cartera90.length > 0) {
    const monto90 = cartera90.reduce((s, e) => s + e.saldo, 0);
    alertas.push({
      nivel: 'critica',
      icon: '🚨',
      titulo: `Cartera vencida +90 días: ${cartera90.length} factura(s)`,
      desc: `Saldo total: ${formatCOP(monto90)}. Riesgo de incobrabilidad alto.`,
      accion: 'ver_cartera',
      accionLabel: 'Ver cartera',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Caja proyectada baja
  const flujoLocal = flujo || calcularFlujoCajaProyectado(data, metas);
  if (flujoLocal && flujoLocal.semaforoLiquidez === 'rojo') {
    alertas.push({
      nivel: 'critica',
      icon: '🔴',
      titulo: 'Liquidez crítica en los próximos 30 días',
      desc: `Proyección: ${formatCOP(flujoLocal.proyeccion30)}. Umbral mínimo: ${formatCOP(flujoLocal.umbralMinimo)}.`,
      accion: 'ver_flujo',
      accionLabel: 'Ver flujo de caja',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Envíos retrasados más de N días
  const enviosRetrasados = envios.filter((e) => {
    if (e.estado === 'entregado') return false;
    if (e.dias_retraso) return Number(e.dias_retraso) > diasEnvioRetraso;
    if (e.eta) {
      const eta = parseDate(e.eta);
      if (eta) return (now - eta) / 86400000 > diasEnvioRetraso;
    }
    return false;
  });
  if (enviosRetrasados.length > 0) {
    alertas.push({
      nivel: 'critica',
      icon: '📦',
      titulo: `${enviosRetrasados.length} envío(s) con retraso crítico`,
      desc: `Llevan más de ${diasEnvioRetraso} días de demora.`,
      accion: 'ver_envios',
      accionLabel: 'Ver envíos',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Encargos de clientes sin compra generada
  const encargosSinCompra = ventas.filter((v) => v.es_encargo && v.estado === 'pendiente_compra');
  if (encargosSinCompra.length > 0) {
    alertas.push({
      nivel: 'critica',
      icon: '⚠️',
      titulo: `${encargosSinCompra.length} encargo(s) sin orden de compra`,
      desc: 'Clientes esperando productos que aún no han sido comprados.',
      accion: 'ver_ventas',
      accionLabel: 'Ver encargos',
      accionFn: null,
      timestamp: ts,
    });
  }

  // ── ADVERTENCIAS ─────────────────────────

  // Cartera 61-90 días
  const cartera61_90 = aging.tramos['61-90'];
  if (cartera61_90.length > 0) {
    const monto6190 = cartera61_90.reduce((s, e) => s + e.saldo, 0);
    alertas.push({
      nivel: 'advertencia',
      icon: '🟡',
      titulo: `Cartera 61-90 días: ${cartera61_90.length} factura(s)`,
      desc: `Saldo: ${formatCOP(monto6190)}. Gestionar cobro antes de que pase a +90d.`,
      accion: 'ver_cartera',
      accionLabel: 'Ver cartera',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Gastos +10% vs mes anterior
  const _pm = Array.isArray(kpis?.porMes) ? kpis.porMes : [];
  const mesActual   = _pm[_pm.length - 1];
  const mesAnterior = _pm[_pm.length - 2];
  if (mesActual && mesAnterior && mesAnterior.egresos > 0) {
    const varGastos = ((mesActual.egresos - mesAnterior.egresos) / mesAnterior.egresos) * 100;
    if (varGastos > umbralGastosVar) {
      alertas.push({
        nivel: 'advertencia',
        icon: '📈',
        titulo: `Gastos aumentaron ${formatPct(varGastos)} vs mes anterior`,
        desc: `Egresos actuales: ${formatCOP(mesActual.egresos)} vs ${formatCOP(mesAnterior.egresos)}.`,
        accion: 'ver_gastos',
        accionLabel: 'Ver gastos',
        accionFn: null,
        timestamp: ts,
      });
    }
  }

  // Clientes sin compra N días
  const clientesSinCompra = clientes.filter((c) => {
    const ultimaCompra = ventas
      .filter((v) => v.cliente_id === c.id)
      .map((v) => parseDate(v.fecha))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (!ultimaCompra) return true;
    return (now - ultimaCompra) / 86400000 > diasClienteSinCompra;
  });
  if (clientesSinCompra.length > 0) {
    alertas.push({
      nivel: 'advertencia',
      icon: '👤',
      titulo: `${clientesSinCompra.length} cliente(s) sin compra en +${diasClienteSinCompra} días`,
      desc: 'Posibles clientes en riesgo de perder.',
      accion: 'ver_clientes',
      accionLabel: 'Ver clientes',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Cotizaciones sin respuesta N días
  const cotizacionesPendientes = (cotizaciones || []).filter((co) => {
    if (co.estado !== 'enviada' && co.estado !== 'pendiente') return false;
    const d = parseDate(co.fecha_envio || co.fecha);
    if (!d) return false;
    return (now - d) / 86400000 > diasCotizSinRespuesta;
  });
  if (cotizacionesPendientes.length > 0) {
    alertas.push({
      nivel: 'advertencia',
      icon: '📋',
      titulo: `${cotizacionesPendientes.length} cotización(es) sin respuesta`,
      desc: `Más de ${diasCotizSinRespuesta} días sin respuesta del cliente.`,
      accion: 'ver_cotizaciones',
      accionLabel: 'Ver cotizaciones',
      accionFn: null,
      timestamp: ts,
    });
  }

  // ── OPORTUNIDADES ─────────────────────────

  // Clientes LTV alto sin pedido 30d
  const diasOportunidad = 30;
  const clientesLTVAlto = clientes.filter((c) => {
    const ltv = Number(c.ltv || c.lifetime_value || 0);
    if (ltv < 1_000_000) return false;
    const ultimaCompra = ventas
      .filter((v) => v.cliente_id === c.id)
      .map((v) => parseDate(v.fecha))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (!ultimaCompra) return false;
    return (now - ultimaCompra) / 86400000 > diasOportunidad;
  });
  if (clientesLTVAlto.length > 0) {
    alertas.push({
      nivel: 'oportunidad',
      icon: '⭐',
      titulo: `${clientesLTVAlto.length} cliente(s) VIP sin pedido en +30 días`,
      desc: 'Oportunidad de reactivar clientes de alto valor.',
      accion: 'ver_clientes',
      accionLabel: 'Contactar clientes',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Envíos en bodega Colombia listos
  const enviosBodega = envios.filter((e) => e.estado === 'en_bodega');
  if (enviosBodega.length > 0) {
    alertas.push({
      nivel: 'oportunidad',
      icon: '🏠',
      titulo: `${enviosBodega.length} envío(s) listos en bodega Colombia`,
      desc: 'Productos disponibles para entrega inmediata.',
      accion: 'ver_envios',
      accionLabel: 'Ver envíos',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Margen superó objetivo
  const metaMargenPct = Number(metas?.meta_margen_pct) || 20;
  const _margenActual = kpis?.margenPct || 0;
  if (_margenActual > metaMargenPct) {
    alertas.push({
      nivel: 'oportunidad',
      icon: '🎯',
      titulo: `¡Margen supera el objetivo! ${formatPct(_margenActual)}`,
      desc: `Meta: ${formatPct(metaMargenPct)}. Período con rentabilidad superior.`,
      accion: 'ver_finanzas',
      accionLabel: 'Ver finanzas',
      accionFn: null,
      timestamp: ts,
    });
  }

  // Ordenar: criticas → advertencias → oportunidades
  const orden = { critica: 0, advertencia: 1, oportunidad: 2 };
  return alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
};

// ─────────────────────────────────────────────
// 9. ESTADO DE MÓDULOS
// ─────────────────────────────────────────────

/**
 * Calcula el estado resumido de cada módulo del dashboard.
 * @param {object} data
 * @param {object} kpis
 * @param {object} flujo
 * @param {object} aging
 * @param {object} metas
 * @returns {Array}
 */
export const calcularEstadoModulos = (data, kpis, flujo, aging, metas = {}) => {
  const { ventas = [], abonos = [], gastos = [], compras = [], envios = [], clientes = [], productos = [] } = data;
  const now = new Date();
  const diasSinCompraUmbral = Number(metas?.dias_alerta_sin_compra) || 60;
  const umbralStockMin = Number(metas?.umbral_stock_minimo) || 5;

  // ── CLIENTES ──
  const clientesActivos = clientes.filter((c) => c.activo !== false).length;
  const clientesConMora = aging.porCliente.filter((c) => c.t61_90 > 0 || c.t90plus > 0).length;
  const ltvTotal = clientes.reduce((s, c) => s + (Number(c.ltv || c.lifetime_value || 0)), 0);
  const ltvPromedio = clientes.length > 0 ? ltvTotal / clientes.length : 0;

  const diasSinCompraClientes = clientes.map((c) => {
    const ultima = ventas
      .filter((v) => v.cliente_id === c.id)
      .map((v) => parseDate(v.fecha))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (!ultima) return diasSinCompraUmbral + 1;
    return (now - ultima) / 86400000;
  });
  const diasPromSinCompra = diasSinCompraClientes.length > 0
    ? Math.round(diasSinCompraClientes.reduce((s, d) => s + d, 0) / diasSinCompraClientes.length)
    : 0;

  // ── VENTAS ──
  const mesRef = now.getMonth() + 1;
  const anoRef = now.getFullYear();
  const ventasMes = ventas.filter((v) => inMonthRange(v, 'fecha', anoRef, mesRef));
  const ventasMesMonto = ventasMes.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const ticketPromedio = ventasMes.length > 0 ? ventasMesMonto / ventasMes.length : 0;

  // ── INVENTARIO ──
  const skusActivos = productos.filter((p) => p.activo !== false).length;
  const skusBajoStock = productos.filter(
    (p) => Number(p.stock_actual || p.stock || 0) < umbralStockMin
  ).length;
  const valorInventario = productos.reduce(
    (s, p) => s + (Number(p.stock_actual || p.stock || 0)) * (Number(p.costo_estimado || p.precio_cop || 0) * 0.65), 0
  );
  const hace60dias = new Date(now.getTime() - 60 * 86400000);
  const productosSinMovimiento = productos.filter((p) => {
    const uid = p.id;
    const tieneVenta = ventas.some((v) => {
      const items = v.items || v.detalle || [];
      const d = parseDate(v.fecha);
      return d && d >= hace60dias && items.some((i) => i.producto_id === uid);
    });
    return !tieneVenta;
  }).length;

  // ── COMPRAS USA ──
  const comprasActivas   = compras.filter((c) => c.estado !== 'entregado').length;
  const comprasTransito  = compras.filter((c) => c.estado === 'en_transito').length;
  const costoPromCompra  = compras.length > 0
    ? compras.reduce((s, c) => s + (Number(c.total_usd) || 0), 0) / compras.length
    : 0;
  const leadTimes = compras.map((c) => Number(c.lead_time_dias) || 0).filter((x) => x > 0);
  const leadTimeProm = leadTimes.length > 0
    ? leadTimes.reduce((s, x) => s + x, 0) / leadTimes.length
    : 0;

  // ── SEGUIMIENTOS ──
  const enTransito   = envios.filter((e) => e.estado === 'en_transito').length;
  const enBodega     = envios.filter((e) => e.estado === 'en_bodega').length;
  const retrasados   = envios.filter((e) => e.estado === 'retrasado' || e.dias_retraso > 0).length;
  const etas = envios
    .filter((e) => e.estado !== 'entregado' && e.eta)
    .map((e) => {
      const eta = parseDate(e.eta);
      return eta ? Math.max(0, Math.ceil((eta - now) / 86400000)) : null;
    })
    .filter((d) => d !== null);
  const etaMinimo = etas.length > 0 ? Math.min(...etas) : null;

  // ── FINANZAS ──
  const gastosMes  = gastos.filter((g) => inMonthRange(g, 'fecha', anoRef, mesRef));
  const gastosFijos   = gastosMes.filter((g) => g.tipo === 'fijo'       || g.categoria === 'fijo').reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const gastosLogist  = gastosMes.filter((g) => g.tipo === 'logistica'  || g.categoria === 'logistica').reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const gastosOtros   = gastosMes.filter((g) => !['fijo','logistica'].includes(g.tipo || g.categoria)).reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const gastosMesAnt  = gastos.filter((g) => {
    const ref = new Date(anoRef, now.getMonth() - 1, 1);
    return inMonthRange(g, 'fecha', ref.getFullYear(), ref.getMonth() + 1);
  }).reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const gastosMesTotal = gastosFijos + gastosLogist + gastosOtros;
  const varGastos = gastosMesAnt > 0
    ? ((gastosMesTotal - gastosMesAnt) / gastosMesAnt) * 100
    : 0;

  const badgeColor = (n, umbral = 0) => n > umbral ? 'rojo' : 'verde';

  return [
    {
      id: 'clientes',
      label: 'Clientes',
      icon: '👥',
      color: 'info',
      badge: { count: clientesConMora, color: badgeColor(clientesConMora), text: 'en mora' },
      metricas: [
        { label: 'Activos',                valor: clientesActivos },
        { label: 'Con mora',               valor: clientesConMora, color: clientesConMora > 0 ? 'rojo' : undefined },
        { label: 'LTV promedio',           valor: formatCOP(ltvPromedio) },
        { label: 'Días prom sin compra',   valor: `${diasPromSinCompra}d` },
      ],
    },
    {
      id: 'ventas',
      label: 'Ventas',
      icon: '💰',
      color: 'success',
      badge: { count: kpis?.numVentas || 0, color: 'verde', text: 'este mes' },
      metricas: [
        { label: 'Ventas este mes',        valor: formatCOP(ventasMesMonto) },
        { label: 'Ticket promedio',        valor: formatCOP(ticketPromedio) },
        { label: 'Pendiente cobro',        valor: formatCOP(aging.totalVencida) },
        { label: 'Cartera total',          valor: formatCOP(aging.total) },
      ],
    },
    {
      id: 'inventario',
      label: 'Inventario',
      icon: '📦',
      color: skusBajoStock > 0 ? 'warning' : 'success',
      badge: { count: skusBajoStock, color: badgeColor(skusBajoStock), text: 'bajo stock' },
      metricas: [
        { label: 'SKUs activos',           valor: skusActivos },
        { label: 'Stock bajo',             valor: skusBajoStock, color: skusBajoStock > 0 ? 'naranja' : undefined },
        { label: 'Valor inventario',       valor: formatCOP(valorInventario) },
        { label: 'Sin movimiento 60d',     valor: productosSinMovimiento },
      ],
    },
    {
      id: 'comprasUSA',
      label: 'Compras USA',
      icon: '🇺🇸',
      color: 'primary',
      badge: { count: comprasActivas, color: 'azul', text: 'activas' },
      metricas: [
        { label: 'Órdenes activas',        valor: comprasActivas },
        { label: 'En tránsito',            valor: comprasTransito },
        { label: 'Costo promedio USD',     valor: `$${costoPromCompra.toFixed(0)}` },
        { label: 'Lead time prom',         valor: `${Math.round(leadTimeProm)}d` },
      ],
    },
    {
      id: 'seguimientos',
      label: 'Seguimientos',
      icon: '🚢',
      color: retrasados > 0 ? 'danger' : 'success',
      badge: { count: retrasados, color: badgeColor(retrasados), text: 'retrasados' },
      metricas: [
        { label: 'En tránsito',            valor: enTransito },
        { label: 'En bodega Colombia',     valor: enBodega },
        { label: 'Retrasados',             valor: retrasados, color: retrasados > 0 ? 'rojo' : undefined },
        { label: 'Próximo ETA',            valor: etaMinimo !== null ? `${etaMinimo}d` : '—' },
      ],
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      icon: '📊',
      color: varGastos > 10 ? 'warning' : 'success',
      badge: {
        count: Math.round(Math.abs(varGastos)),
        color: varGastos > 10 ? 'naranja' : 'verde',
        text: `${varGastos >= 0 ? '+' : ''}${varGastos.toFixed(0)}% gastos`,
      },
      metricas: [
        { label: 'Gastos fijos',           valor: formatCOP(gastosFijos) },
        { label: 'Gastos logística',       valor: formatCOP(gastosLogist) },
        { label: 'Otros gastos',           valor: formatCOP(gastosOtros) },
        { label: 'Variación vs mes ant',   valor: formatPct(varGastos), color: varGastos > 10 ? 'naranja' : 'verde' },
      ],
    },
  ];
};

// ─────────────────────────────────────────────
// 10. P&L MENSUAL
// ─────────────────────────────────────────────

/**
 * Calcula P&L por mes para los últimos 12 meses.
 * @param {object} data
 * @param {Date|string} desde
 * @param {Date|string} hasta
 * @returns {Array}
 */
export const calcularPL = (data, desde, hasta) => {
  const { ventas = [], abonos = [], gastos = [], compras = [] } = data;
  const now = new Date();

  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push({ year: ref.getFullYear(), month: ref.getMonth() + 1, key: monthKey(ref) });
  }

  return meses.map(({ year, month, key }) => {
    const mes     = monthLabel(key);
    const vM      = ventas.filter((v)  => inMonthRange(v,  'fecha',      year, month));
    const aM      = abonos.filter((a)  => inMonthRange(a,  'fecha',      year, month));
    const gM      = gastos.filter((g)  => inMonthRange(g,  'fecha',      year, month));
    const cM      = compras.filter((c) => inMonthRange(c,  'fecha_orden', year, month));

    const cobrado    = aM.reduce((s, a) => s + (Number(a.monto) || 0), 0);
    const gastosOp   = gM.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    const comprasUSA = cM.reduce((s, c) => s + (Number(c.total_usd_cop) || 0), 0);
    const egresos    = gastosOp + comprasUSA;
    const utilidad   = cobrado - egresos;
    const margenPct  = cobrado > 0 ? (utilidad / cobrado) * 100 : 0;

    return { key, mes, cobrado, gastosOp, comprasUSA, egresos, utilidad, margenPct };
  });
};

// ─────────────────────────────────────────────
// 11. RETENCIÓN DE CLIENTES
// ─────────────────────────────────────────────

/**
 * Calcula retención de clientes mes a mes.
 * @param {Array} clientes
 * @param {Array} ventas
 * @returns {Array}
 */
export const calcularRetencion = (clientes, ventas) => {
  const now = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push({ year: ref.getFullYear(), month: ref.getMonth() + 1, key: monthKey(ref) });
  }

  // Para cada cliente, obtener set de meses en los que compró
  const comprasPorCliente = {};
  for (const venta of ventas || []) {
    const d = parseDate(venta.fecha);
    if (!d || !venta.cliente_id) continue;
    const k = monthKey(d);
    if (!comprasPorCliente[venta.cliente_id]) comprasPorCliente[venta.cliente_id] = new Set();
    comprasPorCliente[venta.cliente_id].add(k);
  }

  return meses.map(({ year, month, key }, idx) => {
    const mes = monthLabel(key);
    const keyActual   = key;
    const keyAnterior = idx > 0 ? meses[idx - 1].key : null;

    const activosActual   = new Set();
    const activosAnterior = new Set();

    for (const [cid, mesesSet] of Object.entries(comprasPorCliente)) {
      if (mesesSet.has(keyActual))   activosActual.add(cid);
      if (keyAnterior && mesesSet.has(keyAnterior)) activosAnterior.add(cid);
    }

    const activos     = activosActual.size;
    const recuperados = [...activosActual].filter((c) => {
      if (!keyAnterior) return false;
      return !activosAnterior.has(c) &&
        [...comprasPorCliente[c] || []].some((k2) => k2 < keyActual && k2 !== keyAnterior);
    }).length;
    const perdidos    = keyAnterior
      ? [...activosAnterior].filter((c) => !activosActual.has(c)).length
      : 0;
    const enRiesgo    = [...activosActual].filter((c) => {
      const mesesArr = [...(comprasPorCliente[c] || [])].sort();
      const lastKey  = mesesArr[mesesArr.length - 1];
      return lastKey === keyActual;
    }).length;

    const tasaRetencion = activosAnterior.size > 0
      ? (([...activosAnterior].filter((c) => activosActual.has(c)).length) / activosAnterior.size) * 100
      : 100;

    return { key, mes, activos, enRiesgo, recuperados, perdidos, tasaRetencion };
  });
};

// ─────────────────────────────────────────────
// 12. SEGMENTACIÓN RFM
// ─────────────────────────────────────────────

/**
 * Segmenta clientes por comportamiento de compra.
 * @param {Array} clientes
 * @param {Array} ventas
 * @returns {Array}
 */
export const calcularSegmentacion = (clientes, ventas) => {
  const now = new Date();
  const abonosPorCliente = {};

  return (clientes || []).map((c) => {
    const ventasCliente = ventas.filter((v) => v.cliente_id === c.id);
    const fechas = ventasCliente.map((v) => parseDate(v.fecha)).filter(Boolean).sort((a, b) => b - a);
    const revenueTotal = ventasCliente.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const cobrado      = ventasCliente.reduce((s, v) => s + (Number(v.monto_cobrado || 0)), 0);
    const saldo        = revenueTotal - cobrado;
    const diasSinCompra = fechas.length > 0 ? Math.floor((now - fechas[0]) / 86400000) : 9999;

    // Frecuencia: compras por mes (basado en historial)
    let frecuenciaMes = 0;
    if (fechas.length > 1) {
      const rangoDias = (fechas[0] - fechas[fechas.length - 1]) / 86400000;
      const mesesRango = Math.max(1, rangoDias / 30);
      frecuenciaMes = ventasCliente.length / mesesRango;
    } else if (fechas.length === 1) {
      frecuenciaMes = 0.5;
    }

    const ticketPromedio = ventasCliente.length > 0 ? revenueTotal / ventasCliente.length : 0;

    // Segmento
    let segmento = 'recuperar';
    if (frecuenciaMes >= 1 && ticketPromedio >= 500_000)  segmento = 'estrella';
    else if (ticketPromedio >= 1_000_000)                  segmento = 'grande_ocasional';
    else if (frecuenciaMes >= 0.5)                         segmento = 'regular';

    // Estado
    let estado = 'activo';
    if (saldo > 0 && diasSinCompra < 30)   estado = 'en_mora';
    else if (diasSinCompra > 90)            estado = 'inactivo';
    else if (diasSinCompra > 45)            estado = 'en_riesgo';

    return {
      clienteId: c.id,
      nombre: c.nombre || `Cliente ${c.id}`,
      frecuenciaMes: Math.round(frecuenciaMes * 10) / 10,
      ticketPromedio,
      revenueTotal,
      cobrado,
      saldo,
      diasSinCompra,
      segmento,
      estado,
    };
  }).sort((a, b) => b.revenueTotal - a.revenueTotal);
};

// ─────────────────────────────────────────────
// 13. ROTACIÓN DE INVENTARIO
// ─────────────────────────────────────────────

/**
 * Calcula rotación de inventario por producto.
 * @param {Array} productos
 * @param {Array} ventas
 * @returns {Array}
 */
export const calcularRotacionInventario = (productos, ventas) => {
  const now = new Date();

  return (productos || []).map((p) => {
    const ventasProducto = ventas.filter((v) => {
      const items = v.items || v.detalle || [];
      return items.some((i) => i.producto_id === p.id);
    });

    // Total unidades vendidas
    let unidadesVendidas = 0;
    let ultimaVentaDate = null;

    for (const v of ventasProducto) {
      const items = v.items || v.detalle || [];
      const item  = items.find((i) => i.producto_id === p.id);
      if (item) unidadesVendidas += Number(item.cantidad) || 0;
      const d = parseDate(v.fecha);
      if (d && (!ultimaVentaDate || d > ultimaVentaDate)) ultimaVentaDate = d;
    }

    const stock          = Number(p.stock_actual || p.stock || 0);
    const costo          = Number(p.costo_estimado) || (Number(p.precio_cop || p.precio || 0) * 0.65);
    const valorInventario = stock * costo;

    // Días de rotación: stock / (unidades vendidas / días histórico)
    let diasRotacion = 0;
    if (unidadesVendidas > 0 && ventasProducto.length > 0) {
      const fechas   = ventasProducto.map((v) => parseDate(v.fecha)).filter(Boolean).sort((a, b) => a - b);
      const rangoDias = fechas.length > 1
        ? Math.max(1, (fechas[fechas.length - 1] - fechas[0]) / 86400000)
        : 30;
      const ventasDia = unidadesVendidas / rangoDias;
      diasRotacion    = ventasDia > 0 ? Math.round(stock / ventasDia) : 9999;
    } else if (stock > 0) {
      diasRotacion = 9999;
    }

    const puntoReorden = Number(p.punto_reorden) || Number(p.stock_minimo) || 5;

    // Estado
    let estado = 'optimo';
    if (!ultimaVentaDate)                                     estado = 'sin_movimiento';
    else if ((now - ultimaVentaDate) / 86400000 > 60)         estado = 'sin_movimiento';
    else if (diasRotacion > 90)                               estado = 'lento';
    else if (stock <= puntoReorden)                           estado = 'critico';

    return {
      productoId:    p.id,
      nombre:        p.nombre || `Producto ${p.id}`,
      sku:           p.sku    || '',
      stock,
      valorInventario,
      diasRotacion:  diasRotacion >= 9999 ? null : diasRotacion,
      ultimaVenta:   ultimaVentaDate ? ultimaVentaDate.toISOString().split('T')[0] : null,
      puntoReorden,
      estado,
    };
  }).sort((a, b) => {
    const orden = { critico: 0, sin_movimiento: 1, lento: 2, optimo: 3 };
    return (orden[a.estado] ?? 4) - (orden[b.estado] ?? 4);
  });
};
