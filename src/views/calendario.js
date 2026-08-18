/**
 * calendario.js — Módulo "Calendario de Contenido"
 * Vista mensual + vista lista, panel de detalle lateral y formulario CRUD.
 * Tabla Supabase: ContenidoCalendario.
 */
import { auth } from '../auth.js';
import { showToast, renderError } from '../utils.js';
import {
  CalendarioService, CATEGORIAS, CATEGORIA_LABELS, CATEGORIA_COLORS,
  CANALES, CANAL_LABELS, CANAL_GRIS, ESTADOS, ESTADO_LABELS, ESTADO_BADGE_COLORS,
  colorDePublicacion, requiereAtencion, esPublicadoTarde, esVencidoSinPublicar, puedeMarcarPublicado
} from '../services/calendarioContenido.js';
import {
  PlantillaService, DIAS_SEMANA_FULL, TIPOS_CONTENIDO, TIPO_CONTENIDO_LABELS,
  diaSemanaDeFecha, esFueraDePlantilla
} from '../services/plantillaSemanal.js';

// ── Estado del módulo ───────────────────────────────────────────────────────────
let _calCache = [];
let _calPlantillaCache = [];
let _calView = 'calendario'; // 'calendario' | 'lista' | 'plantilla'
let _calYear = null;
let _calMonth = null; // 0-11
let _calSelectedDate = null; // 'YYYY-MM-DD'
let _calSelectedItemId = null;
let _calListFiltroCategoria = 'todas';
let _calListFiltroEstado = 'todos';
let _calListFiltroVencidos = false;
let _calModalTags = [];
let _calReprogramarId = null;
let _renderLayout = null;
let _navigateTo = null;

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_SEMANA = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

// ── Helpers ──────────────────────────────────────────────────────────────────────
const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const dateStrOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const parseDateStr = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m: (m || 1) - 1, d: d || 1 };
};
const formatFechaLarga = (s) => {
  if (!s) return 'Sin fecha';
  const { y, m, d } = parseDateStr(s);
  const dt = new Date(y, m, d);
  const diaSemana = DIAS_SEMANA[(dt.getDay() + 6) % 7];
  return `${diaSemana} ${d} de ${MESES[m]} ${y}`;
};
const formatFechaCorta = (s) => {
  if (!s) return '—';
  const { y, m, d } = parseDateStr(s);
  return `${pad2(d)}/${pad2(m + 1)}/${y}`;
};

const categoriaChipHTML = (categoria) => {
  const color = CATEGORIA_COLORS[categoria] || '#64748B';
  return `<span class="cal-chip" style="background:${color};color:#fff;border-color:${color};">${escapeHtml(CATEGORIA_LABELS[categoria] || categoria || '—')}</span>`;
};

const estadoBadgeHTML = (estado) => {
  const c = ESTADO_BADGE_COLORS[estado] || ESTADO_BADGE_COLORS.idea;
  return `<span class="status-badge" style="background:${c.bg};color:${c.text};">${escapeHtml(ESTADO_LABELS[estado] || estado || '—')}</span>`;
};

const shouldShowGuionParaTipo = (tipo) => /reel|histor|story/i.test(tipo || '');

const checklistItemHTML = (label, checked) => `
  <div class="cal-check-item ${checked ? 'ok' : 'pending'}">
    <span class="cal-check-icon">${checked ? '✓' : '○'}</span>
    <span>${label}</span>
  </div>`;

function _calItemsByDate() {
  const map = {};
  for (const it of _calCache) {
    const key = String(it.fecha || '').slice(0, 10);
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(it);
  }
  Object.values(map).forEach(arr => arr.sort((a, b) => String(a.hora || '').localeCompare(String(b.hora || ''))));
  return map;
}

function _plantillaPorDia() {
  const map = {};
  for (const p of _calPlantillaCache) map[p.dia_semana] = p;
  return map;
}

