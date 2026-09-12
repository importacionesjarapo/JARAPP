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
      <div style="display:flex;gap:10px;">
        <button class="btn-secondary" id="sa-migrar-imagenes-btn">🗂️ Migrar imágenes antiguas</button>
        <button class="btn-primary" id="sa-new-empresa-btn">+ Crear Empresa</button>
      </div>
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
  document.getElementById('sa-migrar-imagenes-btn')?.addEventListener('click', () => modalMigrarImagenes());
  document.querySelectorAll('.sa-btn-estado').forEach(btn => {
    btn.addEventListener('click', () => modalCambiarEstado(btn.dataset.id, btn.dataset.nombre, btn.dataset.estado, renderLayout));
  });
}

const LOTE_MIGRACION = 8;

async function modalMigrarImagenes() {
  const ok = await window.customConfirm(
    'Migrar imágenes antiguas',
    'Copia las fotos de producto, logo y comprobantes de pago de Importaciones Jarapo desde el bucket viejo "jarapo-images" a los buckets nuevos por empresa, y actualiza las referencias en la base de datos. No borra nada del bucket viejo. ¿Continuar?'
  );
  if (!ok) return;

  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">🗂️ Migrando imágenes…</h2>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body" id="sa-migrar-body">
        <div class="admin-loading"><div class="loader"></div><p>Armando el plan de migración…</p></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">Cerrar</button>
      </div>
    </div>`;
  container.style.display = 'flex';
  const body = () => document.getElementById('sa-migrar-body');

  try {
    // 1) Plan: solo lectura, rápido sin importar cuántos archivos haya.
    const plan = await callAdminEmpresas({ accion: 'plan_migracion_imagenes' });
    const { empresaId, totalObjetos, porMigrar, huerfanos } = plan;

    const migrados = [];
    const errores = [];

    // 2) Lotes chicos secuenciales — cada llamada a la función queda muy
    //    por debajo del timeout de ~10s de Netlify, sin importar que en
    //    total haya cientos de archivos.
    for (let i = 0; i < porMigrar.length; i += LOTE_MIGRACION) {
      const lote = porMigrar.slice(i, i + LOTE_MIGRACION);
      body().innerHTML = `<div class="admin-loading"><div class="loader"></div><p>Migrando ${Math.min(i + LOTE_MIGRACION, porMigrar.length)} de ${porMigrar.length}… No cierres esta ventana.</p></div>`;
      try {
        const loteResultado = await callAdminEmpresas({ accion: 'migrar_lote_imagenes', empresaId, archivos: lote });
        migrados.push(...loteResultado.migrados);
        errores.push(...loteResultado.errores);
      } catch (err) {
        lote.forEach(item => errores.push({ archivo: item.archivo, error: err.message }));
      }
    }

    body().innerHTML = `
      <p>Total de archivos en el bucket viejo: <strong>${totalObjetos}</strong></p>
      <p style="color:var(--success-green, #059669);">✅ Migrados correctamente: <strong>${migrados.length}</strong></p>
      <p style="color:var(--warning, #DC6803);">⚠️ Sin referencia en la base de datos (huérfanos): <strong>${huerfanos.length}</strong></p>
      <p style="color:var(--danger, #DC2626);">❌ Errores: <strong>${errores.length}</strong></p>
      ${errores.length ? `<details style="margin-top:0.75rem;"><summary style="cursor:pointer;">Ver errores</summary><pre style="white-space:pre-wrap;font-size:0.78rem;max-height:200px;overflow:auto;">${errores.map(e => `${e.archivo}: ${e.error}`).join('\n')}</pre></details>` : ''}
      ${huerfanos.length ? `<details style="margin-top:0.5rem;"><summary style="cursor:pointer;">Ver huérfanos</summary><pre style="white-space:pre-wrap;font-size:0.78rem;max-height:200px;overflow:auto;">${huerfanos.join('\n')}</pre></details>` : ''}
      <p style="margin-top:1rem;font-size:0.82rem;opacity:0.7;">El bucket viejo "jarapo-images" no se tocó — bórralo manualmente desde el dashboard de Supabase solo después de confirmar que todo se ve bien en la app.</p>
    `;
  } catch (err) {
    body().innerHTML = `<div class="admin-error-banner">⚠ ${err.message}</div>`;
  }
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
