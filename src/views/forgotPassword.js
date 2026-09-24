/**
 * forgotPassword.js — Flujo de "¿Olvidaste tu contraseña?" por código de
 * 6 dígitos (en vez de enlace). Se decidió así porque el enlace del correo
 * resultó poco confiable en la práctica: escáneres de seguridad de correo
 * corporativo consumen el token de un solo uso antes de que el usuario le
 * dé clic, y en dispositivos con la PWA instalada, el sistema a veces
 * reactiva una pestaña/instancia vieja en vez de cargar la página desde
 * cero — en ambos casos el código nunca llega a ejecutarse. Un código que
 * el usuario escribe a mano no depende de ninguna de esas dos cosas.
 */
import { auth } from '../auth.js';

export const renderForgotPassword = (onDone, onBack) => {
  const appEl = document.querySelector('#app');
  let step = 'email'; // 'email' -> 'code'
  let emailValue = '';

  function render() {
    appEl.innerHTML = `
      <div class="login-screen">
        <div class="login-bg-orbs">
          <div class="orb orb-1"></div>
          <div class="orb orb-2"></div>
          <div class="orb orb-3"></div>
        </div>

        <div class="login-card">
          <div class="login-card-accent"></div>

          <div class="login-logo-zone">
            <div class="login-logo-ring">
              <img src="/logo-encargospro.png" style="width:100%;height:100%;object-fit:contain;" alt="EncargosPro">
            </div>
            <div class="login-brand">
              <h1 class="login-title">EncargosPro</h1>
              <p class="login-subtitle">Gestión para personal shoppers</p>
            </div>
          </div>

          ${step === 'email' ? renderEmailStep() : renderCodeStep()}

          <div class="login-card-footer">
            <span>EncargosPro · ${new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    `;
    wireEvents();
    setTimeout(() => document.querySelector('.login-card')?.classList.add('login-card-visible'), 80);
  }

  function renderEmailStep() {
    return `
      <form id="fp-email-form" class="login-form" autocomplete="off" novalidate>
        <h2 class="login-form-heading">¿Olvidaste tu contraseña?</h2>
        <p class="login-form-desc">Escribe tu correo y te enviamos un código de verificación.</p>

        <div id="fp-alert" class="login-alert" style="display:none;"></div>

        <div class="login-field">
          <label for="fp-email" class="login-label">Correo electrónico</label>
          <div class="login-input-wrap">
            <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <input type="text" inputmode="email" id="fp-email" class="login-input" placeholder="tu@email.com" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${emailValue}" required />
          </div>
        </div>

        <button type="submit" id="fp-email-btn" class="login-submit-btn">
          <span id="fp-email-btn-text">Enviar código</span>
          <div id="fp-email-spinner" class="login-btn-spinner" style="display:none;"><div class="login-spinner-ring"></div></div>
        </button>

        <p class="login-footer-note">
          <button type="button" id="fp-back-btn" class="link" style="background:none;border:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;">← Volver a iniciar sesión</button>
        </p>
      </form>
    `;
  }

  function renderCodeStep() {
    return `
      <form id="fp-code-form" class="login-form" autocomplete="off" novalidate>
        <h2 class="login-form-heading">Ingresa el código</h2>
        <p class="login-form-desc">Revisa <strong>${emailValue}</strong> y escribe el código que te enviamos junto con tu nueva contraseña.</p>

        <div id="fp-alert" class="login-alert" style="display:none;"></div>

        <div class="login-field">
          <label for="fp-code" class="login-label">Código de verificación</label>
          <div class="login-input-wrap">
            <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="10" id="fp-code" class="login-input" placeholder="Código recibido por correo" autocomplete="one-time-code" style="letter-spacing:.2em;font-weight:700;" required />
          </div>
        </div>

        <div class="login-field">
          <label for="fp-new-pass" class="login-label">Nueva contraseña</label>
          <div class="login-input-wrap">
            <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="password" id="fp-new-pass" class="login-input" placeholder="Mínimo 6 caracteres" autocomplete="new-password" required />
          </div>
        </div>

        <div class="login-field">
          <label for="fp-confirm-pass" class="login-label">Confirmar contraseña</label>
          <div class="login-input-wrap">
            <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <input type="password" id="fp-confirm-pass" class="login-input" placeholder="Repite la contraseña" autocomplete="new-password" required />
          </div>
        </div>

        <button type="submit" id="fp-code-btn" class="login-submit-btn">
          <span id="fp-code-btn-text">Cambiar contraseña</span>
          <div id="fp-code-spinner" class="login-btn-spinner" style="display:none;"><div class="login-spinner-ring"></div></div>
        </button>

        <p class="login-footer-note">
          <button type="button" id="fp-resend-btn" class="link" style="background:none;border:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;">¿No llegó? Reenviar código</button>
          &nbsp;·&nbsp;
          <button type="button" id="fp-back-btn" class="link" style="background:none;border:none;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;">← Volver</button>
        </p>
      </form>
    `;
  }

  function showAlert(message, type = 'error') {
    const el = document.getElementById('fp-alert');
    if (!el) return;
    el.className = `login-alert login-alert-${type}`;
    el.textContent = message;
    el.style.display = 'block';
  }

  function wireEvents() {
    document.getElementById('fp-back-btn')?.addEventListener('click', () => {
      if (step === 'code') { step = 'email'; render(); }
      else onBack();
    });

    if (step === 'email') {
      document.getElementById('fp-email-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('fp-email').value.trim();
        if (!email) return;
        const btn = document.getElementById('fp-email-btn');
        const btnText = document.getElementById('fp-email-btn-text');
        const spinner = document.getElementById('fp-email-spinner');
        btn.disabled = true; btnText.style.display = 'none'; spinner.style.display = 'flex';
        try {
          await auth.sendPasswordReset(email);
          emailValue = email;
          step = 'code';
          render();
        } catch (err) {
          btn.disabled = false; btnText.style.display = 'block'; spinner.style.display = 'none';
          showAlert(err.message, 'error');
        }
      });
    } else {
      document.getElementById('fp-resend-btn')?.addEventListener('click', async () => {
        const resendBtn = document.getElementById('fp-resend-btn');
        resendBtn.disabled = true;
        try {
          await auth.sendPasswordReset(emailValue);
          showAlert('Te enviamos un código nuevo.', 'success');
        } catch (err) {
          showAlert(err.message, 'error');
        } finally {
          setTimeout(() => { resendBtn.disabled = false; }, 3000);
        }
      });

      document.getElementById('fp-code-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('fp-code').value.trim();
        const nueva = document.getElementById('fp-new-pass').value;
        const confirmar = document.getElementById('fp-confirm-pass').value;

        if (!/^\d{4,10}$/.test(code)) { showAlert('El código debe ser numérico.', 'error'); return; }
        if (!nueva || nueva.length < 6) { showAlert('La contraseña debe tener al menos 6 caracteres.', 'error'); return; }
        if (nueva !== confirmar) { showAlert('Las contraseñas no coinciden.', 'error'); return; }

        const btn = document.getElementById('fp-code-btn');
        const btnText = document.getElementById('fp-code-btn-text');
        const spinner = document.getElementById('fp-code-spinner');
        btn.disabled = true; btnText.style.display = 'none'; spinner.style.display = 'flex';
        showAlert('', 'error'); document.getElementById('fp-alert').style.display = 'none';

        try {
          await auth.verifyPasswordResetCode(emailValue, code);
          await auth.updatePasswordFromRecovery(nueva);
          await auth.logout();
          btnText.textContent = '✓ Contraseña actualizada';
          btnText.style.display = 'block';
          spinner.style.display = 'none';
          document.querySelector('.login-card').classList.add('login-card-exit');
          setTimeout(() => onDone(), 600);
        } catch (err) {
          btn.disabled = false; btnText.style.display = 'block'; spinner.style.display = 'none';
          showAlert(err.message, 'error');
        }
      });
    }
  }

  render();
};
