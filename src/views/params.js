import { db } from '../db.js';
import { auth } from '../auth.js';
import { renderError, showToast, uploadImageToSupabase, formatCOP } from '../utils.js';
import { TRMService } from '../services/trm.js';
import { ConfigService } from '../services/config.js';

export const renderParams = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Parámetros Globales...</div>`);

    const hoy = new Date().toISOString().split('T')[0];
    const [list, metas, trmHoy] = await Promise.all([
        db.fetchData('Configuracion'),
        db.fetchData('MetasDashboard'),
        TRMService.getTRMParaFecha(hoy),
    ]);
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    // ── Parámetros del sistema (Configuracion) ──
    const grouped = {
        Categoria:           list.filter(p => p.clave === 'Categoria'),
        Marca:               list.filter(p => p.clave === 'Marca'),
        Genero:              list.filter(p => p.clave === 'Genero'),
        Tienda:              list.filter(p => p.clave === 'Tienda'),
        BodegaUSA:           list.filter(p => p.clave === 'BodegaUSA'),
        TranspUSA:           list.filter(p => p.clave === 'TranspUSA'),
        TranspCOL:           list.filter(p => p.clave === 'TranspCOL'),
        ValorLibra:          list.filter(p => p.clave === 'ValorLibra'),
        PctGananciaAnalista: list.filter(p => p.clave === 'PctGananciaAnalista'),
    };

    // ── Metas del Dashboard (MetasDashboard) ──
    const METAS_SCHEMA = [
        { clave: 'meta_facturacion_mensual',    label: 'Meta Facturación Mensual',         tipo: 'cop',     desc: 'Objetivo de ventas facturadas en el mes (COP)',                    icon: '📊' },
        { clave: 'meta_cobrado_mensual',         label: 'Meta Cobrado Mensual',              tipo: 'cop',     desc: 'Objetivo de ingresos realmente cobrados en el mes (COP)',          icon: '✅' },
        { clave: 'meta_margen_neto_pct',         label: 'Meta Margen Neto (%)',              tipo: 'pct',     desc: 'Porcentaje de margen neto objetivo (ej: 25 = 25%)',               icon: '📈' },
        { clave: 'meta_cartera_maxima',          label: 'Cartera Vencida Máxima',           tipo: 'cop',     desc: 'Límite máximo aceptable de cartera vencida (COP)',                icon: '⚠️' },
        { clave: 'meta_dso_dias',                label: 'DSO Objetivo (días de cobro)',      tipo: 'num',     desc: 'Días promedio de cobro objetivo (Day Sales Outstanding)',         icon: '📅' },
        { clave: 'meta_rotacion_inventario',     label: 'Rotación de Inventario Objetivo',  tipo: 'num',     desc: 'Veces que debe rotar el inventario por año',                      icon: '🔄' },
        { clave: 'meta_envios_tiempo_pct',       label: 'On-Time Delivery (%)',             tipo: 'pct',     desc: 'Porcentaje de envíos entregados a tiempo objetivo',               icon: '🚚' },
        { clave: 'meta_nuevos_clientes_mes',     label: 'Nuevos Clientes por Mes',          tipo: 'num',     desc: 'Meta de adquisición de clientes nuevos por mes',                 icon: '👥' },
        { clave: 'meta_conversion_pct',          label: 'Conversión Cotización→Venta (%)',  tipo: 'pct',     desc: 'Tasa de conversión de cotizaciones en ventas cerradas',           icon: '🎯' },
        { clave: 'umbral_caja_minima',           label: 'Saldo Mínimo de Caja Operativa',   tipo: 'cop',     desc: 'Umbral mínimo de caja para alerta 🔴 (COP)',                      icon: '💰' },
        { clave: 'umbral_margen_minimo_pct',     label: 'Margen Mínimo por Producto (%)',   tipo: 'pct',     desc: 'Si el margen cae por debajo de esto, se genera alerta 🟡',       icon: '📉' },
        { clave: 'dias_inactividad_cliente',     label: 'Días para Cliente Inactivo',       tipo: 'num',     desc: 'Días sin compra para clasificar cliente en riesgo de churn',     icon: '😴' },
        { clave: 'dias_vencimiento_cotizacion',  label: 'Días para Alerta de Cotización',   tipo: 'num',     desc: 'Días sin respuesta antes de generar alerta sobre cotización',    icon: '📝' },
        { clave: 'dias_retraso_envio_critico',   label: 'Días Retraso Crítico de Envío',    tipo: 'num',     desc: 'Días de retraso en un envío para activar alerta 🔴',              icon: '🚨' },
        { clave: 'plazo_vencimiento_factura',    label: 'Plazo de Crédito por Defecto',     tipo: 'num',     desc: 'Días de crédito para calcular fecha de vencimiento de facturas', icon: '🗓️' },
    ];

    const metasMap = {};
    (Array.isArray(metas) ? metas : []).forEach(m => { metasMap[m.clave] = m; });

    const canEdit = auth.canEdit('params');

    const renderGroup = (title, key, arr) => `
        <div class="glass-card" style="margin-bottom:2rem; position:relative;">
           ${canEdit ? `<button class="btn-action" onclick="window.modalParametro('${key}')">+ ${key}</button>` : ''}
           <h3 style="margin-top:0;">${title} <span style="opacity:0.4; font-size:0.8rem; font-weight:normal;">(${arr.length} registrados)</span></h3>
           <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:1.5rem;">
               ${arr.length === 0 ? '<span style="opacity:0.4; font-size:0.8rem;">Ninguno registrado.</span>' : ''}
               ${arr.map(c => `
                  <div style="background:var(--glass-hover); border:1px solid var(--glass-border); padding:8px 12px; border-radius:12px; display:flex; gap:10px; align-items:center;">
                     <span style="font-weight:700;">${key === 'ValorLibra' ? `$${c.valor} USD` : c.valor}</span>
                     ${canEdit ? `<button onclick="window.deleteParametro('${c.id}')" style="background:none; border:none; color:var(--primary-red); cursor:pointer; opacity:0.5; font-size:1.1rem; padding:0;">&times;</button>` : ''}
                  </div>
               `).join('')}
           </div>
        </div>
    `;

    const formatMetaDisplay = (meta) => {
        if (!meta) return '—';
        if (meta.tipo === 'cop') return formatCOP(parseFloat(meta.valor));
        if (meta.tipo === 'pct') return `${meta.valor}%`;
        return meta.valor;
    };

    const renderMetasSection = () => `
        <div class="glass-card" style="margin-bottom:2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <div>
                    <h3 style="margin:0 0 4px 0;">🎯 Metas y Umbrales del Dashboard 360°</h3>
                    <p style="margin:0; opacity:0.55; font-size:0.82rem;">Define los objetivos y umbrales que usa el motor de alertas e inteligencia del dashboard.</p>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                ${METAS_SCHEMA.map(schema => {
                    const registro = metasMap[schema.clave];
                    const valorActual = registro ? registro.valor : null;
                    const valorDisplay = registro ? formatMetaDisplay({ ...schema, valor: registro.valor }) : null;
                    return `
                    <div style="background:var(--bg-main); border:1px solid var(--border-base); border-radius:14px; padding:1rem 1.2rem; display:flex; gap:12px; align-items:flex-start;">
                        <div style="font-size:1.5rem; flex-shrink:0; margin-top:2px;">${schema.icon}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.78rem; font-weight:700; margin-bottom:2px;">${schema.label}</div>
                            <div style="font-size:0.68rem; opacity:0.5; margin-bottom:8px; line-height:1.4;">${schema.desc}</div>
                            ${valorActual !== null
                                ? `<div style="font-size:1.1rem; font-weight:800; color:var(--info-blue); margin-bottom:6px;">${valorDisplay}</div>`
                                : `<div style="font-size:0.75rem; opacity:0.4; margin-bottom:6px; font-style:italic;">Sin configurar</div>`
                            }
                            ${canEdit ? `
                            <div style="display:flex; gap:6px; align-items:center;">
                                <input type="${schema.tipo === 'cop' || schema.tipo === 'num' || schema.tipo === 'pct' ? 'number' : 'text'}"
                                    id="meta-input-${schema.clave}"
                                    step="${schema.tipo === 'pct' ? '0.1' : '1'}"
                                    min="0"
                                    value="${valorActual || ''}"
                                    placeholder="${schema.tipo === 'cop' ? 'Ej: 50000000' : schema.tipo === 'pct' ? 'Ej: 25' : 'Ej: 30'}"
                                    style="flex:1; padding:6px 10px; border-radius:8px; border:1px solid var(--border-base); background:var(--surface-2); color:var(--text-main); font-size:0.82rem; font-family:inherit;"
                                >
                                <button onclick="window.guardarMeta('${schema.clave}', '${registro ? registro.id : ''}', '${schema.label}')"
                                    style="padding:6px 12px; border-radius:8px; border:none; background:var(--primary-red); color:#fff; font-size:0.75rem; font-weight:700; cursor:pointer; white-space:nowrap; flex-shrink:0;">
                                    Guardar
                                </button>
                            </div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `;

    const globalLogoParam = list.find(p => p.clave === 'GLOBAL_LOGO');
    const logoImgSrc = globalLogoParam ? globalLogoParam.valor : '';

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:2rem;">
        <div><h2>Parametrización del Sistema</h2><p style="opacity:0.5;">Administra variables desplegables, metas del Dashboard y configuración global.</p></div>
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
             ${canEdit ? `<button id="btn-save-logo" class="btn-primary">Guardar Logo</button>` : ''}
          </div>
      </div>

      ${renderMetasSection()}

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

      <!-- TRM Manual -->
      <div class="glass-card" style="margin-top:2rem;" id="trm-section">
          <h3 style="margin-top:0;">💱 TRM Manual</h3>
          <p style="opacity:0.55; font-size:0.82rem; margin-bottom:1.2rem;">
              El TRM se actualiza automáticamente cada día. Usa este campo solo si necesitas corregir el valor.
          </p>

          <!-- Estado actual -->
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:1.4rem; padding:10px 14px; background:var(--bg-main); border:1px solid var(--border-base); border-radius:12px;">
              <span style="font-size:1rem; opacity:0.6;">TRM actual para hoy (${hoy}):</span>
              ${trmHoy
                  ? `<span style="font-size:1.2rem; font-weight:800; color:var(--info-blue);">$${Math.round(trmHoy.valor).toLocaleString('es-CO')}</span>
                     <span style="font-size:0.65rem; font-weight:800; padding:2px 8px; border-radius:20px;
                       ${trmHoy.fuente === 'manual' ? 'background:rgba(249,115,22,0.15); color:#ea580c;' : 'background:rgba(34,197,94,0.15); color:#16a34a;'}">
                       ${trmHoy.fuente === 'manual' ? 'Manual' : 'Auto'}
                     </span>`
                  : `<span style="opacity:0.4; font-size:0.85rem; font-style:italic;">Sin registro para hoy — usando valor de sesión: $${Math.round(window.JARAPP_TRM || 3700).toLocaleString('es-CO')}</span>`
              }
          </div>

          ${canEdit ? `
          <div style="display:flex; gap:10px; align-items:flex-end; max-width:360px;">
              <div style="flex:1;">
                  <label class="form-label" style="margin-bottom:6px; display:block;">Nuevo valor TRM (COP por 1 USD)</label>
                  <input type="number" id="trm-manual-input" min="3000" max="6000" step="1"
                      value="${trmHoy ? Math.round(trmHoy.valor) : ''}"
                      placeholder="Ej: 4150"
                      style="width:100%; padding:9px 12px; border-radius:10px; border:1px solid var(--border-base); background:var(--surface-2); color:var(--text-main); font-size:1rem; font-family:inherit; box-sizing:border-box;">
              </div>
              <button id="btn-guardar-trm" class="btn-primary" style="flex-shrink:0; height:40px;">
                  Guardar TRM
              </button>
          </div>` : ''}
      </div>
    `;
    renderLayout(html);

    setTimeout(() => {
        // Guardar TRM Manual
        const btnTRM = document.getElementById('btn-guardar-trm');
        if (btnTRM) {
            btnTRM.onclick = async () => {
                const input = document.getElementById('trm-manual-input');
                const valor = parseFloat(input?.value);
                if (!valor || valor < 3000 || valor > 6000) {
                    showToast('Ingresa un valor entre 3.000 y 6.000', 'error');
                    return;
                }
                btnTRM.disabled = true;
                btnTRM.textContent = 'Guardando...';
                try {
                    const { error } = await db.client
                        .from('trm_historico')
                        .upsert([{ fecha: hoy, valor, fuente: 'manual' }], { onConflict: 'fecha' });
                    if (error) throw new Error(error.message);
                    // Actualizar global y badge de sidebar
                    window.JARAPP_TRM = valor;
                    window.JARAPP_TRM_FUENTE = 'manual';
                    const labelEl = document.getElementById('sidebar-trm-label');
                    const sourceEl = document.getElementById('sidebar-trm-source');
                    if (labelEl) labelEl.textContent = `TRM: $${Math.round(valor).toLocaleString('es-CO')}`;
                    if (sourceEl) { sourceEl.textContent = 'Manual'; sourceEl.className = 'trm-badge-source trm-manual'; }
                    showToast(`✅ TRM actualizado a $${Math.round(valor).toLocaleString('es-CO')}`, 'success');
                    navigateTo('params');
                } catch (err) {
                    showToast(err.message, 'error');
                    btnTRM.disabled = false;
                    btnTRM.textContent = 'Guardar TRM';
                }
            };
        }

        // Logo Upload
        const btnUpload = document.getElementById('btn-save-logo');
        if (btnUpload) {
            btnUpload.onclick = async () => {
                const fileInput = document.getElementById('logo-upload-input');
                if (!fileInput.files.length) return showToast('Selecciona una imagen primero.', 'error');
                btnUpload.innerHTML = `Subiendo...`;
                btnUpload.disabled = true;
                try {
                    const finalUrl = await uploadImageToSupabase(fileInput.files[0]);
                    if (!finalUrl) throw new Error("Fallo al subir archivo o ruta vacía.");
                    const payload = { id: globalLogoParam ? globalLogoParam.id : Date.now().toString(), clave: 'GLOBAL_LOGO', valor: finalUrl };
                    const action = globalLogoParam ? 'UPDATE' : 'INSERT';
                    await db.postData('Configuracion', payload, action);
                    localStorage.setItem('GLOBAL_LOGO_URL', finalUrl);
                    // Actualizar logo en toda la app sin recargar
                    ConfigService.clearLogoCache();
                    sessionStorage.setItem('JARAPP_LOGO', finalUrl);
                    ConfigService.applyLogo(finalUrl);
                    showToast('✅ Logo actualizado correctamente', 'success');
                    setTimeout(() => navigateTo('params'), 800);
                } catch(e) {
                    showToast(e.message, 'error');
                    btnUpload.innerText = "Reintentar";
                    btnUpload.disabled = false;
                }
            };
        }
    }, 100);

    // Guardar meta individual
    window.guardarMeta = async (clave, idExistente, labelMeta) => {
        const input = document.getElementById(`meta-input-${clave}`);
        if (!input) return;
        const valor = input.value.trim();
        if (!valor || isNaN(parseFloat(valor))) {
            showToast('Ingresa un valor numérico válido.', 'error');
            return;
        }
        try {
            const payload = {
                id:    idExistente || clave,
                clave: clave,
                valor: valor,
            };
            const action = idExistente ? 'UPDATE' : 'INSERT';
            await db.postData('MetasDashboard', payload, action);
            showToast(`✅ Meta "${labelMeta}" guardada`, 'success');
            // Invalidar caché del dashboard
            if (window.invalidateDashCache) window.invalidateDashCache();
            navigateTo('params');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    // Modal Parámetro (sistema original)
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

        window._onParamClaveChange = (val) => {
            const group = document.getElementById('param-valor-group');
            group.innerHTML = `
                <label class="form-label" id="param-valor-label">${isNumericKey(val) ? 'Valor (número)' : 'Nombre del Valor'}</label>
                ${renderValorField(val)}
                ${val === 'PctGananciaAnalista' ? '<p style="font-size:0.75rem;opacity:0.55;margin-top:4px;">Ingresa solo el número del porcentaje, sin el símbolo %. Ej: <strong>15</strong> equivale al 15%.</p>' : ''}
            `;
        };

        document.getElementById('form-param').onsubmit = async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-save-param');
            if (btn) { btn.disabled = true; btn.innerText = 'Guardando...'; }
            try {
                const fd = new FormData(e.target);
                const clave = fd.get('clave');
                const valorRaw = fd.get('valor');
                if (!valorRaw || !valorRaw.toString().trim()) throw new Error('El campo Valor es obligatorio.');
                const payload = { id: Date.now().toString(), clave: clave, valor: valorRaw.toString().trim() };
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
