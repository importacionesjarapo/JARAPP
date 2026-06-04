/**
 * JARAPP — Dashboard 360° · Centro de Analítica y Decisiones
 * Motor de Inteligencia de Negocios — Vanilla JS + Chart.js
 *
 * Subvistas: [Resumen] [Explorador]
 * Todas las funciones de cálculo están en ../dashboard/dashboardUtils.js
 * Todas las interpretaciones IA en ../dashboard/reportInterpretations.js
 * Builders de Chart.js en ../dashboard/chartBuilders.js
 */

import { db } from '../db.js';
import { auth } from '../auth.js';
import { formatCOP, showToast, downloadExcel, openKPIDetailModal } from '../utils.js';
import Chart from 'chart.js/auto';

// Lazy-load módulos pesados
let _utils = null;
let _interp = null;
let _charts = null;

const loadUtils  = async () => _utils  || (_utils  = await import('../dashboard/dashboardUtils.js'));
const loadInterp = async () => _interp || (_interp = await import('../dashboard/reportInterpretations.js'));
const loadCharts = async () => _charts || (_charts = await import('../dashboard/chartBuilders.js'));
let _vau = null; // ventasAnalisisUtils
const loadVAU = async () => _vau || (_vau = await import('../dashboard/ventasAnalisisUtils.js'));

// ─── Estado del módulo ────────────────────────────────────────────────────────
let _cache      = null;   // datos crudos de Supabase
let _metasCache = null;   // MetasDashboard
let _kpisCache  = null;   // KPIs calculados
let _rl         = null;   // renderLayout ref
let _nav        = null;   // navigateTo ref
let _re         = null;   // renderError ref

let _view   = 'resumen';  // 'resumen' | 'explorador'
let _desde  = '';
let _hasta  = '';
let _catEx  = 'finanzas'; // categoría activa del explorador
let _rptEx  = 'F1';       // reporte activo
let _vizEx  = 'barras';   // 'barras' | 'linea' | 'area' | 'tabla'
let _reportTimer = null;  // timer cancelable para el panel de reporte

// ─── Destruir TODOS los Chart.js activos (seguro) ─────────────────────────────
const _destroyAllCharts = () => {
  try {
    Object.keys(Chart.instances || {}).forEach(k => {
      try { Chart.instances[k]?.destroy(); } catch(e) {}
    });
  } catch(e) {}
};

// ─── Tabla de colores semánticos ──────────────────────────────────────────────
const CC = {
  ingresos:   '#22c55e',
  gastosOp:   '#ef4444',
  comprasUSA: '#eab308',
  utilidad:   '#3b82f6',
  margen:     '#8b5cf6',
  proyeccion: '#94a3b8',
  alerta:     '#f97316',
  neutro:     '#64748b',
  palette:    ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6','#2DD4BF','#FB923C','#34D399','#818CF8'],
};

// ─── Reportes del explorador ──────────────────────────────────────────────────
const REPORT_CATS = [
  { id: 'finanzas',    label: 'Finanzas',    icon: '💹' },
  { id: 'ventas',      label: 'Ventas',       icon: '📈' },
  { id: 'logistica',   label: 'Logística',    icon: '🚚' },
  { id: 'clientes',    label: 'Clientes',     icon: '👥' },
  { id: 'operaciones', label: 'Operaciones',  icon: '⚙️' },
];

const REPORTS = {
  finanzas: [
    { id: 'F1', label: 'P&L Mensual — Ingresos vs Egresos' },
    { id: 'F2', label: 'Flujo de Caja Proyectado' },
    { id: 'F3', label: 'Análisis de Cartera (Aging)' },
    { id: 'F4', label: 'Rentabilidad por Producto' },
    { id: 'F5', label: 'Estado de Resultados (Waterfall)' },
  ],
  ventas: [
    { id: 'V1',  label: 'Evolución de Ventas y Facturación' },
    { id: 'V2',  label: 'Pipeline y Tasa de Conversión' },
    { id: 'V3',  label: 'Análisis de Clientes Top' },
    { id: 'VA1', label: '🏷️ Análisis por Marca' },
    { id: 'VA2', label: '📦 Análisis por Categoría' },
    { id: 'VA3', label: '🏪 Análisis por Tienda' },
    { id: 'VA4', label: '📐 Análisis por Talla' },
    { id: 'VA5', label: '⚤ Análisis por Género' },
    { id: 'VA6', label: '🔥 Mapa de Calor Marca × Categoría' },
    { id: 'VA7', label: '💱 Precio, TRM y Margen' },
    { id: 'VA8', label: '🏆 Ranking de Modelos' },
  ],
  logistica: [
    { id: 'L1', label: 'Estado de Envíos y Seguimientos' },
    { id: 'L2', label: 'Compras USA — Órdenes e Importaciones' },
    { id: 'L3', label: 'Inventario — Rotación y Stock' },
  ],
  clientes: [
    { id: 'C1', label: 'Segmentación y Comportamiento (Cuadrantes)' },
    { id: 'C2', label: 'Retención y Riesgo de Churn' },
  ],
  operaciones: [
    { id: 'O1', label: 'KPIs Operativos vs Objetivos (Radar)' },
    { id: 'O2', label: 'Resumen Ejecutivo Integrado' },
  ],
};

