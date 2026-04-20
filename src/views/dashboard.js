import { db } from '../db.js';
import { formatCOP, downloadExcel } from '../utils.js';
import Chart from 'chart.js/auto';

// ─── Colores del tema por defecto ─────────────────────────────────────────────
const C = {
    red:    '#E63946', redDim: 'rgba(230,57,70,0.15)',
    green:  '#06D6A0', greenDim: 'rgba(6,214,160,0.15)',
    blue:   '#4CC9F0', blueDim: 'rgba(76,201,240,0.15)',
    orange: '#FFB703', orangeDim: 'rgba(255,183,3,0.15)',
    violet: '#A78BFA', violetDim: 'rgba(167,139,250,0.15)',
    pink:   '#F472B6', pinkDim: 'rgba(244,114,182,0.15)',
    cyan:   '#2DD4BF',
};

// ─── Controladores Temporales y Caché ────────────────────────────────────────
let _dashStartDate = '';
let _dashEndDate = '';
let _dashCache = null;
let _dashRenderLayout = null;
let _dashRenderError = null;

// ─── Normaliza fecha a objeto Date ────────────────────────────────────────────
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
    const _e = _dashEndDate ? new Date(_dashEndDate + 'T23:59:59') : null;
    return arr.filter(item => {
        const dStr = typeof dateField === 'function' ? dateField(item) : item[dateField];
        const vd = parseDate(dStr);
        if (!vd || isNaN(vd)) return true;
        vd.setHours(12,0,0,0);
        if (_s && vd < _s) return false;
        if (_e && vd > _e) return false;
        return true;
    });
};

const monthKey = (d) => {
    if (!d || isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
};

const monthLabel = (key) => {
    if (!key) return '?';
    const [y, m] = key.split('-');
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${months[+m-1]} ${y.slice(-2)}`;
};

// ─── FASES LOGÍSTICAS ────────────────────────────────────────────────────────
const FASES = [
    "Comprado",
    "En Tránsito",
    "Bodega USA",
    "Aduana",
    "Bodega Colombia",
    "Entregado"
];

const mapFase = (faseStr) => {
    if (!faseStr) return FASES[0];
    if (faseStr.includes('1.') || faseStr.includes('Comprado')) return FASES[0];
    if (faseStr.includes('2.') || faseStr.includes('Tienda')) return FASES[1];
    if (faseStr.includes('3.') || faseStr.includes('Bodega USA') || faseStr.includes('Estados Unidos') || faseStr.includes('Miami')) return FASES[2];
    if (faseStr.includes('4.') || faseStr.includes('Internacional') || faseStr.includes('Aduana')) return FASES[3];
    if (faseStr.includes('5.') || faseStr.includes('Bodega Colombia')) return FASES[4];
    if (faseStr.includes('6.') || faseStr.includes('Entregado')) return FASES[5];
    return FASES[0];
};

// ─── Agrupación por mes de un array con campo `fecha` y `valor` ──────────────
const groupByMonth = (arr, campoFecha, campoValor) => {
    const map = {};
    arr.forEach(item => {
        const d = parseDate(item[campoFecha]);
        const k = monthKey(d);
        if (!k) return;
        if (!map[k]) map[k] = 0;
        map[k] += parseFloat(item[campoValor] || 0);
    });
    return map;
};

// ─── RENDER PRINCIPAL ─────────────────────────────────────────────────────────
export const renderDashboard = async (renderLayout, renderError) => {
    _dashRenderLayout = renderLayout;
    _dashRenderError = renderError;

    if (!_dashCache) {
        renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div><br>Cargando Analytics Pro…</div>`);
        try {
            const data = await db.getDashboardStatsFull();
            if (data.error) throw new Error(data.error);
            _dashCache = data;
        } catch (e) {
            return renderError(e.message);
        }
    }
    _renderDashboardBody();
};

window.applyDashDateFilter = () => {
    _dashStartDate = document.getElementById('dash-date-start')?.value || '';
    _dashEndDate = document.getElementById('dash-date-end')?.value || '';
    if (_dashCache) _renderDashboardBody();
};

