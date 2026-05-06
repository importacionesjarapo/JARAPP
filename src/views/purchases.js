import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatUSD, formatCOP, renderError, showToast, getLogisticaFase, getLogisticaColor, downloadExcel, renderPagination, paginate, buildComprobanteUploadHTML, attachComprobanteInput, uploadImageToSupabase } from '../utils.js';

// ─── Cached data (persists across view switches without re-fetching) ───────────
let _cache = null;
let _renderLayoutFn = null;
let _navigateToFn = null;
let _currentView = 'tabla';
let _purStartDate = '';
let _purEndDate = '';
let _purFiltered = [];

// ─── Helper: format date label ─────────────────────────────────────────────────
const formatDateLabel = (dateStr) => {
    if (!dateStr || dateStr === 'sin-fecha') return 'Sin fecha';
    try {
        let normalized = dateStr;
        // Handle DD/MM/YYYY or D/M/YYYY
        const dmyMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmyMatch) {
            const [, d, m, y] = dmyMatch;
            normalized = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        const dt = new Date(normalized + 'T12:00:00');
        if (isNaN(dt.getTime())) return dateStr;
        return dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
};

// ─── Phase priority for sort (most urgent first) ────────────────────────────────
const fasePriority = (fase) => {
    if (!fase) return 99;
    if (fase.includes('Validando') || fase.includes('Pendiente')) return 0;
    if (fase.includes('Comprado') || fase.includes('EEUU')) return 1;
    if (fase.includes('Tránsito') || fase.includes('Bodega USA')) return 2;
    if (fase.includes('Internacional') || fase.includes('Aduana')) return 3;
    if (fase.includes('Colombia') || fase.includes('Bodega Col')) return 4;
    if (fase.includes('Entregado')) return 5;
    return 10;
};

// ─── Render: Alerta de pendientes (siempre visible) ────────────────────────────
const renderPendingAlert = (pendientes, productos) => {
    if (!pendientes || pendientes.length === 0) return '';
    return `
    <div class="purchase-pending-alert">
        <h4>
            ⚠️ Encargos pendientes de compra
            <span class="pending-badge">${pendientes.length}</span>
        </h4>
        <div style="display:flex; gap:0.8rem; flex-wrap:wrap;">
            ${pendientes.map(p => {
                const prod = productos.find(x => x.id?.toString() === p.producto_id?.toString()) || {};
                const prodName = prod.nombre_producto || `Prod #${p.producto_id}`;
                return `
                <div class="pending-item">
                    <div>
                        <strong style="font-size:0.85rem;">Orden #${p.id.toString().slice(-4)}</strong><br>
                        <span style="font-size:0.75rem; opacity:0.7;">${prodName}</span>
                    </div>
                    ${auth.canEdit('purchases') ? `<button onclick="window.modalCompra('${p.id}')"
                        class="btn-primary" style="font-size:0.75rem; padding:7px 12px;">
                        Comprar Ahora
                    </button>` : ''}
                </div>`;
            }).join('')}
        </div>
    </div>`;
};

// ─── Render: KPI Strip ──────────────────────────────────────────────────────────
const renderKPIStrip = (compras) => {
    const total = compras.reduce((s, c) => s + parseFloat(c.costo_usd || 0), 0);
    const encargos = compras.filter(c => c.venta_id && c.venta_id !== '');
    const stock = compras.filter(c => !c.venta_id || c.venta_id === '');
    const proveedores = new Set(compras.map(c => (c.proveedor || '').trim().toLowerCase()).filter(Boolean));
    const promedio = compras.length > 0 ? total / compras.length : 0;

    const kpis = [
        { icon: '💰', value: formatUSD(total), label: 'Total Invertido' },
        { icon: '📦', value: compras.length, label: 'Total Compras' },
        { icon: '🛍️', value: encargos.length, label: 'Para Encargos' },
        { icon: '🏪', value: stock.length, label: 'Para Stock' },
        { icon: '🏬', value: proveedores.size, label: 'Proveedores' },
    ];

    return `
    <div class="kpi-strip">
        ${kpis.map(k => `
        <div class="kpi-strip-card" onclick="window.openPurchasesKPI('${k.label}')">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value">${k.value}</div>
            <div class="kpi-strip-label">${k.label}</div>
        </div>`).join('')}
    </div>`;
};

window.openPurchasesKPI = (kpiName) => {
    if (!_cache) return;
    const { productos, ventas, clientes, logisticaList } = _cache;
    let title = kpiName;
    let subtitle = '';
    let itemsHtml = '';
    
    let targetList = [..._purFiltered];
    
    if (kpiName === 'Total Invertido') {
        subtitle = 'Desglose de compras ordenadas por valor invertido (USD).';
        targetList.sort((a,b) => parseFloat(b.costo_usd||0) - parseFloat(a.costo_usd||0));
    } else if (kpiName === 'Total Compras') {
        subtitle = 'Todas las compras realizadas en el período seleccionado.';
        targetList.sort((a,b) => new Date(b.fecha_pedido||0) - new Date(a.fecha_pedido||0));
    } else if (kpiName === 'Para Encargos') {
        subtitle = 'Compras vinculadas a una orden de venta de cliente.';
        targetList = targetList.filter(c => c.venta_id && c.venta_id !== '');
    } else if (kpiName === 'Para Stock') {
        subtitle = 'Compras para inventario propio sin cliente asignado.';
        targetList = targetList.filter(c => !c.venta_id || c.venta_id === '');
    } else if (kpiName === 'Proveedores') {
        subtitle = 'Agrupación de compras por proveedor o tienda de origen.';
        const groups = {};
        targetList.forEach(c => {
            const key = (c.proveedor || 'Sin Proveedor').trim();
            if (!groups[key]) groups[key] = { count: 0, total: 0 };
            groups[key].count += 1;
            groups[key].total += parseFloat(c.costo_usd||0);
        });
        const sorted = Object.entries(groups).sort((a,b) => b[1].total - a[1].total);
        itemsHtml = sorted.map(([prov, data]) => `
        <div class="kpi-modal-item" style="cursor:default;">
            <div class="kpi-item-main">
                <div class="kpi-item-title">${prov}</div>
                <div class="kpi-item-subtitle">${data.count} compra(s) registrada(s)</div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--primary-red);">${formatUSD(data.total)}</div>
            </div>
        </div>`).join('');
        
        window.openKPIDetailModal(title, subtitle, itemsHtml);
        return;
    }
    
    itemsHtml = targetList.map(c => {
        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
        const vData = c.venta_id ? ventas.find(v => v.id?.toString() === c.venta_id?.toString()) : null;
        const cData = vData?.cliente_id ? clientes.find(cl => cl.id?.toString() === vData.cliente_id?.toString()) : null;
        
        const realStatus = c.venta_id
            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso USA')
            : (c.estado_compra || 'Stock USA');
        const statusColor = c.venta_id
            ? getLogisticaColor(realStatus)
            : (realStatus.includes('Entregado') ? 'var(--success-green)' : 'var(--info-blue)');
            
        return `
        <div class="kpi-modal-item">
            <div class="kpi-item-main">
                <div class="kpi-item-title">#${c.id.toString().slice(-4)} | ${pData.nombre_producto || c.proveedor || 'Sin Nombre'}</div>
                <div class="kpi-item-subtitle">${c.fecha_pedido || 'N/A'} | ${c.venta_id ? ('Encargo: ' + (cData?.nombre || 'Desconocido')) : 'Stock Propio'}</div>
                <div class="kpi-item-info">
                    <span style="color:${statusColor};">${realStatus}</span>
                </div>
            </div>
            <div class="kpi-item-right">
                <div class="kpi-item-value" style="color:var(--primary-red);">${formatUSD(c.costo_usd)}</div>
                <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}'); document.getElementById('kpi-detail-modal').classList.remove('active');" style="margin-top:4px;">👁️ Detalles</button>
            </div>
        </div>`;
    }).join('');
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

// ─── View 1: Tabla (mejorada) ───────────────────────────────────────────────────
const renderViewTabla = (compras, ventas, productos, clientes, logisticaList) => {
    return `
    <div class="purchase-view-panel">
        <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
            <input type="text" id="find-purchase"
                placeholder="🔍 Buscar proveedor, relación, estado..."
                style="background:var(--glass-hover); padding:9px 15px; border-radius:10px; color:var(--text-main);
                       border:1px solid var(--glass-border); width:300px; outline:none; font-size:0.84rem;">
        </div>
        <div class="table-wrapper">
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="min-width:90px;">ID</th>
                        <th style="min-width:120px;">Fecha</th>
                        <th style="min-width:200px;">Proveedor / Tienda</th>
                        <th style="min-width:200px;">Producto</th>
                        <th style="min-width:140px;">Tipo</th>
                        <th style="min-width:220px;">Fase Logística</th>
                        <th class="text-right" style="min-width:160px;">Costo USD</th>
                    </tr>
                </thead>
                <tbody>
                    ${compras.length > 0 ? compras.map(c => {
                        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
                        const vData = c.venta_id ? ventas.find(v => v.id?.toString() === c.venta_id?.toString()) : null;
                        const cData = vData?.cliente_id ? clientes.find(cl => cl.id?.toString() === vData.cliente_id?.toString()) : null;
                        const realStatus = c.venta_id
                            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso USA')
                            : (c.estado_compra || 'Stock USA');
                        const statusColor = c.venta_id
                            ? getLogisticaColor(realStatus)
                            : (realStatus.includes('Entregado') ? 'var(--success-green)' : 'var(--info-blue)');
                        const searchStr = `${c.id.toString().slice(-4)} ${c.fecha_pedido || ''} ${c.proveedor || ''} ${realStatus} ${c.venta_id ? 'Encargo' : 'Stock'} ${pData.nombre_producto || ''}`.toLowerCase();
                        return `
                        <tr class="purchase-row" data-text="${searchStr.replace(/"/g, '&quot;')}">
                            <td><span class="cell-number">#${c.id.toString().slice(-4)}</span></td>
                            <td style="font-size:0.82rem;">${c.fecha_pedido || 'N/A'}</td>
                            <td><span class="cell-title" style="max-width:180px;">${c.proveedor || '—'}</span></td>
                            <td>
                                <span class="cell-title" style="max-width:180px;">${pData.nombre_producto || '—'}</span>
                                ${pData.talla ? `<span class="cell-subtitle">Talla ${pData.talla}${pData.genero ? ' · ' + pData.genero : ''}</span>` : ''}
                            </td>
                            <td>
                                ${c.venta_id
                                    ? `<span style="color:#FFB703; font-weight:700; font-size:0.8rem;">📦 Encargo<br><span style="font-size:0.7rem; opacity:0.7;">${cData?.nombre || '#' + c.venta_id.toString().slice(-4)}</span></span>`
                                    : `<span style="color:var(--success-green); font-weight:700; font-size:0.8rem;">🛒 Stock</span>`
                                }
                            </td>
                            <td><span class="status-badge" style="background:${statusColor};">${realStatus}</span></td>
                            <td class="td-actions">
                                <div class="td-actions-group">
                                    <span class="cell-price" style="color:var(--primary-red);">${formatUSD(c.costo_usd)}</span>
                                    <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}')" title="Ver Detalles">👁️</button>
                                </div>
                            </td>
                        </tr>`;
                    }).join('') : '<tr class="table-empty-row"><td colspan="7">No hay registros de compras.</td></tr>'}
                    <tr class="table-empty-row" id="purchase-empty-search" style="display:none;"><td colspan="7">No se encontraron compras.</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;
};

