import { db } from '../db.js';

const client = () => db.client;

export const ConfigService = {

  async getLogo() {
    const cached = sessionStorage.getItem('JARAPP_LOGO');
    if (cached) return cached;

    const { data } = await client()
      .from('Configuracion')
      .select('valor')
      .eq('clave', 'GLOBAL_LOGO')
      .maybeSingle();

    const url = data?.valor || null;
    if (url) sessionStorage.setItem('JARAPP_LOGO', url);
    return url;
  },

  clearLogoCache() {
    sessionStorage.removeItem('JARAPP_LOGO');
    window.JARAPP_LOGO = null;
  },

  applyLogo(url) {
    if (!url) return;
    window.JARAPP_LOGO = url;
    const logoMark = document.getElementById('sidebar-logo-letter');
    if (logoMark) {
      logoMark.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:contain;" alt="Logo">`;
    }
    // Actualizar cualquier img con clase app-logo-img
    document.querySelectorAll('.app-logo-img').forEach(img => {
      img.src = url;
      img.style.display = 'block';
    });
    // Silueta de fondo ambiental (.main-content::after, style.css) — usa el
    // logo real del tenant como máscara en vez del logo genérico de
    // EncargosPro (/logo.png, fallback vía var(..., url(...)) mientras este
    // valor no se haya seteado todavía, ej. un tenant que no ha subido el suyo).
    document.documentElement.style.setProperty('--tenant-logo-mask', `url("${url}")`);
  },
};
