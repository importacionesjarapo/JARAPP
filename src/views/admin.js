/**
 * admin.js — Módulo Administrativo de Usuarios y Permisos
 * JARAPP 2026 · Solo accesible para rol 'admin'
 */

import { auth, ROLE_TEMPLATES, ROLE_LABELS, ROLE_COLORS, MODULE_LABELS } from '../auth.js';
import { loadCalcConfig, saveCalcConfig, CALC_DEFAULT_CONFIG } from './calculadora.js';
import { showToast } from '../utils.js';

let _adminActiveTab = 'usuarios'; // 'usuarios' | 'calculadora'

export const renderAdmin = async (renderLayout, navigateTo) => {
  renderLayout(`<div class="admin-loading"><div class="loader"></div><p>Cargando panel administrativo...</p></div>`);

  let users = [];
  let loadError = null;
  let calcConfig = null;

  try {
    users = await auth.getAllUsers();
  } catch (err) {
    loadError = err.message;
  }

  try {
    calcConfig = await loadCalcConfig();
  } catch (err) {
    console.warn('[Admin] Error cargando config calc:', err.message);
    calcConfig = JSON.parse(JSON.stringify(CALC_DEFAULT_CONFIG));
  }

  const html = buildAdminHTML(users, loadError, calcConfig);
  renderLayout(html);
  bindAdminEvents(users, navigateTo, renderLayout, calcConfig);
};

// ── HTML Builder ────────────────────────────────────────────

function buildAdminHTML(users, error, calcConfig) {
  return `
    <div class="module-header">
      <div>
        <p class="module-tag">ADMINISTRACIÓN · SISTEMA</p>
        <h2 class="module-title">Panel de Administración</h2>
      </div>
      ${_adminActiveTab === 'usuarios' ? `<button class="btn-primary" id="admin-new-user-btn">+ Crear Usuario</button>` : ''}
    </div>

    <!-- Tabs -->
    <div class="purchase-view-switcher" style="margin-bottom:1.5rem;">
      <button class="pv-tab ${_adminActiveTab === 'usuarios' ? 'active' : ''}" id="admin-tab-usuarios">
        👥 Control de Acceso
      </button>
      <button class="pv-tab ${_adminActiveTab === 'calculadora' ? 'active' : ''}" id="admin-tab-calculadora">
        🧭 Administración Calculadora
      </button>
    </div>

    <!-- Panel Usuarios -->
    <div id="admin-panel-usuarios" style="display:${_adminActiveTab === 'usuarios' ? 'block' : 'none'}">
      ${error ? `<div class="admin-error-banner">⚠ Error al cargar usuarios: ${error}</div>` : ''}
      <div class="kpi-grid" style="margin-bottom:1.5rem;">
        ${buildAdminKPIs(users)}
      </div>
      <div class="glass-card" style="padding:0; overflow:hidden;">
        <div style="padding:1.2rem 1.5rem; border-bottom:1px solid var(--border-base); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="font-size:0.95rem; font-weight:700; margin-bottom:2px;">Usuarios del Sistema</h3>
            <p style="font-size:0.72rem; color:var(--text-faint);">${users.length} usuarios registrados</p>
          </div>
          <div class="admin-filter-bar">
            <input type="text" id="admin-search" class="admin-search-input" placeholder="Buscar usuario..." />
            <select id="admin-role-filter" class="admin-filter-select">
              <option value="">Todos los roles</option>
              <option value="admin">Administrador</option>
              <option value="gerente">Gerente</option>
              <option value="ventas">Ventas</option>
              <option value="logistica">Logística</option>
              <option value="finanzas">Finanzas</option>
              <option value="viewer">Solo Lectura</option>
            </select>
          </div>
        </div>
        <div class="table-wrapper" style="border-radius:0; border:none; box-shadow:none;">
          <table class="data-table" id="admin-users-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Rol</th>
                <th class="text-center">Módulos</th>
                <th class="text-center">Estado</th>
                <th class="text-center">Registrado</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody id="admin-users-tbody">
              ${buildUsersRows(users)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Panel Calculadora -->
    <div id="admin-panel-calculadora" style="display:${_adminActiveTab === 'calculadora' ? 'block' : 'none'}">
      ${buildCalcAdminPanel(calcConfig)}
    </div>

    </div>
  `;
}