// ─── View 2: Por Tienda / Proveedor ────────────────────────────────────────────
const renderViewTienda = (compras, productos, logisticaList) => {
    const totalGlobal = compras.reduce((s, c) => s + parseFloat(c.costo_usd || 0), 0);

    // Group by proveedor
    const groups = {};
    compras.forEach(c => {
        const key = (c.proveedor || 'Sin Proveedor').trim();
        if (!groups[key]) groups[key] = { items: [], total: 0 };
        groups[key].items.push(c);
        groups[key].total += parseFloat(c.costo_usd || 0);
    });

    const sorted = Object.entries(groups).sort((a, b) => b[1].total - a[1].total);

    return `
    <div class="purchase-view-panel">
        ${sorted.map(([tienda, g], idx) => {
            const pct = totalGlobal > 0 ? Math.round((g.total / totalGlobal) * 100) : 0;
            const cardId = `pgc-tienda-${idx}`;
            return `
            <div class="purchase-group-card" id="${cardId}">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cardId}')">
                    <h3>🏪 ${tienda}</h3>
                    <div class="purchase-group-meta">
                        <span>${g.items.length} compra${g.items.length !== 1 ? 's' : ''}</span>
                        <strong>${formatUSD(g.total)}</strong>
                        <span style="font-size:0.72rem; opacity:0.6;">${pct}% del gasto</span>
                        <span class="purchase-group-toggle">▼</span>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap">
                    <div class="purchase-group-bar" style="width:${pct}%;"></div>
                </div>
                <div class="purchase-group-body">
                    ${g.items.map(c => {
                        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
                        const fase = c.venta_id
                            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso')
                            : (c.estado_compra || 'Stock USA');
                        const col = getLogisticaColor(fase);
                        return `
                        <div class="purchase-group-row">
                            <span style="font-weight:800; font-size:0.75rem; color:var(--text-faint);">#${c.id.toString().slice(-4)}</span>
                            <span style="flex:1; font-size:0.82rem;">${pData.nombre_producto || c.proveedor || '—'}</span>
                            <span class="status-badge" style="background:${col}; font-size:0.6rem;">${fase}</span>
                            <span style="font-weight:700; color:var(--primary-red); font-size:0.82rem;">${formatUSD(c.costo_usd)}</span>
                            <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}')" style="padding:4px 8px;">👁️</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${sorted.length === 0 ? '<p style="opacity:0.5; text-align:center; padding:3rem;">No hay compras registradas.</p>' : ''}
    </div>`;
};

// ─── View 3: Por Fase Logística ─────────────────────────────────────────────────
const renderViewFase = (compras, productos, logisticaList) => {
    const groups = {};
    compras.forEach(c => {
        const fase = c.venta_id
            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso USA')
            : (c.estado_compra || 'Stock USA');
        if (!groups[fase]) groups[fase] = { items: [], total: 0, color: getLogisticaColor(fase) };
        groups[fase].items.push(c);
        groups[fase].total += parseFloat(c.costo_usd || 0);
    });

    const sorted = Object.entries(groups).sort((a, b) => fasePriority(a[0]) - fasePriority(b[0]));

    return `
    <div class="purchase-view-panel">
        ${sorted.map(([fase, g], idx) => {
            const cardId = `pgc-fase-${idx}`;
            return `
            <div class="purchase-group-card" id="${cardId}">
                <div class="purchase-group-header" onclick="window.togglePurchaseGroup('${cardId}')">
                    <h3>
                        <span style="width:10px; height:10px; border-radius:50%; background:${g.color}; display:inline-block; flex-shrink:0;"></span>
                        ${fase}
                    </h3>
                    <div class="purchase-group-meta">
                        <span>${g.items.length} compra${g.items.length !== 1 ? 's' : ''}</span>
                        <strong>${formatUSD(g.total)}</strong>
                        <span class="purchase-group-toggle">▼</span>
                    </div>
                </div>
                <div class="purchase-group-bar-wrap">
                    <div class="purchase-group-bar" style="width:100%; background:${g.color};"></div>
                </div>
                <div class="purchase-group-body">
                    ${g.items.map(c => {
                        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
                        return `
                        <div class="purchase-group-row">
                            <span style="font-weight:800; font-size:0.75rem; color:var(--text-faint);">#${c.id.toString().slice(-4)}</span>
                            <span style="flex:1; font-size:0.82rem;">${pData.nombre_producto || '—'}</span>
                            <span style="font-size:0.78rem; color:var(--text-muted);">${c.proveedor || '—'}</span>
                            ${c.fecha_pedido ? `<span style="font-size:0.72rem; opacity:0.55;">${c.fecha_pedido}</span>` : ''}
                            <span style="font-weight:700; color:var(--primary-red); font-size:0.82rem;">${formatUSD(c.costo_usd)}</span>
                            <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}')" style="padding:4px 8px;">👁️</button>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')}
        ${sorted.length === 0 ? '<p style="opacity:0.5; text-align:center; padding:3rem;">No hay compras registradas.</p>' : ''}
    </div>`;
};

// ─── View 4: Por Tipo (Encargos vs Stock) ──────────────────────────────────────
const renderViewTipo = (compras, productos, ventas, clientes, logisticaList) => {
    const encargos = compras.filter(c => c.venta_id && c.venta_id !== '');
    const stock = compras.filter(c => !c.venta_id || c.venta_id === '');
    const totalEnc = encargos.reduce((s, c) => s + parseFloat(c.costo_usd || 0), 0);
    const totalStk = stock.reduce((s, c) => s + parseFloat(c.costo_usd || 0), 0);
    const avgEnc = encargos.length > 0 ? totalEnc / encargos.length : 0;
    const avgStk = stock.length > 0 ? totalStk / stock.length : 0;

    const renderItem = (c) => {
        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
        const fase = c.venta_id
            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso')
            : (c.estado_compra || 'Stock USA');
        const col = getLogisticaColor(fase);
        return `
        <div class="purchase-group-row">
            <span style="font-weight:800; font-size:0.72rem; color:var(--text-faint);">#${c.id.toString().slice(-4)}</span>
            <div style="flex:1; min-width:0;">
                <div style="font-size:0.82rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pData.nombre_producto || c.proveedor || '—'}</div>
                <div style="font-size:0.68rem; color:var(--text-muted);">${c.proveedor || '—'} · ${c.fecha_pedido || 'N/A'}</div>
            </div>
            <span class="status-badge" style="background:${col}; font-size:0.58rem;">${fase}</span>
            <span style="font-weight:700; color:var(--primary-red); font-size:0.82rem; white-space:nowrap;">${formatUSD(c.costo_usd)}</span>
            <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}')" style="padding:4px 8px;">👁️</button>
        </div>`;
    };

    return `
    <div class="purchase-view-panel">
        <div class="purchase-tipo-grid">
            <!-- Encargos -->
            <div class="purchase-tipo-col">
                <div class="purchase-tipo-col-header">
                    <h3>📦 Encargos <span style="font-size:0.75rem; font-weight:600; padding:2px 8px; background:rgba(255,183,3,0.12); color:#FFB703; border-radius:6px; margin-left:4px;">${encargos.length}</span></h3>
                    <div class="purchase-tipo-mini-kpis">
                        <div class="purchase-tipo-mini-kpi">Total: <strong>${formatUSD(totalEnc)}</strong></div>
                        <div class="purchase-tipo-mini-kpi">Promedio: <strong>${formatUSD(avgEnc)}</strong></div>
                    </div>
                </div>
                <div class="purchase-tipo-list">
                    ${encargos.length > 0 ? encargos.map(renderItem).join('') : '<p style="opacity:0.4; font-size:0.82rem; text-align:center; padding:2rem;">Sin encargos</p>'}
                </div>
            </div>
            <!-- Stock -->
            <div class="purchase-tipo-col">
                <div class="purchase-tipo-col-header">
                    <h3>🛒 Stock Propio <span style="font-size:0.75rem; font-weight:600; padding:2px 8px; background:var(--success-dim); color:var(--success-green); border-radius:6px; margin-left:4px;">${stock.length}</span></h3>
                    <div class="purchase-tipo-mini-kpis">
                        <div class="purchase-tipo-mini-kpi">Total: <strong>${formatUSD(totalStk)}</strong></div>
                        <div class="purchase-tipo-mini-kpi">Promedio: <strong>${formatUSD(avgStk)}</strong></div>
                    </div>
                </div>
                <div class="purchase-tipo-list">
                    ${stock.length > 0 ? stock.map(renderItem).join('') : '<p style="opacity:0.4; font-size:0.82rem; text-align:center; padding:2rem;">Sin stock</p>'}
                </div>
            </div>
        </div>
    </div>`;
};

// ─── View 5: Línea de Tiempo ────────────────────────────────────────────────────
const renderViewTimeline = (compras, productos, logisticaList) => {
    // Sort by date descending
    const sorted = [...compras].sort((a, b) => {
        const da = a.fecha_pedido ? new Date(a.fecha_pedido) : new Date(0);
        const db2 = b.fecha_pedido ? new Date(b.fecha_pedido) : new Date(0);
        return db2 - da;
    });

    // Group by date
    const dayGroups = {};
    sorted.forEach(c => {
        const key = c.fecha_pedido || 'sin-fecha';
        if (!dayGroups[key]) dayGroups[key] = [];
        dayGroups[key].push(c);
    });

    return `
    <div class="purchase-view-panel">
        <div class="purchase-timeline">
            ${Object.entries(dayGroups).map(([dateKey, items]) => `
            <div class="timeline-day-group">
                <div class="timeline-day-label">${formatDateLabel(dateKey)}</div>
                ${items.map(c => {
                    const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
                    const fase = c.venta_id
                        ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso')
                        : (c.estado_compra || 'Stock USA');
                    const col = getLogisticaColor(fase);
                    return `
                    <div class="timeline-item" style="--dot-color:${col};">
                        <span class="timeline-item-id">#${c.id.toString().slice(-4)}</span>
                        <div class="timeline-item-main">
                            <div class="timeline-item-prov">${c.proveedor || '—'}</div>
                            <div class="timeline-item-sub">${pData.nombre_producto || '—'} · ${c.venta_id ? '📦 Encargo' : '🛒 Stock'}</div>
                        </div>
                        <span class="status-badge" style="background:${col}; font-size:0.6rem;">${fase}</span>
                        <span class="timeline-item-price">${formatUSD(c.costo_usd)}</span>
                        <button class="btn-action" onclick="window.modalDetalleCompra('${c.id}')" style="padding:4px 8px;">👁️</button>
                    </div>`;
                }).join('')}
            </div>`).join('')}
            ${Object.keys(dayGroups).length === 0 ? '<p style="opacity:0.4; text-align:center; padding:3rem;">No hay compras registradas.</p>' : ''}
        </div>
    </div>`;
};

// ─── Main render ────────────────────────────────────────────────────────────────
export const renderPurchases = async (renderLayout, navigateTo) => {
    _renderLayoutFn = renderLayout;
    _navigateToFn = navigateTo;

    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Compras...</div>`);

    const [compras, ventas, productos, clientes, logistica] = await Promise.all([
        db.fetchData('Compras'),
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Clientes'),
        db.fetchData('Logistica'),
    ]);

    if (compras.error) return renderError(renderLayout, compras.error, navigateTo);

    const logisticaList = logistica.error ? [] : logistica;
    const comprasDesc = [...(compras || [])].reverse();

    // Store cache
    _cache = { compras: comprasDesc, ventas: ventas || [], productos: productos || [], clientes: clientes || [], logisticaList };

    const applyPurFilter = () => {
        const _s = _purStartDate ? new Date(_purStartDate + 'T00:00:00') : null;
        const _e = _purEndDate ? new Date(_purEndDate + 'T23:59:59') : null;

        _purFiltered = _cache.compras.filter(c => {
            if (!_s && !_e) return true;
            let d = c.fecha_pedido || c.fecha_registro;
            if (!d) return true;
            // Support formats
            const dmyMatch = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (dmyMatch) d = `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
            else d = d.split('T')[0].split(' ')[0];

            const vd = new Date(d + 'T12:00:00');
            if (isNaN(vd)) return true;
            if (_s && vd < _s) return false;
            if (_e && vd > _e) return false;
            return true;
        });

        // Re-inject KPI and Panel using filtered array
        const kpi = document.querySelector('.kpi-strip'); // Replace exact strip if needed, here we recreate HTML below so we only need it on init, but for dynamic updating we need wrappers.
        // It's easier if we re-render the layout using a wrapper if we want dynamic KPIs. 
        // We will make `window.switchPurchaseView` handle panel updates.
        const kpiCont = document.getElementById('pur-kpi-container');
        if (kpiCont) kpiCont.innerHTML = renderKPIStrip(_purFiltered);
        
        const panel = document.getElementById('purchase-view-container');
        if (panel) {
            panel.innerHTML = getPanelHTML(_currentView, { ..._cache, compras: _purFiltered });
            attachSearchListener();
            attachGroupToggles();
        }
    };

    window.applyPurDateFilter = () => {
        _purStartDate = document.getElementById('pur-date-start').value;
        _purEndDate = document.getElementById('pur-date-end').value;
        applyPurFilter();
    };

    window.exportPurExcel = () => {
        if (_purFiltered.length === 0) return showToast('No hay datos para exportar', 'error');
        const dataToExport = _purFiltered.map(c => {
            const pData = _cache.productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
            const realStatus = c.venta_id ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso USA') : (c.estado_compra || 'Stock USA');
            return {
                'ID Compra': c.id,
                'Fecha Pedido': c.fecha_pedido || '',
                'Proveedor/Tienda': c.proveedor || '—',
                'Producto Nombre': pData.nombre_producto || '—',
                'Tipo': c.venta_id ? 'Encargo' : 'Stock',
                'Fase Logística': realStatus,
                'Costo (USD)': parseFloat(c.costo_usd || 0)
            };
        });
        downloadExcel(dataToExport, `Reporte_Compras_${new Date().toISOString().split('T')[0]}`);
    };

    const pendientes = (ventas || []).filter(v => v.tipo_venta === 'Encargo' && v.estado_orden === 'Validando Compra EEUU');
    
    // Initial Filter
    _purFiltered = [..._cache.compras];
    const _s = _purStartDate ? new Date(_purStartDate + 'T00:00:00') : null;
    const _e = _purEndDate ? new Date(_purEndDate + 'T23:59:59') : null;
    if (_s || _e) { applyPurFilter(); }

    // Attach global functions
    window.modalCompra = (ventaId = null) => createPurchaseModal(navigateTo, ventaId);

    window.switchPurchaseView = (tab) => {
        _currentView = tab;
        // Update tab styles
        document.querySelectorAll('.pv-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        // Render selected view
        const panel = document.getElementById('purchase-view-container');
        if (!panel || !_cache) return;
        panel.innerHTML = getPanelHTML(tab, { ..._cache, compras: _purFiltered });
        attachSearchListener();
        attachGroupToggles();
    };

    window.togglePurchaseGroup = (cardId) => {
        const el = document.getElementById(cardId);
        if (el) el.classList.toggle('open');
    };

    window.modalDetalleCompra = (id) => {
        const { compras, productos, ventas, clientes } = _cache;
        const c = compras.find(x => x.id.toString() === id.toString());
        if (!c) return;

        const pData = productos.find(p => p.id?.toString() === c.producto_id?.toString()) || {};
        const vData = c.venta_id ? ventas.find(v => v.id?.toString() === c.venta_id?.toString()) : null;
        const cData = vData?.cliente_id ? clientes.find(cl => cl.id?.toString() === vData.cliente_id?.toString()) : null;
        const imageUrl = pData.url_imagen || '';
        const clientName = cData?.nombre || (c.venta_id ? 'Desconocido' : 'Compra para Inventario (Stock)');
        const fase = c.venta_id
            ? getLogisticaFase(c.venta_id, logisticaList, c.estado_compra || 'En proceso USA')
            : (c.estado_compra || 'Stock USA');
        const faseCol = c.venta_id ? getLogisticaColor(fase) : 'var(--info-blue)';

        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        content.innerHTML = `
            <div class="modal-content modal-wide">
                <div class="modal-header">
                    <div>
                       <h2 class="modal-title">COMPRA #${c.id.toString().slice(-4)}</h2>
                       <span class="modal-subtitle">Fecha Pedido: ${c.fecha_pedido || 'N/A'}</span>
                    </div>
                    <button onclick="window.closeModal()" class="modal-close">&times;</button>
                </div>
                
                <div class="modal-body">
                    <h4 class="form-section-title">Especificaciones del Producto</h4>
                    <div style="display:flex; gap:15px; align-items:center; background:var(--surface-1); padding:1.5rem; border-radius:12px; border:1px solid var(--glass-border); margin-bottom:1.5rem;">
                       <div style="width:80px; height:80px; border-radius:8px; overflow:hidden; flex-shrink:0; background:var(--input-bg); display:flex; align-items:center; justify-content:center;">
                           ${imageUrl ? `<img src="${imageUrl}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="opacity:0.4; font-size:0.6rem; text-align:center;">SIN<br>FOTO</span>'}
                       </div>
                       <div style="flex:1;">
                           <div style="font-weight:700; font-size:1.1rem; color:var(--text-main);">${pData.nombre_producto || 'Producto Stock General'}</div>
                           <div style="display:flex; gap:8px; align-items:center; margin-top:6px; font-size:0.8rem;">
                               <span style="opacity:0.7;">Tienda/Proveedor: <strong>${c.proveedor || pData.tienda_cotizacion || 'N/A'}</strong></span>
                               ${pData.talla ? `<span style="background:var(--primary-red); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Talla: ${pData.talla} ${pData.genero ? `(${pData.genero})` : ''}</span>` : ''}
                           </div>
                       </div>
                    </div>

                    <h4 class="form-section-title">Detalles de la Operación</h4>
                    <div class="form-grid-2" style="background:var(--glass-hover); padding:1.5rem; border-radius:12px; border:1px solid var(--glass-border);">
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; opacity:0.6;">📦 Relación Comercial</p>
                            <strong style="font-size:1.1rem; color:${c.venta_id ? '#FFB703' : 'var(--success-green)'};">${c.venta_id ? `Encargo #${c.venta_id.toString().slice(-4)}` : 'Stock Importación'}</strong>
                        </div>
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; opacity:0.6;">👤 Destinatario Original</p>
                            <strong style="font-size:1.1rem;">${clientName}</strong>
                        </div>
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; opacity:0.6;">📊 Fase Logística Real</p>
                            <span style="font-size:0.85rem; font-weight:700; padding:5px 12px; border-radius:10px; background:${faseCol}; color:#fff; display:inline-block; line-height:1.5;">${fase}</span>
                        </div>
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; opacity:0.6;">💸 Costo USD Asumido</p>
                            <strong style="font-size:1.3rem; color:var(--primary-red);">${formatUSD(c.costo_usd || 0)}</strong>
                        </div>
                        ${(vData && (auth.isAdmin() || auth.getUserRole() === 'gerente' || auth.getUserRole() === 'finanzas')) ? `
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; color:#FFB703; opacity:0.8;">✈️ Envío Int. (Calculado)</p>
                            <strong style="font-size:1.3rem; color:#FFB703;">${formatCOP(vData.valor_envio_internacional || 0)}</strong>
                        </div>
                        ` : ''}
                        ${pData.link_producto ? `<div style="grid-column: span 2; margin-top:5px;"><a href="${pData.link_producto}" target="_blank" style="display:inline-block; font-size:0.8rem; padding:8px 16px; border-radius:8px; background:rgba(6,214,160,0.1); color:var(--success-green); border:1px solid rgba(6,214,160,0.2); text-decoration:none;">🔗 Validar Enlace Original del Producto</a></div>` : ''}
                    </div>
                </div>

                <div class="modal-footer">
                   <button class="btn-primary" onclick="window.closeModal()">Cerrar Detalles</button>
                </div>
            </div>
        `;
        container.style.display = 'flex';
    };

    // Build the full module HTML
    const tabs = [
        { id: 'tabla',    icon: '📋', label: 'Tabla' },
        { id: 'tienda',   icon: '🏪', label: 'Por Tienda' },
        { id: 'fase',     icon: '🔵', label: 'Por Fase' },
        { id: 'tipo',     icon: '🗂️', label: 'Por Tipo' },
        { id: 'timeline', icon: '📅', label: 'Línea de Tiempo' },
    ];

    // Pagination State
    const _page = parseInt(localStorage.getItem('purchases_page') || '1');
    const _rpp  = parseInt(localStorage.getItem('purchases_rpp') || '10');
    const pagedList = _currentView === 'tabla' ? paginate(_purFiltered, _page, _rpp) : _purFiltered;

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1.5rem; flex-wrap:wrap; gap:15px;">
        <div>
          <span class="page-eyebrow">Operaciones · USA</span>
          <h2 class="page-title">Compras Operativas</h2>
          <p style="opacity:0.5; font-size:0.82rem; margin-top:4px;">Adquisiciones para inventario o fulfilling de encargos.</p>
        </div>
        <div class="module-filters-bar">
            <div class="date-filter-wrap">
                <label>Desde</label>
                <input type="date" id="pur-date-start" class="date-filter-input" value="${_purStartDate}">
                <label style="margin-left:5px;">Hasta</label>
                <input type="date" id="pur-date-end" class="date-filter-input" value="${_purEndDate}">
                <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applyPurDateFilter()">Filtrar</button>
            </div>
            <button class="btn-excel" onclick="window.exportPurExcel()">📥 Excel</button>
            <input type="text" id="find-it" placeholder="Buscar compra o producto..." style="background:var(--input-bg);border:1px solid var(--glass-border);padding:10px 15px;border-radius:12px;color:var(--text-main);width:230px;outline:none;">
            ${auth.canEdit('purchases') ? `<button class="btn-primary" onclick="window.modalCompra()">+ Registrar Compra</button>` : ''}
        </div>
      </div>

      ${renderPendingAlert(pendientes, _cache.productos)}

      <div id="pur-kpi-container">
        ${renderKPIStrip(_purFiltered)}
      </div>

      <!-- View Switcher + separator -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem; flex-wrap:wrap; gap:0.8rem;">
        <div class="purchase-view-switcher">
            ${tabs.map(t => `
            <button class="pv-tab${t.id === _currentView ? ' active' : ''}"
                data-tab="${t.id}" onclick="window.switchPurchaseView('${t.id}')">
                ${t.icon} ${t.label}
            </button>`).join('')}
        </div>
      </div>

      <!-- Active view panel -->
      <div id="purchase-view-container">
        ${getPanelHTML(_currentView, { ..._cache, compras: pagedList })}
      </div>
      ${_currentView === 'tabla' ? renderPagination(_purFiltered.length, _page, _rpp, 'purchases') : ''}
    `;

    renderLayout(html);

    setTimeout(() => {
        attachSearchListener();
        attachGroupToggles();
    }, 150);
};

// ─── Helper: get panel HTML by view ID ─────────────────────────────────────────
function getPanelHTML(tab, cache) {
    const { compras, ventas, productos, clientes, logisticaList } = cache;
    switch (tab) {
        case 'tienda':   return renderViewTienda(compras, productos, logisticaList);
        case 'fase':     return renderViewFase(compras, productos, logisticaList);
        case 'tipo':     return renderViewTipo(compras, productos, ventas, clientes, logisticaList);
        case 'timeline': return renderViewTimeline(compras, productos, logisticaList);
        default:         return renderViewTabla(compras, ventas, productos, clientes, logisticaList);
    }
}

// ─── Search listener (only for tabla view) ─────────────────────────────────────
function attachSearchListener() {
    const fp = document.getElementById('find-purchase');
    if (!fp) return;
    fp.oninput = (e) => {
        const k = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll('.purchase-row');
        let visible = 0;
        rows.forEach(r => {
            const match = (r.getAttribute('data-text') || '').includes(k);
            r.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        const empty = document.getElementById('purchase-empty-search');
        if (empty) empty.style.display = (visible === 0 && k.length > 0) ? '' : 'none';
    };
}

// ─── Group toggle setup ────────────────────────────────────────────────────────
function attachGroupToggles() {
    // Open all groups by default when renders first time
    document.querySelectorAll('.purchase-group-card').forEach(el => {
        if (!el.classList.contains('open')) el.classList.add('open');
    });
}

// ─── Create Purchase Modal (unchanged logic, improved UI) ──────────────────────
export const createPurchaseModal = async (navigateTo, ventaIdPrefill = null) => {
    const [ventas, productos, comprasExistentes] = await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Compras'),
    ]);

    const encargos = (ventas || []).filter(v => v.tipo_venta === 'Encargo');

    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <h2>Registrar Nueva Compra USA</h2>
                <button class="modal-close-btn" onclick="window.closeModal()">✕</button>
            </div>
            
            <form id="purchase-form" onsubmit="return false;">
                <div class="modal-body">
                    <div class="form-grid-2" style="margin-bottom: 2rem; background: var(--surface-1); padding: 2rem; border-radius: 16px; border: 1px solid var(--border-base);">
                        <div class="form-group">
                            <label class="form-label">Tipo de Compra *</label>
                            <select id="pc-tipo" onchange="window.togglePurchaseType()" required>
                                <option value="encargo">Encargo (Vinculado a Cliente)</option>
                                <option value="stock">Stock Propio (Sin cliente)</option>
                            </select>
                        </div>
                        
                        <div class="form-group" id="pc-encargo-section">
                            <label class="form-label">Orden de Encargo *</label>
                            <select id="pc-venta-select">
                                <option value="">-- Seleccionar Encargo --</option>
                                ${encargos.map(v => {
                                    const prod = productos.find(p => p.id?.toString() === v.producto_id?.toString());
                                    return `<option value="${v.id}" ${ventaIdPrefill && ventaIdPrefill.toString() === v.id.toString() ? 'selected' : ''}>${prod ? prod.nombre_producto : 'Prod #'+v.producto_id} — Orden #${v.id.toString().slice(-4)}</option>`;
                                }).join('')}
                            </select>
                        </div>

                        <div class="form-group" id="pc-stock-section" style="display:none;">
                            <label class="form-label">Producto Vinculado *</label>
                            <select id="pc-producto-select">
                                <option value="">-- Sin Producto --</option>
                                ${(productos || []).map(p => `<option value="${p.id}">${p.marca} ${p.nombre_producto}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Proveedor / Tienda *</label>
                            <input type="text" id="pc-proveedor" placeholder="Ej: Nike.com, FootLocker..." required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Costo en USD *</label>
                            <input type="number" id="pc-costo" placeholder="0.00" step="0.01" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Valor descontado banco (COP)</label>
                            <input type="number" id="pc-costo-cop" placeholder="0" step="1">
                        </div>

                        <div class="form-group">
                            <label class="form-label">Comprobante de Pago</label>
                            ${buildComprobanteUploadHTML('comp-purchase-file')}
                        </div>

                        <div class="form-group">
                            <label class="form-label">Fecha Compra *</label>
                            <input type="date" id="pc-fecha" value="${new Date().toISOString().split('T')[0]}" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Número de Factura *</label>
                            <input type="text" id="pc-num-factura" placeholder="Ej. SHOP-9988" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Código producto en factura (Opcional)</label>
                            <input type="text" id="pc-codigo-factura" placeholder="Ej. SKU-7766">
                        </div>

                        <div class="form-group">
                            <label class="form-label">Estado Inicial</label>
                            <select id="pc-estado">
                                <option value="Comprado en tienda EEUU">Comprado en tienda EEUU</option>
                                <option value="En tránsito USA">En tránsito USA</option>
                                <option value="Bodega USA">Bodega USA</option>
                            </select>
                        </div>
                    </div>

                    <div id="pc-error" style="display:none; color:var(--primary-red); background:rgba(229,19,101,0.1); padding:10px; border-radius:8px; font-size:0.85rem; margin-top:1rem; text-align:center; font-weight:600;"></div>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn-action" style="padding:10px 25px;" onclick="window.closeModal()">Cancelar</button>
                    <button type="button" class="btn-primary" style="padding:10px 30px;" onclick="window.submitPurchase()">Guardar Compra</button>
                </div>
            </form>
        </div>`;
    container.style.display = 'flex';
    
    setTimeout(() => { attachComprobanteInput('comp-purchase-file'); }, 100);

    window.togglePurchaseType = () => {
        const tipo = document.getElementById('pc-tipo').value;
        document.getElementById('pc-encargo-section').style.display = tipo === 'encargo' ? '' : 'none';
        document.getElementById('pc-stock-section').style.display = tipo === 'stock' ? '' : 'none';
    };

    window.submitPurchase = async () => {
        const tipo = document.getElementById('pc-tipo').value;
        const proveedor = document.getElementById('pc-proveedor').value.trim();
        const costo = parseFloat(document.getElementById('pc-costo').value);
        const costoCop = parseFloat(document.getElementById('pc-costo-cop').value) || 0;
        const compFileInput = document.getElementById('comp-purchase-file');
        const compFile = compFileInput && compFileInput.files[0] ? compFileInput.files[0] : null;
        const fechaComp = document.getElementById('pc-fecha').value;
        const numFact = document.getElementById('pc-num-factura').value;
        const codFact = document.getElementById('pc-codigo-factura').value;
        const estado = document.getElementById('pc-estado').value;
        const ventaId = tipo === 'encargo' ? document.getElementById('pc-venta-select').value : null;
        const productoId = tipo === 'stock' ? document.getElementById('pc-producto-select').value : null;

        const errEl = document.getElementById('pc-error');
        if (!proveedor || isNaN(costo) || costo <= 0 || !fechaComp || !numFact) {
            errEl.textContent = 'Completa los campos obligatorios correctamente.';
            errEl.style.display = '';
            return;
        }
        if (tipo === 'encargo' && !ventaId) {
            errEl.textContent = 'Selecciona el encargo vinculado.';
            errEl.style.display = '';
            return;
        }
        errEl.style.display = 'none';

        const btn = document.querySelector('#purchase-form .btn-primary');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            if (compFile) {
                btn.textContent = 'Subiendo comprobante...';
            }
            const comprobanteUrl = compFile ? await uploadImageToSupabase(compFile) : "";

            const payload = { 
                id: Date.now().toString(),
                proveedor, 
                costo_usd: costo,
                costo_cop: costoCop,
                comprobante_url: comprobanteUrl,
                fecha_pedido: fechaComp,
                fecha_compra: fechaComp,
                numero_factura: numFact,
                codigo_producto_factura: codFact,
                estado_compra: estado 
            };
            if (ventaId) payload.venta_id = ventaId;

            if (tipo === 'encargo' && ventaId) {
                const ventaTarget = encargos.find(v => v.id.toString() === ventaId);
                if (ventaTarget) payload.producto_id = ventaTarget.producto_id;
            } else if (productoId) {
                payload.producto_id = productoId;
            }

            await db.postData('Compras', payload, 'INSERT');

            if (tipo === 'encargo' && ventaId) {
                await db.postData('Ventas', { id: ventaId, estado_orden: 'Comprado en tienda EEUU' }, 'UPDATE');
                
                // --- Registro Automático en Logística ---
                const logisticaList = await db.fetchData('Logistica');
                const listLog = Array.isArray(logisticaList) ? logisticaList : [];
                const yaEnLogistica = listLog.some(l => l.venta_id?.toString() === ventaId.toString());
                
                if (!yaEnLogistica) {
                    const payloadLogistica = {
                        id: Date.now().toString() + 'LOG',
                        venta_id: ventaId,
                        compra_id: payload.id,
                        fase: '1. Comprado (Esperando Tracking Local USA)',
                        ubicacion: 'USA',
                        historial: JSON.stringify([{
                            fase: '1. Comprado (Esperando Tracking Local USA)',
                            fecha: new Date().toLocaleString('es-CO'),
                            notas: 'Generado automáticamente desde Registro de Compra.'
                        }]),
                        fecha_actualizacion: new Date().toISOString()
                    };
                    await db.postData('Logistica', payloadLogistica, 'INSERT');
                }
            }

            showToast('✅ Compra registrada correctamente.');
            window.closeModal();
            _cache = null;
            _currentView = 'tabla';
            renderPurchases(_renderLayoutFn, navigateTo);
        } catch (err) {
            errEl.textContent = 'Error al guardar: ' + err.message;
            errEl.style.display = '';
            btn.disabled = false;
            btn.textContent = oldText;
        }
    };

    if (ventaIdPrefill) {
        const select = document.getElementById('pc-venta-select');
        if (select) select.value = ventaIdPrefill;
    }
};
