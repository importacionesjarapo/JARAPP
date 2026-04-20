import { db } from '../db.js';
import { formatUSD, formatCOP, renderError, showToast, uploadImageToSupabase, getLogisticaFase, getLogisticaColor, downloadExcel } from '../utils.js';

// ─── Cache ─────────────────────────────────────────────────────────────────────
let globalListCache = [];
let globalSalesCache = [];
let globalClientsCache = [];
let globalLogisticaCache = [];
let _invActiveView = 'grid';
let _invActiveTab = 'disponibles';

// ─── Helpers ───────────────────────────────────────────────────────────────────
const getProductRealStatus = (producto, venta) => {
    if (venta) {
        const fase = getLogisticaFase(venta.id, globalLogisticaCache, producto.estado_producto||'En Proceso');
        return { label: fase, color: getLogisticaColor(fase) };
    }
    const st = producto.estado_producto || 'Disponible';
    let color = 'var(--info-blue)';
    if (st.includes('Vendido')||st.includes('Sin Stock')) color = 'var(--warning-orange)';
    else if (st.includes('Disponible')&&st.includes('inmediata')) color = 'var(--success-green)';
    else if (st.includes('Pendiente')||st.includes('compra')) color = 'var(--primary-red)';
    return { label:st, color };
};

const filterByTab = (list, tab) => {
    if (tab==='disponibles') return list.filter(p => p.estado_producto==='Disponible entrega inmediata');
    return list.filter(p => p.estado_producto!=='Disponible entrega inmediata');
};

// ─── KPI Strip ─────────────────────────────────────────────────────────────────
const renderInvKPI = (list) => {
    const disponibles = list.filter(p=>p.estado_producto==='Disponible entrega inmediata').length;
    const transito    = list.filter(p=>p.estado_producto!=='Disponible entrega inmediata').length;
    const valorCatalogo = list.reduce((a,p)=>a+(parseFloat(p.precio_cop)||0),0);
    const marcas      = new Set(list.map(p=>p.marca).filter(Boolean)).size;

    const kpis = [
        { icon:'📦', value: list.length,              label:'Total Productos',     color:'var(--info-blue)' },
        { icon:'✅', value: disponibles,               label:'Disponibles MDE',    color:'var(--success-green)' },
        { icon:'✈️', value: transito,                  label:'En Tránsito/Encargo',color:'var(--warning-orange)' },
        { icon:'💰', value: formatCOP(valorCatalogo), label:'Valor Catálogo',     color:'var(--brand-green)' },
        { icon:'🏷️', value: marcas,                    label:'Marcas Únicas',      color:'var(--primary-red)' },
    ];
    return `
    <div class="kpi-strip">
        ${kpis.map(k=>`
        <div class="kpi-strip-card">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
};

// ─── VIEW: Grid ─────────────────────────────────────────────────────────────────
const renderViewGrid = (list) => `
<div class="purchase-view-panel">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:1.5rem;">
        ${list.map(p => {
            const venta = globalSalesCache.find(v=>v.producto_id&&v.producto_id.toString()===p.id.toString());
            const {label:statusLabel, color:statusColor} = getProductRealStatus(p, venta);
            const badgeVenta = venta?`<button onclick="window.modalViewSaleDetail('${venta.id}')" style="position:absolute;top:15px;left:15px;background:rgba(6,214,160,0.2);border:1px solid var(--success-green);color:var(--success-green);font-size:0.55rem;padding:4px 8px;border-radius:15px;font-weight:700;cursor:pointer;">🏷️ ORDEN #${venta.id.toString().slice(-4)}</button>`:'';
            const sf = `${p.marca||''} ${p.nombre_producto||''} ${p.sku||''} ${p.categoria||''} ${p.talla||''} ${p.genero||''} ${statusLabel}`.replace(/\s+/g,' ').trim();
            return `
            <div class="glass-card inv-item-filterable" style="position:relative;" data-text="${sf.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}">
                ${badgeVenta}
                <span style="position:absolute;top:15px;right:15px;background:${statusColor};font-size:0.55rem;padding:4px 8px;border-radius:15px;font-weight:700;text-transform:uppercase;color:#fff;max-width:140px;text-align:center;line-height:1.3;white-space:normal;">${statusLabel}</span>
                <div style="height:150px;background:var(--glass-hover);display:flex;align-items:center;justify-content:center;margin-bottom:1rem;border-radius:8px;overflow:hidden;">
                    ${p.url_imagen?`<img src="${p.url_imagen}" style="max-height:100%;object-fit:contain;">`:'<span style="opacity:0.1;font-weight:700;">JARAPO</span>'}
                </div>
                <span style="font-size:0.7rem;color:var(--primary-red);font-weight:700;text-transform:uppercase;">${p.marca}</span>
                <h4 style="margin:5px 0 0.5rem;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${p.nombre_producto}">${p.nombre_producto}</h4>
                <div style="display:flex;justify-content:space-between;margin-bottom:0.8rem;border-bottom:1px solid var(--glass-border);padding-bottom:5px;">
                    <p style="font-size:0.68rem;opacity:0.6;margin:0;font-family:monospace;">${p.sku}</p>
                    <p style="font-size:0.62rem;padding:2px 6px;background:var(--input-bg);border-radius:4px;margin:0;">T: <strong>${p.talla||'-'}</strong> | G: <strong>${p.genero||'-'}</strong></p>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span style="opacity:0.6;font-size:0.75rem;">Costo: ${formatUSD(p.precio_usd)}</span>
                    <span style="font-weight:700;">${formatCOP(p.precio_cop)}</span>
                </div>
                <div style="background:var(--glass-hover);padding:8px;border-radius:8px;font-size:0.72rem;display:flex;justify-content:space-between;margin-bottom:10px;">
                    <span>MDE: ${p.stock_medellin}</span><span style="opacity:0.4;">USA: ${p.stock_miami}</span>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn-action" onclick="window.modalViewProduct('${p.id}')">👁️ Detalles</button>
                    <button class="btn-action" onclick="window.modalProducto('${p.id}')">Editar</button>
                </div>
            </div>`;
        }).join('')}
    </div>
    ${list.length===0?'<div style="text-align:center;padding:3rem;opacity:0.5;">Sin existencias en esta categoría.</div>':''}
    <div id="inv-empty-search" style="display:none;text-align:center;padding:3rem;opacity:0.5;">No se encontraron productos que coincidan.</div>