const REPORT_RPT_MAP = {};
Object.values(REPORTS).forEach(arr => arr.forEach(r => { REPORT_RPT_MAP[r.id] = r.label; }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getMeta = (clave, def = 0) => {
  if (!_metasCache) return def;
  const m = _metasCache.find(x => x.clave === clave);
  return m ? (parseFloat(m.valor) || def) : def;
};

const themeColors = () => {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    text:    light ? 'rgba(15,23,42,0.85)'  : 'rgba(255,255,255,0.85)',
    subtext: light ? 'rgba(15,23,42,0.50)'  : 'rgba(255,255,255,0.50)',
    grid:    light ? 'rgba(0,0,0,0.08)'     : 'rgba(255,255,255,0.12)',
    bg:      light ? '#FFFFFF'              : '#0F172A',
  };
};

const chipDates = () => {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const sowStr = startOfWeek.toISOString().split('T')[0];

  const startOfMonth = `${yyyy}-${mm}-01`;
  const start3m = new Date(now); start3m.setMonth(now.getMonth() - 3);
  const start3mStr = start3m.toISOString().split('T')[0];
  const startOfYear = `${yyyy}-01-01`;

  return { today, sowStr, startOfMonth, start3mStr, startOfYear };
};

// ─── API Global (accesible desde HTML inline) ─────────────────────────────────
export const invalidateDashCache = () => { _cache = null; _metasCache = null; _kpisCache = null; };
window.invalidateDashCache = invalidateDashCache;

// setDashChip: actualiza estado y re-renderiza directamente (no depende del DOM)
window.setDashChip = (desde, hasta) => {
  _desde = desde;
  _hasta = hasta;
  if (_cache) _render();
};

// applyDashFilter: lee los inputs manuales y re-renderiza
window.applyDashFilter = () => {
  const ds = document.getElementById('dash-desde');
  const hs = document.getElementById('dash-hasta');
  if (ds) _desde = ds.value || '';
  if (hs) _hasta = hs.value || '';
  if (_cache) _render();
};

window.setDashView = (v) => { _view = v; if (_cache) _render(); };

window.setDashCat = (cat) => {
  _catEx = cat;
  const first = REPORTS[cat]?.[0];
  if (first) _rptEx = first.id;
  _vizEx = 'barras';
  if (_cache) _render();
};

window.setDashReport = (id) => { _rptEx = id; _vizEx = 'barras'; if (_cache) _render(); };
// setDashViz DEBE re-renderizar el explorador completo para actualizar el estado activo de los botones
window.setDashViz = (v) => { _vizEx = v; if (_cache) _render(); };

window.exportDashPDF = () => {
  document.body.classList.add('print-mode');
  window.print();
  setTimeout(() => document.body.classList.remove('print-mode'), 1500);
};

window.exportDashExcel = () => {
  if (!_cache) return;
  const u = _utils;
  if (!u) return showToast('Cargando datos...', 'error');
  const { ventas, gastos, compras, abonos } = _cache;
  const rows = [];
  ventas.forEach(x  => rows.push({ Fecha: (x.fecha||'').split('T')[0], Tipo:'Venta',      Concepto:`#${x.id?.toString().slice(-4)}`, 'Total COP': +parseFloat(x.valor_total_cop||0).toFixed(0) }));
  gastos.forEach(x  => rows.push({ Fecha: (x.fecha||'').split('T')[0], Tipo:'Gasto',      Concepto: x.concepto||x.tipo_gasto, 'Total COP': -parseFloat(x.valor_cop||x.valor_origen||0) }));
  compras.forEach(x => rows.push({ Fecha: (x.fecha_pedido||'').split('T')[0], Tipo:'Compra USA', Concepto: x.proveedor, 'Total COP': -parseFloat(x.costo_cop||0) }));
  if (!rows.length) return showToast('Sin datos para exportar', 'error');
  downloadExcel(rows, `Balance_Maestro_${new Date().toISOString().split('T')[0]}`);
};

window.abrirResumenEjecutivo = async () => _openExecutiveModal();
window.abrirPrioridadesDia = async () => _openPrioritiesDrawer();
window.abrirProyeccionCierre = async () => _openProjectionModal();
window.abrirBalanceMaestro = async () => _openBalanceMaestroModal();

window.irAReporte = (rptId) => {
  const cat = Object.entries(REPORTS).find(([, arr]) => arr.some(r => r.id === rptId))?.[0];
  if (cat) { _catEx = cat; _rptEx = rptId; _view = 'explorador'; _render(); }
};

window.exportCurrentReport = () => _exportCurrentReport();

// ─── PUNTO DE ENTRADA ─────────────────────────────────────────────────────────
export const renderDashboard = async (renderLayout, renderError) => {
  _rl = renderLayout;
  _re = renderError;

  // Destruir gráficos de cualquier render anterior al re-entrar al módulo
  _destroyAllCharts();
  if (_reportTimer) { clearTimeout(_reportTimer); _reportTimer = null; }

  if (!_cache) {
    renderLayout(`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem;">
        <div class="loader"></div>
        <p style="opacity:0.5;font-size:0.9rem;">Cargando Dashboard 360°…</p>
      </div>`);

    try {
      const [data, metas] = await Promise.all([
        db.getDashboardStatsFull(),
        db.fetchData('MetasDashboard').catch(() => []),
      ]);
      if (data.error) throw new Error(data.error);
      _cache      = data;
      _metasCache = Array.isArray(metas) ? metas : [];
    } catch(e) {
      return renderError(e.message);
    }

    // Pre-cargar utils en background
    loadUtils().then(u => { _utils = u; });
    loadInterp().then(i => { _interp = i; });
    loadCharts().then(c => { _charts = c; });
  }

  // Observer de tema para re-renderizar gráficos
  if (!window.__dashThemeObs) {
    window.__dashThemeObs = new MutationObserver(() => { if (_cache) _render(); });
    window.__dashThemeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  _render();
};

// ─── RENDER PRINCIPAL ─────────────────────────────────────────────────────────
const _render = () => {
  // SIEMPRE destruir gráficos antes de reemplazar el DOM
  _destroyAllCharts();
  if (_reportTimer) { clearTimeout(_reportTimer); _reportTimer = null; }

  try {
    if (_view === 'resumen') _renderResumen();
    else                     _renderExplorador();
  } catch(err) {
    console.error('[Dashboard] Error en render:', err);
    // Mostrar un mensaje de error en pantalla en lugar de pantalla en blanco
    if (_rl) _rl(`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem;">
        <div style="font-size:2rem">⚠️</div>
        <p style="color:var(--primary-red);font-weight:700;">Error al renderizar el Dashboard</p>
        <p style="opacity:0.6;font-size:0.85rem;max-width:500px;text-align:center;">${err.message}</p>
        <button onclick="window.invalidateDashCache?.(); window._navigateTo('dashboard')" 
          style="padding:8px 20px;border-radius:10px;border:none;background:var(--primary-red);color:#fff;cursor:pointer;font-family:inherit;font-weight:700;">
          Reintentar
        </button>
      </div>`);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// SUBVISTA: RESUMEN
// ══════════════════════════════════════════════════════════════════════════════
const _renderResumen = () => {
  const data  = _cache;
  const metas = _metasCache;
  const u     = _utils;

  // Cálculos sincrónicos (utils puede no estar listo aún, usar fallback inline)
  const parseD = (s) => { if (!s) return null; const st = String(s).split('T')[0]; const d = new Date(st); return isNaN(d) ? null : d; };
  const inRange = (item, field) => {
    if (!_desde && !_hasta) return true;
    const raw = typeof field === 'function' ? field(item) : item[field];
    const d = parseD(raw); if (!d) return true;
    if (_desde && d < new Date(_desde + 'T00:00')) return false;
    if (_hasta && d > new Date(_hasta + 'T23:59')) return false;
    return true;
  };

  const ventas  = data.ventas.filter(v  => inRange(v, 'fecha'));
  const gastos  = data.gastos.filter(g  => inRange(g, 'fecha'));
  const compras = data.compras.filter(c => inRange(c, x => x.fecha_pedido || x.fecha_registro));
  const abonos  = data.abonos.filter(a  => inRange(a, 'fecha'));

  const totalFact    = ventas.reduce((s,v) => s + parseFloat(v.valor_total_cop||0), 0);
  const totalCob     = ventas.reduce((s,v) => s + parseFloat(v.abonos_acumulados||0), 0);
  const totalGastos  = gastos.reduce((s,g) => s + parseFloat(g.valor_cop||g.valor_origen||0), 0);
  const totalCompras = compras.reduce((s,c) => s + parseFloat(c.costo_cop||0), 0);
  const totalEgresos = totalGastos + totalCompras;
  const totalCartera = ventas.reduce((s,v) => s + parseFloat(v.saldo_pendiente||0), 0);
  const balance      = totalCob - totalEgresos;
  const margenPct    = totalCob > 0 ? (balance / totalCob) * 100 : 0;
  const numVentas    = ventas.length;
  const numAbonos    = abonos.length;

  const metaFact    = getMeta('meta_facturacion_mensual', 0);
  const metaCob     = getMeta('meta_cobrado_mensual', 0);
  const metaMargen  = getMeta('meta_margen_neto_pct', 25);
  const metaCartera = getMeta('meta_cartera_maxima', 30000000);
  const umbralCaja  = getMeta('umbral_caja_minima', 5000000);

  const cumplFact = metaFact > 0 ? (totalFact / metaFact * 100) : null;
  const cumplCob  = metaCob  > 0 ? (totalCob  / metaCob  * 100) : null;

  // Cálculo de variación vs período anterior
  const calcVarAnterior = (arr, field, valField) => {
    if (!_desde || !_hasta) return null;
    const d0 = new Date(_desde); const d1 = new Date(_hasta);
    const dur = d1 - d0;
    const prevD1 = new Date(d0); prevD1.setDate(prevD1.getDate() - 1);
    const prevD0 = new Date(prevD1 - dur);
    const prev = arr.filter(item => {
      const raw = typeof field === 'function' ? field(item) : item[field];
      const d = parseD(raw); if (!d) return false;
      return d >= prevD0 && d <= prevD1;
    });
    return prev.reduce((s, item) => s + parseFloat(item[valField]||0), 0);
  };

  const prevFact  = calcVarAnterior(data.ventas, 'fecha', 'valor_total_cop');
  const prevCob   = calcVarAnterior(data.ventas, 'fecha', 'abonos_acumulados');
  const prevGastos = calcVarAnterior(data.gastos, 'fecha', 'valor_cop');

  const varFact   = (prevFact  !== null && prevFact  > 0) ? ((totalFact - prevFact)  / prevFact  * 100) : null;
  const varCob    = (prevCob   !== null && prevCob   > 0) ? ((totalCob  - prevCob)   / prevCob   * 100) : null;
  const varGastos = (prevGastos!== null && prevGastos> 0) ? ((totalEgresos - prevGastos) / prevGastos * 100) : null;

  // Alertas
  const alertas = u ? u.generarAlertas(_cache, { totalFact, totalCob, totalEgresos, balance, margenPct, totalCartera }, null, _metasCache) : [];
  const criticas      = alertas.filter(a => a.nivel === 'critica');
  const advertencias  = alertas.filter(a => a.nivel === 'advertencia');
  const oportunidades = alertas.filter(a => a.nivel === 'oportunidad');

  // Scores de salud
  const scores = u ? u.calcularScoreSalud(_cache, { totalCob, totalEgresos, balance, margenPct, totalCartera }, _metasCache) : { liquidez:60, cartera:60, logistica:70, rentabilidad:60, control:60, global:62 };

  // Seguimientos activos ordenados por urgencia
  const diasDesdeUpd = (l) => {
    const d = parseD(l.updated_at || l.fecha_registro);
    return d ? Math.floor((Date.now() - d) / 86400000) : 999;
  };
  const mapFaseSimple = (f = '') => {
    if (f.includes('6') || f.toLowerCase().includes('entregado')) return 'entregado';
    if (f.includes('5') || f.toLowerCase().includes('colombia')) return 'bodega_col';
    if (f.includes('4') || f.toLowerCase().includes('aduana') || f.toLowerCase().includes('internacional')) return 'aduana';
    if (f.includes('3') || f.toLowerCase().includes('bodega') || f.toLowerCase().includes('usa') || f.toLowerCase().includes('miami')) return 'bodega_usa';
    if (f.includes('2') || f.toLowerCase().includes('tienda') || f.toLowerCase().includes('tránsito')) return 'transito';
    return 'comprado';
  };
  const FASE_LABELS = { entregado:'Entregado', bodega_col:'Bodega Colombia', aduana:'Aduana', bodega_usa:'Bodega USA', transito:'En Tránsito', comprado:'Comprado' };
  const FASE_COLORS = { entregado: CC.ingresos, bodega_col: CC.margen, aduana: CC.utilidad, bodega_usa: CC.alerta, transito: '#2DD4BF', comprado: CC.gastosOp };

  const logsActivos = data.logistica
    .filter(l => mapFaseSimple(l.fase) !== 'entregado')
    .map(l => ({ ...l, _fase: mapFaseSimple(l.fase), _dias: diasDesdeUpd(l) }))
    .sort((a, b) => b._dias - a._dias)
    .slice(0, 8);

  const umbralRetraso = getMeta('dias_retraso_envio_critico', 7);
  const clienteNombre = (cid) => {
    const c = data.clientes.find(x => x.id?.toString() === cid?.toString());
    return c?.nombre?.split(' ').slice(0, 2).join(' ') || '—';
  };

  const chips = chipDates();
  const canSeeMoney = auth.canAccess('feat_money') !== false;

  const kpiCard = ({ label, valor, sub, var: variation, varDir, color, icon, rpt, accion, cumpl }) => {
    const varBadge = variation !== null && variation !== undefined
      ? `<span style="font-size:0.62rem;font-weight:700;color:${varDir === 'up' ? CC.ingresos : CC.gastosOp};background:${varDir === 'up' ? CC.ingresos : CC.gastosOp}18;padding:2px 6px;border-radius:6px;">${varDir === 'up' ? '↑' : '↓'}${Math.abs(variation).toFixed(1)}%</span>`
      : '';
    const cumplBadge = cumpl !== null && cumpl !== undefined
      ? `<span style="font-size:0.6rem;font-weight:700;color:${cumpl >= 90 ? CC.ingresos : cumpl >= 70 ? CC.alerta : CC.gastosOp};margin-left:4px;">${Math.round(cumpl)}% meta</span>`
      : '';

    return `
    <div class="dash360-kpi-card" style="border-top:3px solid ${color};" onclick="window.irAReporte('${rpt}')" title="Ver reporte relacionado">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <span style="font-size:1.5rem;">${icon}</span>
        <div style="display:flex;gap:4px;align-items:center;">${varBadge}${cumplBadge}</div>
      </div>
      <div style="font-size:${canSeeMoney ? '1.15rem' : '1rem'};font-weight:900;color:${color};letter-spacing:-0.5px;line-height:1.1;margin-bottom:3px;">
        ${canSeeMoney ? valor : '••••••'}
      </div>
      <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.7;margin-bottom:2px;">${label}</div>
      <div style="font-size:0.62rem;opacity:0.45;">${sub}</div>
    </div>`;
  };

  const scoreBar = (label, score) => {
    const c = score >= 75 ? CC.ingresos : score >= 50 ? CC.alerta : CC.gastosOp;
    return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:0.72rem;font-weight:600;opacity:0.75;">${label}</span>
        <span style="font-size:0.72rem;font-weight:900;color:${c};">${score}/100</span>
      </div>
      <div style="height:7px;background:var(--border-base);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${score}%;background:linear-gradient(90deg,${c},${c}AA);border-radius:4px;transition:width 0.7s cubic-bezier(0.34,1.56,0.64,1);"></div>
      </div>
    </div>`;
  };

  const alertaItem = (a) => {
    const bc = a.nivel === 'critica' ? CC.gastosOp : a.nivel === 'advertencia' ? CC.alerta : CC.ingresos;
    const bg = a.nivel === 'critica' ? 'rgba(239,68,68,0.06)' : a.nivel === 'advertencia' ? 'rgba(249,115,22,0.06)' : 'rgba(34,197,94,0.06)';
    return `
    <div style="background:${bg};border:1px solid ${bc}33;border-left:3px solid ${bc};border-radius:10px;padding:0.6rem 0.8rem;display:flex;gap:8px;align-items:flex-start;">
      <span style="font-size:0.95rem;flex-shrink:0;">${a.icon || '•'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.74rem;font-weight:700;line-height:1.3;margin-bottom:2px;">${a.titulo}</div>
        <div style="font-size:0.66rem;opacity:0.6;line-height:1.4;">${a.desc}</div>
        ${a.accionLabel ? `<button onclick="(${a.accionFn || 'function(){}'})(); window.showToast('Procesando...','info')" style="margin-top:6px;font-size:0.62rem;padding:2px 8px;border-radius:6px;border:1px solid ${bc}44;background:${bc}15;color:${bc};cursor:pointer;font-weight:700;">${a.accionLabel}</button>` : ''}
      </div>
    </div>`;
  };

  const modCard = (m) => {
    const badgeColor = m.badge.color === 'rojo' ? CC.gastosOp : m.badge.color === 'amarillo' ? CC.alerta : CC.neutro;
    return `
    <div class="dash360-mod-card" onclick="window._navigateTo('${m.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.4rem;">${m.icon}</span>
          <span style="font-size:0.8rem;font-weight:700;">${m.label}</span>
        </div>
        ${m.badge.count > 0 ? `<span style="background:${badgeColor};color:#fff;font-size:0.58rem;font-weight:800;padding:2px 7px;border-radius:10px;">${m.badge.text || m.badge.count}</span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${m.metricas.map(met => `
        <div style="background:var(--bg-main);border:1px solid var(--border-base);border-radius:8px;padding:5px 8px;">
          <div style="font-size:0.58rem;opacity:0.5;margin-bottom:1px;">${met.label}</div>
          <div style="font-size:0.78rem;font-weight:700;${met.color ? `color:${met.color};` : ''}">${canSeeMoney ? met.valor : (typeof met.valor === 'string' && met.valor.includes('$') ? '••••' : met.valor)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  };

  // Calcular estado de módulos
  const activeClients = data.clientes.filter(c => {
    const lastV = data.ventas.filter(v => v.cliente_id?.toString() === c.id?.toString()).sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0];
    if (!lastV) return false;
    return (Date.now() - new Date(lastV.fecha)) / 86400000 < getMeta('dias_inactividad_cliente', 45) * 2;
  }).length;
  const clientesMora = data.ventas.filter(v => parseFloat(v.saldo_pendiente||0) > 0).map(v => v.cliente_id).filter((id, i, arr) => arr.indexOf(id) === i).length;
  const ordenesActivasCompras = data.compras.filter(c => !['Entregado','Completado'].includes(c.estado)).length;
  const logsTotal    = data.logistica.length || 1;
  const logsEntregados = data.logistica.filter(l => mapFaseSimple(l.fase) === 'entregado').length;
  const logsRetrasados = data.logistica.filter(l => {
    if (mapFaseSimple(l.fase) === 'entregado') return false;
    return diasDesdeUpd(l) > umbralRetraso;
  }).length;
  const logsTransito = data.logistica.filter(l => ['transito','comprado'].includes(mapFaseSimple(l.fase))).length;
  const logsBodega   = data.logistica.filter(l => ['bodega_usa','bodega_col'].includes(mapFaseSimple(l.fase))).length;
  const skusBajoStock = data.productos.filter(p => parseFloat(p.stock||p.cantidad||0) <= parseFloat(p.punto_reorden||p.stock_minimo||1)).length;
  const skusSinMovimiento = data.productos.filter(p => {
    const lastSale = data.ventas.filter(v => v.producto_id?.toString() === p.id?.toString()).sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0];
    if (!lastSale) return true;
    return (Date.now() - new Date(lastSale.fecha)) / 86400000 > 60;
  }).length;

  const ticketPromedio = numVentas > 0 ? totalFact / numVentas : 0;
  const valorInventario = data.productos.reduce((s,p) => s + parseFloat(p.precio_cop||p.precio_venta||0) * parseFloat(p.stock||p.cantidad||0), 0);

  const modulosData = [
    {
      id: 'clients', label: 'Clientes', icon: '👥',
      badge: { count: clientesMora, color: clientesMora > 0 ? 'rojo' : 'neutro', text: `${clientesMora} en mora` },
      metricas: [
        { label: 'Activos', valor: activeClients },
        { label: 'En mora', valor: clientesMora, color: clientesMora > 0 ? CC.gastosOp : null },
        { label: 'Total registrados', valor: data.clientes.length },
        { label: 'Cartera pendiente', valor: formatCOP(totalCartera) },
      ],
    },
    {
      id: 'sales', label: 'Ventas', icon: '📈',
      badge: { count: numVentas, color: 'neutro', text: `${numVentas} activas` },
      metricas: [
        { label: 'Ventas en período', valor: numVentas },
        { label: 'Ticket promedio', valor: formatCOP(ticketPromedio) },
        { label: 'Facturado', valor: formatCOP(totalFact) },
        { label: 'Pendiente cobro', valor: formatCOP(totalCartera), color: totalCartera > 0 ? CC.alerta : null },
      ],
    },
    {
      id: 'inventory', label: 'Inventario', icon: '📦',
      badge: { count: skusBajoStock, color: skusBajoStock > 0 ? (skusBajoStock > 3 ? 'rojo' : 'amarillo') : 'neutro', text: `${skusBajoStock} alertas` },
      metricas: [
        { label: 'SKUs activos', valor: data.productos.length },
        { label: 'Stock bajo', valor: skusBajoStock, color: skusBajoStock > 0 ? CC.alerta : null },
        { label: 'Sin movimiento 60d', valor: skusSinMovimiento },
        { label: 'Valor inventario', valor: formatCOP(valorInventario) },
      ],
    },
    {
      id: 'purchases', label: 'Compras USA', icon: '🌎',
      badge: { count: ordenesActivasCompras, color: 'neutro', text: `${ordenesActivasCompras} en tránsito` },
      metricas: [
        { label: 'Órdenes activas', valor: ordenesActivasCompras },
        { label: 'Total compras', valor: data.compras.length },
        { label: 'Costo período', valor: formatCOP(totalCompras) },
        { label: 'Costo promedio', valor: formatCOP(data.compras.length > 0 ? data.compras.reduce((s,c) => s + parseFloat(c.costo_cop||0),0) / data.compras.length : 0) },
      ],
    },
    {
      id: 'logistics', label: 'Seguimientos', icon: '🚚',
      badge: { count: logsRetrasados, color: logsRetrasados > 0 ? 'rojo' : 'neutro', text: `${data.logistica.filter(l => mapFaseSimple(l.fase) !== 'entregado').length} activos` },
      metricas: [
        { label: 'En tránsito', valor: logsTransito },
        { label: 'En bodega', valor: logsBodega },
        { label: 'Retrasados', valor: logsRetrasados, color: logsRetrasados > 0 ? CC.gastosOp : null },
        { label: 'On-time delivery', valor: `${Math.round(logsTotal > 0 ? (logsEntregados/logsTotal)*100 : 0)}%` },
      ],
    },
    {
      id: 'finance', label: 'Gastos y Finanzas', icon: '💸',
      badge: { count: 0, color: 'neutro', text: 'Mes en curso' },
      metricas: [
        { label: 'Gastos op.', valor: formatCOP(totalGastos) },
        { label: 'Compras USA', valor: formatCOP(totalCompras) },
        { label: 'Total egresos', valor: formatCOP(totalEgresos) },
        { label: 'Balance', valor: formatCOP(balance), color: balance >= 0 ? CC.ingresos : CC.gastosOp },
      ],
    },
  ];

  // ─── HTML de la vista Resumen ─────────────────────────────────────────────
  const globalScore = scores.global;
  const scoreColor  = globalScore >= 75 ? CC.ingresos : globalScore >= 50 ? CC.alerta : CC.gastosOp;

  _rl(`
  <div class="dash360-root">

    <!-- ══ HEADER GLOBAL ══════════════════════════════════════════════════════ -->
    ${_renderHeader()}

    <!-- ══ TIER 1: KPIs FINANCIEROS ══════════════════════════════════════════ -->
    <div class="dash360-kpi-grid">
      ${kpiCard({ label:'Facturación',   valor: formatCOP(totalFact),     sub:`${numVentas} ventas en período`, var: varFact, varDir: varFact >= 0 ? 'up' : 'dn', color: CC.utilidad, icon:'📊', rpt:'V1', cumpl: cumplFact })}
      ${kpiCard({ label:'Total Cobrado', valor: formatCOP(totalCob),      sub:`${numAbonos} abonos recibidos`,  var: varCob,  varDir: varCob  >= 0 ? 'up' : 'dn', color: CC.ingresos, icon:'✅', rpt:'F2', cumpl: cumplCob })}
      ${kpiCard({ label:'Cartera',       valor: formatCOP(totalCartera),   sub:`${data.ventas.filter(v => parseFloat(v.saldo_pendiente||0) > 0).length} ventas con saldo`, var: null, color: totalCartera > metaCartera ? CC.gastosOp : CC.alerta, icon:'⏰', rpt:'F3' })}
      ${kpiCard({ label:'Total Egresos', valor: formatCOP(totalEgresos),   sub:`${gastos.length} gastos + ${compras.length} compras`, var: varGastos, varDir: varGastos >= 0 ? 'dn' : 'up', color: CC.gastosOp, icon:'📤', rpt:'F5' })}
      ${kpiCard({ label:'Balance Caja',  valor: formatCOP(balance),        sub:`Cobrado − Egresos`, var: null, color: balance >= 0 ? CC.ingresos : CC.gastosOp, icon:'💰', rpt:'F2' })}
      ${kpiCard({ label:'Margen Neto',   valor: `${margenPct.toFixed(1).replace('.',',')}%`, sub:`Meta: ${metaMargen}%`, var: null, color: margenPct >= metaMargen ? CC.ingresos : margenPct >= 5 ? CC.alerta : CC.gastosOp, icon: margenPct >= metaMargen ? '📈' : '📉', rpt:'F1' })}
    </div>

    <!-- ══ TIER 2: MÓDULOS OPERATIVOS ════════════════════════════════════════ -->
    <div class="dash360-section-label">⚙️ Estado de Módulos</div>
    <div class="dash360-mod-grid">
      ${modulosData.map(modCard).join('')}
    </div>

    <!-- ══ TIER 3: PANEL DOBLE (Seguimientos + Alertas) ══════════════════════ -->
    <div class="dash360-panel-double">

      <!-- Seguimientos activos -->
      <div class="dash360-panel-box">
        <div class="dash360-panel-header">
          <span>🚚 Seguimientos Activos</span>
          <button onclick="window._navigateTo('logistics')" class="dash360-panel-btn">Ver todos →</button>
        </div>
        <div class="dash360-shipment-list">
          ${logsActivos.length === 0
            ? `<div class="dash360-empty">Sin envíos activos en este momento</div>`
            : logsActivos.map(l => {
                const venta   = data.ventas.find(v => v.id?.toString() === l.venta_id?.toString());
                const cliente = venta ? clienteNombre(venta.cliente_id) : '—';
                const fase    = FASE_LABELS[l._fase] || l.fase;
                const faseC   = FASE_COLORS[l._fase] || CC.neutro;
                const retras  = l._dias > umbralRetraso;
                return `
                <div class="dash360-shipment-row${retras ? ' retrasado' : ''}">
                  <span class="dash360-shipment-dot" style="background:${faseC};"></span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:0.74rem;font-weight:700;">Ord #${l.venta_id?.toString().slice(-4)||'?'} · ${cliente}</div>
                    <div style="font-size:0.62rem;opacity:0.5;">${fase} · ${l._dias}d sin actualización</div>
                  </div>
                  ${retras ? `<span style="font-size:0.6rem;color:${CC.gastosOp};font-weight:800;flex-shrink:0;">⚠ Retraso</span>` : `<span style="font-size:0.6rem;opacity:0.4;flex-shrink:0;">${l._fase === 'bodega_col' ? '✅ Listo' : '🔄'}</span>`}
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Feed de alertas -->
      <div class="dash360-panel-box">
        <div class="dash360-panel-header">
          <span>🚨 Alertas Inteligentes
            ${alertas.length > 0 ? `<span style="background:${CC.gastosOp};color:#fff;font-size:0.55rem;font-weight:800;padding:1px 6px;border-radius:10px;margin-left:6px;">${alertas.length}</span>` : ''}
          </span>
          <button onclick="window.irAReporte('O2')" class="dash360-panel-btn">Ver todas →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;">
          ${alertas.length === 0
            ? `<div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.25);border-radius:10px;padding:0.8rem;display:flex;align-items:center;gap:10px;">
                 <span style="font-size:1.1rem;">✅</span>
                 <span style="font-size:0.82rem;color:${CC.ingresos};font-weight:700;">Sin alertas activas — Todo al día</span>
               </div>`
            : [...criticas.slice(0,3), ...advertencias.slice(0,2), ...oportunidades.slice(0,1)].map(alertaItem).join('')
          }
          ${alertas.length > 6 ? `<button onclick="window.irAReporte('O2')" style="font-size:0.72rem;padding:6px;border-radius:8px;border:1px solid var(--border-base);background:none;color:var(--text-muted);cursor:pointer;text-align:center;">Ver ${alertas.length - 6} alertas más →</button>` : ''}
        </div>
      </div>
    </div>

    <!-- ══ TIER 4: SALUD DEL NEGOCIO ═════════════════════════════════════════ -->
    <div class="dash360-health-row">
      <div class="dash360-panel-box" style="flex:1;">
        <div class="dash360-panel-header">
          <span>💊 Salud del Negocio</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="font-size:2rem;font-weight:900;color:${scoreColor};">${globalScore}</div>
            <span style="font-size:0.65rem;opacity:0.4;">/100</span>
          </div>
        </div>
        ${scoreBar('💧 Liquidez', scores.liquidez)}
        ${scoreBar('💳 Cartera', scores.cartera)}
        ${scoreBar('🚚 Logística', scores.logistica)}
        ${scoreBar('📈 Rentabilidad', scores.rentabilidad)}
        ${scoreBar('⚙️ Control', scores.control)}
      </div>

      <!-- Ventas recientes del período -->
      <div class="dash360-panel-box" style="flex:1;">
        <div class="dash360-panel-header">
          <span>📦 Ventas del Período · ${numVentas}</span>
          <button onclick="window._navigateTo('sales')" class="dash360-panel-btn">Ver todas →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;">
          ${ventas.length === 0
            ? `<div class="dash360-empty">Sin ventas en el período</div>`
            : [...ventas].sort((a,b) => new Date(b.fecha) - new Date(a.fecha)).slice(0,8).map(v => {
                const estado = v.estado_orden || '';
                const stColors = { 'Entregado':'#06D6A0', 'Completado Local':'#06D6A0', 'En Tránsito':'#4CC9F0', 'Validando Compra EEUU':'#FFB703' };
                const stColor  = Object.entries(stColors).find(([k]) => estado.includes(k))?.[1] || '#888';
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-main);border:1px solid var(--border-base);border-radius:8px;">
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span style="font-size:0.74rem;font-weight:700;">Ord #${v.id?.toString().slice(-4)}</span>
                      <span style="font-size:0.58rem;padding:1px 6px;border-radius:6px;background:${stColor}22;color:${stColor};border:1px solid ${stColor}44;font-weight:700;white-space:nowrap;">${estado||'—'}</span>
                    </div>
                    <div style="font-size:0.62rem;opacity:0.45;">${clienteNombre(v.cliente_id)} · ${(v.fecha||'').split('T')[0]}</div>
                  </div>
                  ${canSeeMoney ? `<span style="font-size:0.78rem;font-weight:800;color:${CC.utilidad};flex-shrink:0;">${formatCOP(v.valor_total_cop)}</span>` : ''}
                </div>`;
              }).join('')
          }
        </div>
      </div>
    </div>

    <!-- ══ TIER 5: AI ACTION BAR ══════════════════════════════════════════════ -->
    <div class="dash360-action-bar">
      <span style="font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;font-weight:700;opacity:0.4;flex-shrink:0;">🤖 Acciones IA</span>
      <button onclick="window.abrirResumenEjecutivo()" class="dash360-action-btn primary">📋 Resumen Ejecutivo</button>
      <button onclick="window.exportDashPDF()" class="dash360-action-btn">🖨️ Exportar PDF</button>
      <button onclick="window.abrirPrioridadesDia()" class="dash360-action-btn">🎯 Prioridades del Día</button>
      <button onclick="window.abrirProyeccionCierre()" class="dash360-action-btn">📈 Proyección de Cierre</button>
      <button onclick="window.exportDashExcel()" class="dash360-action-btn">📥 Balance Excel</button>
      <button onclick="window._navigateTo('params')" class="dash360-action-btn">⚙️ Configurar Metas</button>
    </div>

  </div>
  `);

  // Guardar datos para los modales
  window._dashSnapshot = { data, ventas, gastos, compras, abonos, kpis: { totalFact, totalCob, totalEgresos, totalCartera, balance, margenPct, numVentas, numAbonos }, scores, alertas, criticas, advertencias, oportunidades, flujo: null };
};

// ══════════════════════════════════════════════════════════════════════════════
// HEADER GLOBAL (compartido entre ambas vistas)
// ══════════════════════════════════════════════════════════════════════════════
const _renderHeader = () => {
  const chips = chipDates();
  return `
  <div class="dash360-header">
    <div>
      <span class="page-eyebrow">Dashboard 360° · JARAPP</span>
      <h2 class="dash360-title">Centro de Analítica y Decisiones</h2>
      <div style="font-size:0.62rem;opacity:0.4;margin-top:2px;">Intelligence Hub · ${new Date().toLocaleString('es-CO', { dateStyle:'medium', timeStyle:'short' })}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
      <!-- Toggle Resumen / Explorador -->
      <div style="display:flex;background:var(--surface-2);border:1px solid var(--border-base);border-radius:12px;padding:4px;gap:4px;">
        <button onclick="window.setDashView('resumen')" style="padding:6px 18px;border-radius:9px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:${_view==='resumen'?'var(--primary-red)':'transparent'};color:${_view==='resumen'?'#fff':'var(--text-main)'};opacity:${_view==='resumen'?'1':'0.6'};">🏠 Resumen</button>
        <button onclick="window.setDashView('explorador')" style="padding:6px 18px;border-radius:9px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:${_view==='explorador'?'var(--primary-red)':'transparent'};color:${_view==='explorador'?'#fff':'var(--text-main)'};opacity:${_view==='explorador'?'1':'0.6'};">📊 Explorador</button>
      </div>
      <!-- Selector de período + chips -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        <div style="display:flex;gap:4px;">
          ${[
            { label:'Hoy', d: chips.today, h: chips.today },
            { label:'Esta semana', d: chips.sowStr, h: chips.today },
            { label:'Este mes', d: chips.startOfMonth, h: chips.today },
            { label:'3 meses', d: chips.start3mStr, h: chips.today },
            { label:'Este año', d: chips.startOfYear, h: chips.today },
            { label:'Todo', d: '', h: '' },
          ].map(c => `
          <button onclick="window.setDashChip('${c.d}','${c.h}')"
            style="padding:4px 10px;border-radius:8px;border:1px solid var(--border-base);background:${(_desde===c.d&&_hasta===c.h&&(c.d||c.h))?'var(--primary-red)':'var(--surface-2)'};color:${(_desde===c.d&&_hasta===c.h&&(c.d||c.h))?'#fff':'var(--text-muted)'};font-size:0.65rem;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all 0.15s;">
            ${c.label}
          </button>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="date" id="dash-desde" value="${_desde}" style="padding:5px 8px;border-radius:8px;border:1px solid var(--border-base);background:var(--surface-2);color:var(--text-main);font-size:0.78rem;font-family:inherit;">
          <span style="font-size:0.65rem;opacity:0.4;">→</span>
          <input type="date" id="dash-hasta" value="${_hasta}" style="padding:5px 8px;border-radius:8px;border:1px solid var(--border-base);background:var(--surface-2);color:var(--text-main);font-size:0.78rem;font-family:inherit;">
          <button onclick="window.applyDashFilter()" style="padding:5px 12px;border-radius:8px;border:none;background:var(--primary-red);color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;">Filtrar</button>
        </div>
        <button onclick="window.abrirBalanceMaestro()" style="padding:5px 12px;border-radius:8px;border:1px solid var(--border-base);background:var(--surface-2);color:var(--text-main);font-size:0.78rem;font-weight:600;cursor:pointer;font-family:inherit;">⚖️ Balance Maestro</button>
      </div>
    </div>
  </div>`;
};

// ══════════════════════════════════════════════════════════════════════════════
// SUBVISTA: EXPLORADOR
// ══════════════════════════════════════════════════════════════════════════════
const _renderExplorador = () => {
  const catReports = REPORTS[_catEx] || [];
  const rpt = catReports.find(r => r.id === _rptEx) || catReports[0];
  if (rpt && !rpt.id === _rptEx) _rptEx = rpt?.id;

  _rl(`
  <div class="dash360-root">

    ${_renderHeader()}

    <!-- Categorías del Explorador -->
    <div class="dash360-section-label">📊 Explorador de Reportes</div>
    <div class="dash360-ex-tabs">
      ${REPORT_CATS.map(cat => `
      <button class="dash360-ex-tab${_catEx===cat.id?' active':''}" onclick="window.setDashCat('${cat.id}')">
        ${cat.icon} ${cat.label}
      </button>`).join('')}
    </div>

    <!-- Selector de reporte + controles -->
    <div class="dash360-ex-controls">
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;">📋 Reporte</label>
        <select class="dash360-select" onchange="window.setDashReport(this.value)">
          ${catReports.map(r => `<option value="${r.id}" ${r.id===_rptEx?'selected':''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;">🎨 Visualización</label>
        <div style="display:flex;gap:5px;">
          ${[
            {id:'barras',    l:'📊 Barras'},
            {id:'linea',     l:'📈 Línea'},
            {id:'area',      l:'🌊 Área'},
            {id:'circular',  l:'🥧 Circular'},
            {id:'dispersion',l:'⚡ Dispersión'},
            {id:'histograma',l:'📉 Histograma'},
            {id:'tabla',     l:'📋 Tabla'},
          ].map(v => `
          <button onclick="window.setDashViz('${v.id}')"
            style="padding:5px 10px;border-radius:8px;border:1.5px solid ${_vizEx===v.id?'var(--primary-red)':'var(--border-base)'};
                   background:${_vizEx===v.id?'var(--primary-red)':'var(--surface-2)'};
                   color:${_vizEx===v.id?'#fff':'var(--text-muted)'};
                   font-size:0.65rem;font-weight:700;cursor:pointer;font-family:inherit;
                   transition:all 0.15s;white-space:nowrap;">
            ${v.l}
          </button>`).join('')}
        </div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:flex-end;">
        <button onclick="window.exportCurrentReport()" class="dash360-action-btn">📥 Exportar Vista</button>
        <button onclick="window.exportDashPDF()" class="dash360-action-btn">🖨️ PDF</button>
      </div>
    </div>

    <!-- Panel de reporte -->
    <div id="dash-report-panel" class="dash360-report-panel">
      <div style="text-align:center;padding:3rem;opacity:0.4;">Cargando reporte…</div>
    </div>

  </div>
  `);

  // Render del reporte activo con timer cancelable
  if (_reportTimer) clearTimeout(_reportTimer);
  _reportTimer = setTimeout(() => {
    _reportTimer = null;
    _renderReportPanel(_rptEx);
  }, 80);
};

// ─── Renderizar panel de reporte ──────────────────────────────────────────────
const _renderReportPanel = async (rptId) => {
  const panel = document.getElementById('dash-report-panel');
  if (!panel) return;

  // Cargar utilidades si no están listas
  const [u, interp, chartB] = await Promise.all([loadUtils(), loadInterp(), loadCharts()]);
  _utils = u; _interp = interp; _charts = chartB;
  chartB.setupChartDefaults();

  const data    = _cache;
  const metas   = _metasCache;

  // Filtrar datos por período
  const pD = u.parseDate;
  const inRange = (item, field) => {
    if (!_desde && !_hasta) return true;
    const raw = typeof field === 'function' ? field(item) : item[field];
    const d = pD(raw); if (!d) return true;
    if (_desde && d < new Date(_desde + 'T00:00')) return false;
    if (_hasta && d > new Date(_hasta + 'T23:59')) return false;
    return true;
  };
  const ventas  = data.ventas.filter(v  => inRange(v,  'fecha'));
  const gastos  = data.gastos.filter(g  => inRange(g,  'fecha'));
  const compras = data.compras.filter(c => inRange(c, x => x.fecha_pedido || x.fecha_registro));
  const abonos  = data.abonos.filter(a  => inRange(a,  'fecha'));

  const filtered = { ventas, gastos, compras, abonos };

  // Calcular datos del reporte
  let reportData;
  try {
    reportData = await _calcReportData(rptId, filtered, data, u, metas);
  } catch(e) {
    panel.innerHTML = `<div style="padding:2rem;color:${CC.gastosOp};">Error calculando reporte: ${e.message}</div>`;
    return;
  }

  const { kpis: rKpis, interpretacion, chartConfig, tabla } = reportData;
  const numRegistros = tabla?.rows?.length || 0;
  const desde = _desde || 'inicio';
  const hasta  = _hasta || 'hoy';

  panel.innerHTML = `
  <div class="dash360-report-inner">
    <!-- Zona 1: Mini KPIs de contexto -->
    <div class="dash360-report-kpis">
      ${(rKpis || []).map(k => `
      <div class="dash360-report-kpi-card" style="border-left:3px solid ${k.color || CC.utilidad};">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;opacity:0.55;margin-bottom:4px;">${k.label}</div>
        <div style="font-size:1.1rem;font-weight:900;color:${k.color || CC.utilidad};letter-spacing:-0.3px;">${k.valor}</div>
        ${k.sub ? `<div style="font-size:0.62rem;opacity:0.45;margin-top:2px;">${k.sub}</div>` : ''}
      </div>`).join('')}
    </div>

    <!-- Zona 2: Interpretación IA -->
    ${interpretacion ? `
    <div class="dash360-report-interp">
      <span class="dash360-report-interp-label">🤖 Interpretación IA</span>
      <p>${interpretacion}</p>
    </div>` : ''}

    <!-- Zona 3: Gráfico -->
    <div class="dash360-chart-header">
      <span style="font-size:0.75rem;opacity:0.5;">Mostrando ${desde} → ${hasta} · ${numRegistros} registros</span>
    </div>
    <div class="dash360-chart-area" id="dash-chart-area">
      ${_vizEx === 'tabla' ? _buildReportTable(tabla) : `<canvas id="dash-main-canvas" style="width:100%;height:100%;"></canvas>`}
    </div>

    <!-- Zona 4: Tabla de detalle -->
    ${_vizEx !== 'tabla' && tabla ? `
    <div style="margin-top:1.5rem;">
      <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.4;margin-bottom:8px;">📋 Detalle</div>
      <div style="overflow-x:auto;max-height:320px;overflow-y:auto;">
        ${_buildReportTable(tabla)}
      </div>
    </div>` : ''}
  </div>`;

  // Dibujar gráfico
  if (_vizEx !== 'tabla') {
    await _drawReportChart(rptId, reportData, chartB);
  }
};

// ─── Tabla de reporte ─────────────────────────────────────────────────────────
const _buildReportTable = (tabla) => {
  if (!tabla || !tabla.cols || !tabla.rows) return `<div class="dash360-empty">Sin datos de tabla</div>`;
  return `
  <table class="dash360-table">
    <thead><tr>${tabla.cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>
      ${tabla.rows.length === 0
        ? `<tr><td colspan="${tabla.cols.length}" style="text-align:center;padding:2rem;opacity:0.4;">Sin datos en el período seleccionado</td></tr>`
        : tabla.rows.map((row, ri) => `
          <tr class="${ri%2===0?'even':'odd'}">
            ${row.map(cell => {
              if (typeof cell === 'object' && cell !== null && 'val' in cell) {
                return `<td style="color:${cell.color||'inherit'};font-weight:${cell.bold?'700':'normal'};">${cell.val}</td>`;
              }
              return `<td>${cell ?? '—'}</td>`;
            }).join('')}
          </tr>`).join('')}
    </tbody>
  </table>`;
};

// ─── Dibujar gráfico con Chart.js ─────────────────────────────────────────────
const _drawReportChart = async (rptId, reportData, chartB) => {
  const { chartLabels, chartDatasets, chartOptions } = reportData;
  if (!chartLabels || !chartDatasets) return;

  // Destruir instancia existente en este canvas específico antes de crear una nueva
  _destroyAllCharts();
  const canvas = document.getElementById('dash-main-canvas');
  if (!canvas) return;

  // Doble seguridad: destruir la instancia asociada a este canvas si Chart.js la tiene registrada
  try { Chart.getChart(canvas)?.destroy(); } catch(e) {}

  const tc = themeColors();
  // NO mutar Chart.defaults aquí (causa stack overflow con chartBuilders.setupChartDefaults)
  // Los colores se pasan directamente a cada gráfico via options

  const makeCOPTooltip = () => ({
    backgroundColor: tc.bg,
    titleColor: tc.text,
    bodyColor:  tc.subtext,
    borderColor: tc.grid,
    borderWidth: 1,
    padding: 12,
    callbacks: {
      label: (ctx) => {
        const v = ctx.raw;
        const label = ctx.dataset.label || ctx.label || '';
        if (typeof v === 'number' && Math.abs(v) >= 1000) {
          return ` ${label}: ${formatCOP(Math.abs(v))}`;
        }
        return ` ${label}: ${v}`;
      }
    }
  });

  const refLines = chartOptions?.refLines || [];
  const annotations = {};
  refLines.forEach((rl, i) => {
    annotations[`ref${i}`] = {
      type: 'line', yMin: rl.y, yMax: rl.y,
      borderColor: rl.color || CC.neutro,
      borderWidth: 1.5, borderDash: [6, 3],
      label: { content: rl.label, display: true, position: 'end', color: rl.color || CC.neutro, font: { size: 11 } }
    };
  });

  const type     = _vizEx === 'linea'     ? 'line'
                 : _vizEx === 'area'      ? 'line'
                 : _vizEx === 'circular'  ? 'doughnut'
                 : _vizEx === 'dispersion'? 'scatter'
                 : _vizEx === 'histograma'? 'bar'
                 : chartOptions?.type || 'bar';
  const isArea    = _vizEx === 'area';
  const isHoriz   = chartOptions?.horizontal;
  const isCircular  = _vizEx === 'circular';
  const isDispersion= _vizEx === 'dispersion';
  const isHistogram = _vizEx === 'histograma';

  // Para gráficos circulares, construir dataset de donut con colores por segmento
  let datasets;
  let chartLabelsUsed = chartLabels;
  if (isCircular) {
    // Agrupamos todos los datasets en uno solo para el donut/pie
    const palette = ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6','#2DD4BF','#FB923C','#34D399','#818CF8'];
    const totalSum = chartDatasets.reduce((s, ds) => s + (ds.data || []).reduce((a, b) => a + (Number(b)||0), 0), 0);
    if (chartDatasets.length === 1) {
      // Un dataset con múltiples puntos → segmento por label
      datasets = [{
        data: chartDatasets[0].data,
        backgroundColor: chartLabels.map((_,i) => palette[i % palette.length] + 'CC'),
        borderColor:     chartLabels.map((_,i) => palette[i % palette.length]),
        borderWidth: 2, hoverOffset: 8,
      }];
    } else {
      // Múltiples datasets → un segmento por dataset (totalizando)
      datasets = [{
        data: chartDatasets.map(ds => (ds.data || []).reduce((a,b) => a+(Number(b)||0), 0)),
        backgroundColor: chartDatasets.map((_,i) => palette[i % palette.length] + 'CC'),
        borderColor:     chartDatasets.map((_,i) => palette[i % palette.length]),
        borderWidth: 2, hoverOffset: 8,
        label: chartDatasets.map(ds => ds.label).join(', '),
      }];
      chartLabelsUsed = chartDatasets.map(ds => ds.label);
    }
  } else if (isDispersion) {
    // Convertir datos de serie temporal a puntos x/y (ndice vs valor)
    datasets = chartDatasets.slice(0,2).map((ds, di) => ({
      label: ds.label,
      data: (ds.data || []).map((v, i) => ({ x: i, y: Number(v) || 0 })),
      backgroundColor: (ds.backgroundColor || palette_[di % palette_.length]) + '99',
      borderColor:     ds.borderColor || palette_[di % palette_.length],
      pointRadius: 5, pointHoverRadius: 8,
    }));
  } else if (isHistogram) {
    // Histograma: agrupar valores en rangos (bins)
    const allVals = chartDatasets.flatMap(ds => (ds.data || []).map(v => Number(v)||0)).filter(v => v > 0);
    if (allVals.length > 0) {
      const min = Math.min(...allVals), max = Math.max(...allVals);
      const bins = 8;
      const binSize = (max - min) / bins || 1;
      const binCounts = Array(bins).fill(0);
      const binLabels = Array(bins).fill(0).map((_,i) => {
        const lo = min + i * binSize;
        const hi = lo + binSize;
        return Math.abs(lo) >= 1000 ? `${formatCOP(lo).slice(0,6)}-${formatCOP(hi).slice(0,6)}` : `${Math.round(lo)}-${Math.round(hi)}`;
      });
      allVals.forEach(v => {
        const bi = Math.min(bins-1, Math.floor((v-min)/binSize));
        binCounts[bi]++;
      });
      chartLabelsUsed = binLabels;
      datasets = [{ label: 'Frecuencia', data: binCounts, backgroundColor: '#4CC9F0CC', borderColor: '#4CC9F0', borderWidth: 1, borderRadius: 3 }];
    } else {
      datasets = chartDatasets;
    }
  } else {
    datasets = chartDatasets.map(ds => ({
      ...ds,
      fill:     isArea ? true : (ds.fill || false),
      tension:  ds.tension ?? 0.4,
      borderWidth: ds.borderWidth ?? 2,
      borderRadius: ds.borderRadius ?? (isArea || _vizEx==='linea' ? 0 : 5),
    }));
  }

  const palette_ = ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6'];

  // Opciones específicas por tipo
  const scalesForType = (isCircular || type === 'doughnut' || type === 'radar') ? {} :
    isDispersion ? {
      x: { type: 'linear', grid: { color: tc.grid }, ticks: { color: tc.text } },
      y: { grid: { color: tc.grid }, ticks: { color: tc.text, callback: v => typeof v === 'number' && v >= 1000 ? '$'+(v/1000000>=1?(v/1000000).toFixed(1)+'M':(v/1000).toFixed(0)+'k') : v } },
    } :
    isHoriz ? {
      y: { grid: { display: false }, ticks: { color: tc.text } },
      x: { grid: { color: tc.grid }, ticks: { color: tc.text, callback: v => typeof v === 'number' && v >= 1000 ? formatCOP(v).replace('$','$').slice(0,8) : v } },
    } : {
      x: { grid: { display: false }, ticks: { color: tc.text, maxRotation: 40 } },
      y: { grid: { color: tc.grid }, stacked: chartOptions?.stacked, ticks: { color: tc.text, callback: v => typeof v === 'number' && v >= 1000 ? '$' + (v/1000000 >= 1 ? (v/1000000).toFixed(1)+'M' : (v/1000).toFixed(0)+'k') : v } },
      ...(chartOptions?.dualY ? { y2: { position: 'right', grid: { display: false }, ticks: { color: tc.text, callback: v => `${v.toFixed(1)}%` } } } : {}),
    };

  let _chartInstance;
  try { _chartInstance = new Chart(canvas, {
    type: isHoriz ? 'bar' : type,
    data: { labels: chartLabelsUsed, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: isHoriz ? 'y' : 'x',
      animation: { duration: 500, easing: 'easeOutQuart' },
      interaction: { mode: isCircular ? 'nearest' : 'index', intersect: isCircular },
      plugins: {
        legend: { display: isCircular || datasets.length > 1, position: isCircular ? 'right' : 'top', labels: { usePointStyle: true, padding: 14, color: tc.text, font: { size: 11 } } },
        tooltip: makeCOPTooltip(),
        annotation: Object.keys(annotations).length > 0 ? { annotations } : undefined,
      },
      ...(isCircular ? { cutout: '55%' } : {}),
      scales: scalesForType,
    }
  }); } catch(chartErr) {
    console.error('[Dashboard] Error Chart.js:', chartErr);
  }
};

// ─── Calculador de datos por reporte ──────────────────────────────────────────
const _calcReportData = async (rptId, filtered, raw, u, metas) => {
  const { ventas, gastos, compras, abonos } = filtered;
  const cop = (n) => formatCOP(n);
  const pct = (n) => `${n.toFixed(1).replace('.',',')}%`;

  // Función compartida de agrupación por mes
  const byMonth = (arr, dateField, valField) => {
    const map = {};
    arr.forEach(item => {
      const raw = typeof dateField === 'function' ? dateField(item) : item[dateField];
      const d = u.parseDate(raw); if (!d) return;
      const k = u.monthKey(d);
      map[k] = (map[k] || 0) + parseFloat(item[valField] || 0);
    });
    return map;
  };

  const last12Months = (() => {
    const now = new Date();
    const keys = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(u.monthKey(d));
    }
    return keys;
  })();

  const mFact  = byMonth(ventas,  'fecha', 'valor_total_cop');
  const mCob   = byMonth(ventas,  'fecha', 'abonos_acumulados');
  const mGast  = byMonth(gastos,  'fecha', 'valor_cop');
  const mComp  = byMonth(compras, x => x.fecha_pedido || x.fecha_registro, 'costo_cop');
  const mAbon  = byMonth(abonos,  'fecha', 'valor');
  const allKeys = [...new Set([...Object.keys(mFact),...Object.keys(mCob),...Object.keys(mGast),...Object.keys(mComp)])].sort().slice(-12);
  const ML = allKeys.map(u.monthLabel);

  const plData = allKeys.map(k => ({
    key: k, mes: u.monthLabel(k),
    cobrado: mCob[k]||0, gastosOp: mGast[k]||0, comprasUSA: mComp[k]||0,
    facturado: mFact[k]||0,
    egresos: (mGast[k]||0) + (mComp[k]||0),
    utilidad: (mCob[k]||0) - (mGast[k]||0) - (mComp[k]||0),
    margenPct: (mCob[k]||0) > 0 ? (((mCob[k]||0) - (mGast[k]||0) - (mComp[k]||0)) / (mCob[k]||0)) * 100 : 0,
  }));

  const totalCob   = ventas.reduce((s,v) => s + parseFloat(v.abonos_acumulados||0), 0);
  const totalGastos = gastos.reduce((s,g) => s + parseFloat(g.valor_cop||g.valor_origen||0), 0);
  const totalComp  = compras.reduce((s,c) => s + parseFloat(c.costo_cop||0), 0);
  const totalFact  = ventas.reduce((s,v) => s + parseFloat(v.valor_total_cop||0), 0);
  const totalEgr   = totalGastos + totalComp;
  const balance    = totalCob - totalEgr;
  const margenN    = totalCob > 0 ? (balance / totalCob) * 100 : 0;

  const metaMargen  = getMeta('meta_margen_neto_pct', 25);
  const metaFact    = getMeta('meta_facturacion_mensual', 0);
  const clienteN    = (cid) => { const c = raw.clientes.find(x => x.id?.toString() === cid?.toString()); return c?.nombre?.split(' ').slice(0,2).join(' ') || 'N/A'; };

  switch (rptId) {

    // ── F1: P&L Mensual ──────────────────────────────────────────────────────
    case 'F1': {
      const mejorMes = [...plData].sort((a,b) => b.utilidad - a.utilidad)[0];
      const mesesNeg = plData.filter(m => m.utilidad < 0).length;
      return {
        kpis: [
          { label:'Utilidad Neta del Período',   valor: cop(balance),       color: balance >= 0 ? CC.ingresos : CC.gastosOp, sub: balance >= 0 ? 'Superávit operativo' : '⚠ Déficit operativo' },
          { label:'Margen Neto',                  valor: pct(margenN),       color: margenN >= metaMargen ? CC.ingresos : margenN >= 5 ? CC.alerta : CC.gastosOp, sub: `Meta: ${metaMargen}%` },
          { label:'Mejor Mes del Período',        valor: mejorMes?.mes || '—', color: CC.utilidad, sub: mejorMes ? cop(mejorMes.utilidad) : '—' },
          { label:'Meses en Pérdida',             valor: mesesNeg,           color: mesesNeg > 0 ? CC.gastosOp : CC.ingresos, sub: mesesNeg > 0 ? 'Requieren análisis' : 'Todos positivos ✅' },
        ],
        interpretacion: _interp ? _interp.interpretarPL(plData, { metaMargen }) : null,
        chartLabels: ML,
        chartDatasets: [
          { label:'Cobrado (Ingresos)', data: allKeys.map(k => mCob[k]||0), backgroundColor: CC.ingresos+'BB', borderRadius: 5, stack: 'a' },
          { label:'Gastos Op.',         data: allKeys.map(k => -(mGast[k]||0)), backgroundColor: CC.gastosOp+'BB', borderRadius: 5, stack: 'b' },
          { label:'Compras USA',        data: allKeys.map(k => -(mComp[k]||0)), backgroundColor: CC.comprasUSA+'BB', borderRadius: 5, stack: 'b' },
          { label:'Utilidad', data: plData.map(m => m.utilidad), type:'line', borderColor: CC.utilidad, backgroundColor:'transparent', borderWidth:2, borderDash:[4,3], pointRadius:4, fill:false, yAxisID:'y2' },
        ],
        chartOptions: { stacked: true, dualY: true, refLines: [{ y: 0, label: 'Equilibrio', color: CC.neutro }, ...(metaFact > 0 ? [{ y: metaFact * metaMargen / 100, label: `Meta utilidad`, color: CC.margen }] : [])] },
        tabla: {
          cols: ['Mes','Cobrado','Gastos Op.','Compras USA','Utilidad','Margen %','Estado'],
          rows: plData.map(m => {
            const sem = m.margenPct >= metaMargen ? '🟢' : m.margenPct >= 5 ? '🟡' : '🔴';
            return [m.mes, cop(m.cobrado), cop(m.gastosOp), cop(m.comprasUSA), { val: cop(m.utilidad), color: m.utilidad >= 0 ? CC.ingresos : CC.gastosOp }, { val: pct(m.margenPct), color: m.margenPct >= metaMargen ? CC.ingresos : CC.gastosOp }, sem];
          }),
        },
      };
    }

    // ── F2: Flujo de Caja ─────────────────────────────────────────────────────
    case 'F2': {
      const aging = u.calcularCarteraAging(raw.ventas, raw.clientes, _metasCache);
      const flujo = u.calcularFlujoCajaProyectado(raw, _metasCache);
      const gastosMes = flujo.gastosPromedioMes;
      const sem = flujo.semaforoLiquidez;
      const semColor = sem === 'verde' ? CC.ingresos : sem === 'amarillo' ? CC.alerta : CC.gastosOp;

      // Balance acumulado histórico
      let acum = 0;
      const balanceLine = allKeys.map(k => { acum += (mCob[k]||0) - (mGast[k]||0) - (mComp[k]||0); return acum; });

      return {
        kpis: [
          { label:'Saldo Actual de Caja',   valor: cop(flujo.saldoActual),   color: flujo.saldoActual >= 0 ? CC.ingresos : CC.gastosOp },
          { label:'Proyección a 30 días',   valor: cop(flujo.proyeccion30),  color: flujo.proyeccion30 >= gastosMes ? CC.ingresos : CC.gastosOp, sub: flujo.proyeccion30 < gastosMes ? '⚠ Por debajo del mínimo' : '✅ Cubre gastos' },
          { label:'Proyección a 60 días',   valor: cop(flujo.proyeccion60),  color: flujo.proyeccion60 >= gastosMes ? CC.ingresos : CC.gastosOp },
          { label:'Semáforo de Liquidez',   valor: sem === 'verde' ? '🟢 Sólida' : sem === 'amarillo' ? '🟡 Ajustada' : '🔴 En riesgo', color: semColor, sub: `Umbral: ${cop(getMeta('umbral_caja_minima',5000000))}` },
        ],
        interpretacion: _interp ? _interp.interpretarFlujo(flujo.saldoActual, flujo.proyeccion30, flujo.proyeccion60, gastosMes, aging.total) : null,
        chartLabels: ML,
        chartDatasets: [
          { label:'Balance Acumulado', data: balanceLine, borderColor: CC.utilidad, backgroundColor: CC.utilidad + '20', fill: true, tension: 0.4 },
        ],
        chartOptions: { refLines: [{ y: getMeta('umbral_caja_minima',5000000), label:'Umbral mínimo', color: CC.gastosOp }, { y: gastosMes * 2, label:'Zona segura', color: CC.ingresos }] },
        tabla: {
          cols: ['Concepto','Monto COP'],
          rows: [
            ['Saldo actual de caja', { val: cop(flujo.saldoActual), color: flujo.saldoActual >= 0 ? CC.ingresos : CC.gastosOp }],
            ['+ Cobros esperados 30d (por tramo)', { val: cop(flujo.cobrosEsperados30), color: CC.ingresos }],
            ['- Egresos comprometidos', { val: cop(flujo.egresosComprometidos), color: CC.gastosOp }],
            ['- Gastos promedio mensual', { val: cop(gastosMes), color: CC.gastosOp }],
            ['= Proyección 30 días', { val: cop(flujo.proyeccion30), color: flujo.proyeccion30 >= gastosMes ? CC.ingresos : CC.gastosOp, bold: true }],
            ['Proyección 60 días', { val: cop(flujo.proyeccion60), color: flujo.proyeccion60 >= gastosMes ? CC.ingresos : CC.gastosOp }],
            ['Proyección 90 días', { val: cop(flujo.proyeccion90), color: flujo.proyeccion90 >= gastosMes ? CC.ingresos : CC.gastosOp }],
            ['Umbral mínimo operativo', { val: cop(getMeta('umbral_caja_minima',5000000)), color: CC.alerta }],
          ],
        },
      };
    }

    // ── F3: Aging de Cartera ──────────────────────────────────────────────────
    case 'F3': {
      const aging = u.calcularCarteraAging(raw.ventas, raw.clientes, _metasCache);
      const t030  = aging.tramos['0-30'].reduce((s,e) => s + e.saldo, 0);
      const t3160 = aging.tramos['31-60'].reduce((s,e) => s + e.saldo, 0);
      const t6190 = aging.tramos['61-90'].reduce((s,e) => s + e.saldo, 0);
      const t90p  = aging.tramos['+90'].reduce((s,e) => s + e.saldo, 0);
      const gastoMes = getMeta('umbral_caja_minima', 5000000);
      const mesesEquiv = gastoMes > 0 ? (t90p / gastoMes).toFixed(1) : 0;

      return {
        kpis: [
          { label:'Total Cartera Pendiente', valor: cop(aging.total), color: CC.alerta, sub: `${raw.ventas.filter(v => parseFloat(v.saldo_pendiente||0)>0).length} ventas` },
          { label:'Corriente 0-30d',          valor: cop(t030),  color: CC.ingresos, sub: aging.total > 0 ? pct(t030/aging.total*100) : '—' },
          { label:'En Riesgo 31-90d',          valor: cop(t3160+t6190), color: CC.alerta,  sub: aging.total > 0 ? pct((t3160+t6190)/aging.total*100) : '—' },
          { label:'Crítica +90 días',          valor: cop(t90p), color: CC.gastosOp,  sub: `≈ ${mesesEquiv} meses de gastos` },
        ],
        interpretacion: _interp ? _interp.interpretarCartera(aging.porCliente, raw.clientes) : null,
        chartLabels: ['0-30d (Corriente)','31-60d','61-90d','+90d (Crítico)'],
        chartDatasets: [{
          label:'Saldo (COP)', data: [t030, t3160, t6190, t90p],
          backgroundColor: [CC.ingresos+'BB', CC.comprasUSA+'BB', CC.alerta+'BB', CC.gastosOp+'BB'],
          borderRadius: 8,
        }],
        chartOptions: { horizontal: true },
        tabla: {
          cols: ['Cliente','0-30d','31-60d','61-90d','+90d','Total','Riesgo'],
          rows: aging.porCliente.map(r => {
            const rC = r.riesgo === 'ALTO' ? CC.gastosOp : r.riesgo === 'MEDIO' ? CC.alerta : CC.ingresos;
            const rIcon = r.riesgo === 'ALTO' ? '🔴' : r.riesgo === 'MEDIO' ? '🟡' : '🟢';
            return [r.nombre, cop(r.t0_30), cop(r.t31_60), cop(r.t61_90), { val: cop(r.t90plus), color: r.t90plus > 0 ? CC.gastosOp : 'inherit' }, { val: cop(r.total), color: CC.alerta }, { val: `${rIcon} ${r.riesgo}`, color: rC }];
          }),
        },
      };
    }

    // ── F4: Rentabilidad por Producto ─────────────────────────────────────────
    case 'F4': {
      const prods = u.calcularMargenesPorProducto(ventas, raw.productos, _metasCache);
      const sorted = [...prods].sort((a,b) => b.margenPct - a.margenPct);
      const topP = sorted[0];
      const lowP = sorted[sorted.length - 1];
      const metaMinimo = getMeta('umbral_margen_minimo_pct', 15);
      const criticos = prods.filter(p => p.margenPct < metaMinimo);
      const estrellas = prods.filter(p => p.margenPct > 25);
      const avgMargen = prods.length > 0 ? prods.reduce((s,p) => s + p.margenPct * p.revenue, 0) / Math.max(prods.reduce((s,p) => s + p.revenue, 0), 1) : 0;

      return {
        kpis: [
          { label:'Producto más rentable', valor: topP?.nombre?.slice(0,20) || '—', color: CC.ingresos, sub: topP ? pct(topP.margenPct) : '—' },
          { label:'Producto menos rentable', valor: lowP?.nombre?.slice(0,20) || '—', color: lowP?.margenPct < metaMinimo ? CC.gastosOp : CC.alerta, sub: lowP ? pct(lowP.margenPct) : '—' },
          { label:'Margen promedio ponderado', valor: pct(avgMargen), color: avgMargen >= metaMinimo ? CC.ingresos : CC.gastosOp },
          { label:'Productos críticos (<15%)', valor: criticos.length, color: criticos.length > 0 ? CC.gastosOp : CC.ingresos, sub: criticos.length > 0 ? 'Revisar precios/costos' : 'Todos dentro del rango ✅' },
        ],
        interpretacion: _interp ? _interp.interpretarProductos(prods, { metaMinimo }) : null,
        chartLabels: sorted.map(p => p.nombre?.slice(0,20) || '—'),
        chartDatasets: [{
          label:'Margen Bruto %', data: sorted.map(p => p.margenPct),
          backgroundColor: sorted.map(p => p.margenPct > 25 ? CC.ingresos+'BB' : p.margenPct > 15 ? CC.utilidad+'BB' : CC.gastosOp+'BB'),
          borderRadius: 6,
        }],
        chartOptions: { horizontal: true, refLines: [{ y: metaMinimo, label:`Mínimo ${metaMinimo}%`, color: CC.gastosOp }] },
        tabla: {
          cols: ['Producto','SKU','Precio Venta','Margen $','Margen %','Ventas','Revenue','Clasificación'],
          rows: sorted.map(p => {
            const cls = p.clasificacion === 'estrella' ? '⭐ Estrella' : p.clasificacion === 'estandar' ? '✅ Estándar' : '⚠️ Crítico';
            const clsC = p.clasificacion === 'estrella' ? CC.ingresos : p.clasificacion === 'estandar' ? CC.utilidad : CC.gastosOp;
            return [p.nombre?.slice(0,25)||'—', p.sku||'—', cop(p.precioVenta), cop(p.margenBruto), { val: pct(p.margenPct), color: clsC }, p.unidades, cop(p.revenue), { val: cls, color: clsC }];
          }),
        },
      };
    }

    // ── F5: Estado de Resultados ──────────────────────────────────────────────
    case 'F5': {
      const ingBrutos = totalFact;
      const cogs      = totalComp;
      const utilBruta = ingBrutos - cogs;
      const margenBruto = ingBrutos > 0 ? (utilBruta / ingBrutos) * 100 : 0;
      const utilNeta  = balance;
      const margenNeto = totalCob > 0 ? (utilNeta / totalCob) * 100 : 0;

      const waterSteps = [
        { label:'Ingresos (Facturación)',  value: ingBrutos,    type:'total' },
        { label:'(-) COGS Compras USA',    value: -cogs,         type:'subtract' },
        { label:'= Utilidad Bruta',        value: utilBruta,     type:'total' },
        { label:'(-) Gastos Operativos',   value: -totalGastos, type:'subtract' },
        { label:'= Utilidad Neta',         value: utilNeta,      type:'total' },
      ];

      return {
        kpis: [
          { label:'Ingresos Brutos',    valor: cop(ingBrutos),   color: CC.ingresos },
          { label:'COGS (Compras USA)', valor: cop(cogs),         color: CC.gastosOp, sub: ingBrutos > 0 ? pct(cogs/ingBrutos*100) + ' de ingresos' : '—' },
          { label:'Utilidad Bruta',     valor: cop(utilBruta),   color: utilBruta >= 0 ? CC.ingresos : CC.gastosOp, sub: pct(margenBruto) },
          { label:'Utilidad Neta',      valor: cop(utilNeta),    color: utilNeta >= 0 ? CC.ingresos : CC.gastosOp, sub: pct(margenNeto) },
        ],
        interpretacion: _interp ? _interp.interpretarPL([{ cobrado: totalCob, gastosOp: totalGastos, comprasUSA: totalComp, utilidad: balance, margenPct: margenNeto, mes: 'Período' }], { metaMargen }) : null,
        chartLabels: waterSteps.map(s => s.label),
        chartDatasets: [{
          label:'COP', data: waterSteps.map(s => s.value),
          backgroundColor: waterSteps.map(s => s.value >= 0 ? CC.ingresos+'BB' : CC.gastosOp+'BB'),
          borderRadius: 6,
        }],
        chartOptions: {},
        tabla: {
          cols: ['Concepto','Monto COP','% sobre Ingresos'],
          rows: waterSteps.map(s => [s.label, { val: cop(Math.abs(s.value)), color: s.value >= 0 ? CC.ingresos : CC.gastosOp, bold: s.type==='total' }, { val: ingBrutos > 0 ? pct(Math.abs(s.value)/ingBrutos*100) : '—', color: s.value >= 0 ? CC.ingresos : CC.gastosOp }]),
        },
      };
    }

    // ── V1: Evolución de Ventas ───────────────────────────────────────────────
    case 'V1': {
      const tickets = allKeys.map(k => {
        const n = Object.values(byMonth(ventas.filter(v => { const d = u.parseDate(v.fecha); return d && u.monthKey(d) === k; }), 'fecha', 'id')).length || 1;
        return (mFact[k]||0) / n;
      });
      const factTotal = ventas.reduce((s,v) => s + parseFloat(v.valor_total_cop||0), 0);
      const numV  = ventas.length;
      const mejor = allKeys.reduce((best, k) => (!best || (mFact[k]||0) > (mFact[best]||0)) ? k : best, null);

      return {
        kpis: [
          { label:'Facturación del Período',  valor: cop(factTotal), color: CC.utilidad, sub: `${numV} ventas` },
          { label:'Ticket Promedio',           valor: cop(numV > 0 ? factTotal/numV : 0), color: CC.ingresos },
          { label:'Mejor Mes',                 valor: mejor ? u.monthLabel(mejor) : '—', color: CC.comprasUSA, sub: mejor ? cop(mFact[mejor]||0) : '—' },
          { label:'Meta Mensual de Fact.',     valor: metaFact > 0 ? cop(metaFact) : 'No configurada', color: CC.margen },
        ],
        interpretacion: _interp ? _interp.interpretarVentas(plData, { totalFact }) : null,
        chartLabels: ML,
        chartDatasets: [
          { label:'Facturación', data: allKeys.map(k => mFact[k]||0), backgroundColor: CC.utilidad+'BB', borderRadius: 5, type:'bar' },
          { label:'Cobrado',     data: allKeys.map(k => mCob[k]||0),  borderColor: CC.ingresos, backgroundColor: CC.ingresos+'25', fill: true, tension: 0.4, type:'line' },
        ],
        chartOptions: { refLines: metaFact > 0 ? [{ y: metaFact, label: `Meta ${cop(metaFact)}`, color: CC.margen }] : [] },
        tabla: {
          cols: ['Mes','# Ventas','Facturación','Cobrado','Diferencia','Ticket Prom.'],
          rows: allKeys.map((k, i) => {
            const nV = ventas.filter(v => { const d = u.parseDate(v.fecha); return d && u.monthKey(d) === k; }).length;
            const f = mFact[k]||0; const c = mCob[k]||0; const diff = f - c;
            return [u.monthLabel(k), nV, cop(f), cop(c), { val: cop(diff), color: diff > 0 ? CC.alerta : CC.ingresos }, cop(nV > 0 ? f/nV : 0)];
          }),
        },
      };
    }

    // ── V2: Pipeline ──────────────────────────────────────────────────────────
    case 'V2': {
      const encargos  = raw.ventas.filter(v => v.tipo_venta === 'Encargo');
      const cerradas  = raw.ventas.filter(v => ['Completado Local','Entregado'].some(s => (v.estado_orden||'').includes(s)));
      const tasa      = encargos.length > 0 ? (cerradas.length / raw.ventas.length) * 100 : 0;
      const estados   = {};
      raw.ventas.forEach(v => { const e = v.estado_orden||'Sin Estado'; if (!estados[e]) estados[e] = { n:0, val:0 }; estados[e].n++; estados[e].val += parseFloat(v.valor_total_cop||0); });
      const estArr = Object.entries(estados).sort((a,b) => b[1].n - a[1].n);

      return {
        kpis: [
          { label:'Total Órdenes',          valor: raw.ventas.length, color: CC.utilidad },
          { label:'Tasa de Conversión',      valor: pct(tasa),         color: tasa >= getMeta('meta_conversion_pct',60) ? CC.ingresos : CC.alerta, sub: `Meta: ${getMeta('meta_conversion_pct',60)}%` },
          { label:'Completadas / Cerradas', valor: cerradas.length,    color: CC.ingresos },
          { label:'Cotizaciones Abiertas',  valor: encargos.filter(e => e.estado_orden === 'Validando Compra EEUU').length, color: CC.alerta },
        ],
        interpretacion: null,
        chartLabels: estArr.map(e => e[0].slice(0,20)),
        chartDatasets: [{ label:'# Órdenes', data: estArr.map(e => e[1].n), backgroundColor: CC.palette, borderRadius: 6 }],
        chartOptions: { horizontal: true },
        tabla: {
          cols: ['Estado Orden','# Órdenes','Valor Total'],
          rows: estArr.map(([est, d]) => [est, d.n, cop(d.val)]),
        },
      };
    }

    // ── V3: Clientes Top ──────────────────────────────────────────────────────
    case 'V3': {
      const cliMap = {};
      raw.ventas.forEach(v => {
        const cid = v.cliente_id?.toString(); if (!cid) return;
        if (!cliMap[cid]) cliMap[cid] = { f:0, c:0, saldo:0, n:0 };
        cliMap[cid].f += parseFloat(v.valor_total_cop||0);
        cliMap[cid].c += parseFloat(v.abonos_acumulados||0);
        cliMap[cid].saldo += parseFloat(v.saldo_pendiente||0);
        cliMap[cid].n++;
      });
      const top = Object.entries(cliMap).sort((a,b) => b[1].f - a[1].f).slice(0,12).map(([id,d]) => ({ nombre: clienteN(id), id, ...d }));
      const top5Rev = top.slice(0,5).reduce((s,c) => s+c.f, 0);
      const totalRev = top.reduce((s,c) => s+c.f, 0);

      return {
        kpis: [
          { label:'Top cliente por Revenue', valor: top[0]?.nombre || '—', color: CC.ingresos, sub: top[0] ? cop(top[0].f) : '—' },
          { label:'Concentración Top 5',     valor: totalRev > 0 ? pct(top5Rev/totalRev*100) : '—', color: CC.margen, sub: 'del revenue total' },
          { label:'Clientes activos',        valor: raw.clientes.length, color: CC.utilidad },
          { label:'LTV Promedio',            valor: top.length > 0 ? cop(top.reduce((s,c) => s+c.f, 0)/top.length) : '—', color: CC.ingresos },
        ],
        interpretacion: _interp ? _interp.interpretarClientes(top, null) : null,
        chartLabels: top.map(c => c.nombre),
        chartDatasets: [
          { label:'Cobrado COP',  data: top.map(c => c.c), backgroundColor: CC.ingresos+'BB', borderRadius: 5 },
          { label:'Pendiente COP',data: top.map(c => c.saldo), backgroundColor: CC.alerta+'BB', borderRadius: 5 },
        ],
        chartOptions: { horizontal: true, stacked: true },
        tabla: {
          cols: ['Cliente','# Órdenes','Revenue Total','Cobrado','Saldo Pendiente'],
          rows: top.map(c => [c.nombre, c.n, cop(c.f), cop(c.c), { val: cop(c.saldo), color: c.saldo > 0 ? CC.gastosOp : CC.ingresos }]),
        },
      };
    }

    // ── VA1–VA8: Reportes de Análisis de Oferta ─────────────────────────────
    case 'VA1': case 'VA2': case 'VA3': case 'VA4':
    case 'VA5': case 'VA6': case 'VA7': case 'VA8': {
      // Cargar el motor de análisis de ventas
      const vau = await loadVAU();

      // ── Construir mapa producto_id → producto para el JOIN ────────────────────
      const productosMap = {};
      (raw.productos || []).forEach(p => {
        if (p.id != null) productosMap[p.id.toString()] = p;
      });

      // Enriquecer TODAS las ventas con campos derivados
      const ventasRaw = (raw.ventas || []).filter(v => v.valor_total_cop || v.valor_venta_cop);
      const ventasE   = ventasRaw.map(v => vau.enriquecerVenta(v, productosMap));

      // Aplicar filtro de fechas sobre ventas enriquecidas
      const vFilt = ventasE.filter(v => {
        if (!v.fecha) return true;
        const d = (u.parseDate(v.fecha)||new Date()).toISOString().split('T')[0];
        if (_desde && d < _desde) return false;
        if (_hasta && d > _hasta) return false;
        return true;
      });

      const totalRev  = vFilt.reduce((s, v) => s + v.revenueTotalCOP, 0);
      const totalGan  = vFilt.reduce((s, v) => s + v.gananciaTotalCOP, 0);
      const metaMrgMin = getMeta('meta_margen_neto_pct', 15);
      const PALETTE_VA = ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6','#2DD4BF','#FB923C','#34D399','#818CF8','#60A5FA','#FBBF24'];

      if (vFilt.length === 0) {
        return {
          kpis: [{ label: 'Sin datos', valor: 'No hay ventas en el período', color: CC.neutro }],
          interpretacion: 'No se encontraron ventas en el período seleccionado. Ajusta el filtro de fechas.',
          chartLabels: [], chartDatasets: [], chartOptions: {},
          tabla: { cols: ['Mensaje'], rows: [['Sin datos en el período seleccionado']] },
        };
      }

      // ─── VA1: Análisis por Marca ───────────────────────────────────────────────
      if (rptId === 'VA1') {
        const agrup  = vau.agruparPorDimension(vFilt, 'marca');
        const marcas = vau.dimensionToArray(agrup, 'marca').sort((a, b) => b.revenueCOP - a.revenueCOP);
        const top    = marcas[0] || {};
        const topMrg = [...marcas].sort((a, b) => b.margenPct - a.margenPct)[0] || {};
        const concPct = totalRev > 0 ? (top.revenueCOP || 0) / totalRev * 100 : 0;

        const estBadge = (m) => m.margenPct > 25 && m.revenueCOP > totalRev * 0.15 ? '⭐ Estrella'
          : m.margenPct >= metaMrgMin ? '✅ Rentable'
          : m.margenPct > 0 ? '⚠️ Revisar' : '— Sin datos';
        const estColor = (m) => m.margenPct >= 25 ? CC.comprasUSA : m.margenPct >= metaMrgMin ? CC.ingresos : CC.gastosOp;

        return {
          kpis: [
            { label: 'Marca #1 por Revenue',      valor: top.marca || '—',       color: CC.ingresos,   sub: cop(top.revenueCOP || 0) },
            { label: 'Marca #1 por Margen',        valor: topMrg.marca || '—',    color: CC.margen,     sub: pct(topMrg.margenPct || 0) },
            { label: 'Marcas Activas',             valor: marcas.length,          color: CC.utilidad },
            { label: 'Concentración Top Marca',    valor: pct(concPct),           color: concPct > 60 ? CC.gastosOp : concPct < 40 ? CC.ingresos : CC.alerta, sub: concPct > 60 ? '⚠️ Alta concentración' : '✅ Diversificado' },
          ],
          interpretacion: vau.interpretarMarcas(marcas, totalRev, metaMrgMin),
          chartLabels: marcas.map(m => m.marca),
          chartDatasets: [
            { label: 'Revenue COP',  data: marcas.map(m => m.revenueCOP),  backgroundColor: marcas.map((m, i) => vau.getBrandColor(m.marca, i) + 'BB'), borderRadius: 6 },
            { label: 'Ganancia COP', data: marcas.map(m => m.gananciaCOP), backgroundColor: marcas.map((m, i) => vau.getBrandColor(m.marca, i) + '55'), borderRadius: 6 },
          ],
          chartOptions: { horizontal: true },
          tabla: {
            cols: ['Marca', 'Ventas', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %', 'Markup %', 'USD Prom.', 'Estado'],
            rows: marcas.map(m => [
              m.marca,
              m.ventas,
              m.unidades,
              cop(m.revenueCOP),
              { val: cop(m.gananciaCOP), color: CC.ingresos },
              { val: pct(m.margenPct), color: estColor(m) },
              pct(m.markupPct),
              `$${(m.valorUSDPromedio).toFixed(2)}`,
              { val: estBadge(m), color: estColor(m) },
            ]),
          },
        };
      }

      // ─── VA2: Análisis por Categoría ──────────────────────────────────────────
      if (rptId === 'VA2') {
        const agrup = vau.agruparPorDimension(vFilt, 'categoria');
        const cats  = vau.dimensionToArray(agrup, 'categoria').sort((a, b) => b.unidades - a.unidades);
        const topVol = cats[0] || {};
        const topMrg = [...cats].sort((a, b) => b.margenPct - a.margenPct)[0] || {};
        const topRev = [...cats].sort((a, b) => b.revenueCOP - a.revenueCOP)[0] || {};

        return {
          kpis: [
            { label: 'Categoría #1 por Volumen', valor: topVol.categoria || '—', color: CC.ingresos,  sub: `${topVol.unidades || 0} uds` },
            { label: 'Categoría #1 por Margen',  valor: topMrg.categoria || '—', color: CC.margen,   sub: pct(topMrg.margenPct || 0) },
            { label: 'Categorías Activas',       valor: cats.length,             color: CC.utilidad },
            { label: 'Mayor Revenue',              valor: topRev.categoria || '—', color: CC.comprasUSA, sub: cop(topRev.revenueCOP || 0) },
          ],
          interpretacion: vau.interpretarCategorias(cats, totalRev),
          chartLabels: cats.map(c => c.categoria),
          chartDatasets: [
            { label: 'Revenue COP',  data: cats.map(c => c.revenueCOP),  backgroundColor: cats.map((_, i) => PALETTE_VA[i % PALETTE_VA.length] + 'BB'), borderRadius: 6 },
            { label: 'Ganancia COP', data: cats.map(c => c.gananciaCOP), backgroundColor: cats.map((_, i) => PALETTE_VA[i % PALETTE_VA.length] + '55'), borderRadius: 6 },
          ],
          chartOptions: {},
          tabla: {
            cols: ['Categoría', 'Ventas', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %', 'Marcas Activas', 'Talla Más Pedida'],
            rows: cats.map(c => [
              c.categoria,
              c.ventas,
              c.unidades,
              cop(c.revenueCOP),
              { val: cop(c.gananciaCOP), color: CC.ingresos },
              { val: pct(c.margenPct), color: c.margenPct >= metaMrgMin ? CC.ingresos : CC.gastosOp },
              c.marcas.slice(0, 3).join(', ') || '—',
              c.tallas[0] || '—',
            ]),
          },
        };
      }

      // ─── VA3: Análisis por Tienda ──────────────────────────────────────────────
      if (rptId === 'VA3') {
        const agrup   = vau.agruparPorDimension(vFilt, 'tiendaCotizar');
        const tiendas = vau.dimensionToArray(agrup, 'tiendaCotizar').sort((a, b) => b.ventas - a.ventas);
        const topUso  = tiendas[0] || {};
        const topMrg  = [...tiendas].sort((a, b) => b.margenPct - a.margenPct)[0] || {};
        const topRev  = [...tiendas].sort((a, b) => b.revenueCOP - a.revenueCOP)[0] || {};
        const avgUSD  = vFilt.length > 0 ? vFilt.reduce((s, v) => s + v.valorCotizadoUSD, 0) / vFilt.length : 0;

        return {
          kpis: [
            { label: 'Tienda Más Usada',         valor: topUso.tiendaCotizar || '—', color: CC.ingresos,  sub: `${topUso.ventas || 0} cotizaciones` },
            { label: 'Mejor Margen Promedio',     valor: topMrg.tiendaCotizar || '—', color: CC.margen,   sub: pct(topMrg.margenPct || 0) },
            { label: 'Mayor Revenue',              valor: topRev.tiendaCotizar || '—', color: CC.comprasUSA, sub: cop(topRev.revenueCOP || 0) },
            { label: 'Precio USD Prom. General',   valor: `$${avgUSD.toFixed(2)}`,       color: CC.neutro },
          ],
          interpretacion: vau.interpretarTiendas(tiendas),
          chartLabels: tiendas.map(t => t.tiendaCotizar),
          chartDatasets: [
            { label: 'Cotizaciones',  data: tiendas.map(t => t.ventas),    backgroundColor: tiendas.map((_, i) => PALETTE_VA[i % PALETTE_VA.length] + 'BB'), borderRadius: 6 },
            { label: 'Margen % Prom', data: tiendas.map(t => t.margenPct), type: 'line', borderColor: CC.margen, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 5, fill: false, yAxisID: 'y2' },
          ],
          chartOptions: { horizontal: true, dualY: true },
          tabla: {
            cols: ['Tienda', 'Ventas', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %', 'USD Prom.', 'TRM Prom.', 'Categorías'],
            rows: tiendas.map(t => [
              t.tiendaCotizar,
              t.ventas,
              t.unidades,
              cop(t.revenueCOP),
              { val: cop(t.gananciaCOP), color: CC.ingresos },
              { val: pct(t.margenPct), color: t.margenPct >= metaMrgMin ? CC.ingresos : CC.gastosOp },
              `$${(t.valorUSDPromedio).toFixed(2)}`,
              Math.round(t.trmPromedio).toLocaleString('es-CO'),
              t.categorias.slice(0, 2).join(', ') || '—',
            ]),
          },
        };
      }

      // ─── VA4: Análisis por Talla ───────────────────────────────────────────────
      if (rptId === 'VA4') {
        const agrup  = vau.agruparPorDimension(vFilt, 'talla');
        const tallas = vau.dimensionToArray(agrup, 'talla').sort((a, b) => b.unidades - a.unidades);
        const topVol = tallas[0] || {};
        const topMrg = [...tallas].sort((a, b) => b.margenPct - a.margenPct)[0] || {};
        const topRev = [...tallas].sort((a, b) => b.revenueCOP - a.revenueCOP)[0] || {};

        return {
          kpis: [
            { label: 'Talla Más Pedida',      valor: topVol.talla || '—', color: CC.ingresos,  sub: `${topVol.unidades || 0} unidades` },
            { label: 'Talla Mejor Margen',    valor: topMrg.talla || '—', color: CC.margen,   sub: pct(topMrg.margenPct || 0) },
            { label: 'Tallas Activas',        valor: tallas.length,       color: CC.utilidad },
            { label: 'Mayor Revenue por Talla',valor: topRev.talla || '—', color: CC.comprasUSA, sub: cop(topRev.revenueCOP || 0) },
          ],
          interpretacion: vau.interpretarTallas(tallas),
          chartLabels: tallas.map(t => t.talla),
          chartDatasets: [
            { label: 'Unidades Vendidas', data: tallas.map(t => t.unidades),
              backgroundColor: tallas.map((_, i) => `hsl(${200 - i * 15},70%,55%)BB`), borderRadius: 4 },
          ],
          chartOptions: {},
          tabla: {
            cols: ['Talla', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %', 'Precio Prom.', 'Marcas Asociadas', 'Categorías'],
            rows: tallas.map(t => [
              t.talla,
              t.unidades,
              cop(t.revenueCOP),
              { val: cop(t.gananciaCOP), color: CC.ingresos },
              { val: pct(t.margenPct), color: t.margenPct >= metaMrgMin ? CC.ingresos : CC.gastosOp },
              cop(t.ventas > 0 ? t.revenueCOP / t.unidades : 0),
              t.marcas.slice(0, 3).join(', ') || '—',
              t.categorias.slice(0, 2).join(', ') || '—',
            ]),
          },
        };
      }

      // ─── VA5: Análisis por Género ─────────────────────────────────────────────
      if (rptId === 'VA5') {
        const agrup   = vau.agruparPorDimension(vFilt, 'genero');
        const generos = vau.dimensionToArray(agrup, 'genero').sort((a, b) => b.revenueCOP - a.revenueCOP);
        const dominante = generos[0] || {};
        const topMrg   = [...generos].sort((a, b) => b.margenPct - a.margenPct)[0] || {};
        const GENERO_COLORS = { 'Hombre':'#4CC9F0','Mujer':'#F472B6','Niño':'#06D6A0','Unisex':'#FFB703','Sin especificar':CC.neutro };
        const gColor = (g) => GENERO_COLORS[g] || CC.palette[0];

        return {
          kpis: [
            { label: 'Género Mayor Revenue',  valor: dominante.genero || '—', color: gColor(dominante.genero), sub: totalRev > 0 ? pct(dominante.revenueCOP / totalRev * 100) + ' del total' : '—' },
            { label: 'Mejor Margen',           valor: topMrg.genero || '—',    color: CC.margen,                sub: pct(topMrg.margenPct || 0) },
            { label: 'Géneros Activos',        valor: generos.length,            color: CC.utilidad },
            { label: 'Revenue Total Período',   valor: cop(totalRev),             color: CC.ingresos },
          ],
          interpretacion: vau.interpretarGeneros(generos, totalRev),
          chartLabels: generos.map(g => g.genero),
          chartDatasets: [
            { label: 'Revenue COP',  data: generos.map(g => g.revenueCOP),  backgroundColor: generos.map(g => gColor(g.genero) + 'BB') },
            { label: 'Ganancia COP', data: generos.map(g => g.gananciaCOP), backgroundColor: generos.map(g => gColor(g.genero) + '55') },
          ],
          chartOptions: {},
          tabla: {
            cols: ['Género', 'Ventas', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %', 'Precio Prom.', 'Marca Top', 'Categoría Top'],
            rows: generos.map(g => [
              { val: g.genero, color: gColor(g.genero) },
              g.ventas,
              g.unidades,
              cop(g.revenueCOP),
              { val: cop(g.gananciaCOP), color: CC.ingresos },
              { val: pct(g.margenPct), color: g.margenPct >= metaMrgMin ? CC.ingresos : CC.gastosOp },
              cop(g.unidades > 0 ? g.revenueCOP / g.unidades : 0),
              g.marcas[0] || '—',
              g.categorias[0] || '—',
            ]),
          },
        };
      }

      // ─── VA6: Mapa de Calor Marca × Categoría ────────────────────────────────
      if (rptId === 'VA6') {
        const { marcas: mL, categorias: cL, matriz } = vau.construirMatrizMarcaCategoria(vFilt, 'unidades');
        // Encontrar la combinación top
        let topComb = { marca: '—', categoria: '—', valor: 0, margen: 0 };
        let topMrgComb = { marca: '—', categoria: '—', margen: 0 };
        let totalCombActivas = 0;
        matriz.forEach((row) => {
          row.valores.forEach((cel, ci) => {
            if (cel.valor > 0) {
              totalCombActivas++;
              if (cel.valor > topComb.valor) topComb = { marca: row.marca, categoria: cL[ci], valor: cel.valor };
              const mrg = cel.ventas.length > 0 ? cel.ventas.reduce((s, v) => s + v.margenPct, 0) / cel.ventas.length : 0;
              if (mrg > topMrgComb.margen) topMrgComb = { marca: row.marca, categoria: cL[ci], margen: mrg };
            }
          });
        });
        const combinacionesPosibles = mL.length * cL.length;
        const sinVentas = combinacionesPosibles - totalCombActivas;

        // Construir datasets para el heatmap usando barras apiladas por categoría
        const heatDatasets = cL.map((cat, ci) => ({
          label: cat,
          data: mL.map(marca => {
            const row = matriz.find(r => r.marca === marca);
            return row ? (row.valores[ci]?.valor || 0) : 0;
          }),
          backgroundColor: PALETTE_VA[ci % PALETTE_VA.length] + 'BB',
          borderRadius: 4,
          stack: 'heat',
        }));

        return {
          kpis: [
            { label: 'Combinación Más Vendida',   valor: `${topComb.marca} × ${topComb.categoria}`, color: CC.ingresos, sub: `${topComb.valor} uds` },
            { label: 'Combinación Más Rentable',  valor: `${topMrgComb.marca} × ${topMrgComb.categoria}`, color: CC.margen, sub: pct(topMrgComb.margen) },
            { label: 'Combinaciones Activas',      valor: totalCombActivas, color: CC.utilidad },
            { label: 'Combinaciones Sin Ventas',   valor: sinVentas, color: sinVentas > 0 ? CC.alerta : CC.ingresos, sub: 'Oportunidades potenciales' },
          ],
          interpretacion: vau.interpretarMatriz(mL, cL, vFilt),
          chartLabels: mL,
          chartDatasets: heatDatasets,
          chartOptions: { stacked: true, horizontal: true },
          tabla: {
            cols: ['Marca', 'Categoría', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen %'],
            rows: mL.flatMap(marca => {
              const row = matriz.find(r => r.marca === marca);
              return cL.map((cat, ci) => {
                const cel = row?.valores[ci];
                if (!cel || cel.valor === 0) return null;
                const rev = cel.ventas.reduce((s, v) => s + v.revenueTotalCOP, 0);
                const gan = cel.ventas.reduce((s, v) => s + v.gananciaTotalCOP, 0);
                const mrg = cel.ventas.length > 0 ? cel.ventas.reduce((s, v) => s + v.margenPct, 0) / cel.ventas.length : 0;
                return [marca, cat, cel.valor, cop(rev), { val: cop(gan), color: CC.ingresos }, { val: pct(mrg), color: mrg >= metaMrgMin ? CC.ingresos : CC.gastosOp }];
              }).filter(Boolean);
            }),
          },
        };
      }

      // ─── VA7: Precio, TRM y Margen ───────────────────────────────────────────
      if (rptId === 'VA7') {
        const ventasTRM = vFilt.filter(v => v.trmCotizada > 0);
        const trmProm = ventasTRM.length > 0 ? ventasTRM.reduce((s, v) => s + v.trmCotizada, 0) / ventasTRM.length : 0;
        const trmMin  = ventasTRM.length > 0 ? Math.min(...ventasTRM.map(v => v.trmCotizada)) : 0;
        const trmMax  = ventasTRM.length > 0 ? Math.max(...ventasTRM.map(v => v.trmCotizada)) : 0;
        const rangos  = vau.agruparPorRangoPrecioUSD(vFilt);
        const rangoTop= rangos.sort((a, b) => b.ventas - a.ventas)[0];

        // Datos scatter: USD vs Margen %
        const scatterData = vFilt.slice(0, 100).map(v => ({
          x: parseFloat(v.valorCotizadoUSD.toFixed(2)),
          y: parseFloat(v.margenPct.toFixed(2)),
        }));

        return {
          kpis: [
            { label: 'TRM Promedio del Período', valor: Math.round(trmProm).toLocaleString('es-CO'), color: CC.comprasUSA },
            { label: 'Rango TRM (Min – Max)',     valor: trmMin > 0 ? `${Math.round(trmMin).toLocaleString('es-CO')} – ${Math.round(trmMax).toLocaleString('es-CO')}` : '—', color: CC.neutro },
            { label: 'Rango USD Más Vendido',     valor: rangoTop?.rango || '—', color: CC.utilidad, sub: `${rangoTop?.ventas || 0} ventas` },
            { label: 'Margen Promedio General',   valor: pct(vFilt.length > 0 ? vFilt.reduce((s, v) => s + v.margenPct, 0) / vFilt.length : 0), color: CC.margen },
          ],
          interpretacion: vau.interpretarPreciosTRM(vFilt),
          chartLabels: rangos.map(r => r.rango),
          chartDatasets: [
            { label: 'Cantidad de Ventas', data: rangos.map(r => r.ventas), backgroundColor: PALETTE_VA.slice(0, rangos.length).map(c => c + 'BB'), borderRadius: 6 },
            { label: 'Margen % Prom.',     data: rangos.map(r => r.margenPromedio), type: 'line', borderColor: CC.margen, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 5, fill: false, yAxisID: 'y2' },
          ],
          chartOptions: { dualY: true, refLines: [{ y: metaMrgMin, label: 'Meta margen', color: CC.gastosOp }] },
          tabla: {
            cols: ['Rango USD', 'Ventas', 'Unidades', 'Revenue COP', 'Ganancia COP', 'Margen % Prom.'],
            rows: rangos.map(r => [
              r.rango,
              r.ventas,
              r.unidades,
              cop(r.revenueCOP),
              { val: cop(r.gananciaCOP), color: CC.ingresos },
              { val: pct(r.margenPromedio), color: r.margenPromedio >= metaMrgMin ? CC.ingresos : CC.gastosOp },
            ]),
          },
        };
      }

      // ─── VA8: Ranking de Modelos ───────────────────────────────────────────────
      if (rptId === 'VA8') {
        const modelos    = vau.rankingModelos(vFilt);
        const top1       = modelos[0] || {};
        const topGan     = [...modelos].sort((a, b) => b.gananciaCOP - a.gananciaCOP)[0] || {};
        const candidatos = modelos.filter(m => m.vecesRepetido >= 3);
        const repProm    = modelos.length > 0 ? modelos.reduce((s, m) => s + m.vecesRepetido, 0) / modelos.length : 0;

        const candidatoBadge = (m) => m.candidatoStock === 'si' ? `✅ Sí (${m.vecesRepetido}x)` : m.candidatoStock === 'potencial' ? `🟡 Potencial` : `⚪ Puntual`;
        const candidatoColor = (m) => m.candidatoStock === 'si' ? CC.ingresos : m.candidatoStock === 'potencial' ? CC.alerta : CC.neutro;

        return {
          kpis: [
            { label: 'Modelo #1 Más Pedido',   valor: (top1.nombre || '—').slice(0, 25), color: CC.ingresos,   sub: `${top1.unidades || 0} uds • ${cop(top1.revenueCOP || 0)}` },
            { label: 'Modelo Más Rentable',    valor: (topGan.nombre || '—').slice(0, 25), color: CC.margen,    sub: `${cop(topGan.gananciaCOP || 0)} ganancia` },
            { label: 'Modelos Únicos',          valor: modelos.length,                  color: CC.utilidad },
            { label: 'Candidatos Stock (3+x)',   valor: candidatos.length,               color: candidatos.length > 0 ? CC.comprasUSA : CC.neutro, sub: `Repetición prom: ${repProm.toFixed(1)}x` },
          ],
          interpretacion: vau.interpretarModelos(modelos),
          chartLabels: modelos.slice(0, 20).map(m => m.nombre.slice(0, 28)),
          chartDatasets: [
            { label: 'Unidades', data: modelos.slice(0, 20).map(m => m.unidades),
              backgroundColor: modelos.slice(0, 20).map(m => vau.getBrandColor(m.marca, 0) + 'BB'), borderRadius: 5 },
          ],
          chartOptions: { horizontal: true },
          tabla: {
            cols: ['Pos.', 'Modelo', 'Marca', 'Categoría', 'Género', 'Talla(s)', 'Uds', 'Revenue', 'Ganancia', 'Margen %', 'Repeticiones', 'Stock?'],
            rows: modelos.slice(0, 40).map((m, i) => [
              i + 1,
              m.nombre.slice(0, 30) + (m.nombre.length > 30 ? '…' : ''),
              m.marca || '—',
              m.categoria || '—',
              m.genero || '—',
              m.tallas || '—',
              m.unidades,
              cop(m.revenueCOP),
              { val: cop(m.gananciaCOP), color: CC.ingresos },
              { val: pct(m.margenPromedio), color: m.margenPromedio >= metaMrgMin ? CC.ingresos : CC.gastosOp },
              { val: `${m.vecesRepetido}x`, color: m.vecesRepetido >= 3 ? CC.ingresos : m.vecesRepetido >= 2 ? CC.alerta : CC.neutro },
              { val: candidatoBadge(m), color: candidatoColor(m) },
            ]),
          },
        };
      }

      // Fallback VA
      return {
        kpis: [], interpretacion: null,
        chartLabels: [], chartDatasets: [], chartOptions: {},
        tabla: { cols: ['Reporte no implementado'], rows: [] },
      };
    }

    // ── L1: Seguimientos ────────────────────────────────────────────────
    case 'L1': {
      const mapFase = (f='') => {
        if (f.includes('6') || f.toLowerCase().includes('entregado')) return 'Entregado';
        if (f.includes('5') || f.toLowerCase().includes('colombia')) return 'Bodega Colombia';
        if (f.includes('4') || f.toLowerCase().includes('aduana')) return 'Aduana';
        if (f.includes('3') || f.toLowerCase().includes('bodega') || f.toLowerCase().includes('usa')) return 'Bodega USA';
        if (f.includes('2') || f.toLowerCase().includes('tránsito') || f.toLowerCase().includes('tienda')) return 'En Tránsito';
        return 'Comprado';
      };
      const faseCount = {};
      raw.logistica.forEach(l => { const f = mapFase(l.fase); faseCount[f] = (faseCount[f]||0) + 1; });
      const faseColors = { 'Entregado':CC.ingresos,'Bodega Colombia':CC.margen,'Aduana':CC.utilidad,'Bodega USA':CC.alerta,'En Tránsito':'#2DD4BF','Comprado':CC.gastosOp };
      const activos = raw.logistica.filter(l => mapFase(l.fase) !== 'Entregado').length;
      const retrLen = raw.logistica.filter(l => { if(mapFase(l.fase) === 'Entregado') return false; const d = u.parseDate(l.updated_at||l.fecha_registro); return d && (Date.now()-d)/86400000 > getMeta('dias_retraso_envio_critico',7); }).length;
      const totLog  = raw.logistica.length || 1;
      const otd     = Math.round((raw.logistica.filter(l => mapFase(l.fase) === 'Entregado').length / totLog) * 100);

      return {
        kpis: [
          { label:'Envíos Activos Totales', valor: activos, color: CC.utilidad },
          { label:'Retrasados (>7d sin upd)', valor: retrLen, color: retrLen > 0 ? CC.gastosOp : CC.ingresos },
          { label:'On-Time Delivery Rate', valor: pct(otd), color: otd >= getMeta('meta_envios_tiempo_pct',90) ? CC.ingresos : CC.alerta, sub: `Meta: ${getMeta('meta_envios_tiempo_pct',90)}%` },
          { label:'Total Envíos Histórico', valor: raw.logistica.length, color: CC.neutro },
        ],
        interpretacion: _interp ? _interp.interpretarEnvios(raw.logistica) : null,
        chartLabels: Object.keys(faseCount),
        chartDatasets: [{ label:'Envíos por Fase', data: Object.values(faseCount), backgroundColor: Object.keys(faseCount).map(f => (faseColors[f]||CC.neutro)+'BB'), borderRadius: 8 }],
        chartOptions: {},
        tabla: {
          cols: ['ID Envío','Venta','Cliente','Fase Actual','Días sin actualización'],
          rows: raw.logistica.filter(l => mapFase(l.fase) !== 'Entregado').slice(0,30).map(l => {
            const v = raw.ventas.find(x => x.id?.toString() === l.venta_id?.toString());
            const d = u.parseDate(l.updated_at||l.fecha_registro);
            const dias = d ? Math.floor((Date.now()-d)/86400000) : '—';
            const fase = mapFase(l.fase);
            const retrasado = typeof dias === 'number' && dias > getMeta('dias_retraso_envio_critico',7);
            return [`#${l.venta_id?.toString().slice(-4)||'?'}`, v ? `Ord #${v.id?.toString().slice(-4)}` : '—', v ? clienteN(v.cliente_id) : '—', { val: fase, color: faseColors[fase]||CC.neutro }, { val: `${dias}d`, color: retrasado ? CC.gastosOp : 'inherit' }];
          }),
        },
      };
    }

    // ── L2: Compras USA ────────────────────────────────────────────────────────
    case 'L2': {
      const comprasMap = byMonth(compras, x => x.fecha_pedido||x.fecha_registro, 'costo_cop');
      const actComp = raw.compras.filter(c => !['Entregado','Completado'].includes(c.estado));
      const avgCosto = compras.length > 0 ? compras.reduce((s,c) => s+parseFloat(c.costo_cop||0),0)/compras.length : 0;

      return {
        kpis: [
          { label:'Órdenes Activas',    valor: actComp.length, color: CC.alerta, sub: cop(actComp.reduce((s,c) => s+parseFloat(c.costo_cop||0),0)) },
          { label:'Costo Promedio Orden',valor: cop(avgCosto), color: CC.comprasUSA },
          { label:'Total Período',      valor: cop(totalComp), color: CC.gastosOp },
          { label:'Proveedores Únicos', valor: [...new Set(compras.map(c => c.proveedor).filter(Boolean))].length, color: CC.neutro },
        ],
        interpretacion: null,
        chartLabels: ML,
        chartDatasets: [{ label:'Costo Compras USA (COP)', data: allKeys.map(k => comprasMap[k]||0), backgroundColor: CC.comprasUSA+'BB', borderRadius: 6 }],
        chartOptions: {},
        tabla: {
          cols: ['Proveedor','Estado','Costo COP','Fecha Pedido'],
          rows: compras.slice(0,30).map(c => [c.proveedor||'—', c.estado||'—', { val: cop(c.costo_cop), color: CC.comprasUSA }, (c.fecha_pedido||c.fecha_registro||'').split('T')[0]]),
        },
      };
    }

    // ── L3: Inventario ────────────────────────────────────────────────────────
    case 'L3': {
      const invData = u.calcularRotacionInventario(raw.productos, raw.ventas);
      const sinMov  = invData.filter(p => p.estado === 'sin_movimiento').length;
      const critiI  = invData.filter(p => p.estado === 'critico').length;
      const valTot  = invData.reduce((s,p) => s+p.valorInventario, 0);
      const avgRot  = invData.filter(p => p.diasRotacion < 999).reduce((s,p,_,arr) => s + p.diasRotacion/arr.length, 0);

      return {
        kpis: [
          { label:'Días Prom. Rotación',    valor: `${Math.round(avgRot)} días`, color: avgRot < 30 ? CC.ingresos : avgRot < 60 ? CC.alerta : CC.gastosOp },
          { label:'Valor Total Inventario', valor: cop(valTot), color: CC.utilidad },
          { label:'SKUs Stock Crítico',     valor: critiI, color: critiI > 0 ? CC.gastosOp : CC.ingresos },
          { label:'Sin movimiento 60d',     valor: sinMov, color: sinMov > 0 ? CC.alerta : CC.ingresos },
        ],
        interpretacion: _interp ? _interp.interpretarInventario(invData) : null,
        chartLabels: invData.slice(0,15).map(p => p.nombre?.slice(0,18)||'—'),
        chartDatasets: [{ label:'Días de Rotación', data: invData.slice(0,15).map(p => Math.min(p.diasRotacion, 120)), backgroundColor: invData.slice(0,15).map(p => p.diasRotacion < 30 ? CC.ingresos+'BB' : p.diasRotacion < 60 ? CC.alerta+'BB' : CC.gastosOp+'BB'), borderRadius: 6 }],
        chartOptions: { horizontal: true, refLines: [{ y: 30, label:'Meta rotación', color: CC.ingresos }] },
        tabla: {
          cols: ['Producto','SKU','Stock','Días Rotación','Última Venta','Valor','Estado'],
          rows: invData.slice(0,30).map(p => {
            const stC = p.estado === 'optimo' ? CC.ingresos : p.estado === 'lento' ? CC.alerta : CC.gastosOp;
            const stL = { optimo:'🟢 Óptimo', lento:'🟡 Lento', sin_movimiento:'⚫ Sin movimiento', critico:'🔴 Crítico' }[p.estado];
            return [p.nombre?.slice(0,20)||'—', p.sku||'—', p.stock, { val: p.diasRotacion > 300 ? '—' : `${p.diasRotacion}d`, color: stC }, p.ultimaVenta ? p.ultimaVenta.split('T')[0] : '—', cop(p.valorInventario), { val: stL, color: stC }];
          }),
        },
      };
    }

    // ── C1: Segmentación ──────────────────────────────────────────────────────
    case 'C1': {
      const seg = u.calcularSegmentacion(raw.clientes, raw.ventas);
      const segMap = { estrella:0, grande_ocasional:0, regular:0, recuperar:0 };
      seg.forEach(s => { if (segMap[s.segmento] !== undefined) segMap[s.segmento]++; });
      const estrellas2 = seg.filter(s => s.segmento === 'estrella');
      const estRevPct = seg.reduce((s,c) => s+c.revenueTotal, 0);

      return {
        kpis: [
          { label:'Clientes Activos', valor: seg.filter(s => s.estado === 'activo').length, color: CC.ingresos },
          { label:'Segmento Estrella', valor: estrellas2.length, color: CC.comprasUSA, sub: estrellas2.length > 0 ? `${pct(estrellas2.reduce((s,c)=>s+c.revenueTotal,0)/Math.max(estRevPct,1)*100)} del revenue` : '—' },
          { label:'En Riesgo de Churn', valor: seg.filter(s => s.estado === 'en_riesgo').length, color: CC.alerta },
          { label:'Inactivos', valor: seg.filter(s => s.estado === 'inactivo').length, color: CC.gastosOp },
        ],
        interpretacion: _interp ? _interp.interpretarClientes(seg, null) : null,
        chartLabels: ['⭐ Estrella','🎯 Grandes Ocasionales','📦 Regulares','💤 Recuperar'],
        chartDatasets: [{ label:'# Clientes', data: Object.values(segMap), backgroundColor: [CC.comprasUSA+'BB', CC.utilidad+'BB', CC.ingresos+'BB', CC.gastosOp+'BB'] }],
        chartOptions: {},
        tabla: {
          cols: ['Cliente','Segmento','Revenue Total','Frecuencia/mes','Ticket Prom.','Días sin pedido','Estado'],
          rows: seg.slice(0,30).map(s => {
            const sC = s.segmento === 'estrella' ? CC.comprasUSA : s.segmento === 'regular' ? CC.ingresos : s.segmento === 'grande_ocasional' ? CC.utilidad : CC.gastosOp;
            const sL = { estrella:'⭐ Estrella', grande_ocasional:'🎯 Grande', regular:'📦 Regular', recuperar:'💤 Recuperar' }[s.segmento];
            return [s.nombre, { val: sL, color: sC }, cop(s.revenueTotal), `${s.frecuenciaMes.toFixed(1)}/mes`, cop(s.ticketPromedio), { val: `${s.diasSinCompra}d`, color: s.diasSinCompra > 60 ? CC.gastosOp : CC.ingresos }, s.estado];
          }),
        },
      };
    }

    // ── C2: Retención ─────────────────────────────────────────────────────────
    case 'C2': {
      const ret = u.calcularRetencion(raw.clientes, raw.ventas);
      const ultimo = ret[ret.length - 1] || {};
      return {
        kpis: [
          { label:'Tasa de Retención Actual',  valor: ultimo.tasaRetencion ? pct(ultimo.tasaRetencion) : '—', color: (ultimo.tasaRetencion||0) > 80 ? CC.ingresos : CC.alerta },
          { label:'Activos Último Mes',        valor: ultimo.activos || 0, color: CC.ingresos },
          { label:'En Riesgo de Churn',        valor: ultimo.enRiesgo || 0, color: CC.alerta },
          { label:'Recuperados Último Mes',    valor: ultimo.recuperados || 0, color: CC.comprasUSA },
        ],
        interpretacion: _interp ? _interp.interpretarRetencion({ ret }) : null,
        chartLabels: ret.map(r => r.mes),
        chartDatasets: [
          { label:'Activos',     data: ret.map(r => r.activos),    backgroundColor: CC.ingresos+'BB', borderRadius: 5, stack:'a' },
          { label:'En Riesgo',  data: ret.map(r => r.enRiesgo),   backgroundColor: CC.alerta+'BB',  borderRadius: 5, stack:'a' },
          { label:'Recuperados',data: ret.map(r => r.recuperados),backgroundColor: CC.comprasUSA+'BB', borderRadius: 5, stack:'a' },
        ],
        chartOptions: { stacked: true },
        tabla: {
          cols: ['Mes','Activos','En Riesgo','Recuperados','Perdidos','Tasa Retención'],
          rows: ret.map(r => [r.mes, r.activos, r.enRiesgo, r.recuperados, r.perdidos, { val: pct(r.tasaRetencion), color: r.tasaRetencion > 80 ? CC.ingresos : CC.alerta }]),
        },
      };
    }

    // ── O1: KPIs vs Objetivos ─────────────────────────────────────────────────
    case 'O1': {
      const defaultScores = { liquidez:60, cartera:60, logistica:70, rentabilidad:60, control:60, global:62 };
      let scores = defaultScores;
      if (_utils) {
        try {
          const totalCartera = (ventas||[]).reduce((s,v)=>s+parseFloat(v.saldo_pendiente||0),0);
          scores = _utils.calcularScoreSalud(raw, { totalCob, totalEgresos: totalEgr, balance, margenPct: margenN, totalCartera }, _metasCache) || defaultScores;
        } catch(e) { console.warn('[O1] calcularScoreSalud:', e.message); }
      }
      const dims = [
        { label:'💧 Liquidez',     score: Math.round(scores.liquidez     || 0) },
        { label:'💳 Cartera',      score: Math.round(scores.cartera      || 0) },
        { label:'🚚 Logística',    score: Math.round(scores.logistica    || 0) },
        { label:'📈 Rentabilidad', score: Math.round(scores.rentabilidad || 0) },
        { label:'⚙️ Control',      score: Math.round(scores.control      || 0) },
      ];

      return {
        kpis: [
          { label:'Score Global',        valor: `${scores.global}/100`, color: scores.global >= 75 ? CC.ingresos : scores.global >= 50 ? CC.alerta : CC.gastosOp },
          { label:'Dimensión más fuerte', valor: [...dims].sort((a,b)=>b.score-a.score)[0].label, color: CC.ingresos },
          { label:'Dimensión más débil',  valor: [...dims].sort((a,b)=>a.score-b.score)[0].label, color: CC.gastosOp },
          { label:'Dimensiones ≥75',      valor: dims.filter(d => d.score >= 75).length, color: CC.ingresos, sub: `de ${dims.length} dimensiones` },
        ],
        interpretacion: _interp ? _interp.interpretarKPIsVsObjetivos(scores, _metasCache) : null,
        chartLabels: dims.map(d => d.label),
        chartDatasets: [
          { label:'Score Actual',   data: dims.map(d => d.score), backgroundColor: CC.utilidad+'55', borderColor: CC.utilidad, borderWidth: 2 },
          { label:'Objetivo (100)', data: dims.map(() => 100), backgroundColor: 'transparent', borderColor: CC.neutro, borderWidth: 1, borderDash: [5,3] },
        ],
        chartOptions: { type: 'radar' },
        tabla: {
          cols: ['Dimensión','Score','Estado'],
          rows: dims.map(d => {
            const stC = d.score >= 75 ? CC.ingresos : d.score >= 50 ? CC.alerta : CC.gastosOp;
            const stL = d.score >= 75 ? '🟢 Bien' : d.score >= 50 ? '🟡 Mejora' : '🔴 Crítico';
            return [d.label, { val: `${d.score}/100`, color: stC }, { val: stL, color: stC }];
          }),
        },
      };
    }

    // ── O2: Resumen Ejecutivo ─────────────────────────────────────────────────
    case 'O2': {
      const emptyAging = { total:0, totalVencida:0, totalCorriente:0, tramos:{'0-30':[],'31-60':[],'61-90':[],'+90':[]}, porCliente:[] };
      const defScores2 = { liquidez:60, cartera:60, logistica:70, rentabilidad:60, control:60, global:62 };
      let aging2   = emptyAging;
      let alertas2 = [];
      let scores2  = defScores2;
      let interpret = null;

      try { aging2   = u.calcularCarteraAging(raw.ventas || [], raw.clientes || [], _metasCache); } catch(e) { console.warn('[O2] aging:', e.message); }
      try { alertas2 = u.generarAlertas(raw, { totalFact, totalCob, totalEgresos: totalEgr, balance, margenPct: margenN, totalCartera: aging2.total }, null, _metasCache); } catch(e) { console.warn('[O2] alertas:', e.message); }
      try { scores2  = u.calcularScoreSalud(raw, { totalCob, totalEgresos: totalEgr, balance, margenPct: margenN, totalCartera: aging2.total }, _metasCache) || defScores2; } catch(e) { console.warn('[O2] scores:', e.message); }
      try { interpret = _interp ? _interp.interpretarResumenEjecutivo({ kpis: { totalFact, totalCob, totalEgresos: totalEgr, balance, margenPct: margenN }, aging: aging2, alertas: alertas2, scores: scores2 }) : null; } catch(e) { console.warn('[O2] interpret:', e.message); }

      const tramo90val = (aging2.tramos?.['+90'] || []).reduce((s,e) => s + (e.saldo||0), 0);

      return {
        kpis: [
          { label:'Score Global',        valor: `${scores2.global}/100`, color: scores2.global >= 75 ? CC.ingresos : scores2.global >= 50 ? CC.alerta : CC.gastosOp },
          { label:'Alertas Críticas',    valor: alertas2.filter(a=>a.nivel==='critica').length, color: alertas2.filter(a=>a.nivel==='critica').length > 0 ? CC.gastosOp : CC.ingresos },
          { label:'Cartera Vencida +90d', valor: cop(tramo90val), color: CC.gastosOp },
          { label:'Balance del Período',  valor: cop(balance), color: balance >= 0 ? CC.ingresos : CC.gastosOp },
        ],
        interpretacion: interpret,
        chartLabels: ML,
        chartDatasets: [
          { label:'Cobrado', data: allKeys.map(k => mCob[k]||0), backgroundColor: CC.ingresos+'BB', borderRadius: 5 },
          { label:'Egresos', data: allKeys.map(k => -((mGast[k]||0)+(mComp[k]||0))), backgroundColor: CC.gastosOp+'BB', borderRadius: 5 },
        ],
        chartOptions: {},
        tabla: {
          cols: ['KPI','Valor','Estado'],
          rows: [
            ['Facturación',     cop(totalFact),                   '—'],
            ['Total Cobrado',   cop(totalCob),                    totalCob >= totalFact*0.8 ? '🟢' : '🟡'],
            ['Cartera Total',   { val: cop(aging2.total), color: CC.alerta }, aging2.total > getMeta('meta_cartera_maxima',30000000) ? '🔴' : '🟡'],
            ['Egresos Totales', { val: cop(totalEgr), color: CC.gastosOp }, '—'],
            ['Balance de Caja', { val: cop(balance), color: balance >= 0 ? CC.ingresos : CC.gastosOp }, balance >= 0 ? '🟢' : '🔴'],
            ['Margen Neto',     { val: pct(margenN), color: margenN >= getMeta('meta_margen_neto_pct',25) ? CC.ingresos : CC.gastosOp }, margenN >= getMeta('meta_margen_neto_pct',25) ? '🟢' : '🔴'],
            ['Score de Salud',  `${scores2.global}/100`, scores2.global >= 75 ? '🟢' : scores2.global >= 50 ? '🟡' : '🔴'],
          ],
        },
      };
    }

    default:
      return {
        kpis: [], interpretacion: null,
        chartLabels: [], chartDatasets: [], chartOptions: {},
        tabla: { cols: ['Sin datos'], rows: [] },
      };
  }
};

// Render del gráfico en el explorador (re-render sin full refresh)
const _renderExplorerChart = () => {
  const area = document.getElementById('dash-chart-area');
  if (!area) return;
  if (_vizEx === 'tabla') {
    // Re-render completo del panel si se cambia a tabla
    _renderReportPanel(_rptEx);
    return;
  }
  _destroyAllCharts();
  area.innerHTML = `<canvas id="dash-main-canvas" style="width:100%;height:100%;"></canvas>`;

  // Aplicar el filtro de fechas correctamente
  const parseD = (s) => { if (!s) return null; const d = new Date(String(s).split('T')[0]); return isNaN(d) ? null : d; };
  const inRange = (item, field) => {
    if (!_desde && !_hasta) return true;
    const raw = typeof field === 'function' ? field(item) : item[field];
    const d = parseD(raw); if (!d) return true;
    if (_desde && d < new Date(_desde + 'T00:00')) return false;
    if (_hasta && d > new Date(_hasta + 'T23:59')) return false;
    return true;
  };

  const filtered = {
    ventas:  (_cache.ventas  || []).filter(v => inRange(v, 'fecha')),
    gastos:  (_cache.gastos  || []).filter(g => inRange(g, 'fecha')),
    compras: (_cache.compras || []).filter(c => inRange(c, x => x.fecha_pedido || x.fecha_registro)),
    abonos:  (_cache.abonos  || []).filter(a => inRange(a, 'fecha')),
  };

  _calcReportData(_rptEx, filtered, _cache, _utils, _metasCache).then(rd => {
    if (_charts) _drawReportChart(_rptEx, rd, _charts);
  }).catch(e => console.error('[renderExplorerChart]', e));
};

// ══════════════════════════════════════════════════════════════════════════════
// MODALES
// ══════════════════════════════════════════════════════════════════════════════
const _openModal = (id, html) => {
  let mod = document.getElementById(id);
  if (!mod) {
    mod = document.createElement('div');
    mod.id = id;
    mod.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);backdrop-filter:blur(16px);z-index:10000;display:none;align-items:flex-start;justify-content:center;overflow-y:auto;padding:2rem;box-sizing:border-box;';
    document.body.appendChild(mod);
    mod.onclick = e => { if (e.target === mod) mod.style.display = 'none'; };
  }
  mod.innerHTML = `<div style="max-width:900px;width:100%;margin-top:2rem;">${html}</div>`;
  mod.style.display = 'flex';
};

const _closeModal = (id) => {
  const mod = document.getElementById(id);
  if (mod) mod.style.display = 'none';
};

const _openExecutiveModal = async () => {
  const snap = window._dashSnapshot;
  if (!snap) return showToast('Carga el Resumen primero', 'error');

  const u = await loadUtils();
  const aging = u.calcularCarteraAging(snap.data.ventas, snap.data.clientes, _metasCache);
  const flujo = u.calcularFlujoCajaProyectado(snap.data, _metasCache);
  const interp = await loadInterp();

  const { kpis, scores, alertas, criticas, oportunidades, ventas } = snap;
  const metaFact = getMeta('meta_facturacion_mensual', 0);
  const gastosMes = flujo.gastosPromedioMes;
  const scoreC = scores.global >= 75 ? CC.ingresos : scores.global >= 50 ? CC.alerta : CC.gastosOp;

  // Proyección de cierre del mes
  const diasMes     = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const diaActual   = new Date().getDate();
  const ritmo       = kpis.totalFact / (diaActual || 1);
  const cierreBase  = ritmo * diasMes;
  const cierreOpt   = cierreBase * 1.15;
  const cierreCons  = cierreBase * 0.85;

  const escBar = (label, val, max, color) => {
    const pct = Math.min(100, (val / Math.max(max, val)) * 100);
    return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:0.75rem;opacity:0.7;">${label}</span>
        <span style="font-size:0.75rem;font-weight:800;color:${color};">${formatCOP(val)}</span>
      </div>
      <div style="height:8px;background:var(--border-base);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;"></div>
      </div>
    </div>`;
  };

  const interpretTxt = interp ? interp.interpretarResumenEjecutivo({ kpis, aging, alertas, scores }) : 'Análisis en proceso…';
  const pregunta = criticas.length > 3
    ? `Tienes ${criticas.length} alertas críticas activas. ¿Cuál vas a resolver hoy y por qué?`
    : kpis.totalCartera > getMeta('meta_cartera_maxima',30000000)
    ? `La cartera supera el límite configurado. ¿Cuáles son los 3 clientes prioritarios para esta semana?`
    : scores.global >= 80
    ? `El negocio está saludable (Score ${scores.global}/100). ¿Qué oportunidad puedes acelerar este mes?`
    : `¿Qué acción tomarás hoy para mejorar el margen neto?`;

  _openModal('exec-summary-modal', `
  <div style="background:var(--bg-main);border:1px solid var(--border-base);border-radius:20px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,rgba(76,201,240,0.12),rgba(139,92,246,0.12));border-bottom:1px solid var(--border-base);padding:1.5rem 2rem;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;opacity:0.5;margin-bottom:4px;">Resumen Ejecutivo · Motor IA JARAPP</div>
        <h2 style="margin:0;font-size:1.5rem;font-weight:800;">${new Date().toLocaleDateString('es-CO',{month:'long',year:'numeric'})}</h2>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:2.2rem;font-weight:900;color:${scoreC};">${scores.global}</div>
          <div style="font-size:0.6rem;opacity:0.4;">Score Global</div>
        </div>
        <button onclick="document.getElementById('exec-summary-modal').style.display='none'" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:var(--text-main);border-radius:10px;padding:8px 14px;cursor:pointer;font-size:1.1rem;">&times;</button>
      </div>
    </div>
    <div style="padding:1.5rem 2rem;display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;">
      <!-- Contexto -->
      <div style="grid-column:1/-1;background:var(--surface-2);border-radius:14px;padding:1.2rem;border-left:4px solid ${CC.utilidad};">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;opacity:0.45;margin-bottom:8px;">📍 Análisis del período</div>
        <p style="margin:0;font-size:0.88rem;line-height:1.7;opacity:0.9;">${interpretTxt}</p>
      </div>
      <!-- Problemas urgentes -->
      <div style="background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:1.2rem;">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:${CC.gastosOp};margin-bottom:10px;font-weight:700;">🔴 Top Problemas Urgentes</div>
        ${criticas.length === 0
          ? `<p style="font-size:0.82rem;opacity:0.6;">Sin alertas críticas activas ✅</p>`
          : criticas.slice(0,3).map((a,i) => `
            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(239,68,68,0.1);">
              <div style="font-size:0.76rem;font-weight:700;margin-bottom:3px;">${i+1}. ${a.titulo}</div>
              <div style="font-size:0.68rem;opacity:0.65;line-height:1.4;">${a.desc}</div>
            </div>`).join('')
        }
      </div>
      <!-- Oportunidades -->
      <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:14px;padding:1.2rem;">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:${CC.ingresos};margin-bottom:10px;font-weight:700;">🟢 Top Oportunidades</div>
        ${oportunidades.length === 0
          ? `<p style="font-size:0.82rem;opacity:0.6;">Explora el Explorador para descubrir oportunidades 🔍</p>`
          : oportunidades.slice(0,3).map((a,i) => `
            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(34,197,94,0.1);">
              <div style="font-size:0.76rem;font-weight:700;margin-bottom:3px;">${i+1}. ${a.titulo}</div>
              <div style="font-size:0.68rem;opacity:0.65;line-height:1.4;">${a.desc}</div>
            </div>`).join('')
        }
      </div>
      <!-- Proyección -->
      <div style="background:var(--surface-2);border-radius:14px;padding:1.2rem;">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;opacity:0.45;margin-bottom:10px;">📈 Proyección de Cierre del Mes</div>
        ${escBar('🚀 Optimista (+15%)', cierreOpt,  cierreOpt,  CC.ingresos)}
        ${escBar('📊 Base (ritmo actual)', cierreBase, cierreOpt, CC.utilidad)}
        ${escBar('📉 Conservador (-15%)', cierreCons, cierreOpt, CC.alerta)}
        ${metaFact > 0 ? `<div style="margin-top:8px;font-size:0.68rem;opacity:0.5;">Meta mensual: ${formatCOP(metaFact)} · Cumplimiento actual: ${Math.round(kpis.totalFact/metaFact*100)}%</div>` : ''}
      </div>
      <!-- Pregunta estratégica -->
      <div style="background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(76,201,240,0.08));border:1px solid rgba(139,92,246,0.25);border-radius:14px;padding:1.2rem;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:1.5px;color:${CC.margen};margin-bottom:10px;font-weight:700;">🤔 Pregunta Estratégica</div>
        <p style="margin:0;font-size:0.95rem;line-height:1.6;font-weight:600;">${pregunta}</p>
      </div>
    </div>
    <div style="padding:0 2rem 1.5rem;display:flex;gap:10px;">
      <button onclick="window.exportDashPDF()" style="padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:var(--surface-3);color:var(--text-main);font-family:inherit;">🖨️ Imprimir / PDF</button>
      <button onclick="window.exportDashExcel()" style="padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:var(--surface-3);color:var(--text-main);font-family:inherit;">📥 Excel</button>
      <button onclick="document.getElementById('exec-summary-modal').style.display='none'" style="padding:10px 20px;border-radius:10px;border:1px solid var(--border-base);cursor:pointer;font-size:0.82rem;background:none;color:var(--text-muted);font-family:inherit;">Cerrar</button>
    </div>
  </div>`);
};

const _openPrioritiesDrawer = async () => {
  const snap = window._dashSnapshot;
  if (!snap) return showToast('Carga el Resumen primero', 'error');
  const { criticas, advertencias } = snap;
  const items = [...criticas, ...advertencias].slice(0,7);

  _openModal('priorities-modal', `
  <div style="background:var(--bg-main);border:1px solid var(--border-base);border-radius:20px;overflow:hidden;max-width:600px;">
    <div style="padding:1.5rem 1.5rem 1rem;border-bottom:1px solid var(--border-base);display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;opacity:0.5;margin-bottom:4px;">Motor IA · JARAPP</div>
        <h2 style="margin:0;font-size:1.2rem;font-weight:800;">🎯 Prioridades del Día</h2>
      </div>
      <button onclick="document.getElementById('priorities-modal').style.display='none'" style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
    </div>
    <div style="padding:1.5rem;display:flex;flex-direction:column;gap:10px;">
      ${items.length === 0
        ? `<div style="text-align:center;padding:2rem;opacity:0.5;">✅ Sin acciones urgentes hoy</div>`
        : items.map((a,i) => {
            const bc = a.nivel === 'critica' ? CC.gastosOp : CC.alerta;
            return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:0.8rem;background:var(--surface-2);border-radius:12px;border:1px solid var(--border-base);border-left:3px solid ${bc};">
              <span style="font-size:1.1rem;min-width:24px;">${a.icon||'•'}</span>
              <div style="flex:1;">
                <div style="font-size:0.8rem;font-weight:700;margin-bottom:3px;">${i+1}. ${a.titulo}</div>
                <div style="font-size:0.68rem;opacity:0.6;">${a.desc}</div>
              </div>
              ${a.accionLabel ? `<button style="padding:4px 10px;border-radius:8px;border:1px solid ${bc}44;background:${bc}15;color:${bc};font-size:0.68rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;">${a.accionLabel}</button>` : ''}
            </div>`;
          }).join('')
      }
    </div>
  </div>`);
};

const _openProjectionModal = async () => {
  const snap = window._dashSnapshot;
  if (!snap) return showToast('Carga el Resumen primero', 'error');
  const { kpis } = snap;
  const metaFact  = getMeta('meta_facturacion_mensual', 0);
  const diasMes   = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const diaActual = new Date().getDate();
  const avancePct = metaFact > 0 ? (kpis.totalFact / metaFact * 100) : null;
  const ritmo     = kpis.totalFact / (diaActual || 1);
  const cierreB   = ritmo * diasMes;
  const cierreO   = cierreB * 1.15;
  const cierreC   = cierreB * 0.85;

  _openModal('projection-modal', `
  <div style="background:var(--bg-main);border:1px solid var(--border-base);border-radius:20px;overflow:hidden;max-width:650px;">
    <div style="padding:1.5rem;border-bottom:1px solid var(--border-base);display:flex;justify-content:space-between;align-items:center;">
      <h2 style="margin:0;font-size:1.2rem;font-weight:800;">📈 Proyección de Cierre del Mes</h2>
      <button onclick="document.getElementById('projection-modal').style.display='none'" style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
    </div>
    <div style="padding:1.5rem;display:flex;flex-direction:column;gap:1rem;">
      ${avancePct !== null ? `
      <div style="text-align:center;padding:1rem;background:var(--surface-2);border-radius:14px;">
        <div style="font-size:0.65rem;opacity:0.5;margin-bottom:8px;">Avance actual vs meta mensual</div>
        <div style="font-size:2.5rem;font-weight:900;color:${avancePct>=90?CC.ingresos:avancePct>=70?CC.alerta:CC.gastosOp};">${Math.round(avancePct)}%</div>
        <div style="font-size:0.75rem;opacity:0.6;">Día ${diaActual} de ${diasMes} · ${formatCOP(kpis.totalFact)} de ${formatCOP(metaFact)}</div>
        <div style="height:10px;background:var(--border-base);border-radius:6px;margin-top:10px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(100,avancePct)}%;background:${avancePct>=90?CC.ingresos:avancePct>=70?CC.alerta:CC.gastosOp};border-radius:6px;"></div>
        </div>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        ${[
          { label:'🚀 Optimista', val: cierreO, sub:'+15% sobre ritmo actual', color: CC.ingresos },
          { label:'📊 Base', val: cierreB, sub:'Ritmo actual proyectado', color: CC.utilidad },
          { label:'📉 Conservador', val: cierreC, sub:'-15% sobre ritmo actual', color: CC.alerta },
        ].map(sc => `
        <div style="background:var(--surface-2);border-radius:12px;padding:1rem;text-align:center;border:1px solid var(--border-base);">
          <div style="font-size:0.75rem;font-weight:700;margin-bottom:6px;">${sc.label}</div>
          <div style="font-size:1.1rem;font-weight:900;color:${sc.color};">${formatCOP(sc.val)}</div>
          <div style="font-size:0.62rem;opacity:0.5;margin-top:4px;">${sc.sub}</div>
        </div>`).join('')}
      </div>
      <div style="background:rgba(76,201,240,0.06);border:1px solid rgba(76,201,240,0.2);border-radius:12px;padding:1rem;">
        <div style="font-size:0.68rem;font-weight:700;opacity:0.6;margin-bottom:6px;">💡 Qué cambiaría el escenario:</div>
        <ul style="margin:0;padding-left:1.2rem;font-size:0.75rem;line-height:1.8;opacity:0.8;">
          <li>Cobrar el 100% de la cartera corriente llevaría la caja a <strong>${formatCOP(kpis.totalCob + snap.data.ventas.reduce((s,v)=>s+parseFloat(v.saldo_pendiente||0),0) * 0.85)}</strong></li>
          <li>Cada nuevo encargo promedio suma ~<strong>${formatCOP(kpis.numVentas > 0 ? kpis.totalFact/kpis.numVentas : 0)}</strong> a la facturación</li>
          <li>Reducir egresos un 10% liberaría ~<strong>${formatCOP(kpis.totalEgresos * 0.1)}</strong> de caja mensual</li>
        </ul>
      </div>
    </div>
  </div>`);
};

const _openBalanceMaestroModal = () => {
  const snap = window._dashSnapshot;
  if (!snap) return showToast('Carga el Resumen primero', 'error');
  const { kpis, scores } = snap;
  const canSee = auth.canAccess('feat_money') !== false;

  _openModal('balance-maestro-modal', `
  <div style="background:var(--bg-main);border:1px solid var(--border-base);border-radius:20px;overflow:hidden;max-width:800px;">
    <div style="background:linear-gradient(135deg,rgba(34,197,94,0.1),rgba(59,130,246,0.1));border-bottom:1px solid var(--border-base);padding:1.5rem 2rem;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:2px;opacity:0.5;margin-bottom:4px;">Vista consolidada</div>
        <h2 style="margin:0;font-size:1.4rem;font-weight:800;">⚖️ Balance Maestro JARAPP</h2>
      </div>
      <button onclick="document.getElementById('balance-maestro-modal').style.display='none'" style="background:none;border:none;color:var(--text-main);font-size:1.5rem;cursor:pointer;">&times;</button>
    </div>
    <div style="padding:1.5rem 2rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
      ${[
        { label:'Facturación Total',   val: kpis.totalFact,   icon:'📊', color: CC.utilidad },
        { label:'Total Cobrado',        val: kpis.totalCob,    icon:'✅', color: CC.ingresos },
        { label:'Cartera Pendiente',   val: kpis.totalCartera, icon:'⏰', color: CC.alerta },
        { label:'Total Egresos',        val: kpis.totalEgresos, icon:'📤', color: CC.gastosOp },
        { label:'Balance de Caja',     val: kpis.balance,     icon:'💰', color: kpis.balance >= 0 ? CC.ingresos : CC.gastosOp },
        { label:'Margen Neto',         val: null,              icon:'📈', color: kpis.margenPct >= getMeta('meta_margen_neto_pct',25) ? CC.ingresos : CC.gastosOp, text: `${kpis.margenPct.toFixed(1).replace('.',',')}%` },
      ].map(k => `
      <div style="background:var(--surface-2);border:1px solid var(--border-base);border-radius:14px;padding:1.2rem;display:flex;gap:12px;align-items:center;">
        <span style="font-size:1.6rem;">${k.icon}</span>
        <div>
          <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;opacity:0.5;margin-bottom:4px;">${k.label}</div>
          <div style="font-size:1.2rem;font-weight:900;color:${k.color};">${canSee ? (k.text || formatCOP(k.val)) : '••••••'}</div>
        </div>
      </div>`).join('')}
    </div>
    <div style="padding:0 2rem 1.5rem;display:flex;gap:10px;">
      <button onclick="window.exportDashExcel()" style="padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:0.82rem;font-weight:700;background:var(--surface-3);color:var(--text-main);font-family:inherit;">📥 Exportar Excel</button>
      <button onclick="document.getElementById('balance-maestro-modal').style.display='none'" style="padding:10px 20px;border-radius:10px;border:1px solid var(--border-base);cursor:pointer;font-size:0.82rem;background:none;color:var(--text-muted);font-family:inherit;">Cerrar</button>
    </div>
  </div>`);
};

const _exportCurrentReport = async () => {
  try {
    const u = await loadUtils();
    const rptData = await _calcReportData(_rptEx, {
      ventas:  _cache.ventas,
      gastos:  _cache.gastos,
      compras: _cache.compras,
      abonos:  _cache.abonos,
    }, _cache, u, _metasCache);

    if (!rptData?.tabla?.rows?.length) return showToast('Sin datos para exportar', 'error');
    const rows = rptData.tabla.rows.map(row => {
      const obj = {};
      rptData.tabla.cols.forEach((col, i) => {
        const cell = row[i];
        obj[col] = typeof cell === 'object' && cell !== null ? cell.val : (cell ?? '');
      });
      return obj;
    });
    const name = REPORT_RPT_MAP[_rptEx] || _rptEx;
    downloadExcel(rows, `Jarapo_${name.replace(/[^a-zA-Z0-9]/g,'_')}_${new Date().toISOString().split('T')[0]}`);
  } catch(e) {
    showToast('Error exportando: ' + e.message, 'error');
  }
};
