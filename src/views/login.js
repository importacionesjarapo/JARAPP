/**
 * login.js — Pantalla de Login JARAPP
 * Diseño: Digital Quartz Glassmorphism
 * Registro cerrado: solo el admin crea usuarios desde el Admin Panel
 */

import { auth } from '../auth.js';

const logoUrl = localStorage.getItem('GLOBAL_LOGO_URL') || '/logo.png';

export const renderLogin = (onSuccess) => {
  const appEl = document.querySelector('#app');
  
  appEl.innerHTML = `
    <div class="login-screen">
      <div class="login-bg-orbs">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>

      <div class="login-card">
        <!-- Línea superior de acento -->
        <div class="login-card-accent"></div>

        <!-- Logo y branding -->
        <div class="login-logo-zone">
          <div class="login-logo-ring">
            <img src="${logoUrl}" 
                 onerror="this.outerHTML='<div style=\\'font-size:3rem; font-weight:900; color:var(--brand-magenta)\\'>J</div>'"
                 style="width:100%;height:100%;object-fit:cover;" />
          </div>
          <div class="login-brand">
            <h1 class="login-title">JARAPP</h1>
            <p class="login-subtitle">Importaciones Jarapo · Medellín</p>
          </div>
        </div>

        <!-- Form -->
        <form id="login-form" class="login-form" autocomplete="off" novalidate>
          <h2 class="login-form-heading">Iniciar Sesión</h2>
          <p class="login-form-desc">Ingresa con tus credenciales asignadas.</p>

          <div id="login-alert" class="login-alert" style="display:none;"></div>

          <div class="login-field">
            <label for="login-email" class="login-label">Correo electrónico</label>
            <div class="login-input-wrap">
              <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <input 
                type="text"
                inputmode="email"
                id="login-email" 
                class="login-input" 
                placeholder="tu@email.com"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                required
              />
            </div>
          </div>

          <div class="login-field">
            <label for="login-password" class="login-label">Contraseña</label>
            <div class="login-input-wrap">
              <svg class="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input 
                type="password" 
                id="login-password" 
                class="login-input"
                placeholder="••••••••"
                autocomplete="new-password"
                required
              />
              <button type="button" id="toggle-password" class="login-eye-btn" title="Mostrar/Ocultar">
                <svg id="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <button type="submit" id="login-btn" class="login-submit-btn">
            <span id="login-btn-text">Ingresar</span>
            <div id="login-spinner" class="login-btn-spinner" style="display:none;">
              <div class="login-spinner-ring"></div>
            </div>
          </button>

          <p class="login-footer-note">
            ¿Sin acceso? Contacta al administrador del sistema.
          </p>
        </form>

        <div class="login-card-footer">
          <span>JARAPP v2.0 · ${new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  `;

  // ── Event Listeners ──────────────────────────────────────

  // Toggle contraseña visible
  document.getElementById('toggle-password').addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Formulario de login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const alertEl = document.getElementById('login-alert');
    const btn = document.getElementById('login-btn');
    const btnText = document.getElementById('login-btn-text');
    const spinner = document.getElementById('login-spinner');

    // Validación básica
    if (!email || !password) {
      showLoginAlert('Completa todos los campos.', 'error');
      return;
    }

    // Loading state
    btn.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'flex';
    alertEl.style.display = 'none';

    try {
      await auth.login(email, password);
      
      // Animación de éxito
      btn.classList.add('login-btn-success');
      btnText.textContent = '✓ Acceso concedido';
      btnText.style.display = 'block';
      spinner.style.display = 'none';
      
      // Transición de salida
      document.querySelector('.login-card').classList.add('login-card-exit');
      
      setTimeout(() => {
        onSuccess(auth.getProfile());
      }, 600);

    } catch (err) {
      btn.disabled = false;
      btnText.style.display = 'block';
      spinner.style.display = 'none';
      showLoginAlert(err.message, 'error');
      
      // Shake animation
      document.querySelector('.login-card').classList.add('login-shake');
      setTimeout(() => document.querySelector('.login-card')?.classList.remove('login-shake'), 500);
    }
  });

  // Enter focus manejo
  document.getElementById('login-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('login-password').focus();
    }
  });

  // Limpiar campos para evitar que el browser autocomplete inyecte datos previos
  // (el browser puede inyectar la URL de Supabase guardada como credential)
  setTimeout(() => {
    const emailInp = document.getElementById('login-email');
    const passInp  = document.getElementById('login-password');
    if (emailInp) { emailInp.value = ''; emailInp.focus(); }
    if (passInp)  passInp.value = '';
    document.querySelector('.login-card')?.classList.add('login-card-visible');
  }, 80);
};

function showLoginAlert(message, type = 'error') {
  const el = document.getElementById('login-alert');
  if (!el) return;
  el.className = `login-alert login-alert-${type}`;
  el.textContent = message;
  el.style.display = 'block';
}