window.exportDashExcel = () => {
    if (!_dashCache) return;
    const ventas = applyDateFilter(_dashCache.ventas, 'fecha');
    const gastos = applyDateFilter(_dashCache.gastos, 'fecha');
    const compras = applyDateFilter(_dashCache.compras, c => c.fecha_pedido || c.fecha_registro);
    let master = [];
    ventas.forEach(v => master.push({'Fecha':(v.fecha||'').split('T')[0],'Tipo':'Venta/Ingreso','Concepto':`Orden #${v.id?.toString().slice(-4)}`,'Total (COP)':parseFloat(v.valor_total_cop||0)}));
    gastos.forEach(g => master.push({'Fecha':(g.fecha||'').split('T')[0],'Tipo':`Gasto Operativo: ${g.tipo_gasto}`,'Concepto':g.concepto,'Total (COP)':-parseFloat(g.valor_cop||g.valor_origen||0)}));
    compras.forEach(c => master.push({'Fecha':(c.fecha_pedido||c.fecha_registro||'').split('T')[0],'Tipo':'Compra USA','Concepto':c.proveedor,'Total (COP)':-parseFloat(c.costo_cop||0)}));
    if (master.length===0) return alert('No hay datos en fechas seleccionadas');
    downloadExcel(master, `Balance_Maestro_${new Date().toISOString().split('T')[0]}`);
};