</div>`;

// ─── VIEW: Tabla ─────────────────────────────────────────────────────────────────
const renderViewTabla = (list) => `
<div class="purchase-view-panel">
    <div class="table-wrapper">
        <table class="data-table">
            <thead><tr>
                <th style="min-width:200px;">Estado / Fase</th>
                <th style="min-width:90px;">Marca</th>
                <th style="min-width:280px;">Modelo / Producto</th>
                <th class="text-center" style="min-width:90px;">Talla</th>
                <th class="text-center" style="min-width:90px;">Género</th>
                <th class="text-center" style="min-width:100px;">Stock MDE</th>
                <th class="text-center" style="min-width:100px;">Stock USA</th>
                <th class="text-right" style="min-width:120px;">Costo USD</th>
                <th class="text-right" style="min-width:145px;">Precio Venta</th>
                <th class="text-right" style="min-width:100px;">Acciones</th>
            </tr></thead>
            <tbody>
            ${list.map(p => {
                const venta = globalSalesCache.find(v=>v.producto_id&&v.producto_id.toString()===p.id.toString());
                const {label:statusLabel, color:statusColor} = getProductRealStatus(p, venta);
                const badgeVenta = venta?`<button onclick="window.modalViewSaleDetail('${venta.id}')" style="background:rgba(6,214,160,0.1);border:1px solid var(--success-green);color:var(--success-green);font-size:0.55rem;padding:3px 8px;border-radius:6px;font-weight:800;cursor:pointer;display:inline-block;margin-top:5px;">🏷️ Orden #${venta.id.toString().slice(-4)}</button>`:'';
                const sf = `${p.marca||''} ${p.nombre_producto||''} ${p.categoria||''} ${p.talla||''} ${p.genero||''} ${statusLabel}`.replace(/\s+/g,' ').trim();
                return `
                <tr class="inv-item-filterable" data-text="${sf.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}">
                    <td><span class="status-badge" style="background:${statusColor};">${statusLabel}</span></td>
                    <td style="font-weight:800;color:var(--primary-red);letter-spacing:0.3px;">${p.marca}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:12px;">
                            ${p.url_imagen?`<img src="${p.url_imagen}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--glass-border);">`:`<div style="width:40px;height:40px;background:var(--glass-hover);border-radius:8px;flex-shrink:0;"></div>`}
                            <div style="min-width:0;">
                                <div class="cell-title" style="max-width:200px;">${p.nombre_producto}</div>
                                ${badgeVenta}
                            </div>
                        </div>
                    </td>
                    <td class="text-center" style="font-weight:700;">${p.talla||'<span style="opacity:0.3">—</span>'}</td>
                    <td class="text-center" style="font-size:0.85rem;">${p.genero||'<span style="opacity:0.3">—</span>'}</td>
                    <td class="text-center"><span class="cell-number" style="color:${parseInt(p.stock_medellin)>0?'var(--success-green)':'var(--primary-red)'};">${p.stock_medellin??'0'}</span></td>
                    <td class="text-center" style="opacity:0.65;">${p.stock_miami??'—'}</td>
                    <td class="text-right" style="font-family:monospace;font-size:0.85rem;opacity:0.75;">${formatUSD(p.precio_usd)}</td>
                    <td class="text-right cell-price" style="color:var(--success-green);">${formatCOP(p.precio_cop)}</td>
                    <td class="td-actions">
                        <div class="td-actions-group">
                            <button class="btn-action" onclick="window.modalViewProduct('${p.id}')" title="Ver">👁️</button>
                            <button class="btn-action" onclick="window.modalProducto('${p.id}')" title="Editar">✏️</button>
                        </div>
                    </td>
                </tr>`;
            }).join('')}
            <tr class="table-empty-row" id="inv-empty-search" style="display:none;"><td colspan="10">Sin resultados.</td></tr>
            ${list.length===0?'<tr class="table-empty-row"><td colspan="10">Sin existencias en esta categoría.</td></tr>':''}
            </tbody>
        </table>
    </div>