// ── Estilos (inyectados una sola vez) ────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('cal-contenido-styles')) return;
  const s = document.createElement('style');
  s.id = 'cal-contenido-styles';
  s.textContent = `
    .cal-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:1rem; }
    .cal-body { display:grid; grid-template-columns: 1fr 380px; gap:1.25rem; align-items:start; }
    @media (max-width: 1100px) { .cal-body { grid-template-columns: 1fr; } }
    .cal-grid-wrap { padding:1.25rem; }
    .cal-nav { display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem; gap:10px; }
    .cal-nav-title { font-size:1.05rem; font-weight:800; letter-spacing:-0.3px; color:var(--text-main); text-transform:capitalize; }
    .cal-legend { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid var(--border-base); }
    .cal-legend-item { display:flex; align-items:center; gap:5px; font-size:0.66rem; color:var(--text-muted); font-weight:600; white-space:nowrap; }
    .cal-legend-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .cal-grid-weekdays { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; margin-bottom:6px; }
    .cal-weekday { text-align:center; font-size:0.64rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-faint); padding:4px 0; }
    .cal-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
    .cal-day { min-height:92px; min-width:0; background:var(--surface-1); border:1px solid var(--border-base); border-radius:10px; padding:6px; cursor:pointer; transition:all 0.15s ease; display:flex; flex-direction:column; gap:4px; position:relative; overflow:hidden; }
    .cal-day:hover { background:var(--surface-2); border-color:var(--border-strong); }
    .cal-day-outside { background:transparent; border:1px solid transparent; cursor:default; opacity:0.32; min-height:92px; min-width:0; padding:6px; }
    .cal-day-outside .cal-day-num { color:var(--text-faint); font-size:0.78rem; }
    .cal-day-today { border-color:var(--primary); box-shadow:0 0 0 1px var(--primary) inset; }
    .cal-day-selected { background:var(--brand-magenta-dim); border-color:var(--primary); }
    .cal-day-head { display:flex; align-items:center; justify-content:space-between; }
    .cal-day-num { font-size:0.78rem; font-weight:700; color:var(--text-main); }
    .cal-day-dot { width:8px; height:8px; border-radius:50%; background:#EF4444; box-shadow:0 0 0 2px var(--surface-1); flex-shrink:0; }
    .cal-day-pills { display:flex; flex-direction:column; gap:3px; overflow:hidden; min-width:0; }
    .cal-pill { min-width:0; max-width:100%; box-sizing:border-box; color:#fff; font-size:0.58rem; font-weight:700; padding:2px 6px; border-radius:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .cal-pill-more { background:var(--surface-3) !important; color:var(--text-muted) !important; }

    .cal-panel { padding:1.25rem; min-height:200px; position:sticky; top:1rem; }
    .cal-panel-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; padding:2.5rem 1rem; text-align:center; color:var(--text-faint); font-size:0.85rem; }
    .cal-panel-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:1rem; gap:8px; }
    .cal-panel-date { font-size:1rem; font-weight:800; color:var(--text-main); text-transform:capitalize; }
    .cal-panel-count { font-size:0.72rem; color:var(--text-faint); margin-top:2px; }
    .cal-panel-newbtn { width:100%; margin-top:1rem; }

    .cal-item-list { display:flex; flex-direction:column; gap:8px; }
    .cal-item-row { display:flex; align-items:center; gap:10px; padding:10px; border-radius:10px; background:var(--surface-1); border:1px solid var(--border-base); cursor:pointer; transition:all 0.15s; }
    .cal-item-row:hover { background:var(--surface-2); }
    .cal-item-row-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
    .cal-item-row-main { flex:1; min-width:0; }
    .cal-item-row-title { font-size:0.82rem; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .cal-item-row-sub { font-size:0.68rem; color:var(--text-faint); margin-top:2px; }

    .cal-back-btn { background:none; border:none; color:var(--text-muted); font-size:0.76rem; font-weight:600; cursor:pointer; padding:0 0 1rem; text-align:left; }
    .cal-back-btn:hover { color:var(--primary); }

    .cal-detail { display:flex; flex-direction:column; gap:1rem; }
    .cal-detail-top { display:flex; flex-direction:column; gap:8px; padding-bottom:1rem; border-bottom:1px solid var(--border-base); }
    .cal-detail-chips { display:flex; flex-wrap:wrap; gap:6px; }
    .cal-detail-meta { display:flex; flex-wrap:wrap; gap:12px; font-size:0.74rem; color:var(--text-muted); }
    .cal-detail-hook { font-size:0.95rem; font-weight:700; color:var(--text-main); line-height:1.4; }
    .cal-detail-block label { display:block; font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-faint); margin-bottom:4px; }
    .cal-detail-block p { font-size:0.85rem; color:var(--text-main); line-height:1.5; margin:0; }
    .cal-detail-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
    .cal-detail-code { font-family:var(--font-mono); background:var(--surface-2); display:inline-block; padding:4px 10px; border-radius:6px; }
    .cal-detail-cta { background:#0E1420; color:#fff; padding:14px 16px; border-radius:12px; font-size:0.85rem; font-weight:600; line-height:1.4; }
    .cal-detail-actions { display:flex; gap:10px; padding-top:1rem; border-top:1px solid var(--border-base); margin-top:0.25rem; }

    .cal-chip { display:inline-flex; align-items:center; padding:4px 10px; border-radius:20px; font-size:0.66rem; font-weight:700; border:1px solid; white-space:nowrap; }
    .cal-chip-canal { background:var(--surface-2); color:var(--text-muted); border-color:var(--border-base); }

    .cal-tags { display:flex; flex-wrap:wrap; gap:6px; }
    .cal-tag { background:var(--surface-2); border:1px solid var(--border-base); color:var(--text-main); font-size:0.72rem; font-weight:600; padding:4px 10px; border-radius:20px; display:inline-flex; align-items:center; gap:6px; }
    .cal-tag-removable button { background:none; border:none; color:var(--text-faint); cursor:pointer; font-size:0.9rem; line-height:1; padding:0; }
    .cal-tag-removable button:hover { color:var(--danger); }

    .cal-checklist { display:flex; flex-direction:column; gap:6px; padding:12px 14px; background:var(--surface-1); border:1px solid var(--border-base); border-radius:12px; }
    .cal-check-item { display:flex; align-items:center; gap:8px; font-size:0.8rem; font-weight:600; color:var(--text-muted); }
    .cal-check-item.ok { color:var(--success); }
    .cal-check-item.ok .cal-check-icon { background:var(--success); color:#fff; }
    .cal-check-item.pending .cal-check-icon { background:var(--surface-3); color:var(--text-faint); }
    .cal-check-icon { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:0.68rem; font-weight:800; flex-shrink:0; }

    .cal-tags-input { display:flex; flex-wrap:wrap; gap:6px; align-items:center; background:var(--input-bg); border:1px solid var(--border-base); border-radius:12px; padding:8px 10px; }
    .cal-tags-chips { display:flex; flex-wrap:wrap; gap:6px; }
    .cal-tags-input input { border:none !important; background:transparent !important; flex:1; min-width:140px; padding:4px !important; }
    .cal-tags-input input:focus { box-shadow:none !important; }

    .cal-reminder-notice { display:none; align-items:flex-start; gap:8px; background:var(--warning-dim); border:1px solid var(--warning); border-radius:10px; padding:10px 14px; font-size:0.78rem; color:var(--text-main); line-height:1.4; }

    .cal-list-filters { display:flex; gap:10px; margin-bottom:1rem; flex-wrap:wrap; }
    .cal-list-filters select { width:auto; min-width:180px; }

    .cal-checkbox-row { display:flex; align-items:center; gap:8px; }
    .cal-checkbox-row input[type=checkbox] { width:auto; accent-color:var(--primary); }
    .cal-checkbox-row label { margin:0; }

    .cal-quick-filter { display:inline-flex; align-items:center; gap:6px; background:var(--surface-2); border:1px solid var(--border-base); color:var(--text-muted); padding:8px 14px; border-radius:10px; font-family:var(--font); font-size:0.8rem; font-weight:600; cursor:pointer; transition:all 0.15s; }
    .cal-quick-filter:hover { border-color:var(--danger); color:var(--danger); }
    .cal-quick-filter.active { background:var(--danger-dim); border-color:var(--danger); color:var(--danger); }

    .cal-tag-late { display:inline-block; margin-top:3px; background:#FDF3E3; color:#B7791F; font-size:0.62rem; font-weight:700; padding:2px 8px; border-radius:20px; white-space:nowrap; }
    .cal-badge-reprog { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:20px; padding:0 6px; background:var(--surface-3); color:var(--text-muted); border-radius:20px; font-size:0.7rem; font-weight:700; }
    .cal-row-vencida td { background:var(--danger-dim); }

    .modal-content.modal-narrow { max-width:420px; }
  `;
  document.head.appendChild(s);
}