function buildAdminKPIs(users) {
  const total = users.length;
  const active = users.filter(u => u.is_active).length;
  const inactive = total - active;
  const admins = users.filter(u => u.role === 'admin').length;
  const roleCounts = {};
  users.forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });
  const mostCommonRole = Object.entries(roleCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  return `
    <div class="kpi-card">
      <p class="card-label">Total Usuarios</p>
      <p class="card-value" style="color:var(--brand-magenta);">${total}</p>
      <p class="card-trend">registrados en el sistema</p>
    </div>
    <div class="kpi-card">
      <p class="card-label">Usuarios Activos</p>
      <p class="card-value" style="color:var(--success);">${active}</p>
      <p class="card-trend">${inactive} inactivos</p>
    </div>
    <div class="kpi-card">
      <p class="card-label">Administradores</p>
      <p class="card-value" style="color:#7C3AED;">${admins}</p>
      <p class="card-trend">con acceso total</p>
    </div>
    <div class="kpi-card">
      <p class="card-label">Rol más común</p>
      <p class="card-value" style="font-size:1.2rem; color:var(--text-main);">${ROLE_LABELS[mostCommonRole] || '—'}</p>
      <p class="card-trend">${roleCounts[mostCommonRole] || 0} usuarios</p>
    </div>
  `;
}

