import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatCOP, formatUSD, renderError, showToast, uploadImageToSupabase, getLogisticaFase, getLogisticaColor, buildComprobanteUploadHTML, attachComprobanteInput, downloadExcel, renderPagination, paginate } from '../utils.js';

// ─── Cache ─────────────────────────────────────────────────────────────────────
let localVentasCache = [];
let localVentasFiltered = []; // Added for filter
let localClientesCache = [];
let localProductosCache = [];
let localLogisticaCache = [];
let _salesRenderLayout = null;
let _salesNavigateTo = null;
let _salesActiveView = 'tabla';
let _salesStartDate = '';
let _salesEndDate = '';

// ─── Date helper ───────────────────────────────────────────────────────────────
const normDate = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return String(s).split('T')[0].split(' ')[0];
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
const renderSalesKPI = (ventas) => {
    const totalFacturado = ventas.reduce((a,v) => a + (parseFloat(v.valor_total_cop)||0), 0);
    const totalAbonos    = ventas.reduce((a,v) => a + (parseFloat(v.abonos_acumulados)||0), 0);
    const totalSaldo     = ventas.reduce((a,v) => a + (parseFloat(v.saldo_pendiente)||0), 0);
    const encargos       = ventas.filter(v => v.tipo_venta === 'Encargo').length;
    const stockLocal     = ventas.filter(v => v.tipo_venta !== 'Encargo').length;

    let kpis = [
        { icon:'💰', value: formatCOP(totalFacturado), label:'Facturación Total',      color:'var(--info-blue)' },
        { icon:'✅', value: formatCOP(totalAbonos),    label:'Abonos Recibidos',        color:'var(--success-green)' },
        { icon:'⚠️', value: formatCOP(totalSaldo),     label:'Saldos Pendientes',       color: totalSaldo > 0 ? 'var(--primary-red)' : 'var(--success-green)' },
        { icon:'📦', value: encargos,                  label:'Encargos Internacionales', color:'var(--warning-orange)' },
        { icon:'🛒', value: stockLocal,                label:'Ventas Stock Local',       color:'var(--brand-green)' },
    ];

    if (!auth.canAccess('feat_money')) {
        kpis = kpis.filter(k => !['Facturación Total', 'Abonos Recibidos'].includes(k.label));
    }

    return `
    <div class="kpi-strip">
        ${kpis.map(k => `
        <div class="kpi-strip-card" onclick="window.openSalesKPI('${k.label}')">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
};