// ── Entry point ───────────────────────────────────────────────────────────────
export const renderCalendarioContenido = async (renderLayout, navigateTo) => {
  _renderLayout = renderLayout;
  _navigateTo = navigateTo;

  if (!auth.canAccess('calendario_ver')) { navigateTo('dashboard'); return; }

  injectStyles();
  renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Cargando Calendario de Contenido...</div>`);

  if (_calYear == null) {
    const today = new Date();
    _calYear = today.getFullYear();
    _calMonth = today.getMonth();
  }

  try {
    [_calCache, _calPlantillaCache] = await Promise.all([CalendarioService.fetchAll(), PlantillaService.fetchAll()]);
  } catch (err) {
    renderError(renderLayout, err.message, navigateTo);
    return;
  }

  renderMain();
};

function renderViewContent() {
  if (_calView === 'lista') return renderListView();
  if (_calView === 'plantilla') return renderPlantillaView();
  return renderCalendarBody();
}

function renderMain() {
  const html = `
    <div style="margin-bottom:1.25rem;">
      <span class="page-eyebrow">Marketing · Redes Sociales</span>
      <h2 class="page-title">Calendario de Contenido</h2>
    </div>
    <div id="cal-content">${renderViewContent()}</div>
  `;
  _renderLayout(html);
}

function _reloadCalContent() {
  const el = document.getElementById('cal-content');
  if (!el) { renderMain(); return; }
  el.innerHTML = renderViewContent();
}

async function _calReload() {
  try {
    _calCache = await CalendarioService.fetchAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
  _reloadCalContent();
}

async function _calReloadPlantilla() {
  try {
    _calPlantillaCache = await PlantillaService.fetchAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
  _reloadCalContent();
}

function renderToolbar() {
  const canCrear = auth.canAccess('calendario_crear');
  return `
    <div class="cal-toolbar">
      <div class="purchase-view-switcher">
        <button class="pv-tab ${_calView === 'calendario' ? 'active' : ''}" onclick="window.calSetView('calendario')">📅 Calendario</button>
        <button class="pv-tab ${_calView === 'lista' ? 'active' : ''}" onclick="window.calSetView('lista')">📋 Lista</button>
        <button class="pv-tab ${_calView === 'plantilla' ? 'active' : ''}" onclick="window.calSetView('plantilla')">🗂️ Plantilla Semanal</button>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        ${(_calView === 'calendario' && canCrear) ? `<button class="btn-secondary" onclick="window.calGenerarDesdePlantilla()">Generar mes desde plantilla</button>` : ''}
        ${canCrear ? `<button class="btn-primary" onclick="window.calOpenModal()">+ Nueva publicación</button>` : ''}
      </div>
    </div>
  `;
}

// ── Vista mensual ─────────────────────────────────────────────────────────────
function renderCalendarBody() {
  return `
    ${renderToolbar()}
    <div class="cal-body">
      <div class="cal-grid-wrap glass-card">
        <div class="cal-nav">
          <button class="btn-action" onclick="window.calNavMonth(-1)">‹ Anterior</button>
          <div class="cal-nav-title">${MESES[_calMonth]} ${_calYear}</div>
          <button class="btn-action" onclick="window.calNavMonth(1)">Siguiente ›</button>
        </div>
        <div class="cal-legend">
          ${CATEGORIAS.map(c => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${CATEGORIA_COLORS[c]}"></span>${CATEGORIA_LABELS[c]}</span>`).join('')}
          <span class="cal-legend-item"><span class="cal-legend-dot" style="background:${CANAL_GRIS}"></span>WhatsApp Grupo</span>
        </div>
        ${buildMonthGrid(_calYear, _calMonth)}
      </div>
      <div class="cal-panel glass-card" id="cal-panel">
        ${renderPanelContent()}
      </div>
    </div>
  `;
}

function buildMonthGrid(year, month) {
  const itemsByDate = _calItemsByDate();
  const firstOfMonth = new Date(year, month, 1);
  const leading = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
  const todayStr = new Date().toISOString().slice(0, 10);

  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - leading + 1;
    let cellYear = year, cellMonth = month, dayNum, inMonth = true;
    if (dayOffset < 1) {
      dayNum = daysInPrevMonth + dayOffset;
      cellMonth = month - 1; if (cellMonth < 0) { cellMonth = 11; cellYear--; }
      inMonth = false;
    } else if (dayOffset > daysInMonth) {
      dayNum = dayOffset - daysInMonth;
      cellMonth = month + 1; if (cellMonth > 11) { cellMonth = 0; cellYear++; }
      inMonth = false;
    } else {
      dayNum = dayOffset;
    }
    const dateStr = dateStrOf(cellYear, cellMonth, dayNum);
    const dayItems = inMonth ? (itemsByDate[dateStr] || []) : [];
    cells += dayCellHTML(dateStr, dayNum, inMonth, dayItems, dateStr === todayStr, dateStr === _calSelectedDate);
  }

  return `
    <div class="cal-grid-weekdays">${DIAS_SEMANA.map(d => `<div class="cal-weekday">${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
  `;
}

function dayCellHTML(dateStr, dayNum, inMonth, items, isToday, isSelected) {
  if (!inMonth) {
    return `<div class="cal-day cal-day-outside"><span class="cal-day-num">${dayNum}</span></div>`;
  }
  const hasAlert = items.some(requiereAtencion);
  const plantillaDia = _plantillaPorDia()[diaSemanaDeFecha(dateStr)];
  const hasFueraDePlantilla = items.some(it => esFueraDePlantilla(it, plantillaDia));
  const visible = items.slice(0, 2);
  const extra = items.length - visible.length;
  return `
    <div class="cal-day ${isToday ? 'cal-day-today' : ''} ${isSelected ? 'cal-day-selected' : ''}" onclick="window.calSelectDay('${dateStr}')">
      <div class="cal-day-head">
        <span class="cal-day-num">${dayNum}</span>
        <span style="display:flex; align-items:center; gap:4px;">
          ${hasFueraDePlantilla ? '<span title="Fuera de plantilla" style="font-size:0.72rem;">⚠</span>' : ''}
          ${hasAlert ? '<span class="cal-day-dot" title="Requiere atención: link o código sin verificar"></span>' : ''}
        </span>
      </div>
      <div class="cal-day-pills">
        ${visible.map(it => `<div class="cal-pill" style="background:${colorDePublicacion(it)}">${it.hora ? escapeHtml(String(it.hora).slice(0, 5)) + ' ' : ''}${escapeHtml(it.hook || CATEGORIA_LABELS[it.categoria] || 'Publicación')}</div>`).join('')}
        ${extra > 0 ? `<div class="cal-pill cal-pill-more">+${extra} más</div>` : ''}
      </div>
    </div>
  `;
}

function renderPanelContent() {
  if (!_calSelectedDate) {
    return `<div class="cal-panel-empty">
      <div style="font-size:2rem;">🗓️</div>
      <p>Selecciona un día en el calendario para ver el detalle de sus publicaciones.</p>
    </div>`;
  }

  const items = _calItemsByDate()[_calSelectedDate] || [];
  const canCrear = auth.canAccess('calendario_crear');
  const header = `
    <div class="cal-panel-header">
      <div>
        <div class="cal-panel-date">${formatFechaLarga(_calSelectedDate)}</div>
        <div class="cal-panel-count">${items.length} publicación${items.length === 1 ? '' : 'es'}</div>
      </div>
      <button class="modal-close" style="width:30px;height:30px;font-size:1.1rem;" onclick="window.calClosePanel()">&times;</button>
    </div>
  `;
  const newBtn = canCrear ? `<button class="btn-primary cal-panel-newbtn" onclick="window.calOpenModal(null,'${_calSelectedDate}')">+ Nueva publicación este día</button>` : '';

  if (items.length === 0) {
    return `${header}<div class="cal-panel-empty"><p>No hay publicaciones este día.</p></div>${newBtn}`;
  }

  if (items.length > 1 && !_calSelectedItemId) {
    return `${header}<div class="cal-item-list">${items.map(it => renderItemRow(it)).join('')}</div>${newBtn}`;
  }

  const item = items.find(it => String(it.id) === String(_calSelectedItemId)) || items[0];
  const backBtn = items.length > 1 ? `<button class="cal-back-btn" onclick="window.calBackToList()">← Volver a la lista (${items.length})</button>` : '';
  return `${header}${backBtn}${renderItemDetail(item)}${newBtn}`;
}

function renderItemRow(it) {
  const alert = requiereAtencion(it);
  return `
    <div class="cal-item-row" onclick="window.calSelectItem('${it.id}')">
      <span class="cal-item-row-dot" style="background:${colorDePublicacion(it)}"></span>
      <div class="cal-item-row-main">
        <div class="cal-item-row-title">${escapeHtml(it.hook || CATEGORIA_LABELS[it.categoria] || 'Publicación')}</div>
        <div class="cal-item-row-sub">${it.hora ? escapeHtml(String(it.hora).slice(0, 5)) : '--:--'} · ${escapeHtml(CANAL_LABELS[it.canal] || it.canal || '')}</div>
      </div>
      ${alert ? '<span class="cal-day-dot" style="position:static;flex-shrink:0;" title="Requiere atención"></span>' : ''}
    </div>
  `;
}

function renderItemDetail(item) {
  const canEditar = auth.canAccess('calendario_editar');
  const canEliminar = auth.canAccess('calendario_eliminar');
  const tags = Array.isArray(item.marcas_productos) ? item.marcas_productos : [];

  return `
    <div class="cal-detail">
      <div class="cal-detail-top">
        <div class="cal-detail-chips">
          ${categoriaChipHTML(item.categoria)}
          <span class="cal-chip cal-chip-canal">${escapeHtml(CANAL_LABELS[item.canal] || item.canal || '—')}</span>
          ${estadoBadgeHTML(item.estado)}
        </div>
        <div class="cal-detail-meta">
          <span>📅 ${formatFechaLarga(item.fecha)}</span>
          ${item.hora ? `<span>🕐 ${escapeHtml(String(item.hora).slice(0, 5))}</span>` : ''}
          ${item.tipo_contenido ? `<span>🏷️ ${escapeHtml(item.tipo_contenido)}</span>` : ''}
        </div>
      </div>

      ${item.hook ? `<div class="cal-detail-hook">${escapeHtml(item.hook)}</div>` : ''}
      ${item.guion ? `<div class="cal-detail-block"><label>Guion</label><p>${escapeHtml(item.guion).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${item.copy_final ? `<div class="cal-detail-block"><label>Copy final</label><p>${escapeHtml(item.copy_final).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${item.cta ? `<div class="cal-detail-cta">${escapeHtml(item.cta)}</div>` : ''}

      <div class="cal-detail-block">
        <label>Marcas / Productos</label>
        <div class="cal-tags">${tags.length ? tags.map(t => `<span class="cal-tag">${escapeHtml(t)}</span>`).join('') : '<span class="text-faint">Sin registrar</span>'}</div>
      </div>

      ${item.assets_necesarios ? `<div class="cal-detail-block"><label>Assets necesarios</label><p>${escapeHtml(item.assets_necesarios).replace(/\n/g, '<br>')}</p></div>` : ''}

      <div class="cal-detail-grid2">
        <div class="cal-detail-block"><label>Responsable</label><p>${item.responsable ? escapeHtml(item.responsable) : '<span class="text-faint">Sin asignar</span>'}</p></div>
        <div class="cal-detail-block"><label>Fecha límite de entrega</label><p>${item.fecha_limite_entrega ? formatFechaCorta(item.fecha_limite_entrega) : '<span class="text-faint">Sin definir</span>'}</p></div>
      </div>

      ${item.codigo_descuento ? `<div class="cal-detail-block"><label>Código de descuento</label><p class="cal-detail-code">${escapeHtml(item.codigo_descuento)}</p></div>` : ''}

      <div class="cal-checklist">
        ${checklistItemHTML('Link verificado', item.link_verificado)}
        ${item.codigo_descuento ? checklistItemHTML('Código de descuento verificado', item.codigo_verificado) : ''}
        ${checklistItemHTML('Reglas de marca revisadas', item.reglas_marca_revisadas)}
      </div>

      <div class="cal-detail-actions">
        ${canEditar ? `<button class="btn-primary" onclick="window.calOpenModal('${item.id}')">✏️ Editar</button>` : ''}
        ${canEliminar ? `<button class="btn-secondary" onclick="window.calEliminar('${item.id}')">🗑️ Eliminar</button>` : ''}
      </div>
    </div>
  `;
}

// ── Vista Plantilla Semanal ──────────────────────────────────────────────────────
function renderPlantillaView() {
  const canEditar = auth.canAccess('calendario_plantilla_editar');
  const porDia = _plantillaPorDia();

  const rows = DIAS_SEMANA_FULL.map((label, dia) => {
    const p = porDia[dia] || { canal: CANALES[0], categoria_sugerida: CATEGORIAS[0], tipo_contenido_sugerido: TIPOS_CONTENIDO[0], notas: '', activo: false };

    if (!canEditar) {
      return `
        <tr>
          <td style="font-weight:700;">${label}</td>
          <td>${escapeHtml(CANAL_LABELS[p.canal] || p.canal || '—')}</td>
          <td>${categoriaChipHTML(p.categoria_sugerida)}</td>
          <td>${escapeHtml(TIPO_CONTENIDO_LABELS[p.tipo_contenido_sugerido] || p.tipo_contenido_sugerido || '—')}</td>
          <td>${escapeHtml(p.notas || '—')}</td>
          <td><span class="status-badge" style="background:${p.activo ? '#E7F6EF' : '#E2E8F0'};color:${p.activo ? '#1B8A5A' : '#475569'};">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        </tr>`;
    }

    return `
      <tr>
        <td style="font-weight:700; white-space:nowrap;">${label}</td>
        <td>
          <select id="plantilla-canal-${dia}">
            ${CANALES.map(c => `<option value="${c}" ${p.canal === c ? 'selected' : ''}>${CANAL_LABELS[c]}</option>`).join('')}
          </select>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <span id="plantilla-dot-${dia}" style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${CATEGORIA_COLORS[p.categoria_sugerida] || '#64748B'};"></span>
            <select id="plantilla-categoria-${dia}" onchange="document.getElementById('plantilla-dot-${dia}').style.background = ({${CATEGORIAS.map(c => `${c}:'${CATEGORIA_COLORS[c]}'`).join(',')}})[this.value] || '#64748B';">
              ${CATEGORIAS.map(c => `<option value="${c}" ${p.categoria_sugerida === c ? 'selected' : ''}>${CATEGORIA_LABELS[c]}</option>`).join('')}
            </select>
          </div>
        </td>
        <td>
          <select id="plantilla-tipo-${dia}">
            ${TIPOS_CONTENIDO.map(t => `<option value="${t}" ${p.tipo_contenido_sugerido === t ? 'selected' : ''}>${TIPO_CONTENIDO_LABELS[t]}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" id="plantilla-notas-${dia}" value="${escapeHtml(p.notas || '')}" placeholder="Opcional"></td>
        <td>
          <label class="admin-toggle-wrap">
            <input type="checkbox" id="plantilla-activo-${dia}" ${p.activo ? 'checked' : ''}>
            <span class="admin-toggle-slider"></span>
          </label>
        </td>
        <td><button type="button" class="btn-action" onclick="window.plantillaGuardarDia(${dia})">Guardar</button></td>
      </tr>`;
  }).join('');

  return `
    <div style="margin-bottom:1rem;">
      <p style="font-size:0.82rem; color:var(--text-muted);">Define el canal, categoría y tipo de contenido sugeridos para cada día de la semana. Los días inactivos no generan publicaciones al usar "Generar mes desde plantilla".</p>
    </div>
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr>
            <th>Día</th><th>Canal</th><th>Categoría sugerida</th><th>Tipo de contenido</th><th>Notas</th><th>Estado</th>${canEditar ? '<th></th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Vista lista ───────────────────────────────────────────────────────────────
function renderListView() {
  const canEditar = auth.canAccess('calendario_editar');
  const canEliminar = auth.canAccess('calendario_eliminar');

  let items = [..._calCache];
  if (_calListFiltroCategoria !== 'todas') items = items.filter(it => it.categoria === _calListFiltroCategoria);
  if (_calListFiltroEstado !== 'todos') items = items.filter(it => it.estado === _calListFiltroEstado);
  if (_calListFiltroVencidos) items = items.filter(esVencidoSinPublicar);
  items.sort((a, b) => `${a.fecha || ''}${a.hora || ''}`.localeCompare(`${b.fecha || ''}${b.hora || ''}`));

  const rows = items.map(it => {
    const vencida = esVencidoSinPublicar(it);
    const tarde = esPublicadoTarde(it);
    return `
    <tr onclick="window.calOpenDetailFromList('${it.id}')" style="cursor:pointer;" class="${vencida ? 'cal-row-vencida' : ''}">
      <td>
        ${formatFechaCorta(it.fecha)}
        ${tarde ? `<br><span class="cal-tag-late">Publicado tarde</span>` : ''}
      </td>
      <td>${categoriaChipHTML(it.categoria)}</td>
      <td>${escapeHtml(CANAL_LABELS[it.canal] || it.canal || '—')}</td>
      <td>${estadoBadgeHTML(it.estado)}</td>
      <td class="cell-title">${escapeHtml(it.hook || '—')}</td>
      <td>${escapeHtml(it.responsable || '—')}</td>
      <td>${it.veces_reprogramado > 0 ? `<span class="cal-badge-reprog" title="Veces reprogramado">${it.veces_reprogramado}</span>` : ''}</td>
      <td class="td-actions">
        <div class="td-actions-group">
          ${canEditar && puedeMarcarPublicado(it) ? `<button class="btn-action" onclick="event.stopPropagation();window.calMarcarPublicado('${it.id}')" title="Marcar como publicado">✓ Publicado</button>` : ''}
          ${canEditar ? `<button class="btn-action" onclick="event.stopPropagation();window.calOpenReprogramar('${it.id}')" title="Reprogramar">↻ Reprogramar</button>` : ''}
          ${canEditar ? `<button class="btn-action" onclick="event.stopPropagation();window.calOpenModal('${it.id}')" title="Editar">✏️</button>` : ''}
          ${canEliminar ? `<button class="btn-action" onclick="event.stopPropagation();window.calEliminar('${it.id}')" title="Eliminar">🗑️</button>` : ''}
        </div>
      </td>
    </tr>
  `;
  }).join('') || `<tr class="table-empty-row"><td colspan="8">No hay publicaciones que coincidan con los filtros.</td></tr>`;

  return `
    ${renderToolbar()}
    <div class="cal-list-filters">
      <select onchange="window.calListFilter('categoria', this.value)">
        <option value="todas">Todas las categorías</option>
        ${CATEGORIAS.map(c => `<option value="${c}" ${_calListFiltroCategoria === c ? 'selected' : ''}>${CATEGORIA_LABELS[c]}</option>`).join('')}
      </select>
      <select onchange="window.calListFilter('estado', this.value)">
        <option value="todos">Todos los estados</option>
        ${ESTADOS.map(e => `<option value="${e}" ${_calListFiltroEstado === e ? 'selected' : ''}>${ESTADO_LABELS[e]}</option>`).join('')}
      </select>
      <button type="button" class="cal-quick-filter ${_calListFiltroVencidos ? 'active' : ''}" onclick="window.calToggleVencidos()">⚠ Vencidos sin publicar</button>
    </div>
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr>
            <th>Fecha</th><th>Categoría</th><th>Canal</th><th>Estado</th><th>Título</th><th>Responsable</th><th>Reprogramaciones</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Handlers globales ────────────────────────────────────────────────────────────
window.calSetView = (v) => {
  _calView = v;
  _reloadCalContent();
};

window.calNavMonth = (delta) => {
  _calMonth += delta;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  _reloadCalContent();
};

window.calSelectDay = (dateStr) => {
  _calSelectedDate = dateStr;
  const items = _calItemsByDate()[dateStr] || [];
  _calSelectedItemId = items.length === 1 ? String(items[0].id) : null;
  _reloadCalContent();
};

window.calClosePanel = () => {
  _calSelectedDate = null;
  _calSelectedItemId = null;
  _reloadCalContent();
};

window.calBackToList = () => {
  _calSelectedItemId = null;
  _reloadCalContent();
};

window.calSelectItem = (id) => {
  _calSelectedItemId = id;
  _reloadCalContent();
};

window.calListFilter = (type, value) => {
  if (type === 'categoria') _calListFiltroCategoria = value;
  else _calListFiltroEstado = value;
  _reloadCalContent();
};

window.calToggleVencidos = () => {
  _calListFiltroVencidos = !_calListFiltroVencidos;
  _reloadCalContent();
};

window.calMarcarPublicado = async (id) => {
  if (!auth.canAccess('calendario_editar')) return showToast('No tienes permiso para editar.', 'error');
  const item = _calCache.find(x => String(x.id) === String(id));
  if (!item) return;
  try {
    await CalendarioService.marcarPublicado(item);
    showToast('Publicación marcada como publicada', 'success');
    await _calReload();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.calOpenDetailFromList = (id) => {
  const it = _calCache.find(x => String(x.id) === String(id));
  if (!it) return;
  const { y, m } = parseDateStr(it.fecha);
  _calYear = y; _calMonth = m;
  _calSelectedDate = String(it.fecha).slice(0, 10);
  _calSelectedItemId = String(id);
  _calView = 'calendario';
  _reloadCalContent();
};

window.calEliminar = async (id) => {
  if (!auth.canAccess('calendario_eliminar')) return showToast('No tienes permiso para eliminar.', 'error');
  const ok = await window.customConfirm('Eliminar publicación', '¿Seguro que deseas eliminar esta publicación del calendario? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await CalendarioService.remove(id);
    showToast('Publicación eliminada', 'success');
    if (String(_calSelectedItemId) === String(id)) _calSelectedItemId = null;
    await _calReload();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ── Plantilla Semanal ────────────────────────────────────────────────────────────
window.plantillaGuardarDia = async (dia) => {
  if (!auth.canAccess('calendario_plantilla_editar')) return showToast('No tienes permiso para editar la plantilla.', 'error');
  const payload = {
    canal: document.getElementById(`plantilla-canal-${dia}`).value,
    categoria_sugerida: document.getElementById(`plantilla-categoria-${dia}`).value,
    tipo_contenido_sugerido: document.getElementById(`plantilla-tipo-${dia}`).value,
    notas: document.getElementById(`plantilla-notas-${dia}`).value.trim() || null,
    activo: document.getElementById(`plantilla-activo-${dia}`).checked,
  };
  try {
    await PlantillaService.upsertDia(dia, payload);
    showToast(`Plantilla de ${DIAS_SEMANA_FULL[dia]} guardada`, 'success');
    await _calReloadPlantilla();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.calGenerarDesdePlantilla = async () => {
  if (!auth.canAccess('calendario_crear')) return showToast('No tienes permiso para crear publicaciones.', 'error');
  const activas = _calPlantillaCache.filter(p => p.activo);
  if (activas.length === 0) {
    return window.customAlert('Sin plantilla activa', 'No hay días activos en la Plantilla Semanal. Configúrala antes de generar el mes.', 'warning');
  }

  const ok = await window.customConfirm('Generar mes desde plantilla', `¿Generar publicaciones para ${MESES[_calMonth]} ${_calYear} usando la Plantilla Semanal? No se sobreescribirán los días que ya tengan contenido planificado.`);
  if (!ok) return;

  const porDia = _plantillaPorDia();
  const itemsByDate = _calItemsByDate();
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();

  const nuevos = [];
  let omitidos = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = dateStrOf(_calYear, _calMonth, d);
    const plantilla = porDia[diaSemanaDeFecha(dateStr)];
    if (!plantilla || !plantilla.activo) continue;
    if ((itemsByDate[dateStr] || []).length > 0) { omitidos++; continue; }
    nuevos.push({
      fecha: dateStr,
      canal: plantilla.canal,
      categoria: plantilla.categoria_sugerida,
      tipo_contenido: plantilla.tipo_contenido_sugerido,
      estado: 'idea',
    });
  }

  if (nuevos.length === 0) {
    return window.customAlert('Nada por generar', `Se omitieron ${omitidos} día${omitidos === 1 ? '' : 's'} que ya tenían contenido planificado. No se creó ninguna publicación nueva.`, 'warning');
  }

  try {
    await CalendarioService.createMany(nuevos);
    await _calReload();
    await window.customAlert('Mes generado', `Se crearon ${nuevos.length} publicación${nuevos.length === 1 ? '' : 'es'}, se omitieron ${omitidos} día${omitidos === 1 ? '' : 's'} que ya tenían contenido.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ── Modal de reprogramación ──────────────────────────────────────────────────────
window.calOpenReprogramar = (id) => openReprogramarModal(id);

function openReprogramarModal(id) {
  if (!auth.canAccess('calendario_editar')) return showToast('No tienes permiso para editar.', 'error');
  const item = _calCache.find(x => String(x.id) === String(id));
  if (!item) return;
  _calReprogramarId = id;

  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  const fechaActual = String(item.fecha || '').slice(0, 10);
  const horaActual = item.hora ? String(item.hora).slice(0, 5) : '00:00';
  const datetimeValue = `${fechaActual}T${horaActual}`;

  content.innerHTML = `
    <div class="modal-content modal-narrow">
      <div class="modal-header">
        <div>
          <h2>Reprogramar publicación</h2>
          <p style="opacity:0.6;font-size:0.85rem;margin-top:4px;">${escapeHtml(item.hook || CATEGORIA_LABELS[item.categoria] || 'Publicación')}</p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <form id="cal-reprogramar-form">
        <div class="modal-body">
          <div class="form-group full-width">
            <label class="form-label">Nueva fecha y hora</label>
            <input type="datetime-local" name="nueva_fecha_hora" value="${datetimeValue}" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" id="cal-reprogramar-submit-btn">Guardar</button>
        </div>
      </form>
    </div>
  `;

  container.style.display = 'flex';

  document.getElementById('cal-reprogramar-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const raw = fd.get('nueva_fecha_hora');
    if (!raw) return;
    const [nuevaFecha, nuevaHora] = raw.split('T');
    const btn = document.getElementById('cal-reprogramar-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      await CalendarioService.reprogramar(item, nuevaFecha, nuevaHora);
      window.closeModal();
      showToast('Publicación reprogramada', 'success');
      await _calReload();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  };
}

// ── Modal de creación/edición ────────────────────────────────────────────────────
window.calOpenModal = (id, prefillDate) => openCalendarioModal(id, prefillDate);

function _renderTagsChips() {
  const el = document.getElementById('cal-tags-chips');
  if (!el) return;
  el.innerHTML = _calModalTags.map((t, i) => `<span class="cal-tag cal-tag-removable">${escapeHtml(t)}<button type="button" onclick="window.calRemoveTag(${i})">×</button></span>`).join('');
}
window.calRemoveTag = (i) => { _calModalTags.splice(i, 1); _renderTagsChips(); };

async function openCalendarioModal(id, prefillDate) {
  const isEdit = !!id;
  if (isEdit && !auth.canAccess('calendario_editar')) return showToast('No tienes permiso para editar.', 'error');
  if (!isEdit && !auth.canAccess('calendario_crear')) return showToast('No tienes permiso para crear publicaciones.', 'error');

  let data = {
    fecha: prefillDate || new Date().toISOString().slice(0, 10),
    hora: '', canal: CANALES[0], categoria: CATEGORIAS[0], tipo_contenido: '',
    estado: 'idea', responsable: '', fecha_limite_entrega: '', hook: '', guion: '', copy_final: '', cta: '',
    marcas_productos: [], assets_necesarios: '', codigo_descuento: '',
    link_verificado: false, codigo_verificado: false, reglas_marca_revisadas: false,
  };
  if (isEdit) {
    const found = _calCache.find(it => String(it.id) === String(id));
    if (found) data = { ...data, ...found };
  }
  _calModalTags = Array.isArray(data.marcas_productos) ? [...data.marcas_productos] : [];

  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-content modal-wide">
      <div class="modal-header">
        <div>
          <h2>${isEdit ? 'Editar Publicación' : 'Nueva Publicación'}</h2>
          <p style="opacity:0.6;font-size:0.85rem;margin-top:4px;">Calendario de Contenido</p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <form id="cal-form">
        <div class="modal-body">
          <div id="cal-reminder-notice" class="cal-reminder-notice">
            <span style="font-size:1.1rem;">⚠️</span>
            <span>Verifica en <strong>RetailMeNot</strong>, <strong>SimplyCodes</strong> o <strong>CouponCabin</strong> antes de marcar como verificado.</span>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label">Fecha</label>
              <input type="date" name="fecha" value="${escapeHtml(String(data.fecha).slice(0, 10))}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Hora</label>
              <input type="time" name="hora" value="${data.hora ? escapeHtml(String(data.hora).slice(0, 5)) : ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Estado</label>
              <select name="estado">
                ${ESTADOS.map(e => `<option value="${e}" ${data.estado === e ? 'selected' : ''}>${ESTADO_LABELS[e]}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Canal</label>
              <select name="canal" id="cal-input-canal">
                ${CANALES.map(c => `<option value="${c}" ${data.canal === c ? 'selected' : ''}>${CANAL_LABELS[c]}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Categoría</label>
              <select name="categoria" id="cal-input-categoria">
                ${CATEGORIAS.map(c => `<option value="${c}" ${data.categoria === c ? 'selected' : ''}>${CATEGORIA_LABELS[c]}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tipo de contenido</label>
              <input type="text" name="tipo_contenido" id="cal-input-tipo" value="${escapeHtml(data.tipo_contenido)}" placeholder="Post, Reel, Story, Carrusel…">
            </div>
            <div class="form-group">
              <label class="form-label">Responsable</label>
              <input type="text" name="responsable" value="${escapeHtml(data.responsable)}" placeholder="Nombre del responsable">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha límite de entrega</label>
              <input type="date" name="fecha_limite_entrega" value="${data.fecha_limite_entrega ? escapeHtml(String(data.fecha_limite_entrega).slice(0, 10)) : ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Código de descuento</label>
              <input type="text" name="codigo_descuento" id="cal-input-codigo" value="${escapeHtml(data.codigo_descuento)}" placeholder="Opcional">
            </div>
          </div>

          <div class="form-group full-width" style="margin-top:0.5rem;">
            <label class="form-label">Hook</label>
            <input type="text" name="hook" value="${escapeHtml(data.hook)}" placeholder="Frase gancho de la publicación">
          </div>

          <div class="form-group full-width" id="cal-guion-group" style="display:${(shouldShowGuionParaTipo(data.tipo_contenido) || data.guion) ? 'flex' : 'none'};">
            <label class="form-label">Guion (Historia / Reel)</label>
            <textarea name="guion" rows="4" placeholder="Guion o storyboard: escena por escena, texto en pantalla, indicaciones de grabación…">${escapeHtml(data.guion)}</textarea>
          </div>

          <div class="form-group full-width">
            <label class="form-label">Copy final</label>
            <textarea name="copy_final" rows="4" placeholder="Texto final de la publicación">${escapeHtml(data.copy_final)}</textarea>
          </div>

          <div class="form-group full-width">
            <label class="form-label">CTA</label>
            <input type="text" name="cta" value="${escapeHtml(data.cta)}" placeholder="Recuerda: siempre encargo, nunca stock inmediato">
          </div>

          <div class="form-group full-width">
            <label class="form-label">Marcas / Productos</label>
            <div class="cal-tags-input" id="cal-tags-input">
              <div class="cal-tags-chips" id="cal-tags-chips"></div>
              <input type="text" id="cal-tags-raw" placeholder="Escribe y presiona Enter…">
            </div>
          </div>

          <div class="form-group full-width">
            <label class="form-label">Assets necesarios</label>
            <textarea name="assets_necesarios" rows="3" placeholder="Fotos del producto, video unboxing, banner promocional…">${escapeHtml(data.assets_necesarios)}</textarea>
          </div>

          <div class="form-grid-3" style="margin-top:0.5rem;">
            <div class="cal-checkbox-row">
              <input type="checkbox" name="link_verificado" id="cal-chk-link" ${data.link_verificado ? 'checked' : ''}>
              <label for="cal-chk-link">Link verificado</label>
            </div>
            <div class="cal-checkbox-row" id="cal-codigo-verificado-row">
              <input type="checkbox" name="codigo_verificado" id="cal-chk-codigo" ${data.codigo_verificado ? 'checked' : ''}>
              <label for="cal-chk-codigo">Código verificado</label>
            </div>
            <div class="cal-checkbox-row">
              <input type="checkbox" name="reglas_marca_revisadas" id="cal-chk-reglas" ${data.reglas_marca_revisadas ? 'checked' : ''}>
              <label for="cal-chk-reglas">Reglas de marca revisadas</label>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary" id="cal-submit-btn">${isEdit ? 'Guardar cambios' : 'Crear publicación'}</button>
        </div>
      </form>
    </div>
  `;

  container.style.display = 'flex';
  _renderTagsChips();

  const catEl = document.getElementById('cal-input-categoria');
  const codEl = document.getElementById('cal-input-codigo');
  const tipoEl = document.getElementById('cal-input-tipo');
  const noticeEl = document.getElementById('cal-reminder-notice');
  const codigoRowEl = document.getElementById('cal-codigo-verificado-row');
  const guionGroupEl = document.getElementById('cal-guion-group');

  const updateGuionVisibility = () => {
    if (!guionGroupEl) return;
    guionGroupEl.style.display = shouldShowGuionParaTipo(tipoEl.value) ? 'flex' : 'none';
  };
  tipoEl.addEventListener('input', updateGuionVisibility);

  const updateReminder = () => {
    if (!noticeEl) return;
    const show = catEl.value === 'b2b' || !!codEl.value.trim();
    noticeEl.style.display = show ? 'flex' : 'none';
  };
  const updateCodigoRow = () => {
    if (!codigoRowEl) return;
    codigoRowEl.style.display = codEl.value.trim() ? 'flex' : 'none';
  };
  catEl.addEventListener('change', updateReminder);
  codEl.addEventListener('input', () => { updateReminder(); updateCodigoRow(); });
  updateReminder();
  updateCodigoRow();

  const tagsRaw = document.getElementById('cal-tags-raw');
  tagsRaw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagsRaw.value.trim().replace(/,$/, '');
      if (v && !_calModalTags.includes(v)) { _calModalTags.push(v); _renderTagsChips(); }
      tagsRaw.value = '';
    } else if (e.key === 'Backspace' && !tagsRaw.value && _calModalTags.length) {
      _calModalTags.pop();
      _renderTagsChips();
    }
  });

  document.getElementById('cal-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = document.getElementById('cal-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    const payload = {
      fecha: fd.get('fecha'),
      hora: fd.get('hora') || null,
      canal: fd.get('canal'),
      categoria: fd.get('categoria'),
      tipo_contenido: fd.get('tipo_contenido')?.trim() || null,
      estado: fd.get('estado'),
      responsable: fd.get('responsable')?.trim() || null,
      fecha_limite_entrega: fd.get('fecha_limite_entrega') || null,
      hook: fd.get('hook')?.trim() || null,
      guion: fd.get('guion')?.trim() || null,
      copy_final: fd.get('copy_final')?.trim() || null,
      cta: fd.get('cta')?.trim() || null,
      marcas_productos: _calModalTags,
      assets_necesarios: fd.get('assets_necesarios')?.trim() || null,
      codigo_descuento: fd.get('codigo_descuento')?.trim() || null,
      link_verificado: fd.get('link_verificado') === 'on',
      codigo_verificado: fd.get('codigo_verificado') === 'on',
      reglas_marca_revisadas: fd.get('reglas_marca_revisadas') === 'on',
    };

    try {
      if (isEdit) await CalendarioService.update(id, payload);
      else await CalendarioService.create(payload);
      window.closeModal();
      showToast(isEdit ? 'Publicación actualizada' : 'Publicación creada', 'success');
      await _calReload();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Guardar cambios' : 'Crear publicación';
    }
  };
}