function buildUsersRows(users) {
  if (!users.length) {
    return `<tr class="table-empty-row"><td colspan="7">No hay usuarios registrados.</td></tr>`;
  }

  return users.map(u => {
    const modules = Object.entries(u.permissions || {})
      .filter(([k, v]) => v && k !== 'admin')
      .map(([k]) => MODULE_LABELS[k] || k);
    
    const roleColor = ROLE_COLORS[u.role] || '#64748B';
    const createdAt = u.created_at 
      ? new Date(u.created_at).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })
      : '—';

    const isCurrentUser = u.id === auth.getProfile()?.id;

    return `
      <tr data-user-id="${u.id}">
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="admin-avatar" style="background:${roleColor}22; color:${roleColor};">
              ${(u.full_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <span class="cell-title">${u.full_name || '—'}${isCurrentUser ? ' <span class="admin-you-badge">Tú</span>' : ''}</span>
            </div>
          </div>
        </td>
        <td style="color:var(--text-muted); font-size:0.82rem;">${u.email}</td>
        <td>
          <span class="admin-role-badge" style="background:${roleColor}22; color:${roleColor}; border-color:${roleColor}44;">
            ${ROLE_LABELS[u.role] || u.role}
          </span>
        </td>
        <td class="text-center">
          <div class="admin-modules-list">
            ${modules.length ? modules.map(m => `<span class="admin-module-chip">${m}</span>`).join('') : '<span style="color:var(--text-faint); font-size:0.72rem;">Sin acceso</span>'}
          </div>
        </td>
        <td class="text-center">
          <button 
            class="admin-status-toggle ${u.is_active ? 'active' : 'inactive'}" 
            onclick="window.adminToggleUser('${u.id}', ${!u.is_active})"
            ${isCurrentUser ? 'disabled title="No puedes desactivarte a ti mismo"' : ''}
          >
            <span class="admin-status-dot"></span>
            ${u.is_active ? 'Activo' : 'Inactivo'}
          </button>
        </td>
        <td class="text-center" style="color:var(--text-faint); font-size:0.78rem;">${createdAt}</td>
        <td class="td-actions">
          <div class="td-actions-group">
            <button class="btn-action" onclick="window.adminEditUser('${u.id}')">✏ Editar</button>
            <button class="btn-action" onclick="window.adminResetPassword('${u.id}', '${u.full_name}')">🔑 Contraseña</button>
            <button class="btn-action" onclick="window.adminViewLogs('${u.id}', '${u.full_name}')">🕒 Accesos</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Panel Administración Calculadora ──────────────────────────

function buildCalcAdminPanel(config) {
  if (!config) return `<div class="admin-error-banner">⚠ No se pudo cargar la configuración.</div>`;
  const refTrm = parseFloat(localStorage.getItem('CALC_TRM') || '4200');
  const valLibraCopCalc = ((config.valorLibraUsd || 0) * refTrm).toLocaleString('es-CO');

  return `
    <div style="display:flex;flex-direction:column;gap:1.5rem;">
      <!-- KPI resumen config -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <p class="card-label">Tax USA</p>
          <p class="card-value" style="color:var(--info-blue);font-size:1.4rem;">${config.taxUsa}%</p>
          <p class="card-trend">Sobre precio base USD</p>
        </div>
        <div class="kpi-card">
          <p class="card-label">Valor Libra USD</p>
          <p class="card-value" style="color:var(--warning-orange);font-size:1.4rem;">$${config.valorLibraUsd || 0} USD</p>
          <p class="card-trend">= $${valLibraCopCalc} COP (ref. TRM ${refTrm.toLocaleString('es-CO')})</p>
        </div>
        <div class="kpi-card">
          <p class="card-label">Comisión TC</p>
          <p class="card-value" style="color:var(--brand-magenta);font-size:1.4rem;">${config.comisionTC}%</p>
          <p class="card-trend">Pasarela de pago</p>
        </div>
        <div class="kpi-card">
          <p class="card-label">Domicilio</p>
          <p class="card-value" style="color:var(--success-green);font-size:1.2rem;">$${(config.costoDomicilio||0).toLocaleString('es-CO')}</p>
          <p class="card-trend">COP costo envío local</p>
        </div>
      </div>

      <!-- Valores globales -->
      <div class="glass-card" style="padding:1.5rem;">
        <h3 style="font-size:0.85rem;font-weight:700;margin-bottom:1.2rem;text-transform:uppercase;letter-spacing:1px;color:var(--text-faint);">1. Valores Globales</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;">

          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">Tax USA (%)</label>
            <input type="number" id="calc-cfg-taxUsa" value="${config.taxUsa || 0}"
              style="width:100%;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;">
          </div>

          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">Comisión Pasarela (%)</label>
            <input type="number" id="calc-cfg-comisionTC" value="${config.comisionTC || 0}"
              style="width:100%;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;">
          </div>

          <!-- Valor Libra USD — editable -->
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--warning-orange);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">
              ⭐ Valor Libra (USD)
            </label>
            <input type="number" id="calc-cfg-valorLibraUsd" value="${config.valorLibraUsd || 0}"
              step="0.5"
              style="width:100%;background:var(--input-bg);border:1px solid var(--warning-orange);color:var(--text-main);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;">
            <p style="font-size:0.68rem;color:var(--text-faint);margin-top:4px;">Costo de flete por libra en dólares</p>
          </div>

          <!-- Valor Libra COP — auto-calculado -->
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">
              Valor Libra (COP) — Auto
            </label>
            <div style="position:relative;">
              <input type="text" id="calc-cfg-valorLibra-display" value="$ ${valLibraCopCalc}" readonly
                style="width:100%;background:var(--surface-2);border:1px dashed var(--glass-border);color:var(--text-muted);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;cursor:default;">
              <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:0.65rem;color:var(--text-faint);font-weight:600;">TRM × USD</span>
            </div>
            <p style="font-size:0.68rem;color:var(--text-faint);margin-top:4px;">Calculado automáticamente con TRM de referencia</p>
          </div>

          <!-- TRM Referencia (solo display) -->
          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">TRM de Referencia</label>
            <input type="number" id="calc-cfg-refTrm" value="${refTrm}"
              style="width:100%;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;">
            <p style="font-size:0.68rem;color:var(--text-faint);margin-top:4px;">Usada para previsualizar el Valor Libra COP</p>
          </div>

          <div>
            <label style="font-size:0.72rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px;">Costo Domicilio (COP)</label>
            <input type="number" id="calc-cfg-costoDomicilio" value="${config.costoDomicilio || 0}"
              style="width:100%;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:10px 14px;border-radius:12px;font-size:1rem;font-weight:700;outline:none;">
          </div>

        </div>
      </div>


      <!-- Matriz categorías -->
      <div class="glass-card" style="padding:0;overflow:hidden;">
        <div style="padding:1.2rem 1.5rem;border-bottom:1px solid var(--border-base);">
          <h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-faint);">2. Matriz de Pesos y Ganancias</h3>
        </div>
        <div class="table-wrapper" style="border-radius:0;border:none;box-shadow:none;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th class="text-center">Peso (Lbs)</th>
                <th class="text-center">Ganancia (COP)</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(config.categorias).map(([key, cat]) => `
                <tr>
                  <td><span style="font-weight:700;">${cat.label}</span></td>
                  <td class="text-center">
                    <input type="number" id="calc-cat-peso-${key}" value="${cat.peso || 0}"
                      style="width:80px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:6px 10px;border-radius:8px;font-weight:700;outline:none;text-align:center;">
                  </td>
                  <td class="text-center">
                    <input type="number" id="calc-cat-gan-${key}" value="${cat.ganancia || 0}"
                      style="width:120px;background:var(--input-bg);border:1px solid var(--glass-border);color:var(--text-main);padding:6px 10px;border-radius:8px;font-weight:700;outline:none;text-align:center;">
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Botón guardar -->
      <div style="display:flex;justify-content:flex-end;">
        <button id="calc-cfg-save-btn" class="btn-primary" style="padding:12px 32px;font-size:0.95rem;">💾 Guardar Configuración</button>
      </div>
    </div>
  `;
}

