import { JaraBotService } from '../services/jarabot.js';

let _initialized = false;

export function initJaraBot(authService) {
  // Solo admin y gerente
  const role = authService.getUserRole ? authService.getUserRole() : null;
  if (!['admin', 'gerente'].includes(role)) return;

  // Evitar doble inicialización entre navegaciones
  if (_initialized) return;
  _initialized = true;

  const logoUrl = window.JARAPP_LOGO || sessionStorage.getItem('JARAPP_LOGO') || null;
  const avatarInner = logoUrl
    ? `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;padding:2px;" alt="JaraBot">`
    : 'J';

  // ── HTML del widget ────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.id = 'jarabot-root';
  container.innerHTML = `
    <button id="jarabot-trigger" aria-label="Abrir JaraBot">
      <span>🤖</span>
    </button>

    <div id="jarabot-panel" class="jarabot-panel jarabot-cerrado" role="dialog" aria-label="JaraBot asistente">
      <div class="jarabot-header">
        <div class="jarabot-header-info">
          <div class="jarabot-avatar">${avatarInner}</div>
          <div>
            <div class="jarabot-nombre">JaraBot</div>
            <div class="jarabot-estado">● En línea</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="jarabot-badge-ia">IA · Groq</span>
          <button id="jarabot-limpiar" title="Nueva conversación" class="jarabot-icon-btn">↺</button>
          <button id="jarabot-cerrar" aria-label="Cerrar JaraBot" class="jarabot-icon-btn">✕</button>
        </div>
      </div>

      <div id="jarabot-mensajes" class="jarabot-mensajes">
        <div class="jarabot-msg-bot">
          <div class="jarabot-msg-avatar">${avatarInner}</div>
          <div class="jarabot-msg-burbuja">
            ¡Hola! Soy JaraBot 👋 Conozco el negocio al 100%. Pregúntame lo que necesites sobre ventas, clientes, inventario o el viaje activo.
          </div>
        </div>
      </div>

      <div class="jarabot-chips">
        <button class="jarabot-chip" data-pregunta="¿Cuánto vendimos esta semana?">💰 Ventas semana</button>
        <button class="jarabot-chip" data-pregunta="¿Cuántos anticipos hay pendientes de cobro esta semana?">⏳ Anticipos</button>
        <button class="jarabot-chip" data-pregunta="¿Qué productos están sin stock?">📦 Sin stock</button>
        <button class="jarabot-chip" data-pregunta="¿Cómo va el viaje activo?">✈️ Viaje</button>
      </div>

      <div class="jarabot-input-area">
        <textarea id="jarabot-input" placeholder="Pregúntame sobre el negocio..." rows="1"></textarea>
        <button id="jarabot-enviar" aria-label="Enviar">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // ── Estilos ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'jarabot-styles';
  style.textContent = `
    #jarabot-trigger {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 52px; height: 52px; border-radius: 50%;
      background: var(--primary); border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(230,57,70,0.4);
      font-size: 22px; display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #jarabot-trigger:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(230,57,70,0.55); }

    .jarabot-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9999;
      width: 380px; height: 520px;
      background: var(--surface-0); border: 1px solid var(--border-base);
      border-radius: var(--radius-lg); box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      display: flex; flex-direction: column; overflow: hidden;
      transition: opacity 0.2s, transform 0.2s;
    }
    .jarabot-cerrado { opacity: 0; pointer-events: none; transform: translateY(12px) scale(0.97); }
    .jarabot-abierto  { opacity: 1; pointer-events: all;  transform: translateY(0)   scale(1);    }

    .jarabot-header {
      padding: 12px 14px; display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid var(--border-base); background: var(--surface-1); flex-shrink: 0;
    }
    .jarabot-header-info { display: flex; align-items: center; gap: 10px; }
    .jarabot-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 16px;
    }
    .jarabot-nombre { font-size: 14px; font-weight: 700; color: var(--text-main); }
    .jarabot-estado { font-size: 11px; color: var(--success); }
    .jarabot-badge-ia {
      font-size: 10px; font-weight: 700; padding: 2px 8px;
      background: rgba(99,102,241,0.15); color: #818cf8; border-radius: 99px;
    }
    .jarabot-icon-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text-muted); font-size: 14px; padding: 4px 6px;
      border-radius: 6px; transition: background 0.15s; line-height: 1;
    }
    .jarabot-icon-btn:hover { background: var(--surface-2); color: var(--text-main); }

    .jarabot-mensajes {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 12px;
      scroll-behavior: smooth;
    }
    .jarabot-msg-bot, .jarabot-msg-user {
      display: flex; gap: 8px; align-items: flex-start;
    }
    .jarabot-msg-user { flex-direction: row-reverse; }
    .jarabot-msg-avatar {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      background: var(--primary); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700;
    }
    .jarabot-msg-burbuja {
      max-width: 80%; padding: 10px 12px; border-radius: 12px;
      font-size: 13px; line-height: 1.55; color: var(--text-main);
      background: var(--surface-1);
    }
    .jarabot-msg-user .jarabot-msg-burbuja {
      background: var(--primary); color: #fff; border-radius: 12px 12px 4px 12px;
    }
    .jarabot-msg-bot .jarabot-msg-burbuja { border-radius: 12px 12px 12px 4px; }

    .jarabot-typing { display: flex; gap: 4px; align-items: center; padding: 4px 2px; }
    .jarabot-typing span {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--text-faint); animation: jara-typing 1.2s infinite;
    }
    .jarabot-typing span:nth-child(2) { animation-delay: 0.2s; }
    .jarabot-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes jara-typing {
      0%,60%,100% { transform: translateY(0); }
      30%          { transform: translateY(-6px); }
    }

    .jarabot-chips {
      padding: 8px 14px; display: flex; gap: 6px; flex-wrap: wrap;
      border-top: 1px solid var(--border-base); flex-shrink: 0;
    }
    .jarabot-chip {
      font-size: 11px; padding: 4px 10px; border-radius: 99px; cursor: pointer;
      background: var(--surface-1); border: 1px solid var(--border-base);
      color: var(--text-muted); font-family: var(--font);
      transition: all 0.15s; white-space: nowrap;
    }
    .jarabot-chip:hover {
      background: var(--primary-light); color: var(--primary);
      border-color: var(--primary);
    }

    .jarabot-input-area {
      padding: 10px 14px; display: flex; gap: 8px; align-items: flex-end;
      border-top: 1px solid var(--border-base); flex-shrink: 0;
    }
    #jarabot-input {
      flex: 1; resize: none; border: 1px solid var(--border-base);
      border-radius: 10px; padding: 8px 12px; font-size: 13px;
      background: var(--surface-1); color: var(--text-main);
      font-family: var(--font); max-height: 100px; outline: none;
      transition: border-color 0.15s; line-height: 1.4;
    }
    #jarabot-input:focus { border-color: var(--primary); }
    #jarabot-enviar {
      width: 36px; height: 36px; border-radius: 50%; border: none; flex-shrink: 0;
      background: var(--primary); color: #fff; cursor: pointer; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    #jarabot-enviar:hover    { background: var(--primary-dark); }
    #jarabot-enviar:disabled { background: var(--surface-3); cursor: not-allowed; }

    @media (max-width: 768px) {
      .jarabot-panel { width: calc(100vw - 24px); right: 12px; bottom: 80px; height: 480px; }
      #jarabot-trigger { bottom: 80px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── Lógica ─────────────────────────────────────────────────────────────────
  const panel    = document.getElementById('jarabot-panel');
  const trigger  = document.getElementById('jarabot-trigger');
  const mensajes = document.getElementById('jarabot-mensajes');
  const input    = document.getElementById('jarabot-input');
  const btnEnviar= document.getElementById('jarabot-enviar');

  function togglePanel() {
    const abierto = panel.classList.contains('jarabot-abierto');
    panel.classList.toggle('jarabot-cerrado', abierto);
    panel.classList.toggle('jarabot-abierto', !abierto);
    if (!abierto) input.focus();
  }

  trigger.addEventListener('click', togglePanel);
  document.getElementById('jarabot-cerrar').addEventListener('click', togglePanel);

  document.getElementById('jarabot-limpiar').addEventListener('click', () => {
    JaraBotService.limpiarHistorial();
    mensajes.innerHTML = `<div class="jarabot-msg-bot">
      <div class="jarabot-msg-avatar">J</div>
      <div class="jarabot-msg-burbuja">Conversación nueva. ¿En qué te ayudo?</div>
    </div>`;
  });

  document.querySelectorAll('.jarabot-chip').forEach(chip => {
    chip.addEventListener('click', () => enviarMensaje(chip.dataset.pregunta));
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(); }
  });
  btnEnviar.addEventListener('click', () => enviarMensaje());

  async function enviarMensaje(textoDirecto) {
    const texto = textoDirecto || input.value.trim();
    if (!texto) return;

    input.value = '';
    btnEnviar.disabled = true;

    // Burbuja del usuario
    mensajes.insertAdjacentHTML('beforeend', `
      <div class="jarabot-msg-user">
        <div class="jarabot-msg-burbuja">${texto.replace(/</g,'&lt;')}</div>
      </div>`);

    // Indicador de typing
    const typingId = `jara-typing-${Date.now()}`;
    mensajes.insertAdjacentHTML('beforeend', `
      <div id="${typingId}" class="jarabot-msg-bot">
        <div class="jarabot-msg-avatar">${avatarInner}</div>
        <div class="jarabot-msg-burbuja">
          <div class="jarabot-typing"><span></span><span></span><span></span></div>
        </div>
      </div>`);
    mensajes.scrollTop = mensajes.scrollHeight;

    try {
      const respuesta = await JaraBotService.preguntar(texto);
      document.getElementById(typingId)?.remove();
      mensajes.insertAdjacentHTML('beforeend', `
        <div class="jarabot-msg-bot">
          <div class="jarabot-msg-avatar">${avatarInner}</div>
          <div class="jarabot-msg-burbuja">${respuesta.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
        </div>`);
    } catch (e) {
      document.getElementById(typingId)?.remove();
      mensajes.insertAdjacentHTML('beforeend', `
        <div class="jarabot-msg-bot">
          <div class="jarabot-msg-avatar">${avatarInner}</div>
          <div class="jarabot-msg-burbuja" style="color:var(--danger)">
            Error conectando con JaraBot. Verifica que la API key de Groq esté configurada en el .env
          </div>
        </div>`);
    }

    btnEnviar.disabled = false;
    mensajes.scrollTop = mensajes.scrollHeight;
  }
}
