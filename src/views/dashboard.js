import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatCOP, downloadExcel } from '../utils.js';
import Chart from 'chart.js/auto';

// ─── Colores ──────────────────────────────────────────────────────────────────
const C = {
    red:    '#E63946', green: '#06D6A0', blue:   '#4CC9F0',
    orange: '#FFB703', violet:'#A78BFA', pink:   '#F472B6', cyan: '#2DD4BF',
    palette: ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6','#2DD4BF','#FB923C','#34D399','#818CF8'],
};

// ─── Estado del módulo ────────────────────────────────────────────────────────
let _dashStartDate    = '';
let _dashEndDate      = '';
let _dashCache        = null;
let _dashRenderLayout = null;
let _currentCategory  = 'finanzas';
let _currentReportId  = 'fin-pnl';
let _currentChartType = null;
let _currentView      = 'monthly';   // 'monthly' | 'explorer'
let _monthOffset      = 0;           // 0=mes actual, -1=anterior, etc.

// ─── Utilitarios de fecha ─────────────────────────────────────────────────────
const parseDate = (s) => {
    if (!s) return null;
    const str = String(s).split('T')[0].split(' ')[0];
    if (str.includes('/')) {
        const p = str.split('/');
        if (p[2]?.length === 4) return new Date(+p[2], +p[1]-1, +p[0]);
        return new Date(str);
    }
    return new Date(str);
};

const applyDateFilter = (arr, dateField) => {
    if (!_dashStartDate && !_dashEndDate) return arr;
    const _s = _dashStartDate ? new Date(_dashStartDate + 'T00:00:00') : null;
    const _e = _dashEndDate   ? new Date(_dashEndDate   + 'T23:59:59') : null;
    return arr.filter(item => {
        const dStr = typeof dateField === 'function' ? dateField(item) : item[dateField];
        const vd = parseDate(dStr);
        if (!vd || isNaN(vd)) return true;
        vd.setHours(12, 0, 0, 0);
        if (_s && vd < _s) return false;
        if (_e && vd > _e) return false;
        return true;
    });
};

const monthKey   = (d)   => (!d || isNaN(d)) ? null : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const monthLabel = (key) => {
    if (!key) return '?';
    const [y, m] = key.split('-');
    return `${'Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic'.split(' ')[+m-1]} ${y.slice(-2)}`;
};
const groupByMonth = (arr, campo, val) => {
    const map = {};
    arr.forEach(item => {
        const k = monthKey(parseDate(item[campo]));
        if (!k) return;
        map[k] = (map[k] || 0) + parseFloat(item[val] || 0);
    });
    return map;
};
const fmtM = (v) => `$${(Math.abs(v)/1000000).toFixed(1)}M`;
const fmtK = (v) => Math.abs(v) >= 1000000 ? fmtM(v) : `$${(Math.abs(v)/1000).toFixed(0)}k`;

// ─── Helpers de mes ───────────────────────────────────────────────────────────
const getMonthRange = (offset = 0) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59);
    const label = start.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
    return { start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
};
const inMonthRange = (item, field, offset) => {
    const { start, end } = getMonthRange(offset);
    const dStr = typeof field === 'function' ? field(item) : item[field];
    const d = parseDate(dStr);
    if (!d || isNaN(d)) return false;
    d.setHours(12, 0, 0, 0);
    return d >= start && d <= end;
};

// ─── Logística fases ──────────────────────────────────────────────────────────
const FASES       = ['Comprado','En Tránsito','Bodega USA','Aduana','Bodega Colombia','Entregado'];
const FASE_COLORS = [C.red, C.blue, C.orange, C.violet, C.cyan, C.green];
const mapFase = (f) => {
    if (!f) return FASES[0];
    if (f.includes('1.') || f.includes('Comprado'))   return FASES[0];
    if (f.includes('2.') || f.includes('Tienda'))     return FASES[1];
    if (f.includes('3.') || f.includes('Bodega USA') || f.includes('Miami')) return FASES[2];
    if (f.includes('4.') || f.includes('Internacional') || f.includes('Aduana')) return FASES[3];
    if (f.includes('5.') || f.includes('Bodega Colombia')) return FASES[4];
    if (f.includes('6.') || f.includes('Entregado'))  return FASES[5];
    return FASES[0];
};

// ─── Colores de tema ──────────────────────────────────────────────────────────
const getThemeColors = () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return {
        text:      light ? 'rgba(15,23,42,0.85)'     : 'rgba(255,255,255,0.85)',
        subtext:   light ? 'rgba(15,23,42,0.50)'     : 'rgba(255,255,255,0.50)',
        grid:      light ? 'rgba(0,0,0,0.08)'        : 'rgba(255,255,255,0.12)',
        tooltipBg: light ? '#FFFFFF'                 : '#0F172A',
    };
};

// ─── Metadata ────────────────────────────────────────────────────────────────
const CATEGORIES = [
    { id: 'finanzas',    label: 'Finanzas',    icon: '💹' },
    { id: 'ventas',      label: 'Ventas',       icon: '📈' },
    { id: 'logistica',   label: 'Logística',    icon: '🚚' },
    { id: 'clientes',    label: 'Clientes',     icon: '👥' },
    { id: 'operaciones', label: 'Operaciones',  icon: '⚙️' },
];

const CHART_TYPES = [
    { id: 'line',     label: 'Línea',  icon: '📈' },
    { id: 'area',     label: 'Área',   icon: '🏔️' },
    { id: 'bar',      label: 'Barras', icon: '📊' },
    { id: 'barH',     label: 'Horiz.', icon: '↔️' },
    { id: 'doughnut', label: 'Donut',  icon: '🍩' },
    { id: 'table',    label: 'Tabla',  icon: '📋' },
];

const REPORTS_META = [
    { id: 'fin-pnl',          category: 'finanzas',    label: 'P&L Mensual — Ingresos vs Egresos' },
    { id: 'fin-balance',      category: 'finanzas',    label: 'Evolución del Balance de Caja' },
    { id: 'fin-gastos-tipo',  category: 'finanzas',    label: 'Composición de Gastos por Tipo' },
    { id: 'fin-compras-prov', category: 'finanzas',    label: 'Volumen de Compras por Proveedor USA' },
    { id: 'fin-metodos',      category: 'finanzas',    label: 'Métodos de Cobro y Pago' },
    { id: 'vta-facturado',    category: 'ventas',      label: 'Facturado vs Cobrado por Mes' },
    { id: 'vta-top-clientes', category: 'ventas',      label: 'Top Clientes por Volumen' },
    { id: 'vta-top-marcas',   category: 'ventas',      label: 'Top Marcas por Revenue' },
    { id: 'vta-tipo-venta',   category: 'ventas',      label: 'Distribución por Tipo de Venta' },
    { id: 'vta-estado-orden', category: 'ventas',      label: 'Estado Actual de Órdenes' },
    { id: 'log-pipeline',     category: 'logistica',   label: 'Pipeline por Fase Logística' },
    { id: 'log-origen',       category: 'logistica',   label: 'Envíos Activos vs Entregados' },
    { id: 'log-cartera',      category: 'logistica',   label: 'Cartera Pendiente en Colombia' },
    { id: 'log-abonos-mes',   category: 'logistica',   label: 'Abonos Recibidos por Mes' },
    { id: 'cli-ranking',      category: 'clientes',    label: 'Ranking de Clientes' },
    { id: 'cli-cartera',      category: 'clientes',    label: 'Cartera por Cliente' },
    { id: 'cli-frecuencia',   category: 'clientes',    label: 'Frecuencia de Compra' },
    { id: 'ops-inventario',   category: 'operaciones', label: 'Productos por Categoría/Marca' },
    { id: 'ops-alertas',      category: 'operaciones', label: 'Alertas & Acciones Inmediatas' },
    { id: 'ops-abonos',       category: 'operaciones', label: 'Histograma de Abonos' },
];

