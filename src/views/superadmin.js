/**
 * superadmin.js — Panel de Superadmin (Fase D del plan SaaS multi-tenant)
 * Único módulo visible para el rol 'superadmin'. Toda escritura pasa por la
 * Netlify Function netlify/functions/admin-empresas.js (service role key) —
 * este archivo nunca toca "Empresas" ni "user_profiles" directamente.
 */
import { auth } from '../auth.js';
import { showToast } from '../utils.js';

let _superadminActiveTab = 'empresas'; // 'empresas' | 'planes'

const ESTADOS = ['trial', 'activa', 'vencida', 'cancelada'];
const ESTADO_LABELS = { trial: 'Trial', activa: 'Activa', vencida: 'Vencida', cancelada: 'Cancelada' };
const ESTADO_COLORS = { trial: '#7C3AED', activa: '#059669', vencida: '#DC6803', cancelada: '#DC2626' };

// Módulos que el superadmin puede prender/apagar por plan — gatean si el
// módulo aparece BLOQUEADO (candado + upsell) o disponible en el sidebar
// de una empresa con ese plan (auth.isModuleLockedByPlan(), en main.js).
// Es independiente del sistema de roles/permisos por usuario (ROLE_TEMPLATES
// en auth.js): esto dice qué trae contratado la EMPRESA, no qué puede hacer
// un usuario puntual dentro de ella. 'dashboard' no se lista porque lo
// tiene todo el mundo siempre en cualquier plan.
const MODULOS_PLAN_TOGGLES = [
  { key: 'sales', label: 'Ventas' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'clients', label: 'Clientes' },
  { key: 'purchases', label: 'Compras USA' },
  { key: 'viaje', label: 'Viaje EEUU' },
  { key: 'logistics', label: 'Seguimientos' },
  { key: 'finance', label: 'Gastos y Finanzas' },
  { key: 'vendedores', label: 'Vendedores' },
  { key: 'calculadora', label: 'Calculadora de Precios' },
  { key: 'cotizador_ver', label: 'Cotizador' },
  { key: 'params', label: 'Parametrización' },
  { key: 'documentacion', label: 'Documentación' },
  { key: 'admin', label: 'Administración' },
  { key: 'calendario_ver', label: 'Calendario de Contenido' },
  { key: 'tracker', label: 'Competitor Tracker' },
];

/** Construye el objeto "modulos" de un plan (Planes.modulos) a partir de los toggles marcados. */
function construirModulosPlan(seleccionados) {
  const m = { dashboard: true };
  MODULOS_PLAN_TOGGLES.forEach(({ key }) => { m[key] = seleccionados.has(key); });
  return m;
}

/** Inverso: qué toggles deberían venir marcados según un objeto "modulos" ya guardado. */
function seleccionDesdeModulos(modulos) {
  const sel = new Set();
  MODULOS_PLAN_TOGGLES.forEach(({ key }) => { if (modulos?.[key]) sel.add(key); });
  return sel;
}

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
  let planes = [];
  let loadError = null;
  try {
    const [dataEmpresas, dataPlanes] = await Promise.all([
      callAdminEmpresas({ accion: 'listar_empresas' }),
      callAdminEmpresas({ accion: 'listar_planes' }),
    ]);
    empresas = dataEmpresas.empresas || [];
    planes = dataPlanes.planes || [];
  } catch (err) {
    loadError = err.message;
  }

  renderLayout(buildHTML(empresas, planes, loadError));
  bindEvents(renderLayout, planes);
};

