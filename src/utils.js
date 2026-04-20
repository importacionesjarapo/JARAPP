export const formatCOP = (num) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(isNaN(parseFloat(num)) ? 0 : parseFloat(num));
import { db } from './db.js';
export const formatUSD = (num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(isNaN(parseFloat(num)) ? 0 : parseFloat(num));

/**
 * Retorna la fase logística canónica de una venta (sin prefijo numérico).
 * Es la ÚNICA fuente de verdad para el estado de una orden en todos los módulos.
 * @param {string|number} ventaId - ID de la venta
 * @param {Array} logisticaList  - Array de registros de la tabla Logistica
 * @param {string} fallback      - Texto a mostrar si no hay registro logístico
 */
export const getLogisticaFase = (ventaId, logisticaList, fallback = 'Procesando') => {
    if (!Array.isArray(logisticaList) || !ventaId) return fallback;
    const reg = logisticaList.find(l => l.venta_id?.toString() === ventaId.toString());
    if (!reg || !reg.fase) return fallback;
    return reg.fase.replace(/^(\d+[\.\-\)]?\s*)/, '').trim();
};

/**
 * Retorna el color del badge según la fase logística.
 */
export const getLogisticaColor = (fase) => {
    if (!fase) return 'var(--info-blue)';
    if (fase.includes('Entregado')) return 'var(--success-green)';
    if (fase.includes('Colombia') || fase.includes('Bodega Col')) return 'var(--warning-orange)';
    if (fase.includes('Aduana') || fase.includes('Internacional')) return '#9b5de5';
    if (fase.includes('USA') || fase.includes('Bodega USA') || fase.includes('Estados Unidos')) return 'var(--info-blue)';
    if (fase.includes('Tránsito') || fase.includes('Tienda')) return '#00b4d8';
    if (fase.includes('Comprado')) return 'var(--primary-red)';
    return 'var(--info-blue)';
};

export const renderError = (renderLayout, msg, navigateTo) => {
    renderLayout(`
      <div class="glass-card" style="border:1px solid var(--primary-red); text-align:center; padding:4rem;">
         <h2>Error de Sincronización</h2>
         <p>${msg}</p>
         <button id="btn-err-settings" class="btn-primary" style="margin-top: 1rem;">Ajustar Configuración</button>
      </div>
    `);
    
    setTimeout(() => {
        const btn = document.getElementById('btn-err-settings');
        if(btn) btn.onclick = () => navigateTo('settings');
    }, 100);
};

export const showToast = (message, type = 'success') => {
    const existing = document.getElementById('jarapo-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'jarapo-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.padding = '1rem 2rem';
    toast.style.background = type === 'success' ? 'var(--primary-red)' : 'var(--bg-charcoal)';
    toast.style.color = '#fff';
    toast.style.borderRadius = 'var(--radius)';
    toast.style.zIndex = '10000';
    toast.style.boxShadow = 'var(--soft-shadow)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s ease';
    toast.style.border = '1px solid var(--glass-border)';

    if (type === 'error') {
       toast.style.border = '1px solid var(--primary-red)';
    }

    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

export const uploadImageToSupabase = async (file) => {
    return new Promise(async (resolve, reject) => {
        if (!db.client) {
            return reject(new Error("Falta la configuración de Supabase. Ve a 'Configuración', pega tu URL y llave y activa la conexión."));
        }
        
        try {
            const fileExt = file.name.split('.').pop() || 'jpg';
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `${fileName}`;

            const { data, error } = await db.client.storage
                .from('jarapo-images')
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) throw error;

            // Obtener la URL pública inmediatamente
            const { data: urlData } = db.client.storage
                .from('jarapo-images')
                .getPublicUrl(filePath);

            if (urlData && urlData.publicUrl) {
                resolve(urlData.publicUrl);
            } else {
                resolve("");
            }
        } catch (err) {
            reject(new Error("Supabase Storage Error: " + err.message));
        }
    });
};

// ─── Comprobante de Pago ────────────────────────────────────────────────────────

/** Genera el HTML del área de carga de comprobante */
export const buildComprobanteUploadHTML = (inputId = 'comp-file') => `
  <div class="comprobante-upload-zone">
    <input type="file" id="${inputId}" accept="image/*" style="display:none">
    <div class="comp-upload-placeholder" id="${inputId}-placeholder" onclick="document.getElementById('${inputId}').click()">
      <span style="font-size:1.4rem;">📎</span>
      <span style="font-size:0.82rem;font-weight:600;opacity:0.75;">Adjuntar comprobante de pago</span>
      <span style="font-size:0.7rem;opacity:0.45;">Opcional · JPG, PNG, WEBP — Clic para seleccionar</span>
    </div>
    <div id="${inputId}-preview" class="comp-upload-preview" style="display:none;">
      <img id="${inputId}-img" src="" class="comp-preview-img">
      <span id="${inputId}-name" class="comp-preview-name"></span>
      <button type="button" class="comp-preview-remove" onclick="window._clearComp('${inputId}')">✕</button>
    </div>
  </div>
`;

/** Conecta eventos al input de comprobante */
export const attachComprobanteInput = (inputId = 'comp-file') => {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById(`${inputId}-name`).textContent = file.name;
        const reader = new FileReader();
        reader.onload = (re) => { document.getElementById(`${inputId}-img`).src = re.target.result; };
        reader.readAsDataURL(file);
        document.getElementById(`${inputId}-preview`).style.display = 'flex';
        document.getElementById(`${inputId}-placeholder`).style.display = 'none';
    };
    window._clearComp = (id) => {
        document.getElementById(id).value = '';
        document.getElementById(`${id}-preview`).style.display = 'none';
        document.getElementById(`${id}-placeholder`).style.display = 'flex';
    };
};

/** Abre el visor lightbox del comprobante */
export const openComprobanteViewer = (url) => {
    const existing = document.getElementById('comp-viewer-overlay');
    if (existing) existing.remove();
    const ov = document.createElement('div');
    ov.id = 'comp-viewer-overlay';
    ov.className = 'comp-viewer-overlay';
    ov.innerHTML = `
        <div class="comp-viewer-panel" onclick="event.stopPropagation()">
            <img src="${url}" class="comp-viewer-img" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <div style="display:none;padding:2rem;text-align:center;opacity:0.5;">No se pudo cargar la imagen</div>
            <div class="comp-viewer-footer">
                <a href="${url}" target="_blank" class="comp-viewer-open-btn">↗ Abrir en nueva pestaña</a>
                <button onclick="document.getElementById('comp-viewer-overlay').remove()" class="comp-viewer-close-btn">✕ Cerrar</button>
            </div>
        </div>
    `;
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('comp-viewer-visible'));
};

export const downloadExcel = (jsonData, fileName = 'reporte', sheetName = 'Datos') => {
    import('xlsx').then(XLSX => {
        const worksheet = XLSX.utils.json_to_sheet(jsonData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        XLSX.writeFile(workbook, `${fileName}.xlsx`);
    }).catch(err => {
        console.error('Error loading xlsx module:', err);
        showToast('Error generando archivo Excel', 'error');
    });
};

window.openComprobanteViewer = openComprobanteViewer;
