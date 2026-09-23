/**
 * resetPassword.js — Pantalla de "Crear nueva contraseña"
 * Se muestra en vez del login cuando la URL trae el token de recuperación
 * que Supabase agrega al enlace del correo "Reset Password" (ver
 * auth.isPasswordRecoveryUrl() / auth.updatePasswordFromRecovery()).
 */
import { auth } from '../auth.js';

export const renderResetPassword = (onDone) => {
  const appEl = document.querySelector('#app');

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

        <form id="reset-pass-form" class="login-form" autocomplete="off" novalidate>
          <h2 class="login-form-heading">Crear nueva contraseña</h2>
          <p class="login-form-desc">Escribe la nueva contraseña de tu cuenta.</p>

          <div id="reset-pass-alert" class="login-alert" style="display:none;"></div>

          <div class="login-field">
            <label for="reset-pass-new" class="login-label">Nueva contraseña</label>
            <div class="login-input-wrap">
              <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type="password" id="reset-pass-new" class="login-input" placeholder="Mínimo 6 caracteres" autocomplete="new-password" required />
            </div>
          </div>

          <div class="login-field">
            <label for="reset-pass-confirm" class="login-label">Confirmar contraseña</label>
            <div class="login-input-wrap">
              <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type="password" id="reset-pass-confirm" class="login-input" placeholder="Repite la contraseña" autocomplete="new-password" required />
            </div>
          </div>

          <button type="submit" id="reset-pass-btn" class="login-submit-btn">
            <span id="reset-pass-btn-text">Guardar contraseña</span>
            <div id="reset-pass-spinner" class="login-btn-spinner" style="display:none;">
              <div class="login-spinner-ring"></div>
            </div>
          </button>
        </form>

        <div class="login-card-footer">
          <span>EncargosPro · ${new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('reset-pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nueva = document.getElementById('reset-pass-new').value;
    const confirmar = document.getElementById('reset-pass-confirm').value;
    const alertEl = document.getElementById('reset-pass-alert');
    const btn = document.getElementById('reset-pass-btn');
    const btnText = document.getElementById('reset-pass-btn-text');
    const spinner = document.getElementById('reset-pass-spinner');

    if (!nueva || nueva.length < 6) {
      showAlert('La contraseña debe tener al menos 6 caracteres.', 'error');
      return;
    }
    if (nueva !== confirmar) {
      showAlert('Las contraseñas no coinciden.', 'error');
      return;
    }

    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'flex';
    alertEl.style.display = 'none';

    try {
      await auth.updatePasswordFromRecovery(nueva);
      // No dejar la sesión de recuperación activa — se cierra y se manda
      // a iniciar sesión normal con la contraseña nueva, para no depender
      // de particularidades de esa sesión especial en el resto de la app.
      await auth.logout();
      btnText.textContent = '✓ Contraseña actualizada';
      btnText.style.display = 'block';
      spinner.style.display = 'none';
      document.querySelector('.login-card').classList.add('login-card-exit');
      setTimeout(() => onDone(), 600);
    } catch (err) {
      btn.disabled = false;
      btnText.style.display = 'block';
      spinner.style.display = 'none';
      showAlert(err.message, 'error');
    }
  });

  function showAlert(message, type = 'error') {
    const el = document.getElementById('reset-pass-alert');
    if (!el) return;
    el.className = `login-alert login-alert-${type}`;
    el.textContent = message;
    el.style.display = 'block';
  }

  setTimeout(() => {
    document.getElementById('reset-pass-new')?.focus();
    document.querySelector('.login-card')?.classList.add('login-card-visible');
  }, 80);
};
