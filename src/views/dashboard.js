import { db } from '../db.js';
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
let _currentChartType = null; // null = usar default del reporte

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
const fmtAuto = (v) => typeof v === 'number' && Math.abs(v) >= 100 ? fmtK(v) : String(v);

// ─── Logística fases ──────────────────────────────────────────────────────────
const FASES       = ['Comprado','En Tránsito','Bodega USA','Aduana','Bodega Colombia','Entregado'];
const FASE_COLORS = [C.red, C.blue, C.orange, C.violet, C.cyan, C.green];
const mapFase = (f) => {
    if (!f) return FASES[0];
    if (f.includes('1.') || f.includes('Comprado'))  return FASES[0];
    if (f.includes('2.') || f.includes('Tienda'))    return FASES[1];
    if (f.includes('3.') || f.includes('Bodega USA') || f.includes('Miami')) return FASES[2];
    if (f.includes('4.') || f.includes('Internacional') || f.includes('Aduana')) return FASES[3];
    if (f.includes('5.') || f.includes('Bodega Colombia')) return FASES[4];
    if (f.includes('6.') || f.includes('Entregado')) return FASES[5];
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

// ─── Metadata de categorías y tipos de gráfico ────────────────────────────────
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

    // helper: group by field
    const groupBy = (arr, field, valField = null) => {
        const map = {};
        arr.forEach(item => {
            const k = item[field] || 'Sin Especificar';
            if (!map[k]) map[k] = { count: 0, valor: 0 };
            map[k].count++;
            if (valField) map[k].valor += parseFloat(item[valField] || 0);
        });
        return Object.entries(map).sort((a, b) => b[1].valor - a[1].valor);
    };

    const clienteName = (cid) => {
        const c = clientes.find(x => x.id?.toString() === cid?.toString());
        return c?.nombre?.split(' ').slice(0, 2).join(' ') || 'Desc.';
    };

    return {

        // ══ FINANZAS ══════════════════════════════════════════════════════════
        'fin-pnl': {
            labels: ML,
            insight: `Análisis de rentabilidad mensual`,
            datasets: [
                { label: 'Cobrado',     data: allMonths.map(k =>  (cobradoPorMes[k]||0)),  backgroundColor: 'rgba(6,214,160,0.75)',  borderColor: C.green,  borderRadius: 5, stack: 'a' },
                { label: 'Gastos Op.',  data: allMonths.map(k => -(gastosPorMes[k]||0)),   backgroundColor: 'rgba(230,57,70,0.70)',  borderColor: C.red,    borderRadius: 5, stack: 'b' },
                { label: 'Compras USA', data: allMonths.map(k => -(comprasPorMes[k]||0)),  backgroundColor: 'rgba(255,183,3,0.70)',  borderColor: C.orange, borderRadius: 5, stack: 'b' },
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
                insight: `Balance acumulado: ${formatCOP(acum)}`,
                datasets: [{ label:'Balance Acumulado', data: bals, borderColor: acum>=0?C.green:C.red, backgroundColor: acum>=0?'rgba(6,214,160,0.15)':'rgba(230,57,70,0.15)', fill:true, tension:0.4, borderWidth:2 }],
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
                insight: `${entries.length} tipos de gasto · Total: ${formatCOP(total)}`,
                datasets: [{ label:'Total COP', data: entries.map(e=>e[1]), backgroundColor: C.palette, borderRadius:6 }],
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
                insight: `${compras.length} compras a ${Object.keys(map).length} proveedores`,
                datasets: [{ label:'Costo COP', data: entries.map(e=>e[1]), backgroundColor: C.palette, borderRadius:6 }],
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
                insight: `${abonos.length} transacciones · ${formatCOP(total)}`,
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
            insight: `Brecha entre facturado y cobrado = cartera pendiente`,
            datasets: [
                { label:'Facturado', data: allMonths.map(k=>facturadoPorMes[k]||0), borderColor:C.blue,  backgroundColor:'rgba(76,201,240,0.15)', fill:true, tension:0.4, borderWidth:2 },
                { label:'Cobrado',   data: allMonths.map(k=>cobradoPorMes[k]||0),   borderColor:C.green, backgroundColor:'rgba(6,214,160,0.15)',  fill:true, tension:0.4, borderWidth:2 },
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
                insight: `Top ${top.length} clientes por volumen facturado`,
                datasets: [
                    { label:'Facturado', data:top.map(t=>t.f), backgroundColor:'rgba(76,201,240,0.75)', borderRadius:5 },
                    { label:'Cobrado',   data:top.map(t=>t.c), backgroundColor:'rgba(6,214,160,0.75)',  borderRadius:5 },
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
                insight: `${Object.keys(map).length} marcas · Revenue total: ${formatCOP(total)}`,
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
                insight: `${ventas.length} ventas en el período`,
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
                insight: `${ventas.length} órdenes en ${entries.length} estados`,
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
                insight: `${rawLog.length} envíos registrados`,
                datasets: [{ label:'Envíos', data:counts, backgroundColor:FASE_COLORS.map(c=>c+'BB'), borderColor:FASE_COLORS, borderWidth:2, borderRadius:8 }],
                tableColumns: ['Fase','# Envíos','%'],
                tableRows: FASES.map((f,i)=>[f, counts[i], `${total?((counts[i]/total)*100).toFixed(1):0}%`]),
                compatibleCharts: ['bar','doughnut','barH','table'],
                defaultChart: 'bar',
            };
        })(),

        'log-origen': (() => {
            const activos    = rawLog.filter(l => !mapFase(l.fase).includes('Entregado'));
            const entregados = rawLog.filter(l =>  mapFase(l.fase).includes('Entregado'));
            return {
                labels: ['Activos','Entregados'],
                insight: `${activos.length} en tránsito · ${entregados.length} completados`,
                datasets: [{ label:'Envíos', data:[activos.length, entregados.length], backgroundColor:[C.orange, C.green] }],
                tableColumns: ['Estado','# Envíos'],
                tableRows: [['Activos (En Tránsito)', activos.length],['Entregados', entregados.length]],
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
                insight: `${cartera.length} órdenes con saldo · Cartera: ${formatCOP(entries.reduce((a,e)=>a+e.val,0))}`,
                datasets: [{ label:'Saldo Pendiente', data:entries.map(e=>e.val), backgroundColor:C.palette.map(c=>c+'BB'), borderRadius:6 }],
                tableColumns: ['Cliente','Saldo Pendiente'],
                tableRows: entries.map(e=>[e.nombre, { val:formatCOP(e.val), color:C.red }]),
                compatibleCharts: ['barH','bar','table'],
                defaultChart: 'barH',
            };
        })(),

        'log-abonos-mes': {
            labels: ML,
            insight: `${abonos.length} abonos en el período`,
            datasets: [{ label:'Total Abonado', data:allMonths.map(k=>abonosPorMes[k]||0), backgroundColor:'rgba(76,201,240,0.7)', borderColor:C.blue, borderRadius:5 }],
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
                insight: `${clientes.length} clientes registrados`,
                datasets: [
                    { label:'Facturado', data:top.map(t=>t.f), backgroundColor:'rgba(76,201,240,0.75)', borderRadius:5 },
                    { label:'Cobrado',   data:top.map(t=>t.c), backgroundColor:'rgba(6,214,160,0.75)',  borderRadius:5 },
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
                insight: `Cartera total: ${formatCOP(total)}`,
                datasets: [{ label:'Cartera COP', data:entries.map(e=>e.val), backgroundColor:C.palette.map(c=>c+'BB'), borderRadius:6 }],
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
                insight: `Clientes con más órdenes en el período`,
                datasets: [{ label:'# Órdenes', data:entries.map(e=>e.count), backgroundColor:C.palette, borderRadius:6 }],
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
                insight: `${productos.length} productos en catálogo`,
                datasets: [{ label:'# Productos', data:entries.map(e=>e[1].count), backgroundColor:C.palette, borderRadius:6 }],
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
                insight: `${alerts.length} alertas activas que requieren atención`,
                datasets: [{ label:'# Alertas', data:Object.values(urgMap), backgroundColor:[C.red, C.orange, C.blue] }],
                tableColumns: ['Tipo','Detalle','Urgencia','Valor COP'],
                tableRows: alerts.map(a=>[a.tipo, a.detalle, { val:a.urgencia, color:a.urgencia==='Alta'?C.red:C.orange }, formatCOP(a.valor)]),
                compatibleCharts: ['table','doughnut','bar'],
                defaultChart: 'table',
            };
        })(),

        'ops-abonos': {
            labels: ML,
            insight: `${abonos.length} abonos · Total: ${formatCOP(abonos.reduce((a,b)=>a+parseFloat(b.valor||0),0))}`,
            datasets: [{ label:'Total Abonado', data:allMonths.map(k=>abonosPorMes[k]||0), backgroundColor:'rgba(167,139,250,0.75)', borderColor:C.violet, borderRadius:5 }],
            tableColumns: ['Mes','Total Abonado'],
            tableRows: allMonths.map(k=>[monthLabel(k), formatCOP(abonosPorMes[k]||0)]),
            compatibleCharts: ['bar','line','area','table'],
            defaultChart: 'bar',
        },
    };
};