const _renderDashboardBody = () => {
    const data = _dashCache;
    const clientes = data.clientes;
    const productos = data.productos;
    const logistica = data.logistica;
    
    // Aplicamos Filtros de fecha sobre la base de datos
    const ventas = applyDateFilter(data.ventas, 'fecha');
    const gastos = applyDateFilter(data.gastos, 'fecha');
    const compras = applyDateFilter(data.compras, c => c.fecha_pedido || c.fecha_registro);
    const abonos = applyDateFilter(data.abonos, 'fecha');

    // ── KPIs Globales ──────────────────────────────────────────────────────
    const totalFacturado  = ventas.reduce((a, v) => a + (parseFloat(v.valor_total_cop)||0), 0);
    const totalCobrado    = ventas.reduce((a, v) => a + (parseFloat(v.abonos_acumulados)||0), 0);
        const cartera         = ventas.reduce((a, v) => a + (parseFloat(v.saldo_pendiente)||0), 0);
        const totalGastos     = gastos.reduce((a, g) => a + (parseFloat(g.valor_cop||g.valor_origen)||0), 0);
        const totalComprasUSA = compras.reduce((a, c) => a + (parseFloat(c.costo_cop)||0), 0);
        const totalEgresos    = totalGastos + totalComprasUSA;
        const balance         = totalCobrado - totalEgresos;
        const margen          = totalCobrado > 0 ? ((balance / totalCobrado) * 100).toFixed(1) : 0;

        // ── Alertas operativas ─────────────────────────────────────────────────
        const ventasConSaldo  = ventas.filter(v => parseInt(v.saldo_pendiente||0) > 0 && v.estado_orden?.includes('Colombia'));
        const logsActivos     = logistica.filter(l => !mapFase(l.fase).includes('Entregado'));
        const ventasSinLog    = ventas.filter(v => v.tipo_venta === 'Encargo' && v.estado_orden !== 'Completado Local' && !logistica.find(l => l.venta_id?.toString() === v.id?.toString()));
        
        // ── Por mes: Facturado vs Cobrado ──────────────────────────────────────
        const facturadoPorMes = groupByMonth(ventas, 'fecha', 'valor_total_cop');
        const cobradoPorMes   = groupByMonth(ventas, 'fecha', 'abonos_acumulados');
        const gastosPorMes    = groupByMonth(gastos, 'fecha', 'valor_cop');
        const comprasPorMes   = groupByMonth(compras, 'fecha_pedido', 'costo_cop');

        const allMonths = [...new Set([
            ...Object.keys(facturadoPorMes),
            ...Object.keys(cobradoPorMes),
            ...Object.keys(gastosPorMes),
        ])].sort().slice(-8); // últimos 8 meses

        // ── Top Clientes ───────────────────────────────────────────────────────
        const cliMap = {};
        ventas.forEach(v => {
            const cid = v.cliente_id?.toString();
            if (!cid) return;
            if (!cliMap[cid]) cliMap[cid] = 0;
            cliMap[cid] += parseFloat(v.valor_total_cop||0);
        });
        const topClientes = Object.entries(cliMap)
            .sort((a,b) => b[1]-a[1]).slice(0,7)
            .map(([id, val]) => {
                const c = clientes.find(x => x.id?.toString() === id);
                return { nombre: c ? c.nombre.split(' ')[0] : 'Desc.', valor: val };
            });

        // ── Top Marcas ─────────────────────────────────────────────────────────
        const marcaMap = {};
        ventas.forEach(v => {
            const p = productos.find(x => x.id?.toString() === v.producto_id?.toString());
            const marca = p?.marca || 'Sin Marca';
            if (!marcaMap[marca]) marcaMap[marca] = 0;
            marcaMap[marca] += parseFloat(v.valor_total_cop||0);
        });
        const topMarcas = Object.entries(marcaMap)
            .sort((a,b) => b[1]-a[1]).slice(0,7);

        // ── Métodos de pago ────────────────────────────────────────────────────
        const metodosMap = {};
        abonos.forEach(ab => {
            const m = ab.metodo_pago || 'Sin Especificar';
            if (!metodosMap[m]) metodosMap[m] = 0;
            metodosMap[m] += parseFloat(ab.valor||0);
        });

        // ── Fases logísticas ───────────────────────────────────────────────────
        const faseCounts = FASES.map(f => logistica.filter(l => mapFase(l.fase) === f).length);
        const faseColors = [C.red, C.blue, C.orange, C.violet, C.cyan, C.green];

        // ── Mejor mes en facturación ───────────────────────────────────────────
        const mejorMesKey  = Object.entries(facturadoPorMes).sort((a,b) => b[1]-a[1])[0];
        const mejorMes     = mejorMesKey ? `${monthLabel(mejorMesKey[0])}: ${formatCOP(mejorMesKey[1])}` : 'N/A';
        const mejorCliente = topClientes[0] ? `${topClientes[0].nombre}: ${formatCOP(topClientes[0].valor)}` : 'N/A';
        const mejorMarca   = topMarcas[0] ? `${topMarcas[0][0]}: ${formatCOP(topMarcas[0][1])}` : 'N/A';

        // ── HTML ───────────────────────────────────────────────────────────────
        _dashRenderLayout(`
        <div class="dash-pro-root">

            <!-- ── Eyebrow ─────────────────────────────────────────────────── -->
            <div class="dash-eyebrow" style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:15px; margin-bottom:1.5rem;">
                <div>
                    <span class="page-eyebrow">Analytics Pro</span>
                    <h2 class="dash-title" style="margin:0;">Centro de Inteligencia de Negocios</h2>
                    <div class="dash-refresh-info" style="margin-top:5px;">Datos en tiempo real · ${new Date().toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})}</div>
                </div>
                <div class="module-filters-bar" style="margin:0;">
                    <div class="date-filter-wrap">
                        <label>Desde</label>
                        <input type="date" id="dash-date-start" class="date-filter-input" value="${_dashStartDate}">
                        <label style="margin-left:5px;">Hasta</label>
                        <input type="date" id="dash-date-end" class="date-filter-input" value="${_dashEndDate}">
                        <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applyDashDateFilter()">Filtrar</button>
                    </div>
                    <button class="btn-excel" onclick="window.exportDashExcel()">📥 Excel Balance Maestro</button>
                </div>
            </div>

            <!-- ── FILA 1: 6 KPI Hero ──────────────────────────────────────── -->
            <div class="dash-kpi-hero-grid">
                ${[
                    { label:'Facturación Total',  val: formatCOP(totalFacturado),  icon:'📊', color:C.blue,   trend:`${ventas.length} ventas` },
                    { label:'Total Cobrado',       val: formatCOP(totalCobrado),    icon:'✅', color:C.green,  trend:`${abonos.length} abonos` },
                    { label:'Cartera Pendiente',   val: formatCOP(cartera),         icon:'⚠️', color:cartera>0?C.orange:C.green, trend:`${ventasConSaldo.length} clientes deben` },
                    { label:'Total Egresos',       val: formatCOP(totalEgresos),    icon:'🔴', color:C.red,    trend:`Gastos + Compras USA` },
                    { label:'Balance de Caja',     val: formatCOP(balance),         icon:'💰', color:balance>=0?C.green:C.red, trend:`Cobrado menos Egresos` },
                    { label:'Margen Operativo',    val: `${margen}%`,               icon:'📈', color:margen>0?C.cyan:C.red, trend:`Sobre total cobrado` },
                ].map(k => `
                <div class="dash-kpi-hero" style="border-top:3px solid ${k.color};">
                    <div class="dkh-icon">${k.icon}</div>
                    <div class="dkh-val" style="color:${k.color};">${k.val}</div>
                    <div class="dkh-label">${k.label}</div>
                    <div class="dkh-trend">${k.trend}</div>
                </div>`).join('')}
            </div>

            <!-- ── FILA 2: 3 Gráficos ─────────────────────────────────────── -->
            <div class="dash-grid-3">
                <!-- Área: Facturado vs Cobrado -->
                <div class="dash-chart-card dash-span-2">
                    <div class="dcc-header">
                        <span class="dcc-title">📈 Facturado vs Cobrado por Mes</span>
                        <span class="dcc-insight">Brecha = Cartera pendiente acumulada</span>
                    </div>
                    <div class="dcc-body" style="height:220px;"><canvas id="ch-area"></canvas></div>
                </div>
                <!-- Donut Logística -->
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">🚚 Estado Logístico</span>
                        <span class="dcc-insight">${logsActivos.length} envíos activos</span>
                    </div>
                    <div class="dcc-body" style="height:220px;position:relative;display:flex;justify-content:center;"><canvas id="ch-log-donut"></canvas></div>
                    <div class="dash-fase-strip">
                        ${FASES.map((f,i) => `<span class="dash-fase-pill" style="border-color:${faseColors[i]};color:${faseColors[i]};">${faseCounts[i]} ${f.replace('Bodega ','')}</span>`).join('')}
                    </div>
                </div>
            </div>

            <!-- ── FILA 3: P&L + Métodos pago ─────────────────────────────── -->
            <div class="dash-grid-2">
                <!-- Stacked Bar P&L -->
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">💹 P&L Mensual — Ingresos vs Egresos</span>
                        <span class="dcc-insight">Meses en positivo = rentables</span>
                    </div>
                    <div class="dcc-body" style="height:220px;"><canvas id="ch-pnl"></canvas></div>
                </div>
                <!-- Pie métodos de pago -->
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">💳 Métodos de Pago</span>
                        <span class="dcc-insight">${abonos.length} transacciones</span>
                    </div>
                    <div class="dcc-body" style="height:220px;position:relative;display:flex;justify-content:center;"><canvas id="ch-metodos"></canvas></div>
                </div>
            </div>

            <!-- ── FILA 4: Top Clientes + Marcas ──────────────────────────── -->
            <div class="dash-grid-2">
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">👑 Top Clientes por Volumen</span>
                        <span class="dcc-insight">${mejorCliente}</span>
                    </div>
                    <div class="dcc-body" style="height:240px;"><canvas id="ch-clientes"></canvas></div>
                </div>
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">🏷️ Top Marcas por Revenue</span>
                        <span class="dcc-insight">${mejorMarca}</span>
                    </div>
                    <div class="dcc-body" style="height:240px;"><canvas id="ch-marcas"></canvas></div>
                </div>
            </div>

            <!-- ── FILA 5: Pipeline Logístico + Alertas ────────────────────── -->
            <div class="dash-grid-2">
                <!-- Pipeline Logístico -->
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">🗺️ Pipeline Logístico — Fases</span>
                        <span class="dcc-insight">${logistica.length} envíos registrados</span>
                    </div>
                    <div class="dcc-body" style="height:240px;"><canvas id="ch-fases-bar"></canvas></div>
                </div>
                <!-- Alertas Operativas -->
                <div class="dash-chart-card">
                    <div class="dcc-header">
                        <span class="dcc-title">🔔 Alertas & Acciones Inmediatas</span>
                        <span class="dcc-insight">${ventasConSaldo.length + ventasSinLog.length} alertas activas</span>
                    </div>
                    <div class="dcc-body dash-alerts-body">
                        ${ventasConSaldo.length > 0 ? ventasConSaldo.slice(0,4).map(v => {
                            const cli = clientes.find(c => c.id?.toString() === v.cliente_id?.toString());
                            return `<div class="dash-alert-item" style="border-left-color:${C.red};">
                                <span class="dai-icon">💸</span>
                                <div class="dai-body">
                                    <strong>${cli?.nombre?.split(' ')[0] || 'Cliente'}</strong> debe <strong style="color:${C.red};">${formatCOP(parseInt(v.saldo_pendiente||0))}</strong>
                                    <div class="dai-sub">Orden #${v.id?.toString().slice(-4)} · ${v.estado_orden||''}</div>
                                </div>
                            </div>`;
                        }).join('') : ''}
                        ${ventasSinLog.slice(0,3).map(v => {
                            const cli = clientes.find(c => c.id?.toString() === v.cliente_id?.toString());
                            return `<div class="dash-alert-item" style="border-left-color:${C.orange};">
                                <span class="dai-icon">📦</span>
                                <div class="dai-body">
                                    <strong>${cli?.nombre?.split(' ')[0] || 'Encargo'}</strong> sin registro logístico
                                    <div class="dai-sub">Orden #${v.id?.toString().slice(-4)}</div>
                                </div>
                            </div>`;
                        }).join('')}
                        <div class="dash-insights-box">
                            <div class="dib-title">💡 Insights Clave</div>
                            <div class="dib-row"><span>🏆 Mejor mes:</span><strong>${mejorMes}</strong></div>
                            <div class="dib-row"><span>👤 Mejor cliente:</span><strong>${mejorCliente}</strong></div>
                            <div class="dib-row"><span>🏷️ Mejor marca:</span><strong>${mejorMarca}</strong></div>
                            <div class="dib-row"><span>📦 Logística activa:</span><strong>${logsActivos.length} envíos</strong></div>
                            <div class="dib-row"><span>🏪 Clientes totales:</span><strong>${clientes.length}</strong></div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
        `);

        // Inicializar gráficos con leve delay para que el DOM esté listo
        setTimeout(() => initCharts({ allMonths, facturadoPorMes, cobradoPorMes, gastosPorMes, comprasPorMes, topClientes, topMarcas, metodosMap, faseCounts, faseColors }), 180);
};

