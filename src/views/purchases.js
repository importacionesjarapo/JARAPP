import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatUSD, formatCOP, renderError, showToast, getLogisticaFase, getLogisticaColor, downloadExcel, buildComprobanteUploadHTML, attachComprobanteInput, uploadImageToSupabase } from '../utils.js';
import { TablaPro } from '../components/tabla-pro.js';
import { ViajeService } from '../services/viajes.js';

// Tiendas frecuentes en compras USA para personal shopping (#27, dato
// semilla de referencia) — solo sugerencias del <datalist>, el campo sigue
// siendo texto libre porque no hay catálogo real de tiendas por tenant.
const TIENDAS_REFERENCIA = [
    'Nike.com', 'Amazon', 'FootLocker', 'Sephora', 'Ulta Beauty', 'Macy\'s',
    'Ross', 'Marshalls', 'TJ Maxx', 'Walmart', 'Target', 'Best Buy',
    'Dick\'s Sporting Goods', 'Zara USA', 'Adidas.com', 'GNC',
];

// ─── Cached data (persists across view switches without re-fetching) ───────────
let _cache = null;
let _renderLayoutFn = null;
let _navigateToFn = null;
let _currentView = 'tabla';
let _purStartDate = '';
let _purEndDate = '';
let _purFiltered = [];
// Compras USA se divide en 2 submódulos: "general" (Stock + encargos de
// Compras Online) y "viaje" (solo lo que viene de ventas "En Viaje USA").
let _purSubmodulo = 'general';
// Agrupación de la alerta de pendientes: por tienda o por marca del
// producto, para comprar de una sola vez todo lo pendiente de un mismo
// lugar. _pendientesActivosActual se mantiene sincronizado con el
// submódulo activo para poder re-renderizar el agrupamiento sin recalcular
// todo el módulo.
let _purPendingGroupBy = 'tienda';
let _pendientesActivosActual = [];

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