// ─── API GLOBAL (botones en el DOM) ───────────────────────────────────────────
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
    v.forEach(x  => rows.push({ Fecha:(x.fecha||'').split('T')[0],  Tipo:'Venta',       Concepto:`Orden #${x.id?.toString().slice(-4)}`,  'Total COP': parseFloat(x.valor_total_cop||0) }));
    g.forEach(x  => rows.push({ Fecha:(x.fecha||'').split('T')[0],  Tipo:'Gasto',        Concepto:x.concepto||x.tipo_gasto,               'Total COP':-parseFloat(x.valor_cop||x.valor_origen||0) }));
    cp.forEach(x => rows.push({ Fecha:(x.fecha_pedido||x.fecha_registro||'').split('T')[0], Tipo:'Compra USA', Concepto:x.proveedor, 'Total COP':-parseFloat(x.costo_cop||0) }));
    if (!rows.length) return alert('Sin datos en el período');
    downloadExcel(rows, `Balance_Maestro_${new Date().toISOString().split('T')[0]}`);
};

window.exportCurrentReport = () => {
    if (!_dashCache) return;
    const rpt = _getComputedReport();
    if (!rpt || !rpt.tableRows.length) return alert('Sin datos para exportar');
    const rows = rpt.tableRows.map(row => {
        const obj = {};
        rpt.tableColumns.forEach((col, i) => { const cell = row[i]; obj[col] = typeof cell==='object' ? cell.val : cell; });
        return obj;
    });
    const meta = REPORTS_META.find(r => r.id === _currentReportId);
    downloadExcel(rows, `Reporte_${(meta?.label||_currentReportId).replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().split('T')[0]}`);
};

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

