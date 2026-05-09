/**
 * calculadora.js — Módulo Calculadora de Precios de Importación
 * JARAPP 2026 · Cálculo en tiempo real de precios USA → Colombia
 */

import { db } from '../db.js';
import { auth } from '../auth.js';
import { showToast, formatCOP } from '../utils.js';

// ── Configuración por defecto ──────────────────────────────────────────────────
export const CALC_DEFAULT_CONFIG = {
  taxUsa: 7,
  comisionTC: 3,
  valorLibraUsd: 3,
  valorLibra: 11100,
  costoDomicilio: 20000,
  categorias: {
    calzado:  { label: 'Calzado',   icon: 'footprints', ganancia: 100000, peso: 4 },
    botas:    { label: 'Botas',     icon: 'mountain',   ganancia: 100000, peso: 6 },
    infantil: { label: 'Infantil',  icon: 'baby',       ganancia: 70000,  peso: 2 },
    salud:    { label: 'Salud',     icon: 'pill',       ganancia: 50000,  peso: 2 },
    ropa:     { label: 'Ropa',      icon: 'shirt',      ganancia: 50000,  peso: 1 },
    abrigos:  { label: 'Abrigos',   icon: 'layers',     ganancia: 65000,  peso: 4 },
    general:  { label: 'General',   icon: 'sliders',    ganancia: 50000,  peso: 1 }
  }
};

let _config = null;
let _renderLayout = null;
let _navigateTo = null;
let _activeMode = 'calzado';
let _history = [];

// ── Carga de configuración desde Supabase ──────────────────────────────────────
export async function loadCalcConfig() {
  try {
    const list = await db.fetchData('Configuracion');
    if (Array.isArray(list)) {
      const param = list.find(p => p.clave === 'CALC_CONFIG');
      if (param && param.valor) {
        const parsed = JSON.parse(param.valor);
        return {
          ...CALC_DEFAULT_CONFIG,
          ...parsed,
          categorias: { ...CALC_DEFAULT_CONFIG.categorias, ...(parsed.categorias || {}) }
        };
      }
    }
  } catch (e) {
    console.warn('[Calculadora] Config no encontrada, usando defaults:', e.message);
  }
  return JSON.parse(JSON.stringify(CALC_DEFAULT_CONFIG));
}

// ── Guardar configuración en Supabase ─────────────────────────────────────────
export async function saveCalcConfig(config) {
  const list = await db.fetchData('Configuracion');
  const existing = Array.isArray(list) ? list.find(p => p.clave === 'CALC_CONFIG') : null;
  const payload = {
    id: existing ? existing.id : 'CALC_CONFIG_' + Date.now(),
    clave: 'CALC_CONFIG',
    valor: JSON.stringify(config)
  };
  await db.postData('Configuracion', payload, existing ? 'UPDATE' : 'INSERT');
}

// ── Fórmula de cálculo ─────────────────────────────────────────────────────────
function calcular(config, mode, valorUsd, trm, conDomicilio) {
  const conf = config.categorias[mode] || config.categorias.general;
  const nUsd = parseFloat(valorUsd) || 0;
  const nTrm = parseFloat(trm) || 0;
  const peso = parseFloat(conf.peso) || 0;
  const ganancia = parseFloat(conf.ganancia) || 0;

  // Costo libra: si hay valorLibraUsd, se multiplica por TRM actual (dinámico)
  const valorLibraCOP = config.valorLibraUsd
    ? (parseFloat(config.valorLibraUsd) * nTrm)
    : parseFloat(config.valorLibra) || 0;

  const valorConTax    = nUsd * (1 + config.taxUsa / 100);
  const pesosBase      = valorConTax * nTrm;
  const pesosConComis  = pesosBase * (1 + config.comisionTC / 100);
  const costoLogistica = peso * valorLibraCOP;
  const costoEnvio     = conDomicilio ? config.costoDomicilio : 0;
  const total          = pesosConComis + ganancia + costoLogistica + costoEnvio;

  return {
    total,
    pesosConTax: pesosBase,
    comisionVal: pesosConComis - pesosBase,
    logisticaTotal: costoLogistica + costoEnvio,
    ganancia
  };
}

