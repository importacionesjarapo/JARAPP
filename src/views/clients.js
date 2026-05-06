import { db } from '../db.js';
import { auth } from '../auth.js';
import { renderError, formatCOP, downloadExcel, renderPagination, paginate } from '../utils.js';

// ─── Cache ─────────────────────────────────────────────────────────────────────
let _cliCache = null;
let _cliActiveView = 'tabla';

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

// ─── KPI Strip ──────────────────────────────────────────────────────────────────
const renderCRMKPI = (list, clientStats) => {
    const totalLTV    = Object.values(clientStats).reduce((a,s) => a+s.total_gastado, 0);
    const topCount    = Object.values(clientStats).filter(s => s.total_gastado > 500000).length;
    const conSaldo    = Object.values(clientStats).filter(s => s.saldo_pendiente > 0).length;
    const ciudades    = new Set(list.map(c => c.ciudad).filter(Boolean)).size;

    let kpis = [
        { icon:'👥', value: list.length,          label:'Total Clientes',          color:'var(--info-blue)' },
        { icon:'💰', value: formatCOP(totalLTV),  label:'LTV Total (Facturado)',   color:'var(--success-green)' },
        { icon:'🏆', value: topCount,              label:'Clientes Top (>500K)',    color:'var(--warning-orange)' },
        { icon:'⚠️', value: conSaldo,              label:'Con Saldo Pendiente',     color: conSaldo > 0 ? 'var(--primary-red)' : 'var(--success-green)' },
        { icon:'🏙️', value: ciudades,              label:'Ciudades',                color:'var(--brand-green)' },
    ];

    if (!auth.canAccess('feat_money')) {
        kpis = kpis.filter(k => k.label !== 'LTV Total (Facturado)');
    }

    return `
    <div class="kpi-strip">
        ${kpis.map(k => `
        <div class="kpi-strip-card" onclick="window.openClientsKPI('${k.label}')">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
};