// ─── Agrupa pendientes por tienda o marca del producto vinculado — así se
// puede ir una sola vez a una tienda/marca y comprar todo lo pendiente ───
const agruparPendientes = (pendientes, productos, criterio) => {
    const groups = {};
    pendientes.forEach(p => {
        const prod = productos.find(x => x.id?.toString() === p.producto_id?.toString()) || {};
        const key = ((criterio === 'marca' ? prod.marca : prod.tienda_cotizacion) || '').trim() || 'Sin definir';
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
};

// ─── Render: Alerta de pendientes (siempre visible) ────────────────────────────
const renderPendingAlert = (pendientes, productos, criterio = 'tienda') => {
    if (!pendientes || pendientes.length === 0) return '';
    const grupos = agruparPendientes(pendientes, productos, criterio);
    const etiquetaCriterio = criterio === 'marca' ? '🏷️ Marca' : '🏪 Tienda';

    return `
    <div class="purchase-pending-alert">
        <h4>
            ⚠️ Encargos pendientes de compra
            <span class="pending-badge">${pendientes.length}</span>
        </h4>
        <p style="font-size:0.78rem;opacity:0.75;margin:-0.4rem 0 0.9rem;">Agrupados por ${etiquetaCriterio.toLowerCase()} para ir una sola vez a comprar todo lo pendiente de un mismo lugar.</p>
        <div style="display:flex;gap:6px;margin-bottom:1rem;">
            <button class="btn-action" style="${criterio==='tienda' ? 'background:var(--brand-magenta);color:#fff;border-color:var(--brand-magenta);' : ''}" onclick="window.setPurPendingGroupBy('tienda')">🏪 Por Tienda</button>
            <button class="btn-action" style="${criterio==='marca' ? 'background:var(--brand-magenta);color:#fff;border-color:var(--brand-magenta);' : ''}" onclick="window.setPurPendingGroupBy('marca')">🏷️ Por Marca</button>
        </div>
        ${grupos.map(([nombre, items]) => `
        <div class="purchase-pending-group">
            <div class="purchase-pending-group-header">
                <strong>${etiquetaCriterio.split(' ')[0]} ${nombre}</strong>
                <span class="pending-badge">${items.length}</span>
                ${auth.canEdit('purchases') && items.length > 1 ? `<button class="btn-primary" style="font-size:0.75rem;padding:7px 14px;" data-ids="${items.map(p => p.id).join(',')}" onclick="window.comprarGrupoPendiente(this)">🛒 Comprar todo (${items.length})</button>` : ''}
            </div>
            <div style="display:flex; gap:0.8rem; flex-wrap:wrap;">
                ${items.map(p => {
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
        </div>`).join('')}
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
        { icon: '💰', value: formatUSD(total), label: 'Total Invertido', color: 'var(--info-blue)' },
        { icon: '📦', value: compras.length, label: 'Total Compras', color: 'var(--warning-orange)' },
        { icon: '🛍️', value: encargos.length, label: 'Para Encargos', color: 'var(--brand-magenta)' },
        { icon: '🏪', value: stock.length, label: 'Para Stock', color: 'var(--success-green)' },
        { icon: '🏬', value: proveedores.size, label: 'Proveedores', color: 'var(--brand-green)' },
    ];

    return `
    <div class="kpi-strip">
        ${kpis.map(k => `
        <div class="kpi-strip-card" style="--kpi-color:${k.color};" onclick="window.openPurchasesKPI('${k.label}')">
            <span class="kpi-strip-icon">${k.icon}</span>
            <div class="kpi-strip-value" style="color:${k.color};">${k.value}</div>
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
                <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').style.display='none'; window.modalDetalleCompra('${c.id}');" style="margin-top:4px;">👁️ Detalles</button>
            </div>
        </div>`;
    }).join('');
    
    window.openKPIDetailModal(title, subtitle, itemsHtml);
};

// ─── View 1: Tabla (TablaPro) ───────────────────────────────────────────────────
// Producto/Cliente/Fase Logística se resuelven por closure contra _cache
// (join manual ya cargado), no son columnas reales de Compras.
function _montarTablaCompras() {
    const tabla = new TablaPro({
        containerId: 'compras-tabla-container',
        tabla: 'Compras',
        supabase: db.client,
        filtrosExtra: { es_viaje: _purSubmodulo === 'viaje' },
        searchColumns: ['proveedor', 'estado_compra', 'numero_factura'],
        columnas: [
            { key: 'id', label: 'ID', width: '90px',
              render: (v) => `<span class="cell-number">#${v.toString().slice(-4)}</span>` },
            { key: 'fecha_pedido', label: 'Fecha', width: '110px',
              render: (v) => `<span style="font-size:0.82rem;">${v || 'N/A'}</span>` },
            { key: 'proveedor', label: 'Proveedor / Tienda', width: '180px',
              render: (v) => `<span class="cell-title" style="max-width:170px;">${v || '—'}</span>` },
            { key: 'producto_id', label: 'Producto', width: '200px', sortable: false,
              render: (v) => {
                  const pData = _cache.productos.find(p => p.id?.toString() === v?.toString()) || {};
                  return `<span class="cell-title" style="max-width:180px;">${pData.nombre_producto || '—'}</span>
                          ${pData.talla ? `<span class="cell-subtitle">Talla ${pData.talla}${pData.genero ? ' · ' + pData.genero : ''}</span>` : ''}`;
              } },
            { key: 'venta_id', label: 'Tipo', width: '150px', sortable: false,
              render: (v) => {
                  if (!v) return `<span style="color:var(--success-green);font-weight:700;font-size:0.8rem;">🛒 Stock</span>`;
                  const vData = _cache.ventas.find(vt => vt.id?.toString() === v.toString());
                  const cData = vData?.cliente_id ? _cache.clientes.find(cl => cl.id?.toString() === vData.cliente_id?.toString()) : null;
                  return `<span style="color:var(--violet);font-weight:700;font-size:0.8rem;">📦 Encargo<br><span style="font-size:0.7rem;opacity:0.7;">${cData?.nombre || '#' + v.toString().slice(-4)}</span></span>`;
              } },
            { key: 'estado_compra', label: 'Fase Logística', width: '190px', sortable: false,
              render: (v, row) => {
                  const realStatus = row.venta_id
                      ? getLogisticaFase(row.venta_id, _cache.logisticaList, v || 'En proceso USA')
                      : (v || 'Stock USA');
                  const statusColor = row.venta_id
                      ? getLogisticaColor(realStatus)
                      : (realStatus.includes('Entregado') ? 'var(--success-green)' : 'var(--info-blue)');
                  return `<span class="status-badge" style="background:${statusColor};">${realStatus}</span>`;
              } },
            { key: 'costo_usd', label: 'Costo USD', width: '130px',
              render: (v) => `<span class="cell-price" style="color:var(--primary-red);">${formatUSD(v)}</span>` },
        ],
        acciones: (row) => `<button class="btn-action" onclick="window.modalDetalleCompra('${row.id}');event.stopPropagation()" title="Ver Detalles">👁️</button>`,
        onRowClick: (row) => window.modalDetalleCompra(row.id),
        altura: '65vh',
    });
    tabla.mount();
}

// ─── Actualiza el panel activo (usada por switch de vista y filtro de fecha) ───
function _renderPurchasePanel(tab) {
    const panel = document.getElementById('purchase-view-container');
    if (!panel || !_cache) return;
    if (tab === 'tabla') {
        panel.innerHTML = `<div id="compras-tabla-container"></div>`;
        _montarTablaCompras();
    } else {
        const comprasDelSubmodulo = _purFiltered.filter(c => !!c.es_viaje === (_purSubmodulo === 'viaje'));
        panel.innerHTML = getPanelHTML(tab, { ..._cache, compras: comprasDelSubmodulo });
    }
    attachGroupToggles();
}

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
                    <h3>📦 Encargos <span style="font-size:0.75rem; font-weight:600; padding:2px 8px; background:var(--violet-dim); color:var(--violet); border-radius:6px; margin-left:4px;">${encargos.length}</span></h3>
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

    const [compras, ventas, productos, clientes, logistica, viajes] = await Promise.all([
        db.fetchData('Compras'),
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Clientes'),
        db.fetchData('Logistica'),
        db.fetchData('viajes'),
    ]);

    if (compras.error) return renderError(renderLayout, compras.error, navigateTo);

    const logisticaList = logistica.error ? [] : logistica;
    const comprasDesc = [...(compras || [])].reverse();

    // Store cache
    _cache = { compras: comprasDesc, ventas: ventas || [], productos: productos || [], clientes: clientes || [], logisticaList, viajes: viajes.error ? [] : (viajes || []) };

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
        const kpiCont = document.getElementById('pur-kpi-container');
        if (kpiCont) kpiCont.innerHTML = renderKPIStrip(comprasSubmodulo(_purFiltered, _purSubmodulo));

        _renderPurchasePanel(_currentView);
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

    // Excluir encargos que ya tienen compra registrada en BD
    const comprasVentaIds = new Set((_cache.compras || []).map(c => c.venta_id?.toString()).filter(Boolean));
    const pendientesTodos = (ventas || []).filter(v =>
        v.tipo_venta === 'Encargo' &&
        v.estado_orden === 'Validando Compra EEUU' &&
        !comprasVentaIds.has(v.id?.toString())
    );
    // Solo cuentan como "de viaje" los encargos tomados en una venta
    // "En Viaje USA" — el resto (Compras Online) va siempre al submódulo
    // general, sin importar si hay un viaje activo en este momento.
    const pendientesGeneral = pendientesTodos.filter(v => !v.comprado_en_viaje);
    const pendientesViaje = pendientesTodos.filter(v => v.comprado_en_viaje);

    const comprasSubmodulo = (lista, sub) => lista.filter(c => !!c.es_viaje === (sub === 'viaje'));

    // Initial Filter
    _purFiltered = [..._cache.compras];
    const _s = _purStartDate ? new Date(_purStartDate + 'T00:00:00') : null;
    const _e = _purEndDate ? new Date(_purEndDate + 'T23:59:59') : null;
    if (_s || _e) { applyPurFilter(); }

    // Attach global functions
    window.modalCompra = (ventaId = null, queueRestante = []) => createPurchaseModal(navigateTo, ventaId, queueRestante);

    window.setPurPendingGroupBy = (criterio) => {
        _purPendingGroupBy = criterio;
        const pendCont = document.getElementById('pur-pending-container');
        if (pendCont) pendCont.innerHTML = renderPendingAlert(_pendientesActivosActual, _cache.productos, _purPendingGroupBy);
    };

    window.comprarGrupoPendiente = (btn) => {
        const ids = (btn.dataset.ids || '').split(',').filter(Boolean);
        if (!ids.length) return;
        window.modalCompra(ids[0], ids.slice(1));
    };

    window.switchPurchaseView = (tab) => {
        _currentView = tab;
        // Update tab styles
        document.querySelectorAll('.pv-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        _renderPurchasePanel(tab);
    };

    window.switchPurSubmodulo = (sub) => {
        _purSubmodulo = sub;

        const btnGeneral = document.getElementById('pur-sub-general');
        const btnViaje = document.getElementById('pur-sub-viaje');
        if (btnGeneral) { btnGeneral.style.background = sub === 'general' ? 'var(--brand-magenta)' : 'transparent'; btnGeneral.style.color = sub === 'general' ? '#fff' : 'var(--text-main)'; btnGeneral.style.opacity = sub === 'general' ? '1' : '0.6'; }
        if (btnViaje) { btnViaje.style.background = sub === 'viaje' ? '#D97706' : 'transparent'; btnViaje.style.color = sub === 'viaje' ? '#fff' : 'var(--text-main)'; btnViaje.style.opacity = sub === 'viaje' ? '1' : '0.6'; }

        _pendientesActivosActual = sub === 'viaje' ? pendientesViaje : pendientesGeneral;
        const pendCont = document.getElementById('pur-pending-container');
        if (pendCont) pendCont.innerHTML = renderPendingAlert(_pendientesActivosActual, _cache.productos, _purPendingGroupBy);

        const kpiCont = document.getElementById('pur-kpi-container');
        if (kpiCont) kpiCont.innerHTML = renderKPIStrip(comprasSubmodulo(_purFiltered, sub));

        _renderPurchasePanel(_currentView);
    };

    window.togglePurchaseGroup = (cardId) => {
        const el = document.getElementById(cardId);
        if (el) el.classList.toggle('open');
    };

    window.modalDetalleCompra = (id) => {
        const { compras, productos, ventas, clientes, viajes } = _cache;
        const c = compras.find(x => x.id.toString() === id.toString());
        if (!c) return;
        const viajeVinculado = c.viaje_id ? (viajes || []).find(v => v.id?.toString() === c.viaje_id.toString()) : null;

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
                            <strong style="font-size:1.1rem; color:${c.venta_id ? 'var(--violet)' : 'var(--success-green)'};">${c.venta_id ? `Encargo #${c.venta_id.toString().slice(-4)}` : 'Stock Importación'}</strong>
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
                        ${viajeVinculado ? `
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; opacity:0.6;">✈️ Viaje Vinculado</p>
                            <strong style="font-size:1rem; color:#D97706;">${viajeVinculado.nombre}</strong>
                        </div>
                        ` : ''}
                        ${(vData && (auth.isAdmin() || auth.getUserRole() === 'gerente' || auth.getUserRole() === 'finanzas')) ? `
                        <div>
                            <p style="margin:0 0 5px 0; font-size:0.75rem; color:var(--violet); opacity:0.8;">✈️ Envío Int. (Calculado)</p>
                            <strong style="font-size:1.3rem; color:var(--violet);">${formatCOP(vData.valor_envio_internacional || 0)}</strong>
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

    _pendientesActivosActual = _purSubmodulo === 'viaje' ? pendientesViaje : pendientesGeneral;
    const pendientesActivos = _pendientesActivosActual;
    const comprasDelSubmoduloInicial = comprasSubmodulo(_purFiltered, _purSubmodulo);

    const html = `
      <div class="module-header">
        <div>
          <span class="page-eyebrow">Operaciones · USA</span>
          <h2 class="page-title">Compras Operativas</h2>
          <p style="opacity:0.5; font-size:0.82rem; margin-top:4px;">Adquisiciones para inventario o fulfilling de encargos.</p>
        </div>
        ${auth.canEdit('purchases') ? `<button class="btn-primary" style="padding:12px 28px;font-size:0.9rem;" onclick="window.modalCompra()">+ Registrar Compra</button>` : ''}
      </div>

      <!-- Submódulos: Compras Online (general) vs. Compras en Viaje (solo lo
           que vino de ventas "En Viaje USA") -->
      <div style="display:flex;background:var(--surface-2);border:1px solid var(--border-base);border-radius:12px;padding:4px;gap:4px;margin-bottom:1.2rem;width:fit-content;">
        <button id="pur-sub-general" onclick="window.switchPurSubmodulo('general')" style="padding:8px 20px;border-radius:9px;border:none;cursor:pointer;font-size:0.85rem;font-weight:700;background:${_purSubmodulo==='general'?'var(--brand-magenta)':'transparent'};color:${_purSubmodulo==='general'?'#fff':'var(--text-main)'};opacity:${_purSubmodulo==='general'?'1':'0.6'};">🛍️ Compras Online</button>
        <button id="pur-sub-viaje" onclick="window.switchPurSubmodulo('viaje')" style="padding:8px 20px;border-radius:9px;border:none;cursor:pointer;font-size:0.85rem;font-weight:700;background:${_purSubmodulo==='viaje'?'#D97706':'transparent'};color:${_purSubmodulo==='viaje'?'#fff':'var(--text-main)'};opacity:${_purSubmodulo==='viaje'?'1':'0.6'};">✈️ Compras en Viaje</button>
      </div>

      <div class="module-filters-bar" style="margin-bottom:1.5rem;">
          <div class="date-filter-wrap">
              <label>Desde</label>
              <input type="date" id="pur-date-start" class="date-filter-input" value="${_purStartDate}">
              <label style="margin-left:5px;">Hasta</label>
              <input type="date" id="pur-date-end" class="date-filter-input" value="${_purEndDate}">
              <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applyPurDateFilter()">Filtrar</button>
          </div>
          <div style="flex:1 1 auto;"></div>
          <button class="btn-excel" onclick="window.exportPurExcel()">📥 Excel</button>
      </div>

      <div id="pur-pending-container">
        ${renderPendingAlert(pendientesActivos, _cache.productos, _purPendingGroupBy)}
      </div>

      <div id="pur-kpi-container">
        ${renderKPIStrip(comprasDelSubmoduloInicial)}
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
        ${_currentView === 'tabla' ? `<div id="compras-tabla-container"></div>` : getPanelHTML(_currentView, { ..._cache, compras: comprasDelSubmoduloInicial })}
      </div>
    `;

    renderLayout(html);
    if (_currentView === 'tabla') _montarTablaCompras();

    setTimeout(() => {
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
        default:         return renderViewTienda(compras, productos, logisticaList);
    }
}

// ─── Group toggle setup ────────────────────────────────────────────────────────
function attachGroupToggles() {
    // Open all groups by default when renders first time
    document.querySelectorAll('.purchase-group-card').forEach(el => {
        if (!el.classList.contains('open')) el.classList.add('open');
    });
}

// ─── Create Purchase Modal (unchanged logic, improved UI) ──────────────────────
export const createPurchaseModal = async (navigateTo, ventaIdPrefill = null, queueRestante = []) => {
    const [ventas, productos, comprasExistentes] = await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Compras'),
    ]);

    const encargos = (ventas || []).filter(v => v.tipo_venta === 'Encargo');

    // Si hay un viaje activo en el módulo Viaje USA, las compras de Stock se
    // vinculan automáticamente a él. Las compras de un Encargo, en cambio,
    // heredan el viaje de la venta que las originó (si esa venta se registró
    // como "En Viaje USA") — así que el banner se recalcula según lo que el
    // usuario vaya seleccionando (ver window.updateViajeBanner más abajo).
    let viajeActivo = null;
    try { viajeActivo = await ViajeService.getActivo(); } catch (_) { /* sin viaje activo */ }
    const viajeBannerHTML = `<div id="pc-viaje-banner" style="display:none;align-items:center;gap:10px;padding:0.8rem 1.2rem;border-radius:12px;margin-bottom:1.2rem;"></div>`;
    // Con viaje activo, el registro se agiliza: solo tienda/costo quedan
    // fijos y obligatorios, el resto se agrega bajo demanda desde el
    // checklist "Campos Adicionales" — mismo patrón que Ventas · En Viaje
    // USA · En Tienda, porque en un viaje se registran muchísimas compras
    // seguidas y cada campo de más cuenta.
    const esViajeCompra = !!viajeActivo;
    const CAMPOS_COMPRA_AGIL = [
        { key:'costo_cop',     label:'Valor descontado banco (COP)' },
        { key:'num_factura',   label:'Número de Factura' },
        { key:'codigo_factura',label:'Código producto en factura' },
    ];
    const campoCompraHTML = (key) => {
        switch (key) {
            case 'costo_cop': return `<div class="form-group" data-campo-compra="costo_cop">
                <label class="form-label">Valor descontado banco (COP)</label>
                <input type="number" id="pc-costo-cop" placeholder="0" step="1">
            </div>`;
            case 'num_factura': return `<div class="form-group" data-campo-compra="num_factura">
                <label class="form-label">Número de Factura</label>
                <input type="text" id="pc-num-factura" placeholder="Ej. SHOP-9988">
            </div>`;
            case 'codigo_factura': return `<div class="form-group" data-campo-compra="codigo_factura">
                <label class="form-label">Código producto en factura</label>
                <input type="text" id="pc-codigo-factura" placeholder="Ej. SKU-7766">
            </div>`;
            default: return '';
        }
    };
    window.toggleCampoCompra = (key, activo) => {
        const cont = document.getElementById('pc-campos-agregados');
        if (!cont) return;
        const fila = document.getElementById(`fila-campo-compra-${key}`);
        const dot = fila?.querySelector('.admin-perm-dot');
        if (activo) {
            if (!cont.querySelector(`[data-campo-compra="${key}"]`)) cont.insertAdjacentHTML('beforeend', campoCompraHTML(key));
            dot?.classList.add('active');
        } else {
            cont.querySelector(`[data-campo-compra="${key}"]`)?.remove();
            dot?.classList.remove('active');
        }
    };

    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');

    // ─── Helper: generar HTML del banner de referencia ──────────────────
    const buildEncargoBanner = (ventaId) => {
        if (!ventaId) return '<div id="pc-encargo-banner" style="display:none;"></div>';
        const vData = encargos.find(v => v.id.toString() === ventaId.toString());
        if (!vData) return '<div id="pc-encargo-banner" style="display:none;"></div>';
        const pData = productos.find(p => p.id?.toString() === vData.producto_id?.toString()) || {};
        const imgUrl = pData.url_imagen || '';
        const linkCompra = pData.link_producto || '';
        const precioUsd = pData.precio_usd || vData.precio_usd_cotizado || '';
        const precioUsdDisplay = precioUsd ? `$${parseFloat(precioUsd).toFixed(2)} USD` : 'N/A';
        const precioCop = vData.valor_total_cop ? formatCOP(vData.valor_total_cop) : 'N/A';
        const talla = pData.talla || 'N/A';
        const tienda = pData.tienda_cotizacion || 'N/A';
        const marca = pData.marca || 'N/A';
        const categoria = pData.categoria || '';

        return `
        <div id="pc-encargo-banner" style="
            background: linear-gradient(135deg, rgba(229,19,101,0.07) 0%, rgba(229,19,101,0.02) 100%);
            border: 1px solid rgba(229,19,101,0.25);
            border-radius: 16px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            display: flex;
            gap: 1.5rem;
            align-items: flex-start;
        ">
            <!-- Imagen -->
            <div style="width:110px; height:110px; border-radius:12px; overflow:hidden; background:var(--input-bg); display:flex; align-items:center; justify-content:center; flex-shrink:0; border:2px solid rgba(229,19,101,0.2);">
                ${imgUrl ? `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="opacity:0.3; font-size:0.6rem; text-align:center;">SIN<br>FOTO</span>'}
            </div>
            <!-- Datos -->
            <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:0.4rem;">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:1px; color:var(--primary-red); font-weight:800;">📋 Referencia del Encargo</span>
                    <span style="font-size:0.65rem; padding:2px 8px; background:rgba(229,19,101,0.12); color:var(--primary-red); border-radius:20px; font-weight:700;">Orden #${vData.id.toString().slice(-4)}</span>
                    ${categoria ? `<span style="font-size:0.65rem; padding:2px 8px; background:var(--glass-hover); border-radius:20px; opacity:0.7;">${categoria}</span>` : ''}
                </div>
                <div style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${marca !== 'N/A' ? `<span style="color:var(--primary-red); margin-right:6px;">${marca}</span>` : ''}${pData.nombre_producto || 'Sin nombre'}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.8rem;">
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border); min-width:80px;">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Valor USD</div>
                        <div style="font-size:0.9rem; font-weight:800; color:var(--success-green);">${precioUsdDisplay}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border); min-width:80px;">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Vendido COP</div>
                        <div style="font-size:0.9rem; font-weight:800; color:var(--info-blue);">${precioCop}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Talla</div>
                        <div style="font-size:0.9rem; font-weight:800;">${talla}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Tienda</div>
                        <div style="font-size:0.9rem; font-weight:800;">${tienda}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Marca</div>
                        <div style="font-size:0.9rem; font-weight:800;">${marca}</div>
                    </div>
                </div>
                ${linkCompra ? `<a href="${linkCompra}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; padding:6px 14px; border-radius:8px; background:rgba(6,214,160,0.1); color:var(--success-green); border:1px solid rgba(6,214,160,0.25); text-decoration:none; font-weight:700;">🔗 Abrir URL de Compra</a>` : '<span style="font-size:0.75rem; opacity:0.4;">Sin URL de compra registrada</span>'}
            </div>
        </div>`;
    };

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <h2>Registrar Nueva Compra USA</h2>
                <button class="modal-close-btn" onclick="window.closeModal()">✕</button>
            </div>
            
            <form id="purchase-form" onsubmit="return false;">
                <div class="modal-body">
                    ${queueRestante.length > 0 ? `
                    <div style="display:flex;align-items:center;gap:10px;padding:0.8rem 1.2rem;border-radius:12px;margin-bottom:1.2rem;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.3);">
                        <span style="font-size:1.1rem;">🛒</span>
                        <span style="font-size:0.82rem;color:#7C3AED;font-weight:700;">Compra en lote — al guardar esta, se abrirá automáticamente la siguiente. Quedan ${queueRestante.length} pendiente(s) más de este grupo.</span>
                    </div>` : ''}
                    ${viajeBannerHTML}
                    ${buildEncargoBanner(ventaIdPrefill)}
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
                            <select id="pc-venta-select" onchange="window.updateEncargoBanner(); window.updateViajeBanner();">
                                <option value="">-- Seleccionar Encargo --</option>
                                ${[...encargos].sort((a, b) => (b.comprado_en_viaje ? 1 : 0) - (a.comprado_en_viaje ? 1 : 0)).map(v => {
                                    const prod = productos.find(p => p.id?.toString() === v.producto_id?.toString());
                                    const tag = v.comprado_en_viaje ? '✈️ ' : '🛍️ ';
                                    return `<option value="${v.id}" ${ventaIdPrefill && ventaIdPrefill.toString() === v.id.toString() ? 'selected' : ''}>${tag}${prod ? prod.nombre_producto : 'Prod #'+v.producto_id} — Orden #${v.id.toString().slice(-4)}</option>`;
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
                            <input type="text" id="pc-proveedor" list="pc-tiendas-referencia" placeholder="Ej: Nike.com, FootLocker..." required>
                            <datalist id="pc-tiendas-referencia">${TIENDAS_REFERENCIA.map(t => `<option value="${t}">`).join('')}</datalist>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Costo en USD *</label>
                            <input type="number" id="pc-costo" placeholder="0.00" step="0.01" required>
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
                            <label class="form-label">Estado Inicial</label>
                            <select id="pc-estado">
                                <option value="Comprado en tienda EEUU">Comprado en tienda EEUU</option>
                                <option value="En tránsito USA">En tránsito USA</option>
                                <option value="Bodega USA">Bodega USA</option>
                            </select>
                        </div>

                        ${esViajeCompra ? '' : `
                        <div class="form-group">
                            <label class="form-label">Valor descontado banco (COP)</label>
                            <input type="number" id="pc-costo-cop" placeholder="0" step="1">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Número de Factura *</label>
                            <input type="text" id="pc-num-factura" placeholder="Ej. SHOP-9988" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Código producto en factura (Opcional)</label>
                            <input type="text" id="pc-codigo-factura" placeholder="Ej. SKU-7766">
                        </div>
                        `}
                    </div>

                    ${esViajeCompra ? `
                    <div class="form-group full-width" style="margin-top:1.5rem;">
                        <button type="button" id="btn-campos-adicionales-compra" class="btn-action" style="font-size:0.8rem;padding:8px 16px;" onclick="window.toggleSeccionCamposAdicionalesCompra()">▸ Campos Adicionales</button>
                        <div id="pc-seccion-campos-adicionales" style="display:none;margin-top:12px;">
                            <div class="admin-perms-grid">
                                ${CAMPOS_COMPRA_AGIL.map(c => `
                                <div class="admin-perm-row" id="fila-campo-compra-${c.key}">
                                    <div class="admin-perm-label">
                                        <span class="admin-perm-dot"></span>
                                        <span>${c.label}</span>
                                    </div>
                                    <div class="admin-perm-controls">
                                        <label class="admin-toggle-wrap">
                                            <input type="checkbox" class="chk-campo-compra" value="${c.key}" onchange="window.toggleCampoCompra('${c.key}', this.checked)" />
                                            <span class="admin-toggle-slider"></span>
                                            <span class="admin-toggle-label">Incluido</span>
                                        </label>
                                    </div>
                                </div>`).join('')}
                            </div>
                        </div>
                    </div>
                    <div id="pc-campos-agregados" class="form-grid-3" style="margin-top:1rem;"></div>
                    ` : ''}

                    <div id="pc-error" style="display:none; color:var(--primary-red); background:rgba(229,19,101,0.1); padding:10px; border-radius:8px; font-size:0.85rem; margin-top:1rem; text-align:center; font-weight:600;"></div>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn-action" style="padding:10px 25px;" onclick="window.closeModal()">Cancelar</button>
                    <button type="button" class="btn-primary" style="padding:10px 30px;" onclick="window.submitPurchase()">Guardar Compra</button>
                </div>
            </form>
        </div>`;
    container.style.display = 'flex';

    setTimeout(() => { attachComprobanteInput('comp-purchase-file'); window.updateViajeBanner(); }, 100);

    window.toggleSeccionCamposAdicionalesCompra = () => {
        const el = document.getElementById('pc-seccion-campos-adicionales');
        const btn = document.getElementById('btn-campos-adicionales-compra');
        if (!el) return;
        const showing = el.style.display !== 'none';
        el.style.display = showing ? 'none' : 'block';
        if (btn) btn.textContent = showing ? '▸ Campos Adicionales' : '▾ Campos Adicionales';
    };

    window.togglePurchaseType = () => {
        const tipo = document.getElementById('pc-tipo').value;
        document.getElementById('pc-encargo-section').style.display = tipo === 'encargo' ? '' : 'none';
        document.getElementById('pc-stock-section').style.display = tipo === 'stock' ? '' : 'none';
        if (tipo === 'stock') {
            const banner = document.getElementById('pc-encargo-banner');
            if (banner) banner.style.display = 'none';
        } else {
            window.updateEncargoBanner();
        }
        window.updateViajeBanner();
    };

    // A qué viaje (si aplica) quedará vinculada la compra según lo que el
    // usuario va seleccionando — ver la misma lógica en window.submitPurchase.
    window.updateViajeBanner = () => {
        const banner = document.getElementById('pc-viaje-banner');
        if (!banner) return;
        const tipo = document.getElementById('pc-tipo')?.value;
        const estilo = (bg, border) => { banner.style.background = bg; banner.style.border = `1px solid ${border}`; };

        if (tipo === 'encargo') {
            const ventaId = document.getElementById('pc-venta-select')?.value;
            const ventaTarget = ventaId ? encargos.find(v => v.id.toString() === ventaId) : null;
            if (!ventaTarget) { banner.style.display = 'none'; return; }
            if (ventaTarget.comprado_en_viaje && ventaTarget.viaje_id) {
                const nombreViaje = (_cache?.viajes || []).find(v => v.id?.toString() === ventaTarget.viaje_id.toString())?.nombre || 'un viaje de encargos';
                estilo('rgba(217,119,6,0.08)', 'rgba(217,119,6,0.3)');
                banner.innerHTML = `<span>✈️</span><span style="font-size:0.82rem;color:#D97706;font-weight:700;">Este encargo se tomó "En Viaje USA" — la compra quedará vinculada al viaje: <strong>${nombreViaje}</strong>.</span>`;
            } else {
                estilo('var(--surface-2)', 'var(--border-base)');
                banner.innerHTML = `<span>🛍️</span><span style="font-size:0.82rem;opacity:0.7;font-weight:700;">Este encargo es de Compras Online — la compra se registrará sin vincular a ningún viaje, así haya uno activo ahora.</span>`;
            }
            banner.style.display = 'flex';
        } else {
            if (viajeActivo) {
                estilo('rgba(217,119,6,0.08)', 'rgba(217,119,6,0.3)');
                banner.innerHTML = `<span>✈️</span><span style="font-size:0.82rem;color:#D97706;font-weight:700;">Se asociará automáticamente al viaje activo: <strong>${viajeActivo.nombre}</strong> (${viajeActivo.destino || 'EEUU'}, desde ${viajeActivo.fecha_inicio}).</span>`;
            } else {
                estilo('rgba(239,68,68,0.08)', 'rgba(239,68,68,0.25)');
                banner.innerHTML = `<span>⚠️</span><span style="font-size:0.82rem;color:var(--primary-red);font-weight:700;">No hay un viaje activo en este momento — esta compra se registrará normal, sin vincular a un viaje.</span>`;
            }
            banner.style.display = 'flex';
        }
    };

    window.updateEncargoBanner = () => {
        const ventaId = document.getElementById('pc-venta-select')?.value;
        const bannerEl = document.getElementById('pc-encargo-banner');
        if (!bannerEl) return;
        if (!ventaId) { bannerEl.style.display = 'none'; return; }

        const vData = encargos.find(v => v.id.toString() === ventaId.toString());
        if (!vData) { bannerEl.style.display = 'none'; return; }

        const pData = productos.find(p => p.id?.toString() === vData.producto_id?.toString()) || {};
        const imgUrl = pData.url_imagen || '';
        const linkCompra = pData.link_producto || '';
        const precioUsd = pData.precio_usd || vData.precio_usd_cotizado || '';
        const precioUsdDisplay = precioUsd ? `$${parseFloat(precioUsd).toFixed(2)} USD` : 'N/A';
        const precioCop = vData.valor_total_cop ? formatCOP(vData.valor_total_cop) : 'N/A';
        const talla = pData.talla || 'N/A';
        const tienda = pData.tienda_cotizacion || 'N/A';
        const marca = pData.marca || 'N/A';
        const categoria = pData.categoria || '';

        bannerEl.style.display = 'flex';
        bannerEl.innerHTML = `
            <div style="width:110px; height:110px; border-radius:12px; overflow:hidden; background:var(--input-bg); display:flex; align-items:center; justify-content:center; flex-shrink:0; border:2px solid rgba(229,19,101,0.2);">
                ${imgUrl ? `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="opacity:0.3; font-size:0.6rem; text-align:center;">SIN<br>FOTO</span>'}
            </div>
            <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:0.4rem;">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:1px; color:var(--primary-red); font-weight:800;">📋 Referencia del Encargo</span>
                    <span style="font-size:0.65rem; padding:2px 8px; background:rgba(229,19,101,0.12); color:var(--primary-red); border-radius:20px; font-weight:700;">Orden #${vData.id.toString().slice(-4)}</span>
                    ${categoria ? `<span style="font-size:0.65rem; padding:2px 8px; background:var(--glass-hover); border-radius:20px; opacity:0.7;">${categoria}</span>` : ''}
                </div>
                <div style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${marca !== 'N/A' ? `<span style="color:var(--primary-red); margin-right:6px;">${marca}</span>` : ''}${pData.nombre_producto || 'Sin nombre'}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:0.6rem; margin-bottom:0.8rem;">
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border); min-width:80px;">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Valor USD</div>
                        <div style="font-size:0.9rem; font-weight:800; color:var(--success-green);">${precioUsdDisplay}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border); min-width:80px;">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Vendido COP</div>
                        <div style="font-size:0.9rem; font-weight:800; color:var(--info-blue);">${precioCop}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Talla</div>
                        <div style="font-size:0.9rem; font-weight:800;">${talla}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Tienda</div>
                        <div style="font-size:0.9rem; font-weight:800;">${tienda}</div>
                    </div>
                    <div style="background:var(--surface-2); border-radius:10px; padding:0.5rem 0.8rem; border:1px solid var(--glass-border);">
                        <div style="font-size:0.6rem; opacity:0.5; text-transform:uppercase; margin-bottom:2px;">Marca</div>
                        <div style="font-size:0.9rem; font-weight:800;">${marca}</div>
                    </div>
                </div>
                ${linkCompra ? `<a href="${linkCompra}" target="_blank" style="display:inline-flex; align-items:center; gap:6px; font-size:0.78rem; padding:6px 14px; border-radius:8px; background:rgba(6,214,160,0.1); color:var(--success-green); border:1px solid rgba(6,214,160,0.25); text-decoration:none; font-weight:700;">🔗 Abrir URL de Compra</a>` : '<span style="font-size:0.75rem; opacity:0.4;">Sin URL de compra registrada</span>'}
            </div>`;
    };

    window.submitPurchase = async () => {
        const tipo = document.getElementById('pc-tipo').value;
        const proveedor = document.getElementById('pc-proveedor').value.trim();
        const costo = parseFloat(document.getElementById('pc-costo').value);
        // En modo ágil (viaje activo) estos 3 campos pueden no existir en el
        // DOM si el usuario no los agregó desde "Campos Adicionales".
        const costoCop = parseFloat(document.getElementById('pc-costo-cop')?.value) || 0;
        const compFileInput = document.getElementById('comp-purchase-file');
        const compFile = compFileInput && compFileInput.files[0] ? compFileInput.files[0] : null;
        const fechaComp = document.getElementById('pc-fecha').value;
        const numFact = document.getElementById('pc-num-factura')?.value || '';
        const codFact = document.getElementById('pc-codigo-factura')?.value || '';
        const estado = document.getElementById('pc-estado').value;
        const ventaId = tipo === 'encargo' ? document.getElementById('pc-venta-select').value : null;
        const productoId = tipo === 'stock' ? document.getElementById('pc-producto-select').value : null;

        const errEl = document.getElementById('pc-error');
        if (!proveedor || isNaN(costo) || costo <= 0 || !fechaComp || (!numFact && !esViajeCompra)) {
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
            const comprobanteUrl = compFile ? await uploadImageToSupabase(compFile, 'comprobantes') : "";

            // A qué viaje (si aplica) queda vinculada esta compra:
            // - Encargo cuya venta se registró como "En Viaje USA": hereda el
            //   viaje de esa venta, sin importar si ese viaje sigue activo hoy
            //   — la compra siempre pertenece al mismo viaje que el encargo.
            // - Encargo de "Compras Online" (no fue venta de viaje): nunca se
            //   vincula a un viaje, así haya uno activo en este momento — el
            //   submódulo de Compras en Viaje solo debe recibir lo que vino de
            //   ventas "En Viaje USA".
            // - Stock (sin venta asociada): no hay venta que lo clasifique, así
            //   que se vincula solo si hay un viaje activo ahora mismo.
            let viajeIdCompra = null;
            if (tipo === 'encargo' && ventaId) {
                const ventaTarget = encargos.find(v => v.id.toString() === ventaId);
                if (ventaTarget?.comprado_en_viaje && ventaTarget?.viaje_id) {
                    viajeIdCompra = ventaTarget.viaje_id;
                }
            } else {
                try { const activoAlGuardar = await ViajeService.getActivo(); viajeIdCompra = activoAlGuardar?.id || null; } catch (_) { /* sin viaje activo */ }
            }

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
                estado_compra: estado,
                viaje_id: viajeIdCompra,
                es_viaje: !!viajeIdCompra,
                empresa_id: auth.getEmpresaId()
            };
            if (ventaId) payload.venta_id = ventaId;

            if (tipo === 'encargo' && ventaId) {
                const ventaTarget = encargos.find(v => v.id.toString() === ventaId);
                if (ventaTarget) payload.producto_id = ventaTarget.producto_id;
            } else if (productoId) {
                payload.producto_id = productoId;
            }

            await db.postData('Compras', payload, 'INSERT');

            if (viajeIdCompra) {
                // Best-effort: recalcula de inmediato cómo se reparten los gastos
                // del viaje entre las compras vinculadas. Si falla, la compra ya
                // quedó guardada — no bloquea el flujo.
                try { await db.client.rpc('distribuir_gastos_viaje', { p_viaje_id: viajeIdCompra }); }
                catch (e) { console.warn('[Compras] No se pudo redistribuir gastos del viaje:', e.message); }
            }

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
                        fecha_actualizacion: new Date().toISOString(),
                        empresa_id: auth.getEmpresaId()
                    };
                    await db.postData('Logistica', payloadLogistica, 'INSERT');
                }
            }

            window.closeModal();
            window.invalidateDashCache?.(); // Refrescar alertas del dashboard
            _cache = null;

            // Compra en lote (agrupada por tienda/marca desde la alerta de
            // pendientes): en vez de recargar todo el módulo, se encadena
            // directamente con la siguiente compra pendiente del grupo.
            if (queueRestante.length > 0) {
                showToast(`✅ Compra registrada. Continuando con la siguiente (${queueRestante.length} más)...`);
                setTimeout(() => createPurchaseModal(navigateTo, queueRestante[0], queueRestante.slice(1)), 300);
                return;
            }

            showToast('✅ Compra registrada correctamente.');
            _currentView = 'tabla';
            // Si el modal fue abierto desde el módulo purchases, re-renderiza purchases.
            // Si fue abierto desde otro módulo (ej. dashboard), navega al dashboard para ver las alertas actualizadas.
            if (_renderLayoutFn) {
                renderPurchases(_renderLayoutFn, navigateTo);
            } else {
                navigateTo('dashboard');
            }
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