function buildHTML(empresas, planes, error) {
  return `
    <div class="module-header">
      <div>
        <p class="module-tag">SUPERADMIN · ENCARGOSPRO</p>
        <h2 class="module-title">Empresas</h2>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${_superadminActiveTab === 'empresas' ? `
          <button class="btn-action" id="sa-migrar-imagenes-btn">🗂️ Migrar imágenes antiguas</button>
          <button class="btn-primary" id="sa-new-empresa-btn">+ Crear Empresa</button>
        ` : ''}
      </div>
    </div>

    <!-- Tabs -->
    <div class="purchase-view-switcher" style="margin-bottom:1.5rem;">
      <button class="pv-tab ${_superadminActiveTab === 'empresas' ? 'active' : ''}" id="sa-tab-empresas">
        🏢 Empresas
      </button>
      <button class="pv-tab ${_superadminActiveTab === 'planes' ? 'active' : ''}" id="sa-tab-planes">
        📋 Planes
      </button>
    </div>

    ${error ? `<div class="admin-error-banner">⚠ ${error}</div>` : ''}

    <!-- Panel Empresas -->
    <div id="sa-panel-empresas" style="display:${_superadminActiveTab === 'empresas' ? 'block' : 'none'}">
      <div class="glass-card" style="padding:0; overflow:hidden;">
        <div style="padding:1.2rem 1.5rem; border-bottom:1px solid var(--border-base);">
          <h3 style="font-size:0.95rem; font-weight:700; margin-bottom:2px;">Empresas registradas</h3>
          <p style="font-size:0.72rem; color:var(--text-faint);">${empresas.length} empresas</p>
        </div>
        <div class="table-wrapper" style="border-radius:0; border:none; box-shadow:none;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Slug</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>Vence</th>
                <th>Usuarios</th>
                <th class="text-right">Acciones</th>
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
                  <td class="text-right"><button class="btn-action sa-btn-estado" data-id="${e.id}" data-nombre="${e.nombre}" data-estado="${e.estado_suscripcion}" data-plan="${e.plan}">Cambiar estado / plan</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Panel Planes -->
    <div id="sa-panel-planes" style="display:${_superadminActiveTab === 'planes' ? 'block' : 'none'}">
      <div class="glass-card" style="padding:0; overflow:hidden;">
        <div style="padding:1.2rem 1.5rem; border-bottom:1px solid var(--border-base);">
          <h3 style="font-size:0.95rem; font-weight:700; margin-bottom:2px;">Catálogo de planes</h3>
          <p style="font-size:0.72rem; color:var(--text-faint);">Módulos y límites de cada plan — Prueba, Básico, Pro y Empresarial</p>
        </div>
        <div class="table-wrapper" style="border-radius:0; border:none; box-shadow:none;">
          <table class="data-table" style="width:100%;">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Usuarios máx.</th>
                <th>Días de prueba</th>
                <th>Módulos incluidos</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${planes.map(p => `
                <tr>
                  <td><strong>${p.nombre}</strong> <code style="opacity:0.6;">${p.id}</code></td>
                  <td>${p.max_usuarios ?? 'Sin límite'}</td>
                  <td>${p.id === 'trial' ? (p.dias_prueba ?? '—') : '—'}</td>
                  <td>${Object.entries(p.modulos || {}).filter(([k, v]) => v && k !== 'dashboard').length} de ${MODULOS_PLAN_TOGGLES.length}</td>
                  <td class="text-right"><button class="btn-action sa-btn-editar-plan" data-id="${p.id}">Editar</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function bindEvents(renderLayout, planes) {
  document.getElementById('sa-tab-empresas')?.addEventListener('click', () => {
    _superadminActiveTab = 'empresas';
    renderSuperadmin(renderLayout);
  });
  document.getElementById('sa-tab-planes')?.addEventListener('click', () => {
    _superadminActiveTab = 'planes';
    renderSuperadmin(renderLayout);
  });
  document.getElementById('sa-new-empresa-btn')?.addEventListener('click', () => modalCrearEmpresa(renderLayout, planes));
  document.getElementById('sa-migrar-imagenes-btn')?.addEventListener('click', () => modalMigrarImagenes());
  document.querySelectorAll('.sa-btn-editar-plan').forEach(btn => {
    const plan = planes.find(p => p.id === btn.dataset.id);
    btn.addEventListener('click', () => modalEditarPlan(plan, renderLayout));
  });
  document.querySelectorAll('.sa-btn-estado').forEach(btn => {
    btn.addEventListener('click', () => modalCambiarEstado(btn.dataset.id, btn.dataset.nombre, btn.dataset.estado, btn.dataset.plan, planes, renderLayout));
  });
}

function modalEditarPlan(plan, renderLayout) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  const sel = seleccionDesdeModulos(plan.modulos);
  const esTrial = plan.id === 'trial';

  content.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">📋 Plan ${plan.nombre}</h2>
        <button onclick="window.closeModal()" class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-faint);font-size:0.85rem;margin-bottom:1.2rem;">
          ${esTrial
            ? 'Así se configura la cuenta de cualquiera que se registre solo desde el botón "Empieza gratis" de la landing — sin que tú intervengas.'
            : 'Los módulos que desmarques aparecen en el sidebar de cualquier empresa con este plan, pero bloqueados con candado (con opción de actualizar de plan) en vez de ocultos.'}
        </p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem;">
          <div class="form-group" style="max-width:200px;">
            <label class="form-label">Usuarios máximos</label>
            <input type="number" id="sp-max-usuarios" class="form-input" min="1" placeholder="Sin límite" value="${plan.max_usuarios ?? ''}">
          </div>
          ${esTrial ? `
            <div class="form-group" style="max-width:200px;">
              <label class="form-label">Días de prueba</label>
              <input type="number" id="sp-dias-prueba" class="form-input" min="1" value="${plan.dias_prueba ?? 7}">
            </div>
          ` : ''}
        </div>
        <label class="form-label" style="display:block;margin-bottom:0.6rem;">Módulos incluidos</label>
        <div class="admin-perms-grid">
          ${MODULOS_PLAN_TOGGLES.map(({ key, label }) => `
            <div class="admin-perm-row">
              <div class="admin-perm-label">
                <span class="admin-perm-dot ${sel.has(key) ? 'active' : ''}"></span>
                <span>${label}</span>
              </div>
              <div class="admin-perm-controls">
                <label class="admin-toggle-wrap">
                  <input type="checkbox" class="sp-modulo" value="${key}" ${sel.has(key) ? 'checked' : ''} />
                  <span class="admin-toggle-slider"></span>
                  <span class="admin-toggle-label">Incluido</span>
                </label>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button type="button" class="btn-primary" id="sp-btn-save">Guardar</button>
      </div>
    </div>`;
  container.style.display = 'flex';

  document.getElementById('sp-btn-save').addEventListener('click', async () => {
    const btn = document.getElementById('sp-btn-save');
    const maxUsuariosRaw = document.getElementById('sp-max-usuarios').value;
    const max_usuarios = maxUsuariosRaw === '' ? null : parseInt(maxUsuariosRaw, 10);
    const dias_prueba = esTrial ? parseInt(document.getElementById('sp-dias-prueba').value, 10) : undefined;
    if (esTrial && (!dias_prueba || dias_prueba < 1)) return showToast('Ingresa un número de días de prueba válido.', 'error');

    const seleccionados = new Set([...document.querySelectorAll('.sp-modulo:checked')].map(el => el.value));
    const modulos = construirModulosPlan(seleccionados);

    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      await callAdminEmpresas({ accion: 'guardar_plan', plan_id: plan.id, max_usuarios, dias_prueba, modulos });
      window.closeModal();
      showToast(`✅ Plan ${plan.nombre} actualizado`, 'success');
      renderSuperadmin(renderLayout);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar';
    }
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

function modalCrearEmpresa(renderLayout, planes) {
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
            <select id="ce-plan" class="form-input">
              ${planes.map(p => `<option value="${p.id}" ${p.id === 'basico' ? 'selected' : ''}>${p.nombre}</option>`).join('')}
            </select>
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

function modalCambiarEstado(empresaId, nombre, estadoActual, planActual, planes, renderLayout) {
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
            <label class="form-label">Plan</label>
            <select id="ce-plan-estado" class="form-input">
              ${planes.map(p => `<option value="${p.id}" ${p.id === planActual ? 'selected' : ''}>${p.nombre}</option>`).join('')}
            </select>
          </div>
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
      const plan = document.getElementById('ce-plan-estado').value;
      await callAdminEmpresas({
        accion: 'actualizar_suscripcion',
        empresa_id: empresaId,
        estado_suscripcion: document.getElementById('ce-estado').value,
        ...(fecha ? { fecha_vencimiento: fecha } : {}),
        ...(plan !== planActual ? { plan } : {}),
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