// ── Event Binding ───────────────────────────────────────────

function bindAdminEvents(users, navigateTo, renderLayout, calcConfig) {
  // ── Tabs --
  document.getElementById('admin-tab-usuarios')?.addEventListener('click', () => {
    _adminActiveTab = 'usuarios';
    renderAdmin(renderLayout, navigateTo);
  });
  document.getElementById('admin-tab-calculadora')?.addEventListener('click', () => {
    _adminActiveTab = 'calculadora';
    renderAdmin(renderLayout, navigateTo);
  });
  // Botón nuevo usuario
  document.getElementById('admin-new-user-btn')?.addEventListener('click', () => {
    openUserModal(null, users, navigateTo, renderLayout);
  });

  // Búsqueda en tiempo real
  document.getElementById('admin-search')?.addEventListener('input', (e) => {
    filterTable(e.target.value, document.getElementById('admin-role-filter')?.value);
  });

  document.getElementById('admin-role-filter')?.addEventListener('change', (e) => {
    filterTable(document.getElementById('admin-search')?.value || '', e.target.value);
  });

  // Globals para acciones de tabla
  window.adminEditUser = (userId) => {
    const user = users.find(u => u.id === userId);
    if (user) openUserModal(user, users, navigateTo, renderLayout);
  };

  window.adminToggleUser = async (userId, newActive) => {
    try {
      await auth.toggleUserActive(userId, newActive);
      // Refresh
      renderAdmin(renderLayout, navigateTo);
    } catch (err) {
      window.showToast('Error: ' + err.message, 'error');
    }
  };

  window.adminResetPassword = (userId, userName) => {
    openResetPasswordModal(userId, userName);
  };

  window.adminViewLogs = (userId, userName) => {
    openLogsModal(userId, userName);
  };

  // ── Guardar config calculadora ──────────────────────────────
  document.getElementById('calc-cfg-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('calc-cfg-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const valorLibraUsd = parseFloat(document.getElementById('calc-cfg-valorLibraUsd')?.value) || 0;
      const refTrm        = parseFloat(document.getElementById('calc-cfg-refTrm')?.value) || 4200;
      const newConfig = {
        taxUsa:         parseFloat(document.getElementById('calc-cfg-taxUsa')?.value) || 0,
        comisionTC:     parseFloat(document.getElementById('calc-cfg-comisionTC')?.value) || 0,
        valorLibraUsd,
        valorLibra:     valorLibraUsd * refTrm,   // COP calculado = USD × TRM referencia
        costoDomicilio: parseFloat(document.getElementById('calc-cfg-costoDomicilio')?.value) || 0,
        categorias: {}
      };
      Object.keys(calcConfig.categorias).forEach(key => {
        newConfig.categorias[key] = {
          ...calcConfig.categorias[key],
          peso:     parseFloat(document.getElementById(`calc-cat-peso-${key}`)?.value) || 0,
          ganancia: parseFloat(document.getElementById(`calc-cat-gan-${key}`)?.value) || 0,
        };
      });
      await saveCalcConfig(newConfig);
      showToast('✅ Configuración de calculadora guardada exitosamente', 'success');
      setTimeout(() => renderAdmin(renderLayout, navigateTo), 800);
    } catch (err) {
      showToast('Error al guardar: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '💾 Guardar Configuración';
    }
  });

  // ── Auto-cálculo Valor Libra COP en tiempo real ──────────────
  const updateLibraCOP = () => {
    const usd = parseFloat(document.getElementById('calc-cfg-valorLibraUsd')?.value) || 0;
    const trm = parseFloat(document.getElementById('calc-cfg-refTrm')?.value) || 0;
    const display = document.getElementById('calc-cfg-valorLibra-display');
    if (display) display.value = `$ ${(usd * trm).toLocaleString('es-CO')}`;
  };
  document.getElementById('calc-cfg-valorLibraUsd')?.addEventListener('input', updateLibraCOP);
  document.getElementById('calc-cfg-refTrm')?.addEventListener('input', updateLibraCOP);
}


