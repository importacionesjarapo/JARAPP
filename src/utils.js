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
    toast.style.top = '30px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    toast.style.padding = '15px 25px';
    toast.style.background = 'rgba(3, 7, 18, 0.85)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.color = '#fff';
    toast.style.borderRadius = '12px';
    toast.style.zIndex = '10000';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '12px';
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    toast.style.fontFamily = "'Inter', sans-serif";
    toast.style.fontWeight = '600';
    toast.style.fontSize = '0.95rem';

    let icon = 'ℹ️';
    let borderColor = 'rgba(255,255,255,0.2)';
    let shadowColor = 'rgba(255,255,255,0.05)';

    if (type === 'success') {
        icon = '✅';
        borderColor = 'var(--success-green, #10B981)';
        shadowColor = 'rgba(16, 185, 129, 0.2)';
    } else if (type === 'error') {
        icon = '⚠️';
        borderColor = 'var(--primary-red, #E51365)';
        shadowColor = 'rgba(229, 19, 101, 0.3)';
    }

    toast.style.border = `1px solid ${borderColor}`;
    toast.style.boxShadow = `0 10px 30px ${shadowColor}, inset 0 0 10px ${shadowColor}`;

    toast.innerHTML = `<span style="font-size:1.2rem;">${icon}</span> <span>${message}</span>`;
    
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 400);
    }, 3500);
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

/**
 * Abre el modal genérico para detalles de KPI.
 * @param {string} title - Título del modal
 * @param {string} subtitle - Subtítulo descriptivo
 * @param {string} itemsHtml - HTML pre-renderizado de los ítems (.kpi-modal-item)
 */
export const openKPIDetailModal = (title, subtitle, itemsHtml) => {
    let mod = document.getElementById('kpi-detail-modal');
    if (!mod) {
        mod = document.createElement('div');
        mod.id = 'kpi-detail-modal';
        mod.className = 'modal-overlay';
        mod.innerHTML = `
            <div class="modal-content" id="modal-content" style="max-width: 600px; padding: 2rem;">
                <div class="kpi-modal-header">
                    <div>
                        <h2 class="kpi-modal-title" id="kpi-modal-title"></h2>
                        <div class="kpi-modal-subtitle" id="kpi-modal-subtitle"></div>
                    </div>
                    <button class="btn-action" onclick="document.getElementById('kpi-detail-modal').classList.remove('active')" style="background:transparent; border:none; font-size:1.5rem; color:var(--text-muted); cursor:pointer;">&times;</button>
                </div>
                
                <div class="kpi-modal-toolbar">
                    <span style="font-size: 0.8rem; color: var(--text-faint);">Se muestran los detalles más recientes de este indicador.</span>
                </div>
                
                <div class="kpi-modal-list" id="kpi-modal-list">
                    <!-- Items injected here -->
                </div>
            </div>
        `;
        document.body.appendChild(mod);
    }
    
    document.getElementById('kpi-modal-title').innerHTML = title;
    document.getElementById('kpi-modal-subtitle').innerHTML = subtitle;
    document.getElementById('kpi-modal-list').innerHTML = itemsHtml || '<div style="padding: 2rem; text-align: center; opacity: 0.5;">No hay detalles disponibles</div>';
    
    requestAnimationFrame(() => {
        mod.classList.add('active');
    });
};

window.openComprobanteViewer = openComprobanteViewer;
window.openKPIDetailModal = openKPIDetailModal;

/**
 * Muestra un cuadro de confirmación personalizado con estilo de la app.
 */
export const showCustomConfirm = (title, message, onConfirm, onCancel) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;z-index:9999;';
    overlay.innerHTML = `
        <div style="background:var(--bg-main);border:1px solid var(--brand-magenta);border-radius:16px;padding:2rem;max-width:400px;text-align:center;box-shadow:0 0 20px rgba(229,19,101,0.3);">
            <div style="font-size:3rem;margin-bottom:1rem;">⚠️</div>
            <h3 style="margin-bottom:1rem;color:var(--text-main);">${title}</h3>
            <p style="opacity:0.8;margin-bottom:1.5rem;font-size:0.9rem;">${message}</p>
            <div style="display:flex;gap:10px;">
                <button id="btn-cfm-yes" class="btn-primary" style="flex:1;padding:10px;">Confirmar</button>
                <button id="btn-cfm-no" style="flex:1;padding:10px;background:none;border:1px solid var(--glass-border);color:var(--text-main);border-radius:8px;">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-cfm-yes').onclick = () => { onConfirm(); document.body.removeChild(overlay); };
    overlay.querySelector('#btn-cfm-no').onclick = () => { if(onCancel) onCancel(); document.body.removeChild(overlay); };
};

window.showCustomConfirm = showCustomConfirm;

/**
 * Divide un array en sub-conjuntos para paginación.
 */
export const paginate = (items, page, rpp) => {
    const start = (page - 1) * rpp;
    return items.slice(start, start + rpp);
};

/**
 * Renderiza el control de navegación de páginas (Glassmorphism).
 */
export const renderPagination = (total, page, rpp, module) => {
    const totalPages = Math.ceil(total / rpp) || 1;
    if (page > totalPages && total > 0) {
        // Corrección de seguridad si quedamos en una página inexistente por filtros
        setTimeout(() => window.changePage(module, 1), 10);
        return '';
    }

    return `
    <div class="glass-pagination" style="display:flex; justify-content:space-between; align-items:center; margin-top:1.5rem; padding:12px 20px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border);">
        <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:0.85rem; opacity:0.6;">Filas por página:</span>
            <select onchange="window.changeRPP('${module}', this.value)" style="background:var(--input-bg); color:var(--text-main); border:1px solid var(--glass-border); padding:4px 8px; border-radius:8px; font-size:0.85rem; outline:none;">
                <option value="10" ${rpp == 10 ? 'selected' : ''}>10</option>
                <option value="25" ${rpp == 25 ? 'selected' : ''}>25</option>
                <option value="50" ${rpp == 50 ? 'selected' : ''}>50</option>
                <option value="100" ${rpp == 100 ? 'selected' : ''}>100</option>
            </select>
        </div>

        <div style="display:flex; align-items:center; gap:15px;">
            <button class="btn-action" ${page <= 1 ? 'disabled style="opacity:0.3; cursor:default;"' : `onclick="window.changePage('${module}', ${page - 1})"`}>
                Anterior
            </button>
            <span style="font-size:0.88rem; font-weight:600;">
                <span style="color:var(--brand-magenta);">${page}</span> <span style="opacity:0.4;">de</span> ${totalPages}
            </span>
            <button class="btn-action" ${page >= totalPages ? 'disabled style="opacity:0.3; cursor:default;"' : `onclick="window.changePage('${module}', ${page + 1})"`}>
                Siguiente
            </button>
        </div>

        <div style="font-size:0.85rem; opacity:0.6;">
            Total: <strong>${total}</strong> registros
        </div>
    </div>
    `;
};
