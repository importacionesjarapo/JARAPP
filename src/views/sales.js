import { db } from '../db.js';
import { formatCOP, renderError, showToast, uploadImageToSupabase, getLogisticaFase, getLogisticaColor, buildComprobanteUploadHTML, attachComprobanteInput, downloadExcel } from '../utils.js';

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

    const kpis = [
        { icon:'💰', value: formatCOP(totalFacturado), label:'Facturación Total',      color:'var(--info-blue)' },
        { icon:'✅', value: formatCOP(totalAbonos),    label:'Abonos Recibidos',        color:'var(--success-green)' },
        { icon:'⚠️', value: formatCOP(totalSaldo),     label:'Saldos Pendientes',       color: totalSaldo > 0 ? 'var(--primary-red)' : 'var(--success-green)' },
        { icon:'📦', value: encargos,                  label:'Encargos Internacionales', color:'var(--warning-orange)' },
        { icon:'🛒', value: stockLocal,                label:'Ventas Stock Local',       color:'var(--brand-green)' },
    ];
    return `
    <div class="kpi-strip">
        ${kpis.map(k => `
        <div class="kpi-strip-card">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
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
                                ${saldo>0?`<button class="btn-action" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>`:`<span style="opacity:0.4;font-size:0.72rem;white-space:nowrap">✔ Pagado</span>`}
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
                        <button class="btn-primary" style="font-size:0.72rem;padding:6px 12px;" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>
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
                <div class="purchase-group-row" style="padding:0.8rem;background:var(--glass-hover);border-radius:10px;margin-bottom:8px;border:1px solid var(--glass-border);display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                        <div>
                            <strong style="font-size:0.82rem;color:var(--primary-red);">#${v.id.toString().slice(-4)}</strong>
                            <span style="font-size:0.75rem;opacity:0.6;margin-left:6px;">${normDate(v.fecha)||''}</span>
                            <div style="font-size:0.8rem;margin-top:2px;">${c?c.nombre:'—'}</div>
                            ${prod?`<div style="font-size:0.74rem;opacity:0.6;">${prod.marca} · ${prod.nombre_producto}</div>`:''}
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <span class="status-badge" style="background:${faseCol};font-size:0.58rem;">${fase}</span>
                            <div style="font-weight:700;margin-top:4px;">${formatCOP(v.valor_total_cop||0)}</div>
                            ${saldo>0?`<div style="font-size:0.72rem;color:var(--primary-red);">Debe: ${formatCOP(saldo)}</div>`:`<div style="font-size:0.72rem;color:var(--success-green);">✔ Pagado</div>`}
                        </div>
                    </div>
                    <div style="display:flex;gap:6px;justify-content:flex-end;">
                        <button class="btn-action" style="font-size:0.7rem;" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️ Ver</button>
                        ${saldo>0?`<button class="btn-action" style="font-size:0.7rem;" onclick="window.modalAbono('${v.id}',${saldo})">+ Abono</button>`:''}
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
            <h2 style="margin-bottom:0.5rem;">Registrar Abono</h2>
            <p style="opacity:0.7;margin-bottom:0;">Saldo pendiente: <strong style="color:var(--primary-red);">${formatCOP(saldoPendiente)}</strong></p>
            <form id="form-abono" style="display:flex;flex-direction:column;gap:1.2rem;margin-top:1.5rem;">
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
                    ${buildComprobanteUploadHTML('comp-abono-file')}
                </div>
                <div style="display:flex;gap:15px;margin-top:0.5rem;">
                    <button type="submit" class="btn-primary" style="flex:1;">Confirmar Abono</button>
                    <button type="button" onclick="window.closeModal()" style="flex:1;background:none;border:1px solid var(--glass-border);color:var(--text-main);border-radius:16px;">Cancelar</button>
                </div>
            </form>`;
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
            <button class="btn-primary" onclick="window.modalVenta()">+ Nueva Venta</button>
        </div>
    </div>

    <div id="sales-kpi-container">
        ${renderSalesKPI(localVentasFiltered)}
    </div>

    <div class="purchase-view-switcher" style="margin-bottom:1.5rem;">
        ${tabs.map(t => `
        <button class="pv-tab${t.id==='tabla'?' active':''}" data-sale-view="${t.id}" onclick="window.switchSalesView('${t.id}')">
            ${t.icon} ${t.label}
        </button>`).join('')}
    </div>

    <div id="sales-view-area">
        ${renderViewTabla(localVentasFiltered)}
    </div>`;

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
        <h2 style="margin-bottom:1.5rem;">Registrar Nueva Venta</h2>
        <form id="form-sale" style="display:flex;flex-direction:column;gap:1.2rem;max-height:70vh;overflow-y:auto;padding-right:1rem;">
            <div style="display:flex;gap:1rem;border-bottom:1px solid var(--glass-border);padding-bottom:1rem;">
               <label style="flex:1;"><input type="radio" name="tipo_venta" value="Stock" checked onchange="window.toggleSaleType(this.value)"> 🛒 Stock Local</label>
               <label style="flex:1;"><input type="radio" name="tipo_venta" value="Encargo" onchange="window.toggleSaleType(this.value)"> 📦 Por Encargo (EEUU)</label>
            </div>
            <div>
               <label>Seleccionar Cliente</label>
               <input type="text" list="dl-clientes" id="sel-cliente-text" placeholder="Escribe el nombre del cliente..." required autocomplete="off">
               <datalist id="dl-clientes">${clientsList.map(c=>`<option data-id="${c.id}" value="${c.nombre} (CC: ${c.numero_identificacion||'-'})"></option>`).join('')}</datalist>
               <input type="hidden" name="cliente_id" id="sel-cliente-id" required>
            </div>
            <div id="section-stock">
               <label>Seleccionar Producto Físico</label>
               <input type="text" list="dl-productos" id="sel-producto-text" placeholder="Escribe nombre o SKU..." required autocomplete="off">
               <datalist id="dl-productos">
                  ${productsList.filter(p=>p.estado_producto==='Disponible entrega inmediata'&&parseInt(p.stock_medellin)>0).map(p=>`<option data-id="${p.id}" data-price="${p.precio_cop}" value="${p.nombre_producto} | SKU: ${p.sku} | COP ${formatCOP(p.precio_cop)} [Disp: ${p.stock_medellin}]"></option>`).join('')}
               </datalist>
               <input type="hidden" name="producto_id" id="sel-producto-id" required>
            </div>
            <div id="section-encargo" style="display:none;flex-direction:column;gap:1rem;background:rgba(0,0,0,0.2);padding:1rem;border-radius:12px;">
                <h4 style="margin:0;opacity:0.8;">Detalles del Producto Solicitado</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div><label>Categoría</label><select id="enc_tipo"><option value="">-- Selecciona --</option>${categorias.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
                    <div><label>Tienda a Cotizar</label><select id="enc_tienda"><option value="">-- Selecciona --</option>${tiendas.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
                </div>
                <div><label>Nombre / Modelo Exacto</label><input type="text" id="enc_nombre" placeholder="Ej. Jordan 4 Retro University Blue"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:0.5rem;">
                    <div><label>Link del Producto (URL)</label><input type="url" id="enc_link" placeholder="https://..."></div>
                    <div><label>Valor Cotizado (USD)</label><input type="number" step="0.01" id="enc_precio_usd" placeholder="Ej. 120.50"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
                    <div><label>Marca</label><select id="enc_marca"><option value="">-- Selecciona --</option>${marcas.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
                    <div><label>Género</label><select id="enc_genero"><option value="">-- Selecciona --</option>${generos.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
                    <div><label>Talla</label><input type="text" id="enc_talla" placeholder="Ej. 9US"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div><label>Cantidad</label><input type="number" id="enc_cantidad" value="1" min="1"></div>
                    <div><label>Foto Referencia (Opcional)</label>
                        <input type="file" id="enc-file-img" accept="image/*" style="padding:10px;background:var(--input-bg);border-radius:12px;border:1px dashed rgba(255,255,255,0.2);">
                        <div id="enc-img-preview" style="height:40px;border-radius:8px;display:flex;overflow:hidden;margin-top:5px;"></div>
                        <input type="hidden" id="enc_url" value="">
                    </div>
                </div>
            </div>
            <hr style="border-color:rgba(255,255,255,0.05);margin:0.5rem 0;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
               <div><label>Valor Total (COP)</label><input type="number" name="valor_total_cop" id="sale-total" value="0" required min="0"></div>
               <div><label>Abono Inicial (COP)</label><input type="number" name="abono_inicial" id="sale-abono" value="0" required min="0">
                   <p style="font-size:0.65rem;color:var(--success-green);margin-top:5px;">Saldo Calculado: <span id="lbl-saldo">$0</span></p>
               </div>
            </div>
            <div>
               <label style="margin-bottom:6px;display:block;">Comprobante de Pago Inicial <span style="opacity:0.5;font-size:0.75rem;">(opcional)</span></label>
               ${buildComprobanteUploadHTML('comp-sale-file')}
            </div>
            <div style="display:flex;gap:15px;margin-top:1rem;">
               <button type="submit" class="btn-primary" style="flex:1;">Confirmar y Procesar Venta</button>
               <button type="button" onclick="window.closeModal()" style="flex:1;background:none;border:1px solid var(--glass-border);color:var(--text-main);border-radius:16px;">Cancelar</button>
            </div>
        </form>`;

    window.toggleSaleType = (val) => {
        const secStock   = document.getElementById('section-stock');
        const secEncargo = document.getElementById('section-encargo');
        const selStockTx = document.getElementById('sel-producto-text');
        const reqEnc = ['enc_tipo','enc_tienda','enc_nombre','enc_marca','enc_genero','enc_talla','enc_cantidad'];
        if (val==='Stock') { secStock.style.display='block'; secEncargo.style.display='none'; selStockTx.setAttribute('required','true'); reqEnc.forEach(id=>document.getElementById(id)?.removeAttribute('required')); }
        else { secStock.style.display='none'; secEncargo.style.display='flex'; selStockTx.removeAttribute('required'); reqEnc.forEach(id=>document.getElementById(id)?.setAttribute('required','true')); }
    };

    setTimeout(() => {
        const fi=document.getElementById('enc-file-img'),pv=document.getElementById('enc-img-preview');
        if(fi&&pv) fi.onchange=(e)=>{ const f=e.target.files[0]; if(f){ const r=new FileReader(); r.onload=(re)=>{ pv.innerHTML=`<img src="${re.target.result}" style="height:100%;object-fit:cover;border-radius:6px;">`; }; r.readAsDataURL(f); } };
        const inpCli=document.getElementById('sel-cliente-text'),hidCli=document.getElementById('sel-cliente-id');
        if(inpCli) inpCli.addEventListener('input',(e)=>{ hidCli.value=''; document.querySelectorAll('#dl-clientes option').forEach(o=>{ if(o.value===e.target.value){hidCli.value=o.getAttribute('data-id');} }); });
        const pSel=document.getElementById('sel-producto-text'),pHide=document.getElementById('sel-producto-id');
        const vTot=document.getElementById('sale-total'),vAb=document.getElementById('sale-abono'),lblS=document.getElementById('lbl-saldo');
        const updS=()=>{ const t=parseInt(vTot.value||0),a=parseInt(vAb.value||0); lblS.innerText=formatCOP(Math.max(0,t-a)); };
        if(pSel) pSel.addEventListener('input',(e)=>{ pHide.value=''; document.querySelectorAll('#dl-productos option').forEach(o=>{ if(o.value===e.target.value){pHide.value=o.getAttribute('data-id'); const pr=o.getAttribute('data-price'); if(pr){vTot.value=pr;vAb.value=pr;updS();}} }); });
        if(vTot&&vAb){vTot.addEventListener('input',updS);vAb.addEventListener('input',updS);}
        attachComprobanteInput('comp-sale-file');
    }, 150);

    document.getElementById('form-sale').onsubmit = async (e) => {
        e.preventDefault();
        const fd=new FormData(e.target);
        const tipoVenta=fd.get('tipo_venta');
        const cliHidden=document.getElementById('sel-cliente-id').value;
        if(!cliHidden) return showToast('Debes seleccionar un Cliente válido.','error');
        fd.set('cliente_id',cliHidden);
        if(tipoVenta==='Stock'){ const prodH=document.getElementById('sel-producto-id').value; if(!prodH) return showToast('Debes seleccionar un Producto válido.','error'); fd.set('producto_id',prodH); }
        const valorTotal=parseInt(fd.get('valor_total_cop')||0);
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
                const pp={ id:newProdId, sku:'ENC-'+Math.floor(Math.random()*10000), nombre_producto:document.getElementById('enc_nombre').value||'Producto sin nombre', marca:document.getElementById('enc_marca').value, categoria:document.getElementById('enc_tipo').value, genero:document.getElementById('enc_genero').value, talla:document.getElementById('enc_talla').value, tienda_cotizacion:document.getElementById('enc_tienda').value, url_imagen:finalImageUrl, link_producto:document.getElementById('enc_link')?document.getElementById('enc_link').value:'', cantidad_encargada:document.getElementById('enc_cantidad').value, precio_cop:valorTotal, precio_usd:document.getElementById('enc_precio_usd')?document.getElementById('enc_precio_usd').value:'', stock_medellin:0, estado_producto:'Pendiente de compra en EEUU' };
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
            const pvId = Date.now().toString();
            const pv={ id:pvId, cliente_id:fd.get('cliente_id'), producto_id:finalProductId, tipo_venta:tipoVenta, fecha:new Date().toLocaleDateString(), valor_total_cop:valorTotal, abonos_acumulados:abonoIni, saldo_pendiente:saldoP, comprobante_url:comprobanteUrl, estado_orden:tipoVenta==='Encargo'?'Validando Compra EEUU':'Completado Local', id_seguimiento:'SG-'+Math.floor(Math.random()*1000000) };
            showToast('Generando Venta...','info');
            await db.postData('Ventas',pv,'INSERT');
            // Registrar abono inicial en el historial si hubiera
            if (abonoIni > 0) {
                const initAbono = { id: (Date.now()+1).toString(), venta_id: pvId, valor: abonoIni, metodo_pago: 'Pago Inicial', fecha: new Date().toLocaleDateString(), comprobante_url: comprobanteUrl };
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
        ${backBtn}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;border-bottom:1px solid var(--glass-border);padding-bottom:1rem;">
            <div><h2 style="margin:0;color:var(--primary-red);">ORDEN #${v.id.toString().slice(-4)}</h2><span style="opacity:0.6;font-size:0.8rem;">Fecha: ${fechaCorta} · ${v.tipo_venta||''}</span></div>
            <button ${closeAttr} style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem;">
            <div style="background:var(--input-bg);padding:1rem 1.2rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;flex-direction:column;"><span style="font-size:0.75rem;opacity:0.6;margin-bottom:4px;">💰 Valor Total</span><strong style="font-size:1.15rem;">${formatCOP(total)}</strong></div>
            <div style="background:rgba(6,214,160,0.05);padding:1rem 1.2rem;border-radius:12px;border:1px solid rgba(6,214,160,0.2);display:flex;flex-direction:column;"><span style="font-size:0.75rem;color:var(--success-green);margin-bottom:4px;">💸 Total Abonado</span><strong style="font-size:1.15rem;color:var(--success-green);">${formatCOP(abonado)}</strong><span style="font-size:0.68rem;opacity:0.45;margin-top:3px;">${abonos.length} pago(s)</span></div>
            <div style="background:${saldo>0?'rgba(230,57,70,0.05)':'rgba(6,214,160,0.05)'};padding:1rem 1.2rem;border-radius:12px;border:1px solid ${saldo>0?'rgba(230,57,70,0.2)':'rgba(6,214,160,0.2)'};display:flex;flex-direction:column;"><span style="font-size:0.75rem;color:${saldo>0?'var(--primary-red)':'var(--success-green)'};margin-bottom:4px;">${saldo>0?'⚠️ Saldo Pendiente':'✅ Estado'}</span><strong style="font-size:1.15rem;color:${saldo>0?'var(--primary-red)':'var(--success-green)'};">${saldo===0?'Pagado':formatCOP(saldo)}</strong></div>
        </div>

        <div class="abono-history-section">
            <h4 class="abono-history-title">📋 Historial de Pagos <span class="abono-count-badge">${abonos.length}</span></h4>
            <div class="abono-history-list">${abonosHTML}</div>
        </div>

        ${producto?`<div style="display:flex;gap:1.5rem;background:var(--glass-hover);padding:1.5rem;border-radius:12px;border:1px solid var(--glass-border);align-items:center;margin-bottom:1.5rem;"><div style="width:120px;height:120px;background:var(--input-bg);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">${producto.url_imagen?`<img src="${producto.url_imagen}" style="width:100%;height:100%;object-fit:cover;">`:"<span style='opacity:0.2;'>FOTO</span>"}</div><div style="flex:1;"><span style="color:var(--primary-red);font-size:0.8rem;font-weight:700;text-transform:uppercase;">${producto.marca}</span><h3 style="margin:8px 0;font-size:1.2rem;">${producto.nombre_producto}</h3><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">Talla: <strong>${producto.talla||'N/A'}</strong></span><span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">Gen: <strong>${producto.genero||'N/A'}</strong></span><span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;opacity:0.6;">REF: ${producto.sku}</span></div>${v.tipo_venta==='Encargo'&&producto.link_producto?`<div style="margin-top:10px;"><a href="${producto.link_producto}" target="_blank" style="font-size:0.8rem;padding:6px 12px;background:rgba(6,214,160,0.1);color:var(--success-green);text-decoration:none;border-radius:6px;border:1px solid rgba(6,214,160,0.2);">🔗 Enlace de Compra</a></div>`:''}</div></div>`:
        `<div style="padding:1.2rem;background:var(--glass-hover);text-align:center;border-radius:12px;border:1px dashed rgba(255,255,255,0.1);opacity:0.5;margin-bottom:1.5rem;">Producto desvinculado del historial</div>`}
        <div style="background:var(--glass-hover);padding:1.5rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
            <div><h4 style="margin:0 0 0.8rem 0;opacity:0.5;text-transform:uppercase;font-size:0.7rem;letter-spacing:1px;">Datos del Cliente</h4>${cliente?`<p style="margin:0 0 4px;font-size:1.1rem;font-weight:700;">${cliente.nombre}</p><p style="margin:0;opacity:0.6;font-size:0.85rem;">CC/NIT: ${cliente.numero_identificacion||'N/A'}</p><p style="margin:4px 0 0;opacity:0.6;font-size:0.85rem;">WA: ${cliente.whatsapp||'N/A'}</p>`:'<span style="opacity:0.5;">Cliente no encontrado.</span>'}</div>
            <div style="text-align:right;"><h4 style="margin:0 0 0.8rem 0;opacity:0.5;text-transform:uppercase;font-size:0.7rem;letter-spacing:1px;">Logística</h4><span style="font-size:0.75rem;padding:6px 12px;border-radius:15px;font-weight:700;color:#fff;background:${_faseColor};">${estadoLogistica}</span><p style="margin:12px 0 0;opacity:0.6;font-size:0.85rem;">Origen: <strong style="color:#FFB703;">${v.tipo_venta==='Encargo'?'📦 Encargo Int.':'🛒 Stock Físico'}</strong></p></div>
        </div>
        <div style="text-align:center;">${saldo>0?`<button class="btn-primary" onclick="window.modalAbono('${v.id}',${saldo})">+ Registrar Nuevo Abono</button>`:`<span style="opacity:0.6;">✅ Venta completamente pagada</span>`}</div>`;
};