function filterTable(search, role) {
  const rows = document.querySelectorAll('#admin-users-tbody tr[data-user-id]');
  search = (search || '').toLowerCase();
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    const roleBadge = row.querySelector('.admin-role-badge')?.textContent.toLowerCase() || '';
    const matchSearch = !search || text.includes(search);
    const matchRole = !role || roleBadge.includes(ROLE_LABELS[role]?.toLowerCase() || role);
    row.style.display = (matchSearch && matchRole) ? '' : 'none';
  });
}

// ── Modal Crear/Editar Usuario ──────────────────────────────

function openUserModal(user, allUsers, navigateTo, renderLayout) {
  const isEdit = !!user;
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  
  const currentPerms = user?.permissions || ROLE_TEMPLATES.viewer;
  const currentRole = user?.role || 'viewer';

  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <h2>${isEdit ? `Editar: ${user.full_name}` : 'Crear Usuario'}</h2>
          <p style="opacity:0.6; font-size:0.9rem;">
            ${isEdit ? user.email : 'Configura las credenciales y permisos del nuevo integrante.'}
          </p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>

      <div class="modal-body">
        <div class="admin-modal-scroll-area" style="display:flex; flex-direction:column; gap:2rem;">
          ${!isEdit ? `
            <div class="admin-form-section">
              <h4 class="admin-section-title" style="margin-bottom:1rem; font-size:0.85rem; text-transform:uppercase; color:var(--brand-magenta); letter-spacing:1px;">1. Datos de acceso</h4>
              <div class="form-grid">
                <div class="form-group" style="grid-column: span 6;">
                  <label>Nombre completo</label>
                  <input type="text" id="new-user-name" placeholder="Ej: Juan Pérez" autocomplete="off" />
                </div>
                <div class="form-group" style="grid-column: span 6;">
                  <label>Correo electrónico</label>
                  <input type="email" id="new-user-email" placeholder="juan@jarapo.com" autocomplete="off" />
                </div>
                <div class="form-group" style="grid-column: span 12;">
                  <label>Contraseña inicial</label>
                  <div style="position:relative;">
                    <input type="password" id="new-user-password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" style="padding-right:45px;" />
                    <button type="button" id="toggle-new-password" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-faint); cursor:pointer;">👁️</button>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}

          <div class="admin-form-section">
            <h4 class="admin-section-title" style="margin-bottom:1rem; font-size:0.85rem; text-transform:uppercase; color:var(--brand-magenta); letter-spacing:1px;">2. Rol del usuario</h4>
            <div class="admin-role-selector" id="admin-role-selector" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
              ${Object.entries(ROLE_LABELS).map(([key, label]) => `
                <button 
                  type="button"
                  class="admin-role-btn ${currentRole === key ? 'selected' : ''}"
                  data-role="${key}"
                  style="padding:12px; border-radius:12px; border:1px solid var(--glass-border); background:var(--glass-hover); color:var(--text-main); cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:600; transition:0.2s;"
                >
                  <span style="width:8px; height:8px; border-radius:50%; background:${ROLE_COLORS[key]}"></span>
                  ${label}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="admin-form-section">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
              <h4 class="admin-section-title" style="margin:0; font-size:0.85rem; text-transform:uppercase; color:var(--brand-magenta); letter-spacing:1px;">3. Permisos de Módulos</h4>
              <span style="font-size:0.75rem; opacity:0.5;">La plantilla de rol se aplica al seleccionar</span>
            </div>
            <div id="admin-perms-grid" style="display:flex; flex-direction:column; gap:8px;">
              ${buildPermsGrid(currentPerms)}
            </div>
          </div>

          <div id="admin-modal-alert" class="login-alert" style="display:none; margin-top:1rem;"></div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button class="btn-primary" id="admin-modal-save-btn" style="padding:12px 30px;">
          ${isEdit ? 'Guardar Cambios' : 'Crear Usuario'}
        </button>
      </div>
    </div>
  `;

  container.style.display = 'flex';
  // Manejo de roles y guardado

  // Selección de rol → aplica plantilla de permisos
  document.getElementById('admin-role-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-role-btn');
    if (!btn) return;
    
    document.querySelectorAll('.admin-role-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    
    const role = btn.dataset.role;
    const template = ROLE_TEMPLATES[role];
    document.getElementById('admin-perms-grid').innerHTML = buildPermsGrid(template);
  });

  // Guardar
  document.getElementById('admin-modal-save-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('admin-modal-save-btn');
    const alertEl = document.getElementById('admin-modal-alert');
    
    const selectedRoleBtn = document.querySelector('.admin-role-btn.selected');
    const selectedRole = selectedRoleBtn?.dataset.role || 'viewer';
    const permissions = collectPermissions();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    alertEl.style.display = 'none';

    try {
      if (isEdit) {
        await auth.updateUserProfile(user.id, { role: selectedRole, permissions });
      } else {
        const name = document.getElementById('new-user-name')?.value.trim();
        const email = document.getElementById('new-user-email')?.value.trim();
        const password = document.getElementById('new-user-password')?.value;

        if (!name || !email || !password) throw new Error('Completa todos los campos.');
        if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

        await auth.createUser(email, password, name, selectedRole, permissions);
      }

      window.closeModal();
      // Refresh completo
      setTimeout(() => renderAdmin(renderLayout, navigateTo), 300);

    } catch (err) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = err.message;
      alertEl.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Guardar cambios' : 'Crear usuario';
    }
  });
}

function buildPermsGrid(perms) {
  const modules = ['dashboard','clients','inventory','sales','purchases','logistics','finance','calculadora','params','admin','feat_money','feat_usa','feat_calc_desglose'];

  
  return modules.map(mod => {
    const perm = perms[mod];
    const isBoolean = mod === 'admin' || mod === 'dashboard' || mod.startsWith('feat_');
    
    return `
      <div class="admin-perm-row">
        <div class="admin-perm-label">
          <span class="admin-perm-dot ${perm ? 'active' : ''}"></span>
          <span>${MODULE_LABELS[mod]}</span>
          ${mod === 'admin' ? '<span class="admin-badge-admin">Solo Admin</span>' : ''}
          ${mod.startsWith('feat_') ? '<span style="font-size:0.65rem; background:var(--glass-border); padding:2px 6px; border-radius:4px; margin-left:6px;">UI Feature</span>' : ''}
        </div>
        <div class="admin-perm-controls">
          ${isBoolean ? `
            <label class="admin-toggle-wrap">
              <input type="checkbox" class="admin-perm-check" data-module="${mod}" data-level="admin" ${perm ? 'checked' : ''} />
              <span class="admin-toggle-slider"></span>
              <span class="admin-toggle-label">Activar</span>
            </label>
          ` : `
            <label class="admin-toggle-wrap">
              <input type="checkbox" class="admin-perm-check" data-module="${mod}" data-level="view" 
                ${perm === 'view' || perm === 'edit' || perm === true ? 'checked' : ''} />
              <span class="admin-toggle-slider"></span>
              <span class="admin-toggle-label">Ver</span>
            </label>
            <label class="admin-toggle-wrap">
              <input type="checkbox" class="admin-perm-check" data-module="${mod}" data-level="edit" 
                ${perm === 'edit' || perm === true ? 'checked' : ''} />
              <span class="admin-toggle-slider"></span>
              <span class="admin-toggle-label">Editar</span>
            </label>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function collectPermissions() {
  const perms = {};
  const viewChecks = document.querySelectorAll('.admin-perm-check[data-level="view"]');
  const editChecks = document.querySelectorAll('.admin-perm-check[data-level="edit"]');
  const adminChecks = document.querySelectorAll('.admin-perm-check[data-level="admin"]');

  viewChecks.forEach(el => {
    const mod = el.dataset.module;
    perms[mod] = el.checked ? 'view' : false;
  });

  editChecks.forEach(el => {
    const mod = el.dataset.module;
    if (el.checked) perms[mod] = 'edit';
  });

  adminChecks.forEach(el => {
    const mod = el.dataset.module;
    perms[mod] = el.checked;
  });

  adminChecks.forEach(el => {
    const mod = el.dataset.module;
    perms[mod] = el.checked ? true : false;
  });

  // dashboard siempre true si tiene algún acceso
  return perms;
}

function openResetPasswordModal(userId, userName) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <h2>Restablecer Contraseña</h2>
          <p style="opacity:0.6; font-size:0.9rem;">Usuario: <strong>${userName}</strong></p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group" style="grid-column: span 12;">
            <label>Nueva contraseña</label>
            <div style="position:relative;">
              <input type="password" id="reset-new-password" placeholder="Mínimo 6 caracteres" autocomplete="new-password" style="padding-right:45px;" />
              <button type="button" id="toggle-reset-1" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-faint); cursor:pointer;">👁️</button>
            </div>
          </div>
          <div class="form-group" style="grid-column: span 12;">
            <label>Confirmar contraseña</label>
            <div style="position:relative;">
              <input type="password" id="reset-confirm-password" placeholder="Repetir contraseña" autocomplete="new-password" style="padding-right:45px;" />
              <button type="button" id="toggle-reset-2" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-faint); cursor:pointer;">👁️</button>
            </div>
          </div>
        </div>
        <div id="reset-alert" class="login-alert" style="display:none; margin-top:1.5rem;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button class="btn-primary" id="reset-save">Cambiar Contraseña</button>
      </div>
    </div>
  `;

  container.style.display = 'flex';
  // Toggles de visibilidad
  document.getElementById('toggle-reset-1')?.addEventListener('click', () => {
    const inp = document.getElementById('reset-new-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('toggle-reset-2')?.addEventListener('click', () => {
    const inp = document.getElementById('reset-confirm-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('reset-save').addEventListener('click', async () => {
    const np = document.getElementById('reset-new-password').value;
    const cp = document.getElementById('reset-confirm-password').value;
    const alertEl = document.getElementById('reset-alert');

    if (!np || !cp) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = 'Completa ambos campos.';
      alertEl.style.display = 'block';
      return;
    }
    if (np !== cp) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = 'Las contraseñas no coinciden.';
      alertEl.style.display = 'block';
      return;
    }
    if (np.length < 6) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = 'Mínimo 6 caracteres.';
      alertEl.style.display = 'block';
      return;
    }

    try {
      await auth.resetUserPassword(userId, np);
      window.closeModal();
    } catch (err) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = err.message;
      alertEl.style.display = 'block';
    }
  });
}

