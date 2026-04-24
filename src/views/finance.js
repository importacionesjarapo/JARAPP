import { db } from '../db.js';
import { formatCOP, formatUSD, renderError, showToast, getLogisticaFase, getLogisticaColor, buildComprobanteUploadHTML, attachComprobanteInput, uploadImageToSupabase, downloadExcel, renderPagination, paginate } from '../utils.js';

// ─── Cached data ───────────────────────────────────────────────────────────────
let _finCache = null;
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
                <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}'); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">👁️ Ver</button>
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
                <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}'); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">👁️ Ver</button>
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
                <button class="btn-action" onclick="window.modalAbono('${v.id}', ${v.saldo_pendiente}); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">💳 Abonar</button>
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

// ─── INGRESOS: Vista Tabla ─────────────────────────────────────────────────────
const renderIngTabla = (ventas, logistica) => {
    const sorted = [...ventas].reverse();
    return `
    <div class="purchase-view-panel">
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th style="min-width:120px;">Fecha</th>
                    <th style="min-width:190px;">Referencia / Tipo</th>
                    <th style="min-width:220px;">Fase Logística</th>
                    <th style="min-width:170px;">Abonos Recibidos</th>
                    <th style="min-width:165px;">Valor Total</th>
                    <th class="text-right" style="min-width:160px;">Saldo Pendiente</th>
                    <th class="text-center" style="min-width:110px;">Comprobante</th>
                </tr></thead>
                <tbody>
                ${sorted.length > 0 ? sorted.map(v => {
                    const totalCop = parseFloat(v.valor_total_cop||0);
                    const abonos   = parseFloat(v.abonos_acumulados||0);
                    const saldo    = totalCop - abonos;
                    const isPaid   = totalCop > 0 && abonos >= totalCop;
                    const fase     = getLogisticaFase(v.id, logistica, v.estado_orden||'Sin registro');
                    const faseCol  = getLogisticaColor(fase);
                    const sf = `${v.id.toString().slice(-4)} ${v.tipo_venta||''} ${fase}`;
                    const compUrl  = v.comprobante_ultimo_abono || v.comprobante_url || '';
                    return `
                    <tr class="fin-income-row" data-text="${sf.replace(/"/g,'&quot;')}">
                        <td style="font-weight:700;">${normDate(v.fecha)||'N/A'}</td>
                        <td>
                            <div class="cell-title">Orden #${v.id.toString().slice(-4)}</div>
                            <span class="cell-subtitle">${v.tipo_venta||'Venta'}</span>
                        </td>
                        <td><span class="status-badge" style="background:${faseCol};">${fase}</span></td>
                        <td><span class="cell-price" style="color:var(--success-green);">${formatCOP(abonos)}</span></td>
                        <td><span class="cell-price">${formatCOP(totalCop)}</span></td>
                        <td class="text-right">
                            <span style="font-size:0.75rem; padding:5px 14px; border-radius:15px; font-weight:800;
                                color:${isPaid?'var(--success-green)':'var(--primary-red)'};
                                border:1px solid ${isPaid?'rgba(6,214,160,0.3)':'rgba(217,16,16,0.3)'};
                                background:${isPaid?'rgba(6,214,160,0.05)':'rgba(217,16,16,0.07)'};
                                display:inline-block; white-space:nowrap;">
                                ${isPaid ? '✔ Pagado' : formatCOP(saldo)}
                            </span>
                        </td>
                        <td class="text-center">
                            ${compUrl ? `<button class="comp-thumb-btn" onclick="window.openComprobanteViewer('${compUrl}')">🧾 Ver</button>` : `<span style="opacity:0.25;font-size:0.75rem;">—</span>`}
                        </td>
                    </tr>`;
                }).join('') : '<tr class="table-empty-row"><td colspan="7">No hay ingresos registrados.</td></tr>'}
                <tr class="table-empty-row" id="fin-income-empty" style="display:none;"><td colspan="7">Sin resultados.</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
};

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

// ─── EGRESOS: Vista Tabla ──────────────────────────────────────────────────────
const renderEgrTabla = (gastos, compras) => {
    const combined = [
        ...gastos.map(g => ({...g, es_compra:false, _ts: new Date(normDate(g.fecha)||0)})),
        ...compras.filter(c => parseFloat(c.costo_cop||0) > 0)
                  .map(c => ({...c, es_compra:true, _ts: new Date(normDate(c.fecha_pedido)||0)})),
    ].sort((a,b) => b._ts - a._ts);

    return `
    <div class="purchase-view-panel">
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th style="min-width:120px;">Fecha</th>
                    <th style="min-width:240px;">Concepto / Tipo</th>
                    <th class="text-center" style="min-width:100px;">Moneda</th>
                    <th style="min-width:160px;">Valor Origen</th>
                    <th style="min-width:110px;">TRM</th>
                    <th class="text-right" style="min-width:170px;">Total COP</th>
                    <th class="text-center" style="min-width:110px;">Comprobante</th>
                </tr></thead>
                <tbody>
                ${combined.length > 0 ? combined.map(g => {
                    const totalCop   = parseFloat(g.valor_cop||g.costo_cop||0);
                    const valorOr    = parseFloat(g.valor_origen||g.costo_usd||0);
                    const isUSD      = g.moneda === 'USD' || g.es_compra;
                    const tipoStr    = g.es_compra ? 'Compra USA Proveedor' : (g.tipo_gasto||'Gasto Operativo');
                    const descStr    = g.es_compra ? `Tienda: ${g.proveedor||''}` : (g.concepto||'Sin descripción');
                    const sf = `${g.fecha||g.fecha_pedido||''} ${tipoStr} ${descStr}`;
                    const compUrl    = (!g.es_compra && g.comprobante_url) ? g.comprobante_url : '';
                    return `
                    <tr class="fin-expense-row" data-text="${sf.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}">
                        <td style="font-weight:700;">${normDate(g.fecha||g.fecha_pedido)||'N/A'}</td>
                        <td>
                            <div class="cell-title" style="color:${g.es_compra?'var(--info-blue)':'inherit'}; max-width:220px;">${tipoStr}</div>
                            <span class="cell-subtitle">${descStr}</span>
                        </td>
                        <td class="text-center">
                            <span style="font-size:0.7rem; padding:4px 10px; border-radius:15px; font-weight:700;
                                background:var(--glass-bg);
                                color:${isUSD?'var(--success-green)':'var(--info-blue)'};
                                border:1px solid ${isUSD?'rgba(6,214,160,0.3)':'rgba(0,180,216,0.3)'}; display:inline-block;">
                                ${g.es_compra ? 'USD' : (g.moneda||'COP')}
                            </span>
                        </td>
                        <td style="font-family:monospace; font-size:0.85rem;">${isUSD ? formatUSD(valorOr) : formatCOP(valorOr)}</td>
                        <td>${isUSD && g.trm ? `<span style="opacity:0.6; font-size:0.85rem;">$${g.trm}</span>` : '<span style="opacity:0.3">—</span>'}</td>
                        <td class="text-right"><span class="cell-price" style="color:var(--primary-red);">${formatCOP(totalCop)}</span></td>
                        <td class="text-center">
                            ${compUrl ? `<button class="comp-thumb-btn" onclick="window.openComprobanteViewer('${compUrl}')">🧾 Ver</button>` : `<span style="opacity:0.25;font-size:0.75rem;">—</span>`}
                        </td>
                    </tr>`;
                }).join('') : '<tr class="table-empty-row"><td colspan="7">Sin egresos registrados.</td></tr>'}
                <tr class="table-empty-row" id="fin-expense-empty" style="display:none;"><td colspan="7">Sin resultados.</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
};

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
                            <span style="font-weight:700; color:var(--primary-red); font-size:0.82rem;">${formatCOP(val)}</span>
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
                        <span class="timeline-item-price" style="color:var(--primary-red);">−${formatCOP(val)}</span>
                    </div>`;
                }).join('')}
            </div>`).join('')}
            ${Object.keys(groups).length===0 ? '<p style="opacity:0.5;text-align:center;padding:3rem;">Sin egresos.</p>' : ''}
        </div>
    </div>`;
};

// ─── Get panel HTML ────────────────────────────────────────────────────────────
function getFinPanelHTML(main, subView, cache) {
    const { ventas, gastos, compras, logistica } = cache;
    if (main === 'ingresos') {
        switch (subView) {
            case 'saldos':   return renderIngSaldos(ventas);
            case 'timeline': return renderIngTimeline(ventas, logistica);
            default:         return renderIngTabla(ventas, logistica);
        }
    } else {
        switch (subView) {
            case 'tipo':     return renderEgrPorTipo(gastos, compras);
            case 'timeline': return renderEgrTimeline(gastos, compras);
            default:         return renderEgrTabla(gastos, compras);
        }
    }
}

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderFinance = async (renderLayout, navigateTo) => {
    _finRenderLayout = renderLayout;
    _finNavigateTo = navigateTo;

    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Finanzas...</div>`);

    const [gastosList, ventasList, comprasList, logisticaList] = await Promise.all([
        db.fetchData('Gastos'),
        db.fetchData('Ventas'),
        db.fetchData('Compras'),
        db.fetchData('Logistica'),
    ]);

    const gastos   = gastosList.error  ? [] : gastosList;
    const ventas   = ventasList.error  ? [] : ventasList;
    const compras  = comprasList.error ? [] : comprasList;
    const logistica= logisticaList.error ? [] : logisticaList;

    _finCache = { gastos, ventas, compras, logistica };

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
        } else {
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
                        <option value="Transferencia Bancolombia">Transferencia Bancolombia</option>
                        <option value="Nequi">Nequi</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Tarjeta">Tarjeta de Crédito</option>
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

    // Pagination State
    const _page = parseInt(localStorage.getItem('finance_page') || '1');
    const _rpp  = parseInt(localStorage.getItem('finance_rpp') || '10');

    // Filter current list based on active tab
    const currentList = _finActiveMain === 'ingresos' 
        ? localVentasFiltered 
        : [
            ...localGastosFiltered.map(g => ({...g, es_compra:false})),
            ...localComprasFiltered.filter(c => parseFloat(c.costo_cop||0) > 0).map(c => ({...c, es_compra:true}))
          ];

    const pagedList = (_finActiveMain === 'ingresos' ? _finActiveIngView === 'tabla' : _finActiveEgrView === 'tabla')
        ? paginate(currentList, _page, _rpp)
        : currentList;

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
            <input type="text" id="find-finance" placeholder="Filtrar por orden, tipo o detalle..." style="background:var(--input-bg); color:var(--text-main); padding:10px 15px; border-radius:12px; border:1px solid var(--glass-border); width:230px; outline:none;">
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
        </div>
        <div class="purchase-view-switcher" id="fin-sub-tabs">
            ${(_finActiveMain === 'ingresos' ? ingSubTabs : egrSubTabs).map(t => `
            <button class="pv-tab fin-sub-tab${t.id===(_finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView)?' active':''}" data-sub="${t.id}" onclick="window.switchFinSub('${t.id}')">
                ${t.icon} ${t.label}
            </button>`).join('')}
        </div>
    </div>

    <div id="fin-panel">
        ${getFinPanelHTML(_finActiveMain, (_finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView), {
            ventas: _finActiveMain === 'ingresos' ? pagedList : localVentasFiltered,
            gastos: _finActiveMain === 'egresos' ? pagedList.filter(x => !x.es_compra) : localGastosFiltered,
            compras: _finActiveMain === 'egresos' ? pagedList.filter(x => x.es_compra) : localComprasFiltered,
            logistica: _finCache.logistica
        })}
    </div>
    ${(_finActiveMain === 'ingresos' ? _finActiveIngView === 'tabla' : _finActiveEgrView === 'tabla') ? renderPagination(currentList.length, _page, _rpp, 'finance') : ''}`;

    renderLayout(html);
    setTimeout(() => { attachFinSearch(); attachGroupToggles(); }, 150);
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
    const tabs = _finActiveMain === 'ingresos' ? ingSubTabs : egrSubTabs;
    const activeSubView = _finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView;
    const container = document.getElementById('fin-sub-tabs');
    if (container) {
        container.innerHTML = tabs.map(t => `
            <button class="pv-tab fin-sub-tab${t.id===activeSubView?' active':''}" data-sub="${t.id}" onclick="window.switchFinSub('${t.id}')">
                ${t.icon} ${t.label}
            </button>`).join('');
    }
}

function _reloadFinPanel() {
    const panel = document.getElementById('fin-panel');
    if (!panel || !_finCache) return;
    const sub = _finActiveMain === 'ingresos' ? _finActiveIngView : _finActiveEgrView;
    panel.innerHTML = getFinPanelHTML(_finActiveMain, sub, {
        gastos: localGastosFiltered,
        ventas: localVentasFiltered,
        compras: localComprasFiltered,
        logistica: _finCache.logistica
    });
    attachFinSearch();
    attachGroupToggles();
}

function attachFinSearch() {
    const fp = document.getElementById('find-finance');
    if (!fp) return;
    fp.oninput = (e) => {
        const k = e.target.value.toLowerCase().trim();
        const sel = _finActiveMain === 'ingresos' ? '.fin-income-row' : '.fin-expense-row';
        const emptyId = _finActiveMain === 'ingresos' ? 'fin-income-empty' : 'fin-expense-empty';
        let vis = 0;
        document.querySelectorAll(sel).forEach(r => {
            const m = (r.getAttribute('data-text')||'').toLowerCase().includes(k);
            r.style.display = m ? '' : 'none';
            if (m) vis++;
        });
        const em = document.getElementById(emptyId);
        if (em) em.style.display = vis===0&&k.length>0 ? '' : 'none';
    };
}
function attachGroupToggles() {
    document.querySelectorAll('.purchase-group-card').forEach(el => {
        if (!el.classList.contains('open')) el.classList.add('open');
    });
}

// ─── Create Finance Modal (unchanged logic) ────────────────────────────────────
export const createFinanceModal = async (navigateTo) => {
    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');
    content.innerHTML = `
        <h2 style="margin-bottom:1.5rem;">Registrar Nuevo Gasto</h2>
        <form id="form-finance-gasto" style="display:flex; flex-direction:column; gap:1.2rem; max-height:70vh; overflow-y:auto; padding-right:1rem;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
               <div>
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
               <div><label>Concepto Breve</label><input type="text" name="concepto" placeholder="Ej. Lote de 500 bolsas personalizadas" required></div>
            </div>
            <div style="display:flex; gap:1rem; border-bottom:1px solid var(--glass-border); padding-bottom:1rem;">
               <label style="flex:1;"><input type="radio" name="moneda" value="COP" checked onchange="window.toggleCurrency(this.value)"> 🇨🇴 Pesos (COP)</label>
               <label style="flex:1;"><input type="radio" name="moneda" value="USD" onchange="window.toggleCurrency(this.value)"> 🇺🇸 Dólares (USD)</label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
               <div>
                  <label id="lbl-valor-origen">Valor Facturado (COP)</label>
                  <input type="number" step="0.01" name="valor_origen" id="val-origen" required min="0">
               </div>
               <div id="box-trm" style="display:none; background:rgba(6,214,160,0.05); border:1px solid rgba(6,214,160,0.2); padding:0.5rem; border-radius:12px;">
                  <label style="color:var(--success-green);">TRM del día</label>
                  <input type="number" step="0.01" name="trm" id="val-trm" placeholder="Ej: 4100" style="border-color:var(--success-green);">
               </div>
            </div>
            <div style="display:none;"><input type="hidden" name="fecha" value="${new Date().toLocaleDateString()}"></div>
            <div style="background:var(--glass-bg); padding:1rem; border-radius:8px; border:1px dashed var(--glass-border); text-align:center;">
                <p style="margin:0; font-size:0.75rem; opacity:0.6; text-transform:uppercase;">Impacto Financiero</p>
                <div id="lbl-total-cop" style="font-size:1.5rem; font-weight:700; color:var(--primary-red); margin-top:5px;">$0</div>
            </div>
            <div>
               <label style="margin-bottom:6px;display:block;">Comprobante de Pago <span style="opacity:0.5;font-size:0.75rem;">(opcional)</span></label>
               ${buildComprobanteUploadHTML('comp-egreso-file')}
            </div>
            <div style="display:flex; gap:15px; margin-top:1rem;">
               <button type="submit" class="btn-primary" style="flex:1;">Registrar Egreso</button>
               <button type="button" onclick="window.closeModal()" style="flex:1; background:none; border:1px solid var(--glass-border); color:var(--text-main); border-radius:16px;">Cancelar</button>
            </div>
        </form>`;
    container.style.display = 'flex';

    window.toggleCurrency = (val) => {
        const boxTRM = document.getElementById('box-trm');
        const inputTRM = document.getElementById('val-trm');
        const lblValor = document.getElementById('lbl-valor-origen');
        if (val === 'USD') { boxTRM.style.display='block'; inputTRM.setAttribute('required','true'); lblValor.innerText='Valor Facturado (USD)'; }
        else { boxTRM.style.display='none'; inputTRM.removeAttribute('required'); inputTRM.value=''; lblValor.innerText='Valor Facturado (COP)'; }
        window.calculateCopt();
    };
    window.calculateCopt = () => {
        const isUSD = document.querySelector('input[name="moneda"]:checked').value === 'USD';
        const vO = parseFloat(document.getElementById('val-origen').value||0);
        const trm = parseFloat(document.getElementById('val-trm').value||0);
        document.getElementById('lbl-total-cop').innerText = formatCOP(isUSD ? vO*trm : vO);
    };
    setTimeout(() => {
        document.getElementById('val-origen').addEventListener('input', window.calculateCopt);
        document.getElementById('val-trm').addEventListener('input', window.calculateCopt);
        attachComprobanteInput('comp-egreso-file');
    }, 150);

    document.getElementById('form-finance-gasto').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const isUSD = fd.get('moneda') === 'USD';
        const vO = parseFloat(fd.get('valor_origen'));
        const trm = isUSD ? parseFloat(fd.get('trm')) : null;
        const totalCOP = isUSD ? vO * trm : vO;
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerText = 'Sincronizando...';
        try {
            const comprobanteFile = document.getElementById('comp-egreso-file')?.files[0];
            let comprobanteUrl = '';
            if (comprobanteFile) { btn.innerText = 'Subiendo comprobante...'; comprobanteUrl = await uploadImageToSupabase(comprobanteFile); }
            const payload = { id:Date.now().toString(), tipo_gasto:fd.get('tipo_gasto'), concepto:fd.get('concepto'), moneda:fd.get('moneda'), valor_origen:vO, trm, valor_cop:totalCOP, fecha:new Date().toLocaleDateString(), comprobante_url:comprobanteUrl };
            await db.postData('Gastos', payload, 'INSERT');
            window.closeModal();
            showToast('✅ Gasto Operativo Registrado');
            _finCache = null;
            renderFinance(_finRenderLayout, navigateTo);
        } catch (err) { showToast(err.message, 'error'); btn.disabled=false; btn.innerText='Reintentar'; }
    };
};