// ─── Calculador de reportes ───────────────────────────────────────────────────
const computeReports = (filtered, raw) => {
    const { ventas, gastos, compras, abonos } = filtered;
    const { clientes, productos, logistica: rawLog } = raw;

    const facturadoPorMes = groupByMonth(ventas,  'fecha',        'valor_total_cop');
    const cobradoPorMes   = groupByMonth(ventas,  'fecha',        'abonos_acumulados');
    const gastosPorMes    = groupByMonth(gastos,  'fecha',        'valor_cop');
    const comprasPorMes   = groupByMonth(compras, 'fecha_pedido', 'costo_cop');
    const abonosPorMes    = groupByMonth(abonos,  'fecha',        'valor');

    const allMonths = [...new Set([
        ...Object.keys(facturadoPorMes),
        ...Object.keys(cobradoPorMes),
        ...Object.keys(gastosPorMes),
        ...Object.keys(comprasPorMes),
    ])].sort().slice(-12);
    const ML = allMonths.map(monthLabel);

    const clienteName = (cid) => {
        const c = clientes.find(x => x.id?.toString() === cid?.toString());
        return c?.nombre?.split(' ').slice(0, 2).join(' ') || 'Desc.';
    };

    return {
        // ══ FINANZAS ══════════════════════════════════════════════════════════
        'fin-pnl': {
            labels: ML,
            insight: `Análisis de rentabilidad mensual — Verde: ingresos cobrados · Rojo: gastos operativos · Dorado: compras USA`,
            datasets: [
                { label: 'Cobrado (Ingresos)',     data: allMonths.map(k =>  (cobradoPorMes[k]||0)),  backgroundColor: 'rgba(6,214,160,0.75)',  borderColor: C.green,  borderRadius: 5, stack: 'a' },
                { label: 'Gastos Op. (Egresos)',   data: allMonths.map(k => -(gastosPorMes[k]||0)),   backgroundColor: 'rgba(230,57,70,0.70)',  borderColor: C.red,    borderRadius: 5, stack: 'b' },
                { label: 'Compras USA (Egresos)',  data: allMonths.map(k => -(comprasPorMes[k]||0)),  backgroundColor: 'rgba(255,183,3,0.70)',  borderColor: C.orange, borderRadius: 5, stack: 'b' },
            ],
            tableColumns: ['Mes','Cobrado','Gastos Op.','Compras USA','Balance'],
            tableRows: allMonths.map(k => {
                const c = cobradoPorMes[k]||0, g = gastosPorMes[k]||0, cp = comprasPorMes[k]||0, b = c-g-cp;
                return [monthLabel(k), formatCOP(c), formatCOP(g), formatCOP(cp), { val: formatCOP(b), color: b>=0?C.green:C.red }];
            }),
            compatibleCharts: ['bar','line','area','table'],
            defaultChart: 'bar',
        },

        'fin-balance': (() => {
            let acum = 0;
            const bals = allMonths.map(k => { acum += (cobradoPorMes[k]||0)-(gastosPorMes[k]||0)-(comprasPorMes[k]||0); return acum; });
            return {
                labels: ML,
                insight: `Balance acumulado: ${formatCOP(acum)} — Verde: saldo positivo · Rojo: saldo negativo`,
                datasets: [{ label:'Balance Acumulado COP', data: bals, borderColor: acum>=0?C.green:C.red, backgroundColor: acum>=0?'rgba(6,214,160,0.15)':'rgba(230,57,70,0.15)', fill:true, tension:0.4, borderWidth:2 }],
                tableColumns: ['Mes','Balance Acumulado'],
                tableRows: allMonths.map((k,i) => [monthLabel(k), { val: formatCOP(bals[i]), color: bals[i]>=0?C.green:C.red }]),
                compatibleCharts: ['line','area','bar','table'],
                defaultChart: 'area',
            };
        })(),

        'fin-gastos-tipo': (() => {
            const map = {};
            gastos.forEach(g => { const t = g.tipo_gasto||'Sin Tipo'; map[t] = (map[t]||0) + parseFloat(g.valor_cop||g.valor_origen||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
            const total = entries.reduce((a,e)=>a+e[1], 0);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${entries.length} tipos de gasto · Total: ${formatCOP(total)} — Cada color = un tipo de gasto`,
                datasets: [{ label:'Total Gastado COP', data: entries.map(e=>e[1]), backgroundColor: C.palette, borderRadius:6 }],
                tableColumns: ['Tipo de Gasto','Total COP','% del Total'],
                tableRows: entries.map(e=>[e[0], formatCOP(e[1]), `${total?((e[1]/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['doughnut','bar','barH','table'],
                defaultChart: 'doughnut',
            };
        })(),

        'fin-compras-prov': (() => {
            const map = {};
            compras.forEach(c => { const p = c.proveedor||'Sin Proveedor'; map[p]=(map[p]||0)+parseFloat(c.costo_cop||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${compras.length} compras a ${Object.keys(map).length} proveedores — Cada barra = un proveedor`,
                datasets: [{ label:'Costo Total COP', data: entries.map(e=>e[1]), backgroundColor: C.palette, borderRadius:6 }],
                tableColumns: ['Proveedor','Total COP'],
                tableRows: entries.map(e=>[e[0], formatCOP(e[1])]),
                compatibleCharts: ['barH','bar','doughnut','table'],
                defaultChart: 'barH',
            };
        })(),

        'fin-metodos': (() => {
            const map = {};
            abonos.forEach(ab => { const m = ab.metodo_pago||'Sin Especificar'; map[m]=(map[m]||0)+parseFloat(ab.valor||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
            const total = entries.reduce((a,e)=>a+e[1],0);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${abonos.length} transacciones · Total cobrado: ${formatCOP(total)} — Cada color = método de pago`,
                datasets: [{ label:'Total COP', data: entries.map(e=>e[1]), backgroundColor: C.palette }],
                tableColumns: ['Método','Total COP','%'],
                tableRows: entries.map(e=>[e[0], formatCOP(e[1]), `${total?((e[1]/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['doughnut','bar','barH','table'],
                defaultChart: 'doughnut',
            };
        })(),

        // ══ VENTAS ════════════════════════════════════════════════════════════
        'vta-facturado': {
            labels: ML,
            insight: `Azul: monto facturado · Verde: monto cobrado — La brecha entre líneas = cartera pendiente`,
            datasets: [
                { label:'Facturado (COP)', data: allMonths.map(k=>facturadoPorMes[k]||0), borderColor:C.blue,  backgroundColor:'rgba(76,201,240,0.15)', fill:true, tension:0.4, borderWidth:2 },
                { label:'Cobrado (COP)',   data: allMonths.map(k=>cobradoPorMes[k]||0),   borderColor:C.green, backgroundColor:'rgba(6,214,160,0.15)',  fill:true, tension:0.4, borderWidth:2 },
            ],
            tableColumns: ['Mes','Facturado','Cobrado','Diferencia'],
            tableRows: allMonths.map(k => {
                const f=facturadoPorMes[k]||0, c=cobradoPorMes[k]||0, d=f-c;
                return [monthLabel(k), formatCOP(f), formatCOP(c), { val:formatCOP(d), color:d>1000?C.red:C.green }];
            }),
            compatibleCharts: ['area','line','bar','table'],
            defaultChart: 'area',
        },

        'vta-top-clientes': (() => {
            const map = {};
            ventas.forEach(v => {
                const cid = v.cliente_id?.toString(); if (!cid) return;
                if (!map[cid]) map[cid] = { f:0, c:0 };
                map[cid].f += parseFloat(v.valor_total_cop||0);
                map[cid].c += parseFloat(v.abonos_acumulados||0);
            });
            const top = Object.entries(map).sort((a,b)=>b[1].f-a[1].f).slice(0,10)
                .map(([id,v]) => ({ nombre: clienteName(id), ...v }));
            return {
                labels: top.map(t=>t.nombre),
                insight: `Azul: monto facturado al cliente · Verde: monto ya cobrado`,
                datasets: [
                    { label:'Facturado COP', data:top.map(t=>t.f), backgroundColor:'rgba(76,201,240,0.75)', borderRadius:5 },
                    { label:'Cobrado COP',   data:top.map(t=>t.c), backgroundColor:'rgba(6,214,160,0.75)',  borderRadius:5 },
                ],
                tableColumns: ['Cliente','Facturado','Cobrado','Pendiente'],
                tableRows: top.map(t => { const p=t.f-t.c; return [t.nombre, formatCOP(t.f), formatCOP(t.c), { val:formatCOP(p), color:p>1000?C.red:C.green }]; }),
                compatibleCharts: ['barH','bar','table'],
                defaultChart: 'barH',
            };
        })(),

        'vta-top-marcas': (() => {
            const map = {};
            ventas.forEach(v => {
                const p = productos.find(x=>x.id?.toString()===v.producto_id?.toString());
                const m = p?.marca||'Sin Marca';
                map[m] = (map[m]||0) + parseFloat(v.valor_total_cop||0);
            });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,10);
            const total = entries.reduce((a,e)=>a+e[1],0);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${Object.keys(map).length} marcas · Revenue total: ${formatCOP(total)} — Cada color = una marca`,
                datasets: [{ label:'Revenue COP', data:entries.map(e=>e[1]), backgroundColor:C.palette, borderRadius:6 }],
                tableColumns: ['Marca','Revenue COP','%'],
                tableRows: entries.map(e=>[e[0], formatCOP(e[1]), `${total?((e[1]/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['barH','bar','doughnut','table'],
                defaultChart: 'barH',
            };
        })(),

        'vta-tipo-venta': (() => {
            const map = {};
            ventas.forEach(v => { const t=v.tipo_venta||'Sin Tipo'; if(!map[t]) map[t]={count:0,valor:0}; map[t].count++; map[t].valor+=parseFloat(v.valor_total_cop||0); });
            const entries = Object.entries(map);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${ventas.length} ventas totales — Cada segmento = un tipo de venta`,
                datasets: [{ label:'# Ventas', data:entries.map(e=>e[1].count), backgroundColor:C.palette }],
                tableColumns: ['Tipo de Venta','# Ventas','Total Facturado'],
                tableRows: entries.map(e=>[e[0], e[1].count, formatCOP(e[1].valor)]),
                compatibleCharts: ['doughnut','bar','barH','table'],
                defaultChart: 'doughnut',
            };
        })(),

        'vta-estado-orden': (() => {
            const map = {};
            ventas.forEach(v => { const e=v.estado_orden||'Sin Estado'; if(!map[e]) map[e]={count:0,valor:0}; map[e].count++; map[e].valor+=parseFloat(v.valor_total_cop||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1].count-a[1].count);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${ventas.length} órdenes en ${entries.length} estados — Cada barra = un estado de orden`,
                datasets: [{ label:'# Órdenes', data:entries.map(e=>e[1].count), backgroundColor:C.palette, borderRadius:6 }],
                tableColumns: ['Estado Orden','# Órdenes','Valor Total'],
                tableRows: entries.map(e=>[e[0], e[1].count, formatCOP(e[1].valor)]),
                compatibleCharts: ['bar','barH','doughnut','table'],
                defaultChart: 'bar',
            };
        })(),

        // ══ LOGÍSTICA ═════════════════════════════════════════════════════════
        'log-pipeline': (() => {
            const counts = FASES.map(f => rawLog.filter(l=>mapFase(l.fase)===f).length);
            const total  = counts.reduce((a,b)=>a+b, 0);
            return {
                labels: FASES,
                insight: `${rawLog.length} envíos — 🔴 Comprado · 🔵 En Tránsito · 🟠 Bodega USA · 🟣 Aduana · 🩵 Bodega Colombia · 🟢 Entregado`,
                datasets: [{ label:'Envíos por Fase', data:counts, backgroundColor:FASE_COLORS.map(c=>c+'BB'), borderColor:FASE_COLORS, borderWidth:2, borderRadius:8 }],
                tableColumns: ['Fase','Color','# Envíos','%'],
                tableRows: FASES.map((f,i)=>[f, { val:'●', color:FASE_COLORS[i] }, counts[i], `${total?((counts[i]/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['bar','doughnut','barH','table'],
                defaultChart: 'bar',
            };
        })(),

        'log-origen': (() => {
            const activos    = rawLog.filter(l => !mapFase(l.fase).includes('Entregado'));
            const entregados = rawLog.filter(l =>  mapFase(l.fase).includes('Entregado'));
            return {
                labels: ['Activos (En Tránsito)','Entregados'],
                insight: `Naranja: envíos activos en proceso · Verde: completados y entregados`,
                datasets: [{ label:'# Envíos', data:[activos.length, entregados.length], backgroundColor:[C.orange, C.green] }],
                tableColumns: ['Estado','# Envíos'],
                tableRows: [['🟠 Activos (En Tránsito)', activos.length],['🟢 Entregados', entregados.length]],
                compatibleCharts: ['doughnut','bar','table'],
                defaultChart: 'doughnut',
            };
        })(),

        'log-cartera': (() => {
            const cartera = raw.ventas.filter(v=>parseInt(v.saldo_pendiente||0)>0 && v.estado_orden?.includes('Colombia'));
            const map = {};
            cartera.forEach(v => { const cid=v.cliente_id?.toString(); if(!cid) return; map[cid]=(map[cid]||0)+parseFloat(v.saldo_pendiente||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([id,val])=>({ nombre:clienteName(id), val }));
            return {
                labels: entries.map(e=>e.nombre),
                insight: `${cartera.length} órdenes con saldo · Cartera: ${formatCOP(entries.reduce((a,e)=>a+e.val,0))} — Cada barra = deuda de un cliente`,
                datasets: [{ label:'Saldo Pendiente COP', data:entries.map(e=>e.val), backgroundColor:C.palette.map(c=>c+'BB'), borderRadius:6 }],
                tableColumns: ['Cliente','Saldo Pendiente'],
                tableRows: entries.map(e=>[e.nombre, { val:formatCOP(e.val), color:C.red }]),
                compatibleCharts: ['barH','bar','table'],
                defaultChart: 'barH',
            };
        })(),

        'log-abonos-mes': {
            labels: ML,
            insight: `${abonos.length} abonos en el período — Azul: monto total abonado por mes`,
            datasets: [{ label:'Total Abonado COP', data:allMonths.map(k=>abonosPorMes[k]||0), backgroundColor:'rgba(76,201,240,0.7)', borderColor:C.blue, borderRadius:5 }],
            tableColumns: ['Mes','Total Abonado'],
            tableRows: allMonths.map(k=>[monthLabel(k), formatCOP(abonosPorMes[k]||0)]),
            compatibleCharts: ['bar','line','area','table'],
            defaultChart: 'bar',
        },

        // ══ CLIENTES ══════════════════════════════════════════════════════════
        'cli-ranking': (() => {
            const map = {};
            ventas.forEach(v => {
                const cid=v.cliente_id?.toString(); if(!cid) return;
                if(!map[cid]) map[cid]={f:0,c:0,n:0};
                map[cid].f+=parseFloat(v.valor_total_cop||0);
                map[cid].c+=parseFloat(v.abonos_acumulados||0);
                map[cid].n++;
            });
            const top = Object.entries(map).sort((a,b)=>b[1].f-a[1].f)
                .map(([id,v]) => ({ nombre:clienteName(id), ...v }));
            return {
                labels: top.map(t=>t.nombre),
                insight: `Azul: total facturado · Verde: total cobrado — La diferencia es la cartera pendiente`,
                datasets: [
                    { label:'Facturado COP', data:top.map(t=>t.f), backgroundColor:'rgba(76,201,240,0.75)', borderRadius:5 },
                    { label:'Cobrado COP',   data:top.map(t=>t.c), backgroundColor:'rgba(6,214,160,0.75)',  borderRadius:5 },
                ],
                tableColumns: ['Cliente','# Órdenes','Facturado','Cobrado','Pendiente'],
                tableRows: top.map(t => { const p=t.f-t.c; return [t.nombre, t.n, formatCOP(t.f), formatCOP(t.c), { val:formatCOP(p), color:p>1000?C.red:C.green }]; }),
                compatibleCharts: ['barH','bar','table'],
                defaultChart: 'barH',
            };
        })(),

        'cli-cartera': (() => {
            const map = {};
            ventas.forEach(v => {
                const saldo=parseFloat(v.saldo_pendiente||0); if(saldo<=0) return;
                const cid=v.cliente_id?.toString(); if(!cid) return;
                map[cid]=(map[cid]||0)+saldo;
            });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([id,val])=>({ nombre:clienteName(id), val }));
            const total = entries.reduce((a,e)=>a+e.val,0);
            return {
                labels: entries.map(e=>e.nombre),
                insight: `Cartera total: ${formatCOP(total)} — Cada barra/segmento = deuda de un cliente`,
                datasets: [{ label:'Cartera Pendiente COP', data:entries.map(e=>e.val), backgroundColor:C.palette.map(c=>c+'BB'), borderRadius:6 }],
                tableColumns: ['Cliente','Cartera Pendiente','%'],
                tableRows: entries.map(e=>[e.nombre, { val:formatCOP(e.val), color:C.red }, `${total?((e.val/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['barH','bar','doughnut','table'],
                defaultChart: 'barH',
            };
        })(),

        'cli-frecuencia': (() => {
            const map = {};
            ventas.forEach(v => { const cid=v.cliente_id?.toString(); if(!cid) return; map[cid]=(map[cid]||0)+1; });
            const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,12)
                .map(([id,count])=>({ nombre:clienteName(id), count }));
            return {
                labels: entries.map(e=>e.nombre),
                insight: `Clientes con más órdenes — Cada barra = número de pedidos del cliente`,
                datasets: [{ label:'# Órdenes Realizadas', data:entries.map(e=>e.count), backgroundColor:C.palette, borderRadius:6 }],
                tableColumns: ['Cliente','# Órdenes'],
                tableRows: entries.map(e=>[e.nombre, e.count]),
                compatibleCharts: ['barH','bar','table'],
                defaultChart: 'barH',
            };
        })(),

        // ══ OPERACIONES ═══════════════════════════════════════════════════════
        'ops-inventario': (() => {
            const map = {};
            productos.forEach(p => { const cat=p.categoria||p.marca||'Sin Categ.'; if(!map[cat]) map[cat]={count:0,valor:0}; map[cat].count++; map[cat].valor+=parseFloat(p.precio_cop||p.precio_venta||0); });
            const entries = Object.entries(map).sort((a,b)=>b[1].count-a[1].count);
            return {
                labels: entries.map(e=>e[0]),
                insight: `${productos.length} productos en catálogo — Cada barra/segmento = una categoría`,
                datasets: [{ label:'# Productos en Catálogo', data:entries.map(e=>e[1].count), backgroundColor:C.palette, borderRadius:6 }],
                tableColumns: ['Categoría','# Productos','Valor Est.'],
                tableRows: entries.map(e=>[e[0], e[1].count, formatCOP(e[1].valor)]),
                compatibleCharts: ['bar','barH','doughnut','table'],
                defaultChart: 'bar',
            };
        })(),

        'ops-alertas': (() => {
            const alerts = [];
            raw.ventas.filter(v=>parseInt(v.saldo_pendiente||0)>0 && v.estado_orden?.includes('Colombia')).forEach(v => {
                alerts.push({ tipo:'💸 Cartera Pendiente', detalle:`${clienteName(v.cliente_id)} — Ord #${v.id?.toString().slice(-4)}`, urgencia:'Alta', valor:parseFloat(v.saldo_pendiente||0) });
            });
            raw.ventas.filter(v=>v.tipo_venta==='Encargo' && v.estado_orden!=='Completado Local' && !rawLog.find(l=>l.venta_id?.toString()===v.id?.toString())).forEach(v => {
                alerts.push({ tipo:'📦 Sin Logística', detalle:`${clienteName(v.cliente_id)} — Ord #${v.id?.toString().slice(-4)}`, urgencia:'Media', valor:parseFloat(v.valor_total_cop||0) });
            });
            const urgMap = { Alta:0, Media:0, Baja:0 };
            alerts.forEach(a => urgMap[a.urgencia]++);
            return {
                labels: Object.keys(urgMap),
                insight: `${alerts.length} alertas activas — Rojo: urgencia Alta · Naranja: urgencia Media · Azul: urgencia Baja`,
                datasets: [{ label:'# Alertas', data:Object.values(urgMap), backgroundColor:[C.red, C.orange, C.blue] }],
                tableColumns: ['Tipo','Detalle','Urgencia','Valor COP'],
                tableRows: alerts.map(a=>[a.tipo, a.detalle, { val:a.urgencia, color:a.urgencia==='Alta'?C.red:C.orange }, formatCOP(a.valor)]),
                compatibleCharts: ['doughnut','bar','table'],
                defaultChart: 'doughnut',
            };
        })(),

        'ops-abonos': {
            labels: ML,
            insight: `${abonos.length} abonos — Violeta: total recibido por mes`,
            datasets: [{ label:'Total Abonado COP', data:allMonths.map(k=>abonosPorMes[k]||0), backgroundColor:'rgba(167,139,250,0.75)', borderColor:C.violet, borderRadius:5 }],
            tableColumns: ['Mes','Total Abonado'],
            tableRows: allMonths.map(k=>[monthLabel(k), formatCOP(abonosPorMes[k]||0)]),
            compatibleCharts: ['bar','line','area','table'],
            defaultChart: 'bar',
        },
    };
};

// ─── API GLOBAL ───────────────────────────────────────────────────────────────
window.applyDashDateFilter = () => {
    _dashStartDate = document.getElementById('dash-date-start')?.value || '';
    _dashEndDate   = document.getElementById('dash-date-end')?.value   || '';
    if (_dashCache) _renderDashboardBody();
};

window.switchDashCategory = (catId) => {
    _currentCategory = catId;
    const first = REPORTS_META.find(r => r.category === catId);
    if (first) _currentReportId = first.id;
    _currentChartType = null;
    if (_dashCache) _renderDashboardBody();
};

window.switchDashReport = (reportId) => {
    _currentReportId  = reportId;
    _currentChartType = null;
    if (_dashCache) _renderDashboardBody();
};

window.switchChartType = (type) => {
    _currentChartType = type;
    if (_dashCache) _renderChartArea();
};

window.exportDashExcel = () => {
    if (!_dashCache) return;
    const v  = applyDateFilter(_dashCache.ventas,   'fecha');
    const g  = applyDateFilter(_dashCache.gastos,   'fecha');
    const cp = applyDateFilter(_dashCache.compras,  c => c.fecha_pedido || c.fecha_registro);
    const rows = [];
    v.forEach(x  => rows.push({ Fecha:(x.fecha||'').split('T')[0],  Tipo:'Venta',      Concepto:`Orden #${x.id?.toString().slice(-4)}`, 'Total COP': parseFloat(x.valor_total_cop||0) }));
    g.forEach(x  => rows.push({ Fecha:(x.fecha||'').split('T')[0],  Tipo:'Gasto',       Concepto:x.concepto||x.tipo_gasto,              'Total COP':-parseFloat(x.valor_cop||x.valor_origen||0) }));
    cp.forEach(x => rows.push({ Fecha:(x.fecha_pedido||x.fecha_registro||'').split('T')[0], Tipo:'Compra USA', Concepto:x.proveedor, 'Total COP':-parseFloat(x.costo_cop||0) }));
    if (!rows.length) return window.showToast('Sin datos en el período', 'error');
    downloadExcel(rows, `Balance_Maestro_${new Date().toISOString().split('T')[0]}`);
};

window.exportCurrentReport = () => {
    if (!_dashCache) return;
    const rpt = _getComputedReport();
    if (!rpt || !rpt.tableRows.length) return window.showToast('Sin datos para exportar', 'error');
    const rows = rpt.tableRows.map(row => {
        const obj = {};
        rpt.tableColumns.forEach((col, i) => { const cell = row[i]; obj[col] = typeof cell==='object' ? cell.val : cell; });
        return obj;
    });
    const meta = REPORTS_META.find(r => r.id === _currentReportId);
    downloadExcel(rows, `Reporte_${(meta?.label||_currentReportId).replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().split('T')[0]}`);
};

window.switchDashView = (v) => { _currentView = v; if (_dashCache) _renderDashboardBody(); };
window.prevMonth      = () => { _monthOffset--; if (_dashCache) _renderDashboardBody(); };
window.nextMonth      = () => { if (_monthOffset < 0) { _monthOffset++; if (_dashCache) _renderDashboardBody(); } };

// ─── RENDER PRINCIPAL ─────────────────────────────────────────────────────────
export const renderDashboard = async (renderLayout, renderError) => {
    _dashRenderLayout = renderLayout;
    if (!_dashCache) {
        renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div><br>Cargando Intelligence Hub…</div>`);
        try {
            const data = await db.getDashboardStatsFull();
            if (data.error) throw new Error(data.error);
            _dashCache = data;
        } catch(e) { return renderError(e.message); }
    }
    if (!window.__themeObsCharts) {
        window.__themeObsCharts = new MutationObserver(() => { if (_dashCache) _renderDashboardBody(); });
        window.__themeObsCharts.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    }
    _renderDashboardBody();
};

// ─── Obtener reporte activo con datos filtrados ───────────────────────────────
const _getComputedReport = () => {
    if (!_dashCache) return null;
    const filtered = {
        ventas:    applyDateFilter(_dashCache.ventas,   'fecha'),
        gastos:    applyDateFilter(_dashCache.gastos,   'fecha'),
        compras:   applyDateFilter(_dashCache.compras,  c => c.fecha_pedido || c.fecha_registro),
        abonos:    applyDateFilter(_dashCache.abonos,   'fecha'),
        clientes:  _dashCache.clientes,
        productos: _dashCache.productos,
        logistica: _dashCache.logistica,
    };
    return computeReports(filtered, _dashCache)[_currentReportId] || null;
};

// ─── VISTA MENSUAL OPERATIVA ──────────────────────────────────────────────────
const _renderMonthlyView = (data) => {
    const { start, end, label: monthLabel } = getMonthRange(_monthOffset);
    const canSeeMoney = auth.canAccess('feat_money');

    const ventas  = data.ventas.filter(v  => inMonthRange(v,  'fecha',        _monthOffset));
    const gastos  = data.gastos.filter(g  => inMonthRange(g,  'fecha',        _monthOffset));
    const compras = data.compras.filter(c => inMonthRange(c, x => x.fecha_pedido||x.fecha_registro, _monthOffset));
    const abonos  = data.abonos.filter(a  => inMonthRange(a,  'fecha',        _monthOffset));

    // KPIs del mes
    const totalFacturado  = ventas.reduce((a,v)  => a+parseFloat(v.valor_total_cop||0), 0);
    const totalCobrado    = ventas.reduce((a,v)  => a+parseFloat(v.abonos_acumulados||0), 0);
    const totalGastos     = gastos.reduce((a,g)  => a+parseFloat(g.valor_cop||g.valor_origen||0), 0);
    const totalCompras    = compras.reduce((a,c) => a+parseFloat(c.costo_cop||0), 0);
    const totalEgresos    = totalGastos + totalCompras;
    const balance         = totalCobrado - totalEgresos;
    const margen          = totalCobrado > 0 ? ((balance/totalCobrado)*100).toFixed(1) : '0.0';

    // Helpers
    const clienteNombre = (cid) => {
        const c = data.clientes.find(x => x.id?.toString() === cid?.toString());
        return c?.nombre?.split(' ').slice(0,2).join(' ') || 'N/A';
    };

    // ALERTAS (sin filtro de mes — toda la cartera activa)
    const encargosCompradosIds = new Set(data.compras.map(c => c.venta_id?.toString()).filter(Boolean));
    const encargosConLogIds    = new Set(data.logistica.map(l => l.venta_id?.toString()).filter(Boolean));
    const alerts = [];

    // 1. Cartera pendiente
    data.ventas.filter(v => parseFloat(v.saldo_pendiente||0) > 0)
        .sort((a,b) => parseFloat(b.saldo_pendiente||0) - parseFloat(a.saldo_pendiente||0))
        .forEach(v => alerts.push({
            icon:'💸', tipo:'Cartera Pendiente', urgencia:'alta',
            cliente: clienteNombre(v.cliente_id), orden: v.id?.toString().slice(-4),
            valor: parseFloat(v.saldo_pendiente||0), ventaId: v.id,
        }));

    // 2. Encargos pendientes de compra USA
    data.ventas.filter(v => v.tipo_venta==='Encargo' && v.estado_orden==='Validando Compra EEUU' && !encargosCompradosIds.has(v.id?.toString()))
        .forEach(v => alerts.push({
            icon:'📦', tipo:'Compra Pendiente USA', urgencia:'alta',
            cliente: clienteNombre(v.cliente_id), orden: v.id?.toString().slice(-4),
            valor: parseFloat(v.valor_total_cop||0), ventaId: v.id,
        }));

    // 3. Encargos sin registro logístico
    data.ventas.filter(v => v.tipo_venta==='Encargo' && v.estado_orden!=='Completado Local' && !encargosConLogIds.has(v.id?.toString()))
        .forEach(v => alerts.push({
            icon:'🚚', tipo:'Sin Logística Registrada', urgencia:'media',
            cliente: clienteNombre(v.cliente_id), orden: v.id?.toString().slice(-4),
            valor: parseFloat(v.valor_total_cop||0), ventaId: v.id,
        }));

    // Agrupación de alertas por tipo
    const groupedAlerts = {};
    alerts.forEach(a => {
        if (!groupedAlerts[a.tipo]) groupedAlerts[a.tipo] = { alerts: [], icon: a.icon, urgencia: a.urgencia, sum: 0 };
        groupedAlerts[a.tipo].alerts.push(a);
        groupedAlerts[a.tipo].sum += a.valor;
    });
    const alertTypes = Object.keys(groupedAlerts);

    // PIPELINE LOGÍSTICO
    const totalLog = data.logistica.length || 1;
    const fasePipeline = FASES.map((fase, i) => {
        const count = data.logistica.filter(l => mapFase(l.fase) === fase).length;
        return { fase, color: FASE_COLORS[i], count, pct: Math.round((count/totalLog)*100) };
    });

    // Últimas ventas y abonos del mes
    const recentVentas = [...ventas].sort((a,b) => parseDate(b.fecha)-parseDate(a.fecha)).slice(0,8);
    const recentAbonos = [...abonos].sort((a,b) => parseDate(b.fecha)-parseDate(a.fecha)).slice(0,6);

    const estadoBadge = (estado='') => {
        const map = {'Completado Local':'#06D6A0','Entregado':'#06D6A0','Validando Compra EEUU':'#FFB703','En Tránsito':'#4CC9F0','Bodega Colombia':'#A78BFA'};
        const color = Object.entries(map).find(([k]) => estado.includes(k))?.[1] || '#888';
        return `<span style="font-size:0.6rem;padding:2px 7px;border-radius:8px;background:${color}22;color:${color};border:1px solid ${color}44;font-weight:700;white-space:nowrap;">${estado||'N/A'}</span>`;
    };

    const tabHeader = `
    <div class="bi-header">
        <div>
            <span class="page-eyebrow">Dashboard Operativo</span>
            <h2 class="bi-main-title">Centro de Operaciones JARAPP</h2>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <div style="display:flex;background:var(--surface-2);border-radius:12px;border:1px solid var(--border-base);padding:4px;gap:4px;">
                <button onclick="window.switchDashView('monthly')" style="padding:6px 16px;border-radius:8px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:var(--primary-red);color:#fff;">🏠 Resumen</button>
                <button onclick="window.switchDashView('explorer')" style="padding:6px 16px;border-radius:8px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;background:transparent;color:var(--text-main);opacity:0.65;">📊 Explorador</button>
            </div>
            <div style="display:flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border-base);border-radius:12px;padding:4px 12px;">
                <button onclick="window.prevMonth()" style="background:none;border:none;cursor:pointer;color:var(--text-main);font-size:1.1rem;line-height:1;padding:0 2px;">◄</button>
                <span style="font-size:0.85rem;font-weight:700;min-width:130px;text-align:center;">${monthLabel}</span>
                <button onclick="window.nextMonth()" style="background:none;border:none;cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px;${_monthOffset>=0?'opacity:0.25;pointer-events:none;':''}color:var(--text-main);">►</button>
            </div>
        </div>
    </div>`;

    _dashRenderLayout(`
    <div class="bi-hub-root">
        ${tabHeader}

        <!-- KPIs del mes -->
        ${canSeeMoney ? `
        <div class="bi-kpi-strip" style="margin-bottom:1.2rem;">
            ${[
                {label:'Facturado', val:formatCOP(totalFacturado),  icon:'📊', color:C.blue,                         sub:`${ventas.length} ventas`},
                {label:'Cobrado',   val:formatCOP(totalCobrado),    icon:'✅', color:C.green,                        sub:`${abonos.length} pagos`},
                {label:'Egresos',   val:formatCOP(totalEgresos),    icon:'📤', color:C.red,                          sub:`${gastos.length} gs + ${compras.length} cp`},
                {label:'Balance',   val:formatCOP(balance),         icon:'💰', color:balance>=0?C.green:C.red,       sub:'Cobrado − Egresos'},
                {label:'Margen',    val:`${margen}%`,               icon:'📈', color:parseFloat(margen)>0?C.cyan:C.red, sub:'del período'},
            ].map(k=>`
            <div class="bi-kpi-card" style="border-top:3px solid ${k.color};">
                <div class="bkc-icon">${k.icon}</div>
                <div class="bkc-val" style="color:${k.color};">${k.val}</div>
                <div class="bkc-label">${k.label}</div>
                <div class="bkc-sub">${k.sub}</div>
            </div>`).join('')}
        </div>` : ''}

        <!-- Alertas Agrupadas -->
        <div style="margin-bottom:1.2rem;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.7rem;">
                <span style="font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;opacity:0.5;">🚨 Alertas Activas</span>
                ${alerts.length>0?`<span style="background:var(--primary-red);color:#fff;font-size:0.62rem;font-weight:800;padding:1px 8px;border-radius:20px;">${alerts.length}</span>`:''}
            </div>
            ${alertTypes.length===0
                ? `<div style="background:rgba(6,214,160,0.08);border:1px solid rgba(6,214,160,0.25);border-radius:14px;padding:0.9rem 1.2rem;display:flex;align-items:center;gap:10px;">
                       <span style="font-size:1.3rem;">✅</span>
                       <span style="font-size:0.88rem;color:var(--success-green);font-weight:700;">Sin alertas activas — Todo al día</span>
                   </div>`
                : `<div style="display:flex;flex-direction:column;gap:0.75rem;">
                    ${alertTypes.map((tipo, idx)=> {
                        const g = groupedAlerts[tipo];
                        const count = g.alerts.length;
                        const isHigh = g.urgencia==='alta';
                        const colorMain = isHigh?'var(--primary-red)':'#FFB703';
                        const colorBg = isHigh?'rgba(230,57,70,0.1)':'rgba(255,183,3,0.15)';
                        const colorBorder = isHigh?'rgba(230,57,70,0.3)':'rgba(255,183,3,0.25)';
                        const accordionId = 'dash-acc-alert-'+idx;
                        return `
                        <div style="background:var(--surface-2);border:1px solid ${colorBorder};border-left:4px solid ${colorMain};border-radius:12px;overflow:hidden;transition:all 0.2s;">
                            <div onclick="document.getElementById('${accordionId}').style.display = document.getElementById('${accordionId}').style.display === 'none' ? 'block' : 'none'" style="display:flex;align-items:center;justify-content:space-between;padding:0.8rem 1rem;cursor:pointer;background:rgba(0,0,0,0.02);">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <span style="font-size:1.1rem;">${g.icon}</span>
                                    <span style="font-size:0.85rem;font-weight:800;color:${colorMain};">${tipo}</span>
                                    <span style="background:${colorMain};color:#fff;font-size:0.65rem;font-weight:800;padding:2px 8px;border-radius:20px;">${count}</span>
                                </div>
                                <div style="display:flex;align-items:center;gap:15px;">
                                    ${canSeeMoney ? `<span style="font-size:0.85rem;font-weight:700;opacity:0.8;">${formatCOP(g.sum)}</span>` : ''}
                                    <span style="font-size:0.75rem;opacity:0.5;">▼</span>
                                </div>
                            </div>
                            <div id="${accordionId}" style="display:none;border-top:1px solid ${colorBorder};max-height:280px;overflow-y:auto;background:var(--bg-main);">
                                ${g.alerts.map(a=>`
                                <div style="display:flex;align-items:center;justify-content:space-between;padding:0.65rem 1rem;border-bottom:1px solid var(--border-base);">
                                    <div style="display:flex;align-items:center;gap:8px;">
                                        <span style="font-size:0.68rem;opacity:0.6;font-family:monospace;font-weight:700;">#${a.orden}</span>
                                        <span style="font-size:0.75rem;font-weight:600;">${a.cliente}</span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:12px;">
                                        ${canSeeMoney ? `<span style="font-size:0.8rem;font-weight:700;color:${colorMain};">${formatCOP(a.valor)}</span>` : ''}
                                        ${a.ventaId ? `<button onclick="window.modalDetalleVentaGlobal('${a.ventaId}')" style="font-size:0.6rem;padding:4px 12px;background:${colorBg};color:${colorMain};border:none;border-radius:6px;cursor:pointer;font-weight:700;">Ver</button>` : ''}
                                    </div>
                                </div>`).join('')}
                            </div>
                        </div>`;
                    }).join('')}
                   </div>`
            }
        </div>

        <!-- Grid: Pipeline Logístico + Ventas del Mes -->
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:1.2rem;margin-bottom:1.2rem;">

            <!-- Pipeline Logístico -->
            <div style="background:var(--surface-2);border-radius:16px;border:1px solid var(--border-base);padding:1.2rem;">
                <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;opacity:0.5;margin-bottom:1rem;">🚚 Pipeline Logístico · ${data.logistica.length} envíos</div>
                <div style="display:flex;flex-direction:column;gap:0.7rem;">
                    ${fasePipeline.map(f=>`
                    <div onclick="window.openDashLogisticsPhase('${f.fase}')" style="cursor:pointer;padding:4px;border-radius:8px;transition:background 0.2s;" onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background='transparent'">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                            <span style="font-size:0.75rem;font-weight:600;color:var(--text-main);">${f.fase}</span>
                            <span style="font-size:0.78rem;font-weight:800;color:${f.color};">${f.count}</span>
                        </div>
                        <div style="height:6px;background:var(--bg-main);border-radius:10px;overflow:hidden;">
                            <div style="height:100%;width:${f.pct}%;background:${f.color};border-radius:10px;transition:width 0.5s ease;"></div>
                        </div>
                    </div>`).join('')}
                </div>
            </div>

            <!-- Ventas del Mes -->
            <div style="background:var(--surface-2);border-radius:16px;border:1px solid var(--border-base);padding:1.2rem;overflow:hidden;">
                <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;opacity:0.5;margin-bottom:1rem;">📦 Ventas del Mes · ${ventas.length} órdenes</div>
                ${recentVentas.length===0
                    ? `<div style="text-align:center;opacity:0.35;padding:2rem 0;font-size:0.85rem;">Sin ventas en este período</div>`
                    : `<div style="display:flex;flex-direction:column;gap:0.45rem;max-height:260px;overflow-y:auto;">
                        ${recentVentas.map(v=>`
                        <div style="display:flex;align-items:center;gap:8px;padding:0.5rem 0.6rem;background:var(--bg-main);border-radius:10px;border:1px solid var(--border-base);">
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <span style="font-size:0.78rem;font-weight:700;">Ord #${v.id?.toString().slice(-4)}</span>
                                    ${estadoBadge(v.estado_orden)}
                                </div>
                                <div style="font-size:0.68rem;opacity:0.55;margin-top:1px;">${clienteNombre(v.cliente_id)} · ${v.fecha||''}</div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                ${canSeeMoney?`<div style="font-size:0.8rem;font-weight:800;color:var(--info-blue);">${formatCOP(v.valor_total_cop)}</div>`:''}
                                <button onclick="window.modalDetalleVentaGlobal('${v.id}')" style="font-size:0.6rem;padding:2px 7px;border-radius:6px;border:1px solid var(--border-base);background:none;color:var(--text-main);cursor:pointer;margin-top:2px;opacity:0.7;">Ver</button>
                            </div>
                        </div>`).join('')}
                       </div>`
                }
            </div>
        </div>

        <!-- Abonos del Mes -->
        <div style="background:var(--surface-2);border-radius:16px;border:1px solid var(--border-base);padding:1.2rem;">
            <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;opacity:0.5;margin-bottom:1rem;">💳 Cobros del Mes · ${abonos.length} pagos · ${canSeeMoney?`Total: ${formatCOP(abonos.reduce((a,x)=>a+parseFloat(x.valor||0),0))}`:'---'}</div>
            ${recentAbonos.length===0
                ? `<div style="text-align:center;opacity:0.35;padding:1rem 0;font-size:0.85rem;">Sin cobros registrados en este período</div>`
                : `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                    ${recentAbonos.map(ab=>`
                    <div style="display:flex;align-items:center;gap:8px;background:rgba(6,214,160,0.06);border:1px solid rgba(6,214,160,0.2);border-radius:10px;padding:0.5rem 0.8rem;min-width:200px;flex:1;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.7rem;opacity:0.55;">#${ab.venta_id?.toString().slice(-4)} · ${ab.fecha||''}</div>
                            <div style="font-size:0.68rem;opacity:0.6;">${ab.metodo_pago||'N/A'}</div>
                        </div>
                        ${canSeeMoney?`<span style="font-size:0.88rem;font-weight:800;color:var(--success-green);white-space:nowrap;">${formatCOP(ab.valor)}</span>`:''}
                    </div>`).join('')}
                   </div>`
            }
        </div>

    </div>`);
};

// ─── RENDERIZADO COMPLETO ─────────────────────────────────────────────────────
const _renderDashboardBody = () => {

    const data = _dashCache;

    // Bifurcar vista
    if (_currentView === 'monthly') { _renderMonthlyView(data); return; }

    const ventas  = applyDateFilter(data.ventas,  'fecha');
    const gastos  = applyDateFilter(data.gastos,  'fecha');
    const compras = applyDateFilter(data.compras, c => c.fecha_pedido || c.fecha_registro);
    const abonos  = applyDateFilter(data.abonos,  'fecha');

    const totalFacturado  = ventas.reduce((a,v)=>a+(parseFloat(v.valor_total_cop)||0), 0);
    const totalCobrado    = ventas.reduce((a,v)=>a+(parseFloat(v.abonos_acumulados)||0), 0);
    const cartera         = ventas.reduce((a,v)=>a+(parseFloat(v.saldo_pendiente)||0), 0);
    const totalGastos     = gastos.reduce((a,g)=>a+(parseFloat(g.valor_cop||g.valor_origen)||0), 0);
    const totalComprasUSA = compras.reduce((a,c)=>a+(parseFloat(c.costo_cop)||0), 0);
    const totalEgresos    = totalGastos + totalComprasUSA;
    const balance         = totalCobrado - totalEgresos;
    const margen          = totalCobrado > 0 ? ((balance/totalCobrado)*100).toFixed(1) : 0;
    const logsActivos     = data.logistica.filter(l => !mapFase(l.fase).includes('Entregado'));

    const filtered    = { ventas, gastos, compras, abonos, clientes:data.clientes, productos:data.productos, logistica:data.logistica };
    const reports     = computeReports(filtered, data);
    const reportData  = reports[_currentReportId];
    const chartType   = _currentChartType || reportData?.defaultChart || 'bar';
    const catReports  = REPORTS_META.filter(r => r.category === _currentCategory);
    const reportMeta  = REPORTS_META.find(r => r.id === _currentReportId);

    _dashRenderLayout(`
    <div class="bi-hub-root">

      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div class="bi-header">
        <div>
          <span class="page-eyebrow">Intelligence Hub</span>
          <h2 class="bi-main-title">Centro de Analítica y Decisiones</h2>
          <div class="dash-refresh-info" style="margin-top:4px;">
            ${_dashStartDate || _dashEndDate
              ? `📅 ${_dashStartDate||'inicio'} → ${_dashEndDate||'hoy'}`
              : '📅 Todos los períodos'} &nbsp;·&nbsp; ${new Date().toLocaleString('es-CO',{timeStyle:'short'})}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          <!-- Tabs de vista -->
          <div style="display:flex;background:var(--surface-2);border-radius:12px;border:1px solid var(--border-base);padding:4px;gap:4px;">
            <button onclick="window.switchDashView('monthly')" style="padding:5px 14px;border-radius:8px;border:none;cursor:pointer;font-size:0.8rem;font-weight:600;background:transparent;color:var(--text-main);opacity:0.65;">🏠 Resumen</button>
            <button onclick="window.switchDashView('explorer')" style="padding:5px 14px;border-radius:8px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;background:var(--primary-red);color:#fff;">📊 Explorador</button>
          </div>
          <!-- Filtros de fecha -->
          <div class="module-filters-bar" style="margin:0;flex-wrap:wrap;">
            <div class="date-filter-wrap">
              <label>Desde</label>
              <input type="date" id="dash-date-start" class="date-filter-input" value="${_dashStartDate}">
              <label style="margin-left:5px;">Hasta</label>
              <input type="date" id="dash-date-end"   class="date-filter-input" value="${_dashEndDate}">
              <button class="btn-action" style="padding:5px 13px;font-size:0.8rem;" onclick="window.applyDashDateFilter()">🔍 Filtrar</button>
            </div>
            <button class="btn-excel" onclick="window.exportDashExcel()">📥 Balance Maestro</button>
          </div>
        </div>
      </div>

      <!-- ── KPI Strip ─────────────────────────────────────────────────────── -->
      <div class="bi-kpi-strip">
        ${[
          { label:'Facturación',   val:formatCOP(totalFacturado),  icon:'📊', color:C.blue,                     sub:`${ventas.length} ventas` },
          { label:'Total Cobrado', val:formatCOP(totalCobrado),    icon:'✅', color:C.green,                    sub:`${abonos.length} abonos` },
          { label:'Cartera',       val:formatCOP(cartera),         icon:'⚠️', color:cartera>0?C.orange:C.green, sub:'Saldo pendiente' },
          { label:'Total Egresos', val:formatCOP(totalEgresos),    icon:'📤', color:C.red,                      sub:'Gastos + Compras' },
          { label:'Balance Caja',  val:formatCOP(balance),         icon:'💰', color:balance>=0?C.green:C.red,   sub:'Cobrado − Egresos' },
          { label:'Margen Neto',   val:`${margen}%`,               icon:'📈', color:margen>0?C.cyan:C.red,      sub:`${logsActivos.length} env. activos` },
        ].filter(k => {
            if (!auth.canAccess('feat_money')) {
                // The 'ventas' role should not see money KPIs on the dashboard.
                return false; // All current dashboard KPIs are money-related
            }
            return true;
        }).map(k => `
          <div class="bi-kpi-card" style="border-top:3px solid ${k.color}; cursor:pointer; transition:transform 0.2s;" onclick="window.openDashboardKPI('${k.label}')" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='translateY(0)'">
            <div class="bkc-icon">${k.icon}</div>
            <div class="bkc-val" style="color:${k.color};">${k.val}</div>
            <div class="bkc-label">${k.label}</div>
            <div class="bkc-sub">${k.sub}</div>
          </div>`).join('')}
      </div>

      <!-- ── Category Tabs ──────────────────────────────────────────────────── -->
      <div class="bi-section-title">📊 Explorador de Reportes</div>
      <div class="bi-tabs">
        ${CATEGORIES.map(cat => `
          <button class="bi-tab ${_currentCategory===cat.id?'active':''}" onclick="window.switchDashCategory('${cat.id}')">
            ${cat.icon} <span>${cat.label}</span>
          </button>`).join('')}
      </div>

      <!-- ── Controls ───────────────────────────────────────────────────────── -->
      <div class="bi-controls">
        <div class="bi-control-group">
          <label class="bi-ctrl-label">📋 Reporte</label>
          <select class="bi-select" onchange="window.switchDashReport(this.value)">
            ${catReports.map(r => `<option value="${r.id}" ${r.id===_currentReportId?'selected':''}>${r.label}</option>`).join('')}
          </select>
        </div>
        <div class="bi-control-group">
          <label class="bi-ctrl-label">🎨 Visualizar como</label>
          <div class="bi-chart-type-strip">
            ${reportData ? reportData.compatibleCharts.map(ct => {
                const meta = CHART_TYPES.find(x => x.id === ct);
                return meta ? `<button class="bi-ct-btn ${chartType===ct?'active':''}" onclick="window.switchChartType('${ct}')">${meta.icon} ${meta.label}</button>` : '';
            }).join('') : ''}
          </div>
        </div>
        <button class="btn-excel" style="padding:7px 14px; margin-left:auto; white-space:nowrap;" onclick="window.exportCurrentReport()">📥 Exportar Vista</button>
      </div>

      <!-- ── Chart Panel ─────────────────────────────────────────────────────── -->
      <div class="bi-chart-panel">
        <div class="bi-chart-panel-header">
          <div>
            <div class="bi-chart-title">${reportMeta?.label || 'Reporte'}</div>
            <div class="bi-chart-insight">${reportData?.insight || ''}</div>
          </div>
        </div>
        <div id="bi-chart-area" class="bi-chart-area">
          ${chartType === 'table' ? _buildTable(reportData) : `<canvas id="bi-main-chart"></canvas>`}
        </div>
      </div>

    </div>
    `);

    if (chartType !== 'table') {
        setTimeout(() => _drawChart(reportData, chartType), 120);
    }
};

// ─── Re-render solo área de gráfico ──────────────────────────────────────────
const _renderChartArea = () => {
    const reportData = _getComputedReport();
    if (!reportData) return;
    const chartType  = _currentChartType || reportData.defaultChart || 'bar';

    document.querySelectorAll('.bi-ct-btn').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        btn.classList.toggle('active', onclick.includes(`'${chartType}'`));
    });

    Object.values(Chart.instances).forEach(c => c.destroy());
    const area = document.getElementById('bi-chart-area');
    if (!area) return;

    if (chartType === 'table') {
        area.innerHTML = _buildTable(reportData);
    } else {
        area.innerHTML = `<canvas id="bi-main-chart"></canvas>`;
        setTimeout(() => _drawChart(reportData, chartType), 80);
    }
};

// ─── Constructor de tabla HTML ────────────────────────────────────────────────
const _buildTable = (reportData) => {
    if (!reportData) return `<div class="bi-empty">Sin datos disponibles</div>`;
    const { tableColumns: cols, tableRows: rows } = reportData;
    return `
    <div style="overflow-x:auto; max-height:430px; overflow-y:auto;">
      <table class="bi-data-table">
        <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${!rows.length
            ? `<tr><td colspan="${cols.length}" style="text-align:center;padding:2rem;opacity:0.5;">Sin datos para el período seleccionado</td></tr>`
            : rows.map((row, ri) => `
              <tr class="${ri%2===0?'bi-tr-even':'bi-tr-odd'}">
                ${row.map(cell => {
                    if (typeof cell === 'object' && cell.val !== undefined) {
                        return `<td style="color:${cell.color};font-weight:700;">${cell.val}</td>`;
                    }
                    return `<td>${cell}</td>`;
                }).join('')}
              </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
};

// ─── Dibujado de gráfico activo ───────────────────────────────────────────────
const _drawChart = (reportData, chartType) => {
    Object.values(Chart.instances).forEach(c => c.destroy());
    const canvas = document.getElementById('bi-main-chart');
    if (!canvas || !reportData) return;

    // Guard: si no hay datos, mostrar mensaje en lugar de gráfico vacío
    const allData = (reportData.datasets || []).flatMap(d => d.data || []);
    if (allData.length === 0) {
        const area = document.getElementById('bi-chart-area');
        if (area) area.innerHTML = `<div class="bi-empty">📭 Sin datos para el período seleccionado</div>`;
        return;
    }

    const tc = getThemeColors();
    Chart.defaults.color       = tc.text;
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size   = 12;

    let type    = chartType;
    let isArea  = false;
    let isHoriz = false;
    if (chartType === 'area') { type = 'line'; isArea = true; }
    if (chartType === 'barH') { type = 'bar';  isHoriz = true; }

    const datasets = reportData.datasets.map(ds => {
        const d = { ...ds };
        if (type === 'line') {
            d.tension          = d.tension          ?? 0.4;
            d.fill             = isArea ? (d.fill !== undefined ? d.fill : true) : false;
            d.borderWidth      = d.borderWidth      ?? 2;
            d.pointRadius      = d.pointRadius      ?? 4;
            d.pointHoverRadius = 7;
        }
        return d;
    });

    const isDonut = type === 'doughnut';

    // Detectar gráfico de paleta (1 dataset, array de colores por barra)
    const isPaletteChart = !isDonut && datasets.length === 1
        && Array.isArray(datasets[0].backgroundColor)
        && datasets[0].backgroundColor.length > 1;

    // Leyenda para gráficos de paleta (color por barra)
    const renderPaletteLegend = () => {
        if (!isPaletteChart) return;
        const labels = reportData.labels || [];
        const colors = datasets[0].backgroundColor || [];
        const pills  = labels.map((lbl, i) => {
            const raw   = Array.isArray(colors) ? (colors[i] || '#999') : colors;
            const clean = raw.length > 7 ? raw.slice(0, 7) : raw;
            return `<span class="bi-legend-pill"><span class="bi-legend-dot" style="background:${clean};"></span>${lbl}</span>`;
        }).join('');
        const area = document.getElementById('bi-chart-area');
        if (area) {
            let leg = area.querySelector('.bi-palette-legend');
            if (!leg) { leg = document.createElement('div'); area.appendChild(leg); }
            leg.className   = 'bi-palette-legend';
            leg.innerHTML   = pills;
        }
    };

    // Legend: show for multi-dataset or donut; single-dataset palette uses custom
    const showLeg = datasets.length > 1 || isDonut;

    // ── Configuración de ejes separada explícitamente por orientación ────────────
    const fmtTick = (val) => typeof val === 'number' && Math.abs(val) >= 1000 ? fmtK(val) : val;
    let scalesConfig = {};

    if (!isDonut) {
        if (isHoriz) {
            // Barra HORIZONTAL: Y = categorías (labels) | X = valores numéricos
            scalesConfig = {
                y: {
                    type:  'category',
                    grid:  { display: false },
                    ticks: { color: tc.text, autoSkip: false },
                },
                x: {
                    grid:  { color: tc.grid },
                    ticks: { color: tc.text, callback: fmtTick },
                },
            };
        } else {
            // Barra VERTICAL / Línea / Área: X = categorías (labels) | Y = valores numéricos
            scalesConfig = {
                x: {
                    type:  'category',
                    grid:  { display: false },
                    ticks: { color: tc.text, maxRotation: 40, autoSkip: true },
                },
                y: {
                    grid:    { color: tc.grid },
                    stacked: datasets.some(d => d.stack),
                    ticks:   { color: tc.text, callback: fmtTick },
                },
            };
        }
    }

    new Chart(canvas, {
        type,
        data: { labels: reportData.labels, datasets },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            indexAxis:           isHoriz ? 'y' : 'x',
            interaction:         { mode: 'index', intersect: false },
            animation:           { duration: 350, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    display:  showLeg,
                    position: isDonut ? 'right' : 'top',
                    labels:   { usePointStyle:true, pointStyleWidth:10, padding:16, color:tc.text, font:{size:12} },
                },
                tooltip: {
                    backgroundColor: tc.tooltipBg,
                    titleColor:      tc.text,
                    bodyColor:       tc.subtext,
                    borderColor:     tc.grid,
                    borderWidth:     1,
                    padding:         12,
                    callbacks: {
                        label: (ctx) => {
                            const v     = ctx.raw;
                            const label = ctx.dataset.label || ctx.label || '';
                            return typeof v === 'number' && Math.abs(v) >= 100
                                ? ` ${label}: ${formatCOP(Math.abs(v))}`
                                : ` ${label}: ${v}`;
                        },
                        title: (items) => items[0]?.label || '',
                    }
                },
            },
            scales: scalesConfig,
            ...(isDonut && { cutout: '55%' }),
        }
    });

    // Agregar leyenda de colores para gráficos de paleta
    setTimeout(renderPaletteLegend, 80);
};

window.openDashboardKPI = (kpiName) => {
    if (!_dashCache) return;
    const { ventas, gastos, compras, abonos, logistica } = _dashCache;
    
    // Aplicamos filtros de fecha globales del dashboard si es necesario
    const v = applyDateFilter(ventas, 'fecha');
    const g = applyDateFilter(gastos, 'fecha');
    const cp = applyDateFilter(compras, c => c.fecha_pedido || c.fecha_registro);
    const a = applyDateFilter(abonos, 'fecha');
    
    let title = kpiName;
    let subtitle = '';
    let itemsHtml = '';
    
    if (kpiName === 'Facturación') {
        subtitle = 'Ventas facturadas en el período seleccionado.';
        const sorted = [...v].reverse();
        itemsHtml = sorted.map(x => {
            const date = (x.fecha||'').split('T')[0];
            return `
            <div class="kpi-modal-item">
                <div class="kpi-item-main">
                    <div class="kpi-item-title">Orden #${x.id?.toString().slice(-4)}</div>
                    <div class="kpi-item-subtitle">${date} | ${x.tipo_venta||'Venta'}</div>
                </div>
                <div class="kpi-item-right">
                    <div class="kpi-item-value" style="color:var(--info-blue);">${formatCOP(x.valor_total_cop)}</div>
                    <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleVentaGlobal('${x.id}');">👁️ Ver</button>
                </div>
            </div>`;
        }).join('');
    } else if (kpiName === 'Total Cobrado') {
        subtitle = 'Abonos y pagos recibidos.';
        const sorted = [...a].reverse();
        itemsHtml = sorted.map(x => {
            const date = (x.fecha||'').split('T')[0];
            return `
            <div class="kpi-modal-item">
                <div class="kpi-item-main">
                    <div class="kpi-item-title">Abono a Orden #${x.venta_id?.toString().slice(-4)}</div>
                    <div class="kpi-item-subtitle">${date} | ${x.metodo_pago||'Efectivo'}</div>
                </div>
                <div class="kpi-item-right">
                    <div class="kpi-item-value" style="color:var(--success-green);">${formatCOP(x.valor)}</div>
                </div>
            </div>`;
        }).join('');
    } else if (kpiName === 'Cartera') {
        subtitle = 'Ventas con saldo pendiente en este período.';
        const pend = v.filter(x => parseFloat(x.saldo_pendiente||0)>0).sort((a,b) => parseFloat(b.saldo_pendiente||0)-parseFloat(a.saldo_pendiente||0));
        itemsHtml = pend.map(x => {
            const date = (x.fecha||'').split('T')[0];
            return `
            <div class="kpi-modal-item">
                <div class="kpi-item-main">
                    <div class="kpi-item-title">Orden #${x.id?.toString().slice(-4)}</div>
                    <div class="kpi-item-subtitle">${date} | Total: ${formatCOP(x.valor_total_cop)}</div>
                </div>
                <div class="kpi-item-right">
                    <div class="kpi-item-value" style="color:var(--primary-red);">${formatCOP(x.saldo_pendiente)}</div>
                    <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleVentaGlobal('${x.id}');">👁️ Ver</button>
                </div>
            </div>`;
        }).join('');
    } else if (kpiName === 'Total Egresos') {
        subtitle = 'Listado combinado de Gastos Operativos y Compras a proveedores.';
        const arr = [];
        g.forEach(x => arr.push({ ...x, sysTipo:'gasto', date: (x.fecha||'').split('T')[0] }));
        cp.forEach(x => arr.push({ ...x, sysTipo:'compra', date: (x.fecha_pedido||x.fecha_registro||'').split('T')[0] }));
        arr.sort((a,b) => new Date(b.date) - new Date(a.date));
        itemsHtml = arr.map(x => {
            if (x.sysTipo === 'gasto') {
                return `
                <div class="kpi-modal-item">
                    <div class="kpi-item-main">
                        <div class="kpi-item-title">Gasto: ${x.concepto || x.tipo_gasto}</div>
                        <div class="kpi-item-subtitle">${x.date} | Gasto Operativo</div>
                    </div>
                    <div class="kpi-item-right">
                        <div class="kpi-item-value" style="color:var(--primary-red);">${formatCOP(x.valor_cop||x.valor_origen)}</div>
                    </div>
                </div>`;
            } else {
                return `
                <div class="kpi-modal-item">
                    <div class="kpi-item-main">
                        <div class="kpi-item-title">Compra: ${x.proveedor}</div>
                        <div class="kpi-item-subtitle">${x.date} | Compra USA / Prov.</div>
                    </div>
                    <div class="kpi-item-right">
                        <div class="kpi-item-value" style="color:var(--warning-orange);">${formatCOP(x.costo_cop)}</div>
                    </div>
                </div>`;
            }
        }).join('');
    } else if (kpiName === 'Balance Caja' || kpiName === 'Margen Neto') {
        itemsHtml = `<div style="padding:2rem;text-align:center;opacity:0.6;">El ${kpiName} es un cálculo derivado. Consulta los reportes gráficos de Finanzas para más detalle.</div>`;
    }
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

window.openDashLogisticsPhase = (fase) => {
    if (!_dashCache) return;
    const items = _dashCache.logistica.filter(l => mapFase(l.fase) === fase);
    const ventasMap = {};
    _dashCache.ventas.forEach(v => ventasMap[v.id?.toString()] = v);

    const title = `Logística: ${fase}`;
    const subtitle = `${items.length} órdenes en esta fase.`;
    
    if(items.length === 0) {
        window.openKPIDetailModal(title, subtitle, `<div style="padding:2rem;text-align:center;opacity:0.5;font-weight:600;">No hay envíos en la fase ${fase}</div>`);
        return;
    }

    const itemsHtml = items.map(l => {
        const v = ventasMap[l.venta_id?.toString()] || {};
        const c = _dashCache.clientes.find(x => x.id?.toString() === v.cliente_id?.toString());
        const clienteNom = c?.nombre || 'N/A';
        const date = (l.updated_at||l.fecha_registro||'').split('T')[0];
        
        return `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">Orden #${v.id?.toString().slice(-4) || 'N/A'} - ${clienteNom.split(' ').slice(0,2).join(' ')}</div>
                <div class="kpi-item-subtitle">Actualizado: ${date} | Venta: ${formatCOP(v.valor_total_cop)}</div>
            </div>
            <div class="kpi-item-right">
                <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleVentaGlobal('${v.id}');">👁️ Ver</button>
            </div>
        </div>`;
    }).join('');
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};
