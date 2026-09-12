/**
 * superadmin.js — Panel de Superadmin (Fase D del plan SaaS multi-tenant)
 * Único módulo visible para el rol 'superadmin'. Toda escritura pasa por la
 * Netlify Function netlify/functions/admin-empresas.js (service role key) —
 * este archivo nunca toca "Empresas" ni "user_profiles" directamente.
 */
import { auth } from '../auth.js';
import { showToast } from '../utils.js';

const ESTADOS = ['trial', 'activa', 'vencida', 'cancelada'];
const ESTADO_LABELS = { trial: 'Trial', activa: 'Activa', vencida: 'Vencida', cancelada: 'Cancelada' };
const ESTADO_COLORS = { trial: '#7C3AED', activa: '#059669', vencida: '#DC6803', cancelada: '#DC2626' };

async function callAdminEmpresas(payload) {
  const token = auth.getSession()?.access_token;
  if (!token) throw new Error('Sesión no válida.');
  const res = await fetch('/.netlify/functions/admin-empresas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const renderSuperadmin = async (renderLayout) => {
  renderLayout(`<div class="admin-loading"><div class="loader"></div><p>Cargando empresas...</p></div>`);

  let empresas = [];
  let loadError = null;
  try {
    const data = await callAdminEmpresas({ accion: 'listar_empresas' });
    empresas = data.empresas || [];
  } catch (err) {
    loadError = err.message;
  }

  renderLayout(buildHTML(empresas, loadError));
  bindEvents(renderLayout);
};

function buildHTML(empresas, error) {
  return `
    <div class="module-header">
      <div>
        <p class="module-tag">SUPERADMIN · ENCARGOSPRO</p>
        <h2 class="module-title">Empresas</h2>
      </div>
      <button class="btn-primary" id="sa-new-empresa-btn">+ Crear Empresa</button>
    </div>

    ${error ? `<div class="admin-error-banner">⚠ ${error}</div>` : ''}

    <div style="overflow-x:auto;">
      <table class="data-table" style="width:100%;">
        <thead>
          <tr>
            <th>Empresa</th>
            <th>Slug</th>
            <th>Plan</th>
            <th>Estado</th>
            <th>Vence</th>
            <th>Usuarios</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${empresas.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:2rem;opacity:0.6;">Sin empresas todavía.</td></tr>` : ''}
          ${empresas.map(e => `
            <tr>
              <td><strong>${e.nombre}</strong></td>
              <td><code>${e.slug}</code></td>
              <td>${e.plan}</td>
              <td><span style="background:${ESTADO_COLORS[e.estado_suscripcion]}22;color:${ESTADO_COLORS[e.estado_suscripcion]};padding:2px 10px;border-radius:99px;font-size:0.78rem;font-weight:600;">${ESTADO_LABELS[e.estado_suscripcion] || e.estado_suscripcion}</span></td>
              <td>${e.fecha_vencimiento || '—'}</td>
              <td>${e.num_usuarios}</td>
              <td style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn-secondary sa-btn-estado" data-id="${e.id}" data-nombre="${e.nombre}" data-estado="${e.estado_suscripcion}" style="padding:4px 10px;font-size:0.8rem;">Cambiar estado</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindEvents(renderLayout) {
  document.getElementById('sa-new-empresa-btn')?.addEventListener('click', () => modalCrearEmpresa(renderLayout));
  document.querySelectorAll('.sa-btn-estado').forEach(btn => {
    btn.addEventListener('click', () => modalCambiarEstado(btn.dataset.id, btn.dataset.nombre, btn.dataset.estado, renderLayout));
  });
}

function modalCrearEmpresa(renderLayout) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">🏢 Crear Empresa Nueva</h2>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-crear-empresa" style="display:flex;flex-direction:column;gap:1rem;">
          <div class="form-group">
            <label class="form-label">Nombre de la empresa *</label>
            <input type="text" id="ce-nombre" required class="form-input" placeholder="Ej: Importaciones XYZ">
          </div>
          <div class="form-group">
            <label class="form-label">Slug (identificador único) *</label>
            <input type="text" id="ce-slug" required class="form-input" placeholder="Ej: importaciones-xyz" pattern="[a-z0-9\\-]+">
          </div>
          <div class="form-group">
            <label class="form-label">Plan</label>
            <input type="text" id="ce-plan" class="form-input" placeholder="basico" value="basico">
          </div>
          <hr style="border-color:var(--border-base);opacity:0.5;">
          <p style="font-size:0.85rem;opacity:0.7;margin:0;">Primer usuario administrador de esta empresa:</p>
          <div class="form-group">
            <label class="form-label">Nombre completo *</label>
            <input type="text" id="ce-admin-nombre" required class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">Email *</label>
            <input type="email" id="ce-admin-email" required class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">Contraseña temporal *</label>
            <input type="text" id="ce-admin-password" required class="form-input" minlength="6">
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button type="submit" form="form-crear-empresa" class="btn-primary" id="ce-btn-save">Crear</button>
      </div>
    </div>`;
  container.style.display = 'flex';

  document.getElementById('form-crear-empresa').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ce-btn-save');
    btn.disabled = true; btn.innerText = 'Creando...';
    try {
      await callAdminEmpresas({
        accion: 'crear_empresa',
        nombre: document.getElementById('ce-nombre').value.trim(),
        slug: document.getElementById('ce-slug').value.trim(),
        plan: document.getElementById('ce-plan').value.trim() || 'basico',
        nombreAdmin: document.getElementById('ce-admin-nombre').value.trim(),
        emailAdmin: document.getElementById('ce-admin-email').value.trim(),
        passwordAdmin: document.getElementById('ce-admin-password').value,
      });
      window.closeModal();
      showToast('✅ Empresa creada correctamente', 'success');
      renderSuperadmin(renderLayout);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.innerText = 'Crear';
    }
  };
}

function modalCambiarEstado(empresaId, nombre, estadoActual, renderLayout) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Suscripción — ${nombre}</h2>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <form id="form-estado-empresa" style="display:flex;flex-direction:column;gap:1rem;">
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select id="ce-estado" class="form-input">
              ${ESTADOS.map(s => `<option value="${s}" ${s === estadoActual ? 'selected' : ''}>${ESTADO_LABELS[s]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha de vencimiento</label>
            <input type="date" id="ce-fecha-vencimiento" class="form-input">
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button type="submit" form="form-estado-empresa" class="btn-primary" id="ce-estado-btn-save">Guardar</button>
      </div>
    </div>`;
  container.style.display = 'flex';

  document.getElementById('form-estado-empresa').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ce-estado-btn-save');
    btn.disabled = true; btn.innerText = 'Guardando...';
    try {
      const fecha = document.getElementById('ce-fecha-vencimiento').value;
      await callAdminEmpresas({
        accion: 'actualizar_suscripcion',
        empresa_id: empresaId,
        estado_suscripcion: document.getElementById('ce-estado').value,
        ...(fecha ? { fecha_vencimiento: fecha } : {}),
      });
      window.closeModal();
      showToast('✅ Suscripción actualizada', 'success');
      renderSuperadmin(renderLayout);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.innerText = 'Guardar';
    }
  };
}

export default renderSuperadmin;
