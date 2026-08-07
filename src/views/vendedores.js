import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatCOP, showToast, downloadExcel } from '../utils.js';
import { TablaPro } from '../components/tabla-pro.js';

// ─── Cache y estado ────────────────────────────────────────────────────────────
let _venCache = null;
let _venYear = new Date().getFullYear();
let _venMonth = 'todos'; // 'todos' | 1-12
let _venActiveTab = null; // 'general' | id de usuario (vendedor) — null = no inicializado
let _venSelected = new Set(); // ids de ventas seleccionadas para asignación masiva (solo pestaña General)

const MESES_VEN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ─── Date normalizer (DD/MM/YYYY → YYYY-MM-DD) ────────────────────────────────
const normDate = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return s.split('T')[0].split(' ')[0];
};
const _monthYearOf = (fechaRaw) => {
    const iso = normDate(fechaRaw);
    if (!iso) return null;
    const [y, m] = iso.split('-');
    const year = parseInt(y, 10), month = parseInt(m, 10);
    if (!year || !month) return null;
    return { year, month };
};

const _venCanManage = () => auth.isAdmin() || auth.getUserRole() === 'gerente' || auth.getUserRole() === 'finanzas';

function _venEnsureActiveTab() {
    if (_venActiveTab !== null) return;
    _venActiveTab = _venCanManage() ? 'general' : (auth.getProfile()?.id || 'general');
}

function _venComputeIds() {
    const all = _venCache?.ventas || [];
    const analistaFilter = _venActiveTab === 'general' ? null : _venActiveTab;
    return all.filter(v => {
        const my = _monthYearOf(v.fecha);
        if (!my || my.year !== _venYear) return false;
        if (_venMonth !== 'todos' && my.month !== _venMonth) return false;
        if (analistaFilter && v.analista_id?.toString() !== analistaFilter?.toString()) return false;
        return true;
    }).map(v => v.id?.toString());
}

// ─── Main render ───────────────────────────────────────────────────────────────
export const renderVendedores = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Cargando Vendedores...</div>`);

    const [ventasList, comprasList, clientesList, productosList, configList, allUsers] = await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Compras'),
        db.fetchData('Clientes'),
        db.fetchData('Productos'),
        db.fetchData('Configuracion'),
        auth.getAllUsers().catch(() => []),
    ]);
    const ventas    = ventasList?.error ? [] : (ventasList || []);
    const compras   = comprasList?.error ? [] : (comprasList || []);
    const clientes  = clientesList?.error ? [] : (clientesList || []);
    const productos = productosList?.error ? [] : (productosList || []);
    const config    = configList?.error ? [] : (configList || []);
    const vendedores = (Array.isArray(allUsers) ? allUsers : []).filter(u => u.role === 'ventas' && u.is_active !== false);

    _venCache = { ventas, compras, clientes, productos, config, vendedores };
    _venEnsureActiveTab();

    window.setVenAnio = (y) => { _venYear = parseInt(y, 10); _venSelected.clear(); _reloadVenPanel(); };
    window.setVenMes  = (m) => { _venMonth = m === 'todos' ? 'todos' : parseInt(m, 10); _venSelected.clear(); _reloadVenPanel(); };
    window.setVenTab  = (tab) => { _venActiveTab = tab; _venSelected.clear(); _reloadVenPanel(); };

    window.exportVenExcel = () => {
        const cfg      = Array.isArray(_venCache.config) ? _venCache.config : [];
        const pctParam = cfg.find(p => p.clave === 'PctGananciaAnalista');
        const pct      = pctParam ? (parseFloat(pctParam.valor) || 0) : 0;
        const pctDec   = pct / 100;
        const isGeneral = _venActiveTab === 'general';
        const ids      = new Set(_venComputeIds());
        const scoped   = (_venCache.ventas||[]).filter(v => ids.has(v.id?.toString()));

        const exportData = scoped.map(v => {
            const valVenta  = parseFloat(v.valor_total_cop || 0);
            const ganCalc   = parseFloat(v.ganancia_calculada || 0);
            const compra    = (_venCache.compras||[]).find(c => c.id?.toString() === v.compra_id?.toString() || c.venta_id?.toString() === v.id?.toString());
            const cliente   = (_venCache.clientes||[]).find(c => c.id?.toString() === v.cliente_id?.toString());
            const producto  = (_venCache.productos||[]).find(p => p.id?.toString() === v.producto_id?.toString());
            const vendedor  = (_venCache.vendedores||[]).find(u => u.id === v.analista_id);
            const aplica    = v.ganancia_aplica_analista !== false;
            const row = {
                'Fecha': normDate(v.fecha),
                'Orden': `#${v.id.toString().slice(-4)}`,
                'Cliente': cliente?.nombre || 'Sin cliente',
                'Producto': producto?.nombre_producto || 'Sin producto',
                'Tipo Producto': producto?.categoria || 'N/A',
                'Tienda Compra': compra?.proveedor || 'N/A',
                'Valor Venta (COP)': valVenta,
                'G. Calculada (COP)': ganCalc,
                '% Analista': pct,
                'G. Calc. Analista (COP)': aplica ? ganCalc * pctDec : 0,
                'Aplica Analista': aplica ? 'Sí' : 'No',
                'Observaciones': v.observaciones_analista || ''
            };
            if (isGeneral) row['Vendedor'] = vendedor?.full_name || 'Sin asignar';
            return row;
        });
        if (exportData.length === 0) return showToast('No hay ventas para exportar', 'error');
        const mesLbl = _venMonth === 'todos' ? 'Todos' : MESES_VEN[_venMonth-1];
        const tabLbl = isGeneral ? 'General' : ((_venCache.vendedores||[]).find(u=>u.id===_venActiveTab)?.full_name || auth.getUserName() || 'Vendedor').replace(/\s+/g,'_');
        downloadExcel(exportData, `Reporte_Vendedores_${tabLbl}_${_venYear}_${mesLbl}_${new Date().toISOString().split('T')[0]}`);
    };

    const html = `
    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1.5rem; flex-wrap:wrap; gap:15px;">
        <div>
            <span class="page-eyebrow">Comercial · Comisiones</span>
            <h2 class="page-title">Vendedores</h2>
            <p style="opacity:0.5; font-size:0.82rem; margin-top:4px;">Ganancia de analista por vendedor.</p>
        </div>
        <div class="module-filters-bar">
            <button class="btn-excel" onclick="window.exportVenExcel()">📥 Excel</button>
        </div>
    </div>
    <div id="ven-panel">${_renderVenPanelInner()}</div>`;

    renderLayout(html);
    setTimeout(() => _montarTablaVendedores(), 150);
};