window.openSalesKPI = (kpiName) => {
    let title = kpiName;
    let subtitle = '';
    let ventasFiltradas = [...localVentasFiltered].reverse(); // Recientes primero
    
    if (kpiName === 'Facturación Total') {
        subtitle = 'Todas las ventas que suman a la facturación total.';
    } else if (kpiName === 'Abonos Recibidos') {
        ventasFiltradas = ventasFiltradas.filter(v => (parseFloat(v.abonos_acumulados)||0) > 0);
        subtitle = 'Ventas que tienen abonos registrados.';
    } else if (kpiName === 'Saldos Pendientes') {
        ventasFiltradas = ventasFiltradas.filter(v => (parseFloat(v.saldo_pendiente)||0) > 0);
        subtitle = 'Ventas con saldo pendiente por pagar.';
    } else if (kpiName === 'Encargos Internacionales') {
        ventasFiltradas = ventasFiltradas.filter(v => v.tipo_venta === 'Encargo');
        subtitle = 'Ventas marcadas como encargo internacional.';
    } else if (kpiName === 'Ventas Stock Local') {
        ventasFiltradas = ventasFiltradas.filter(v => v.tipo_venta !== 'Encargo');
        subtitle = 'Ventas correspondientes a stock local.';
    }
    
    const itemsHtml = ventasFiltradas.map(v => {
        const c = localClientesCache.find(x => x.id.toString() === v.cliente_id?.toString());
        const prod = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
        const total = parseFloat(v.valor_total_cop)||0;
        const saldo = parseFloat(v.saldo_pendiente)||0;
        const abono = parseFloat(v.abonos_acumulados)||0;
        const date = normDate(v.fecha);
        
        let metaHtml = '';
        if (kpiName === 'Saldos Pendientes') {
            metaHtml = `<div style="color:var(--primary-red);">Debe: ${formatCOP(saldo)}</div>`;
        } else if (kpiName === 'Abonos Recibidos') {
            metaHtml = `<div style="color:var(--success-green);">Abonado: ${formatCOP(abono)}</div>`;
        } else {
            metaHtml = `<div>Total: ${formatCOP(total)}</div>`;
        }
        
        return `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">Orden #${v.id.toString().slice(-4)} <span style="font-size:0.8em;opacity:0.6;font-weight:normal;margin-left:6px;">${date}</span></div>
                <div class="kpi-item-subtitle">${c ? c.nombre : 'Cliente Desconocido'}</div>
                <div class="kpi-item-info">
                    <span>${prod ? prod.nombre_producto : 'Sin producto'}</span>
                    <span style="opacity:0.5;">|</span>
                    <span style="color:${v.tipo_venta==='Encargo'?'var(--warning-orange)':'var(--success-green)'}">${v.tipo_venta || 'Venta'}</span>
                </div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value">${formatCOP(total)}</div>
                ${metaHtml}
                <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}'); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">👁️ Ver Venta</button>
            </div>
        </div>
        `;
    }).join('');
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

// ─── VIEW: Tabla ───────────────────────────────────────────────────────────────
const renderViewTabla = (ventas) => {
    const sorted = [...ventas].reverse();
    return `
    <div class="purchase-view-panel">
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th style="min-width:120px;">Orden / Fecha</th>
                    <th style="min-width:260px;">Producto</th>
                    <th style="min-width:200px;">Cliente</th>
                    <th style="min-width:220px;">Fase Logística</th>
                    <th style="min-width:290px;">Finanzas</th>
                    <th class="text-right" style="min-width:140px;">Acciones</th>
                </tr></thead>
                <tbody>
                ${sorted.length > 0 ? sorted.map(v => {
                    const saldo   = parseInt(v.saldo_pendiente)||0;
                    const abonado = parseInt(v.abonos_acumulados)||0;
                    const total   = parseInt(v.valor_total_cop)||0;
                    const c       = localClientesCache.find(x => x.id.toString() === v.cliente_id.toString());
                    const prod    = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
                    const fecha   = normDate(v.fecha)||'N/A';
                    const fase    = getLogisticaFase(v.id, localLogisticaCache, v.estado_orden||'Procesando');
                    const col     = getLogisticaColor(fase);
                    const sf = `${v.id.toString().slice(-4)} ${fecha} ${prod?prod.marca:''} ${prod?prod.nombre_producto:''} ${c&&c.nombre?c.nombre:''} ${fase} ${v.tipo_venta}`;
                    return `
                    <tr class="sale-item-filterable" data-text="${sf.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}">
                        <td>
                            <div class="cell-number">#${v.id.toString().slice(-4)}</div>
                            <span class="cell-subtitle">${fecha}</span>
                        </td>
                        <td>
                            <div style="display:flex;align-items:center;gap:12px;">
                                ${prod?(prod.url_imagen?`<img src="${prod.url_imagen}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--glass-border);">`:`<div style="width:40px;height:40px;background:var(--glass-hover);border-radius:8px;flex-shrink:0;"></div>`):''}
                                <div style="min-width:0;">
                                    <div style="font-weight:800;font-size:0.75rem;color:var(--primary-red);">${prod?prod.marca:''}</div>
                                    <div class="cell-title" style="max-width:200px;">${prod?prod.nombre_producto:'<span style="opacity:0.4;">Sin producto</span>'}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="cell-title" style="max-width:180px;">${c&&c.nombre?c.nombre:'<span style="opacity:0.4;">Desconocido</span>'}</div>
                            <span class="cell-subtitle">ID: ${c&&c.numero_identificacion?c.numero_identificacion:(v.cliente_id||'N/A')}</span>
                        </td>
                        <td>
                            <div style="margin-bottom:5px;">${v.tipo_venta==='Encargo'?'<span style="color:#FFB703;font-size:0.68rem;font-weight:700">📦 Encargo</span>':'<span style="color:var(--success-green);font-size:0.68rem;font-weight:700">🛍️ Stock Local</span>'}</div>
                            <span class="status-badge" style="background:${col};">${fase}</span>
                        </td>
                        <td>
                            <div style="display:flex;gap:18px;align-items:center;">
                                <div><div class="cell-subtitle">Total</div><div class="cell-price">${formatCOP(total)}</div></div>
                                <div><div class="cell-subtitle">Abonado</div><div class="cell-price" style="color:var(--success-green);">${formatCOP(abonado)}</div></div>
                                <div><div class="cell-subtitle">Saldo</div><div class="cell-price" style="color:${saldo>0?'var(--primary-red)':'var(--success-green)'};">${formatCOP(saldo)}</div></div>
                            </div>
                        </td>
                        <td class="td-actions">
                            <div class="td-actions-group">
                                <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}')" title="Ver Detalle">👁️ Ver</button>
                                ${auth.canEdit('sales') && saldo>0?`<button class="btn-action" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>`:`${saldo>0?'':'<span style="opacity:0.4;font-size:0.72rem;white-space:nowrap">✔ Pagado</span>'}`}
                            </div>
                        </td>
                    </tr>`;
                }).join('') : '<tr class="table-empty-row"><td colspan="6">No hay ventas registradas.</td></tr>'}
                <tr class="table-empty-row" id="sale-empty-search" style="display:none;"><td colspan="6">Sin resultados.</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
};

// ─── VIEW: Pendientes de Pago ───────────────────────────────────────────────────
const renderViewPendientes = (ventas) => {
    const pending = ventas.filter(v => parseFloat(v.saldo_pendiente||0) > 0)
                          .sort((a,b) => parseFloat(b.saldo_pendiente) - parseFloat(a.saldo_pendiente));
    if (pending.length === 0) {
        return `<div class="purchase-view-panel"><div style="text-align:center;padding:4rem;opacity:0.5;">🎉 ¡Sin cartera pendiente! Todas las ventas están pagadas.</div></div>`;
    }
    const totalCartera = pending.reduce((a,v)=>a+parseFloat(v.saldo_pendiente||0),0);
    return `
    <div class="purchase-view-panel">
        <div style="margin-bottom:1rem;padding:1rem 1.4rem;background:rgba(217,16,16,0.07);border:1px solid var(--brand-magenta);border-radius:var(--radius);display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.2rem;">⚠️</span>
            <span style="font-size:0.9rem;color:var(--primary-red);font-weight:700;">${pending.length} venta(s) con cartera pendiente · Total: <strong>${formatCOP(totalCartera)}</strong></span>
        </div>
        ${pending.map(v => {
            const saldo = parseFloat(v.saldo_pendiente||0);
            const total = parseFloat(v.valor_total_cop||0);
            const pct   = total > 0 ? Math.round((saldo/total)*100) : 0;
            const c     = localClientesCache.find(x => x.id.toString() === v.cliente_id.toString());
            const prod  = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
            return `
            <div class="purchase-group-card open" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" style="cursor:default;">
                    <h3>📄 Orden #${v.id.toString().slice(-4)}
                        <span style="font-size:0.78rem;font-weight:500;opacity:0.6;margin-left:8px;">${c?c.nombre:''}</span>
                    </h3>
                    <div class="purchase-group-meta">
                        ${prod?`<span style="font-size:0.75rem;opacity:0.7;">${prod.marca} ${prod.nombre_producto}</span>`:''}
                        <span>Total: ${formatCOP(total)}</span>
                        <strong style="color:var(--primary-red);">Debe: ${formatCOP(saldo)}</strong>
                        <span style="font-size:0.72rem;opacity:0.6;">${pct}% pendiente</span>
                        <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️ Ver</button>
                        ${auth.canEdit('sales') ? `<button class="btn-primary" style="font-size:0.72rem;padding:6px 12px;" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>` : ''}
                    </div>
                </div>
                <div class="purchase-group-bar-wrap">
                    <div class="purchase-group-bar" style="width:${100-pct}%;background:var(--success-green);"></div>
                </div>
            </div>`;
        }).join('')}
    </div>`;
};

// ─── VIEW: Por Tipo ────────────────────────────────────────────────────────────
const renderViewTipo = (ventas) => {
    const encargos  = ventas.filter(v => v.tipo_venta === 'Encargo');
    const stockVtas = ventas.filter(v => v.tipo_venta !== 'Encargo');
    const totalEnc  = encargos.reduce((a,v)=>a+parseFloat(v.valor_total_cop||0),0);
    const totalStk  = stockVtas.reduce((a,v)=>a+parseFloat(v.valor_total_cop||0),0);

    const renderCol = (list, label, icon, color) => `
        <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;padding-bottom:10px;border-bottom:2px solid ${color};">
                <span style="font-size:1.5rem;">${icon}</span>
                <div>
                    <h3 style="margin:0;font-size:1.1rem;">${label} <span style="background:${color};color:#fff;font-size:0.65rem;padding:3px 8px;border-radius:10px;margin-left:4px;">${list.length}</span></h3>
                    <span style="font-size:0.78rem;opacity:0.6;">Total: ${formatCOP(list.reduce((a,v)=>a+parseFloat(v.valor_total_cop||0),0))}</span>
                </div>
            </div>
            ${list.length === 0 ? `<div style="text-align:center;opacity:0.4;padding:2rem;border:1px dashed var(--glass-border);border-radius:12px;">Sin registros</div>` :
            list.map(v => {
                const saldo = parseFloat(v.saldo_pendiente||0);
                const prod  = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
                const c     = localClientesCache.find(x => x.id.toString() === v.cliente_id.toString());
                const fase  = getLogisticaFase(v.id, localLogisticaCache, v.estado_orden||'Procesando');
                const faseCol = getLogisticaColor(fase);
                return `
                <div class="purchase-group-row" style="padding:1rem;background:var(--glass-hover);border-radius:12px;margin-bottom:10px;border:1px solid var(--glass-border);display:flex;gap:15px;align-items:center;">
                    <!-- Imagen -->
                    ${prod && prod.url_imagen ? `<img src="${prod.url_imagen}" style="width:65px;height:65px;object-fit:cover;border-radius:8px;border:1px solid var(--glass-border);flex-shrink:0;">` : `<div style="width:65px;height:65px;background:var(--input-bg);border-radius:8px;border:1px dashed var(--glass-border);display:flex;align-items:center;justify-content:center;opacity:0.5;font-size:0.7rem;flex-shrink:0;">Sin Foto</div>`}
                    
                    <!-- Info Principal -->
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <strong style="font-size:0.9rem;color:var(--primary-red);">#${v.id.toString().slice(-4)}</strong>
                            <span class="status-badge" style="background:${faseCol};font-size:0.6rem;padding:3px 8px;">${fase}</span>
                            <span style="font-size:0.75rem;opacity:0.6;margin-left:auto;">${normDate(v.fecha)||''}</span>
                        </div>
                        <div style="font-size:0.9rem;font-weight:700;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c?c.nombre:'—'}</div>
                        ${prod?`<div style="font-size:0.8rem;opacity:0.7;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${prod.marca} · ${prod.nombre_producto}</div>`:''}
                    </div>
                    
                    <!-- Info Financiera y Acciones -->
                    <div style="text-align:right;flex-shrink:0;min-width:130px;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;">
                        <div style="font-weight:800;font-size:1rem;">${formatCOP(v.valor_total_cop||0)}</div>
                        ${saldo>0?`<div style="font-size:0.8rem;color:var(--primary-red);font-weight:700;margin-top:4px;">Debe: ${formatCOP(saldo)}</div>`:`<div style="font-size:0.8rem;color:var(--success-green);font-weight:700;margin-top:4px;">✔ Pagado</div>`}
                        <div style="display:flex;gap:8px;margin-top:10px;">
                            <button class="btn-action" style="font-size:0.75rem;padding:5px 10px;" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️ Ver</button>
                            ${auth.canEdit('sales') && saldo>0?`<button class="btn-action" style="font-size:0.75rem;padding:5px 10px;" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>`:''}
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;

    return `
    <div class="purchase-view-panel">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
            ${renderCol(encargos,'Encargos Internacionales','📦','var(--warning-orange)')}
            ${renderCol(stockVtas,'Stock Local','🛍️','var(--success-green)')}
        </div>
    </div>`;
};

// ─── VIEW: Por Fase ────────────────────────────────────────────────────────────
const renderViewFase = (ventas) => {
    const groups = {};
    ventas.forEach(v => {
        const fase = getLogisticaFase(v.id, localLogisticaCache, v.estado_orden||'Procesando');
        if (!groups[fase]) groups[fase] = { items:[], color: getLogisticaColor(fase) };
        groups[fase].items.push(v);
    });
    const sorted = Object.entries(groups).sort((a,b) => b[1].items.length - a[1].items.length);

    return `
    <div class="purchase-view-panel">
        ${sorted.map(([fase, g], idx) => {
            const cid = `sale-fase-${idx}`;
            const totalFase = g.items.reduce((a,v)=>a+parseFloat(v.valor_total_cop||0),0);
            return `
            <div class="purchase-group-card open" id="${cid}" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cid}')">
                    <h3>
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${g.color};margin-right:8px;"></span>
                        ${fase}
                    </h3>
                    <div class="purchase-group-meta">
                        <span>${g.items.length} venta(s)</span>
                        <strong>${formatCOP(totalFase)}</strong>
                        <span class="purchase-group-toggle">▲</span>
                    </div>
                </div>
                <div class="purchase-group-body">
                    ${g.items.map(v => {
                        const prod = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
                        const c    = localClientesCache.find(x => x.id.toString() === v.cliente_id.toString());
                        const saldo = parseFloat(v.saldo_pendiente||0);
                        return `
                        <div class="purchase-group-row">
                            <span style="font-size:0.8rem;font-weight:700;color:var(--primary-red);">#${v.id.toString().slice(-4)}</span>
                            <div style="flex:1;min-width:0;">
                                <div class="cell-title" style="max-width:220px;font-size:0.82rem;">${prod?`${prod.marca} ${prod.nombre_producto}`:'Sin producto'}</div>
                                <div style="font-size:0.72rem;opacity:0.6;">${c?c.nombre:'—'}</div>
                            </div>
                            <span style="font-size:0.72rem;opacity:0.5;">${normDate(v.fecha)||''}</span>
                            <span style="font-weight:700;font-size:0.82rem;">${formatCOP(v.valor_total_cop||0)}</span>
                            ${saldo>0?`<span style="font-size:0.7rem;color:var(--primary-red);">−${formatCOP(saldo)}</span>`:`<span style="font-size:0.7rem;color:var(--success-green);">✔</span>`}
                            <button class="btn-action" style="font-size:0.68rem;" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${sorted.length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin ventas registradas.</p>':''}
    </div>`;
};

// ─── VIEW: Timeline ────────────────────────────────────────────────────────────
const renderViewTimeline = (ventas) => {
    const sorted = [...ventas].sort((a,b) => new Date(normDate(b.fecha)||0) - new Date(normDate(a.fecha)||0));
    const groups = {};
    sorted.forEach(v => {
        const k = normDate(v.fecha)||'sin-fecha';
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
                    const prod = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
                    const c    = localClientesCache.find(x => x.id.toString() === v.cliente_id.toString());
                    const fase = getLogisticaFase(v.id, localLogisticaCache, v.estado_orden||'Procesando');
                    const col  = getLogisticaColor(fase);
                    const saldo = parseFloat(v.saldo_pendiente||0);
                    return `
                    <div class="timeline-item">
                        <span class="timeline-item-id">#${v.id.toString().slice(-4)}</span>
                        <div class="timeline-item-main">
                            <div class="timeline-item-prov">${c?c.nombre:'Cliente'}</div>
                            <div class="timeline-item-sub">${prod?`${prod.marca} ${prod.nombre_producto}`:v.tipo_venta||'Venta'}</div>
                        </div>
                        <span class="status-badge" style="background:${col};font-size:0.58rem;">${fase}</span>
                        <span class="timeline-item-price">${formatCOP(v.valor_total_cop||0)}</span>
                        ${saldo>0?`<span style="font-size:0.7rem;color:var(--primary-red);font-weight:700;">−${formatCOP(saldo)}</span>`:`<span style="font-size:0.7rem;color:var(--success-green);">✔</span>`}
                    </div>`;
                }).join('')}
            </div>`).join('')}
            ${Object.keys(groups).length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin ventas.</p>':''}
        </div>
    </div>`;
};

// ─── Inject panel ──────────────────────────────────────────────────────────────
function injectSalesView(view) {
    const area = document.getElementById('sales-view-area');
    if (!area) return;
    const ventas = localVentasCache;
    let html = '';
    if (view === 'pendientes') html = renderViewPendientes(ventas);
    else if (view === 'tipo')   html = renderViewTipo(ventas);
    else if (view === 'fase')   html = renderViewFase(ventas);
    else if (view === 'timeline') html = renderViewTimeline(ventas);
    else                        html = renderViewTabla(ventas);
    area.style.opacity = '0';
    setTimeout(() => { area.innerHTML = html; area.style.opacity = '1'; area.style.transition = 'opacity 0.25s'; attachSalesSearch(); attachGroupToggles(); }, 100);
}

function attachSalesSearch() {
    const fi = document.getElementById('find-sale');
    if (!fi) return;
    fi.oninput = (e) => {
        const k = e.target.value.toLowerCase().trim();
        let vis = 0;
        document.querySelectorAll('.sale-item-filterable').forEach(r => {
            const m = (r.getAttribute('data-text')||'').toLowerCase().includes(k);
            r.style.display = m ? '' : 'none';
            if (m) vis++;
        });
        const em = document.getElementById('sale-empty-search');
        if (em) em.style.display = vis===0&&k.length>0?'':'none';
    };
}

function attachGroupToggles() {
    if (typeof window.togglePurchaseGroup === 'undefined') {
        window.togglePurchaseGroup = (id) => {
            const card = document.getElementById(id);
            if (!card) return;
            const isOpen = card.classList.toggle('open');
            const tog = card.querySelector('.purchase-group-toggle');
            if (tog) tog.textContent = isOpen ? '▲' : '▼';
        };
    }
}

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderSales = async (renderLayout, navigateTo) => {
    _salesRenderLayout = renderLayout;
    _salesNavigateTo = navigateTo;
    _salesActiveView = 'tabla';

    renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Sincronizando Facturación...</div>`);

    const [list, clientesList, productosList, logisticaList] = await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Clientes'),
        db.fetchData('Productos'),
        db.fetchData('Logistica'),
    ]);
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    localVentasCache    = list;
    localClientesCache  = clientesList.error  ? [] : clientesList;
    localProductosCache = productosList.error ? [] : productosList;
    localLogisticaCache = logisticaList.error ? [] : logisticaList;
    
    // Apply filters matching
    localVentasFiltered = [...localVentasCache];
    if (_salesStartDate || _salesEndDate) {
        localVentasFiltered = localVentasCache.filter(v => {
            const vd = new Date(normDate(v.fecha) + 'T12:00:00');
            if(isNaN(vd)) return true;
            const s = _salesStartDate ? new Date(_salesStartDate + 'T00:00:00') : null;
            const e = _salesEndDate ? new Date(_salesEndDate + 'T23:59:59') : null;
            if(s && vd < s) return false;
            if(e && vd > e) return false;
            return true;
        });
    }

    // ── Modal Abono ────────────────────────────────────────────────────────────
    window.modalAbono = (ventaId, saldoPendiente) => {
        const container = document.getElementById('modal-container');
        const content   = document.getElementById('modal-content');
        content.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Registrar Abono</h2>
                    <button class="modal-close-btn" onclick="window.closeModal()">✕</button>
                </div>
                
                <form id="form-abono">
                    <div class="modal-body">
                        <div style="background:var(--brand-magenta-dim); padding:1.5rem; border-radius:16px; margin-bottom:2rem; text-align:center; border:1px solid var(--brand-magenta-glow);">
                            <span style="font-size:0.8rem; opacity:0.8; text-transform:uppercase;">Saldo Pendiente</span>
                            <div style="font-size:2rem; font-weight:800; color:var(--brand-magenta); margin-top:6px;">${formatCOP(saldoPendiente)}</div>
                        </div>

                        <div class="form-grid-3">
                            <div class="form-group">
                                <label class="form-label">Valor a Abonar (COP)</label>
                                <input type="number" id="valor_abono" required min="1" max="${saldoPendiente}" placeholder="0">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Método de Pago</label>
                                <select name="metodo_pago" required>
                                    <option value="Transferencia Bancolombia">Transferencia Bancolombia</option>
                                    <option value="Nequi">Nequi</option>
                                    <option value="Efectivo">Efectivo</option>
                                    <option value="Tarjeta">Tarjeta de Crédito</option>
                                </select>
                            </div>
                            <div class="form-group full-width" style="grid-column: span 3;">
                                <label class="form-label">Comprobante de Pago <span style="opacity:0.5; font-size:0.75rem;">(opcional)</span></label>
                                ${buildComprobanteUploadHTML('comp-abono-file')}
                            </div>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <button type="button" class="btn-action" style="padding:10px 25px;" onclick="window.closeModal()">Cancelar</button>
                        <button type="submit" class="btn-primary" style="padding:10px 30px;">Confirmar Abono</button>
                    </div>
                </form>
            </div>`;
        container.style.display = 'flex';
        setTimeout(() => attachComprobanteInput('comp-abono-file'), 100);
        document.getElementById('form-abono').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.innerText = 'Registrando...';
            const abono = parseInt(document.getElementById('valor_abono').value);
            const nuevoSaldo = saldoPendiente - abono;
            try {
                const comprobanteFile = document.getElementById('comp-abono-file')?.files[0];
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
                showToast('✅ Abono registrado');
                renderSales(renderLayout, navigateTo);
            } catch (err) { showToast(err.message, 'error'); btn.disabled=false; btn.innerText='Reintentar'; }
        };
    };

    window.switchSalesView = (view) => {
        _salesActiveView = view;
        document.querySelectorAll('.pv-tab[data-sale-view]').forEach(b => b.classList.toggle('active', b.dataset.saleView === view));
        injectSalesView(view);
    };

    const applyFilter = () => {
        localVentasFiltered = localVentasCache.filter(v => {
            if (!_salesStartDate && !_salesEndDate) return true;
            const vd = new Date(normDate(v.fecha) + 'T12:00:00');
            if (isNaN(vd)) return true;
            const startStr = _salesStartDate ? new Date(_salesStartDate + 'T00:00:00') : null;
            const endStr = _salesEndDate ? new Date(_salesEndDate + 'T23:59:59') : null;
            if (startStr && vd < startStr) return false;
            if (endStr && vd > endStr) return false;
            return true;
        });
        document.getElementById('sales-kpi-container').innerHTML = renderSalesKPI(localVentasFiltered);
        injectSalesView(_salesActiveView);
    };

    window.applySalesDateFilter = () => {
        _salesStartDate = document.getElementById('sales-date-start').value;
        _salesEndDate = document.getElementById('sales-date-end').value;
        applyFilter();
    };

    window.exportSalesExcel = () => {
        const dataToExport = localVentasFiltered.map(v => {
            const c = localClientesCache.find(x => x.id.toString() === v.cliente_id?.toString());
            const prod = localProductosCache.find(p => p.id.toString() === v.producto_id?.toString());
            const fase = getLogisticaFase(v.id, localLogisticaCache, v.estado_orden);
            return {
                'ID Venta': v.id,
                'Fecha': normDate(v.fecha),
                'Tipo Venta': v.tipo_venta,
                'Cliente ID': c ? c.numero_identificacion : v.cliente_id,
                'Cliente Nombre': c ? c.nombre : 'Desconocido',
                'Producto SKU': prod ? prod.sku : '',
                'Producto Nombre': prod ? prod.nombre_producto : '',
                'Valor Total (COP)': parseFloat(v.valor_total_cop || 0),
                'Abonos (COP)': parseFloat(v.abonos_acumulados || 0),
                'Saldo (COP)': parseFloat(v.saldo_pendiente || 0),
                'Fase Logística': fase
            };
        });
        if(dataToExport.length === 0) return showToast('No hay datos para exportar', 'error');
        downloadExcel(dataToExport, `Reporte_Ventas_${new Date().toISOString().split('T')[0]}`);
    };

    const tabs = [
        { id:'tabla',      icon:'📋', label:'Tabla' },
        { id:'pendientes', icon:'⚠️', label:'Pendientes' },
        { id:'tipo',       icon:'🗂️', label:'Por Tipo' },
        { id:'fase',       icon:'🔵', label:'Por Fase' },
        { id:'timeline',   icon:'📅', label:'Timeline' },
    ];

    // Pagination State
    const _page = parseInt(localStorage.getItem('sales_page') || '1');
    const _rpp  = parseInt(localStorage.getItem('sales_rpp') || '10');
    const pagedList = _salesActiveView === 'tabla' ? paginate(localVentasFiltered, _page, _rpp) : localVentasFiltered;

    const html = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.5rem;flex-wrap:wrap;gap:15px;">
        <div>
            <span class="page-eyebrow">Stock Local · Encargos · Abonos</span>
            <h2 class="page-title">Módulo de Ventas</h2>
            <p style="opacity:0.5;font-size:0.82rem;margin-top:4px;">Facturación, cartera pendiente y seguimiento por fase logística.</p>
        </div>
        <div class="module-filters-bar">
            <div class="date-filter-wrap">
                <label>Desde</label>
                <input type="date" id="sales-date-start" class="date-filter-input" value="${_salesStartDate}">
                <label style="margin-left:5px;">Hasta</label>
                <input type="date" id="sales-date-end" class="date-filter-input" value="${_salesEndDate}">
                <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applySalesDateFilter()">Filtrar</button>
            </div>
            <button class="btn-excel" onclick="window.exportSalesExcel()">📥 Excel</button>
            <input type="text" id="find-sale" placeholder="Buscar cliente, producto..." style="background:var(--glass-hover);padding:10px 15px;border-radius:12px;color:var(--text-main);border:1px solid var(--glass-border);width:230px;outline:none;">
            ${auth.canEdit('sales') ? `<button class="btn-primary" onclick="window.modalVenta()">+ Nueva Venta</button>` : ''}
        </div>
    </div>

    <div id="sales-kpi-container">
        ${renderSalesKPI(localVentasFiltered)}
    </div>

    <div class="purchase-view-switcher" style="margin-bottom:1.5rem;">
        ${tabs.map(t => `
        <button class="pv-tab${t.id===_salesActiveView?' active':''}" data-sale-view="${t.id}" onclick="window.switchSalesView('${t.id}')">
            ${t.icon} ${t.label}
        </button>`).join('')}
    </div>

    <div id="sales-view-area">
        ${_salesActiveView === 'tabla' ? renderViewTabla(pagedList) : injectSalesView(_salesActiveView)}
    </div>
    ${_salesActiveView === 'tabla' ? renderPagination(localVentasFiltered.length, _page, _rpp, 'sales') : ''}`;

    renderLayout(html);
    setTimeout(() => { attachSalesSearch(); attachGroupToggles(); }, 150);
};

// ─── Create Sale Modal (unchanged) ────────────────────────────────────────────
export const createSaleModal = async (navigateTo) => {
    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');
    content.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="loader"></div> Preparando módulo de facturación...</div>`;
    container.style.display = 'flex';

    const [clientsList, productsList, configList] = await Promise.all([
        db.fetchData('Clientes'),
        db.fetchData('Productos'),
        db.fetchData('Configuracion'),
    ]);
    if (clientsList.error || productsList.error) {
        content.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--primary-red);">Error al cargar dependencias.</div>`;
        setTimeout(() => window.closeModal(), 3000);
        return;
    }

    let categorias=[], marcas=[], tiendas=[], generos=[];
    if (Array.isArray(configList)) {
        configList.forEach(c => {
            if(c.clave==='Categoria'&&c.valor) categorias.push(c.valor);
            if(c.clave==='Marca'&&c.valor)     marcas.push(c.valor);
            if(c.clave==='Tienda'&&c.valor)    tiendas.push(c.valor);
            if(c.clave==='Genero'&&c.valor)    generos.push(c.valor);
        });
    }

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <h2>Registrar Nueva Venta</h2>
                <button class="modal-close-btn" onclick="window.closeModal()">✕</button>
            </div>
            
            <form id="form-sale" onsubmit="return false;">
                <div class="modal-body">
                    <!-- Sección de Transacción y Cliente -->
                    <div class="form-grid-3" style="margin-bottom: 2rem; border-bottom: 1px dashed var(--border-base); padding-bottom: 2rem;">
                        <div class="form-group">
                            <label class="form-label">Fecha Real Venta</label>
                            <input type="date" name="fecha_real_venta" id="fecha_real_venta" value="${new Date().toISOString().split('T')[0]}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Tipo de Transacción</label>
                            <div style="display:flex; gap:2.5rem; padding:10px 0;">
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color: var(--text-main);">
                                    <input type="radio" name="tipo_venta" value="Stock" checked onchange="window.toggleSaleType(this.value)" style="width:20px; height:20px; margin:0;"> 🛒 Stock Local
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color: var(--brand-magenta);">
                                    <input type="radio" name="tipo_venta" value="Encargo" onchange="window.toggleSaleType(this.value)" style="width:20px; height:20px; margin:0;"> 📦 Por Encargo (USA)
                                </label>
                            </div>
                        </div>

                        <div class="form-group">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <label class="form-label" style="margin:0;">Información del Cliente</label>
                                <div style="display:flex; gap:10px;">
                                    <button type="button" class="btn-action" style="font-size:0.75rem; padding:6px 12px; font-weight:700;" onclick="window.toggleInlineClient('NEW')">+ Cliente Nuevo</button>
                                    <button type="button" class="btn-action" style="font-size:0.75rem; padding:6px 12px; font-weight:700; display:none;" id="btn-edit-inline-client" onclick="window.toggleInlineClient('EDIT')">✏️ Editar</button>
                                </div>
                            </div>
                            <input type="text" list="dl-clientes" id="sel-cliente-text" placeholder="Buscar por nombre o identificación..." required autocomplete="off">
                            <datalist id="dl-clientes">${clientsList.map(c=>`<option data-id="${c.id}" value="${c.nombre} (CC: ${c.numero_identificacion||'-'})"></option>`).join('')}</datalist>
                            <input type="hidden" name="cliente_id" id="sel-cliente-id" required>
                        </div>
                    </div>
                        
                    <div id="address-selection-box" style="display:none; background:var(--surface-1); padding:1.5rem; border-radius:16px; border:1px solid var(--border-base); margin-bottom: 2rem;">
                        <label class="form-label" style="color:var(--brand-magenta); margin-bottom:10px; font-weight:800;">📍 Dirección de Envío Seleccionada</label>
                        <select id="sel-direccion-envio" name="direccion_envio" required>
                            <option value="">Seleccione un cliente primero...</option>
                        </select>
                    </div>
                        
                        <div id="inline-client-form" style="display:none; background:var(--surface-2); padding:1.5rem; border-radius:12px; margin-top:15px; border:1px dashed var(--brand-magenta);">
                            <h4 id="inl-cli-title" style="margin:0 0 1.2rem 0; color:var(--brand-magenta); font-weight:700;">Crear Cliente Rápido</h4>
                            <div id="inl-cli-grid-new" class="form-grid-3" style="margin-bottom:1.5rem;">
                                <div class="form-group">
                                    <label class="form-label">Nombre Completo</label>
                                    <input type="text" id="inl_cli_nombre">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Cédula/NIT</label>
                                    <input type="text" id="inl_cli_nid">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">WhatsApp</label>
                                    <input type="text" id="inl_cli_wa">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Ciudad</label>
                                    <input type="text" id="inl_cli_ciu" value="Medellín">
                                </div>
                                <div class="form-group full-width">
                                    <label class="form-label">Dirección (Opcional)</label>
                                    <input type="text" id="inl_cli_dir">
                                </div>
                                <div class="form-group full-width">
                                    <label class="form-label">ID Lead Kommo (Opcional)</label>
                                    <input type="text" id="inl_cli_kommo">
                                </div>
                            </div>
                            <div id="inl-cli-grid-edit" style="display:none; flex-direction:column; gap:1.2rem; margin-bottom:1.5rem;">
                                <div class="form-group">
                                    <label class="form-label">Nueva Dirección (Opcional)</label>
                                    <input type="text" id="inl_cli_new_dir" placeholder="Se agregará al historial">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Nuevo WhatsApp (Opcional)</label>
                                    <input type="text" id="inl_cli_new_wa" placeholder="Ej. 3001234567">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Nuevo ID Kommo (Opcional)</label>
                                    <input type="text" id="inl_cli_new_kommo">
                                </div>
                            </div>
                            <div style="display:flex; gap:12px;">
                                <button type="button" class="btn-primary" style="font-size:0.8rem; padding:8px 20px;" onclick="window.saveInlineClient()">Guardar Cliente</button>
                                <button type="button" class="btn-action" style="font-size:0.8rem; padding:8px 20px;" onclick="document.getElementById('inline-client-form').style.display='none'">Cancelar</button>
                            </div>
                        </div>

                    <div id="section-stock" class="form-group full-width">
                        <label class="form-label">Seleccionar Producto Físico</label>
                        <input type="text" list="dl-productos" id="sel-producto-text" placeholder="Escribe nombre o SKU..." required autocomplete="off">
                        <datalist id="dl-productos">
                            ${productsList.filter(p=>p.estado_producto==='Disponible entrega inmediata'&&parseInt(p.stock_medellin)>0).map(p=>`<option data-id="${p.id}" data-price="${p.precio_cop}" value="${p.nombre_producto} | SKU: ${p.sku} | COP ${formatCOP(p.precio_cop)} [Disp: ${p.stock_medellin}]"></option>`).join('')}
                        </datalist>
                        <input type="hidden" name="producto_id" id="sel-producto-id" required>
                    </div>

                <div id="section-encargo" style="display:none;">
                    <div style="height:1px; background:var(--border-base); margin:2rem 0;"></div>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--brand-magenta);">
                        <span>📋</span>
                        <h3 style="margin:0; font-size:0.85rem; color:var(--brand-magenta); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Detalles del Producto por Encargo</h3>
                    </div>
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Categoría <span style="color:var(--primary-red);">*</span></label>
                            <select id="enc_tipo">
                                <option value="">-- Selecciona --</option>
                                ${categorias.map(x=>`<option value="${x}">${x}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Tienda a Cotizar <span style="color:var(--primary-red);">*</span></label>
                            <select id="enc_tienda">
                                <option value="">-- Selecciona --</option>
                                ${tiendas.map(x=>`<option value="${x}">${x}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group full-width">
                            <label class="form-label">Nombre / Modelo Exacto <span style="color:var(--primary-red);">*</span></label>
                            <input type="text" id="enc_nombre" placeholder="Ej. Jordan 4 Retro University Blue">
                        </div>
                        <div class="form-group" style="grid-column: span 3;">
                            <label class="form-label">Enlace del Producto (URL) <span style="color:var(--primary-red);">*</span></label>
                            <input type="url" id="enc_link" placeholder="https://...">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Valor Cotizado (USD) <span style="color:var(--primary-red);">*</span></label>
                            <input type="number" step="0.01" id="enc_precio_usd" placeholder="0.00">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Marca <span style="color:var(--primary-red);">*</span></label>
                            <select id="enc_marca">
                                <option value="">-- Selecciona --</option>
                                ${marcas.map(x=>`<option value="${x}">${x}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" id="lbl-enc-genero">Género</label>
                            <select id="enc_genero">
                                <option value="">-- Selecciona --</option>
                                ${generos.map(x=>`<option value="${x}">${x}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" id="lbl-enc-talla">Talla</label>
                            <input type="text" id="enc_talla" placeholder="Ej. 9US">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Cantidad <span style="color:var(--primary-red);">*</span></label>
                            <input type="number" id="enc_cantidad" value="1" min="1">
                        </div>
                        <div class="form-group full-width">
                            <label class="form-label">Foto de Referencia <span style="color:var(--primary-red);">*</span></label>
                            <div style="display:flex; gap:15px; align-items:center; background:var(--surface-2); padding:1rem; border-radius:12px; border:1px solid var(--border-base);">
                                <div id="enc-img-preview" style="width:70px; height:70px; border-radius:10px; overflow:hidden; background:var(--bg-main); border:1px solid var(--border-base); display:flex; justify-content:center; align-items:center; flex-shrink:0;">
                                    <span style="font-size:0.6rem; opacity:0.4;">FOTO</span>
                                </div>
                                <div style="flex:1;">
                                    <input type="file" id="enc-file-img" accept="image/*" style="font-size:0.8rem; border:none; background:transparent; padding:0;">
                                    <input type="hidden" id="enc_url" value="">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="height:1px; background:var(--border-base); margin:2rem 0;"></div>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--success-green);">
                    <span>💰</span>
                    <h3 style="margin:0; font-size:0.85rem; color:var(--success-green); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Información Financiera</h3>
                </div>
                
                <div class="form-grid-3">
                    <div class="form-group">
                        <label class="form-label">Peso Estimado (Libras) <span style="color:var(--primary-red);">*</span></label>
                        <input type="text" name="peso_producto" id="sale-peso" placeholder="0.0" required inputmode="decimal">
                    </div>
                    <div class="form-group">
                        <label class="form-label">TRM Cotizada <span style="color:var(--primary-red);">*</span></label>
                        <input type="text" name="trm_cotizada" id="sale-trm" placeholder="Ej. 3700" required inputmode="numeric">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Valor Venta (COP) <span style="color:var(--primary-red);">*</span></label>
                        <input type="number" name="valor_total_cop" id="sale-total" required min="1" placeholder="0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ganancia Calculada (COP) <span style="color:var(--primary-red);">*</span></label>
                        <input type="number" name="ganancia_calculada" id="sale-ganancia-calc" required min="1" placeholder="0">
                    </div>
                    
                    <div class="form-group full-width" style="background:var(--brand-magenta-dim); padding:1.5rem; border-radius:16px; border:1px solid var(--brand-magenta-glow); display:grid; grid-template-columns:1fr 1fr; gap:2rem; align-items:center;">
                        <div class="form-group" style="margin:0;">
                            <label class="form-label" style="color:var(--brand-magenta);">Abono Inicial (COP)</label>
                            <input type="number" name="abono_inicial" id="sale-abono" value="0" min="0" style="background:var(--bg-main);">
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:0.7rem; opacity:0.6; text-transform:uppercase; letter-spacing:1px; color:var(--brand-magenta);">Saldo Pendiente</span>
                            <div id="lbl-saldo" style="font-size:2rem; font-weight:800; color:var(--brand-magenta); margin-top:4px;">$0</div>
                        </div>
                    </div>

                    <div class="form-group full-width">
                        <label class="form-label">Comprobante de Pago Inicial <span style="opacity:0.5; font-size:0.75rem;">(opcional)</span></label>
                        ${buildComprobanteUploadHTML('comp-sale-file')}
                    </div>
                </div>
            </div><!-- /modal-body -->

            <div class="modal-footer">
                <button type="button" class="btn-action" style="padding:10px 25px;" onclick="window.closeModal()">Cancelar</button>
                <button type="submit" class="btn-primary" style="padding:10px 30px;">Confirmar y Procesar Venta</button>
            </div>
        </form>
    </div>`;

    window.updateEncargoRequirements = () => {
        const cat = document.getElementById('enc_tipo')?.value || '';
        const condCats = ['Tenis', 'Calzado', 'Ropa', 'Accesorios'];
        const isCond = condCats.includes(cat);
        const genero = document.getElementById('enc_genero');
        const talla = document.getElementById('enc_talla');
        const lblGen = document.getElementById('lbl-enc-genero');
        const lblTalla = document.getElementById('lbl-enc-talla');
        
        if (isCond) {
            genero?.setAttribute('required', 'true');
            talla?.setAttribute('required', 'true');
            if (lblGen) lblGen.innerHTML = `Género <span style="color:var(--primary-red);">*</span>`;
            if (lblTalla) lblTalla.innerHTML = `Talla <span style="color:var(--primary-red);">*</span>`;
        } else {
            genero?.removeAttribute('required');
            talla?.removeAttribute('required');
            if (lblGen) lblGen.innerHTML = `Género`;
            if (lblTalla) lblTalla.innerHTML = `Talla`;
        }
    };

    window.toggleSaleType = (val) => {
        const secStock   = document.getElementById('section-stock');
        const secEncargo = document.getElementById('section-encargo');
        const selStockTx = document.getElementById('sel-producto-text');
        const reqEncAlways = ['enc_tipo','enc_tienda','enc_nombre','enc_link','enc_precio_usd','enc_marca','enc_cantidad'];
        const reqEncCond = ['enc_genero', 'enc_talla'];

        if (val==='Stock') { 
            secStock.style.display='block'; 
            secEncargo.style.display='none'; 
            selStockTx.setAttribute('required','true'); 
            [...reqEncAlways, ...reqEncCond].forEach(id=>document.getElementById(id)?.removeAttribute('required')); 
        } else { 
            secStock.style.display='none'; 
            secEncargo.style.display='block'; 
            selStockTx.removeAttribute('required'); 
            reqEncAlways.forEach(id=>document.getElementById(id)?.setAttribute('required','true'));
            window.updateEncargoRequirements();
        }
    };

    setTimeout(() => {
        const fi=document.getElementById('enc-file-img'),pv=document.getElementById('enc-img-preview');
        if(fi&&pv) fi.onchange=(e)=>{ const f=e.target.files[0]; if(f){ const r=new FileReader(); r.onload=(re)=>{ pv.innerHTML=`<img src="${re.target.result}" style="height:100%;object-fit:cover;border-radius:6px;">`; }; r.readAsDataURL(f); } };
        const inpCli=document.getElementById('sel-cliente-text'),hidCli=document.getElementById('sel-cliente-id');
        if(inpCli) inpCli.addEventListener('input',(e)=>{ 
            hidCli.value=''; 
            let found = false;
            document.querySelectorAll('#dl-clientes option').forEach(o=>{ 
                if(o.value===e.target.value){
                    hidCli.value=o.getAttribute('data-id');
                    found = true;
                } 
            }); 
            const btnEdit = document.getElementById('btn-edit-inline-client');
            const addrBox = document.getElementById('address-selection-box');
            const selAddr = document.getElementById('sel-direccion-envio');
            
            if(btnEdit) btnEdit.style.display = found ? 'block' : 'none';
            
            if (found) {
                const cId = hidCli.value;
                const client = clientsList.find(c => c.id.toString() === cId.toString());
                addrBox.style.display = 'block';
                if (client && client.direccion) {
                    const history = client.direccion.split(' | ').reverse();
                    selAddr.innerHTML = history.map(d => `<option value="${d}">${d}</option>`).join('');
                } else {
                    selAddr.innerHTML = `<option value="">⚠️ Sin dirección - Por favor agrégala</option>`;
                }
            } else {
                addrBox.style.display = 'none';
            }
        });
        const pSel=document.getElementById('sel-producto-text'),pHide=document.getElementById('sel-producto-id');
        const vTot=document.getElementById('sale-total'),vAb=document.getElementById('sale-abono'),lblS=document.getElementById('lbl-saldo');
        const updS=()=>{ const t=parseInt(vTot.value||0),a=parseInt(vAb.value||0); lblS.innerText=formatCOP(Math.max(0,t-a)); };
        if(pSel) pSel.addEventListener('input',(e)=>{ pHide.value=''; document.querySelectorAll('#dl-productos option').forEach(o=>{ if(o.value===e.target.value){pHide.value=o.getAttribute('data-id'); const pr=o.getAttribute('data-price'); if(pr){vTot.value=pr;vAb.value=pr;updS();}} }); });
        if(vTot&&vAb){vTot.addEventListener('input',updS);vAb.addEventListener('input',updS);}
        const encTipo = document.getElementById('enc_tipo');
        if (encTipo) encTipo.onchange = () => window.updateEncargoRequirements();
        
        attachComprobanteInput('comp-sale-file');

        window.toggleInlineClient = (mode) => {
            const container = document.getElementById('inline-client-form');
            container.style.display = 'block';
            container.dataset.mode = mode;
            if (mode === 'NEW') {
                document.getElementById('inl-cli-title').innerText = 'Crear Cliente Rápido';
                document.getElementById('inl-cli-grid-new').style.display = 'grid';
                document.getElementById('inl-cli-grid-edit').style.display = 'none';
                document.getElementById('inl_cli_nombre').focus();
            } else {
                document.getElementById('inl-cli-title').innerText = 'Agregar Datos al Cliente';
                document.getElementById('inl-cli-grid-new').style.display = 'none';
                document.getElementById('inl-cli-grid-edit').style.display = 'flex';
                document.getElementById('inl_cli_new_dir').focus();
            }
        };

        window.saveInlineClient = async () => {
            const mode = document.getElementById('inline-client-form').dataset.mode;
            try {
                const list2 = await db.fetchData('Clientes');
                
                if (mode === 'NEW') {
                    const nombre = document.getElementById('inl_cli_nombre').value.trim();
                    if (!nombre) return showToast('El nombre es obligatorio', 'error');
                    const nid = document.getElementById('inl_cli_nid').value.trim();
                    const wa = document.getElementById('inl_cli_wa').value.trim();
                    const kommo = document.getElementById('inl_cli_kommo').value.trim();
                    const dir = document.getElementById('inl_cli_dir').value.trim();
                    const ciu = document.getElementById('inl_cli_ciu').value.trim() || 'Medellín';

                    const existing = list2.find(c => 
                        (nid && c.numero_identificacion === nid) || 
                        (kommo && c.numero_lead_kommo && c.numero_lead_kommo.includes(kommo)) || 
                        (wa && c.whatsapp && c.whatsapp.includes(wa))
                    );

                    if (existing) {
                        const ok = await window.customConfirm('Cliente Duplicado', `El cliente ya existe (Nombre: ${existing.nombre}). ¿Deseas actualizarlo y agregar los nuevos datos a su historial?`);
                        if (ok) {
                            if (nid && !existing.numero_identificacion) existing.numero_identificacion = nid;
                            if (wa && (!existing.whatsapp || !existing.whatsapp.includes(wa))) existing.whatsapp = existing.whatsapp ? existing.whatsapp + ' | ' + wa : wa;
                            if (kommo && (!existing.numero_lead_kommo || !existing.numero_lead_kommo.includes(kommo))) existing.numero_lead_kommo = existing.numero_lead_kommo ? existing.numero_lead_kommo + ' | ' + kommo : kommo;
                            
                            if (dir) {
                                const fullDir = `${dir} (${ciu})`;
                                if (!existing.direccion || !existing.direccion.includes(dir)) {
                                    existing.direccion = existing.direccion ? existing.direccion + ' | ' + fullDir : fullDir;
                                }
                            }
                            existing.ciudad = ciu;
                            
                            await db.postData('Clientes', existing, 'UPDATE');
                            showToast('Cliente actualizado', 'success');
                            
                            document.getElementById('sel-cliente-text').value = `${existing.nombre} (CC: ${existing.numero_identificacion||'-'})`;
                            document.getElementById('sel-cliente-id').value = existing.id;
                            document.getElementById('btn-edit-inline-client').style.display = 'block';
                            document.getElementById('inline-client-form').style.display = 'none';
                            // Refrescar direcciones
                            document.getElementById('sel-cliente-text').dispatchEvent(new Event('input'));
                        }
                        return;
                    } else {
                        const newId = Date.now().toString();
                        const fullDir = dir ? `${dir} (${ciu})` : '';
                        const payload = { id: newId, nombre, numero_identificacion:nid, numero_lead_kommo:kommo, direccion:fullDir, ciudad:ciu, whatsapp:wa, fecha_registro:new Date().toLocaleDateString() };
                        await db.postData('Clientes', payload, 'INSERT');
                        showToast('Cliente creado', 'success');
                        
                        const dl = document.getElementById('dl-clientes');
                        const optValue = `${nombre} (CC: ${nid||'-'})`;
                        dl.innerHTML += `<option data-id="${newId}" value="${optValue}"></option>`;
                        document.getElementById('sel-cliente-text').value = optValue;
                        document.getElementById('sel-cliente-id').value = newId;
                        document.getElementById('btn-edit-inline-client').style.display = 'block';
                        document.getElementById('inline-client-form').style.display = 'none';
                        // Refrescar direcciones
                        document.getElementById('sel-cliente-text').dispatchEvent(new Event('input'));
                    }
                } else if (mode === 'EDIT') {
                    const selId = document.getElementById('sel-cliente-id').value;
                    if (!selId) return showToast('No hay cliente seleccionado', 'error');
                    const existing = list2.find(c => c.id.toString() === selId);
                    if (!existing) return showToast('Cliente no encontrado', 'error');

                    const new_dir = document.getElementById('inl_cli_new_dir').value.trim();
                    const new_wa = document.getElementById('inl_cli_new_wa').value.trim();
                    const new_kommo = document.getElementById('inl_cli_new_kommo').value.trim();

                    let updated = false;
                    if (new_dir) {
                        const fullDir = `${new_dir} (${existing.ciudad || 'N/A'})`;
                        existing.direccion = existing.direccion ? existing.direccion + ' | ' + fullDir : fullDir;
                        updated = true;
                    }
                    if (new_wa && (!existing.whatsapp || !existing.whatsapp.includes(new_wa))) {
                        existing.whatsapp = existing.whatsapp ? existing.whatsapp + ' | ' + new_wa : new_wa;
                        updated = true;
                    }
                    if (new_kommo && (!existing.numero_lead_kommo || !existing.numero_lead_kommo.includes(new_kommo))) {
                        existing.numero_lead_kommo = existing.numero_lead_kommo ? existing.numero_lead_kommo + ' | ' + new_kommo : new_kommo;
                        updated = true;
                    }

                    if (updated) {
                        await db.postData('Clientes', existing, 'UPDATE');
                        showToast('Datos agregados al cliente', 'success');
                    } else {
                        showToast('No se agregaron datos nuevos', 'info');
                    }
                }
                
                document.getElementById('inline-client-form').style.display = 'none';
                
            } catch (e) {
                showToast(e.message, 'error');
            }
        };

    }, 150);

    document.getElementById('form-sale').onsubmit = async (e) => {
        e.preventDefault();
        const fd=new FormData(e.target);
        const tipoVenta=fd.get('tipo_venta');
        const cliHidden=document.getElementById('sel-cliente-id').value;
        if(!cliHidden) return window.showToast('Debes seleccionar un Cliente válido.','error');
        
        if (tipoVenta === 'Encargo') {
            const fotoFile = document.getElementById('enc-file-img')?.files[0];
            if (!fotoFile) {
                return window.showToast('La foto de referencia es obligatoria para pedidos por encargo.', 'error');
            }
        }

        fd.set('cliente_id',cliHidden);
        if(tipoVenta==='Stock'){ const prodH=document.getElementById('sel-producto-id').value; if(!prodH) return window.showToast('Debes seleccionar un Producto válido.','error'); fd.set('producto_id',prodH); }
        const valorTotal=parseInt(fd.get('valor_total_cop')||0);
        const gananciaCalc=parseInt(fd.get('ganancia_calculada')||0);
        
        if (valorTotal <= 0) return window.showToast('El Valor Total debe ser mayor a 0.', 'error');
        if (gananciaCalc <= 0) return window.showToast('La Ganancia Calculada debe ser mayor a 0.', 'error');

        const abonoIni=parseInt(fd.get('abono_inicial')||0);
        const saldoP=valorTotal-abonoIni;
        const btn=e.target.querySelector('button[type="submit"]');
        btn.disabled=true; btn.innerText='Registrando...';
        let finalProductId='';
        let finalImageUrl=document.getElementById('enc_url')?document.getElementById('enc_url').value:'';
        const uploadFile=document.getElementById('enc-file-img')?document.getElementById('enc-file-img').files[0]:null;
        try {
            if(tipoVenta==='Encargo'&&uploadFile){ btn.innerText='Subiendo Foto...'; finalImageUrl=await uploadImageToSupabase(uploadFile); }
            if(tipoVenta==='Encargo'){
                const newProdId=Date.now().toString(); finalProductId=newProdId;
                const pp={ id:newProdId, sku:'ENC-'+Math.floor(Math.random()*10000), nombre_producto:document.getElementById('enc_nombre').value||'Producto sin nombre', marca:document.getElementById('enc_marca').value, categoria:document.getElementById('enc_tipo').value, genero:document.getElementById('enc_genero').value, talla:document.getElementById('enc_talla').value, tienda_cotizacion:document.getElementById('enc_tienda').value, url_imagen:finalImageUrl, link_producto:document.getElementById('enc_link')?document.getElementById('enc_link').value:'', cantidad_encargada:document.getElementById('enc_cantidad').value, precio_cop:valorTotal, precio_usd:document.getElementById('enc_precio_usd')?document.getElementById('enc_precio_usd').value:'', stock_medellin:0, estado_producto:'Pendiente de compra en EEUU', ganancia_calculada: gananciaCalc };
                showToast('Creando ficha del producto...','info');
                await db.postData('Productos',pp,'INSERT');
            } else {
                finalProductId=fd.get('producto_id');
                const tProd=productsList.find(p=>p.id.toString()===finalProductId.toString());
                if(tProd&&parseInt(tProd.stock_medellin)>0){ tProd.stock_medellin=parseInt(tProd.stock_medellin)-1; if(tProd.stock_medellin===0){tProd.estado_producto='Producto Vendido (Sin Stock)';} showToast('Descontando inventario...','info'); await db.postData('Productos',tProd,'UPDATE'); }
            }
            const comprobanteFile = document.getElementById('comp-sale-file')?.files[0];
            let comprobanteUrl = '';
            if (comprobanteFile) { btn.innerText='Subiendo comprobante...'; comprobanteUrl = await uploadImageToSupabase(comprobanteFile); }

            // ─── Cálculo Envio Internacional (Limpieza de formatos) ───
            const cleanNum = (val) => {
                if (!val) return 0;
                let s = val.toString().trim().replace(/,/g, '.');
                return parseFloat(s) || 0;
            };
            const peso = cleanNum(fd.get('peso_producto'));
            const trm = cleanNum(fd.get('trm_cotizada'));
            const libParam = configList.find(c => c.clave === 'ValorLibra');
            const valorLibraUSD = libParam ? parseFloat(libParam.valor || 0) : 0;
            const valorEnvioInt = Math.round(peso * valorLibraUSD * trm);

            const pvId = Date.now().toString();
            const pv={ 
                id:pvId, 
                cliente_id:fd.get('cliente_id'), 
                producto_id:finalProductId, 
                tipo_venta:tipoVenta, 
                fecha:fd.get('fecha_real_venta') || new Date().toLocaleDateString(), 
                valor_total_cop:valorTotal, 
                ganancia_calculada:gananciaCalc,
                abonos_acumulados:abonoIni, 
                saldo_pendiente:saldoP, 
                comprobante_url:comprobanteUrl, 
                direccion_envio: fd.get('direccion_envio') || '',
                peso_producto: peso,
                trm_cotizada: trm,
                valor_envio_internacional: valorEnvioInt,
                estado_orden:tipoVenta==='Encargo'?'Validando Compra EEUU':'Completado Local', 
                id_seguimiento:'SG-'+Math.floor(Math.random()*1000000) 
            };
            showToast('Generando Venta...','info');
            await db.postData('Ventas',pv,'INSERT');
            // Registrar abono inicial en el historial si hubiera
            if (abonoIni > 0) {
                const initAbono = { id: (Date.now()+1).toString(), venta_id: pvId, valor: abonoIni, metodo_pago: 'Pago Inicial', fecha: fd.get('fecha_real_venta') || new Date().toLocaleDateString(), comprobante_url: comprobanteUrl };
                await db.postData('Abonos', initAbono, 'INSERT');
            }
            window.closeModal(); showToast('✅ Operación Exitosa','success'); navigateTo('sales');
        } catch(err){ showToast(err.message,'error'); btn.disabled=false; btn.innerText='Reintentar'; }
    };
};

// ─── Open Sale Detail Modal ────────────────────────────────────────────────────
export const openSaleDetailModal = async (ventaId, backAction='') => {
    const container=document.getElementById('modal-container');
    const content=document.getElementById('modal-content');
    content.innerHTML=`<div style="text-align:center;padding:3rem;"><div class="loader" style="margin:0 auto 15px auto;"></div> Cargando Ficha del Pedido...</div>`;
    container.style.display='flex';
    const [ventasData,clientesData,productosData,logisticaData,abonosData]=await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Clientes'),
        db.fetchData('Productos'),
        db.fetchData('Logistica'),
        db.fetchWhere('Abonos','venta_id', ventaId.toString()),
    ]);
    if(ventasData.error){content.innerHTML=`<div style="color:var(--primary-red);padding:2rem;text-align:center;">Error: ${ventasData.error.message||'Desconocido'}</div>`;return;}
    const v=ventasData.find(it=>it.id.toString()===ventaId.toString());
    if(!v){showToast('Venta no encontrada','error');if(backAction){eval(backAction);}else{window.closeModal();}return;}
    const cliente=!clientesData.error?clientesData.find(c=>c.id.toString()===v.cliente_id.toString()):null;
    const producto=!productosData.error?productosData.find(p=>p.id.toString()===v.producto_id?.toString()):null;
    const logista=!logisticaData.error?logisticaData:[];
    const abonos=Array.isArray(abonosData)?abonosData:[];
    const estadoLogistica=getLogisticaFase(v.id,logista,v.estado_orden||'Procesando');
    const _faseColor=getLogisticaColor(estadoLogistica);
    const saldo=parseInt(v.saldo_pendiente||0);
    const abonado=parseInt(v.abonos_acumulados||0);
    const total=parseInt(v.valor_total_cop||0);
    const fechaCorta=normDate(v.fecha)||'N/A';
    const backBtn=backAction?`<button onclick="${backAction}" style="background:none;border:none;color:var(--text-main);font-size:0.9rem;cursor:pointer;opacity:0.7;margin-bottom:15px;font-weight:700;">⬅️ Volver</button>`:'';
    const closeAttr=backAction?`onclick="${backAction}"`:`onclick="window.closeModal()"`;

    // ─── Historial de Abonos ─────────────────────────────────────────────────────
    const metodoBadge = (m) => {
        const map = {'Transferencia Bancolombia':'#0077b6','Nequi':'#7209b7','Efectivo':'var(--success-green)','Tarjeta':'#f77f00','Pago Inicial':'var(--info-blue)'};
        return `<span style="font-size:0.68rem;padding:2px 8px;border-radius:8px;background:${map[m]||'var(--glass-hover)'};color:#fff;font-weight:700;white-space:nowrap;">${m||'N/A'}</span>`;
    };
    const abonosHTML = abonos.length > 0
        ? abonos.map((ab,i) => `
            <div class="abono-history-item">
                <div class="abono-history-dot" style="background:${i===abonos.length-1?'var(--primary-red)':'var(--glass-border)20'};border-color:${i===abonos.length-1?'var(--primary-red)':'var(--glass-border)'};"></div>
                <div class="abono-history-body">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                        <strong style="font-size:0.92rem;color:var(--success-green);">${formatCOP(parseInt(ab.valor||0))}</strong>
                        ${metodoBadge(ab.metodo_pago)}
                        <span style="font-size:0.72rem;opacity:0.45;margin-left:auto;">${ab.fecha||''}</span>
                    </div>
                    ${ab.comprobante_url ? `<button class="comp-thumb-btn" style="margin-top:4px;" onclick="window.openComprobanteViewer('${ab.comprobante_url}')">🧾 Ver comprobante</button>` : ''}
                </div>
            </div>`).join('')
        : `<div style="text-align:center;padding:1.2rem;opacity:0.4;font-size:0.82rem;">Sin pagos registrados aún.</div>`;

    content.innerHTML=`
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <div style="display:flex; align-items:center; gap:15px;">
                    ${backBtn ? '<button onclick="' + backAction + '" style="background:none; border:none; color:var(--text-main); cursor:pointer; padding:0; display:flex; align-items:center;">⬅️</button>' : ''}
                    <h2 style="margin:0; color:var(--brand-magenta);">ORDEN #${v.id.toString().slice(-4)}</h2>
                </div>
                <button class="modal-close-btn" ${closeAttr}>✕</button>
            </div>

        <div class="modal-body" style="padding-top:1rem;">
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:1.2rem; margin-bottom:2rem;">
                <div style="background:var(--surface-2); padding:1.2rem; border-radius:16px; border:1px solid var(--border-base); text-align:center;">
                    <span style="font-size:0.7rem; opacity:0.6; text-transform:uppercase; letter-spacing:1px;">Valor Total</span>
                    <div style="font-size:1.3rem; font-weight:800; margin-top:5px;">${formatCOP(total)}</div>
                </div>
                <div style="background:rgba(6,214,160,0.08); padding:1.2rem; border-radius:16px; border:1px solid rgba(6,214,160,0.3); text-align:center;">
                    <span style="font-size:0.7rem; color:var(--success); text-transform:uppercase; letter-spacing:1px;">Total Abonado</span>
                    <div style="font-size:1.3rem; font-weight:800; color:var(--success); margin-top:5px;">${formatCOP(abonado)}</div>
                </div>
                <div style="background:${saldo>0?'var(--brand-magenta-dim)':'rgba(6,214,160,0.08)'}; padding:1.2rem; border-radius:16px; border:1px solid ${saldo>0?'var(--brand-magenta-glow)':'rgba(6,214,160,0.3)'}; text-align:center;">
                    <span style="font-size:0.7rem; color:${saldo>0?'var(--brand-magenta)':'var(--success)'}; text-transform:uppercase; letter-spacing:1px;">${saldo>0?'Saldo Pendiente':'Estado'}</span>
                    <div style="font-size:1.3rem; font-weight:800; color:${saldo>0?'var(--brand-magenta)':'var(--success)'}; margin-top:5px;">${saldo===0?'PAGADO':formatCOP(saldo)}</div>
                </div>
            </div>

            <div class="form-grid" style="margin-bottom:2rem;">
                <div class="form-group" style="background:var(--surface-2); padding:1rem; border-radius:12px; border:1px solid var(--border-base);">
                    <span style="font-size:0.65rem; opacity:0.5; text-transform:uppercase;">⚖️ Peso</span>
                    <div style="font-size:1rem; font-weight:700;">${v.peso_producto || 0} Lbs</div>
                </div>
                <div class="form-group" style="background:var(--surface-2); padding:1rem; border-radius:12px; border:1px solid var(--border-base);">
                    <span style="font-size:0.65rem; opacity:0.5; text-transform:uppercase;">📈 TRM Cotizada</span>
                    <div style="font-size:1rem; font-weight:700;">${v.trm_cotizada ? formatCOP(v.trm_cotizada) : 'N/A'}</div>
                </div>
                ${(auth.isAdmin() || auth.getUserRole() === 'gerente' || auth.getUserRole() === 'finanzas') ? `
                <div class="form-group full-width" style="background:rgba(255,183,3,0.08); padding:1.2rem; border-radius:16px; border:1px solid rgba(255,183,3,0.3); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.65rem; color:#FFB703; text-transform:uppercase;">✈️ Envío Internacional</span>
                        <div style="font-size:1.2rem; font-weight:800; color:#FFB703;">${v.valor_envio_internacional ? formatCOP(v.valor_envio_internacional) : '$0'}</div>
                    </div>
                    <div style="text-align:right; opacity:0.6; font-size:0.65rem; color:#FFB703;">
                        ${v.peso_producto || 0} Lbs × USD $${Math.round((v.valor_envio_internacional || 0) / ((v.peso_producto || 1) * (v.trm_cotizada || 1)))} × ${v.trm_cotizada ? formatCOP(v.trm_cotizada) : '$0'}
                    </div>
                </div>` : ''}
            </div>

            <div class="abono-history-section" style="background:var(--surface-2); border-radius:16px; padding:1.5rem; margin-bottom:2rem; border:1px solid var(--border-base);">
                <h4 class="abono-history-title" style="margin-bottom:1.5rem; font-size:0.85rem; color:var(--text-main);">📋 Historial de Pagos <span class="abono-count-badge">${abonos.length}</span></h4>
                <div class="abono-history-list">${abonosHTML}</div>
            </div>

            ${producto?`
            <div style="display:flex; gap:2rem; background:var(--surface-2); padding:2rem; border-radius:20px; border:1px solid var(--border-base); align-items:center; margin-bottom:2rem;">
                <div style="width:140px; height:140px; background:var(--bg-main); border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--border-base); flex-shrink:0;">
                    ${producto.url_imagen?`<img src="${producto.url_imagen}" style="width:100%; height:100%; object-fit:cover;">`:"<span style='opacity:0.1;'>FOTO</span>"}
                </div>
                <div style="flex:1;">
                    <span style="color:var(--brand-magenta); font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:1px;">${producto.marca}</span>
                    <h3 style="margin:10px 0; font-size:1.4rem; color:var(--text-main);">${producto.nombre_producto}</h3>
                    <div style="display:flex; gap:12px; margin-top:15px; flex-wrap:wrap;">
                        <span style="font-size:0.75rem; padding:6px 12px; background:var(--bg-main); border-radius:8px; border:1px solid var(--border-base);">Talla: <strong>${producto.talla||'N/A'}</strong></span>
                        <span style="font-size:0.75rem; padding:6px 12px; background:var(--bg-main); border-radius:8px; border:1px solid var(--border-base);">Género: <strong>${producto.genero||'N/A'}</strong></span>
                        <span style="font-size:0.75rem; padding:6px 12px; background:var(--bg-main); border-radius:8px; border:1px solid var(--border-base); opacity:0.6;">SKU: ${producto.sku}</span>
                    </div>
                    ${v.tipo_venta==='Encargo'&&producto.link_producto?`<div style="margin-top:20px;"><a href="${producto.link_producto}" target="_blank" style="font-size:0.8rem; padding:8px 15px; background:rgba(6,214,160,0.1); color:var(--success); text-decoration:none; border-radius:10px; border:1px solid rgba(6,214,160,0.2); font-weight:700;">🔗 Enlace de Compra Original</a></div>`:''}
                </div>
            </div>` : '<div style="padding:2rem; background:var(--surface-2); text-align:center; border-radius:20px; border:1px dashed var(--border-base); opacity:0.4; margin-bottom:2rem;">Ficha de producto no disponible</div>'}

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2rem; background:var(--surface-2); padding:2rem; border-radius:20px; border:1px solid var(--border-base); margin-bottom:2rem;">
                <div>
                    <h4 style="margin:0 0 1.2rem 0; opacity:0.5; text-transform:uppercase; font-size:0.65rem; letter-spacing:1.5px; color:var(--text-main);">Información del Cliente</h4>
                    ${cliente?`
                        <p style="margin:0 0 8px; font-size:1.2rem; font-weight:800; color:var(--text-main);">${cliente.nombre}</p>
                        <p style="margin:0; opacity:0.7; font-size:0.9rem;">Documento: ${cliente.numero_identificacion||'N/A'}</p>
                        <p style="margin:6px 0 0; opacity:0.7; font-size:0.9rem;">WhatsApp: ${cliente.whatsapp||'N/A'}</p>
                        ${v.direccion_envio?`<p style="margin:15px 0 0; color:#FFB703; font-size:0.9rem; font-weight:800; background:rgba(255,183,3,0.08); padding:10px; border-radius:8px; border-left:4px solid #FFB703;">📍 Envío a: ${v.direccion_envio}</p>`:''}
                    `:'<span style="opacity:0.4;">Cliente no vinculado.</span>'}
                </div>
                <div style="text-align:right; border-left:1px solid var(--border-base); padding-left:2rem;">
                    <h4 style="margin:0 0 1.2rem 0; opacity:0.5; text-transform:uppercase; font-size:0.65rem; letter-spacing:1.5px; color:var(--text-main);">Seguimiento Logístico</h4>
                    <span style="font-size:0.8rem; padding:8px 18px; border-radius:30px; font-weight:800; color:#fff; background:${_faseColor}; box-shadow:0 4px 12px ${_faseColor}40;">${estadoLogistica}</span>
                    <p style="margin:20px 0 0; opacity:0.7; font-size:0.9rem;">Canal de Origen: <strong style="color:var(--brand-magenta);">${v.tipo_venta==='Encargo'?'📦 Encargo Int.':'🛒 Stock Local'}</strong></p>
                </div>
            </div>
        </div>

        <div class="modal-footer" style="justify-content:center;">
            ${auth.canEdit('sales') && saldo > 0 ? `<button class="btn-primary" style="padding:12px 40px; font-size:1rem;" onclick="window.closeModal(); window.modalAbono('${v.id}', ${saldo})">Registrar Abono</button>` : ''}
            ${saldo===0 ? `<div style="padding:10px 30px; background:rgba(6,214,160,0.1); color:var(--success); border-radius:30px; font-weight:800; border:1px solid var(--success);">✅ ORDEN COMPLETAMENTE PAGADA</div>` : ''}
        </div>
        </div>`;
};