</div>`;

// ─── VIEW: Por Marca ───────────────────────────────────────────────────────────
const renderViewMarca = (list) => {
    const groups = {};
    list.forEach(p => {
        const k = p.marca || 'Sin Marca';
        if (!groups[k]) groups[k] = { items:[], total:0 };
        groups[k].items.push(p);
        groups[k].total += parseFloat(p.precio_cop)||0;
    });
    const totalGlobal = Object.values(groups).reduce((a,g)=>a+g.total,0);
    const sorted = Object.entries(groups).sort((a,b)=>b[1].total-a[1].total);
    return `
    <div class="purchase-view-panel">
        ${sorted.map(([marca, g], idx) => {
            const pct = totalGlobal>0?Math.round((g.total/totalGlobal)*100):0;
            const cid=`inv-marca-${idx}`;
            return `
            <div class="purchase-group-card open" id="${cid}" style="margin-bottom:0.8rem;">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cid}')">
                    <h3>🏷️ ${marca}</h3>
                    <div class="purchase-group-meta">
                        <span>${g.items.length} producto(s)</span>
                        <strong>${formatCOP(g.total)}</strong>
                        <span style="font-size:0.72rem;opacity:0.6;">${pct}% del catálogo</span>
                        <span class="purchase-group-toggle">▲</span>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap"><div class="purchase-group-bar" style="width:${pct}%;"></div></div>
                <div class="purchase-group-body">
                    ${g.items.map(p => {
                        const {label:sl, color:sc} = getProductRealStatus(p, globalSalesCache.find(v=>v.producto_id?.toString()===p.id.toString()));
                        return `
                        <div class="purchase-group-row">
                            ${p.url_imagen?`<img src="${p.url_imagen}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;">`:'<div style="width:36px;height:36px;background:var(--glass-hover);border-radius:6px;flex-shrink:0;"></div>'}
                            <div style="flex:1;min-width:0;">
                                <div class="cell-title" style="max-width:240px;font-size:0.82rem;">${p.nombre_producto}</div>
                                <div style="font-size:0.7rem;opacity:0.5;">${p.sku} · T${p.talla||'—'}</div>
                            </div>
                            <span class="status-badge" style="background:${sc};font-size:0.58rem;">${sl}</span>
                            <span style="font-weight:700;font-size:0.82rem;">${formatCOP(p.precio_cop)}</span>
                            <button class="btn-action" style="font-size:0.68rem;" onclick="window.modalViewProduct('${p.id}')">👁️</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${sorted.length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin productos registrados.</p>':''}
    </div>`;
};

// ─── VIEW: Por Categoría ───────────────────────────────────────────────────────
const renderViewCategoria = (list) => {
    const groups = {};
    list.forEach(p => {
        const k = p.categoria || 'Sin Categoría';
        if (!groups[k]) groups[k] = { items:[], total:0 };
        groups[k].items.push(p);
        groups[k].total += parseFloat(p.precio_cop)||0;
    });
    const sorted = Object.entries(groups).sort((a,b)=>b[1].items.length-a[1].items.length);
    return `
    <div class="purchase-view-panel">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
            ${sorted.map(([cat, g]) => `
            <div class="glass-card" style="padding:1.2rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.8rem;">
                    <div>
                        <div style="font-size:0.7rem;opacity:0.5;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">📦 Categoría</div>
                        <h3 style="margin:0;font-size:1rem;">${cat}</h3>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.1rem;font-weight:700;color:var(--success-green);">${formatCOP(g.total)}</div>
                        <div style="font-size:0.72rem;opacity:0.5;">${g.items.length} producto(s)</div>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:5px;margin-top:0.5rem;">
                    ${g.items.slice(0,4).map(p => {
                        const {label:sl,color:sc} = getProductRealStatus(p, globalSalesCache.find(v=>v.producto_id?.toString()===p.id.toString()));
                        return `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--glass-hover);border-radius:7px;">
                            <div style="font-size:0.78rem;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.marca} ${p.nombre_producto}</div>
                            <span class="status-badge" style="background:${sc};font-size:0.55rem;margin:0 6px;">${sl}</span>
                            <button class="btn-action" style="font-size:0.62rem;padding:3px 7px;" onclick="window.modalViewProduct('${p.id}')">👁️</button>
                        </div>`;
                    }).join('')}
                    ${g.items.length>4?`<div style="font-size:0.72rem;opacity:0.4;text-align:center;padding:4px;">+ ${g.items.length-4} más...</div>`:''}
                </div>
            </div>`).join('')}
        </div>
        ${sorted.length===0?'<p style="opacity:0.5;text-align:center;padding:3rem;">Sin productos registrados.</p>':''}
    </div>`;
};

// ─── VIEW: Precios ─────────────────────────────────────────────────────────────
const renderViewPrecios = (list) => {
    const sorted = [...list].sort((a,b)=>(parseFloat(b.precio_cop)||0)-(parseFloat(a.precio_cop)||0));
    return `
    <div class="purchase-view-panel">
        <div class="table-wrapper">
            <table class="data-table">
                <thead><tr>
                    <th style="min-width:280px;">Producto</th>
                    <th style="min-width:90px;">Marca</th>
                    <th class="text-right" style="min-width:130px;">Costo (USD)</th>
                    <th class="text-right" style="min-width:155px;">Precio Venta (COP)</th>
                    <th class="text-right" style="min-width:130px;">Margen Est.</th>
                    <th style="min-width:80px;">Tienda</th>
                    <th class="text-right" style="min-width:100px;">Acciones</th>
                </tr></thead>
                <tbody>
                ${sorted.map(p => {
                    const costoCOP = (parseFloat(p.precio_usd)||0) * 4300; // TRM referencia
                    const margen = parseFloat(p.precio_cop)>0 ? Math.round(((parseFloat(p.precio_cop)-costoCOP)/parseFloat(p.precio_cop))*100) : 0;
                    const margenColor = margen > 30 ? 'var(--success-green)' : margen > 10 ? 'var(--warning-orange)' : 'var(--primary-red)';
                    const sf=`${p.marca||''} ${p.nombre_producto||''} ${p.sku||''}`.replace(/\s+/g,' ').trim();
                    return `
                    <tr class="inv-item-filterable" data-text="${sf.replace(/"/g,'&quot;')}">
                        <td>
                            <div style="display:flex;align-items:center;gap:10px;">
                                ${p.url_imagen?`<img src="${p.url_imagen}" style="width:38px;height:38px;object-fit:cover;border-radius:7px;flex-shrink:0;">`:`<div style="width:38px;height:38px;background:var(--glass-hover);border-radius:7px;flex-shrink:0;"></div>`}
                                <div>
                                    <div class="cell-title" style="max-width:200px;">${p.nombre_producto}</div>
                                    <div style="font-size:0.68rem;opacity:0.5;font-family:monospace;">${p.sku}</div>
                                </div>
                            </div>
                        </td>
                        <td style="font-weight:800;color:var(--primary-red);">${p.marca}</td>
                        <td class="text-right" style="font-family:monospace;font-size:0.85rem;opacity:0.75;">${formatUSD(p.precio_usd)}</td>
                        <td class="text-right"><span class="cell-price" style="color:var(--success-green);">${formatCOP(p.precio_cop)}</span></td>
                        <td class="text-right"><span style="font-weight:700;color:${margenColor};">${margen}%</span><div style="font-size:0.65rem;opacity:0.5;">@TRM 4300</div></td>
                        <td style="font-size:0.78rem;opacity:0.7;">${p.tienda_cotizacion||'—'}</td>
                        <td class="td-actions">
                            <div class="td-actions-group">
                                <button class="btn-action" onclick="window.modalViewProduct('${p.id}')">👁️</button>
                                <button class="btn-action" onclick="window.modalProducto('${p.id}')">✏️</button>
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
                ${sorted.length===0?'<tr class="table-empty-row"><td colspan="7">Sin productos en esta categoría.</td></tr>':''}
                </tbody>
            </table>
        </div>
    </div>`;
};

// ─── Inject view ───────────────────────────────────────────────────────────────
function injectInventoryView(view) {
    const area = document.getElementById('inv-view-area');
    if (!area) return;
    const list = filterByTab(globalListCache, _invActiveTab);
    let html = '';
    if      (view==='tabla')     html = renderViewTabla(list);
    else if (view==='marca')     html = renderViewMarca(list);
    else if (view==='categoria') html = renderViewCategoria(list);
    else if (view==='precios')   html = renderViewPrecios(list);
    else                         html = renderViewGrid(list);

    area.style.opacity='0';
    setTimeout(()=>{ area.innerHTML=html; area.style.opacity='1'; area.style.transition='opacity 0.25s'; attachInvSearch(); attachGroupToggles(); }, 100);
}

function attachInvSearch() {
    const fp = document.getElementById('find-prod');
    if (!fp) return;
    fp.oninput = (e) => {
        const k = e.target.value.toLowerCase().trim();
        let vis=0;
        document.querySelectorAll('.inv-item-filterable').forEach(c => {
            const m = (c.getAttribute('data-text')||'').toLowerCase().includes(k);
            c.style.display=m?'':'none';
            if(m) vis++;
        });
        const em=document.getElementById('inv-empty-search');
        if(em) em.style.display=vis===0&&k.length>0?'':'none';
    };
}

function attachGroupToggles() {
    if (typeof window.togglePurchaseGroup==='undefined') {
        window.togglePurchaseGroup=(id)=>{ const c=document.getElementById(id); if(!c)return; const o=c.classList.toggle('open'); const t=c.querySelector('.purchase-group-toggle'); if(t)t.textContent=o?'▲':'▼'; };
    }
}

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderInventory = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Sincronizando Inventario...</div>`);
    _invActiveView = 'grid';
    _invActiveTab  = localStorage.getItem('JARAPO_INV_TAB')||'disponibles';

    const [list, ventas, clientes, logistica] = await Promise.all([
        db.fetchData('Productos'),
        db.fetchData('Ventas'),
        db.fetchData('Clientes'),
        db.fetchData('Logistica'),
    ]);
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    globalListCache     = list;
    globalSalesCache    = ventas.error    ? [] : ventas;
    globalClientsCache  = clientes.error  ? [] : clientes;
    globalLogisticaCache= logistica.error ? [] : logistica;

    window.switchInvView = (view) => {
        _invActiveView = view;
        localStorage.setItem('JARAPO_INV_VIEW', view);
        document.querySelectorAll('.pv-tab[data-inv-view]').forEach(b => b.classList.toggle('active', b.dataset.invView===view));
        injectInventoryView(view);
    };

    window.switchInvTab = (tab) => {
        _invActiveTab = tab;
        localStorage.setItem('JARAPO_INV_TAB', tab);
        document.getElementById('inv-tab-disponibles').classList.toggle('active', tab==='disponibles');
        document.getElementById('inv-tab-otros').classList.toggle('active', tab==='otros');
        injectInventoryView(_invActiveView);
    };

    window.exportInvExcel = () => {
        const curList = filterByTab(globalListCache, _invActiveTab);
        if (curList.length === 0) return showToast('No hay datos en la pestaña actual para exportar', 'error');
        const dataToExport = curList.map(p => {
            const venta = globalSalesCache.find(v=>v.producto_id&&v.producto_id.toString()===p.id.toString());
            const {label:statusLabel} = getProductRealStatus(p, venta);
            return {
                'SKU': p.sku || '',
                'Marca': p.marca || '',
                'Producto': p.nombre_producto || '',
                'Categoría': p.categoria || '',
                'Talla': p.talla || '',
                'Género': p.genero || '',
                'Estado/Fase': statusLabel,
                'Stock MDE': p.stock_medellin || 0,
                'Stock USA': p.stock_miami || 0,
                'Costo (USD)': parseFloat(p.precio_usd || 0),
                'Precio (COP)': parseFloat(p.precio_cop || 0)
            };
        });
        downloadExcel(dataToExport, `Reporte_Inventario_${_invActiveTab}_${new Date().toISOString().split('T')[0]}`);
    };

    const views = [
        { id:'grid',      icon:'⊞', label:'Grid' },
        { id:'tabla',     icon:'▤',  label:'Tabla' },
        { id:'marca',     icon:'🏷️', label:'Por Marca' },
        { id:'categoria', icon:'📦', label:'Por Categoría' },
        { id:'precios',   icon:'📊', label:'Precios' },
    ];

    const html = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.8rem;">
        <div>
            <span class="page-eyebrow">Control de Existencias</span>
            <h2 class="page-title">Inventario Jarapo</h2>
            <p style="opacity:0.5;font-size:0.82rem;margin-top:4px;">Productos, marcas, categorías y rentabilidad.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
            <button class="btn-excel" onclick="window.exportInvExcel()">📥 Excel</button>
            <input type="text" id="find-prod" placeholder="Marca, modelo, SKU..." style="background:var(--glass-hover);padding:10px 15px;border-radius:12px;color:var(--text-main);border:1px solid var(--glass-border);width:220px;outline:none;">
            <button class="btn-primary" onclick="window.modalProducto()" style="padding:10px 15px;">+ Producto</button>
        </div>
    </div>

    ${renderInvKPI(list)}

    <!-- Sub-tabs: Disponibles / Tránsito -->
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.8rem;margin-bottom:1rem;">
        <div style="display:flex;gap:10px;">
            <button id="inv-tab-disponibles" class="pv-tab${_invActiveTab==='disponibles'?' active':''}" onclick="window.switchInvTab('disponibles')">📦 Disponibles (MDE)</button>
            <button id="inv-tab-otros" class="pv-tab${_invActiveTab==='otros'?' active':''}" onclick="window.switchInvTab('otros')">✈️ En Tránsito / Encargos</button>
        </div>
        <div class="purchase-view-switcher">
            ${views.map(v=>`
            <button class="pv-tab${v.id==='grid'?' active':''}" data-inv-view="${v.id}" onclick="window.switchInvView('${v.id}')">
                ${v.icon} ${v.label}
            </button>`).join('')}
        </div>
    </div>

    <div id="inv-view-area">
        ${renderViewGrid(filterByTab(list, _invActiveTab))}
    </div>`;

    renderLayout(html);
    setTimeout(()=>{ attachInvSearch(); attachGroupToggles(); }, 150);
};

// ─── Modal: Ver Detalle Venta ─────────────────────────────────────────────────
window.modalViewSaleDetail = (ventaId) => {
    const v = globalSalesCache.find(it=>it.id.toString()===ventaId.toString());
    if (!v) return showToast('Venta no encontrada','error');
    const cliente = globalClientsCache.find(c=>c.id.toString()===v.cliente_id.toString());
    const producto= globalListCache.find(p=>p.id.toString()===v.producto_id?.toString());
    const container=document.getElementById('modal-container');
    const content  =document.getElementById('modal-content');
    const saldo=parseInt(v.saldo_pendiente||0);
    const abonado=parseInt(v.abonos_acumulados||0);
    const total=parseInt(v.valor_total_cop||0);
    const fase=getLogisticaFase(v.id,globalLogisticaCache,v.estado_orden||'Sin registro');
    const faseColor=getLogisticaColor(fase);
    content.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;border-bottom:1px solid var(--glass-border);padding-bottom:1rem;">
            <div><h2 style="margin:0;color:var(--primary-red);">ORDEN #${v.id.toString().slice(-4)}</h2><span style="opacity:0.6;font-size:0.8rem;">${String(v.fecha||'').split('T')[0]}</span></div>
            <button onclick="window.closeModal()" style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
        </div>
        ${producto?`<div style="display:flex;gap:1.5rem;background:var(--glass-hover);padding:1.5rem;border-radius:12px;border:1px solid var(--glass-border);align-items:center;margin-bottom:1.5rem;"><div style="width:140px;height:140px;background:var(--input-bg);border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${producto.url_imagen?`<img src="${producto.url_imagen}" style="width:100%;height:100%;object-fit:cover;">`:'<span style="opacity:0.2;">FOTO</span>'}</div><div style="flex:1;"><span style="color:var(--primary-red);font-size:0.8rem;font-weight:700;">${producto.marca}</span><h3 style="margin:8px 0;">${producto.nombre_producto}</h3><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">Talla: <strong>${producto.talla||'N/A'}</strong></span><span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">Gen: <strong>${producto.genero||'N/A'}</strong></span></div></div></div>`:'<div style="padding:1.5rem;background:var(--glass-hover);text-align:center;border-radius:12px;opacity:0.5;margin-bottom:1.5rem;">Producto desvinculado</div>'}
        <div style="display:grid;grid-template-columns:1fr;gap:1.5rem;">
            <div style="background:var(--input-bg);padding:1rem;border-radius:12px;display:flex;justify-content:space-around;">
                <div style="text-align:center;"><p style="margin:0;font-size:0.7rem;opacity:0.6;">TOTAL</p><strong style="font-size:1.1rem;">${formatCOP(total)}</strong></div>
                <div style="text-align:center;"><p style="margin:0;font-size:0.7rem;opacity:0.6;">ABONADO</p><strong style="font-size:1.1rem;color:var(--success-green);">${formatCOP(abonado)}</strong></div>
                <div style="text-align:center;"><p style="margin:0;font-size:0.7rem;opacity:0.6;">SALDO</p><strong style="font-size:1.5rem;color:${saldo>0?'var(--primary-red)':'var(--success-green)'};">${saldo===0?'PAGADO':formatCOP(saldo)}</strong></div>
            </div>
            <div style="background:var(--glass-hover);padding:1rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;justify-content:space-between;align-items:center;">
                <div>${cliente?`<p style="margin:0;font-weight:700;">${cliente.nombre}</p><p style="margin:4px 0 0;opacity:0.6;font-size:0.85rem;">${cliente.whatsapp||''}</p>`:'Cliente no encontrado'}</div>
                <span style="font-size:0.75rem;padding:6px 12px;border-radius:15px;font-weight:700;color:#fff;background:${faseColor};">${fase}</span>
            </div>
        </div>`;
    container.style.display='flex';
};

// ─── Modal: Ver Producto ──────────────────────────────────────────────────────
window.modalViewProduct = (id) => {
    const p = globalListCache.find(it=>it.id.toString()===id.toString());
    if (!p) return showToast('Producto no encontrado','error');
    const container=document.getElementById('modal-container');
    const content  =document.getElementById('modal-content');
    content.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;border-bottom:1px solid var(--glass-border);padding-bottom:1rem;">
            <div><h2 style="margin:0;color:var(--primary-red);">${p.marca}</h2><span style="opacity:0.6;font-size:0.8rem;">SKU: ${p.sku||'N/A'}</span></div>
            <button onclick="window.closeModal()" style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
        </div>
        <div style="display:flex;gap:1.5rem;background:var(--glass-hover);padding:1.5rem;border-radius:12px;border:1px solid var(--glass-border);align-items:center;margin-bottom:1.5rem;">
           <div style="width:150px;height:150px;background:var(--input-bg);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
              ${p.url_imagen?`<img src="${p.url_imagen}" style="width:100%;height:100%;object-fit:cover;">`:'<span style="opacity:0.2;">FOTO</span>'}
           </div>
           <div style="flex:1;">
              <span style="background:${p.estado_producto?.includes('Disponible')?'var(--success-green)':p.estado_producto?.includes('Pendiente')||p.estado_producto?.includes('compra')?'var(--primary-red)':p.estado_producto?.includes('Tránsito')||p.estado_producto?.includes('Comprado')?'#FFB703':p.estado_producto?.includes('Entregado')?'var(--info-blue)':'var(--text-faint)'};font-size:0.7rem;padding:4px 10px;border-radius:15px;font-weight:700;text-transform:uppercase;color:#fff;">${p.estado_producto||'Disponible'}</span>
              <h3 style="margin:8px 0;font-size:1.4rem;">${p.nombre_producto}</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                 <span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">T: <strong>${p.talla||'N/A'}</strong></span>
                 <span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">G: <strong>${p.genero||'N/A'}</strong></span>
                 <span style="font-size:0.8rem;padding:5px 10px;background:var(--glass-bg);border-radius:6px;">${p.categoria||'N/A'}</span>
              </div>
              ${p.link_producto?`<div style="margin-top:10px;"><a href="${p.link_producto}" target="_blank" style="font-size:0.8rem;padding:6px 12px;background:rgba(6,214,160,0.1);color:var(--success-green);text-decoration:none;border-radius:6px;border:1px solid rgba(6,214,160,0.2);">🔗 Ver Producto Original</a></div>`:''}
           </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem;">
            <div style="background:var(--input-bg);padding:1rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;flex-direction:column;"><span style="font-size:0.75rem;opacity:0.6;margin-bottom:4px;">📍 Stock MDE</span><strong style="font-size:1.1rem;">${p.stock_medellin||'0'} Ud(s)</strong></div>
            <div style="background:var(--input-bg);padding:1rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;flex-direction:column;"><span style="font-size:0.75rem;opacity:0.6;margin-bottom:4px;">✈️ Stock USA</span><strong style="font-size:1.1rem;color:#FFB703;">${p.stock_miami||'0'} Ud(s)</strong></div>
            <div style="background:var(--input-bg);padding:1rem;border-radius:12px;border:1px solid var(--glass-border);display:flex;flex-direction:column;"><span style="font-size:0.75rem;opacity:0.6;margin-bottom:4px;">🏭 Tienda Origen</span><strong style="font-size:1.1rem;">${p.tienda_cotizacion||'N/A'}</strong></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
            <div style="background:rgba(230,57,70,0.05);padding:1rem;border-radius:12px;border:1px solid rgba(230,57,70,0.2);display:flex;flex-direction:column;"><span style="font-size:0.75rem;color:var(--primary-red);margin-bottom:4px;">📉 Costo</span><strong style="font-size:1.1rem;color:var(--primary-red);">${formatUSD(p.precio_usd)}</strong></div>
            <div style="background:rgba(6,214,160,0.05);padding:1rem;border-radius:12px;border:1px solid rgba(6,214,160,0.2);display:flex;flex-direction:column;"><span style="font-size:0.75rem;color:var(--success-green);margin-bottom:4px;">📈 Precio Venta</span><strong style="font-size:1.1rem;color:var(--success-green);">${formatCOP(p.precio_cop)}</strong></div>
        </div>
        <div style="text-align:center;"><button class="btn-primary" onclick="window.closeModal();window.modalProducto('${p.id}')">✏️ Editar Ficha</button></div>`;
    container.style.display='flex';
};

// ─── Create Product Modal (unchanged logic) ───────────────────────────────────
export const createProductModal = async (id, navigateTo) => {
    let mode=id?'UPDATE':'INSERT';
    let data={sku:'',nombre_producto:'',marca:'',categoria:'',genero:'',talla:'',tienda_cotizacion:'',precio_usd:0,precio_cop:0,stock_medellin:0,stock_miami:0,stock_transito:0,url_imagen:'',estado_producto:'Disponible entrega inmediata'};
    const container=document.getElementById('modal-container');
    const content=document.getElementById('modal-content');
    if(id){ content.innerHTML=`<div style="text-align:center;padding:2rem;"><div class="loader"></div> Obteniendo Producto...</div>`; container.style.display='flex'; const list=await db.fetchData('Productos'); const t=list.find(it=>it.id.toString()===id.toString()); if(t) data={...t}; }
    else { content.innerHTML=`<div style="text-align:center;padding:2rem;"><div class="loader"></div> Preparando Formulario...</div>`; container.style.display='flex'; }
    const cfg=await db.fetchData('Configuracion');
    const getConfig=(key)=>cfg.error?[]:cfg.filter(c=>c.clave===key).map(c=>c.valor);
    const mrcs=getConfig('Marca'),cats=getConfig('Categoria'),gens=getConfig('Genero'),tnds=getConfig('Tienda');
    content.innerHTML=`
        <h2 style="margin-bottom:1.5rem;">Control de Inventario</h2>
        <form id="form-prod" style="display:flex;flex-direction:column;gap:1.2rem;">
            <div><label>Estado del Producto</label>
               <select name="est" style="width:100%;padding:14px;border-radius:12px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);margin-top:5px;outline:none;box-sizing:border-box;">
                   <option value="Disponible entrega inmediata" ${data.estado_producto==='Disponible entrega inmediata'?'selected':''}>Disponible entrega inmediata</option>
                   <option value="Pendiente de compra" ${data.estado_producto==='Pendiente de compra'?'selected':''}>Pendiente de compra (USA)</option>
                   <option value="Producto Vendido" ${data.estado_producto==='Producto Vendido'?'selected':''}>Producto Vendido</option>
                   <option value="Entregado" ${data.estado_producto==='Entregado'?'selected':''}>Entregado (Cliente Final)</option>
               </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
               <div><label>Modelo / Nombre Exacto</label><input type="text" name="nom" value="${data.nombre_producto}" required></div>
               <div><label>SKU / Ref</label><input type="text" name="sku" value="${data.sku}" required></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
               <div><label>Marca</label><select name="mrc" required style="width:100%;padding:14px;border-radius:12px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);outline:none;"><option value="" disabled ${!data.marca?'selected':''}>Seleccione Marca...</option>${mrcs.map(m=>`<option value="${m}" ${data.marca===m?'selected':''}>${m}</option>`).join('')}</select></div>
               <div><label>Categoría</label><select name="cat" required style="width:100%;padding:14px;border-radius:12px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);outline:none;"><option value="" disabled ${!data.categoria?'selected':''}>Seleccione Categoría...</option>${cats.map(c=>`<option value="${c}" ${data.categoria===c?'selected':''}>${c}</option>`).join('')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;background:var(--glass-hover);padding:10px;border-radius:12px;">
               <div><label>Género</label><select name="gen" required style="width:100%;padding:10px;border-radius:8px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);outline:none;"><option value="" disabled ${!data.genero?'selected':''}>Género...</option>${gens.map(g=>`<option value="${g}" ${data.genero===g?'selected':''}>${g}</option>`).join('')}</select></div>
               <div><label>Talla (Opcional)</label><input type="text" name="tal" value="${data.talla||''}" placeholder="Ej: 9US / M" style="padding:10px;"></div>
               <div><label>Origen/Tienda</label><select name="ori" required style="width:100%;padding:10px;border-radius:8px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);outline:none;"><option value="" disabled ${!data.tienda_cotizacion?'selected':''}>Tienda...</option>${tnds.map(t=>`<option value="${t}" ${data.tienda_cotizacion===t?'selected':''}>${t}</option>`).join('')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
               <div><label>Venta Final (COP)</label><input type="number" name="pcop" value="${data.precio_cop}" required></div>
               <div><label>Costo (USD)</label><input type="number" step="0.01" name="pusd" value="${data.precio_usd}" required></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
               <div><label>Stock MDE Física</label><input type="number" name="smde" value="${data.stock_medellin}" required></div>
               <div><label>Link del Producto (URL)</label><input type="url" name="link" value="${data.link_producto||''}" placeholder="https://..."></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;background:var(--input-bg);padding:1rem;border-radius:12px;">
               <label>Fotografía del Producto</label>
               <input type="file" id="file-img" accept="image/*" style="padding:10px;background:var(--input-bg);border-radius:12px;border:1px dashed rgba(255,255,255,0.2);">
               <div id="img-preview" style="height:60px;border-radius:8px;display:flex;overflow:hidden;align-items:flex-start;margin-top:5px;">${data.url_imagen?`<img src="${data.url_imagen}" style="height:100%;object-fit:cover;border-radius:6px;">`:'<span style="font-size:0.65rem;opacity:0.5;padding:5px;">Ninguna subida.</span>'}</div>
               <input type="hidden" name="img" id="hidden-img-url" value="${data.url_imagen}">
            </div>
            <div style="display:flex;gap:15px;margin-top:1.5rem;">
               <button type="submit" class="btn-primary" style="flex:1;">Guardar Cambios</button>
               <button type="button" onclick="window.closeModal()" style="flex:1;background:none;border:1px solid var(--glass-border);color:var(--text-main);border-radius:16px;">Volver</button>
            </div>
        </form>`;
    container.style.display='flex';
    const fi=document.getElementById('file-img'),pv=document.getElementById('img-preview');
    fi.onchange=(e)=>{ const f=e.target.files[0]; if(f){const r=new FileReader();r.onload=(re)=>{pv.innerHTML=`<img src="${re.target.result}" style="height:100%;object-fit:cover;border-radius:6px;">`};r.readAsDataURL(f)} };
    document.getElementById('form-prod').onsubmit=async(e)=>{
        e.preventDefault();
        const fd=new FormData(e.target);
        const btn=e.target.querySelector('button[type="submit"]');
        const origText=btn.innerText; btn.disabled=true; btn.innerText='Procesando...';
        let finalUrl=document.getElementById('hidden-img-url').value;
        const uploadFile=document.getElementById('file-img').files[0];
        try {
            if(uploadFile) finalUrl=await uploadImageToSupabase(uploadFile);
            let st_mde=parseInt(fd.get('smde')||'0');
            const estProd=fd.get('est');
            if(estProd==='Pendiente de compra') st_mde=0;
            if(estProd==='Disponible entrega inmediata'&&st_mde<=0){btn.disabled=false;btn.innerText=origText;return showToast('Bloqueado: Stock debe ser > 0 para disponibles','error');}
            const payload={id:id||Date.now().toString(),nombre_producto:fd.get('nom'),sku:fd.get('sku'),marca:fd.get('mrc'),categoria:fd.get('cat')||'Generico',genero:fd.get('gen')||'',talla:fd.get('tal')||'',tienda_cotizacion:fd.get('ori')||'',precio_usd:fd.get('pusd'),precio_cop:fd.get('pcop'),stock_medellin:st_mde,stock_miami:data.stock_miami||0,stock_transito:data.stock_transito||0,url_imagen:finalUrl,link_producto:fd.get('link')||'',estado_producto:estProd};
            btn.innerText='Sincronizando...';
            await db.postData('Productos',payload,mode);
            window.closeModal(); showToast('✅ Producto actualizado','success'); navigateTo('inventory');
        } catch(err){showToast('Error: '+err.message,'error');btn.disabled=false;btn.innerText='Reintentar';}
    };
};