// ── Render principal ───────────────────────────────────────────────────────────
export const renderCalculadora = async (renderLayout, navigateTo) => {
  _renderLayout = renderLayout;
  _navigateTo   = navigateTo;
  renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Cargando Calculadora de Precios...</div>`);

  _config = await loadCalcConfig();

  try {
    _history = JSON.parse(localStorage.getItem('CALC_HISTORY') || '[]');
  } catch { _history = []; }

  // Restaurar modo activo guardado
  _activeMode = localStorage.getItem('CALC_MODE') || 'calzado';
  if (!_config.categorias[_activeMode]) _activeMode = 'calzado';

  renderCalcView();
};

// ── Construcción del HTML ──────────────────────────────────────────────────────
function renderCalcView() {
  const isAdmin  = auth.isAdmin();
  const canEdit  = auth.canEdit('calculadora');
  const trm     = parseFloat(localStorage.getItem('CALC_TRM') || '4200');
  const usd     = parseFloat(localStorage.getItem('CALC_USD') || '0') || 0;
  const domicilio = localStorage.getItem('CALC_DOMICILIO') !== 'false';
  const res     = calcular(_config, _activeMode, usd, trm, domicilio);
  const cat     = _config.categorias[_activeMode];
  const isGeneral = _activeMode === 'general';

  const catButtons = Object.entries(_config.categorias).map(([key, c]) => `
    <button class="calc-cat-btn ${_activeMode === key ? 'active' : ''}" data-mode="${key}">
      <i data-lucide="${c.icon}"></i>
      <span>${c.label}</span>
    </button>
  `).join('');

  const historyHTML = _history.length === 0 ? '' : `
    <div class="glass-card" style="padding:1.5rem;margin-top:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-faint);">Historial Reciente</h3>
        <button id="calc-clear-hist" style="font-size:0.72rem;font-weight:700;color:var(--primary-red);background:none;border:none;cursor:pointer;padding:4px 8px;">🗑 Limpiar</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;">
        ${_history.slice(0, 15).map(item => `
          <div style="background:var(--glass-hover);padding:10px 14px;border-radius:10px;border:1px solid var(--glass-border);display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="font-size:0.68rem;font-weight:700;color:var(--text-faint);display:block;">${item.fecha} ${item.timestamp} · ${item.categoria}</span>
              <span style="font-size:0.82rem;font-weight:700;color:var(--text-main);">${item.valorUsd} USD · TRM ${(item.trm||0).toLocaleString('es-CO')}</span>
            </div>
            <span style="font-size:1rem;font-weight:800;color:var(--success-green);">${formatCOP(item.total)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const showDesglose = auth.canAccess('feat_calc_desglose');
  const breakdownHTML = showDesglose ? buildBreakdown(res, auth.isAdmin()) : '';

  const html = `
    <div>
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:1.5rem;flex-wrap:wrap;gap:15px;">
        <div>
          <span class="page-eyebrow">Importaciones · USA → Colombia</span>
          <h2 class="page-title">Calculadora de Precios</h2>
          <p style="opacity:0.5;font-size:0.82rem;margin-top:4px;">Cotización en tiempo real para importaciones desde USA.</p>
        </div>
        <div class="calc-trm-box">
          <span style="font-size:0.65rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px;">TRM Cotizada</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:var(--success-green);font-weight:800;font-size:1.1rem;">$</span>
            <input type="number" id="calc-trm" value="${trm}"
              style="width:130px;background:transparent;border:none;outline:none;font-size:1.2rem;font-weight:800;color:var(--text-main);text-align:right;">
          </div>
        </div>
      </div>

      <div class="calc-layout">

        <!-- Sidebar categorías -->
        <div class="calc-sidebar">
          ${catButtons}
        </div>

        <!-- Formulario central -->
        <div class="calc-center">
          <div class="glass-card" style="padding:2rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
              <h3 style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-faint);">
                Cotización — ${cat.label}
              </h3>
              <div style="text-align:right;">
                <span style="font-size:0.65rem;font-weight:800;color:var(--success-green);text-transform:uppercase;letter-spacing:1px;display:block;">Ganancia config.</span>
                <span style="font-size:0.95rem;font-weight:800;color:var(--text-main);">${formatCOP(res.ganancia)}</span>
              </div>
            </div>

            <!-- USD Input -->
            <div style="margin-bottom:1.5rem;">
              <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:8px;">Costo Neto Tienda (USD)</label>
              <div class="calc-usd-wrap">
                <span class="calc-usd-sign">$</span>
                <input type="number" inputmode="decimal" id="calc-usd" value="${usd || ''}" placeholder="0.00" class="calc-usd-input">
              </div>
            </div>

            <!-- Peso y Ganancia -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
              <div class="calc-info-box">
                <div style="display:flex;align-items:center;gap:10px;flex:1;">
                  <div class="calc-info-icon blue">
                    <i data-lucide="scale"></i>
                  </div>
                  <div>
                    <span style="font-size:0.8rem;font-weight:700;color:var(--text-main);display:block;">Peso (Lbs)</span>
                    <span style="font-size:0.68rem;color:var(--text-faint);">${isGeneral ? 'Editable' : 'Configurado'}</span>
                  </div>
                </div>
                ${isGeneral
                  ? `<input type="number" id="calc-peso-gen" value="${cat.peso || ''}" class="calc-mini-input">`
                  : `<span class="calc-info-badge">${cat.peso} Lbs</span>`
                }
              </div>
              <div class="calc-info-box">
                <div style="display:flex;align-items:center;gap:10px;flex:1;">
                  <div class="calc-info-icon green">
                    <i data-lucide="banknote"></i>
                  </div>
                  <div>
                    <span style="font-size:0.8rem;font-weight:700;color:var(--text-main);display:block;">Ganancia ($)</span>
                    <span style="font-size:0.68rem;color:var(--text-faint);">${isGeneral ? 'Edición rápida' : 'Predefinida'}</span>
                  </div>
                </div>
                ${isGeneral
                  ? `<input type="number" id="calc-gan-gen" value="${cat.ganancia || ''}" class="calc-mini-input" style="width:90px;">`
                  : `<span class="calc-info-badge">${formatCOP(cat.ganancia)}</span>`
                }
              </div>
            </div>

            <!-- Toggle domicilio -->
            <div class="calc-domicilio-row">
              <div style="display:flex;align-items:center;gap:12px;flex:1;">
                <div class="calc-info-icon" style="background:rgba(255,255,255,0.12);">
                  <i data-lucide="truck" style="color:#fff;"></i>
                </div>
                <div>
                  <span style="font-size:0.8rem;font-weight:700;color:#fff;display:block;">Domicilio Incluido</span>
                  <span style="font-size:0.68rem;color:rgba(255,255,255,0.5);">Costo: ${formatCOP(_config.costoDomicilio)}</span>
                </div>
              </div>
              <label class="calc-switch">
                <input type="checkbox" id="calc-domicilio" ${domicilio ? 'checked' : ''}>
                <span class="calc-slider"></span>
              </label>
            </div>
          </div>

          ${historyHTML}
        </div>

        <!-- Panel resultado -->
        <div class="calc-result-col">
          <!-- Tarjeta resultado -->
          <div class="calc-result-card">
            <div class="calc-result-glow"></div>
            <div style="position:relative;z-index:1;text-align:center;width:100%;">
              <span style="font-size:0.65rem;font-weight:800;text-transform:uppercase;letter-spacing:4px;color:rgba(255,255,255,0.4);display:block;margin-bottom:12px;">Precio al Cliente</span>
              <div id="calc-total" class="calc-total-value">${formatCOP(res.total)}</div>
              <button id="calc-save" class="calc-save-btn">
                <i data-lucide="save"></i> Guardar Cotización
              </button>
            </div>
          </div>

          <!-- Desglose (visible solo si tiene permiso) -->
          ${showDesglose ? `
          <div id="calc-breakdown" class="glass-card" style="padding:1.5rem;">
            ${breakdownHTML}
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  _renderLayout(html);
  setTimeout(() => {
    _applyIcons();
    _bindEvents();
  }, 100);
}

// ── Desglose de costos ─────────────────────────────────────────────────────────
function buildBreakdown(res, isAdminUser) {
  const allRows = [
    { label: 'Costo Base + Tax USA',       value: res.pesosConTax,    color: 'var(--text-muted)' },
    { label: 'Comisión Pasarela de Pago',  value: res.comisionVal,    color: 'var(--text-muted)' },
    { label: 'Logística (flete + envío)',  value: res.logisticaTotal, color: 'var(--info-blue)' },
    { label: 'Ganancia configurada',       value: res.ganancia,       color: 'var(--success-green)', bold: true },
  ];
  const rows = isAdminUser ? allRows : [allRows[2], allRows[3]];

  return `
    <h4 style="font-size:0.72rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-bottom:1rem;">
      ${isAdminUser ? '📊 Análisis de Costos' : '📋 Desglose'}
    </h4>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${rows.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;">
          <span style="color:var(--text-muted);font-weight:${r.bold ? '700' : '500'};">` + r.label + `</span>
          <span style="font-weight:${r.bold ? '800' : '700'};color:${r.color};">` + formatCOP(r.value) + `</span>
        </div>
      `).join('')}
      <div style="border-top:1px solid var(--glass-border);padding-top:10px;margin-top:4px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.88rem;font-weight:800;color:var(--text-main);">Total al Cliente</span>
        <span style="font-size:1.05rem;font-weight:800;color:var(--primary-red);">` + formatCOP(res.total) + `</span>
      </div>
    </div>
  `;
}

// ── Bind de eventos ────────────────────────────────────────────────────────────
function _bindEvents() {
  const canEdit = auth.canEdit('calculadora');

  // Recalcular en tiempo real
  const recalc = () => {
    const trm       = parseFloat(document.getElementById('calc-trm')?.value) || 0;
    const usd       = parseFloat(document.getElementById('calc-usd')?.value) || 0;
    const domicilio = document.getElementById('calc-domicilio')?.checked ?? true;
    const pesoGen   = document.getElementById('calc-peso-gen');
    const ganGen    = document.getElementById('calc-gan-gen');

    if (pesoGen) _config.categorias.general.peso     = parseFloat(pesoGen.value) || 0;
    if (ganGen)  _config.categorias.general.ganancia = parseFloat(ganGen.value)  || 0;

    localStorage.setItem('CALC_TRM',       trm);
    localStorage.setItem('CALC_USD',       usd);
    localStorage.setItem('CALC_DOMICILIO', domicilio);

    const res = calcular(_config, _activeMode, usd, trm, domicilio);

    const totalEl     = document.getElementById('calc-total');
    const breakdownEl = document.getElementById('calc-breakdown');
    if (totalEl)     totalEl.textContent = formatCOP(res.total);
    if (breakdownEl) breakdownEl.innerHTML = buildBreakdown(res, auth.isAdmin());

  };

  document.getElementById('calc-trm')?.addEventListener('input', recalc);
  document.getElementById('calc-usd')?.addEventListener('input', recalc);
  document.getElementById('calc-domicilio')?.addEventListener('change', recalc);
  document.getElementById('calc-peso-gen')?.addEventListener('input', recalc);
  document.getElementById('calc-gan-gen')?.addEventListener('input', recalc);

  // Cambio de categoría
  document.querySelectorAll('.calc-cat-btn').forEach(btn => {
    btn.onclick = () => {
      _activeMode = btn.dataset.mode;
      localStorage.setItem('CALC_MODE', _activeMode);
      renderCalcView();
    };
  });

  // Guardar en historial
  document.getElementById('calc-save')?.addEventListener('click', () => {
    const trm     = parseFloat(document.getElementById('calc-trm')?.value) || 0;
    const usd     = parseFloat(document.getElementById('calc-usd')?.value) || 0;
    const dom     = document.getElementById('calc-domicilio')?.checked ?? true;
    const res     = calcular(_config, _activeMode, usd, trm, dom);

    if (!usd || !trm) { showToast('Ingresa el valor USD y la TRM primero.', 'error'); return; }

    const item = {
      id:        Date.now(),
      timestamp: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      fecha:     new Date().toLocaleDateString('es-CO'),
      categoria: _config.categorias[_activeMode].label,
      valorUsd:  usd,
      trm,
      domicilio: dom,
      total:     res.total
    };
    _history = [item, ..._history].slice(0, 50);
    localStorage.setItem('CALC_HISTORY', JSON.stringify(_history));
    showToast('✅ Cotización guardada en el historial', 'success');
    renderCalcView();
  });

  document.getElementById('calc-clear-hist')?.addEventListener('click', async () => {
    const ok = await window.customConfirm('Limpiar Historial', '¿Estás seguro de que deseas eliminar todo el historial de cotizaciones?');
    if (!ok) return;
    _history = [];
    localStorage.removeItem('CALC_HISTORY');
    renderCalcView();
  });
}

// ── Render de iconos lucide ────────────────────────────────────────────────────
function _applyIcons() {
  import('lucide').then(lucide => {
    lucide.createIcons({
      icons: {
        Footprints: lucide.Footprints || lucide.Package,
        Mountain:   lucide.Mountain,
        Baby:       lucide.Baby,
        Pill:       lucide.Pill,
        Shirt:      lucide.Shirt,
        Layers:     lucide.Layers,
        Sliders:    lucide.Sliders,
        Scale:      lucide.Scale,
        Banknote:   lucide.Banknote,
        Truck:      lucide.Truck,
        Save:       lucide.Save,
        Calculator: lucide.Calculator,
      }
    });
  });
}
