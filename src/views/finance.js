import { db } from '../db.js';
import { formatCOP, formatUSD, renderError, showToast, getLogisticaFase, getLogisticaColor, buildComprobanteUploadHTML, attachComprobanteInput, uploadImageToSupabase, downloadExcel } from '../utils.js';
import { TablaPro } from '../components/tabla-pro.js';

// ─── Cached data ───────────────────────────────────────────────────────────────
let _finCache = null;
let _finMetodosPagoCache = [];
let _finRenderLayout = null;
let _finNavigateTo = null;
let _finActiveMain = 'ingresos'; // 'ingresos' | 'egresos'
let _finActiveIngView = 'tabla';
let _finActiveEgrView = 'tabla';
let _finStartDate = '';
let _finEndDate = '';
let localGastosFiltered = [];
let localVentasFiltered = [];
let localComprasFiltered = [];

// ─── Date normalizer (DD/MM/YYYY → YYYY-MM-DD) ────────────────────────────────
const normDate = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return s.split('T')[0].split(' ')[0];
};
const labelDate = (s) => {
    const n = normDate(s);
    if (!n) return 'Sin fecha';
    try {
        const d = new Date(n + 'T12:00:00');
        if (isNaN(d)) return s;
        return d.toLocaleDateString('es-CO', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    } catch { return s; }
};
// ─── TablaPro: helpers de filtro (rango de fechas → whitelist de id, ya que
// Ventas.fecha no siempre está en un formato parseable por SQL .gte()/.lte()) ──
const _dateInSharedRange = (fechaRaw) => {
    if (!_finStartDate && !_finEndDate) return true;
    const vd = new Date(normDate(fechaRaw) + 'T12:00:00');
    if (isNaN(vd)) return true;
    const s = _finStartDate ? new Date(_finStartDate + 'T00:00:00') : null;
    const e = _finEndDate ? new Date(_finEndDate + 'T23:59:59') : null;
    if (s && vd < s) return false;
    if (e && vd > e) return false;
    return true;
};
const _finVentasIdFiltro = () => {
    if (!_finStartDate && !_finEndDate) return null;
    return (_finCache?.ventas || []).filter(v => _dateInSharedRange(v.fecha)).map(v => v.id?.toString());
};
const _finEgresosIdFiltro = () => {
    if (!_finStartDate && !_finEndDate) return null;
    const gastoIds  = (_finCache?.gastos || []).filter(g => _dateInSharedRange(g.fecha)).map(g => g.id?.toString());
    const compraIds = (_finCache?.compras || [])
        .filter(c => parseFloat(c.costo_cop || 0) > 0 && _dateInSharedRange(c.fecha_pedido || c.fecha_registro))
        .map(c => c.id?.toString());
    return [...gastoIds, ...compraIds];
};
const _idFiltroExtra = (ids) => (ids ? { id: { op: 'in', value: ids.length ? ids : ['__none__'] } } : {});

// ganancia real estimada a partir de una fila de ventas_finanzas_view (ya trae compra_costo_cop)
const _calcGananciaReal = (row) => {
    const valVenta   = parseFloat(row.valor_total_cop || 0);
    const gastoComp  = parseFloat(row.compra_costo_cop || 0);
    const envioInt   = parseFloat(row.valor_envio_internacional || 0);
    const envioCol   = parseFloat(row.envio_colombia || 0);
    const extraItems = (() => { try { return JSON.parse(row.items_rentabilidad || '[]'); } catch { return []; } })();
    const extras     = extraItems.reduce((a, x) => a + (parseFloat(x.valor) || 0), 0);
    return valVenta - gastoComp - envioInt - envioCol - extras;
};

// ─── KPI Strip ─────────────────────────────────────────────────────────────────
const renderFinKPI = (ventas, gastos, compras) => {
    const totalAbonos    = ventas.reduce((a,v) => a + (parseFloat(v.abonos_acumulados)||0), 0);
    const totalVentas    = ventas.reduce((a,v) => a + (parseFloat(v.valor_total_cop)||0), 0);
    const totalGastosOp  = gastos.reduce((a,g) => a + (parseFloat(g.valor_cop)||0), 0);
    const totalComprasUSA= compras.reduce((a,c) => a + (parseFloat(c.costo_cop)||0), 0);
    const totalEgresos   = totalGastosOp + totalComprasUSA;
    const balance        = totalAbonos - totalEgresos;
    const margen         = totalAbonos > 0 ? ((balance / totalAbonos) * 100).toFixed(1) : 0;
    const cartera        = ventas.reduce((a,v) => a + (parseFloat(v.saldo_pendiente)||0), 0);

    const kpis = [
        { icon: '✅', value: formatCOP(totalAbonos),  label: 'Ingresos Reales',      color: 'var(--success-green)' },
        { icon: '📊', value: formatCOP(totalVentas),   label: 'Facturación Total',    color: 'var(--info-blue)' },
        { icon: '🔴', value: formatCOP(totalEgresos),  label: 'Total Egresos',        color: 'var(--primary-red)' },
        { icon: '💰', value: formatCOP(balance),       label: 'Balance de Caja',      color: balance >= 0 ? 'var(--success-green)' : 'var(--primary-red)' },
        { icon: '📈', value: `${margen}%`,             label: 'Margen Operativo',     color: margen > 0 ? 'var(--brand-green)' : 'var(--primary-red)' },
        { icon: '⚠️', value: formatCOP(cartera),       label: 'Cartera Pendiente',    color: cartera > 0 ? 'var(--warning-orange)' : 'var(--success-green)' },
    ];
    return `
    <div class="kpi-strip" style="grid-template-columns:repeat(6,1fr);">
        ${kpis.map(k => `
        <div class="kpi-strip-card" onclick="window.openFinanceKPI('${k.label}')">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
};

window.openFinanceKPI = (kpiName) => {
    let title = kpiName;
    let subtitle = '';
    let itemsHtml = '';
    
    if (kpiName === 'Ingresos Reales') {
        subtitle = 'Ventas con abonos registrados en el período.';
        const ventasConAbonos = localVentasFiltered.filter(v => parseFloat(v.abonos_acumulados||0) > 0);
        ventasConAbonos.sort((a,b) => parseFloat(b.abonos_acumulados||0) - parseFloat(a.abonos_acumulados||0));
        
        itemsHtml = ventasConAbonos.map(v => `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">Orden #${v.id?.toString().slice(-4)}</div>
                <div class="kpi-item-subtitle">${normDate(v.fecha)||'Sin fecha'} | ${v.tipo_venta||'Venta'}</div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--success-green);">${formatCOP(v.abonos_acumulados)}</div>
                <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleVentaGlobal('${v.id}');" style="margin-top:4px;">👁️ Ver</button>
            </div>
        </div>`).join('');
    } else if (kpiName === 'Facturación Total') {
        subtitle = 'Todas las ventas registradas en el período.';
        const sorted = [...localVentasFiltered].sort((a,b) => parseFloat(b.valor_total_cop||0) - parseFloat(a.valor_total_cop||0));
        
        itemsHtml = sorted.map(v => `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">Orden #${v.id?.toString().slice(-4)}</div>
                <div class="kpi-item-subtitle">${normDate(v.fecha)||'Sin fecha'} | ${v.tipo_venta||'Venta'}</div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--info-blue);">${formatCOP(v.valor_total_cop)}</div>
                <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleVentaGlobal('${v.id}');" style="margin-top:4px;">👁️ Ver</button>
            </div>
        </div>`).join('');
    } else if (kpiName === 'Cartera Pendiente') {
        subtitle = 'Ventas con saldos por cobrar.';
        const pending = localVentasFiltered.filter(v => parseFloat(v.saldo_pendiente||0) > 0);
        pending.sort((a,b) => parseFloat(b.saldo_pendiente||0) - parseFloat(a.saldo_pendiente||0));
        
        itemsHtml = pending.map(v => `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">Orden #${v.id?.toString().slice(-4)}</div>
                <div class="kpi-item-subtitle">${normDate(v.fecha)||'Sin fecha'} | Total: ${formatCOP(v.valor_total_cop)}</div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--primary-red);">${formatCOP(v.saldo_pendiente)}</div>
                <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalAbono('${v.id}', ${v.saldo_pendiente});" style="margin-top:4px;">💳 Abonar</button>
            </div>
        </div>`).join('');
    } else if (kpiName === 'Total Egresos') {
        subtitle = 'Gastos operativos y compras de inventario.';
        const combined = [
            ...localGastosFiltered.map(g => ({...g, sysTipo:'Gasto', val:parseFloat(g.valor_cop||0), date:normDate(g.fecha)})),
            ...localComprasFiltered.map(c => ({...c, sysTipo:'Compra USA', val:parseFloat(c.costo_cop||0), date:normDate(c.fecha_pedido||c.fecha_registro)}))
        ].sort((a,b) => new Date(b.date||0) - new Date(a.date||0));
        
        itemsHtml = combined.map(x => `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">${x.sysTipo === 'Gasto' ? (x.concepto||x.tipo_gasto) : x.proveedor}</div>
                <div class="kpi-item-subtitle">${x.date||'Sin fecha'} | ${x.sysTipo}</div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--primary-red);">${formatCOP(x.val)}</div>
            </div>
        </div>`).join('');
    } else if (kpiName === 'Balance de Caja' || kpiName === 'Margen Operativo') {
        itemsHtml = `<div style="padding:2rem;text-align:center;opacity:0.6;">Este es un KPI calculado en base al total de Ingresos Reales y Total Egresos.</div>`;
    }
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

// ─── INGRESOS: Vista Tabla (TablaPro sobre ventas_con_cliente) ────────────────
const renderIngTabla = () => `
    <div class="purchase-view-panel">
        <div id="fin-ingresos-tabla-container"></div>
    </div>`;

function _montarTablaIngresos() {
    new TablaPro({
        containerId: 'fin-ingresos-tabla-container',
        tabla: 'ventas_con_cliente',
        supabase: db.client,
        filtrosExtra: _idFiltroExtra(_finVentasIdFiltro()),
        searchColumns: ['cliente_nombre', 'producto_nombre', 'estado_orden', 'tipo_venta'],
        columnas: [
            { key: 'fecha', label: 'Fecha', width: '120px', render: (v) => normDate(v) || 'N/A' },
            { key: 'tipo_venta', label: 'Referencia / Tipo', width: '190px',
              render: (v, row) => `<div class="cell-title">Orden #${row.id.toString().slice(-4)}</div><span class="cell-subtitle">${v||'Venta'}</span>` },
            { key: '_fase', label: 'Fase Logística', width: '200px', sortable: false,
              render: (_v, row) => {
                  const fase = getLogisticaFase(row.id, _finCache.logistica, row.estado_orden||'Sin registro');
                  return `<span class="status-badge" style="background:${getLogisticaColor(fase)};">${fase}</span>`;
              } },
            { key: 'abonos_acumulados', label: 'Abonos Recibidos', width: '170px',
              render: (v) => `<span class="cell-price" style="color:var(--success-green);">${formatCOP(parseFloat(v||0))}</span>` },
            { key: 'valor_total_cop', label: 'Valor Total', width: '165px',
              render: (v) => `<span class="cell-price">${formatCOP(parseFloat(v||0))}</span>` },
            { key: 'saldo_pendiente', label: 'Saldo Pendiente', width: '160px',
              render: (v, row) => {
                  const totalCop = parseFloat(row.valor_total_cop||0);
                  const saldo    = parseFloat(v||0);
                  const isPaid   = totalCop > 0 && saldo <= 0;
                  return `<span style="font-size:0.75rem;padding:5px 14px;border-radius:15px;font-weight:800;
                        color:${isPaid?'var(--success-green)':'var(--primary-red)'};
                        border:1px solid ${isPaid?'rgba(6,214,160,0.3)':'rgba(217,16,16,0.3)'};
                        background:${isPaid?'rgba(6,214,160,0.05)':'rgba(217,16,16,0.07)'};
                        display:inline-block;white-space:nowrap;">${isPaid ? '✔ Pagado' : formatCOP(saldo)}</span>`;
              } },
            { key: 'comprobante_url', label: 'Comprobante', width: '110px', sortable: false,
              render: (_v, row) => {
                  const compUrl = row.comprobante_ultimo_abono || row.comprobante_url || '';
                  return compUrl ? `<button class="comp-thumb-btn" onclick="window.openComprobanteViewer('${compUrl}');event.stopPropagation();">🧾 Ver</button>` : '<span style="opacity:0.25;font-size:0.75rem;">—</span>';
              } },
        ],
        onRowClick: (row) => window.modalDetalleVentaGlobal(row.id),
        altura: '60vh',
    }).mount();
}

// ─── INGRESOS: Vista Saldos Pendientes ────────────────────────────────────────
const renderIngSaldos = (ventas) => {
    const pending = ventas.filter(v => parseFloat(v.saldo_pendiente||0) > 0)
                          .sort((a,b) => parseFloat(b.saldo_pendiente) - parseFloat(a.saldo_pendiente));
    if (pending.length === 0) {
        return `<div class="purchase-view-panel"><div style="text-align:center; padding:4rem; opacity:0.5;">🎉 Sin cartera pendiente. Todas las ventas están pagadas.</div></div>`;
    }
    return `
    <div class="purchase-view-panel">
        <div style="margin-bottom:1rem; padding:1rem 1.4rem; background:rgba(217,16,16,0.07); border:1px solid var(--brand-magenta); border-radius:var(--radius); display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.2rem;">⚠️</span>
            <span style="font-size:0.9rem; color:var(--primary-red); font-weight:700;">${pending.length} venta(s) con saldo pendiente · Total cartera: <strong>${formatCOP(pending.reduce((a,v)=>a+parseFloat(v.saldo_pendiente||0),0))}</strong></span>
        </div>
        ${pending.map(v => {
            const saldo = parseFloat(v.saldo_pendiente||0);
            const total = parseFloat(v.valor_total_cop||0);
            const pct   = total > 0 ? Math.round((saldo/total)*100) : 0;
            return `
            <div class="purchase-group-card" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" style="cursor:default;">
                    <h3>📄 Orden #${v.id.toString().slice(-4)} <span style="font-size:0.75rem; font-weight:500; opacity:0.6;">${normDate(v.fecha)||''}</span></h3>
                    <div class="purchase-group-meta">
                        <span>Total: ${formatCOP(total)}</span>
                        <strong style="color:var(--primary-red);">Debe: ${formatCOP(saldo)}</strong>
                        <span style="font-size:0.72rem; opacity:0.6;">${pct}% pendiente</span>
                        <button class="btn-primary" style="font-size:0.72rem; padding:6px 12px;"
                            onclick="window.modalAbono('${v.id}', ${saldo})">+ Abono</button>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap">
                    <div class="purchase-group-bar" style="width:${100-pct}%; background:var(--success-green);"></div>
                </div>
            </div>`;
        }).join('')}
    </div>`;
};

// ─── INGRESOS: Timeline ────────────────────────────────────────────────────────
const renderIngTimeline = (ventas, logistica) => {
    const sorted = [...ventas].sort((a,b) => {
        return new Date(normDate(b.fecha)||0) - new Date(normDate(a.fecha)||0);
    });
    const groups = {};
    sorted.forEach(v => {
        const k = normDate(v.fecha) || 'sin-fecha';
        if (!groups[k]) groups[k] = [];
        groups[k].push(v);
    });
    return `
    <div class="purchase-view-panel">
        <div class="purchase-timeline">
            ${Object.entries(groups).map(([dk, items]) => `
            <div class="timeline-day-group">
                <div class="timeline-day-label">${labelDate(dk)}</div>
                ${items.map(v => {
                    const fase = getLogisticaFase(v.id, logistica, v.estado_orden||'Sin registro');
                    const col  = getLogisticaColor(fase);
                    const saldo = parseFloat(v.saldo_pendiente||0);
                    return `
                    <div class="timeline-item">
                        <span class="timeline-item-id">#${v.id.toString().slice(-4)}</span>
                        <div class="timeline-item-main">
                            <div class="timeline-item-prov">${v.tipo_venta||'Venta'}</div>
                            <div class="timeline-item-sub">${fase}</div>
                        </div>
                        <span class="status-badge" style="background:${col}; font-size:0.6rem;">${fase}</span>
                        <span class="timeline-item-price">${formatCOP(v.valor_total_cop||0)}</span>
                        ${saldo > 0 ? `<span style="font-size:0.7rem; color:var(--primary-red); font-weight:700;">−${formatCOP(saldo)}</span>` : '<span style="font-size:0.7rem; color:var(--success-green);">✔</span>'}
                    </div>`;
                }).join('')}
            </div>`).join('')}
        </div>
    </div>`;
};

// ─── EGRESOS: Vista Tabla (TablaPro sobre egresos_view) ───────────────────────
const renderEgrTabla = () => `
    <div class="purchase-view-panel">
        <div id="fin-egresos-tabla-container"></div>
    </div>`;

function _montarTablaEgresos() {
    new TablaPro({
        containerId: 'fin-egresos-tabla-container',
        tabla: 'egresos_view',
        supabase: db.client,
        filtrosExtra: _idFiltroExtra(_finEgresosIdFiltro()),
        searchColumns: ['descripcion', 'tipo', 'numero_factura'],
        columnas: [
            { key: 'fecha', label: 'Fecha Factura', width: '110px', render: (v) => normDate(v) || 'N/A' },
            { key: 'numero_factura', label: 'Nº Factura', width: '120px',
              render: (v) => v ? `<span style="font-family:monospace;font-size:0.8rem;opacity:0.75;">${v}</span>` : '—' },
            { key: 'tipo', label: 'Concepto / Tipo', width: '230px',
              render: (v, row) => `<div class="cell-title" style="color:${row.es_compra?'var(--info-blue)':'inherit'};max-width:200px;">${v}</div><span class="cell-subtitle">${row.es_compra ? `Tienda: ${row.descripcion||''}` : (row.descripcion||'Sin descripción')}</span>` },
            { key: 'moneda', label: 'Moneda', width: '90px',
              render: (v, row) => `<span style="font-size:0.7rem;padding:4px 10px;border-radius:15px;font-weight:700;background:var(--glass-bg);
                    color:${v==='USD'?'var(--success-green)':'var(--info-blue)'};
                    border:1px solid ${v==='USD'?'rgba(6,214,160,0.3)':'rgba(0,180,216,0.3)'};display:inline-block;">${v||'COP'}</span>` },
            { key: 'valor_origen', label: 'Valor Origen', width: '150px',
              render: (v, row) => `<span style="font-family:monospace;font-size:0.85rem;">${row.moneda==='USD' ? formatUSD(parseFloat(v||0)) : formatCOP(parseFloat(v||0))}</span>` },
            { key: 'trm', label: 'TRM', width: '100px',
              render: (v) => v ? `<span style="opacity:0.6;font-size:0.85rem;">$${v}</span>` : '<span style="opacity:0.3">—</span>' },
            { key: 'total_cop', label: 'Total COP', width: '160px',
              render: (v) => `<span class="cell-price" style="color:var(--primary-red);">${formatCOP(parseFloat(v||0))}</span>` },
        ],
        acciones: (row) => {
            const compBtn = row.comprobante_url ? `<button class="comp-thumb-btn" style="padding:4px 8px;font-size:0.75rem;" onclick="window.openComprobanteViewer('${row.comprobante_url}');event.stopPropagation();">🧾</button>` : '';
            const verBtn  = row.es_compra && row.venta_id ? `<button class="btn-action" style="font-size:0.7rem;padding:4px 8px;" onclick="window.modalDetalleVentaGlobal('${row.venta_id}');event.stopPropagation();">👁️ Ver</button>` : '';
            return (compBtn + verBtn) || '<span style="opacity:0.25;font-size:0.75rem;">—</span>';
        },
        altura: '60vh',
    }).mount();
}

// ─── EGRESOS: Por Tipo de Gasto ────────────────────────────────────────────────
const renderEgrPorTipo = (gastos, compras) => {
    const groups = {};
    gastos.forEach(g => {
        const k = g.tipo_gasto || 'Sin Categoría';
        if (!groups[k]) groups[k] = { items:[], total:0, color:'var(--info-blue)' };
        groups[k].items.push({...g, es_compra:false});
        groups[k].total += parseFloat(g.valor_cop||0);
    });
    if (compras.filter(c=>parseFloat(c.costo_cop||0)>0).length > 0) {
        groups['Compras USA'] = { items: compras.filter(c=>parseFloat(c.costo_cop||0)>0).map(c=>({...c,es_compra:true})), total: compras.reduce((a,c)=>a+parseFloat(c.costo_cop||0),0), color:'var(--primary-red)' };
    }
    const totalGlobal = Object.values(groups).reduce((a,g)=>a+g.total,0);
    const sorted = Object.entries(groups).sort((a,b)=>b[1].total-a[1].total);

    return `
    <div class="purchase-view-panel">
        ${sorted.map(([tipo, g], idx) => {
            const pct = totalGlobal > 0 ? Math.round((g.total/totalGlobal)*100) : 0;
            const cid = `fin-egr-grp-${idx}`;
            return `
            <div class="purchase-group-card" id="${cid}">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cid}')">
                    <h3>💸 ${tipo}</h3>
                    <div class="purchase-group-meta">
                        <span>${g.items.length} registro(s)</span>
                        <strong>${formatCOP(g.total)}</strong>
                        <span style="font-size:0.72rem; opacity:0.6;">${pct}% del egreso</span>
                        <span class="purchase-group-toggle">▼</span>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap"><div class="purchase-group-bar" style="width:${pct}%;"></div></div>
                <div class="purchase-group-body">
                    ${g.items.map(item => {
                        const val = parseFloat(item.valor_cop||item.costo_cop||0);
                        const desc = item.es_compra ? `${item.proveedor||'Proveedor'} · ${normDate(item.fecha_pedido)||''}` : (item.concepto||'Sin descripción');
                        return `
                        <div class="purchase-group-row">
                            <span style="flex:1; font-size:0.82rem;">${desc}</span>
                            <span style="font-size:0.72rem; opacity:0.55;">${normDate(item.fecha||item.fecha_pedido)||''}</span>
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-weight:700; color:var(--primary-red); font-size:0.82rem;">${formatCOP(val)}</span>
                                ${item.es_compra && item.venta_id ? `<button class="btn-action" style="font-size:0.65rem;padding:3px 8px;" onclick="window.modalDetalleVentaGlobal('${item.venta_id}')">👁️</button>` : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${sorted.length===0 ? '<p style="opacity:0.5;text-align:center;padding:3rem;">Sin egresos registrados.</p>' : ''}
    </div>`;
};

// ─── EGRESOS: Timeline ─────────────────────────────────────────────────────────
const renderEgrTimeline = (gastos, compras) => {
    const all = [
        ...gastos.map(g => ({...g, es_compra:false, _dn: normDate(g.fecha)})),
        ...compras.filter(c=>parseFloat(c.costo_cop||0)>0).map(c=>({...c, es_compra:true, _dn: normDate(c.fecha_pedido)})),
    ].sort((a,b) => new Date(b._dn||0) - new Date(a._dn||0));

    const groups = {};
    all.forEach(g => {
        const k = g._dn || 'sin-fecha';
        if (!groups[k]) groups[k] = [];
        groups[k].push(g);
    });
    return `
    <div class="purchase-view-panel">
        <div class="purchase-timeline">
            ${Object.entries(groups).map(([dk, items]) => `
            <div class="timeline-day-group">
                <div class="timeline-day-label">${labelDate(dk)}</div>
                ${items.map(g => {
                    const val = parseFloat(g.valor_cop||g.costo_cop||0);
                    const tipo = g.es_compra ? 'Compra USA' : (g.tipo_gasto||'Gasto Operativo');
                    const desc = g.es_compra ? (g.proveedor||'—') : (g.concepto||'—');
                    return `
                    <div class="timeline-item">
                        <span class="timeline-item-id">${g.es_compra?'🛒':'💸'}</span>
                        <div class="timeline-item-main">
                            <div class="timeline-item-prov">${tipo}</div>
                            <div class="timeline-item-sub">${desc}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span class="timeline-item-price" style="color:var(--primary-red);">−${formatCOP(val)}</span>
                            ${g.es_compra && g.venta_id ? `<button class="btn-action" style="font-size:0.6rem;padding:2px 6px;" onclick="window.modalDetalleVentaGlobal('${g.venta_id}')">👁️</button>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>`).join('')}
            ${Object.keys(groups).length===0 ? '<p style="opacity:0.5;text-align:center;padding:3rem;">Sin egresos.</p>' : ''}
        </div>
    </div>`;
};

// ─── Get panel HTML ────────────────────────────────────────────────────────────
// Nota: subView 'tabla' (Ingresos/Egresos) se maneja aparte vía TablaPro antes
// de llegar aquí — esta función solo cubre las demás sub-vistas (no paginadas).
function getFinPanelHTML(main, subView, cache) {
    const { ventas, gastos, compras, logistica } = cache;
    if (main === 'ingresos') {
        if (subView === 'saldos')   return renderIngSaldos(ventas);
        if (subView === 'timeline') return renderIngTimeline(ventas, logistica);
        return '';
    } else {
        if (subView === 'tipo')     return renderEgrPorTipo(gastos, compras);
        if (subView === 'timeline') return renderEgrTimeline(gastos, compras);
        return '';
    }
}

// ─── Helper: opciones de métodos de pago (dinámico + fallback) ─────────────────
const _FIN_METODOS_FALLBACK = [
    { nombre: 'Transferencia Bancolombia' },
    { nombre: 'Nequi' },
    { nombre: 'Efectivo' },
    { nombre: 'Tarjeta de Crédito', valor: 'Tarjeta' },
];
const _buildFinMetodosOptions = () => {
    const fuente = _finMetodosPagoCache.length
        ? _finMetodosPagoCache.filter(m => m.activo !== false).sort((a,b) => (a.orden||0)-(b.orden||0))
        : _FIN_METODOS_FALLBACK;
    return fuente.map(m => {
        const val   = m.valor || m.nombre;
        const label = m.nombre;
        return `<option value="${val}">${label}</option>`;
    }).join('');
};

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderFinance = async (renderLayout, navigateTo) => {
    _finRenderLayout = renderLayout;
    _finNavigateTo = navigateTo;

    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Finanzas...</div>`);

    const [gastosList, ventasList, comprasList, logisticaList, configList, metodosPagoList, clientesList, productosList] = await Promise.all([
        db.fetchData('Gastos'),
        db.fetchData('Ventas'),
        db.fetchData('Compras'),
        db.fetchData('Logistica'),
        db.fetchData('Configuracion'),
        db.fetchData('MetodosPago'),
        db.fetchData('Clientes'),
        db.fetchData('Productos'),
    ]);
    const configData = configList?.error ? [] : (configList || []);
    _finMetodosPagoCache = metodosPagoList?.error ? [] : (metodosPagoList || []);

    const gastos   = gastosList.error  ? [] : gastosList;
    const ventas   = ventasList.error  ? [] : ventasList;
    const compras  = comprasList.error ? [] : comprasList;
    const logistica= logisticaList.error ? [] : logisticaList;
    const clientes = clientesList?.error ? [] : (clientesList || []);
    const productos= productosList?.error ? [] : (productosList || []);

    _finCache = { gastos, ventas, compras, logistica, config: configData, clientes, productos };

    const applyFinFilter = () => {
        const _s = _finStartDate ? new Date(_finStartDate + 'T00:00:00') : null;
        const _e = _finEndDate ? new Date(_finEndDate + 'T23:59:59') : null;

        const filterDate = (itemDate) => {
            if (!_s && !_e) return true;
            const vd = new Date(normDate(itemDate) + 'T12:00:00');
            if (isNaN(vd)) return true;
            if (_s && vd < _s) return false;
            if (_e && vd > _e) return false;
            return true;
        };

        localGastosFiltered = gastos.filter(g => filterDate(g.fecha));
        localVentasFiltered = ventas.filter(v => filterDate(v.fecha));
        // Compras date uses fecha_pedido
        localComprasFiltered = compras.filter(c => filterDate(c.fecha_pedido || c.fecha_registro));

        const kpiPanel = document.getElementById('fin-kpi-container');
        if (kpiPanel) kpiPanel.innerHTML = renderFinKPI(localVentasFiltered, localGastosFiltered, localComprasFiltered);
        
        _reloadFinSubTabs();
        _reloadFinPanel();
    };

    window.applyFinDateFilter = () => {
        _finStartDate = document.getElementById('fin-date-start').value;
        _finEndDate = document.getElementById('fin-date-end').value;
        applyFinFilter();
    };

    window.exportFinExcel = () => {
        let exportData = [];
        if (_finActiveMain === 'ingresos') {
            exportData = localVentasFiltered.map(v => {
                const fase = getLogisticaFase(v.id, _finCache.logistica, v.estado_orden);
                return {
                    'Fecha': normDate(v.fecha),
                    'Tipo': 'Venta/Ingreso',
                    'Detalle': `Orden #${v.id.toString().slice(-4)} (${v.tipo_venta})`,
                    'Valor Total (COP)': parseFloat(v.valor_total_cop || 0),
                    'Abonado/Ingresado (COP)': parseFloat(v.abonos_acumulados || 0),
                    'Saldo (COP)': parseFloat(v.saldo_pendiente || 0),
                    'Logística': fase
                };
            });
            if(exportData.length===0) return showToast('No hay ingresos para exportar','error');
            downloadExcel(exportData, `Reporte_Ingresos_${new Date().toISOString().split('T')[0]}`);
        } else if (_finActiveMain === 'egresos') {
            const expGastos = localGastosFiltered.map(g => ({
                'Fecha': normDate(g.fecha),
                'Tipo': 'Gasto Operativo',
                'Categoría': g.tipo_gasto,
                'Concepto': g.concepto,
                'Valor (COP)': parseFloat(g.valor_cop || 0)
            }));
            const expCompras = localComprasFiltered.map(c => ({
                'Fecha': normDate(c.fecha_pedido || c.fecha_registro),
                'Tipo': 'Compra USA',
                'Categoría': 'Mercancía/Inventario',
                'Concepto': `Orden USA #${c.id.toString().slice(-4)}`,
                'Valor (COP)': parseFloat(c.costo_cop || 0)
            }));
            exportData = [...expGastos, ...expCompras];
            if(exportData.length===0) return showToast('No hay egresos para exportar','error');
            downloadExcel(exportData, `Reporte_Egresos_${new Date().toISOString().split('T')[0]}`);
        } else if (_finActiveMain === 'rentabilidad') {
            exportData = localVentasFiltered.map(v => {
                const valVenta  = parseFloat(v.valor_total_cop || 0);
                const ganCalc   = parseFloat(v.ganancia_calculada || 0);
                const envioInt  = parseFloat(v.valor_envio_internacional || 0);
                const envioCol  = parseFloat(v.envio_colombia || 0);
                const gastoComp = (() => {
                    const comp = (_finCache.compras||[]).find(c => c.id?.toString() === v.compra_id?.toString() || c.venta_id?.toString() === v.id?.toString());
                    return parseFloat(comp?.costo_cop || 0);
                })();
                const extraItems = (() => { try { return JSON.parse(v.items_rentabilidad || '[]'); } catch { return []; } })();
                const extras    = extraItems.reduce((a,x)=>a+(parseFloat(x.valor)||0),0);
                const ganReal   = valVenta - gastoComp - envioInt - envioCol - extras;
                const margen    = valVenta > 0 ? ((ganReal / valVenta) * 100).toFixed(1) : 0;
                const fase      = getLogisticaFase(v.id, _finCache.logistica, v.estado_orden || 'Sin registro');
                return {
                    'Fecha': normDate(v.fecha),
                    'Orden': `#${v.id.toString().slice(-4)} (${v.tipo_venta||'Venta'})`,
                    'Fase Logística': fase,
                    'Valor Venta (COP)': valVenta,
                    'G. Calculada (COP)': ganCalc,
                    'G. Real (COP)': ganReal,
                    'Margen (%)': parseFloat(margen)
                };
            });
            if(exportData.length===0) return showToast('No hay ventas para exportar','error');
            downloadExcel(exportData, `Reporte_Rentabilidad_${new Date().toISOString().split('T')[0]}`);
        }
    };
    
    // Initial filter processing (UI is not injected yet)
    const _initS = _finStartDate ? new Date(_finStartDate + 'T00:00:00') : null;
    const _initE = _finEndDate ? new Date(_finEndDate + 'T23:59:59') : null;
    localGastosFiltered = gastos.filter(g => !_initS && !_initE ? true : new Date(normDate(g.fecha)+'T12:00:00') >= _initS && new Date(normDate(g.fecha)+'T12:00:00') <= _initE);
    localVentasFiltered = ventas.filter(v => !_initS && !_initE ? true : new Date(normDate(v.fecha)+'T12:00:00') >= _initS && new Date(normDate(v.fecha)+'T12:00:00') <= _initE);
    localComprasFiltered = compras.filter(c => !_initS && !_initE ? true : new Date(normDate(c.fecha_pedido || c.fecha_registro)+'T12:00:00') >= _initS && new Date(normDate(c.fecha_pedido || c.fecha_registro)+'T12:00:00') <= _initE);

    window.modalGasto = () => createFinanceModal(navigateTo);

    window.switchFinMain = (main) => {
        _finActiveMain = main;
        _finActiveIngView = 'tabla';
        _finActiveEgrView = 'tabla';
        document.querySelectorAll('.fin-main-tab').forEach(b => b.classList.toggle('active', b.dataset.main === main));
        _reloadFinSubTabs();
        _reloadFinPanel();
    };

    window.switchFinSub = (sub) => {
        if (_finActiveMain === 'ingresos') _finActiveIngView = sub;
        else _finActiveEgrView = sub;
        document.querySelectorAll('.fin-sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
        _reloadFinPanel();
    };

    window.modalAbono = (ventaId, saldoPendiente) => {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        content.innerHTML = `
            <h2 style="margin-bottom:0.5rem;">Registrar Abono</h2>
            <p style="opacity:0.7;margin-bottom:0;">Saldo pendiente: <strong style="color:var(--primary-red);">${formatCOP(saldoPendiente)}</strong></p>
            <form id="form-abono" style="display:flex; flex-direction:column; gap:1.2rem; margin-top:1.5rem;">
                <div><label>Valor a Abonar (COP)</label><input type="number" id="valor_abono" required min="1" max="${saldoPendiente}"></div>
                <div><label>Método de Pago</label>
                    <select name="metodo_pago" required>
                        ${_buildFinMetodosOptions()}
                    </select>
                </div>
                <div>
                    <label style="margin-bottom:6px;display:block;">Comprobante de Pago <span style="opacity:0.5;font-size:0.75rem;">(opcional)</span></label>
                    ${buildComprobanteUploadHTML('comp-fin-abono-file')}
                </div>
                <div style="display:flex; gap:15px; margin-top:0.5rem;">
                    <button type="submit" class="btn-primary" style="flex:1;">Confirmar Abono</button>
                    <button type="button" onclick="window.closeModal()" style="flex:1; background:none; border:1px solid var(--glass-border); color:var(--text-main); border-radius:16px;">Cancelar</button>
                </div>
            </form>`;
        container.style.display = 'flex';
        setTimeout(() => attachComprobanteInput('comp-fin-abono-file'), 100);
        document.getElementById('form-abono').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.innerText = 'Registrando...';
            const abono = parseInt(document.getElementById('valor_abono').value);
            const nuevoSaldo = saldoPendiente - abono;
            try {
                const comprobanteFile = document.getElementById('comp-fin-abono-file')?.files[0];
                let comprobanteUrl = '';
                if (comprobanteFile) { btn.innerText = 'Subiendo comprobante...'; comprobanteUrl = await uploadImageToSupabase(comprobanteFile); }
                const metodoPago = document.querySelector('#form-abono [name="metodo_pago"]')?.value || '';
                btn.innerText = 'Guardando...';
                const ventasFull = await db.fetchData('Ventas');
                const v = ventasFull.find(x => x.id.toString() === ventaId.toString());
                if (!v) throw new Error('Venta no encontrada.');
                v.abonos_acumulados = (parseInt(v.abonos_acumulados||0)) + abono;
                v.saldo_pendiente = nuevoSaldo;
                if (comprobanteUrl) v.comprobante_ultimo_abono = comprobanteUrl;
                await db.postData('Ventas', v, 'UPDATE');
                // ── Registrar en historial individual de Abonos ─────────────────
                const abonoRecord = { id: Date.now().toString(), venta_id: ventaId.toString(), valor: abono, metodo_pago: metodoPago, fecha: new Date().toLocaleDateString(), comprobante_url: comprobanteUrl };
                await db.postData('Abonos', abonoRecord, 'INSERT');
                window.closeModal();
                showToast('✅ Abono registrado exitosamente');
                _finCache = null;
                renderFinance(renderLayout, navigateTo);
            } catch (err) { showToast(err.message, 'error'); btn.disabled = false; btn.innerText = 'Reintentar'; }
        };
    };

    const ingSubTabs = [
        { id:'tabla',    icon:'📋', label:'Tabla' },
        { id:'saldos',   icon:'💳', label:'Saldos' },
        { id:'timeline', icon:'📅', label:'Timeline' },
    ];
    const egrSubTabs = [
        { id:'tabla',    icon:'📋', label:'Tabla' },
        { id:'tipo',     icon:'🗂️', label:'Por Tipo' },
        { id:'timeline', icon:'📅', label:'Timeline' },
    ];

    const html = `
    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1.5rem; flex-wrap:wrap; gap:15px;">
        <div>
            <span class="page-eyebrow">Operativo · Corporativo</span>
            <h2 class="page-title">Flujo Financiero</h2>
            <p style="opacity:0.5; font-size:0.82rem; margin-top:4px;">Balance de caja, ingresos y egresos operativos.</p>
        </div>
        <div class="module-filters-bar">
            <div class="date-filter-wrap">
                <label>Desde</label>
                <input type="date" id="fin-date-start" class="date-filter-input" value="${_finStartDate}">
                <label style="margin-left:5px;">Hasta</label>
                <input type="date" id="fin-date-end" class="date-filter-input" value="${_finEndDate}">
                <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applyFinDateFilter()">Filtrar</button>
            </div>
            <button class="btn-excel" onclick="window.exportFinExcel()">📥 Excel</button>
            <button class="btn-primary" onclick="window.modalGasto()">+ Registrar Egreso</button>
        </div>
    </div>

    <div id="fin-kpi-container">
        ${renderFinKPI(localVentasFiltered, localGastosFiltered, localComprasFiltered)}
    </div>

    <!-- Main tabs: Ingresos / Egresos -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.8rem; margin-bottom:1rem;">
        <div class="purchase-view-switcher">
            <button class="pv-tab fin-main-tab${_finActiveMain==='ingresos'?' active':''}" data-main="ingresos" onclick="window.switchFinMain('ingresos')">🟢 Ingresos</button>
            <button class="pv-tab fin-main-tab${_finActiveMain==='egresos'?' active':''}" data-main="egresos" onclick="window.switchFinMain('egresos')">🔴 Egresos</button>
            <button class="pv-tab fin-main-tab${_finActiveMain==='rentabilidad'?' active':''}" data-main="rentabilidad" onclick="window.switchFinMain('rentabilidad')">📈 Rentabilidad</button>
        </div>
        ${(_finActiveMain==='ingresos'||_finActiveMain==='egresos') ? `<div class="purchase-view-switcher" id="fin-sub-tabs">
            ${(_finActiveMain === 'ingresos' ? ingSubTabs : egrSubTabs).map(t => `
            <button class="pv-tab fin-sub-tab${t.id===(_finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView)?' active':''}" data-sub="${t.id}" onclick="window.switchFinSub('${t.id}')">
                ${t.icon} ${t.label}
            </button>`).join('')}
        </div>` : '<div id="fin-sub-tabs"></div>'}
    </div>

    <div id="fin-panel">
        ${_finActiveMain === 'rentabilidad' ? renderRentabilidad() :
          (_finActiveMain === 'ingresos' && _finActiveIngView === 'tabla') ? renderIngTabla() :
          (_finActiveMain === 'egresos' && _finActiveEgrView === 'tabla') ? renderEgrTabla() :
          getFinPanelHTML(_finActiveMain, (_finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView), {
            ventas: localVentasFiltered,
            gastos: localGastosFiltered,
            compras: localComprasFiltered,
            logistica: _finCache.logistica
          })}
    </div>`;

    renderLayout(html);
    setTimeout(() => {
        if (_finActiveMain === 'rentabilidad') _montarTablaRentabilidad();
        else if (_finActiveMain === 'ingresos' && _finActiveIngView === 'tabla') _montarTablaIngresos();
        else if (_finActiveMain === 'egresos' && _finActiveEgrView === 'tabla') _montarTablaEgresos();
        attachGroupToggles();
    }, 150);
};

// ─── Sub-tabs reload ───────────────────────────────────────────────────────────
function _reloadFinSubTabs() {
    const ingSubTabs = [
        { id:'tabla',    icon:'📋', label:'Tabla' },
        { id:'saldos',   icon:'💳', label:'Saldos' },
        { id:'timeline', icon:'📅', label:'Timeline' },
    ];
    const egrSubTabs = [
        { id:'tabla',    icon:'📋', label:'Tabla' },
        { id:'tipo',     icon:'🗂️', label:'Por Tipo' },
        { id:'timeline', icon:'📅', label:'Timeline' },
    ];
    const container = document.getElementById('fin-sub-tabs');
    if (!container) return;
    if (_finActiveMain !== 'ingresos' && _finActiveMain !== 'egresos') {
        container.innerHTML = '';
        return;
    }
    const tabs = _finActiveMain === 'ingresos' ? ingSubTabs : egrSubTabs;
    const activeSubView = _finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView;
    container.innerHTML = tabs.map(t => `
        <button class="pv-tab fin-sub-tab${t.id===activeSubView?' active':''}" data-sub="${t.id}" onclick="window.switchFinSub('${t.id}')">
            ${t.icon} ${t.label}
        </button>`).join('');
}

function _reloadFinPanel() {
    const panel = document.getElementById('fin-panel');
    if (!panel || !_finCache) return;
    if (_finActiveMain === 'rentabilidad') {
        panel.innerHTML = renderRentabilidad();
        _montarTablaRentabilidad();
        return;
    }
    if (_finActiveMain === 'ingresos' && _finActiveIngView === 'tabla') {
        panel.innerHTML = renderIngTabla();
        _montarTablaIngresos();
        return;
    }
    if (_finActiveMain === 'egresos' && _finActiveEgrView === 'tabla') {
        panel.innerHTML = renderEgrTabla();
        _montarTablaEgresos();
        return;
    }
    const sub = _finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView;
    panel.innerHTML = getFinPanelHTML(_finActiveMain, sub, {
        gastos: localGastosFiltered,
        ventas: localVentasFiltered,
        compras: localComprasFiltered,
        logistica: _finCache.logistica
    });
    attachGroupToggles();
}

function attachGroupToggles() {
    document.querySelectorAll('.purchase-group-card').forEach(el => {
        if (!el.classList.contains('open')) el.classList.add('open');
    });
}

// ─── Rentabilidad: per-sale profitability table (TablaPro sobre ventas_finanzas_view) ──
const renderRentabilidad = () => {
    const sorted = localVentasFiltered;
    const totVenta = sorted.reduce((a,v)=>a+parseFloat(v.valor_total_cop||0),0);
    const totCalc  = sorted.reduce((a,v)=>a+parseFloat(v.ganancia_calculada||0),0);
    return `
    <div class="purchase-view-panel">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:1.5rem;">
            <div class="glass-card" style="padding:1rem;text-align:center;">
                <div style="font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">💵 Facturación Total</div>
                <div style="font-size:1.3rem;font-weight:900;color:var(--info-blue);">${formatCOP(totVenta)}</div>
            </div>
            <div class="glass-card" style="padding:1rem;text-align:center;">
                <div style="font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🎯 Ganancia Calculada Total</div>
                <div style="font-size:1.3rem;font-weight:900;color:var(--success-green);">${formatCOP(totCalc)}</div>
            </div>
            <div class="glass-card" style="padding:1rem;text-align:center;">
                <div style="font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">📋 Ventas Analizadas</div>
                <div style="font-size:1.3rem;font-weight:900;color:var(--text-main);">${sorted.length}</div>
            </div>
        </div>
        <div id="fin-rentabilidad-tabla-container"></div>
    </div>`;
};

function _montarTablaRentabilidad() {
    new TablaPro({
        containerId: 'fin-rentabilidad-tabla-container',
        tabla: 'ventas_finanzas_view',
        supabase: db.client,
        filtrosExtra: _idFiltroExtra(_finVentasIdFiltro()),
        searchColumns: ['cliente_nombre', 'producto_nombre', 'producto_categoria', 'estado_orden'],
        columnas: [
            { key: 'fecha', label: 'Fecha', width: '110px', render: (v) => normDate(v) || 'N/A' },
            { key: 'cliente_nombre', label: 'Referencia', width: '190px',
              render: (v, row) => `<div class="cell-title">Orden #${row.id.toString().slice(-4)}</div><span class="cell-subtitle">${row.producto_nombre||'Sin producto'} · ${v||'Sin cliente'}</span>` },
            { key: '_fase', label: 'Fase', width: '160px', sortable: false,
              render: (_v, row) => {
                  const fase = getLogisticaFase(row.id, _finCache.logistica, row.estado_orden||'Sin registro');
                  return `<span class="status-badge" style="background:${getLogisticaColor(fase)};font-size:0.65rem;">${fase}</span>`;
              } },
            { key: 'valor_total_cop', label: 'Valor Venta', width: '150px', render: (v) => `<span class="cell-price">${formatCOP(parseFloat(v||0))}</span>` },
            { key: 'ganancia_calculada', label: 'G. Calculada', width: '150px', render: (v) => `<span style="color:var(--info-blue);">${formatCOP(parseFloat(v||0))}</span>` },
            { key: '_real', label: 'G. Real (est.)', width: '150px', sortable: false,
              render: (_v, row) => {
                  const ganReal = _calcGananciaReal(row);
                  return `<span style="color:${ganReal>=0?'var(--success-green)':'var(--primary-red)'};font-weight:700;">${formatCOP(ganReal)}</span>`;
              } },
            { key: '_margen', label: 'Margen', width: '80px', sortable: false,
              render: (_v, row) => {
                  const valVenta = parseFloat(row.valor_total_cop||0);
                  const ganReal  = _calcGananciaReal(row);
                  const margen   = valVenta > 0 ? ((ganReal/valVenta)*100).toFixed(1) : 0;
                  return `<span style="color:${margen>=0?'var(--success-green)':'var(--primary-red)'};">${margen}%</span>`;
              } },
        ],
        acciones: (row) => `<button class="btn-action" style="font-size:0.72rem;padding:5px 10px;" onclick="window.openRentabilidadModal('${row.id}');event.stopPropagation();">🔍 Detalle</button>`,
        altura: '60vh',
    }).mount();
}

window.openRentabilidadModal = async (ventaId) => {
    const container = document.getElementById('modal-container');
    const content   = document.getElementById('modal-content');
    if (!container || !content) return;
    content.innerHTML = `<div style="text-align:center;padding:3rem;"><div class="loader"></div> Cargando análisis...</div>`;
    container.style.display = 'flex';

    const ventasFull = _finCache?.ventas || await db.fetchData('Ventas');
    const v = ventasFull.find(x => x.id?.toString() === ventaId?.toString());
    if (!v) { content.innerHTML = `<p>Venta no encontrada.</p>`; return; }

    const compras  = _finCache?.compras || [];
    const logistica= _finCache?.logistica || [];
    const comp     = compras.find(c => c.id?.toString() === v.compra_id?.toString() || c.venta_id?.toString() === v.id?.toString());

    const valVenta  = parseFloat(v.valor_total_cop || 0);
    const ganCalc   = parseFloat(v.ganancia_calculada || 0);
    const gastoComp = parseFloat(comp?.costo_cop || 0);
    const envioInt  = parseFloat(v.valor_envio_internacional || 0);
    const envioCol  = parseFloat(v.envio_colombia || 0);
    let items = (() => { try { return JSON.parse(v.items_rentabilidad || '[]'); } catch { return []; } })();

    const calcOtros = () => items.reduce((a, x) => a + (parseFloat(x.valor) || 0), 0);
    const calcReal  = () => valVenta - gastoComp - envioInt - envioCol - calcOtros();

    const renderItems = () => items.map((it, i) => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input value="${it.concepto||''}" placeholder="Concepto" oninput="window.updateRentItem(${i},'concepto',this.value)"
                style="flex:1;background:var(--glass-hover);border:1px solid var(--glass-border);border-radius:8px;padding:7px 10px;color:var(--text-main);font-size:0.82rem;">
            <input type="number" value="${it.valor||0}" placeholder="0" oninput="window.updateRentItem(${i},'valor',parseFloat(this.value)||0)"
                style="width:110px;background:var(--glass-hover);border:1px solid var(--glass-border);border-radius:8px;padding:7px 10px;color:var(--text-main);font-size:0.82rem;">
            <button onclick="window.removeRentItem(${i})" style="background:none;border:none;color:var(--primary-red);cursor:pointer;font-size:1.2rem;padding:0;">×</button>
        </div>`).join('');

    const costRow = (icon, label, sub, val) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.8rem;border-bottom:1px solid var(--glass-border);">
            <div><span style="margin-right:8px;">${icon}</span><span style="font-size:0.82rem;font-weight:600;">${label}</span><div style="font-size:0.7rem;opacity:0.5;margin-left:24px;">${sub}</div></div>
            <span style="font-size:0.9rem;font-weight:700;color:var(--primary-red);">-${formatCOP(val)}</span>
        </div>`;

    const ganReal = calcReal();
    const diff    = ganReal - ganCalc;

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <div><h2 class="modal-title">📊 Análisis de Rentabilidad</h2><p class="modal-subtitle">Orden #${v.id.toString().slice(-4)} · ${v.tipo_venta||'Encargo'}</p></div>
                <button onclick="window.closeModal()" class="modal-close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:1.5rem;">
                    <div style="background:var(--glass-hover);padding:1rem 1.2rem;border-radius:12px;border:1px solid var(--glass-border);">
                        <div style="font-size:0.68rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">💵 Valor Total de Venta</div>
                        <div style="font-size:1.3rem;font-weight:900;">${formatCOP(valVenta)}</div>
                    </div>
                    <div style="background:rgba(37,99,235,0.08);padding:1rem 1.2rem;border-radius:12px;border:1px solid rgba(37,99,235,0.25);">
                        <div style="font-size:0.68rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🎯 Ganancia Calculada</div>
                        <div style="font-size:1.3rem;font-weight:900;color:var(--info-blue);">${formatCOP(ganCalc)}</div>
                    </div>
                </div>
                ${costRow('🛒','Gasto de Compra EEUU','Costo real del producto en Compras USA',gastoComp)}
                ${costRow('✈️','Envío Internacional','Peso × Valor Libra × TRM',envioInt)}
                ${costRow('🚚','Envío Local Colombia','Costo despacho al cliente',envioCol)}
                <div style="background:rgba(230,57,70,0.04);border:1px solid rgba(230,57,70,0.15);border-radius:10px;padding:1rem;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <span style="font-size:0.82rem;font-weight:700;">🧾 Otros Costos</span>
                        <span id="rent-otros-total" style="font-size:1rem;font-weight:800;color:var(--primary-red);">-${formatCOP(calcOtros())}</span>
                    </div>
                    <div id="rent-items-list">${renderItems()}</div>
                    <button onclick="window.addRentItem()" style="width:100%;margin-top:8px;padding:9px;font-weight:700;font-size:0.82rem;background:rgba(230,57,70,0.08);border:1px dashed rgba(230,57,70,0.4);border-radius:8px;color:var(--primary-red);cursor:pointer;">+ Agregar Costo</button>
                </div>
                <div id="rent-real-block" style="margin-top:1.2rem;padding:1.2rem 1.5rem;border-radius:14px;background:${ganReal>=0?'rgba(6,214,160,0.08)':'rgba(230,57,70,0.08)'};border:2px solid ${ganReal>=0?'var(--success-green)':'var(--primary-red)'};display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.7;margin-bottom:4px;">✅ Ganancia Real</div>
                        <div id="rent-diff-val" style="font-size:0.75rem;font-weight:600;color:${diff>=0?'var(--success-green)':'#f59e0b'};">${diff>=0?'+':''}${formatCOP(diff)} vs calculada</div>
                    </div>
                    <div id="rent-real-val" style="font-size:2rem;font-weight:900;color:${ganReal>=0?'var(--success-green)':'var(--primary-red)'};">${formatCOP(ganReal)}</div>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="window.closeModal()" class="btn-secondary">Cancelar</button>
                <button id="btn-save-rent" class="btn-primary">💾 Guardar Análisis</button>
            </div>
        </div>`;

    const refreshSummary = () => {
        const otros = calcOtros();
        const real  = calcReal();
        const d     = real - ganCalc;
        document.getElementById('rent-otros-total').textContent = `-${formatCOP(otros)}`;
        document.getElementById('rent-real-val').textContent    = formatCOP(real);
        document.getElementById('rent-real-val').style.color    = real>=0?'var(--success-green)':'var(--primary-red)';
        document.getElementById('rent-diff-val').textContent    = `${d>=0?'+':''}${formatCOP(d)} vs calculada`;
        document.getElementById('rent-diff-val').style.color    = d>=0?'var(--success-green)':'#f59e0b';
        const blk = document.getElementById('rent-real-block');
        if (blk) { blk.style.background=real>=0?'rgba(6,214,160,0.08)':'rgba(230,57,70,0.08)'; blk.style.borderColor=real>=0?'var(--success-green)':'var(--primary-red)'; }
    };
    window.updateRentItem = (idx,key,val)=>{ items[idx][key]=val; refreshSummary(); };
    window.removeRentItem = (idx)=>{ items.splice(idx,1); document.getElementById('rent-items-list').innerHTML=renderItems(); refreshSummary(); };
    window.addRentItem    = ()=>{ items.push({concepto:'',valor:0}); document.getElementById('rent-items-list').innerHTML=renderItems(); refreshSummary(); };

    document.getElementById('btn-save-rent').onclick = async () => {
        const btn = document.getElementById('btn-save-rent');
        btn.disabled=true; btn.innerText='Guardando...';
        try {
            v.items_rentabilidad = JSON.stringify(items);
            await db.postData('Ventas', v, 'UPDATE');
            showToast('✅ Análisis guardado');
            window.closeModal();
            _finCache = null;
            renderFinance(_finRenderLayout, _finNavigateTo);
        } catch(e) { showToast(e.message,'error'); btn.disabled=false; btn.innerText='Reintentar'; }
    };
};

// ─── Create Finance Modal ──────────────────────────────────────────────────────
export const createFinanceModal = async (navigateTo) => {
    const container = document.getElementById('modal-container');
    const content   = document.getElementById('modal-content');
    const todayISO  = new Date().toISOString().split('T')[0];

    content.innerHTML = `
    <div class="modal-content" style="width:min(640px,96vw);">
      <div class="modal-header">
        <div>
          <h2 style="margin:0;">Registrar Nuevo Egreso</h2>
          <p style="opacity:0.6;font-size:0.85rem;margin:4px 0 0;">Gastos y salidas de caja operativas</p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>

      <div class="modal-body">
        <form id="form-finance-gasto" style="display:flex;flex-direction:column;gap:1.2rem;">

          <!-- Fila 1: Categoría + Concepto -->
          <div class="form-grid-2">
            <div class="form-group">
              <label>Categoría / Tipo de Gasto</label>
              <select name="tipo_gasto" required>
                <option value="">-- Selecciona --</option>
                <option value="Papelería y Oficina">Papelería y Oficina</option>
                <option value="Empaques e Insumos (Bolsas)">Empaques e Insumos (Bolsas)</option>
                <option value="Campañas Publicitarias (Ads)">Campañas Publicitarias (Ads)</option>
                <option value="Logística Externa / Envíos">Logística Externa / Envíos</option>
                <option value="Nómina / Administrativo">Nómina / Administrativo</option>
                <option value="Servicios Digitales (Hosting, etc)">Servicios Digitales (Hosting, etc)</option>
                <option value="Otros Gastos Operativos">Otros Gastos Operativos</option>
              </select>
            </div>
            <div class="form-group">
              <label>Concepto / Descripción</label>
              <input type="text" name="concepto" placeholder="Ej. Lote de 500 bolsas personalizadas" required>
            </div>
          </div>

          <!-- Fila 2: Número Factura + Fecha Real Factura -->
          <div class="form-grid-2">
            <div class="form-group">
              <label>Número de Factura <span style="opacity:0.5;font-size:0.75rem;">(opcional)</span></label>
              <input type="text" name="numero_factura" placeholder="Ej. FAC-2025-001">
            </div>
            <div class="form-group">
              <label>Fecha Real de la Factura</label>
              <input type="date" name="fecha_real_factura" value="${todayISO}" required>
            </div>
          </div>

          <!-- Moneda -->
          <div style="display:flex;gap:1.5rem;padding:0.8rem 1rem;background:var(--glass-hover);border-radius:12px;border:1px solid var(--glass-border);">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.88rem;font-weight:600;">
              <input type="radio" name="moneda" value="COP" checked onchange="window.toggleCurrency(this.value)">
              🇨🇴 Pesos (COP)
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.88rem;font-weight:600;">
              <input type="radio" name="moneda" value="USD" onchange="window.toggleCurrency(this.value)">
              🇺🇸 Dólares (USD)
            </label>
          </div>

          <!-- Fila 3: Valor + TRM -->
          <div class="form-grid-2">
            <div class="form-group">
              <label id="lbl-valor-origen">Valor Facturado (COP)</label>
              <input type="number" step="0.01" name="valor_origen" id="val-origen" required min="0" placeholder="0">
            </div>
            <div class="form-group" id="box-trm" style="display:none;">
              <label style="color:var(--success-green);">TRM del día</label>
              <input type="number" step="0.01" name="trm" id="val-trm" placeholder="Ej: 4100" style="border-color:var(--success-green);">
            </div>
          </div>

          <!-- Impacto calculado -->
          <div style="background:var(--glass-bg);padding:1rem 1.4rem;border-radius:12px;border:1px dashed var(--glass-border);text-align:center;">
            <p style="margin:0;font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;">Impacto Financiero</p>
            <div id="lbl-total-cop" style="font-size:1.6rem;font-weight:800;color:var(--primary-red);margin-top:4px;">$0</div>
          </div>

          <!-- Comprobante -->
          <div class="form-group">
            <label>Comprobante de Pago <span style="opacity:0.5;font-size:0.75rem;">(opcional)</span></label>
            ${buildComprobanteUploadHTML('comp-egreso-file')}
          </div>

        </form>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button type="submit" form="form-finance-gasto" id="btn-save-egreso" class="btn-primary">
          💾 Registrar Egreso
        </button>
      </div>
    </div>`;

    container.style.display = 'flex';

    // Currency toggle
    window.toggleCurrency = (val) => {
        const boxTRM   = document.getElementById('box-trm');
        const inputTRM = document.getElementById('val-trm');
        const lblValor = document.getElementById('lbl-valor-origen');
        if (val === 'USD') {
            boxTRM.style.display = 'block';
            inputTRM.setAttribute('required','true');
            lblValor.innerText = 'Valor Facturado (USD)';
        } else {
            boxTRM.style.display = 'none';
            inputTRM.removeAttribute('required');
            inputTRM.value = '';
            lblValor.innerText = 'Valor Facturado (COP)';
        }
        window.calculateCopt();
    };

    window.calculateCopt = () => {
        const isUSD = document.querySelector('input[name="moneda"]:checked')?.value === 'USD';
        const vO  = parseFloat(document.getElementById('val-origen')?.value || 0);
        const trm = parseFloat(document.getElementById('val-trm')?.value || 0);
        const el  = document.getElementById('lbl-total-cop');
        if (el) el.innerText = formatCOP(isUSD ? vO * trm : vO);
    };

    setTimeout(() => {
        document.getElementById('val-origen')?.addEventListener('input', window.calculateCopt);
        document.getElementById('val-trm')?.addEventListener('input', window.calculateCopt);
        attachComprobanteInput('comp-egreso-file');
    }, 150);

    document.getElementById('form-finance-gasto').onsubmit = async (e) => {
        e.preventDefault();
        const fd       = new FormData(e.target);
        const isUSD    = fd.get('moneda') === 'USD';
        const vO       = parseFloat(fd.get('valor_origen'));
        const trm      = isUSD ? parseFloat(fd.get('trm')) : null;
        const totalCOP = isUSD ? vO * trm : vO;
        const btn      = document.getElementById('btn-save-egreso');
        btn.disabled = true; btn.innerText = 'Guardando...';
        try {
            const comprobanteFile = document.getElementById('comp-egreso-file')?.files[0];
            let comprobanteUrl = '';
            if (comprobanteFile) { btn.innerText = 'Subiendo comprobante...'; comprobanteUrl = await uploadImageToSupabase(comprobanteFile); }
            const payload = {
                id:                  Date.now().toString(),
                tipo_gasto:          fd.get('tipo_gasto'),
                concepto:            fd.get('concepto'),
                numero_factura:      fd.get('numero_factura') || null,
                fecha_real_factura:  fd.get('fecha_real_factura') || null,
                moneda:              fd.get('moneda'),
                valor_origen:        vO,
                trm,
                valor_cop:           totalCOP,
                fecha:               new Date().toLocaleDateString(),
                comprobante_url:     comprobanteUrl
            };
            await db.postData('Gastos', payload, 'INSERT');
            window.closeModal();
            showToast('✅ Egreso registrado correctamente');
            _finCache = null;
            renderFinance(_finRenderLayout, navigateTo);
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.innerText = '💾 Registrar Egreso';
        }
    };
};