function _reloadVenPanel() {
    const panel = document.getElementById('ven-panel');
    if (!panel || !_venCache) return;
    panel.innerHTML = _renderVenPanelInner();
    _montarTablaVendedores();
}

function _renderVenPanelInner() {
    const canManage  = _venCanManage();
    const vendedores = _venCache?.vendedores || [];

    const tabBarHtml = canManage ? `
        <div class="purchase-view-switcher" style="margin-bottom:1rem;flex-wrap:wrap;">
            <button class="pv-tab${_venActiveTab==='general'?' active':''}" onclick="window.setVenTab('general')">🏢 General</button>
            ${vendedores.map(u => `<button class="pv-tab${_venActiveTab===u.id?' active':''}" onclick="window.setVenTab('${u.id}')">${u.full_name||u.email}</button>`).join('')}
        </div>` : '';

    const allVentas = _venCache?.ventas || [];
    const years = [...new Set(allVentas.map(v => _monthYearOf(v.fecha)?.year).filter(Boolean))].sort((a,b)=>b-a);
    if (years.length === 0) years.push(_venYear);
    if (!years.includes(_venYear)) _venYear = years[0];

    const cfg      = Array.isArray(_venCache?.config) ? _venCache.config : [];
    const pctParam = cfg.find(p => p.clave === 'PctGananciaAnalista');
    const pct      = pctParam ? (parseFloat(pctParam.valor) || 0) : 0;
    const pctDec   = pct / 100;

    const idsFiltered   = new Set(_venComputeIds());
    const scoped        = allVentas.filter(v => idsFiltered.has(v.id?.toString()));
    const aplicanScoped = scoped.filter(v => v.ganancia_aplica_analista !== false);
    const totalCalc     = aplicanScoped.reduce((a,v)=>a+parseFloat(v.ganancia_calculada||0)*pctDec,0);

    const tabLabel = _venActiveTab === 'general'
        ? 'General (todos)'
        : (vendedores.find(u => u.id === _venActiveTab)?.full_name || auth.getUserName());

    return `
    <div class="purchase-view-panel">
        ${tabBarHtml}
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:1.2rem;padding:1rem;background:var(--glass-hover);border-radius:14px;border:1px solid var(--glass-border);">
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="font-size:0.78rem;opacity:0.6;">Año</label>
                <select onchange="window.setVenAnio(this.value)" style="background:var(--input-bg);color:var(--text-main);border:1px solid var(--glass-border);border-radius:10px;padding:6px 10px;">
                    ${years.map(y => `<option value="${y}" ${y===_venYear?'selected':''}>${y}</option>`).join('')}
                </select>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
                <button class="pv-tab${_venMonth==='todos'?' active':''}" style="padding:6px 12px;font-size:0.75rem;" onclick="window.setVenMes('todos')">Todos</button>
                ${MESES_VEN.map((m,i) => `<button class="pv-tab${_venMonth===(i+1)?' active':''}" style="padding:6px 12px;font-size:0.75rem;" onclick="window.setVenMes(${i+1})">${m}</button>`).join('')}
            </div>
            <div style="margin-left:auto;font-size:0.82rem;font-weight:700;opacity:0.75;">👤 ${tabLabel}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:1.5rem;">
            <div class="glass-card stamp-card" style="padding:1.2rem;text-align:center;border-left:4px solid var(--success-green);">
                <div style="font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">✅ Ganancia Analista (Calculada)</div>
                <div style="font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:1.4rem;font-weight:900;color:var(--success-green);">${formatCOP(totalCalc)}</div>
                <div style="font-size:0.7rem;opacity:0.5;margin-top:4px;">Basado en ganancia calculada × ${pct}%</div>
            </div>
            <div class="glass-card stamp-card" style="padding:1.2rem;text-align:center;border-left:4px solid var(--warning-orange);">
                <div style="font-size:0.72rem;opacity:0.55;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📋 Ventas que Aplican</div>
                <div style="font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:1.4rem;font-weight:900;color:var(--warning-orange);">${aplicanScoped.length} / ${scoped.length}</div>
                <div style="font-size:0.7rem;opacity:0.5;margin-top:4px;">% Comisión configurado: <strong>${pct}%</strong></div>
            </div>
        </div>
        ${pct === 0 ? `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.4);border-radius:12px;padding:1rem;margin-bottom:1rem;font-size:0.85rem;"><strong>⚠️ Atención:</strong> El porcentaje de ganancia del analista está en 0%. Configúralo en <strong>Parámetros → % Ganancia Analista</strong>.</div>` : ''}
        ${_venActiveTab === 'general' && canManage ? `
        <div id="ven-bulk-bar" style="display:${_venSelected.size>0?'flex':'none'};align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:1rem;padding:0.8rem 1rem;background:rgba(6,214,160,0.08);border:1px solid var(--success-green);border-radius:12px;">
            <strong id="ven-bulk-count" style="font-size:0.85rem;">${_venSelected.size} venta(s) seleccionada(s)</strong>
            <select id="ven-bulk-vendedor-select" style="background:var(--input-bg);color:var(--text-main);border:1px solid var(--glass-border);border-radius:8px;padding:6px 10px;font-size:0.82rem;">
                <option value="">-- Elegir vendedor --</option>
                ${vendedores.map(u => `<option value="${u.id}">${u.full_name||u.email}</option>`).join('')}
            </select>
            <button class="btn-primary" style="padding:6px 14px;font-size:0.8rem;" onclick="window.applyVenBulkAssign()">Asignar</button>
            <button class="btn-secondary" style="padding:6px 14px;font-size:0.8rem;" onclick="window.clearVenSelection()">Cancelar selección</button>
        </div>` : ''}
        <div id="ven-tabla-container"></div>
    </div>
    <style>
        .toggle-switch { position:relative; display:inline-block; width:42px; height:22px; }
        .toggle-switch input { opacity:0; width:0; height:0; }
        .toggle-slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background:var(--glass-border); border-radius:22px; transition:.3s; }
        .toggle-slider:before { position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s; }
        .toggle-switch input:checked + .toggle-slider { background:var(--success-green); }
        .toggle-switch input:checked + .toggle-slider:before { transform:translateX(20px); }
    </style>`;
}

function _montarTablaVendedores() {
    const ids        = _venComputeIds();
    const canManage  = _venCanManage();
    const isGeneral  = _venActiveTab === 'general';
    const vendedores = _venCache?.vendedores || [];
    const cfg        = Array.isArray(_venCache?.config) ? _venCache.config : [];
    const pctParam   = cfg.find(p => p.clave === 'PctGananciaAnalista');
    const pct        = pctParam ? (parseFloat(pctParam.valor) || 0) : 0;

    const columnas = [];

    if (isGeneral && canManage) {
        columnas.push({ key: '_select',
          label: `<input type="checkbox" title="Seleccionar todas las visibles" onchange="window.selectAllVenVisible(this.checked)">`,
          width: '40px', sortable: false,
          render: (v, row) => `<input type="checkbox" class="ven-bulk-check" data-id="${row.id}" ${_venSelected.has(row.id?.toString())?'checked':''} onchange="window.toggleVenSelect('${row.id}', this.checked)">` });
    }

    columnas.push(
        { key: 'fecha', label: 'Fecha', width: '110px', render: (v) => normDate(v) || 'N/A' },
        { key: 'cliente_nombre', label: 'Venta', width: '190px',
          render: (v, row) => `<div style="cursor:pointer;" onclick="window.modalDetalleVentaGlobal('${row.id}')" title="Ver ficha completa de la venta">
                <div class="cell-title">Orden #${row.id.toString().slice(-4)}</div>
                <span class="cell-subtitle">${row.producto_nombre||'Sin producto'} · ${v||'Sin cliente'}</span>
            </div>` },
        { key: 'producto_categoria', label: 'Tipo Producto', width: '130px', render: (v) => `🏷️ ${v||'N/A'}` },
        { key: 'compra_proveedor', label: 'Tienda Compra', width: '130px', render: (v) => `🏪 ${v||'N/A'}` },
        { key: 'valor_total_cop', label: 'Valor Venta', width: '150px', render: (v) => `<span class="cell-price">${formatCOP(parseFloat(v||0))}</span>` },
        { key: 'ganancia_calculada', label: 'G. Calculada', width: '150px', render: (v) => `<span style="color:var(--info-blue);">${formatCOP(parseFloat(v||0))}</span>` },
        { key: '_pct', label: '% Analista', width: '90px', sortable: false,
          render: () => `<span style="color:var(--warning-orange);font-weight:700;">${pct}%</span>` },
        { key: 'ganancia_calc_analista', label: 'G. Calc. Analista', width: '150px',
          render: (v, row) => row.ganancia_aplica_analista !== false ? `<span style="color:var(--info-blue);">${formatCOP(parseFloat(v||0))}</span>` : '—' },
    );

    if (isGeneral && canManage) {
        columnas.push({ key: 'analista_id', label: 'Vendedor', width: '160px', sortable: false,
          render: (v, row) => `
            <select onchange="window.assignVendedor('${row.id}', this.value)"
                style="background:var(--input-bg);color:var(--text-main);border:1px solid var(--glass-border);border-radius:8px;padding:5px 8px;font-size:0.76rem;">
                <option value="">Sin asignar</option>
                ${vendedores.map(u => `<option value="${u.id}" ${v===u.id?'selected':''}>${u.full_name||u.email}</option>`).join('')}
            </select>` });
    }

    columnas.push({ key: 'ganancia_aplica_analista', label: 'Aplica Analista', width: '110px',
      render: (v, row) => (canManage && isGeneral) ? `
        <label class="toggle-switch" style="margin:0;" title="${v!==false?'Desactivar':'Activar'} para suma de analista">
            <input type="checkbox" ${v!==false?'checked':''} onchange="window.toggleAplicaVendedor('${row.id}', this.checked)">
            <span class="toggle-slider"></span>
        </label>` : (v !== false ? '✅' : '❌')
    });

    columnas.push({ key: 'observaciones_analista', label: 'Observaciones', width: '190px',
      render: (v, row) => {
          if (canManage && isGeneral) {
              return `<input type="text" class="gan-obs-input" value="${(v||'').replace(/"/g,'&quot;')}" ${row.ganancia_aplica_analista!==false?'disabled':''}
                  placeholder="${row.ganancia_aplica_analista!==false?'Solo aplica si no cuenta para el analista':'Motivo de exclusión...'}"
                  style="width:100%;min-width:150px;font-size:0.78rem;padding:6px 8px;border-radius:8px;border:1px solid var(--glass-border);background:${row.ganancia_aplica_analista!==false?'var(--glass-hover)':'var(--glass-bg)'};color:var(--text-main);"
                  onchange="window.updateObservacionVendedor('${row.id}', this.value)">`;
          }
          return v ? `<span style="font-size:0.78rem;opacity:0.8;">${v}</span>` : '<span style="opacity:0.3;">—</span>';
      }
    });

    new TablaPro({
        containerId: 'ven-tabla-container',
        tabla: 'ventas_finanzas_view',
        supabase: db.client,
        filtrosExtra: { id: { op: 'in', value: ids.length ? ids : ['__none__'] } },
        searchColumns: ['cliente_nombre', 'producto_nombre', 'producto_categoria', 'compra_proveedor', 'observaciones_analista', 'analista_nombre'],
        columnas,
        altura: '60vh',
    }).mount();
}

function _updateVenBulkBar() {
    const bar = document.getElementById('ven-bulk-bar');
    if (!bar) return;
    bar.style.display = _venSelected.size > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('ven-bulk-count');
    if (countEl) countEl.textContent = `${_venSelected.size} venta(s) seleccionada(s)`;
}

window.toggleVenSelect = (ventaId, checked) => {
    if (checked) _venSelected.add(ventaId.toString());
    else _venSelected.delete(ventaId.toString());
    _updateVenBulkBar();
};

window.selectAllVenVisible = (checked) => {
    document.querySelectorAll('.ven-bulk-check').forEach(el => {
        el.checked = checked;
        if (checked) _venSelected.add(el.dataset.id);
        else _venSelected.delete(el.dataset.id);
    });
    _updateVenBulkBar();
};

window.clearVenSelection = () => {
    _venSelected.clear();
    document.querySelectorAll('.ven-bulk-check').forEach(el => { el.checked = false; });
    _updateVenBulkBar();
};

window.applyVenBulkAssign = async () => {
    const sel = document.getElementById('ven-bulk-vendedor-select');
    const vendedorId = sel?.value || '';
    if (!vendedorId) return showToast('Selecciona un vendedor', 'error');
    if (_venSelected.size === 0) return showToast('No hay ventas seleccionadas', 'error');

    const ids = [..._venSelected];
    let ok = 0, fail = 0;
    for (const ventaId of ids) {
        const v = _venCache.ventas.find(x => x.id?.toString() === ventaId);
        if (!v) continue;
        v.analista_id = vendedorId;
        try {
            await db.postData('Ventas', v, 'UPDATE');
            ok++;
        } catch(e) {
            fail++;
        }
    }
    showToast(`✅ ${ok} venta(s) reasignada(s)` + (fail ? ` — ${fail} con error` : ''));
    _venSelected.clear();
    _reloadVenPanel();
};

window.assignVendedor = async (ventaId, userId) => {
    if (!_venCache) return;
    const v = _venCache.ventas.find(x => x.id?.toString() === ventaId?.toString());
    if (!v) return;
    v.analista_id = userId || null;
    try {
        await db.postData('Ventas', v, 'UPDATE');
        showToast('✅ Vendedor asignado');
    } catch(e) {
        showToast('No se pudo guardar: ' + e.message, 'error');
    }
    _reloadVenPanel();
};

window.toggleAplicaVendedor = async (ventaId, checked) => {
    if (!_venCache) return;
    const v = _venCache.ventas.find(x => x.id?.toString() === ventaId?.toString());
    if (!v) return;
    v.ganancia_aplica_analista = checked;
    try {
        await db.postData('Ventas', v, 'UPDATE');
        showToast(checked ? '✅ Venta incluida para analista' : '❌ Venta excluida de analista');
    } catch(e) {
        showToast('No se pudo guardar: ' + e.message, 'error');
    }
    _reloadVenPanel();
};

window.updateObservacionVendedor = async (ventaId, texto) => {
    if (!_venCache) return;
    const v = _venCache.ventas.find(x => x.id?.toString() === ventaId?.toString());
    if (!v) return;
    v.observaciones_analista = texto;
    try {
        await db.postData('Ventas', v, 'UPDATE');
    } catch(e) {
        showToast('No se pudo guardar: ' + e.message, 'error');
    }
};
