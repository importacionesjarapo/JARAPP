// src/dashboard/reportInterpretations.js
// Motor de interpretación dinámica — recibe datos reales, retorna texto en español
// ─────────────────────────────────────────────────────────────────────────────
// NUNCA texto hardcodeado. SIEMPRE basado en los datos recibidos.

// ─── Helpers de formato locales ───────────────────────────────────────────────
const cop = (n) => '$' + Math.round(Math.abs(n)).toLocaleString('es-CO');
const pct = (n, d = 1) => Number(n).toFixed(d).replace('.', ',') + '%';

const MESES_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Convierte una clave YYYY-MM al nombre del mes en español.
 * @param {string} key  — p.ej. "2025-03"
 * @returns {string}    — p.ej. "marzo 2025"
 */
const mes = (key) => {
    if (!key || typeof key !== 'string') return key || '?';
    const parts = key.split('-');
    if (parts.length < 2) return key;
    const [y, m] = parts;
    const idx = parseInt(m, 10) - 1;
    return `${MESES_ES[idx] ?? m} ${y}`;
};

/**
 * Calcula la tendencia de un array de números: 'mejorando' | 'deteriorando' | 'estable'.
 * Compara la media de la primera mitad con la segunda mitad.
 */
const tendencia = (arr) => {
    if (!Array.isArray(arr) || arr.length < 2) return 'estable';
    const mid = Math.floor(arr.length / 2);
    const primeraMitad = arr.slice(0, mid);
    const segundaMitad = arr.slice(mid);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const diff = avg(segundaMitad) - avg(primeraMitad);
    if (Math.abs(diff) < 0.01 * Math.abs(avg(primeraMitad) || 1)) return 'estable';
    return diff > 0 ? 'mejorando' : 'deteriorando';
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. P&L — Análisis de Utilidad y Margen Mensual
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{mes:string, ingresos:number, gastos:number, compras:number, utilidad:number, margen:number}>} meses
 * @param {Object} parametros  — metas: { meta_margen_neto_pct, umbral_margen_minimo_pct }
 * @returns {string}
 */
