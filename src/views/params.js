import { db } from '../db.js';
import { auth } from '../auth.js';
import { renderError, showToast, uploadImageToSupabase, formatCOP } from '../utils.js';

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
        ValorLibra: list.filter(p => p.clave === 'ValorLibra'),
        PctGananciaAnalista: list.filter(p => p.clave === 'PctGananciaAnalista')
    };

    const renderGroup = (title, key, arr) => `
        <div class="glass-card" style="margin-bottom:2rem; position:relative;">
           ${auth.canEdit('params') ? `<button class="btn-action" onclick="window.modalParametro('${key}')">+ ${key}</button>` : ''}
           <h3 style="margin-top:0;">${title} <span style="opacity:0.4; font-size:0.8rem; font-weight:normal;">(${arr.length} registrados)</span></h3>
           <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:1.5rem;">
               ${arr.length === 0 ? '<span style="opacity:0.4; font-size:0.8rem;">Ninguno registrado.</span>' : ''}
               ${arr.map(c => `
                  <div style="background:var(--glass-hover); border:1px solid var(--glass-border); padding:8px 12px; border-radius:12px; display:flex; gap:10px; align-items:center;">
                     <span style="font-weight:700;">${key === 'ValorLibra' ? `$${c.valor} USD` : c.valor}</span>
                     ${auth.canEdit('params') ? `<button onclick="window.deleteParametro('${c.id}')" style="background:none; border:none; color:var(--primary-red); cursor:pointer; opacity:0.5; font-size:1.1rem; padding:0;">&times;</button>` : ''}
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
             ${auth.canEdit('params') ? `<button id="btn-save-logo" class="btn-primary">Guardar Logo</button>` : ''}
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
          ${renderGroup('% Ganancia Analista', 'PctGananciaAnalista', grouped.PctGananciaAnalista)}
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

        const isNumericKey = (k) => k === 'ValorLibra' || k === 'PctGananciaAnalista';
        const getPlaceholder = (k) => {
            if (k === 'PctGananciaAnalista') return 'Ej: 15  (para 15%)';
            if (k === 'ValorLibra') return 'Ej: 3.5';
            return 'Ej: Nike, Ropa, Hombre, etc.';
        };

        const renderValorField = (clave) => isNumericKey(clave)
            ? `<input type="number" step="0.01" min="0" name="valor" id="param-valor-input" required placeholder="${getPlaceholder(clave)}" autocomplete="off">`
            : `<input type="text" name="valor" id="param-valor-input" required placeholder="${getPlaceholder(clave)}" autocomplete="off" style="text-transform: capitalize;">`;

        content.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <div>
                        <h2 class="modal-title">⚙️ Añadir Parámetro</h2>
                        <p style="opacity:0.6; font-size:0.85rem; margin-top:4px;">Registra un nuevo valor para las listas desplegables.</p>
                    </div>
                    <button onclick="window.closeModal()" class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="form-param" style="display:flex; flex-direction:column; gap:1.5rem;">
                        <div class="form-group">
                            <label class="form-label">Familia / Clave</label>
                            <select name="clave" id="param-clave-select" required onchange="window._onParamClaveChange(this.value)">
                                <option value="Marca"               ${clavePredefinida === 'Marca'               ? 'selected' : ''}>Marca</option>
                                <option value="Tienda"              ${clavePredefinida === 'Tienda'              ? 'selected' : ''}>Tienda / Origen</option>
                                <option value="Categoria"           ${clavePredefinida === 'Categoria'           ? 'selected' : ''}>Categoría</option>
                                <option value="Genero"              ${clavePredefinida === 'Genero'              ? 'selected' : ''}>Género</option>
                                <option value="BodegaUSA"           ${clavePredefinida === 'BodegaUSA'           ? 'selected' : ''}>Bodegas (USA)</option>
                                <option value="TranspUSA"           ${clavePredefinida === 'TranspUSA'           ? 'selected' : ''}>Transportadoras (Local USA)</option>
                                <option value="TranspCOL"           ${clavePredefinida === 'TranspCOL'           ? 'selected' : ''}>Transportadoras (Local COL)</option>
                                <option value="ValorLibra"          ${clavePredefinida === 'ValorLibra'          ? 'selected' : ''}>Valor Libra Envío EEUU→COL</option>
                                <option value="PctGananciaAnalista" ${clavePredefinida === 'PctGananciaAnalista' ? 'selected' : ''}>% Ganancia Analista de Ventas</option>
                            </select>
                        </div>
                        <div class="form-group" id="param-valor-group">
                            <label class="form-label" id="param-valor-label">${isNumericKey(clavePredefinida) ? 'Valor (número)' : 'Nombre del Valor'}</label>
                            ${renderValorField(clavePredefinida)}
                            ${clavePredefinida === 'PctGananciaAnalista' ? '<p style="font-size:0.75rem;opacity:0.55;margin-top:4px;">Ingresa solo el número del porcentaje, sin el símbolo %. Ej: <strong>15</strong> equivale al 15%.</p>' : ''}
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
                    <button type="submit" form="form-param" class="btn-primary" id="btn-save-param">Guardar Parámetro</button>
                </div>
            </div>
        `;
        container.style.display = 'flex';

        // Reactive clave change
        window._onParamClaveChange = (val) => {
            const group = document.getElementById('param-valor-group');
            const lbl   = document.getElementById('param-valor-label');
            lbl.textContent = isNumericKey(val) ? 'Valor (número)' : 'Nombre del Valor';
            group.innerHTML = `
                <label class="form-label" id="param-valor-label">${isNumericKey(val) ? 'Valor (número)' : 'Nombre del Valor'}</label>
                ${renderValorField(val)}
                ${val === 'PctGananciaAnalista' ? '<p style="font-size:0.75rem;opacity:0.55;margin-top:4px;">Ingresa solo el número del porcentaje, sin el símbolo %. Ej: <strong>15</strong> equivale al 15%.</p>' : ''}
            `;
        };

        document.getElementById('form-param').onsubmit = async (e) => {
            e.preventDefault();
            // The submit button is outside the form (modal-footer), so use getElementById
            const btn = document.getElementById('btn-save-param');
            if (btn) { btn.disabled = true; btn.innerText = 'Guardando...'; }

            try {
                const fd = new FormData(e.target);
                const clave = fd.get('clave');
                const valorRaw = fd.get('valor');
                if (!valorRaw || !valorRaw.toString().trim()) {
                    throw new Error('El campo Valor es obligatorio.');
                }
                const payload = {
                    id:    Date.now().toString(),
                    clave: clave,
                    valor: valorRaw.toString().trim()
                };

                await db.postData('Configuracion', payload, 'INSERT');
                window.closeModal();
                showToast('✅ Parámetro agregado con éxito', 'success');
                navigateTo('params');
            } catch (err) {
                showToast(err.message, 'error');
                btn.disabled = false; btn.innerText = 'Reintentar';
            }
        };
    };


    window.deleteParametro = async (id) => {
        const ok = await window.customConfirm('Eliminar Parámetro', '¿Estás seguro de eliminar este parámetro? Puede que productos existentes ya lo estén usando.');
        if(!ok) return;
        
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