// ─── RENDERIZADO COMPLETO ─────────────────────────────────────────────────────
const _renderDashboardBody = () => {
    const data = _dashCache;
    const ventas  = applyDateFilter(data.ventas,  'fecha');
    const gastos  = applyDateFilter(data.gastos,  'fecha');
    const compras = applyDateFilter(data.compras, c => c.fecha_pedido || c.fecha_registro);
    const abonos  = applyDateFilter(data.abonos,  'fecha');

    // KPIs globales
    const totalFacturado  = ventas.reduce((a,v)=>a+(parseFloat(v.valor_total_cop)||0), 0);
    const totalCobrado    = ventas.reduce((a,v)=>a+(parseFloat(v.abonos_acumulados)||0), 0);
    const cartera         = ventas.reduce((a,v)=>a+(parseFloat(v.saldo_pendiente)||0), 0);
    const totalGastos     = gastos.reduce((a,g)=>a+(parseFloat(g.valor_cop||g.valor_origen)||0), 0);
    const totalComprasUSA = compras.reduce((a,c)=>a+(parseFloat(c.costo_cop)||0), 0);
    const totalEgresos    = totalGastos + totalComprasUSA;
    const balance         = totalCobrado - totalEgresos;
    const margen          = totalCobrado > 0 ? ((balance/totalCobrado)*100).toFixed(1) : 0;
    const logsActivos     = data.logistica.filter(l => !mapFase(l.fase).includes('Entregado'));

    // Reporte activo
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
        <div class="module-filters-bar" style="margin:0; flex-wrap:wrap;">
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

      <!-- ── KPI Strip ─────────────────────────────────────────────────────── -->
      <div class="bi-kpi-strip">
        ${[
          { label:'Facturación',   val:formatCOP(totalFacturado),  icon:'📊', color:C.blue,                       sub:`${ventas.length} ventas` },
          { label:'Total Cobrado', val:formatCOP(totalCobrado),    icon:'✅', color:C.green,                      sub:`${abonos.length} abonos` },
          { label:'Cartera',       val:formatCOP(cartera),         icon:'⚠️', color:cartera>0?C.orange:C.green,   sub:'Saldo pendiente' },
          { label:'Total Egresos', val:formatCOP(totalEgresos),    icon:'📤', color:C.red,                        sub:'Gastos + Compras' },
          { label:'Balance Caja',  val:formatCOP(balance),         icon:'💰', color:balance>=0?C.green:C.red,     sub:'Cobrado − Egresos' },
          { label:'Margen Neto',   val:`${margen}%`,               icon:'📈', color:margen>0?C.cyan:C.red,        sub:`${logsActivos.length} env. activos` },
        ].map(k => `
          <div class="bi-kpi-card" style="border-top:3px solid ${k.color};">
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

// ─── Re-render sólo el área del gráfico ──────────────────────────────────────
const _renderChartArea = () => {
    const reportData = _getComputedReport();
    if (!reportData) return;
    const chartType  = _currentChartType || reportData.defaultChart || 'bar';

    // Actualizar botones activos
    document.querySelectorAll('.bi-ct-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(CHART_TYPES.find(x=>x.id===chartType)?.icon || ''));
    });
    // Más robusto: re-check por onclick
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

    const tc    = getThemeColors();
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
            d.tension       = d.tension       ?? 0.4;
            d.fill          = isArea ? (d.fill !== undefined ? d.fill : true) : false;
            d.borderWidth   = d.borderWidth   ?? 2;
            d.pointRadius   = d.pointRadius   ?? 4;
            d.pointHoverRadius = 7;
        }
        return d;
    });

    const isDonut = type === 'doughnut';
    const showLeg = datasets.length > 1 || isDonut;

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
                            const v = ctx.raw;
                            return typeof v === 'number' && Math.abs(v) >= 100
                                ? ` ${ctx.dataset.label}: ${formatCOP(Math.abs(v))}`
                                : ` ${ctx.dataset.label}: ${v}`;
                        }
                    }
                },
            },
            scales: isDonut ? {} : {
                x: {
                    grid:  { display: !isHoriz, color: tc.grid },
                    ticks: { color: tc.text, maxRotation: isHoriz ? 0 : 40,
                             callback: isHoriz ? function(val) { return fmtAuto(this.getLabelForValue(val)); } : undefined }
                },
                y: {
                    grid:    { color: isHoriz ? 'transparent' : tc.grid },
                    stacked: datasets.some(d => d.stack),
                    ticks:   { color: tc.text,
                               callback: isHoriz ? undefined : function(val) { return typeof val==='number' && Math.abs(val)>=1000 ? fmtK(val) : val; } }
                },
            },
            ...(isDonut && { cutout: '55%' }),
        }
    });
};