export const interpretarPL = (meses, parametros = {}) => {
    if (!Array.isArray(meses) || meses.length === 0) {
        return 'No hay datos de P&L disponibles para el período seleccionado.';
    }

    const metaMargen    = parseFloat(parametros.meta_margen_neto_pct    ?? 25);
    const umbralMinimo  = parseFloat(parametros.umbral_margen_minimo_pct ?? 10);

    const ultimo        = meses[meses.length - 1];
    const penultimo     = meses.length >= 2 ? meses[meses.length - 2] : null;

    const utilidades    = meses.map(m => parseFloat(m.utilidad ?? 0));
    const margenes      = meses.map(m => parseFloat(m.margen   ?? 0));
    const avgUtilidad   = utilidades.reduce((s, v) => s + v, 0) / meses.length;
    const avgMargen     = margenes.reduce((s, v) => s + v, 0) / meses.length;

    const negativos     = meses.filter(m => parseFloat(m.utilidad ?? 0) < 0);
    const trend         = tendencia(utilidades);

    const margenActual  = parseFloat(ultimo.margen ?? 0);
    const utilActual    = parseFloat(ultimo.utilidad ?? 0);
    const mesActual     = mes(ultimo.mes ?? ultimo.label ?? '');

    // ── Oración 1: estado actual del margen ──────────────────────────────────
    let oracion1 = '';
    if (margenActual < 0) {
        oracion1 = `En ${mesActual} la operación registró una **pérdida neta** de ${cop(utilActual)} (margen ${pct(margenActual)}), situación que requiere atención inmediata.`;
    } else if (margenActual < umbralMinimo) {
        oracion1 = `El margen de ${mesActual} se ubica en ${pct(margenActual)}, **por debajo del umbral mínimo** del ${pct(umbralMinimo, 0)}, con una utilidad de ${cop(utilActual)}.`;
    } else if (margenActual >= metaMargen) {
        oracion1 = `El margen de ${mesActual} alcanzó ${pct(margenActual)}, **superando la meta** del ${pct(metaMargen, 0)}, con una utilidad de ${cop(utilActual)}.`;
    } else {
        oracion1 = `En ${mesActual} se obtuvo un margen del ${pct(margenActual)} y una utilidad de ${cop(utilActual)}, dentro del rango operativo pero aún por debajo de la meta del ${pct(metaMargen, 0)}.`;
    }

    // ── Oración 2: tendencia ─────────────────────────────────────────────────
    const tendTexto = {
        mejorando:     `La tendencia del período es **positiva**: la rentabilidad viene mejorando consistentemente (promedio ${pct(avgMargen)}).`,
        deteriorando:  `La tendencia del período es **negativa**: la rentabilidad viene deteriorándose (promedio ${pct(avgMargen)}). Se recomienda revisar la estructura de costos.`,
        estable:       `La rentabilidad se ha mantenido **estable** en el período, con un margen promedio del ${pct(avgMargen)}.`,
    };
    const oracion2 = tendTexto[trend];

    // ── Oración 3: meses negativos ───────────────────────────────────────────
    let oracion3 = '';
    if (negativos.length > 0) {
        const listaNeg = negativos.map(m => mes(m.mes ?? m.label ?? '')).join(', ');
        oracion3 = `Se presentaron meses con resultado negativo: **${listaNeg}** — los cuales deben revisarse en detalle para identificar causas y evitar su recurrencia.`;
    } else {
        oracion3 = `No se registraron meses con pérdida en el período analizado, lo cual refleja una gestión de costos controlada.`;
    }

    // ── Oración 4: comparación con mes anterior ───────────────────────────────
    let oracion4 = '';
    if (penultimo) {
        const margenAnt  = parseFloat(penultimo.margen   ?? 0);
        const utilAnt    = parseFloat(penultimo.utilidad ?? 0);
        const mesAnt     = mes(penultimo.mes ?? penultimo.label ?? '');
        const deltaUtil  = utilActual - utilAnt;
        const deltaMarg  = margenActual - margenAnt;
        if (deltaUtil >= 0) {
            oracion4 = `Comparado con ${mesAnt} (${cop(utilAnt)}, margen ${pct(margenAnt)}), la utilidad **aumentó** en ${cop(deltaUtil)} y el margen ${deltaMarg >= 0 ? 'subió' : 'bajó'} ${pct(Math.abs(deltaMarg))} puntos porcentuales.`;
        } else {
            oracion4 = `Comparado con ${mesAnt} (${cop(utilAnt)}, margen ${pct(margenAnt)}), la utilidad **disminuyó** en ${cop(Math.abs(deltaUtil))} y el margen cayó ${pct(Math.abs(deltaMarg))} puntos porcentuales.`;
        }
    }

    return [oracion1, oracion2, oracion3, oracion4].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Flujo de Caja Proyectado
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {number} saldo           — Saldo actual
 * @param {number} proy30          — Proyección a 30 días
 * @param {number} proy60          — Proyección a 60 días
 * @param {number} gastosMes       — Gastos estimados del mes
 * @param {number} cartera         — Total cartera pendiente
 * @returns {string}
 */
export const interpretarFlujo = (saldo, proy30, proy60, gastosMes, cartera) => {
    const s   = parseFloat(saldo      ?? 0);
    const p30 = parseFloat(proy30     ?? 0);
    const p60 = parseFloat(proy60     ?? 0);
    const gm  = parseFloat(gastosMes  ?? 0);
    const cart= parseFloat(cartera    ?? 0);

    let oracion1 = '';
    if (p30 < 0) {
        oracion1 = `La proyección de caja a 30 días es **negativa** (${cop(p30)}), lo que indica un **déficit de ${cop(Math.abs(p30))}** frente a los compromisos estimados de ${cop(gm)}. Se requiere acción inmediata para reforzar los cobros.`;
    } else if (p30 < gm) {
        const deficit = gm - p30;
        oracion1 = `La caja proyectada a 30 días (${cop(p30)}) **apenas cubre** una fracción de los gastos del período (${cop(gm)}), con un déficit potencial de ${cop(deficit)}. La liquidez es ajustada y debe monitorearse semanalmente.`;
    } else if (p30 > gm * 2) {
        oracion1 = `La proyección de caja a 30 días es **sólida**: ${cop(p30)}, lo que representa **${(p30 / gm).toFixed(1).replace('.', ',')}x** los gastos estimados del mes (${cop(gm)}). La empresa cuenta con colchón de liquidez suficiente para operar con tranquilidad.`;
    } else {
        const buffer = p30 - gm;
        oracion1 = `La liquidez proyectada a 30 días (${cop(p30)}) es **ajustada pero positiva**, con un margen de seguridad de ${cop(buffer)} sobre los gastos estimados del mes (${cop(gm)}). Conviene fortalecer el cobro de cartera para ampliar el colchón.`;
    }

    const trend60 = p60 > p30 ? 'una mejora progresiva' : p60 < p30 ? 'una presión creciente' : 'estabilidad';
    const oracion2 = `La proyección a 60 días (${cop(p60)}) sugiere ${trend60} en el flujo de caja, lo que debe monitorearse ante variaciones en los compromisos de compra o demoras en cobros.`;

    const oracion3 = cart > 0
        ? `La **cartera pendiente de ${cop(cart)}** es la principal palanca de mejora: accelerar su recuperación puede transformar la posición de caja en los próximos 30–45 días sin necesidad de financiamiento externo.`
        : `Con la cartera al día, el flujo depende principalmente de la generación de nuevas ventas y el control estricto de egresos comprometidos.`;

    return [oracion1, oracion2, oracion3].join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cartera Aging — Análisis de Cuentas por Cobrar
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} agingData  — { '0-30': [{id, cliente, saldo, dias}], '31-60': [...], '61-90': [...], '+90': [...], total }
 * @param {Array}  clientes   — Lista completa de clientes (para nombres)
 * @returns {string}
 */
export const interpretarCartera = (agingData, clientes = []) => {
    if (!agingData || typeof agingData !== 'object') {
        return 'No hay datos de cartera disponibles para el período seleccionado.';
    }

    const tramos = ['0-30', '31-60', '61-90', '+90'];
    const prob   = { '0-30': 0.85, '31-60': 0.65, '61-90': 0.40, '+90': 0.15 };

    const getTramo = (k) => Array.isArray(agingData[k]) ? agingData[k] : [];

    const totalCartera   = tramos.reduce((s, k) => s + getTramo(k).reduce((a, e) => a + parseFloat(e.saldo ?? 0), 0), 0);
    const totalCritico   = getTramo('+90').reduce((a, e) => a + parseFloat(e.saldo ?? 0), 0);
    const pctCritico     = totalCartera > 0 ? (totalCritico / totalCartera) * 100 : 0;

    // Top 3 deudores por saldo total
    const todosMapa = {};
    tramos.forEach(k => {
        getTramo(k).forEach(e => {
            const cid = e.clienteId?.toString() ?? e.cliente;
            if (!todosMapa[cid]) todosMapa[cid] = { nombre: e.cliente, saldo: 0, tramoCritico: false };
            todosMapa[cid].saldo += parseFloat(e.saldo ?? 0);
            if (k === '+90' || k === '61-90') todosMapa[cid].tramoCritico = true;
        });
    });
    const top3 = Object.values(todosMapa)
        .sort((a, b) => b.saldo - a.saldo)
        .slice(0, 3);

    // Recuperación estimada a 30 días
    const recuperacionEst = tramos.reduce((s, k) => {
        return s + getTramo(k).reduce((a, e) => a + parseFloat(e.saldo ?? 0) * prob[k], 0);
    }, 0);

    // ── Oración 1: estado general y críticos ─────────────────────────────────
    let oracion1 = '';
    if (totalCartera === 0) {
        return 'La cartera está completamente al día — no hay saldos pendientes registrados en el período.';
    }
    if (pctCritico > 30) {
        oracion1 = `La cartera total es de ${cop(totalCartera)}, con **${pct(pctCritico)} en estado crítico** (+90 días, ${cop(totalCritico)}). Esta concentración de vencidos representa un riesgo significativo de incobrabilidad que requiere gestión inmediata.`;
    } else if (pctCritico > 0) {
        oracion1 = `La cartera total asciende a ${cop(totalCartera)}, de los cuales el ${pct(pctCritico)} (${cop(totalCritico)}) supera los 90 días. Aunque el porcentaje crítico es manejable, debe priorizarse su cobro antes de que escale.`;
    } else {
        oracion1 = `La cartera total de ${cop(totalCartera)} se encuentra **dentro de plazos controlados**: no hay saldos en la categoría crítica (+90 días). La gestión preventiva está funcionando.`;
    }

    // ── Oración 2: top deudores ───────────────────────────────────────────────
    let oracion2 = '';
    if (top3.length > 0) {
        const lista = top3.map((d, i) => `**${d.nombre}** (${cop(d.saldo)}${d.tramoCritico ? ' ⚠️' : ''})`).join(', ');
        oracion2 = `Los principales deudores son: ${lista}. ${top3.filter(d => d.tramoCritico).length > 0 ? 'Los marcados con ⚠️ tienen saldos en tramos de riesgo alto (>60 días).' : 'Todos se encuentran en tramos de bajo riesgo relativo.'}`;
    }

    // ── Oración 3: recuperación estimada ─────────────────────────────────────
    const oracion3 = `Aplicando probabilidades de cobro por tramo (85% corriente → 15% crítico), la **recuperación estimada en 30 días es de ${cop(recuperacionEst)}**, lo que representa el ${pct((recuperacionEst / totalCartera) * 100)} de la cartera total.`;

    return [oracion1, oracion2, oracion3].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Rentabilidad por Producto / Categoría
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{cat:string, margen:number, ventas:number, n:number, clase:string}>} productos
 * @param {Object} parametros  — { meta_margen_neto_pct, umbral_margen_minimo_pct }
 * @returns {string}
 */
export const interpretarProductos = (productos, parametros = {}) => {
    if (!Array.isArray(productos) || productos.length === 0) {
        return 'No hay datos de rentabilidad por producto disponibles para el período.';
    }

    const metaMargen   = parseFloat(parametros.meta_margen_neto_pct    ?? 25);
    const umbralMinimo = parseFloat(parametros.umbral_margen_minimo_pct ?? 10);

    const ordenados    = [...productos].sort((a, b) => parseFloat(b.margen) - parseFloat(a.margen));
    const mejor        = ordenados[0];
    const peor         = ordenados[ordenados.length - 1];
    const estrellas    = productos.filter(p => parseFloat(p.margen) > 25);
    const criticos     = productos.filter(p => parseFloat(p.margen) < umbralMinimo);

    const totalVentas  = productos.reduce((s, p) => s + parseFloat(p.ventas ?? 0), 0);
    const ventasEstrel = estrellas.reduce((s, p) => s + parseFloat(p.ventas ?? 0), 0);
    const pctEstVentas = totalVentas > 0 ? (ventasEstrel / totalVentas) * 100 : 0;

    // ── Oración 1: mejor producto ─────────────────────────────────────────────
    const oracion1 = `La categoría/producto con **mayor rentabilidad** es **${mejor.cat}**, con un margen del ${pct(parseFloat(mejor.margen))} y un revenue de ${cop(parseFloat(mejor.ventas ?? 0))} en el período.`;

    // ── Oración 2: estrellas ──────────────────────────────────────────────────
    let oracion2 = '';
    if (estrellas.length > 0) {
        const nombresEstr = estrellas.slice(0, 3).map(p => p.cat).join(', ');
        oracion2 = `Hay **${estrellas.length} producto(s) estrella** (margen >25%): ${nombresEstr}. Estos aportan el **${pct(pctEstVentas)} del revenue total** y son los motores de rentabilidad del negocio.`;
    } else {
        oracion2 = `Ningún producto supera actualmente el umbral del 25% de margen. Se recomienda revisar la mezcla de productos para identificar oportunidades de mejora en precio o costo.`;
    }

    // ── Oración 3: críticos ───────────────────────────────────────────────────
    let oracion3 = '';
    if (criticos.length > 0) {
        const listaC = criticos.slice(0, 3).map(p => `${p.cat} (${pct(parseFloat(p.margen))})`).join(', ');
        oracion3 = `**${criticos.length} producto(s) están en zona crítica** (margen <${pct(umbralMinimo, 0)}): ${listaC}. Estos productos deberían renegociarse con el proveedor, ajustarse en precio o evaluarse para descontinuación.`;
    } else {
        oracion3 = `No se identificaron productos en zona crítica de margen, lo que indica una cartera de productos generalmente saludable.`;
    }

    // ── Oración 4: acción recomendada ─────────────────────────────────────────
    const oracion4 = estrellas.length >= 2
        ? `Acción recomendada: **concentrar el esfuerzo comercial** en los productos estrella y evaluar si los críticos pueden reemplazarse por alternativas más rentables.`
        : `Acción recomendada: **revisar la estrategia de precios** y negociar mejores condiciones de costo con proveedores para elevar la rentabilidad promedio de la cartera por encima del ${pct(metaMargen, 0)}.`;

    return [oracion1, oracion2, oracion3, oracion4].join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Envíos y Logística
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{id, fase:string, venta_id, cliente:string, updatedAt:string, eta?:string}>} envios
 * @returns {string}
 */
export const interpretarEnvios = (envios) => {
    if (!Array.isArray(envios) || envios.length === 0) {
        return 'No hay registros de envíos activos en el período seleccionado.';
    }

    const FASES_ACTIVAS = ['Comprado', 'En Tránsito', 'Bodega USA', 'Aduana', 'Bodega Colombia'];
    const activos       = envios.filter(e => FASES_ACTIVAS.some(f => (e.fase ?? '').includes(f)));
    const entregados    = envios.filter(e => (e.fase ?? '').includes('Entregado'));
    const totalActivos  = activos.length;

    // On-time: activos sin señal de retraso (≤7 días sin actualización, configurable)
    const ahora = Date.now();
    const retrasados = activos.filter(e => {
        const upd = e.updatedAt ? new Date(e.updatedAt) : null;
        if (!upd || isNaN(upd)) return false;
        return (ahora - upd.getTime()) / 86400000 > 7;
    });
    const onTime     = totalActivos - retrasados.length;
    const tasaOnTime = totalActivos > 0 ? (onTime / totalActivos) * 100 : 100;

    // ── Oración 1: estado general ─────────────────────────────────────────────
    const oracion1 = `Actualmente hay **${totalActivos} envío(s) activo(s)** en curso y ${entregados.length} entregados en el período. La tasa de entrega a tiempo es del **${pct(tasaOnTime, 0)}** (${onTime} de ${totalActivos} sin señales de retraso).`;

    // ── Oración 2: retrasados ─────────────────────────────────────────────────
    let oracion2 = '';
    if (retrasados.length > 0) {
        const listaRet = retrasados.slice(0, 3).map(e => {
            const dias = e.updatedAt ? Math.floor((ahora - new Date(e.updatedAt).getTime()) / 86400000) : '?';
            return `Orden #${String(e.venta_id ?? e.id ?? '').slice(-4)} — ${e.fase ?? 'Sin fase'} (${dias}d sin actualizar)`;
        }).join('; ');
        oracion2 = `**${retrasados.length} envío(s) presentan posible retraso**: ${listaRet}. Se recomienda contactar al operador logístico para confirmar estado.`;
    } else {
        oracion2 = `Todos los envíos activos están dentro de los plazos esperados sin señales de alerta.`;
    }

    // ── Oración 3: próximo ETA ────────────────────────────────────────────────
    const conETA = activos.filter(e => e.eta).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    let oracion3 = '';
    if (conETA.length > 0) {
        const prox = conETA[0];
        const etaFmt = new Date(prox.eta).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
        oracion3 = `El próximo envío en llegar está estimado para el **${etaFmt}**: Orden #${String(prox.venta_id ?? prox.id ?? '').slice(-4)} — ${prox.fase ?? ''}.`;
    } else {
        const enColombia = activos.filter(e => (e.fase ?? '').includes('Colombia'));
        if (enColombia.length > 0) {
            oracion3 = `Hay **${enColombia.length} envío(s) en Bodega Colombia** listos para coordinar entrega final y generar el cobro correspondiente.`;
        }
    }

    return [oracion1, oracion2, oracion3].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Evolución de Ventas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array<{mes:string, facturado:number, cobrado:number, pedidos:number, ticketPromedio?:number}>} meses
 * @param {Object} kpis — { metaFacturacion, metaCobrado }
 * @returns {string}
 */
export const interpretarVentas = (meses, kpis = {}) => {
    if (!Array.isArray(meses) || meses.length === 0) {
        return 'No hay datos de ventas disponibles para el período seleccionado.';
    }

    const facturados = meses.map(m => parseFloat(m.facturado ?? 0));
    const cobrados   = meses.map(m => parseFloat(m.cobrado   ?? 0));
    const tickets    = meses.map(m => parseFloat(m.ticketPromedio ?? 0)).filter(t => t > 0);

    const maxFact    = Math.max(...facturados);
    const mesMejor   = meses[facturados.indexOf(maxFact)];
    const totalFact  = facturados.reduce((s, v) => s + v, 0);
    const totalCob   = cobrados.reduce((s, v) => s + v, 0);
    const trendFact  = tendencia(facturados);
    const metaFact   = parseFloat(kpis.metaFacturacion ?? 0);

    // ── Oración 1: mejor mes y total ─────────────────────────────────────────
    const oracion1 = `El mejor mes del período fue **${mes(mesMejor.mes ?? mesMejor.label ?? '')}** con ${cop(maxFact)} facturados. En total, el período acumula ${cop(totalFact)} facturado y ${cop(totalCob)} cobrado efectivamente.`;

    // ── Oración 2: tendencia ──────────────────────────────────────────────────
    const trendTexto = {
        mejorando:    `La tendencia de ventas es **alcista**: el ritmo de facturación viene creciendo de manera consistente.`,
        deteriorando: `La tendencia de ventas es **bajista**: el volumen de facturación ha venido disminuyendo en los últimos períodos, lo cual exige revisar la estrategia comercial.`,
        estable:      `El volumen de facturación se ha mantenido **relativamente estable** en el período, sin crecimiento ni caídas significativas.`,
    };
    const oracion2 = trendTexto[trendFact];

    // ── Oración 3: ticket promedio ────────────────────────────────────────────
    let oracion3 = '';
    if (tickets.length >= 2) {
        const ticketInicio = tickets[0];
        const ticketFin    = tickets[tickets.length - 1];
        const deltaTick    = ticketFin - ticketInicio;
        if (Math.abs(deltaTick) > 0.01 * ticketInicio) {
            oracion3 = `El ticket promedio ${deltaTick > 0 ? '**creció**' : '**cayó**'} de ${cop(ticketInicio)} a ${cop(ticketFin)} durante el período, lo que indica ${deltaTick > 0 ? 'una mejora en el valor por pedido' : 'posible presión de precios o cambio en el mix de productos'}.`;
        }
    }

    // ── Oración 4: CAGR si hay más de 12 meses ───────────────────────────────
    let oracion4 = '';
    if (meses.length >= 12) {
        const primerVal = facturados.find(v => v > 0) ?? facturados[0];
        const ultimoVal = facturados[facturados.length - 1];
        if (primerVal > 0 && ultimoVal > 0) {
            const n    = meses.length / 12;
            const cagr = (Math.pow(ultimoVal / primerVal, 1 / n) - 1) * 100;
            oracion4 = `Con ${meses.length} meses de datos, la **tasa de crecimiento anual compuesto (CAGR) estimada es del ${pct(cagr)}**, referencia útil para proyecciones futuras.`;
        }
    } else if (metaFact > 0) {
        const ultimoFact = facturados[facturados.length - 1];
        const cumpl      = (ultimoFact / metaFact) * 100;
        oracion4 = `El último mes representa el ${pct(cumpl)} de la meta mensual de ${cop(metaFact)}.`;
    }

    return [oracion1, oracion2, oracion3, oracion4].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. Análisis de Clientes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} segmentacion — { estrella: [], activo: [], riesgo: [], inactivo: [] }
 * @param {Object} aging        — agingData con tramos
 * @returns {string}
 */
export const interpretarClientes = (segmentacion = {}, aging = {}) => {
    const estrella  = Array.isArray(segmentacion.estrella)  ? segmentacion.estrella  : [];
    const activo    = Array.isArray(segmentacion.activo)    ? segmentacion.activo    : [];
    const riesgo    = Array.isArray(segmentacion.riesgo)    ? segmentacion.riesgo    : [];
    const inactivo  = Array.isArray(segmentacion.inactivo)  ? segmentacion.inactivo  : [];
    const totalClis = estrella.length + activo.length + riesgo.length + inactivo.length;

    if (totalClis === 0) {
        return 'No hay datos de clientes disponibles para el período seleccionado.';
    }

    // ── Oración 1: segmento estrella ─────────────────────────────────────────
    let oracion1 = '';
    if (estrella.length > 0) {
        const ltvEstr = estrella.reduce((s, c) => s + parseFloat(c.facturado ?? c.ltv ?? 0), 0);
        const ltvAvg  = ltvEstr / estrella.length;
        const pctEstr = (estrella.length / totalClis) * 100;
        oracion1 = `El **segmento estrella** cuenta con **${estrella.length} clientes** (${pct(pctEstr, 0)} del total), con un LTV promedio de ${cop(ltvAvg)} y un volumen acumulado de ${cop(ltvEstr)}. Son la base más valiosa del negocio y deben recibir atención preferencial.`;
    } else {
        oracion1 = `No se identificaron clientes en el segmento estrella para este período. Revisar la frecuencia de compra y volumen de los clientes más activos.`;
    }

    // ── Oración 2: riesgo de churn ────────────────────────────────────────────
    let oracion2 = '';
    if (riesgo.length > 0) {
        const nombresRiesgo = riesgo.slice(0, 3).map(c => c.nombre?.split(' ').slice(0, 2).join(' ') ?? 'Cliente').join(', ');
        oracion2 = `**${riesgo.length} cliente(s) en riesgo de abandono**: ${nombresRiesgo}${riesgo.length > 3 ? ` y ${riesgo.length - 3} más` : ''}. Estos clientes no han comprado en el período esperado y podrían desertar sin contacto proactivo.`;
    }
    if (inactivo.length > 0) {
        const textoInact = `Adicionalmente, **${inactivo.length} cliente(s) están inactivos** y requieren campaña de reactivación.`;
        oracion2 = oracion2 ? oracion2 + ' ' + textoInact : textoInact;
    }
    if (!oracion2) {
        oracion2 = `No se detectaron clientes en riesgo de abandono o inactividad en el período — la retención está bajo control.`;
    }

    // ── Oración 3: LTV promedio general ──────────────────────────────────────
    const todosClientes = [...estrella, ...activo, ...riesgo, ...inactivo];
    const ltvTotal      = todosClientes.reduce((s, c) => s + parseFloat(c.facturado ?? c.ltv ?? 0), 0);
    const ltvPromGeneral = ltvTotal / (todosClientes.length || 1);
    const oracion3 = `El LTV promedio de la base completa de ${totalClis} clientes es **${cop(ltvPromGeneral)}**. Los clientes estrella superan este promedio ${estrella.length > 0 ? `por ${pct(((estrella.reduce((s, c) => s + parseFloat(c.facturado ?? c.ltv ?? 0), 0) / estrella.length) / ltvPromGeneral - 1) * 100, 0)}` : ''}, lo que refuerza la estrategia de concentrar esfuerzo en retener el segmento top.`;

    return [oracion1, oracion2, oracion3].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. KPIs vs Objetivos — Scoreboard
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} scores — { liquidez, cartera, logistica, rentabilidad, control, global }
 * @param {Object} metas  — objeto con claves de meta (meta_margen_neto_pct, etc.)
 * @returns {string}
 */
export const interpretarKPIsVsObjetivos = (scores = {}, metas = {}) => {
    const global      = parseFloat(scores.global      ?? 0);
    const liquidez    = parseFloat(scores.liquidez    ?? 0);
    const cartera     = parseFloat(scores.cartera     ?? 0);
    const logistica   = parseFloat(scores.logistica   ?? 0);
    const rentabilidad= parseFloat(scores.rentabilidad?? 0);
    const control     = parseFloat(scores.control     ?? 0);

    const dimensiones = [
        { nombre: 'Liquidez',      valor: liquidez },
        { nombre: 'Cartera',       valor: cartera },
        { nombre: 'Logística',     valor: logistica },
        { nombre: 'Rentabilidad',  valor: rentabilidad },
        { nombre: 'Control',       valor: control },
    ].filter(d => d.valor >= 0);

    const masFuerte = [...dimensiones].sort((a, b) => b.valor - a.valor)[0];
    const masDebil  = [...dimensiones].sort((a, b) => a.valor - b.valor)[0];

    // ── Oración 1: evaluación global ──────────────────────────────────────────
    let oracion1 = '';
    if (global >= 80) {
        oracion1 = `El **Score Global de Salud del Negocio es ${global}/100** — nivel **excelente**. El negocio opera con indicadores sólidos en la mayoría de las dimensiones y está preparado para crecer.`;
    } else if (global >= 60) {
        oracion1 = `El **Score Global es ${global}/100** — nivel **aceptable**, pero con oportunidades de mejora importantes. Se recomienda atender las dimensiones más débiles para elevar la salud operativa.`;
    } else {
        oracion1 = `El **Score Global es ${global}/100** — nivel **crítico**. Varias dimensiones del negocio están comprometidas y requieren intervención inmediata para evitar deterioro mayor.`;
    }

    // ── Oración 2: dimensión más débil con consejo específico ────────────────
    const consejosDebiles = {
        'Liquidez':     `Reforzar los cobros de cartera y reducir egresos no esenciales para mejorar el flujo de caja en los próximos 30 días.`,
        'Cartera':      `Priorizar la gestión de cobro en los tramos de mayor antigüedad (+60 días) y considerar implementar alertas automáticas de vencimiento.`,
        'Logística':    `Revisar los envíos activos con mayor tiempo sin actualización y coordinar con el operador para acelerar los despachos pendientes.`,
        'Rentabilidad': `Analizar los productos con margen por debajo del mínimo y evaluar ajustes de precio o renegociación de costos con proveedores.`,
        'Control':      `Fortalecer el registro de gastos y la parametrización de metas para mejorar la visibilidad operativa del negocio.`,
    };
    const oracion2 = masDebil
        ? `La dimensión más débil es **${masDebil.nombre}** (${masDebil.valor}/100). Consejo: ${consejosDebiles[masDebil.nombre] ?? 'Revisar en detalle los indicadores de esta dimensión.'}`
        : '';

    // ── Oración 3: dimensión más fuerte ──────────────────────────────────────
    const oracion3 = masFuerte
        ? `El punto más fuerte del negocio es **${masFuerte.nombre}** (${masFuerte.valor}/100) — un diferencial que debe mantenerse y comunicarse al equipo como logro de gestión.`
        : '';

    return [oracion1, oracion2, oracion3].filter(Boolean).join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 9. Resumen Ejecutivo — Análisis Cruzado de Módulos
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} snapshot — {
 *   cobrado, facturado, egresos, balance, margenPct,
 *   carteraT, logsActivos, scores, criticas, oportunidades,
 *   cierre_base, mesLabel
 * }
 * @returns {string}
 */
export const interpretarResumenEjecutivo = (snapshot = {}) => {
    if (!snapshot || typeof snapshot !== 'object') {
        return 'No hay datos suficientes para generar el resumen ejecutivo.';
    }

    const cobrado      = parseFloat(snapshot.cobrado      ?? 0);
    const facturado    = parseFloat(snapshot.facturado    ?? 0);
    const egresos      = parseFloat(snapshot.egresos      ?? 0);
    const balance      = parseFloat(snapshot.balance      ?? cobrado - egresos);
    const margenPct    = parseFloat(snapshot.margenPct    ?? (cobrado > 0 ? ((balance / cobrado) * 100) : 0));
    const carteraT     = parseFloat(snapshot.carteraT     ?? 0);
    const logsActivos  = parseInt(snapshot.logsActivos    ?? 0, 10);
    const scores       = snapshot.scores   ?? {};
    const globalScore  = parseFloat(scores.global         ?? 0);
    const criticas     = Array.isArray(snapshot.criticas)     ? snapshot.criticas     : [];
    const oportunidades= Array.isArray(snapshot.oportunidades) ? snapshot.oportunidades: [];
    const mesLabel     = snapshot.mesLabel ?? 'el período';
    const cierreBase   = parseFloat(snapshot.cierre_base  ?? 0);

    // ── Frase 1: salud financiera ─────────────────────────────────────────────
    let frase1 = '';
    if (balance >= 0) {
        frase1 = `**Salud financiera:** En ${mesLabel} se cobró ${cop(cobrado)} con un balance positivo de ${cop(balance)} y un margen del ${pct(margenPct)} — el negocio genera caja.`;
    } else {
        frase1 = `**Salud financiera:** En ${mesLabel} los egresos (${cop(egresos)}) superaron lo cobrado (${cop(cobrado)}), generando un déficit de ${cop(Math.abs(balance))} — se requiere acción correctiva urgente.`;
    }

    // ── Frase 2: cartera ──────────────────────────────────────────────────────
    const frase2 = carteraT > 0
        ? `**Cartera:** Hay ${cop(carteraT)} pendientes de cobro — este saldo, recuperado en los próximos 30 días, transformaría significativamente la posición de liquidez.`
        : `**Cartera:** La cartera está al día — no hay saldos vencidos pendientes, lo que refleja una gestión de cobro efectiva.`;

    // ── Frase 3: logística ────────────────────────────────────────────────────
    const frase3 = logsActivos > 0
        ? `**Logística:** ${logsActivos} envío(s) activos en curso${criticas.filter(c => c.accion === 'logistica').length > 0 ? `, de los cuales ${criticas.filter(c => c.accion === 'logistica').length} presentan señales de retraso` : ' sin alertas críticas'} — coordinar entregas pendientes activa cobros inmediatos.`
        : `**Logística:** No hay envíos activos en el momento — el pipeline de órdenes puede estar vacío o todas las entregas están completadas.`;

    // ── Frase 4: mayor oportunidad ────────────────────────────────────────────
    let frase4 = '';
    if (oportunidades.length > 0) {
        const op = oportunidades[0];
        frase4 = `**Mayor oportunidad:** ${op.titulo} — ${op.desc}`;
    } else if (cierreBase > 0) {
        frase4 = `**Mayor oportunidad:** Al ritmo actual de ventas, el cierre de mes proyecta ${cop(cierreBase)} — mantener el ritmo o superar el escenario optimista requiere activar los clientes inactivos con mayor LTV.`;
    } else {
        frase4 = `**Mayor oportunidad:** Activar clientes con histórico de compra frecuente que no han pedido en los últimos 30 días para impulsar los ingresos del período.`;
    }

    // ── Frase 5: principal riesgo ─────────────────────────────────────────────
    let frase5 = '';
    if (criticas.length > 0) {
        const riesgoPrincipal = criticas[0];
        frase5 = `**Principal riesgo:** ${riesgoPrincipal.titulo} — ${riesgoPrincipal.desc} (${criticas.length} alerta(s) crítica(s) activas en total).`;
    } else if (globalScore < 60) {
        frase5 = `**Principal riesgo:** El Score Global de ${globalScore}/100 indica fragilidad estructural en varias dimensiones — un cambio adverso en el mercado podría impactar severamente la operación.`;
    } else {
        frase5 = `**Principal riesgo:** Sin alertas críticas activas — el riesgo operativo es bajo, aunque la vigilancia continua de la cartera y el flujo de caja sigue siendo prioritaria.`;
    }

    return [frase1, frase2, frase3, frase4, frase5].join('\n\n');
};
