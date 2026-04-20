/**
 * admin.js — Módulo Administrativo de Usuarios y Permisos
 * JARAPP 2026 · Solo accesible para rol 'admin'
 */

import { auth, ROLE_TEMPLATES, ROLE_LABELS, ROLE_COLORS, MODULE_LABELS } from '../auth.js';

export const renderAdmin = async (renderLayout, navigateTo) => {
  renderLayout(`<div class="admin-loading"><div class="loader"></div><p>Cargando panel administrativo...</p></div>`);

  let users = [];
  let loadError = null;

  try {
    users = await auth.getAllUsers();
  } catch (err) {
    loadError = err.message;
  }

  const html = buildAdminHTML(users, loadError);
  renderLayout(html);
  bindAdminEvents(users, navigateTo, renderLayout);
};

// ── HTML Builder ────────────────────────────────────────────

function buildAdminHTML(users, error) {
  return `
    <div class="module-header">
      <div>
        <p class="module-tag">ADMINISTRACIÓN · RBAC</p>
        <h2 class="module-title">Control de Acceso</h2>
      </div>
      <button class="btn-primary" id="admin-new-user-btn">+ Crear Usuario</button>
    </div>

    ${error ? `<div class="admin-error-banner">⚠ Error al cargar usuarios: ${error}</div>` : ''}

    <!-- KPI Strip -->
    <div class="kpi-grid" style="margin-bottom:1.5rem;">
      ${buildAdminKPIs(users)}
    </div>

    <!-- Tabla de usuarios -->
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

    <!-- Modal de creación/edición de usuario -->
    <div id="admin-user-modal" class="admin-modal-overlay" style="display:none;">
      <div class="admin-modal-panel">
        <div class="admin-modal-accent"></div>
        <div id="admin-modal-body"><!-- Inyectado dinámicamente --></div>
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
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Event Binding ───────────────────────────────────────────

function bindAdminEvents(users, navigateTo, renderLayout) {
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
      alert('Error: ' + err.message);
    }
  };

  window.adminResetPassword = (userId, userName) => {
    openResetPasswordModal(userId, userName);
  };
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
  const modal = document.getElementById('admin-user-modal');
  const body = document.getElementById('admin-modal-body');
  
  const currentPerms = user?.permissions || ROLE_TEMPLATES.viewer;
  const currentRole = user?.role || 'viewer';

  body.innerHTML = `
    <div class="admin-modal-header">
      <div>
        <h3>${isEdit ? `Editar: ${user.full_name}` : 'Crear Nuevo Usuario'}</h3>
        <p style="font-size:0.78rem; color:var(--text-faint); margin-top:4px;">
          ${isEdit ? user.email : 'El usuario recibirá acceso con las credenciales definidas'}
        </p>
      </div>
      <button class="admin-modal-close" id="admin-modal-close-btn">✕</button>
    </div>

    <div class="admin-modal-content">
      ${!isEdit ? `
        <div class="admin-form-section">
          <h4 class="admin-section-title">Datos de acceso</h4>
          <div class="admin-form-grid">
            <div class="login-field">
              <label class="login-label">Nombre completo</label>
              <input type="text" id="new-user-name" class="login-input" placeholder="Nombre Apellido"
                autocomplete="off" autocorrect="off" autocapitalize="off" />
            </div>
            <div class="login-field">
              <label class="login-label">Correo electrónico</label>
              <input type="text" inputmode="email" id="new-user-email" class="login-input"
                placeholder="usuario@email.com" autocomplete="off" autocorrect="off"
                autocapitalize="off" spellcheck="false" />
            </div>
            <div class="login-field" style="grid-column:1/-1;">
              <label class="login-label">Contraseña inicial</label>
              <div class="login-input-wrap">
                <input type="password" id="new-user-password" class="login-input"
                  placeholder="Mínimo 6 caracteres" autocomplete="new-password"
                  style="padding-left:14px; padding-right:42px;" />
                <button type="button" class="login-eye-btn" id="toggle-new-password" title="Ver/Ocultar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      <div class="admin-form-section">
        <h4 class="admin-section-title">Rol del usuario</h4>
        <div class="admin-role-selector" id="admin-role-selector">
          ${Object.entries(ROLE_LABELS).map(([key, label]) => `
            <button 
              type="button"
              class="admin-role-btn ${currentRole === key ? 'selected' : ''}"
              data-role="${key}"
              style="--role-color:${ROLE_COLORS[key]}"
            >
              <span class="admin-role-dot" style="background:${ROLE_COLORS[key]}"></span>
              ${label}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="admin-form-section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h4 class="admin-section-title" style="margin:0;">Permisos por módulo</h4>
          <span style="font-size:0.72rem; color:var(--text-faint);">Selecciona el rol para aplicar plantilla</span>
        </div>
        <div class="admin-perms-grid" id="admin-perms-grid">
          ${buildPermsGrid(currentPerms)}
        </div>
      </div>

      <div id="admin-modal-alert" class="login-alert" style="display:none;"></div>
    </div>

    <div class="admin-modal-footer">
      <button class="btn-action" id="admin-modal-cancel-btn">Cancelar</button>
      <button class="btn-primary" id="admin-modal-save-btn">
        ${isEdit ? 'Guardar cambios' : 'Crear usuario'}
      </button>
    </div>
  `;

  modal.style.display = 'flex';
  setTimeout(() => {
    modal.classList.add('admin-modal-visible');
    // Limpiar campos del browser para evitar autocomplete con datos anteriores
    const emailInp = document.getElementById('new-user-email');
    const nameInp  = document.getElementById('new-user-name');
    const passInp  = document.getElementById('new-user-password');
    if (emailInp) emailInp.value = '';
    if (nameInp)  nameInp.value = '';
    if (passInp)  passInp.value = '';
    // Toggle contraseña en modal crear usuario
    document.getElementById('toggle-new-password')?.addEventListener('click', () => {
      const inp = document.getElementById('new-user-password');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }, 80);

  // Cerrar modal
  const closeModal = () => {
    modal.classList.remove('admin-modal-visible');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  };
  document.getElementById('admin-modal-close-btn').onclick = closeModal;
  document.getElementById('admin-modal-cancel-btn').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

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

      closeModal();
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
  const modules = ['dashboard','clients','inventory','sales','purchases','logistics','finance','params','admin'];
  
  return modules.map(mod => {
    const perm = perms[mod];
    const isAdmin = mod === 'admin';
    
    return `
      <div class="admin-perm-row">
        <div class="admin-perm-label">
          <span class="admin-perm-dot ${perm ? 'active' : ''}"></span>
          <span>${MODULE_LABELS[mod]}</span>
          ${isAdmin ? '<span class="admin-badge-admin">Solo Admin</span>' : ''}
        </div>
        <div class="admin-perm-controls">
          ${isAdmin ? `
            <label class="admin-toggle-wrap">
              <input type="checkbox" class="admin-perm-check" data-module="${mod}" data-level="admin" ${perm ? 'checked' : ''} />
              <span class="admin-toggle-slider"></span>
              <span class="admin-toggle-label">Acceso</span>
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
    perms[mod] = el.checked ? true : false;
  });

  // dashboard siempre true si tiene algún acceso
  return perms;
}

function openResetPasswordModal(userId, userName) {
  const modal = document.getElementById('admin-user-modal');
  const body = document.getElementById('admin-modal-body');

  body.innerHTML = `
    <div class="admin-modal-header">
      <div>
        <h3>Restablecer Contraseña</h3>
        <p style="font-size:0.78rem; color:var(--text-faint); margin-top:4px;">Usuario: <strong>${userName}</strong></p>
      </div>
      <button class="admin-modal-close" id="reset-modal-close">✕</button>
    </div>
    <div class="admin-modal-content">
      <div class="login-field">
        <label class="login-label">Nueva contraseña</label>
        <div class="login-input-wrap">
          <input type="password" id="reset-new-password" class="login-input"
            placeholder="Mínimo 6 caracteres" autocomplete="new-password"
            style="padding-left:14px; padding-right:42px;" />
          <button type="button" class="login-eye-btn" id="toggle-reset-1" title="Ver/Ocultar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="login-field">
        <label class="login-label">Confirmar contraseña</label>
        <div class="login-input-wrap">
          <input type="password" id="reset-confirm-password" class="login-input"
            placeholder="Repetir contraseña" autocomplete="new-password"
            style="padding-left:14px; padding-right:42px;" />
          <button type="button" class="login-eye-btn" id="toggle-reset-2" title="Ver/Ocultar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="reset-alert" class="login-alert" style="display:none;"></div>
    </div>
    <div class="admin-modal-footer">
      <button class="btn-action" id="reset-cancel">Cancelar</button>
      <button class="btn-primary" id="reset-save">Cambiar contraseña</button>
    </div>
  `;

  modal.style.display = 'flex';
  setTimeout(() => {
    modal.classList.add('admin-modal-visible');
    // Toggles de visibilidad de contraseña
    document.getElementById('toggle-reset-1')?.addEventListener('click', () => {
      const inp = document.getElementById('reset-new-password');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('toggle-reset-2')?.addEventListener('click', () => {
      const inp = document.getElementById('reset-confirm-password');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }, 80);

  const closeModal = () => {
    modal.classList.remove('admin-modal-visible');
    setTimeout(() => { modal.style.display = 'none'; }, 300);
  };

  document.getElementById('reset-modal-close').onclick = closeModal;
  document.getElementById('reset-cancel').onclick = closeModal;

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
      closeModal();
    } catch (err) {
      alertEl.className = 'login-alert login-alert-error';
      alertEl.textContent = err.message;
      alertEl.style.display = 'block';
    }
  });
}