// ── Modal Historial de Logueos ──────────────────────────────
async function openLogsModal(userId, userName) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <h2>Historial de Accesos</h2>
          <p style="opacity:0.6; font-size:0.9rem;">Usuario: <strong>${userName}</strong></p>
        </div>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="logs-loading" style="text-align:center; padding:3rem;"><div class="loader"></div><p style="margin-top:10px; opacity:0.6;">Cargando historial...</p></div>
        <div id="logs-container" style="display:none; max-height:450px; overflow-y:auto; padding-right:8px; display:flex; flex-direction:column; gap:10px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cerrar</button>
      </div>
    </div>
  `;

  container.style.display = 'flex';

  // Fetch logs
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = import.meta.env?.VITE_SUPABASE_URL || localStorage.getItem('JARAPO_SUPA_URL');
    const key = import.meta.env?.VITE_SUPABASE_KEY || localStorage.getItem('JARAPO_SUPA_KEY');
    const client = createClient(url, key);

    const { data, error } = await client
      .from('login_logs')
      .select('login_time')
      .eq('user_id', userId)
      .order('login_time', { ascending: false })
      .limit(50);

    const loadingEl = document.getElementById('logs-loading');
    const containerEl = document.getElementById('logs-container');

    loadingEl.style.display = 'none';
    containerEl.style.display = 'block';

    if (error) {
      containerEl.innerHTML = `<div class="login-alert login-alert-error">Error al cargar historial: ${error.message}</div>`;
      return;
    }

    if (!data || data.length === 0) {
      containerEl.innerHTML = `<div style="text-align:center; opacity:0.6; padding:2rem;">Este usuario aún no registra accesos en el nuevo historial.</div>`;
      return;
    }

    containerEl.innerHTML = data.map(log => {
      const d = new Date(log.login_time);
      const dateStr = d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
      const timeStr = d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
      return `
        <div style="background:var(--input-bg); padding:1rem; border-radius:12px; border:1px solid var(--glass-border); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.5rem;">🔑</span>
            <div>
              <strong style="display:block; font-size:0.9rem;">Acceso al sistema</strong>
              <span style="font-size:0.75rem; color:var(--text-faint);">${dateStr} · ${timeStr}</span>
            </div>
          </div>
          <span style="font-size:0.7rem; background:var(--success-green); color:black; padding:2px 8px; border-radius:12px; font-weight:700;">Éxito</span>
        </div>
      `;
    }).join('');

  } catch (err) {
    document.getElementById('logs-loading').style.display = 'none';
    const containerEl = document.getElementById('logs-container');
    containerEl.style.display = 'block';
    containerEl.innerHTML = `<div class="login-alert login-alert-error">No se pudo cargar el historial. ${err.message}</div>`;
  }
}
