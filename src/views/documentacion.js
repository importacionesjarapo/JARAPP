import { db } from '../db.js';

export const renderDocumentacion = async (renderLayout, navigateTo) => {
  const { auth } = await import('../auth.js');
  const userAuth = auth.getProfile();
  console.log('[Documentacion] render iniciado, rol:', userAuth?.role);

  const puedeVerTecnico = userAuth?.role === 'admin' || userAuth?.role === 'gerente'

  // #12: contrato de suscripción aceptado por esta empresa al registrarse
  // (ver ContratosAceptados, migración 027) — solo admin/gerente, mismo
  // criterio que el Manual Técnico.
  let contrato = null;
  if (puedeVerTecnico) {
    const contratos = await db.fetchData('ContratosAceptados');
    if (Array.isArray(contratos) && contratos.length) {
      contrato = contratos.slice().sort((a, b) => new Date(b.fecha_aceptacion) - new Date(a.fecha_aceptacion))[0];
    }
  }

  renderLayout(`
    <div style="max-width:860px;margin:0 auto;padding:0 8px;">

      <div style="margin-bottom:24px;">
        <p style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faint);">SISTEMA</p>
        <h1 style="font-size:24px;font-weight:600;margin-bottom:4px;">📚 Documentación</h1>
        <p style="font-size:14px;color:var(--text-secondary);">Manuales oficiales de EncargosPro · ${auth.getEmpresaNombre()}</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px;">

        <!-- Manual Funcional — todos los roles excepto viewer -->
        <div style="background:var(--surface-0);border:1px solid var(--border);border-radius:16px;padding:24px;border-top:4px solid var(--primary);">
          <div style="font-size:42px;margin-bottom:10px;">📘</div>
          <div style="font-size:17px;font-weight:600;margin-bottom:6px;">Manual de Usuario</div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
            Guía completa de uso de JARAPP para el equipo. Incluye módulos, flujos operativos,
            glosario, JaraBot, Cotizador y preguntas frecuentes.
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
            <span style="font-size:11px;background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:99px;font-weight:500;">Para todo el equipo</span>
            <span style="font-size:11px;background:var(--surface-1);color:var(--text-faint);padding:2px 8px;border-radius:99px;">11 secciones · 554 KB</span>
          </div>
          <a href="/docs/JARAPP_Manual_Funcional.pdf"
             target="_blank"
             download="JARAPP_Manual_Funcional.pdf"
             style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:white;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:500;text-decoration:none;transition:opacity 0.15s;cursor:pointer;"
             onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            ⬇️ Descargar Manual de Usuario
          </a>
        </div>

        <!-- Manual Técnico — solo admin y gerente -->
        ${puedeVerTecnico ? `
        <div style="background:var(--surface-0);border:1px solid var(--border);border-radius:16px;padding:24px;border-top:4px solid var(--secondary);">
          <div style="font-size:42px;margin-bottom:10px;">⚙️</div>
          <div style="font-size:17px;font-weight:600;margin-bottom:6px;">Manual Técnico</div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
            Documentación de arquitectura, base de datos, servicios, RBAC, PWA,
            funciones SQL y consideraciones de desarrollo.
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
            <span style="font-size:11px;background:var(--secondary);color:white;padding:2px 8px;border-radius:99px;font-weight:500;">Solo Admin y Gerente</span>
            <span style="font-size:11px;background:var(--surface-1);color:var(--text-faint);padding:2px 8px;border-radius:99px;">10 secciones · 555 KB</span>
          </div>
          <a href="/docs/JARAPP_Manual_Tecnico.pdf"
             target="_blank"
             download="JARAPP_Manual_Tecnico.pdf"
             style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--secondary);color:white;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:500;text-decoration:none;transition:opacity 0.15s;cursor:pointer;"
             onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            ⬇️ Descargar Manual Técnico
          </a>
        </div>
        ` : `
        <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:16px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0.5;">
          <div style="font-size:32px;margin-bottom:8px;">🔒</div>
          <div style="font-size:14px;font-weight:500;margin-bottom:4px;">Manual Técnico</div>
          <div style="font-size:12px;color:var(--text-secondary);">Disponible solo para Admin y Gerente</div>
        </div>
        `}

      </div>

      <!-- Tabla de contenidos -->
      <div style="background:var(--surface-0);border:1px solid var(--border);border-radius:16px;padding:24px;">
        <h2 style="font-size:15px;font-weight:600;margin-bottom:16px;">📋 Contenido de los manuales</h2>
        <div style="display:grid;grid-template-columns:1fr ${puedeVerTecnico ? '1fr' : ''};gap:24px;">

          <div>
            <div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:10px;">📘 Manual de Usuario</div>
            ${['1. ¿Qué es JARAPP?','2. Acceso e instalación en iPhone','3. Roles de usuario',
               '4. Navegación y módulos','5. Dashboard y alertas','6. Cotizador de precios',
               '7. Módulo Viaje EEUU','8. JaraBot — Asistente IA','9. Alertas automáticas',
               '10. Glosario del negocio','11. Flujos operativos y FAQ'
              ].map(s => `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;border-bottom:0.5px solid var(--border);">${s}</div>`).join('')}
          </div>

          ${puedeVerTecnico ? `
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--secondary);margin-bottom:10px;">⚙️ Manual Técnico</div>
            ${['1. Stack tecnológico','2. Variables de entorno','3. Arquitectura del proyecto',
               '4. Schema de base de datos','5. Servicios (src/services/)','6. Sistema RBAC',
               '7. PWA y Service Worker','8. Funciones SQL','9. Deploy y CI/CD',
               '10. Consideraciones técnicas'
              ].map(s => `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;border-bottom:0.5px solid var(--border);">${s}</div>`).join('')}
          </div>
          ` : ''}

        </div>
      </div>

      ${puedeVerTecnico ? `
      <div style="background:var(--surface-0);border:1px solid var(--border);border-radius:16px;padding:24px;margin-top:16px;">
        <h2 style="font-size:15px;font-weight:600;margin-bottom:16px;">📄 Contrato de Suscripción</h2>
        ${contrato ? `
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;">
            <div>Aceptado por <strong>${contrato.nombre_completo || '—'}</strong> (${contrato.email})</div>
            <div>Fecha de aceptación: ${new Date(contrato.fecha_aceptacion).toLocaleString('es-CO')}</div>
            <div>Versión: ${contrato.version_contrato}</div>
            <div>Copia enviada por correo: ${contrato.email_enviado ? '✅ Sí' : '⚠️ No — ' + (contrato.email_error || 'sin detalle')}</div>
          </div>
          <button onclick="window.verContratoCompleto()" style="margin-top:14px;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);padding:8px 16px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;">
            Ver texto completo
          </button>
        ` : `
          <div style="font-size:13px;color:var(--text-faint);">No hay un contrato de suscripción registrado para esta empresa todavía.</div>
        `}
      </div>
      ` : ''}

      <div style="margin-top:12px;text-align:center;font-size:11px;color:var(--text-faint);">
        EncargosPro · ${auth.getEmpresaNombre()} · Documentación actualizada junio 2026
      </div>
    </div>
  `);

  if (contrato) {
    window.verContratoCompleto = () => {
      const container = document.getElementById('modal-container');
      const content = document.getElementById('modal-content');
      content.innerHTML = `
        <div style="max-width:640px;">
          <h3 style="font-size:16px;font-weight:600;margin-bottom:12px;">📄 Contrato de Suscripción — versión ${contrato.version_contrato}</h3>
          <div style="max-height:60vh;overflow-y:auto;white-space:pre-wrap;font-size:12.5px;line-height:1.6;color:var(--text-secondary);background:var(--surface-1);border-radius:12px;padding:16px;">${contrato.texto_contrato.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
          <button onclick="window.closeModal()" style="margin-top:16px;width:100%;background:var(--primary);color:#fff;border:none;padding:10px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;">Cerrar</button>
        </div>
      `;
      container.style.display = 'flex';
    };
  }
};
