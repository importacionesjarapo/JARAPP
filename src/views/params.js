import { db } from '../db.js';
import { renderError, showToast, uploadImageToSupabase } from '../utils.js';

export const renderParams = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Parámetros Globales...</div>`);
    const list = await db.fetchData('Configuracion');
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    // Agrupar por clave
    const grouped = {
        Categoria: list.filter(p => p.clave === 'Categoria'),
        Marca: list.filter(p => p.clave === 'Marca'),
        Genero: list.filter(p => p.clave === 'Genero'),
        Tienda: list.filter(p => p.clave === 'Tienda'),
        BodegaUSA: list.filter(p => p.clave === 'BodegaUSA'),
        TranspUSA: list.filter(p => p.clave === 'TranspUSA'),
        TranspCOL: list.filter(p => p.clave === 'TranspCOL'),
        ValorLibra: list.filter(p => p.clave === 'ValorLibra')
    };

    const renderGroup = (title, key, arr) => `
        <div class="glass-card" style="margin-bottom:2rem; position:relative;">
           <button class="btn-action" onclick="window.modalParametro('${key}')">+ ${key}</button>
           <h3 style="margin-top:0;">${title} <span style="opacity:0.4; font-size:0.8rem; font-weight:normal;">(${arr.length} registrados)</span></h3>
           <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:1.5rem;">
               ${arr.length === 0 ? '<span style="opacity:0.4; font-size:0.8rem;">Ninguno registrado.</span>' : ''}
               ${arr.map(c => `
                  <div style="background:var(--glass-hover); border:1px solid var(--glass-border); padding:8px 12px; border-radius:12px; display:flex; gap:10px; align-items:center;">
                     <span style="font-weight:700;">${c.valor}</span>
                     <button onclick="window.deleteParametro('${c.id}')" style="background:none; border:none; color:var(--primary-red); cursor:pointer; opacity:0.5; font-size:1.1rem; padding:0;">&times;</button>
                  </div>
               `).join('')}
           </div>
        </div>
    `;

    const globalLogoParam = list.find(p => p.clave === 'GLOBAL_LOGO');
    const logoImgSrc = globalLogoParam ? globalLogoParam.valor : '';

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:2rem;">
        <div><h2>Parametrización del Sistema</h2><p style="opacity:0.5;">Administra las variables desplegables de Listas y Formularios.</p></div>
      </div>

      <div class="glass-card" style="margin-bottom:2rem; display:flex; gap:20px; align-items:center;">
          <div style="width:80px; height:80px; border-radius:16px; background:var(--glass-hover); overflow:hidden; display:flex; justify-content:center; align-items:center; flex-shrink:0; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
             ${logoImgSrc ? `<img src="${logoImgSrc}" style="width:100%; height:100%; object-fit:cover;">` : `<i data-lucide="image" style="opacity:0.3; width:30px; height:30px;"></i>`}
          </div>
          <div style="flex:1;">
             <h3 style="margin-top:0;">Logotipo de JARAPP</h3>
             <p style="opacity:0.6; font-size:0.8rem; margin-bottom:10px;">Sube o actualiza la imagen corporativa para el menú lateral (Recomendado 1:1 Cuadrado).</p>
             <input type="file" id="logo-upload-input" accept="image/*" style="font-size:0.8rem; padding:8px;">
          </div>
          <div>
             <button id="btn-save-logo" class="btn-primary">Guardar Logo</button>
          </div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
          ${renderGroup('Marcas', 'Marca', grouped.Marca)}
          ${renderGroup('Tiendas', 'Tienda', grouped.Tienda)}
          ${renderGroup('Categorías', 'Categoria', grouped.Categoria)}
          ${renderGroup('Géneros', 'Genero', grouped.Genero)}
          ${renderGroup('Bodegas USA', 'BodegaUSA', grouped.BodegaUSA)}
          ${renderGroup('Transp. Local USA', 'TranspUSA', grouped.TranspUSA)}
          ${renderGroup('Transp. (Local Colombia)', 'TranspCOL', grouped.TranspCOL)}
          ${renderGroup('Valor Libra Envio EEUU - COLOMBIA', 'ValorLibra', grouped.ValorLibra)}
      </div>
    `;
    renderLayout(html);

    setTimeout(() => {
        const btnUpload = document.getElementById('btn-save-logo');
        if (btnUpload) {
            btnUpload.onclick = async () => {
                const fileInput = document.getElementById('logo-upload-input');
                if (!fileInput.files.length) return showToast('Selecciona una imagen primero.', 'error');
                
                btnUpload.innerHTML = `<i class="spin" data-lucide="loader-2"></i> Subiendo...`;
                btnUpload.disabled = true;
                
                try {
                    const finalUrl = await uploadImageToSupabase(fileInput.files[0]);
                    if (!finalUrl) throw new Error("Fallo al subir archivo o ruta vacía.");
                    
                    const payload = {
                        id: globalLogoParam ? globalLogoParam.id : Date.now().toString(),
                        clave: 'GLOBAL_LOGO',
                        valor: finalUrl
                    };
                    
                    const action = globalLogoParam ? 'UPDATE' : 'INSERT';
                    await db.postData('Configuracion', payload, action);
                    
                    localStorage.setItem('GLOBAL_LOGO_URL', finalUrl);
                    showToast('Logo actualizado. Recargando...', 'success');
                    
                    setTimeout(() => window.location.reload(), 1500);
                } catch(e) {
                    showToast(e.message, 'error');
                    btnUpload.innerText = "Reintentar";
                    btnUpload.disabled = false;
                }
            };
        }
    }, 100);

    // Inyectar modales
    window.modalParametro = (clavePredefinida = 'Categoria') => {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        
        content.innerHTML = `
            <h2 style="margin-bottom:1.5rem;">Añadir Nuevo Parámetro</h2>
            <form id="form-param" style="display:flex; flex-direction:column; gap:1.2rem;">
                <div>
                   <label>Familia / Clave</label>
                   <select name="clave" required>
                      <option value="Marca" ${clavePredefinida === 'Marca' ? 'selected' : ''}>Marca</option>
                      <option value="Tienda" ${clavePredefinida === 'Tienda' ? 'selected' : ''}>Tienda / Origen</option>
                      <option value="Categoria" ${clavePredefinida === 'Categoria' ? 'selected' : ''}>Categoría</option>
                      <option value="Genero" ${clavePredefinida === 'Genero' ? 'selected' : ''}>Género</option>
                      <option value="BodegaUSA" ${clavePredefinida === 'BodegaUSA' ? 'selected' : ''}>Bodegas (USA)</option>
                      <option value="TranspUSA" ${clavePredefinida === 'TranspUSA' ? 'selected' : ''}>Transportadoras (Local USA)</option>
                      <option value="TranspCOL" ${clavePredefinida === 'TranspCOL' ? 'selected' : ''}>Transportadoras (Local COL)</option>
                      <option value="ValorLibra" ${clavePredefinida === 'ValorLibra' ? 'selected' : ''}>Valor Libra Envio EEUU - COLOMBIA</option>
                   </select>
                </div>
                <div>
                   <label>Nombre del Valor</label>
                   <input type="text" name="valor" required placeholder="Ej: Nike, Ropa, Hombre, etc." autocomplete="off" style="text-transform: capitalize;">
                </div>
                <div style="display:flex; gap:15px; margin-top:1.5rem;">
                   <button type="submit" class="btn-primary" style="flex:1;">Guardar Parámetro</button>
                   <button type="button" onclick="window.closeModal()" style="flex:1; background:none; border:1px solid var(--glass-border); color:var(--text-main); border-radius:16px;">Cancelar</button>
                </div>
            </form>
        `;
        container.style.display = 'flex';

        document.getElementById('form-param').onsubmit = async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true; btn.innerText = "Guardando...";

            const payload = {
                id: Date.now().toString(),
                clave: new FormData(e.target).get('clave'),
                valor: new FormData(e.target).get('valor').trim()
            };

            try {
                await db.postData('Configuracion', payload, 'INSERT');
                window.closeModal();
                showToast('Parámetro agregado con éxito', 'success');
                navigateTo('params'); // recargar
            } catch (err) {
                showToast(err.message, 'error');
                btn.disabled = false; btn.innerText = "Reintentar";
            }
        };
    };

    window.deleteParametro = async (id) => {
        if(!confirm('¿Estás seguro de eliminar este parámetro? Puede que productos existentes ya lo estén usando.')) return;
        
        renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Eliminando Parámetro...</div>`);
        try {
            await db.postData('Configuracion', { id: id.toString() }, 'DELETE');
            showToast('Parámetro eliminado', 'success');
            navigateTo('params');
        } catch (err) {
            showToast(err.message, 'error');
            navigateTo('params');
        }
    };
};
