import { db } from '../db.js';

export const renderSettingsView = (renderLayout, navigateTo, msg = null) => {
    const supaUrl = localStorage.getItem('JARAPO_SUPA_URL') || '';
    const supaKey = localStorage.getItem('JARAPO_SUPA_KEY') || '';
    
    const alertHtml = msg ? `<div style="background:var(--primary-red); color:var(--text-main); padding:1rem; border-radius:12px; margin-bottom:1.5rem;">${msg}</div>` : '';

    renderLayout(`
      <div class="glass-card" style="max-width:550px; margin:0 auto; padding:3rem; text-align:center;">
        <h2 style="margin-bottom:0.5rem;">Conectar con Supabase</h2>
        <p style="opacity:0.6; margin-bottom: 2rem;">Ingresa tus credenciales de proyecto de Supabase (Database & Storage)</p>
        
        ${alertHtml}

        <p style="opacity:0.6; margin-bottom: 0.5rem; text-align:left; font-size:0.8rem;">Supabase Project URL</p>
        <input type="url" id="supa-url" value="${supaUrl}" placeholder="https://xxxxxx.supabase.co" style="width:100%; border-radius:12px; margin-bottom:1.5rem; background:var(--glass-hover);">
        
        <p style="opacity:0.6; margin-bottom: 0.5rem; text-align:left; font-size:0.8rem;">Supabase Anon / Public API Key</p>
        <input type="password" id="supa-key" value="${supaKey}" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style="width:100%; border-radius:12px; margin-bottom:1.5rem; background:var(--glass-hover);">
        
        <button id="save-settings" class="btn-primary" style="width:100%;">Activar Conexión Medellín</button>
      </div>
    `);
    
    setTimeout(() => {
        const btn = document.getElementById('save-settings');
        if(btn) {
            btn.onclick = () => {
              const u = document.getElementById('supa-url').value;
              const k = document.getElementById('supa-key').value;
              if (!u.includes('supabase.co')) return window.showToast("Formato de URL inválido. Asegúrate de copiar el Project URL de Supabase.", 'error');
              if (k.length < 20) return window.showToast("Key inválida. Pega el texto completo del Anon Key.", 'error');
              
              db.setCredentials(u, k);
              
              navigateTo('dashboard');
            };
        }
    }, 100);
};