// ─── INICIALIZACIÓN DE CHARTS ─────────────────────────────────────────────────
const initCharts = (d) => {
    // 1. Limpiar charts previos para evitar solapamientos y memory leaks
    for (let id in Chart.instances) {
        Chart.instances[id].destroy();
    }

    // 2. Definir colores iniciales detectando el theme actual
    const getThemeColors = () => {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        return {
            text: isLight ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            gridObj: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.15)'
        };
    };

    let { text: textColor, gridObj: grid } = getThemeColors();

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size = 11;

    // 3. Listener global para redibujar si el user aprieta el botón de tema
    if (!window.__themeObsCharts) {
        window.__themeObsCharts = new MutationObserver(() => {
            if (_dashCache) _renderDashboardBody(); // Full re-render handles ALL styling cleanly
        });
        window.__themeObsCharts.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    const noAxes = { display: false };
    const noLegend = { display: false };

    const fmtM  = (v) => `$${(v/1000000).toFixed(1)}M`;
    const fmtK  = (v) => v >= 1000000 ? fmtM(v) : `$${(v/1000).toFixed(0)}k`;
    const monthLabels = d.allMonths.map(monthLabel);

    // ── 1. ÁREA: Facturado vs Cobrado ─────────────────────────────────────────
    const ctx1 = document.getElementById('ch-area');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Facturado',
                        data: d.allMonths.map(k => d.facturadoPorMes[k]||0),
                        borderColor: C.red, backgroundColor: 'rgba(230,57,70,0.12)',
                        fill: true, tension: 0.4, borderWidth: 2,
                        pointBackgroundColor: C.red, pointRadius: 4,
                    },
                    {
                        label: 'Cobrado',
                        data: d.allMonths.map(k => d.cobradoPorMes[k]||0),
                        borderColor: C.green, backgroundColor: 'rgba(6,214,160,0.12)',
                        fill: true, tension: 0.4, borderWidth: 2,
                        pointBackgroundColor: C.green, pointRadius: 4,
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, pointStyleWidth: 8, padding: 16 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtM(ctx.raw)}` } }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: grid }, ticks: { callback: fmtM } }
                }
            }
        });
    }

    // ── 2. DONUT: Estado Logístico ────────────────────────────────────────────
    const ctx2 = document.getElementById('ch-log-donut');
    if (ctx2) {
        const active = d.faseCounts.reduce((a,b)=>a+b,0);
        new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: FASES,
                datasets: [{ data: d.faseCounts, backgroundColor: d.faseColors, borderWidth: 2, borderColor: 'transparent', hoverOffset: 8 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '65%',
                plugins: {
                    legend: { position: 'right', labels: { usePointStyle: true, pointStyleWidth: 8, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${active?((ctx.raw/active)*100).toFixed(0):0}%)` } }
                }
            }
        });
    }

    // ── 3. STACKED BAR: P&L ────────────────────────────────────────────────────
    const ctx3 = document.getElementById('ch-pnl');
    if (ctx3) {
        new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Cobrado',
                        data: d.allMonths.map(k => d.cobradoPorMes[k]||0),
                        backgroundColor: 'rgba(6,214,160,0.7)', borderRadius: 4,
                        stack: 'ingresos',
                    },
                    {
                        label: 'Gastos Op',
                        data: d.allMonths.map(k => -(d.gastosPorMes[k]||0)),
                        backgroundColor: 'rgba(230,57,70,0.65)', borderRadius: 4,
                        stack: 'egresos',
                    },
                    {
                        label: 'Compras USA',
                        data: d.allMonths.map(k => -(d.comprasPorMes[k]||0)),
                        backgroundColor: 'rgba(255,183,3,0.65)', borderRadius: 4,
                        stack: 'egresos',
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, pointStyleWidth: 8, padding: 14 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtM(Math.abs(ctx.raw))}` } }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: grid }, ticks: { callback: v => fmtM(Math.abs(v)) }, stacked: true }
                }
            }
        });
    }

    // ── 4. PIE: Métodos de pago ────────────────────────────────────────────────
    const ctx4 = document.getElementById('ch-metodos');
    if (ctx4) {
        const colorsMetodos = [C.blue, C.violet, C.green, C.orange, C.pink, C.cyan];
        const metKeys = Object.keys(d.metodosMap);
        new Chart(ctx4, {
            type: 'doughnut',
            data: {
                labels: metKeys,
                datasets: [{ data: metKeys.map(k => d.metodosMap[k]), backgroundColor: colorsMetodos, borderWidth: 2, borderColor: 'transparent', hoverOffset: 6 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: {
                    legend: { position: 'right', labels: { usePointStyle: true, pointStyleWidth: 8, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtM(ctx.raw)}` } }
                }
            }
        });
    }

    // ── 5. BAR HORIZ: Top Clientes ────────────────────────────────────────────
    const ctx5 = document.getElementById('ch-clientes');
    if (ctx5) {
        const palette = [C.red,C.orange,C.cyan,C.violet,C.pink,C.blue,C.green];
        new Chart(ctx5, {
            type: 'bar',
            data: {
                labels: d.topClientes.map(c => c.nombre),
                datasets: [{ label: 'Facturado COP', data: d.topClientes.map(c => c.valor), backgroundColor: palette, borderRadius: 6 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: noLegend, tooltip: { callbacks: { label: ctx => ` ${fmtM(ctx.raw)}` } } },
                scales: {
                    x: { grid: { color: grid }, ticks: { callback: fmtK } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    // ── 6. BAR HORIZ: Top Marcas ─────────────────────────────────────────────
    const ctx6 = document.getElementById('ch-marcas');
    if (ctx6) {
        const palette = [C.violet,C.pink,C.cyan,C.orange,C.red,C.blue,C.green];
        new Chart(ctx6, {
            type: 'bar',
            data: {
                labels: d.topMarcas.map(m => m[0]),
                datasets: [{ label: 'Revenue COP', data: d.topMarcas.map(m => m[1]), backgroundColor: palette, borderRadius: 6 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: noLegend, tooltip: { callbacks: { label: ctx => ` ${fmtM(ctx.raw)}` } } },
                scales: {
                    x: { grid: { color: grid }, ticks: { callback: fmtK } },
                    y: { grid: { display: false } }
                }
            }
        });
    }

    // ── 7. BAR VERT: Pipeline Fases logísticas ────────────────────────────────
    const ctx7 = document.getElementById('ch-fases-bar');
    if (ctx7) {
        new Chart(ctx7, {
            type: 'bar',
            data: {
                labels: FASES,
                datasets: [{
                    label: 'Envíos',
                    data: d.faseCounts,
                    backgroundColor: d.faseColors.map(c => c + 'BB'),
                    borderColor: d.faseColors,
                    borderWidth: 2,
                    borderRadius: 8,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: noLegend },
                scales: {
                    x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
                    y: { grid: { color: grid }, ticks: { stepSize: 1 } }
                }
            }
        });
    }
};