window.openClientsKPI = (kpiName) => {
    if (!_cliCache) return;
    const { list, clientStats } = _cliCache;
    
    let title = kpiName;
    let subtitle = '';
    
    // Asignamos stats a cada cliente para filtrar fácil
    let clientesFiltrados = list.map(c => ({
        ...c,
        stats: clientStats[c.id] || { count: 0, total_gastado: 0, saldo_pendiente: 0 }
    }));
    
    if (kpiName === 'Total Clientes') {
        subtitle = 'Todos los clientes registrados en el sistema.';
    } else if (kpiName === 'LTV Total (Facturado)') {
        clientesFiltrados = clientesFiltrados.filter(c => c.stats.total_gastado > 0);
        clientesFiltrados.sort((a,b) => b.stats.total_gastado - a.stats.total_gastado);
        subtitle = 'Clientes que han generado ingresos, ordenados por LTV.';
    } else if (kpiName === 'Clientes Top (>500K)') {
        clientesFiltrados = clientesFiltrados.filter(c => c.stats.total_gastado > 500000);
        clientesFiltrados.sort((a,b) => b.stats.total_gastado - a.stats.total_gastado);
        subtitle = 'Mejores clientes con compras acumuladas superiores a $500,000 COP.';
    } else if (kpiName === 'Con Saldo Pendiente') {
        clientesFiltrados = clientesFiltrados.filter(c => c.stats.saldo_pendiente > 0);
        clientesFiltrados.sort((a,b) => b.stats.saldo_pendiente - a.stats.saldo_pendiente);
        subtitle = 'Clientes que actualmente tienen deuda abierta.';
    } else if (kpiName === 'Ciudades') {
        subtitle = 'Clientes ordenados alfabéticamente por ciudad.';
        clientesFiltrados = clientesFiltrados.filter(c => c.ciudad);
        clientesFiltrados.sort((a,b) => a.ciudad.localeCompare(b.ciudad));
    }
    
    const itemsHtml = clientesFiltrados.map(c => {
        const stats = c.stats;
        
        let metaHtml = '';
        if (kpiName === 'Con Saldo Pendiente') {
            metaHtml = `<div style="color:var(--primary-red);">Debe: ${formatCOP(stats.saldo_pendiente)}</div>`;
        } else if (kpiName === 'Ciudades') {
            metaHtml = `<div>LTV: ${formatCOP(stats.total_gastado)}</div>`;
        } else {
            metaHtml = `<div>LTV: ${formatCOP(stats.total_gastado)}</div>`;
        }
        
        return `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">${c.nombre || 'Sin Nombre'}</div>
                <div class="kpi-item-subtitle">${c.ciudad || 'Ciudad no registrada'} | ID: ${c.numero_identificacion || 'N/A'}</div>
                <div class="kpi-item-info">
                    <span>${stats.count} pedido(s)</span>
                    <span style="opacity:0.5;">|</span>
                    <span style="color:var(--success-green);">${c.whatsapp ? c.whatsapp : 'Sin WhatsApp'}</span>
                </div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="font-size:0.9rem;">${metaHtml}</div>
                <button class="btn-action" onclick="window.modalDetalleCliente('${c.id}'); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">👁️ Ficha Cliente</button>
            </div>
        </div>
        `;
    }).join('');
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

// ─── VIEW: Tabla ───────────────────────────────────────────────────────────────
const renderViewTabla = (list, clientStats) => `
<div class="purchase-view-panel">
    <div class="table-wrapper">
        <table class="data-table">
            <thead><tr>
                <th style="min-width:200px;">Nombre</th>
                <th style="min-width:150px;">Identificación</th>
                <th style="min-width:155px;">WhatsApp</th>
                <th style="min-width:200px;">Ciudad / Dirección</th>
                <th style="min-width:130px;">Lead Kommo</th>
                <th style="min-width:130px;">Fecha Ingreso</th>
                <th style="min-width:180px;">LTV (Compras)</th>
                <th class="text-right" style="min-width:120px;">Acción</th>
            </tr></thead>
            <tbody id="list-body">
            ${list.length > 0 ? [...list].reverse().map(c => {
                const stats = clientStats[c.id] || { count:0, total_gastado:0, saldo_pendiente:0 };
                const fecha = normDate(c.fecha_registro)||'-';
                const sf = `${c.nombre||''} ${c.numero_identificacion||''} ${c.whatsapp||''} ${c.ciudad||''} ${c.direccion||''} ${c.numero_lead_kommo||''}`.replace(/\s+/g,' ').trim();
                return `
                <tr class="client-row" data-text="${sf.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}">
                    <td style="font-weight:700;">${c.nombre}</td>
                    <td style="font-family:monospace;font-size:0.82rem;">${c.numero_identificacion||'—'}</td>
                    <td><span style="color:var(--success-green);font-weight:600;">${c.whatsapp||'—'}</span></td>
                    <td>
                        <div class="cell-title" style="max-width:180px;">${c.ciudad||'—'}</div>
                        <span class="cell-subtitle" style="white-space:normal;max-width:180px;display:block;">${c.direccion||''}</span>
                    </td>
                    <td style="font-size:0.85rem;">${c.numero_lead_kommo||'—'}</td>
                    <td style="font-size:0.85rem;opacity:0.8;">${fecha}</td>
                    <td>
                        <div class="cell-price" style="color:var(--primary-red);">${formatCOP(stats.total_gastado)}</div>
                        <span class="cell-subtitle">En ${stats.count} pedido(s)</span>
                    </td>
                    <td class="td-actions">
                        <div class="td-actions-group">
                            <button class="btn-action" onclick="window.modalDetalleCliente('${c.id}')" title="Ver Detalle">👁️ Ver</button>
                            ${auth.canEdit('clients') ? `<button class="btn-action" onclick="window.modalCliente('${c.id}')">Editar</button>` : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('') : ''}
            <tr class="empty-row table-empty-row" style="display:${list.length===0?'':'none'};"><td colspan="8">No se encontraron clientes.</td></tr>
            </tbody>
        </table>
    </div>
</div>`;

// ─── VIEW: Top Clientes ────────────────────────────────────────────────────────
const renderViewTop = (list, clientStats, ventasValidas) => {
    const totalGlobal = Object.values(clientStats).reduce((a,s)=>a+s.total_gastado,0);
    const ranked = [...list].map(c => ({...c, stats: clientStats[c.id]||{count:0,total_gastado:0,saldo_pendiente:0}}))
                            .sort((a,b) => b.stats.total_gastado - a.stats.total_gastado);
    return `
    <div class="purchase-view-panel">
        ${ranked.map((c, idx) => {
            const pct = totalGlobal > 0 ? Math.round((c.stats.total_gastado / totalGlobal) * 100) : 0;
            const cid = `cli-top-${c.id}`;
            const clientVentas = ventasValidas.filter(v => v.cliente_id.toString() === c.id.toString());
            return `
            <div class="purchase-group-card" id="${cid}" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cid}')">
                    <h3>
                        <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${idx===0?'var(--warning-orange)':idx===1?'rgba(200,200,200,0.5)':idx===2?'rgba(180,100,40,0.5)':'var(--glass-hover)'};text-align:center;font-size:0.7rem;line-height:22px;margin-right:8px;font-weight:800;">${idx+1}</span>
                        ${c.nombre}
                        ${c.stats.saldo_pendiente > 0 ? `<span style="font-size:0.65rem;color:var(--primary-red);margin-left:6px;font-weight:500;">⚠️ Debe ${formatCOP(c.stats.saldo_pendiente)}</span>` : ''}
                    </h3>
                    <div class="purchase-group-meta">
                        <span style="font-size:0.78rem;opacity:0.6;">${c.whatsapp||c.ciudad||'—'}</span>
                        <span>${c.stats.count} pedido(s)</span>
                        <strong style="color:var(--primary-red);">${formatCOP(c.stats.total_gastado)}</strong>
                        <span style="font-size:0.72rem;opacity:0.6;">${pct}% del total</span>
                        <span class="purchase-group-toggle">▼</span>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap"><div class="purchase-group-bar" style="width:${pct}%;background:var(--primary-red);"></div></div>
                <div class="purchase-group-body">
                    ${clientVentas.length === 0 ? '<div style="padding:0.8rem;opacity:0.4;font-size:0.82rem;">Sin pedidos registrados.</div>' :
                    clientVentas.map(v => {
                        const saldo = parseInt(v.saldo_pendiente||0);
                        return `
                        <div class="purchase-group-row">
                            <span style="font-size:0.78rem;font-weight:700;color:var(--primary-red);">#${v.id.toString().slice(-4)}</span>
                            <span style="flex:1;font-size:0.78rem;opacity:0.7;">${normDate(v.fecha)||''}</span>
                            <span style="font-size:0.78rem;">${v.tipo_venta||'Venta'}</span>
                            <span style="font-weight:700;font-size:0.78rem;">${formatCOP(v.valor_total_cop||0)}</span>
                            ${saldo>0?`<span style="font-size:0.7rem;color:var(--primary-red);">Debe: ${formatCOP(saldo)}</span>`:`<span style="font-size:0.7rem;color:var(--success-green);">✔ Pagado</span>`}
                            <button class="btn-action" style="font-size:0.68rem;" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${ranked.length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin clientes registrados.</p>':''}
    </div>`;
};

// ─── VIEW: Por Ciudad ──────────────────────────────────────────────────────────
const renderViewCiudad = (list, clientStats) => {
    const groups = {};
    list.forEach(c => {
        const ciudad = c.ciudad || 'Sin ciudad';
        if (!groups[ciudad]) groups[ciudad] = { clientes:[], total:0 };
        groups[ciudad].clientes.push(c);
        groups[ciudad].total += (clientStats[c.id]||{total_gastado:0}).total_gastado;
    });
    const totalGlobal = Object.values(groups).reduce((a,g)=>a+g.total,0);
    const sorted = Object.entries(groups).sort((a,b) => b[1].total - a[1].total);

    return `
    <div class="purchase-view-panel">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;">
            ${sorted.map(([ciudad, g]) => {
                const pct = totalGlobal > 0 ? Math.round((g.total/totalGlobal)*100) : 0;
                return `
                <div class="glass-card" style="padding:1.2rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.8rem;">
                        <div>
                            <div style="font-size:0.72rem;opacity:0.5;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">🏙️ Ciudad</div>
                            <h3 style="margin:0;font-size:1rem;">${ciudad}</h3>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:1.1rem;font-weight:700;color:var(--primary-red);">${formatCOP(g.total)}</div>
                            <div style="font-size:0.72rem;opacity:0.5;">${g.clientes.length} cliente(s) · ${pct}%</div>
                        </div>
                    </div>
                    <div style="height:4px;background:var(--glass-hover);border-radius:4px;overflow:hidden;margin-bottom:1rem;">
                        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--primary-red),var(--brand-magenta));border-radius:4px;transition:width 0.5s;"></div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${g.clientes.map(c => {
                            const stats = clientStats[c.id]||{count:0,total_gastado:0};
                            return `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--glass-hover);border-radius:8px;">
                                <div>
                                    <div style="font-size:0.8rem;font-weight:600;">${c.nombre}</div>
                                    <div style="font-size:0.68rem;opacity:0.5;">${stats.count} pedido(s)</div>
                                </div>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <span style="font-size:0.75rem;font-weight:700;">${formatCOP(stats.total_gastado)}</span>
                                    <button class="btn-action" style="font-size:0.65rem;padding:3px 8px;" onclick="window.modalDetalleCliente('${c.id}')">👁️</button>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            }).join('')}
        </div>
        ${sorted.length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin clientes registrados.</p>':''}
    </div>`;
};

// ─── VIEW: Saldos Pendientes ───────────────────────────────────────────────────
const renderViewSaldos = (list, clientStats, ventasValidas) => {
    const withDebt = list.map(c => ({...c, stats: clientStats[c.id]||{count:0,total_gastado:0,saldo_pendiente:0}}))
                        .filter(c => c.stats.saldo_pendiente > 0)
                        .sort((a,b) => b.stats.saldo_pendiente - a.stats.saldo_pendiente);

    if (withDebt.length === 0) {
        return `<div class="purchase-view-panel"><div style="text-align:center;padding:4rem;opacity:0.5;">🎉 Sin cartera pendiente. Todos los clientes están al día.</div></div>`;
    }
    const totalCartera = withDebt.reduce((a,c)=>a+c.stats.saldo_pendiente,0);
    return `
    <div class="purchase-view-panel">
        <div style="margin-bottom:1rem;padding:1rem 1.4rem;background:rgba(217,16,16,0.07);border:1px solid var(--brand-magenta);border-radius:var(--radius);display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.2rem;">⚠️</span>
            <span style="font-size:0.9rem;color:var(--primary-red);font-weight:700;">${withDebt.length} cliente(s) con cartera abierta · Total: <strong>${formatCOP(totalCartera)}</strong></span>
        </div>
        ${withDebt.map(c => {
            const cid = `cli-saldo-${c.id}`;
            const ventasPend = ventasValidas.filter(v => v.cliente_id.toString()===c.id.toString() && parseFloat(v.saldo_pendiente||0)>0);
            return `
            <div class="purchase-group-card open" id="${cid}" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cid}')">
                    <h3>👤 ${c.nombre} <span style="font-size:0.75rem;font-weight:500;opacity:0.6;margin-left:6px;">${c.ciudad||''}</span></h3>
                    <div class="purchase-group-meta">
                        <span style="font-size:0.78rem;color:var(--success-green);">${c.whatsapp?`<a href="https://wa.me/57${c.whatsapp.replace(/\D/g,'')}" target="_blank" style="color:var(--success-green);text-decoration:none;">📱 ${c.whatsapp}</a>`:''}</span>
                        <strong style="color:var(--primary-red);">Debe: ${formatCOP(c.stats.saldo_pendiente)}</strong>
                        <button class="btn-action" style="font-size:0.7rem;" onclick="window.modalDetalleCliente('${c.id}')">👁️ Ver</button>
                        <span class="purchase-group-toggle">▲</span>
                    </div>
                </div>
                <div class="purchase-group-body">
                    ${ventasPend.map(v => {
                        const saldo = parseFloat(v.saldo_pendiente||0);
                        const total = parseFloat(v.valor_total_cop||0);
                        const pct = total > 0 ? Math.round((saldo/total)*100) : 0;
                        return `
                        <div class="purchase-group-row" style="flex-direction:column;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--glass-border);">
                            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
                                <span style="font-size:0.78rem;font-weight:700;color:var(--primary-red);">Orden #${v.id.toString().slice(-4)} <span style="opacity:0.5;font-weight:400;">${normDate(v.fecha)||''}</span></span>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span style="font-size:0.75rem;">Total: ${formatCOP(total)}</span>
                                    <strong style="font-size:0.75rem;color:var(--primary-red);">Debe: ${formatCOP(saldo)}</strong>
                                    <button class="btn-action" style="font-size:0.68rem;" onclick="window.modalDetalleVentaGlobal('${v.id}')">👁️</button>
                                </div>
                            </div>
                            <div style="height:3px;background:var(--glass-hover);border-radius:3px;overflow:hidden;width:100%;">
                                <div style="height:100%;width:${100-pct}%;background:var(--success-green);border-radius:3px;"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
    </div>`;
};

// ─── VIEW: Timeline CRM ────────────────────────────────────────────────────────
const renderViewTimeline = (list, clientStats) => {
    const sorted = [...list].sort((a,b) => {
        const da = new Date(normDate(a.fecha_registro)||0);
        const db2 = new Date(normDate(b.fecha_registro)||0);
        return db2 - da;
    });
    const groups = {};
    sorted.forEach(c => {
        const k = normDate(c.fecha_registro)||'sin-fecha';
        if (!groups[k]) groups[k] = [];
        groups[k].push(c);
    });
    return `
    <div class="purchase-view-panel">
        <div class="purchase-timeline">
            ${Object.entries(groups).map(([dk, items]) => `
            <div class="timeline-day-group">
                <div class="timeline-day-label">${labelDate(dk)}</div>
                ${items.map(c => {
                    const stats = clientStats[c.id]||{count:0,total_gastado:0};
                    return `
                    <div class="timeline-item">
                        <span class="timeline-item-id">👤</span>
                        <div class="timeline-item-main">
                            <div class="timeline-item-prov">${c.nombre}</div>
                            <div class="timeline-item-sub">${c.ciudad||'—'} · ${c.whatsapp||'sin WA'}</div>
                        </div>
                        <span style="font-size:0.72rem;opacity:0.5;">${stats.count} pedido(s)</span>
                        <span class="timeline-item-price" style="color:var(--primary-red);">${formatCOP(stats.total_gastado)}</span>
                        <button class="btn-action" style="font-size:0.65rem;padding:4px 8px;" onclick="window.modalDetalleCliente('${c.id}')">👁️</button>
                    </div>`;
                }).join('')}
            </div>`).join('')}
            ${Object.keys(groups).length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin clientes.</p>':''}
        </div>
    </div>`;
};

// ─── Inject view ───────────────────────────────────────────────────────────────
function injectClientView(view) {
    const area = document.getElementById('cli-view-area');
    if (!area || !_cliCache) return;
    const { list, clientStats, ventasValidas } = _cliCache;
    let html = '';
    if      (view==='top')      html = renderViewTop(list, clientStats, ventasValidas);
    else if (view==='ciudad')   html = renderViewCiudad(list, clientStats);
    else if (view==='saldos')   html = renderViewSaldos(list, clientStats, ventasValidas);
    else if (view==='timeline') html = renderViewTimeline(list, clientStats);
    else                        html = renderViewTabla(list, clientStats);

    area.style.opacity='0';
    setTimeout(() => {
        area.innerHTML = html;
        area.style.opacity='1';
        area.style.transition='opacity 0.25s';
        attachCliSearch();
        attachGroupToggles();
    }, 100);
}

function attachCliSearch() {
    const fi = document.getElementById('find-it');
    if (!fi) return;
    fi.oninput = (e) => {
        const k = e.target.value.toLowerCase().trim();
        let vis = 0;
        document.querySelectorAll('#list-body .client-row').forEach(r => {
            const m = (r.getAttribute('data-text')||'').toLowerCase().includes(k);
            r.style.display = m ? '' : 'none';
            if (m) vis++;
        });
        const em = document.querySelector('#list-body .empty-row');
        if (em) em.style.display=(vis===0&&k.length>0)?'':'none';
    };
}

function attachGroupToggles() {
    if (typeof window.togglePurchaseGroup === 'undefined') {
        window.togglePurchaseGroup = (id) => {
            const card=document.getElementById(id);
            if(!card) return;
            const isOpen=card.classList.toggle('open');
            const tog=card.querySelector('.purchase-group-toggle');
            if(tog) tog.textContent=isOpen?'▲':'▼';
        };
    }
}

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderClients = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Cargando CRM...</div>`);
    _cliActiveView = 'tabla';

    const [list, ventas] = await Promise.all([
        db.fetchData('Clientes'),
        db.fetchData('Ventas'),
    ]);
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    const ventasValidas = ventas.error ? [] : ventas;
    const clientStats = {};
    ventasValidas.forEach(v => {
        const id = v.cliente_id;
        if (!clientStats[id]) clientStats[id] = { count:0, total_gastado:0, saldo_pendiente:0 };
        clientStats[id].count += 1;
        clientStats[id].total_gastado   += parseFloat(v.valor_total_cop)||0;
        clientStats[id].saldo_pendiente += parseFloat(v.saldo_pendiente)||0;
    });
    _cliCache = { list, clientStats, ventasValidas };

    window.exportCliExcel = () => {
        if (list.length === 0) return showToast('No hay clientes para exportar', 'error');
        const dataToExport = list.map(c => {
            const stats = clientStats[c.id] || { count:0, total_gastado:0, saldo_pendiente:0 };
            return {
                'ID Cliente': c.id,
                'Nombre': c.nombre || '',
                'Identificación': c.numero_identificacion || '',
                'WhatsApp': c.whatsapp || '',
                'Ciudad': c.ciudad || '',
                'Dirección': c.direccion || '',
                'Lead Kommo': c.numero_lead_kommo || '',
                'Fecha Registro': c.fecha_registro || '',
                'LTV (Total Gastado)': parseFloat(stats.total_gastado || 0),
                'Pedidos (Count)': parseFloat(stats.count || 0),
                'Cartera (Saldo Pendiente)': parseFloat(stats.saldo_pendiente || 0)
            };
        });
        downloadExcel(dataToExport, `Reporte_Clientes_${new Date().toISOString().split('T')[0]}`);
    };

    // ── Modal Detalle Cliente ──────────────────────────────────────────────────
    window.modalDetalleCliente = (id) => {
        const c = list.find(x => x.id.toString() === id.toString());
        if (!c) return;
        const stats = clientStats[id] || { count:0, total_gastado:0 };
        const container = document.getElementById('modal-container');
        const content   = document.getElementById('modal-content');
        const clientVentas = ventasValidas.filter(v => v.cliente_id.toString() === id.toString());

        window.switchClientTab = (tabMap) => {
            document.getElementById('c-tab-1').style.display = tabMap===1?'block':'none';
            document.getElementById('c-tab-2').style.display = tabMap===2?'block':'none';
            document.getElementById('btn-ctab-1').style.borderBottomColor = tabMap===1?'var(--primary-red)':'transparent';
            document.getElementById('btn-ctab-2').style.borderBottomColor = tabMap===2?'var(--primary-red)':'transparent';
            document.getElementById('btn-ctab-1').style.opacity = tabMap===1?'1':'0.5';
            document.getElementById('btn-ctab-2').style.opacity = tabMap===2?'1':'0.5';
        };

        const comprasHtml = clientVentas.length===0
            ? `<div style="text-align:center;opacity:0.5;padding:2rem;">Este cliente aún no registra compras.</div>`
            : clientVentas.map(v => {
                const saldo=parseInt(v.saldo_pendiente)||0;
                const abonos=parseInt(v.abonos_acumulados)||0;
                return `
                <div style="background:var(--input-bg);padding:1rem;border-radius:12px;border:1px solid var(--glass-border);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong style="color:var(--primary-red);">ORDEN #${v.id.toString().slice(-4)}</strong>
                        <span style="font-size:0.75rem;opacity:0.6;margin-left:10px;">${normDate(v.fecha)||''}</span>
                        <div style="font-size:0.8rem;margin-top:5px;">
                            Total: <strong>${formatCOP(parseInt(v.valor_total_cop))}</strong> | 
                            ${saldo>0?`<span style="color:var(--primary-red);">Debe: ${formatCOP(saldo)}</span>`:`<span style="color:var(--success-green);">Abonado: ${formatCOP(abonos)}</span>`}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.65rem;padding:4px 8px;border-radius:12px;background:var(--glass-hover);border:1px solid var(--glass-border);display:inline-block;margin-bottom:8px;">${v.estado_orden}</span><br>
                        <button class="btn-action" onclick="window.modalDetalleVentaGlobal('${v.id}','window.modalDetalleCliente(\\'${c.id}\\')')">👁️ Ver Pedido</button>
                    </div>
                </div>`;
            }).join('');

        content.innerHTML = `
            <div class="modal-content modal-wide">
                <div class="modal-header">
                    <div>
                        <h2 class="modal-title">${c.nombre}</h2>
                        <p class="modal-subtitle">C.C / NIT: ${c.numero_identificacion || 'N/A'}</p>
                    </div>
                    <button onclick="window.closeModal()" class="modal-close">&times;</button>
                </div>
            
            <div class="modal-body">
                <div style="display:flex; border-bottom:1px solid var(--glass-border); margin-bottom:1.5rem; gap:1.5rem;">
                    <button id="btn-ctab-1" onclick="window.switchClientTab(1)" style="flex:1; background:none; border:none; border-bottom:2px solid var(--primary-red); color:var(--text-main); padding-bottom:10px; font-weight:700; cursor:pointer; font-size:0.9rem; transition:0.3s; opacity:1;">📄 Datos del Cliente</button>
                    <button id="btn-ctab-2" onclick="window.switchClientTab(2)" style="flex:1; background:none; border:none; border-bottom:2px solid transparent; color:var(--text-main); padding-bottom:10px; font-weight:700; cursor:pointer; font-size:0.9rem; transition:0.3s; opacity:0.5;">🛍️ Compras Históricas (${clientVentas.length})</button>
                </div>

                <div id="c-tab-1">
                    <div class="form-section">
                        <h4 class="form-section-title">Datos de Contacto y Envío</h4>
                        <div class="form-grid">
                            <div class="modal-info-box">
                                <p style="margin:0 0 5px; font-size:0.75rem; opacity:0.6;">📱 WhatsApp</p>
                                <strong style="font-size:1.1rem; color:var(--success-green);">${c.whatsapp || 'No registrado'}</strong>
                            </div>
                            <div class="modal-info-box">
                                <p style="margin:0 0 5px; font-size:0.75rem; opacity:0.6;">🏢 Lead Kommo</p>
                                <strong style="font-size:1.1rem;">${c.numero_lead_kommo || 'Sin vincular'}</strong>
                            </div>
                        </div>
                    </div>

                    <div class="form-section">
                        <h4 class="form-section-title">Histórico de Direcciones</h4>
                        <div style="background:var(--glass-hover); border:1px solid var(--glass-border); border-radius:12px; padding:1.2rem;">
                            ${(c.direccion || '').split(' | ').reverse().map((d, i) => {
                                const isMain = i === 0;
                                return `
                                <div style="display:flex; align-items:center; gap:12px; padding:10px 0; ${!isMain ? 'border-top:1px solid rgba(255,255,255,0.05); opacity:0.7;' : ''}">
                                    <div style="width:8px; height:8px; border-radius:50%; background:${isMain ? 'var(--primary-red)' : 'var(--glass-border)'}; box-shadow:${isMain ? '0 0 8px var(--primary-red)' : 'none'};"></div>
                                    <div style="flex:1;">
                                        <div style="font-size:0.95rem; font-weight:${isMain ? '700' : '400'};">${d}</div>
                                        ${isMain ? '<span style="font-size:0.65rem; color:var(--primary-red); font-weight:700; text-transform:uppercase; letter-spacing:1px;">Actual / Principal</span>' : ''}
                                    </div>
                                </div>`;
                            }).join('') || '<div style="opacity:0.4; text-align:center; padding:10px;">Sin direcciones registradas</div>'}
                        </div>
                    </div>

                    <div class="form-section">
                        <h4 class="form-section-title">Estadísticas CRM</h4>
                        <div class="form-grid" style="grid-template-columns: repeat(3, 1fr);">
                            <div class="modal-stat-box">
                                <span style="font-size:0.75rem; opacity:0.6; margin-bottom:4px;">🛒 Total Comprado</span>
                                <strong style="font-size:1.15rem; color:var(--primary-red);">${formatCOP(stats.total_gastado)}</strong>
                            </div>
                            <div class="modal-stat-box">
                                <span style="font-size:0.75rem; opacity:0.6; margin-bottom:4px;">📦 Número Pedidos</span>
                                <strong style="font-size:1.15rem;">${stats.count} Registros</strong>
                            </div>
                            <div class="modal-stat-box">
                                <span style="font-size:0.75rem; opacity:0.6; margin-bottom:4px;">📅 Ingreso</span>
                                <strong style="font-size:1.15rem;">${normDate(c.fecha_registro) || 'N/A'}</strong>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="c-tab-2" style="display:none;">
                    <div style="max-height:45vh; overflow-y:auto; padding-right:10px;">${comprasHtml}</div>
                </div>
            </div>

            <div class="modal-footer">
                <button type="button" class="btn-secondary" onclick="window.closeModal()">Cerrar</button>
                <button type="button" class="btn-primary" onclick="window.closeModal(); window.modalCliente('${c.id}')">✏️ Editar Cliente</button>
            </div>
        </div>`;
        container.style.display = 'flex';

        container.style.display = 'flex';
    };

    window.switchClientView = (view) => {
        _cliActiveView = view;
        document.querySelectorAll('.pv-tab[data-cli-view]').forEach(b => b.classList.toggle('active', b.dataset.cliView===view));
        injectClientView(view);
    };

    const tabs = [
        { id:'tabla',    icon:'📋', label:'Tabla' },
        { id:'top',      icon:'🏆', label:'Top Clientes' },
        { id:'ciudad',   icon:'🏙️', label:'Por Ciudad' },
        { id:'saldos',   icon:'💳', label:'Saldos Pendientes' },
        { id:'timeline', icon:'📅', label:'Timeline CRM' },
    ];

    // Pagination State
    const _page = parseInt(localStorage.getItem('clients_page') || '1');
    const _rpp  = parseInt(localStorage.getItem('clients_rpp') || '10');
    const pagedList = _cliActiveView === 'tabla' ? paginate(list, _page, _rpp) : list;

    const html = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.5rem;">
        <div>
            <span class="page-eyebrow">CRM · Medellín</span>
            <h2 class="page-title">Mis Clientes</h2>
            <p style="opacity:0.5;font-size:0.82rem;margin-top:4px;">Gestión de contactos, LTV y cartera pendiente.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
            <button class="btn-excel" onclick="window.exportCliExcel()">📥 Excel</button>
            <input type="text" id="find-it" placeholder="Filtrar cliente..." style="background:var(--input-bg);border:1px solid var(--glass-border);padding:10px 15px;border-radius:12px;color:var(--text-main);width:230px;outline:none;">
            ${auth.canEdit('clients') ? `<button class="btn-primary" onclick="window.modalCliente()">+ Nuevo Cliente</button>` : ''}
        </div>
    </div>

    ${renderCRMKPI(list, clientStats)}

    <div class="purchase-view-switcher" style="margin-bottom:1.5rem;">
        ${tabs.map(t => `
        <button class="pv-tab${t.id===_cliActiveView?' active':''}" data-cli-view="${t.id}" onclick="window.switchClientView('${t.id}')">
            ${t.icon} ${t.label}
        </button>`).join('')}
    </div>

    <div id="cli-view-area">
        ${_cliActiveView === 'tabla' ? renderViewTabla(pagedList, clientStats) : injectClientView(_cliActiveView)}
    </div>
    ${_cliActiveView === 'tabla' ? renderPagination(list.length, _page, _rpp, 'clients') : ''}`;

    renderLayout(html);
    setTimeout(() => { attachCliSearch(); attachGroupToggles(); }, 150);
};

// ─── Create Client Modal (unchanged) ──────────────────────────────────────────
export const createClientModal = async (id, navigateTo) => {
    let mode = id ? 'UPDATE' : 'INSERT';
    let data = { nombre:'', numero_identificacion:'', numero_lead_kommo:'', direccion:'', ciudad:'Medellín', whatsapp:'' };
    const container = document.getElementById('modal-container');
    const content   = document.getElementById('modal-content');

    if (id) {
        content.innerHTML = `<div style="text-align:center;padding:2rem;"><div class="loader"></div> Cargando Ficha...</div>`;
        container.style.display = 'flex';
        const list2 = await db.fetchData('Clientes');
        const target = list2.find(it => it.id.toString() === id.toString());
        if (target) data = { ...target };
    }

        content.innerHTML = `
            <div class="modal-content modal-wide">
                <div class="modal-header">
                    <h2 class="modal-title">${id ? 'Editar Cliente' : 'Crear Nuevo Cliente'}</h2>
                    <button onclick="window.closeModal()" class="modal-close">&times;</button>
                </div>
                
                <form id="form-crud">
                <div class="modal-body">
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Nombre Completo</label>
                            <input type="text" name="nombre" value="${data.nombre}" required placeholder="Ej. Juan Pérez">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Identificación (C.C/NIT)</label>
                            <input type="text" name="nid" value="${data.numero_identificacion}" placeholder="Opcional">
                        </div>
                        <div class="form-group">
                            ${id ? `
                                <label class="form-label">Lead Kommo (Actual: ${data.numero_lead_kommo || 'Ninguno'})</label>
                                <input type="hidden" name="kommo" value="${data.numero_lead_kommo || ''}">
                                <input type="text" name="new_kommo" placeholder="Agregar nuevo Lead ID...">
                            ` : `
                                <label class="form-label">ID Lead Kommo (Opcional)</label>
                                <input type="text" name="kommo" value="${data.numero_lead_kommo || ''}" placeholder="ID de la oportunidad">
                            `}
                        </div>
                        <div class="form-group">
                            ${id ? `
                                <label class="form-label">WhatsApp (Actual: ${data.whatsapp || 'Ninguno'})</label>
                                <input type="hidden" name="wa" value="${data.whatsapp || ''}">
                                <input type="text" name="new_wa" placeholder="Agregar nuevo número...">
                            ` : `
                                <label class="form-label">WhatsApp</label>
                                <input type="text" name="wa" value="${data.whatsapp || ''}" required placeholder="Ej. 3001234567">
                            `}
                        </div>
                        <div class="form-group">
                            <label class="form-label">Ciudad de Residencia</label>
                            <input type="text" name="ciu" value="${data.ciudad}" required placeholder="Ej. Medellín">
                        </div>
                        <div class="form-group" style="grid-column: span 3;">
                            ${id ? `
                                <label class="form-label">Direcciones (Actuales: ${data.direccion || 'Ninguna'})</label>
                                <input type="hidden" name="dir" value="${data.direccion || ''}">
                                <input type="text" name="new_dir" placeholder="Agregar nueva dirección física...">
                            ` : `
                                <label class="form-label">Dirección Física de Entrega</label>
                                <input type="text" name="dir" value="${data.direccion || ''}" required placeholder="Calle, Carrera, Número, Apto...">
                            `}
                        </div>
                    </div>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
                    <button type="submit" class="btn-primary">Guardar en CRM</button>
                </div>
            </form>
        </div>`;
        container.style.display = 'flex';

    container.style.display = 'flex';

    document.getElementById('form-crud').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled=true; btn.innerText='Sincronizando...';

        const nid = fd.get('nid')||'';
        let kommo = fd.get('kommo')||'';
        let wa = fd.get('wa')||'';
        let dir = fd.get('dir')||'';
        const new_dir = fd.get('new_dir');
        const new_wa = fd.get('new_wa');
        const new_kommo = fd.get('new_kommo');

        try { 
            const list2 = await db.fetchData('Clientes');

            if (mode === 'INSERT') {
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
                        
                        const fullDir = `${fd.get('dir')} (${fd.get('ciu')})`;
                        if (dir && (!existing.direccion || !existing.direccion.includes(fd.get('dir')))) {
                            existing.direccion = existing.direccion ? existing.direccion + ' | ' + fullDir : fullDir;
                        }
                        existing.ciudad = fd.get('ciu'); 
                        
                        await db.postData('Clientes', existing, 'UPDATE');
                        window.closeModal(); navigateTo('clients');
                    } else {
                        btn.disabled=false; btn.innerText='Guardar en CRM';
                    }
                    return;
                }
            } else if (mode === 'UPDATE') {
                if (new_dir) {
                    const fullDir = `${new_dir} (${fd.get('ciu')})`;
                    dir = dir ? dir + ' | ' + fullDir : fullDir;
                }
                if (new_wa) wa = wa ? wa + ' | ' + new_wa : new_wa;
                if (new_kommo) kommo = kommo ? kommo + ' | ' + new_kommo : new_kommo;
            }

            // Para nuevos registros, formatear la dirección inicial
            if (mode === 'INSERT' && dir && !dir.includes('(')) {
                dir = `${dir} (${fd.get('ciu')})`;
            }

            const payload = { 
                id:id||Date.now().toString(), 
                nombre:fd.get('nombre'), 
                numero_identificacion:nid, 
                numero_lead_kommo:kommo, 
                direccion:dir, 
                ciudad:fd.get('ciu'), 
                whatsapp:wa, 
                fecha_registro:data.fecha_registro||new Date().toLocaleDateString() 
            };
            
            await db.postData('Clientes',payload,mode); 
            window.closeModal(); navigateTo('clients'); 
        }
        catch(err){ window.showToast(err.message, 'error'); btn.disabled=false; btn.innerText='Reintentar'; }
    };
};
