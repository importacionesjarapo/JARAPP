import { db } from '../db.js';
import { auth } from '../auth.js';
import { renderError, showToast, uploadImageToSupabase, downloadExcel, renderPagination, paginate, formatCOP } from '../utils.js';

let _logStartDate = '';
let _logEndDate = '';
let _logActiveTab = 'general';

export const renderLogistics = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Módulo de Logística...</div>`);
    
    const [list, ventas, clientes, compras, productos, guiasIntRaw] = await Promise.all([
        db.fetchData('Logistica'),
        db.fetchData('Ventas'),
        db.fetchData('Clientes'),
        db.fetchData('Compras'),
        db.fetchData('Productos'),
        db.fetchData('GuiasInternacionales')
    ]);
    
    // Handle potential error if table doesn't exist yet
    const guiasInt = Array.isArray(guiasIntRaw) ? guiasIntRaw : [];
    
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    const applyLogFilter = () => {
        _logStartDate = document.getElementById('log-date-start').value;
        _logEndDate = document.getElementById('log-date-end').value;
        renderLogistics(renderLayout, navigateTo);
    };
    window.applyLogDateFilter = applyLogFilter;

    window.switchLogTab = (tab) => {
        _logActiveTab = tab;
        renderLogistics(renderLayout, navigateTo);
    };

    let filteredList = [...list];
    if (_logStartDate || _logEndDate) {
        const _s = _logStartDate ? new Date(_logStartDate + 'T00:00:00') : null;
        const _e = _logEndDate ? new Date(_logEndDate + 'T23:59:59') : null;
        filteredList = filteredList.filter(c => {
            const up = c.fecha_actualizacion ? c.fecha_actualizacion.split('T')[0] : '';
            if (!up) return true; // Si no tiene fecha, lo dejamos o podemos filtrarlo. Asumamos que lo dejamos.
            const vd = new Date(up + 'T12:00:00');
            if (isNaN(vd)) return true;
            if (_s && vd < _s) return false;
            if (_e && vd > _e) return false;
            return true;
        });
    }

    const _page = parseInt(localStorage.getItem('logistics_page') || '1');
    const _rpp  = parseInt(localStorage.getItem('logistics_rpp') || '10');
    const pagedList = paginate(filteredList, _page, _rpp);
    const reversedList = [...pagedList].reverse();

    const FASES = [
        "1. Comprado (Esperando Tracking Local USA)",
        "2. En Tránsito (Tienda -> Bodega USA)",
        "3. En Bodega USA (Estados Unidos)",
        "4. Tránsito Internacional / Aduana",
        "5. En Bodega Colombia",
        "6. Entregado a Cliente Final"
    ];

    const mapFase = (faseStr) => {
        if(!faseStr) return FASES[0];
        if(faseStr.includes('1. ') || faseStr.includes('Comprado')) return FASES[0];
        if(faseStr.includes('2. ') || faseStr.includes('Tienda -> Bodega')) return FASES[1];
        if(faseStr.includes('3. ') || faseStr.includes('Bodega USA') || faseStr.includes('Estados Unidos') || faseStr.includes('Miami')) return FASES[2];
        if(faseStr.includes('4. ') || faseStr.includes('Internacional') || faseStr.includes('Aduana')) return FASES[3];
        if(faseStr.includes('5. ') || faseStr.includes('Bodega Colombia')) return FASES[4];
        if(faseStr.includes('6. ') || faseStr.includes('Entregado a Cliente') || faseStr.includes('Final')) return FASES[5];
        return FASES[0];
    };

    const faseCounts = FASES.map(f => reversedList.filter(c => mapFase(c.fase) === f).length);
    const totalEnvios = faseCounts.reduce((a, b) => a + b, 0);

    const summaryHtml = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:2rem;">
        ${FASES.map((f, i) => {
            let borderColor = 'var(--glass-border)';
            let accentColor = 'var(--text-main)';
            if (i === 0) accentColor = 'var(--primary-red)';
            if (i === 1) accentColor = 'var(--info-blue)';
            if (i === 2) accentColor = 'var(--warning-orange)';
            if (i === 3) accentColor = 'var(--success-green)';
            if (i === 5) accentColor = 'var(--success-green)';
            
            return `
            <div class="glass-card summary-card" onclick="document.getElementById('fase-block-${i}').scrollIntoView({behavior: 'smooth', block: 'start'})" style="cursor:pointer; text-align:center; padding:12px; border-bottom: 3px solid ${accentColor}; transition: all 0.2s;" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform='none'">
               <div style="font-size:1.8rem; font-weight:bold; color:${accentColor};">${faseCounts[i]}</div>
               <div style="font-size:0.7rem; opacity:0.8; margin-top:5px; line-height:1.2; text-transform:uppercase;">${f.replace(/^[0-9]+\.\s*/, '')}</div>
            </div>
            `;
        }).join('')}
      </div>
    `;

    window.exportLogExcel = () => {
        if (reversedList.length === 0) return showToast('No hay datos para exportar', 'error');
        const dataToExport = reversedList.map(c => {
            const vData = !ventas.error ? ventas.find(v => v.id.toString() === c.venta_id?.toString()) : null;
            const cliInfo = vData && !clientes.error ? clientes.find(cl => cl.id.toString() === vData.cliente_id?.toString()) : null;
            const pData = vData && !productos.error ? productos.find(p => p.id.toString() === vData.producto_id?.toString()) : null;
            return {
                'ID Logística': c.id,
                'Fase': mapFase(c.fase),
                'Cliente': cliInfo ? cliInfo.nombre : (c.venta_id ? 'Desconocido' : 'Stock'),
                'Venta Relacionada': c.venta_id || '',
                'Producto': pData ? pData.nombre_producto : '',
                'Última Actualización': c.fecha_actualizacion ? c.fecha_actualizacion.split('T')[0] : '',
                'Notas': c.notas || ''
            };
        });
        downloadExcel(dataToExport, `Reporte_Logistica_${new Date().toISOString().split('T')[0]}`);
    };

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:2rem; flex-wrap:wrap; gap:15px;">
        <div><h2>Seguimiento de Cargas</h2><p style="opacity:0.5;">Monitoreo de envíos internacionales por etapas (Kanban).</p></div>
        <div class="module-filters-bar">
            <div class="date-filter-wrap">
                <label>Desde</label>
                <input type="date" id="log-date-start" class="date-filter-input" value="${_logStartDate}">
                <label style="margin-left:5px;">Hasta</label>
                <input type="date" id="log-date-end" class="date-filter-input" value="${_logEndDate}">
                <button class="btn-action" style="padding:4px 10px;font-size:0.75rem;" onclick="window.applyLogDateFilter()">Filtrar</button>
            </div>
            <button class="btn-excel" onclick="window.exportLogExcel()">📥 Excel</button>
            <input type="text" id="find-it" placeholder="Filtrar por guía, cliente o fase..." style="background:var(--input-bg); color:var(--text-main); padding:10px 15px; border-radius:12px; border:1px solid var(--glass-border); width:260px; outline:none;">
            ${auth.canEdit('logistics') ? `<button class="btn-primary" onclick="window.modalLogistica()">+ Agregar Seguimiento</button>` : ''}
        </div>
      </div>

      <div class="module-tabs" style="display:flex; gap:10px; margin-bottom:2rem; border-bottom:1px solid var(--glass-border); padding-bottom:10px;">
          <button class="tab-btn ${_logActiveTab === 'general' ? 'active' : ''}" onclick="window.switchLogTab('general')" style="background:none; border:none; color:${_logActiveTab === 'general' ? 'var(--primary-red)' : 'var(--text-main)'}; font-weight:700; cursor:pointer; padding:5px 15px; border-bottom: 2px solid ${_logActiveTab === 'general' ? 'var(--primary-red)' : 'transparent'}; transition:all 0.3s;">Seguimiento General</button>
          ${auth.canAccess('feat_usa') ? `<button class="tab-btn ${_logActiveTab === 'eeuu' ? 'active' : ''}" onclick="window.switchLogTab('eeuu')" style="background:none; border:none; color:${_logActiveTab === 'eeuu' ? 'var(--primary-red)' : 'var(--text-main)'}; font-weight:700; cursor:pointer; padding:5px 15px; border-bottom: 2px solid ${_logActiveTab === 'eeuu' ? 'var(--primary-red)' : 'transparent'}; transition:all 0.3s;">Envíos EEUU a Colombia</button>` : ''}
      </div>
      
      ${_logActiveTab === 'eeuu' && auth.canAccess('feat_usa') ? renderEnviosEEUU(list, ventas, clientes, compras, productos, guiasInt) : `
      ${summaryHtml}

      <div id="list-body">
      ${FASES.map((f, i) => {
          const items = reversedList.filter(c => mapFase(c.fase) === f);
          
          let headerColor = 'rgba(255,255,255,0.05)';
          let textColor = 'var(--text-main)';
          
          if (i === 0) { headerColor = 'var(--primary-red)'; textColor = '#fff'; } // 1
          if (i === 1) { headerColor = 'var(--info-blue)'; textColor = '#fff'; } // 2
          if (i === 2) { headerColor = 'var(--warning-orange)'; textColor = '#000'; } // 3
          if (i === 3) { headerColor = 'rgba(6, 214, 160, 0.2)'; textColor = 'var(--success-green)'; } // 4
          // 5 is standard
          if (i === 5) { headerColor = 'var(--success-green)'; textColor = '#000'; } // 6

          let th1 = "GUÍA / TRACKING";
          let th3 = "TRANSPORTADORA";
          let th4 = "ESTADO / UBICACIÓN";
          if (i === 0) {
             th1 = "Nº ORDEN / COMPRA";
             th3 = "TIENDA PROVEEDOR";
             th4 = "UBICACIÓN ORIGEN";
          } else if (i === 1 || i === 2) {
             th1 = "TRACKING LOCAL USA";
             th3 = "TRANSPORTE USA";
             th4 = "BODEGA USA";
          } else if (i === 3) {
             th1 = "TRACKING INTERNACIONAL";
             th3 = "AEROLÍNEA / COURIER";
             th4 = "FECHAS LOGÍSTICAS";
          } else if (i === 4) {
             th1 = "FECHA DE LLEGADA (COL)";
             th3 = "ESTADO NOTIFICACIÓN";
             th4 = "PRODUCTO / VENTA";
          } else if (i === 5) {
             th1 = "GUÍA LOCAL COLOMBIA";
             th3 = "ESTADO DE ENTREGA";
             th4 = "DESTINATARIO / PRODUCTO";
          }

          return `
          <div id="fase-block-${i}" class="log-fase-block glass-card" style="margin-bottom:2rem; padding:0; border:1px solid rgba(255,255,255,0.1); overflow:hidden;">
              <div style="background:${headerColor}; padding:1rem 1.5rem; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--glass-border);">
                 <h3 style="margin:0; font-size:1.1rem; color:${textColor}; text-shadow: ${textColor === '#fff' ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'};">${f}</h3>
                 <span style="background:rgba(0,0,0,0.3); color:#fff; padding:4px 12px; border-radius:20px; font-weight:bold; font-size:0.8rem;">${items.length} Envío(s)</span>
              </div>
              <div style="overflow-x:auto;">
                  <table style="width:100%; text-align:left; border-collapse:collapse; white-space: nowrap; min-width:850px;">
                  <thead style="opacity: 0.5; font-size: 0.7rem; background:rgba(0,0,0,0.2);">
                      <tr>
                        <th style="padding:15px 20px;">${th1}</th>
                        <th style="padding:15px 20px;">CLIENTE / VENTA</th>
                        <th style="padding:15px 20px;">${th3}</th>
                        <th style="padding:15px 20px;">${th4}</th>
                        ${(window.auth?.isAdmin() || window.auth?.getUserRole() === 'gerente' || window.auth?.getUserRole() === 'finanzas') ? `<th style="padding:15px 20px;">ENVÍO INT.</th>` : ''}
                        <th style="padding:15px 20px; text-align:right;">ACCIÓN</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${items.length > 0 ? items.map(c => {
                          const ventaAsoc = !ventas.error ? ventas.find(v => v.id.toString() === c.venta_id?.toString()) : null;
                          const cliInfo = ventaAsoc && !clientes.error ? clientes.find(cl => cl.id.toString() === ventaAsoc.cliente_id?.toString()) : null;
                          const nombreCli = cliInfo ? cliInfo.nombre : (c.venta_id ? 'Venta Vacia' : '-');
                          const compraAsoc = !compras.error ? compras.find(cmp => cmp.id.toString() === c.compra_id?.toString() || (c.venta_id && cmp.venta_id?.toString() === c.venta_id?.toString())) : null;
                          const prodAsoc = ventaAsoc && productos && !productos.error ? productos.find(p => p.id.toString() === ventaAsoc.producto_id?.toString()) : null;
                          let td1 = '-'; let td3 = '-'; let td4 = '-';
                          if (i === 0) {
                              td1 = `<strong style="font-family:monospace; font-size:1.0rem; color:var(--info-blue); display:inline-block; margin-bottom:4px;">Orden: ${compraAsoc ? compraAsoc.numero_orden || 'S/N' : '-'}</strong><br><span style="font-size:0.75rem; opacity:0.6;">Ult. Act: ${c.fecha_actualizacion ? c.fecha_actualizacion.split('T')[0] : '-'}</span>`;
                              td3 = `<strong>${compraAsoc ? compraAsoc.proveedor || '-' : '-'}</strong><br><div style="margin-top:4px;">${compraAsoc?.url_orden ? `<a href="${compraAsoc.url_orden}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Ver Tienda]</a>` : ''}</div>`;
                              td4 = c.ubicacion || '-';
                          } else if (i === 1 || i === 2) {
                              let arrivalHtml = `<div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8;">Est: <strong>${c.usa_fecha_estimada || '?'}</strong></span></div>`;
                              if (i === 2 && c.usa_bodega_fecha) {
                                  arrivalHtml += `<div style="margin-top:4px;"><span style="font-size:0.75rem; color:var(--success-green); font-weight:bold; background:rgba(6,214,160,0.1); padding:2px 6px; border-radius:4px;">Fecha Real: ${c.usa_bodega_fecha}</span></div>`;
                              }
                              td1 = `<strong style="color:var(--primary-red); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.usa_guia || 'Pendiente'}</strong><br><span style="font-size:0.75rem; opacity:0.8;">Envío: <strong>${c.usa_fecha_envio || '?'}</strong></span>${arrivalHtml}`;
                              td3 = `<strong>${c.usa_empresa || 'S/N'}</strong><br><div style="margin-top:4px;">${c.usa_url ? `<a href="${c.usa_url}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Rastrear]</a>` : ''}</div>`;
                              td4 = c.usa_bodega_nom || 'Por Asignar (USA)';
                          } else if (i === 3) {
                              td1 = `<strong style="color:var(--info-blue); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.int_guia || c.id_seguimiento_internacional || 'Pendiente'}</strong>`;
                              td3 = `<strong>${c.paqueteria || 'S/N'}</strong><br><div style="margin-top:4px;">${c.int_url ? `<a href="${c.int_url}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Rastrear]</a>` : ''}</div>`;
                              td4 = `<span style="font-size:0.75rem; opacity:0.8;">Recibido en USA: <strong>${c.usa_bodega_fecha || 'Pendiente'}</strong></span><br><div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8; color:var(--info-blue);">Despachado a COL: <strong>${c.int_fecha_envio || 'Pendiente'}</strong></span></div>`;
                          } else if (i === 4) {
                              const notificado = c.cliente_notificado === 'Sí';
                              let badgeHtml = notificado ? `<span style="background:rgba(6,214,160,0.1); color:var(--success-green); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(6,214,160,0.2);">✅ Cliente Informado</span>` : `<span style="background:rgba(230,57,70,0.1); color:var(--primary-red); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(230,57,70,0.2);">⚠️ No Notificado</span>`;
                              let contactHtml = '';
                              if (cliInfo) {
                                  const tel = cliInfo.telefono || cliInfo.whatsapp || '';
                                  if (tel) {
                                      const num = tel.replace(/\D/g,'');
                                      contactHtml = `<br><div style="margin-top:8px; font-size:0.8rem; opacity:0.8;">📞 Wa/Tel: <strong>${tel}</strong> <a href="https://wa.me/57${num}" target="_blank" style="text-decoration:none; margin-left:3px;" title="Abrir Chat WA">💬</a></div>`;
                                  }
                              }
                              td1 = `<strong style="font-size:1rem; display:inline-block; color:var(--info-blue);">${c.col_bodega_fecha || 'Pendiente Ingreso'}</strong>`;
                              td3 = badgeHtml + contactHtml;
                              td4 = prodAsoc ? `<strong style="font-size:0.9rem;">${prodAsoc.nombre_producto}</strong>` : 'Sin producto';
                          } else if (i === 5) {
                              td1 = `<strong style="color:var(--success-green); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.cli_guia || 'Pendiente'}</strong><br><div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8;">Envío: <strong>${c.cli_fecha_envio || '?'}</strong></span></div>`;
                              let estadoBadge = c.cli_estado_entrega === 'Recibido' ? `<span style="background:rgba(6,214,160,0.1); color:var(--success-green); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(6,214,160,0.2);">✅ Recibido</span>` : `<span style="background:rgba(255,190,11,0.1); color:var(--warning-orange); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(255,190,11,0.2);">🚚 En Tránsito Local</span>`;
                              td3 = `${estadoBadge}<br><div style="margin-top:10px; font-size:0.8rem;"><strong>${c.cli_empresa || 'S/N'}</strong></div>`;
                              td4 = `<strong style="color:var(--info-blue); font-size:0.9rem;">${nombreCli}</strong>`;
                          }
                          let ultimaNota = '';
                          try {
                              if (c.historial) {
                                  let histArr = typeof c.historial === 'string' ? JSON.parse(c.historial) : c.historial;
                                  if (histArr.length > 0) ultimaNota = histArr[histArr.length - 1].notas || '';
                              }
                          } catch(e) {}
                          const searchStr = `${c.id_seguimiento_internacional || ''} ${nombreCli} ${td1} ${td3} ${td4}`.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                          const safeSearchStr = searchStr.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                          return `
                              <tr class="log-row" data-text="${safeSearchStr}">
                                <td style="padding:15px 20px;">${td1}</td>
                                <td style="padding:15px 20px;">
                                    <strong style="color:var(--warning-orange);">${nombreCli}</strong><br>
                                    <span style="font-size:0.7rem; opacity:0.6;">Venta #${c.venta_id ? c.venta_id.toString().slice(-4) : '-'}</span>
                                    ${ultimaNota ? `<div style="font-size:0.75rem; opacity:0.7; font-style:italic; margin-top:4px; max-width:150px; overflow:hidden; text-overflow:ellipsis;">💬 ${ultimaNota}</div>` : ''}
                                </td>
                                <td style="padding:15px 20px;">${td3}</td>
                                <td style="padding:15px 20px;">${td4}</td>
                                ${(window.auth?.isAdmin() || window.auth?.getUserRole() === 'gerente' || window.auth?.getUserRole() === 'finanzas') ? `
                                <td style="padding:15px 20px; color:#FFB703; font-weight:700;">${ventaAsoc && ventaAsoc.valor_envio_internacional ? formatCOP(ventaAsoc.valor_envio_internacional) : '$0'}</td>
                                ` : ''}
                                <td style="padding:15px 20px; text-align:right;">
                                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                                        <button class="btn-action" onclick="window.modalDetalleLogistica('${c.id}')">👁️</button>
                                        ${auth.canEdit('logistics') ? `<button class="btn-action" onclick="window.modalLogistica('${c.id}')">✏️</button>` : ''}
                                    </div>
                                </td>
                              </tr>
                          `;
                      }).join('') : `<tr><td colspan="6" style="text-align:center; padding:2rem;">No hay datos.</td></tr>`}
                  </tbody>
                  </table>
              </div>
          </div>
          `;
      }).join('')}
      </div>
      `}
      ${_logActiveTab === 'general' ? renderPagination(filteredList.length, _page, _rpp, 'logistics') : ''}
    `;
    renderLayout(html);
    if(window.lucide) window.lucide.createIcons();

    window.modalDetalleLogistica = async (id) => {
        const item = reversedList.find(i => i.id.toString() === id.toString());
        if (!item) return;
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        
        const compraRef = !compras.error ? compras.find(cmp => cmp.id.toString() === item.compra_id?.toString() || (item.venta_id && cmp.venta_id?.toString() === item.venta_id?.toString())) : null;
        const ventaAsoc = (!ventas.error && item.venta_id) ? ventas.find(v => v.id.toString() === item.venta_id.toString()) : null;
        
        let pFechaVenta = '';
        if (ventaAsoc && ventaAsoc.fecha) {
            let dateStr = String(ventaAsoc.fecha).split(' ')[0];
            pFechaVenta = `
                  <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); grid-column: span 2;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">🤝</i>Fecha de Venta Original</span><br>
                      <strong>${dateStr}</strong>
                  </div>
            `;
        }
        
        let compraBoxHtml = '';
        if (compraRef || pFechaVenta) {
            compraBoxHtml = `
            <div style="background:var(--glass-hover); border:1px solid var(--glass-border); padding:1.5rem; border-radius:12px; margin-bottom:2rem;">
               <h3 style="margin:0 0 15px 0; font-size:1.1rem; color:var(--text-main); text-transform:uppercase; letter-spacing:1px;"><span style="color:var(--info-blue);">🛍️</span> Detalles de la Compra</h3>
               <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; font-size:0.9rem;">
                  ${pFechaVenta}
                  <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">📅</i>Fecha Compra Tienda</span><br>
                      <strong>${compraRef?.fecha_pedido || 'N/A'}</strong>
                  </div>
                  <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">🏪</i>Tienda Proveedor</span><br>
                      <strong>${compraRef?.proveedor || 'N/A'}</strong>
                  </div>
                  <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">📦</i>Orden Confirmación</span><br>
                      <strong style="color:var(--info-blue); font-family:monospace; font-size:1rem;">${compraRef?.numero_orden || 'S/N'}</strong>
                  </div>
                  ${(ventaAsoc && (window.auth?.isAdmin() || window.auth?.getUserRole() === 'gerente' || window.auth?.getUserRole() === 'finanzas')) ? `
                  <div style="background:rgba(255,183,3,0.1); padding:10px; border-radius:8px; border:1px solid rgba(255,183,3,0.2);">
                      <span style="color:#FFB703; font-weight:bold;"><i style="font-style:normal; margin-right:5px;">✈️</i>Envío Internacional</span><br>
                      <strong style="color:#FFB703;">${formatCOP(ventaAsoc.valor_envio_internacional || 0)}</strong>
                  </div>
                  ` : ''}
               </div>
            </div>`;
        }

        let histArr = [];
        if (item.historial) { try { histArr = JSON.parse(item.historial); } catch(e){} }
        
        let timelineHtml = histArr.map((h, idx) => `
            <div style="position:relative; padding-left:25px; margin-bottom:15px;">
                <div style="position:absolute; left:0; top:5px; width:10px; height:10px; border-radius:50%; background:var(--primary-red);"></div>
                <div style="position:absolute; left:4px; top:15px; width:2px; height:calc(100% + 15px); background:var(--glass-border);"></div>
                <strong style="font-size:0.9rem;">${h.fase}</strong><br>
                <span style="opacity:0.5; font-size:0.75rem;">${h.fecha}</span>
                ${h.notas ? `<p style="margin:5px 0 0; font-size:0.8rem; opacity:0.8;">${h.notas}</p>` : ''}
            </div>
        `).join('') || '<p style="opacity:0.5;">Sin historial de cambios.</p>';

        content.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Historial Logístico</h2>
                    <button class="modal-close" onclick="window.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${compraBoxHtml}
                    <h3 style="margin-bottom:15px; font-size:1.1rem;">Cronología</h3>
                    ${timelineHtml}
                </div>
                <div class="modal-footer">
                   <button type="button" class="btn-primary" onclick="window.closeModal()">Cerrar</button>
                </div>
            </div>
        `;
        container.style.display = 'flex';
    };
};

export const createLogisticsModal = async (id, navigateTo) => {
    let mode = id ? 'UPDATE' : 'INSERT';
    let data = { venta_id: '', id_seguimiento_internacional: '', paqueteria: '', fase: '1. Comprado (Esperando Tracking Local USA)', ubicacion: 'USA', historial: '[]' };
    
    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');

    content.innerHTML = `<div style="text-align:center; padding:2rem;"><div class="loader"></div> Preparando formulario...</div>`;
    container.style.display = 'flex';

    const [logisticaData, ventas, productos, clientes, conf, comprasData] = await Promise.all([
        db.fetchData('Logistica'),
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Clientes'),
        db.fetchData('Configuracion'),
        db.fetchData('Compras')
    ]);
    
    const list = Array.isArray(logisticaData) ? logisticaData : [];
    if (id) {
        const target = list.find(it => it.id.toString() === id.toString());
        if (target) data = { ...target };
    }
    
    const itemsInUSA = list.filter(it => it.fase && it.fase.includes('3.') && it.id.toString() !== data.id?.toString());
    
    const comprasList = comprasData.error ? [] : comprasData;
    
    const paramsList = conf.error ? [] : conf;
    const transpUSA = paramsList.filter(p => p.clave === 'TranspUSA');
    const transpCOL = paramsList.filter(p => p.clave === 'TranspCOL');
    const bodegasUSA = paramsList.filter(p => p.clave === 'BodegaUSA');

    const FASES_ALL = [
        "1. Comprado (Esperando Tracking Local USA)",
        "2. En Tránsito (Tienda -> Bodega USA)",
        "3. En Bodega USA (Estados Unidos)",
        "4. Tránsito Internacional / Aduana",
        "5. En Bodega Colombia",
        "6. Entregado a Cliente Final"
    ];

    let currentIdx = 0;
    if (data.fase) {
        currentIdx = FASES_ALL.findIndex(f => data.fase.includes(f.substring(0, 3)));
        if (currentIdx === -1) currentIdx = 0;
    }

    const currentFaseStr = FASES_ALL[currentIdx];
    const nextFaseStr = currentIdx < FASES_ALL.length - 1 ? FASES_ALL[currentIdx + 1] : null;

    let selectOptionsHtml = `<option value="${currentFaseStr}" selected>Mantener: ${currentFaseStr}</option>`;
    if (nextFaseStr) {
        selectOptionsHtml += `<option value="${nextFaseStr}">Avanzar: ${nextFaseStr}</option>`;
    }

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <h2>${id ? 'Actualizar Seguimiento Logístico' : 'Registrar Nuevo Envío'}</h2>
                <button class="modal-close-btn" onclick="window.closeModal()">✕</button>
            </div>
            
            <form id="form-tracking">
                <div class="modal-body">
                    <!-- Sección de Asociación -->
                    <div class="form-grid-2" style="margin-bottom: 2rem; border-bottom: 1px dashed var(--border-base); padding-bottom: 2rem;">
                        <div class="form-group">
                            <label class="form-label">Vincular a Orden de Venta (Opcional)</label>
                            <select name="venta_id" id="log-venta-select">
                                <option value="">-- Sin Vincular --</option>
                                ${!(ventas.error) ? ventas.reverse().map(v => `<option value="${v.id}" ${data.venta_id == v.id ? 'selected' : ''}>Orden #${v.id} - ${v.fecha || 'Sin fecha'}</option>`).join('') : ''}
                            </select>
                        </div>
                        <div id="log-preview-box" style="display:none;"></div>
                    </div>

                    <div class="form-grid-3">
                        <div class="form-group full-width" style="grid-column: span 3; background:var(--brand-magenta-dim); padding:1.5rem; border-radius:16px;">
                            <label class="form-label" style="color:var(--brand-magenta); font-weight:800; font-size:0.95rem;">Estado de Avance Logístico</label>
                            <select name="fase" id="log-fase-select" style="font-size:1.1rem; font-weight:800; color: var(--brand-magenta); border-color: var(--brand-magenta);">
                                ${selectOptionsHtml}
                                ${currentIdx === 0 ? `<option value="${FASES_ALL[2]}" id="opt-jump-step-3" style="display:none;">Avanzar: ${FASES_ALL[2]} (Salto a Bodega)</option>` : ''}
                            </select>
                        </div>

                        ${currentIdx === 0 ? `
                        <div class="form-group full-width" style="grid-column: span 3; display:flex; flex-direction:row; align-items:center; gap:15px; padding: 0.5rem 1rem;">
                            <input type="checkbox" id="chk-viaje-encargos" name="comprado_viaje_encargos" ${data.comprado_viaje_encargos ? 'checked' : ''} style="width:22px; height:22px; cursor:pointer;"
                                onchange="
                                    const opt = document.getElementById('opt-jump-step-3');
                                    if(opt) opt.style.display = this.checked ? '' : 'none';
                                    if(this.checked) {
                                        document.getElementById('log-fase-select').value = '${FASES_ALL[2]}';
                                        window._applyLogDynamicFields && window._applyLogDynamicFields();
                                    }
                                ">
                            <label for="chk-viaje-encargos" style="font-weight:700; color:#D97706; cursor:pointer; margin:0; text-transform:none; font-size:0.9rem;">Comprado en viaje de encargos (EEUU) - Omitir Paso 2</label>
                        </div>` : ''}
                    </div>

                <div class="modal-section-divider" style="height:1px; background:var(--border-base); margin:2rem 0;"></div>
                
                <div id="fase-b12" style="display:none; margin-top: 1rem;">
                    <h3 style="font-size:0.95rem; color:var(--brand-magenta); margin-bottom:1.5rem; text-transform:uppercase; letter-spacing:1px; font-weight:800;">📦 Tracking Origen -> Estados Unidos</h3>
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Guía Tienda (USA)</label>
                            <input type="text" name="usa_guia" value="${data.usa_guia || ''}" placeholder="Número de tracking">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Empresa Transporte USA</label>
                            <select name="usa_empresa">
                                <option value="">-- Seleccionar --</option>
                                ${transpUSA.map(t => `<option value="${t.valor}" ${data.usa_empresa === t.valor ? 'selected' : ''}>${t.valor}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group" style="grid-column: span 3;">
                            <label class="form-label">URL Tracking USA</label>
                            <input type="url" name="usa_url" value="${data.usa_url || ''}" placeholder="https://www.fedex.com/tracking/...">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha de Envío USA</label>
                            <input type="date" name="usa_fecha_envio" value="${data.usa_fecha_envio || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha Estimada Llegada</label>
                            <input type="date" name="usa_fecha_estimada" value="${data.usa_fecha_estimada || ''}">
                        </div>
                    </div>
                </div>

                <!-- BLOQUE 3: Bodega EEUU -->
                <div id="fase-b3" style="display:none; margin-top: 1rem;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--text-main);">
                        <span>🏢</span>
                        <h3 style="margin:0; font-size:0.85rem; color:var(--text-main); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Recepción en Bodega EEUU</h3>
                    </div>
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Fecha Arribo EEUU</label>
                            <input type="date" name="usa_bodega_fecha" value="${data.usa_bodega_fecha || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Nombre de la Bodega (EEUU)</label>
                            <select name="usa_bodega_nom">
                                <option value="">-- Seleccionar Bodega --</option>
                                ${bodegasUSA.map(b => `<option value="${b.valor}" ${data.usa_bodega_nom === b.valor ? 'selected' : ''}>${b.valor}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group full-width" style="grid-column: span 3;">
                            <label class="form-label">Foto Paquete EEUU (Opcional)</label>
                            <div style="display:flex; gap:15px; align-items:center; background:var(--surface-1); padding:1rem; border-radius:12px; border:1px solid var(--border-base);">
                                <div style="width:70px; height:70px; border-radius:10px; overflow:hidden; background:var(--bg-main); border:1px solid var(--border-base); display:flex; justify-content:center; align-items:center; flex-shrink:0;">
                                    <img id="usa-preview" src="${data.usa_bodega_foto || ''}" style="${data.usa_bodega_foto ? 'width:100%; height:100%; object-fit:cover;' : 'display:none;'}">
                                    <span id="usa-ph" style="font-size:0.6rem; opacity:0.4; text-align:center; ${data.usa_bodega_foto ? 'display:none;' : ''}">FOTO</span>
                                </div>
                                <div style="flex:1;">
                                    <input type="file" id="usa-foto-input" accept="image/*" style="font-size:0.8rem; border:none; background:transparent; padding:0;">
                                    <input type="hidden" name="usa_bodega_foto" value="${data.usa_bodega_foto || ''}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- BLOQUE 4: Tránsito Internacional -->
                <div id="fase-b4" style="display:none; margin-top: 1rem;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--info);">
                        <span>✈️</span>
                        <h3 style="margin:0; font-size:0.85rem; color:var(--info); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Envío Internacional (USA → COL)</h3>
                    </div>
                    
                    <div id="log-consolidation-box" style="margin-bottom:1.5rem;">
                        ${(!id && Array.isArray(logisticaData)) ? `
                            <div style="padding:1rem; background:rgba(37,99,235,0.05); border:1px dashed var(--info); border-radius:12px;">
                                <label style="font-weight:800; font-size:0.85rem; color:var(--info); margin-bottom:10px; display:block;">📦 Consolidar con otros envíos en Bodega EEUU</label>
                                ${logisticaData.filter(it => it.fase && it.fase.includes('3.')).map(it => {
                                    const v = ventas.find(vnt => vnt.id.toString() === it.venta_id?.toString());
                                    const p = v ? productos.find(prd => prd.id.toString() === v.producto_id?.toString()) : null;
                                    return `
                                        <label style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-base); cursor:pointer; font-size:0.82rem;">
                                            <input type="checkbox" name="consolidate_ids" value="${it.id}" style="width:18px; height:18px;">
                                            <span>${p?.nombre_producto || 'Producto Stock'} <span style="opacity:0.5;">(Orden #${it.venta_id?.toString().slice(-4) || '-'})</span></span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Fecha Despacho Hacia COL</label>
                            <input type="date" name="int_fecha_envio" value="${data.int_fecha_envio || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Guía Consolidada (Int)</label>
                            <input type="text" name="int_guia" value="${data.int_guia || data.id_seguimiento_internacional || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Courier Internacional</label>
                            <input type="text" name="paq" value="${data.paqueteria || ''}">
                        </div>
                        <div class="form-group" style="grid-column: span 3;">
                            <label class="form-label">URL Tracking Int.</label>
                            <input type="url" name="int_url" value="${data.int_url || ''}" placeholder="https://...">
                        </div>
                    </div>
                </div>
                
                <!-- BLOQUE 5: Bodega Colombia -->
                <div id="fase-b5" style="display:none; margin-top: 1rem;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--success-green);">
                        <span>🇨🇴</span>
                        <h3 style="margin:0; font-size:0.85rem; color:var(--success-green); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Recepción en Bodega Colombia</h3>
                    </div>
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Fecha Arribo COL</label>
                            <input type="date" name="col_bodega_fecha" value="${data.col_bodega_fecha || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Notificación Cliente</label>
                            <select name="cliente_notificado">
                                <option value="No" ${data.cliente_notificado === 'No' || !data.cliente_notificado ? 'selected' : ''}>Pendiente notificación</option>
                                <option value="Sí" ${data.cliente_notificado === 'Sí' ? 'selected' : ''}>Cliente informado ✅</option>
                            </select>
                        </div>
                        <div class="form-group full-width" id="fase5-action-board" style="display:none; grid-column: span 3; padding:1.2rem; border-radius:12px; border:1px solid var(--info);"></div>
                        
                        <div class="form-group full-width" style="grid-column: span 3;">
                            <label class="form-label">Foto Arribo (Opcional)</label>
                            <div style="display:flex; gap:15px; align-items:center; background:var(--surface-1); padding:1rem; border-radius:12px; border:1px solid var(--border-base);">
                                <div style="width:70px; height:70px; border-radius:10px; overflow:hidden; background:var(--bg-main); border:1px solid var(--border-base); display:flex; justify-content:center; align-items:center; flex-shrink:0;">
                                    <img id="col-preview" src="${data.col_bodega_foto || ''}" style="${data.col_bodega_foto ? 'width:100%; height:100%; object-fit:cover;' : 'display:none;'}">
                                    <span id="col-ph" style="font-size:0.6rem; opacity:0.4; text-align:center; ${data.col_bodega_foto ? 'display:none;' : ''}">FOTO</span>
                                </div>
                                <div style="flex:1;">
                                    <input type="file" id="col-foto-input" accept="image/*" style="font-size:0.8rem; border:none; background:transparent; padding:0;">
                                    <input type="hidden" name="col_bodega_foto" value="${data.col_bodega_foto || ''}">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- BLOQUE 6: Entregado Cliente Final -->
                <div id="fase-b6" style="display:none; margin-top: 1rem;">
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:1.5rem; padding:0.8rem 1.2rem; background:var(--surface-1); border-radius:12px; border-left:4px solid var(--success-green);">
                        <span>🚚</span>
                        <h3 style="margin:0; font-size:0.85rem; color:var(--success-green); text-transform:uppercase; letter-spacing:1px; font-weight:800;">Despacho Nacional a Cliente</h3>
                    </div>
                    <div class="form-grid-3">
                        <div class="form-group">
                            <label class="form-label">Transportadora COL</label>
                            <select name="cli_empresa">
                                <option value="">-- Seleccionar --</option>
                                ${transpCOL.map(t => `<option value="${t.valor}" ${data.cli_empresa === t.valor ? 'selected' : ''}>${t.valor}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Guía Nacional</label>
                            <input type="text" name="cli_guia" value="${data.cli_guia || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha Envío Local</label>
                            <input type="date" name="cli_fecha_envio" value="${data.cli_fecha_envio || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Valor Envío Local (COP) *</label>
                            <input type="number" name="valor_envio_interno_colombia" value="${data.valor_envio_interno_colombia || ''}" required placeholder="0">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Estado de Recepción</label>
                            <select name="cli_estado_entrega">
                                <option value="En Tránsito" ${data.cli_estado_entrega === 'En Tránsito' || !data.cli_estado_entrega ? 'selected' : ''}>🚚 En Tránsito Local</option>
                                <option value="Recibido" ${data.cli_estado_entrega === 'Recibido' ? 'selected' : ''}>✅ Entregado al Cliente Final</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha Recibido</label>
                            <input type="date" name="cli_fecha_recibido" value="${data.cli_fecha_recibido || ''}">
                        </div>
                        <div class="form-group full-width" style="grid-column: span 3;">
                            <label class="form-label">URL Tracking Local</label>
                            <input type="url" name="cli_url" value="${data.cli_url || ''}" placeholder="https://...">
                        </div>
                    </div>
                </div>
                
                <div class="modal-section-divider" style="height:1px; background:var(--border-base); margin:2rem 0;"></div>

                <div class="form-grid">
                    <div class="form-group full-width">
                        <label class="form-label">Añadir Nota / Comentario al Historial</label>
                        <input type="text" name="notas_fase" value="" placeholder="Opcional. Breve novedad en este estado.">
                    </div>
                    <div style="display:none;"><input type="text" name="ubi" value="${data.ubicacion}"></div>
                    <input type="hidden" name="id_seguimiento_internacional" value="${data.id_seguimiento_internacional || ''}">
                </div>

                <div id="form-error" style="display:none; color:var(--primary-red); background:var(--brand-magenta-dim); padding:1rem; border-radius:12px; margin-top:1.5rem; text-align:center; font-weight:700;"></div>
            </div>

            <div class="modal-footer">
                <button type="button" class="btn-action" style="padding:10px 25px;" onclick="window.closeModal()">Cerrar</button>
                <button type="submit" id="btn-save-log" class="btn-primary" style="padding:10px 30px;">
                    ${id ? 'Actualizar Información' : 'Registrar Logística'}
                </button>
            </div>
        </form>
    </div>`;
    
    container.style.display = 'flex';
    
    // UI logic for form dynamic display
    const applyDynamicFields = () => {
        const fsel = document.getElementById('log-fase-select');
        if(!fsel) return;
        const val = fsel.value;
        const isViajeEncargos = document.getElementById('chk-viaje-encargos')?.checked;

        // Hide all initially
        ['fase-b12', 'fase-b3', 'fase-b4', 'fase-b5', 'fase-b6'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });

        if(val.includes('1.') || val.includes('2.')) {
            document.getElementById('fase-b12').style.display = 'block';
        } else if (val.includes('3.')) {
            // Viaje de encargos: omite tracking tienda→bodega (fase-b12),
            // pero SÍ muestra recepción en Bodega EEUU (fase-b3)
            if (isViajeEncargos) {
                document.getElementById('fase-b12').style.display = 'none';
                document.getElementById('fase-b3').style.display = 'block';
            } else {
                document.getElementById('fase-b12').style.display = 'block';
                document.getElementById('fase-b3').style.display = 'block';
            }
        } else if (val.includes('4.')) {
            document.getElementById('fase-b4').style.display = 'block';
            if (data.fase?.includes('3.') || mode === 'INSERT' || isViajeEncargos) {
                const czone = document.getElementById('consolidation-zone');
                if(czone) czone.style.display = 'block';
            }
        } else if (val.includes('5.')) {
            document.getElementById('fase-b4').style.display = 'block';
            document.getElementById('fase-b5').style.display = 'block';
        } else if (val.includes('6.')) {
            document.getElementById('fase-b6').style.display = 'block';
        }
    };

    const fsel = document.getElementById('log-fase-select');
    // expose for checkbox onchange
    window._applyLogDynamicFields = applyDynamicFields;
    if (fsel) { fsel.addEventListener('change', applyDynamicFields); applyDynamicFields(); }
    // Also listen to checkbox in case it was pre-checked on load
    const chkViaje = document.getElementById('chk-viaje-encargos');
    if (chkViaje) chkViaje.addEventListener('change', applyDynamicFields);

    // Dynamic Product Preview logic
    const updateLogPreview = () => {
        const select = document.getElementById('log-venta-select');
        const previewBox = document.getElementById('log-preview-box');
        if (!select || !previewBox) return;
        const currentVId = select.value;
        if (!currentVId) { previewBox.style.display = 'none'; return; }

        const vData = ventas.find(v => v.id.toString() === currentVId.toString());
        if (!vData) return;
        
        const pData = productos.find(p => p.id.toString() === vData.producto_id?.toString()) || {};
        const cData = clientes.find(c => c.id.toString() === vData.cliente_id?.toString()) || {};
        const cmpData = comprasList.find(cmp => cmp.venta_id?.toString() === currentVId.toString()) || {};

        const imageUrl = pData.url_imagen || '';
        const clientName = cData.nombre || 'Cliente Desconocido';
        const fechaCorta = vData.fecha ? String(vData.fecha).split('T')[0].split(' ')[0] : 'N/A';

        previewBox.innerHTML = `
           <div style="display:flex; gap:15px; align-items:center; background:rgba(255,255,255,0.03); padding:1rem; border-radius:12px; border:1px solid var(--glass-border);">
               <div style="width:70px; height:70px; border-radius:8px; overflow:hidden; flex-shrink:0; background:var(--input-bg); display:flex; align-items:center; justify-content:center;">
                   ${imageUrl ? `<img src="${imageUrl}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="opacity:0.4; font-size:0.6rem; text-align:center;">SIN<br>FOTO</span>'}
               </div>
               <div style="flex:1;">
                   <div style="font-weight:700; font-size:1rem; color:var(--text-main);">${pData.nombre_producto || 'Producto Stock General'}</div>
                   <div style="display:flex; gap:8px; align-items:center; margin-top:4px; font-size:0.75rem;">
                       <span style="opacity:0.7;">Tienda/Distribuidor: <strong>${pData.tienda_cotizacion || pData.marca || 'N/A'}</strong></span>
                       ${pData.talla ? `<span style="background:var(--primary-red); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Talla: ${pData.talla} ${pData.genero ? `(${pData.genero})` : ''}</span>` : ''}
                   </div>
                   <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px; font-size:0.75rem;">
                       <div><span style="opacity:0.6;">Destinatario Final:</span><br><strong style="color:var(--info-blue);">${clientName}</strong></div>
                       <div><span style="opacity:0.6;">Orden Asignada (${cmpData?.proveedor || ''}):</span><br><strong>${cmpData?.numero_orden || 'Sin Orden Cargada'}</strong> ${cmpData?.url_orden ? `<a href="${cmpData.url_orden}" target="_blank" style="color:var(--success-green); text-decoration:none;">🔗</a>` : ''}</div>
                   </div>
                   ${(auth.isAdmin() || auth.getUserRole() === 'gerente' || auth.getUserRole() === 'finanzas') ? `
                   <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--glass-border); font-size:0.75rem;">
                        <span style="opacity:0.6;">✈️ Costo Envío Internacional:</span> <strong style="color:#FFB703;">${formatCOP(vData.valor_envio_internacional || 0)}</strong>
                        <span style="opacity:0.4; font-size:0.65rem; margin-left:5px;">(${vData.peso_producto || 0} Lbs × USD Rate × ${formatCOP(vData.trm_cotizada || 0)})</span>
                   </div>
                   ` : ''}
               </div>
           </div>
        `;
        previewBox.style.display = 'block';

        const actionBoard = document.getElementById('fase5-action-board');
        if (actionBoard) {
            const telefonoNum = (cData.telefono || cData.whatsapp || '').replace(/\D/g, '');
            const whatsappLink = telefonoNum ? `https://wa.me/57${telefonoNum}` : '#';
            const goBackStr = id ? `window.modalLogistica(\\'${id}\\')` : `window.modalLogistica()`;

            const saldoVal = parseInt(vData.saldo_pendiente || "0", 10);
            const isPaid = saldoVal <= 0;
            const saldoHtml = isPaid 
                ? `<div style="margin-top:10px; padding:6px 10px; background:rgba(6,214,160,0.1); border:1px solid var(--success-green); border-radius:8px; display:inline-block; font-size:0.8rem; font-weight:bold; color:var(--success-green);">✅ Cliente está al día ($0)</div>`
                : `<div style="margin-top:10px; padding:6px 10px; background:rgba(230,57,70,0.1); border:1px solid var(--primary-red); border-radius:8px; display:inline-block; font-size:0.8rem; font-weight:bold; color:var(--primary-red);">⚠️ Saldo en Mora: $${saldoVal.toLocaleString('es-CO')} COP</div>`;

            actionBoard.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <h4 style="margin:0 0 5px 0; color:var(--info-blue); font-size:0.95rem;">Datos de Entrega / Contacto</h4>
                        <div style="font-size:0.85rem;"><strong>Cliente:</strong> ${clientName}</div>
                        <div style="font-size:0.85rem; margin-top:3px;">
                            <strong>WhatsApp/Tel:</strong> ${cData.telefono || cData.whatsapp || 'No registrado'}
                            ${telefonoNum ? `<a href="${whatsappLink}" target="_blank" style="margin-left:5px; color:var(--success-green); text-decoration:none; font-weight:bold;">[💬 WA]</a>` : ''}
                        </div>
                        ${saldoHtml}
                    </div>
                    <div style="text-align:right;">
                        <button type="button" class="btn-action" onclick="window.modalDetalleVentaGlobal('${currentVId}', '${goBackStr}');" style="padding:10px 15px; font-weight:700;">🛍️ Ir a Orden Venta</button>
                    </div>
                </div>
            `;
            actionBoard.style.display = 'block';
        }
    };

    setTimeout(() => {
        const select = document.getElementById('log-venta-select');
        if (select) {
            select.addEventListener('change', updateLogPreview);
            updateLogPreview(); // Init on load to show current selected
        }

        const setupPhotoPreview = (idInput, idPreview, idPh) => {
            const input = document.getElementById(idInput);
            const img = document.getElementById(idPreview);
            const ph = document.getElementById(idPh);
            if (input && img && ph) {
                input.addEventListener('change', () => {
                    const file = input.files[0];
                    if (file) {
                        img.src = URL.createObjectURL(file);
                        img.style.display = 'block';
                        ph.style.display = 'none';
                    }
                });
            }
        };
        setupPhotoPreview('usa-foto-input', 'usa-preview', 'usa-ph');
        setupPhotoPreview('col-foto-input', 'col-preview', 'col-ph');
    }, 150);

    document.getElementById('form-crud').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const nuevaFase = fd.get('fase');
        const vIdCheck = fd.get('venta_id') || data.venta_id || '';

        // REGLA DE NEGOCIO: Prohibir paso 6 si hay saldo pendiente
        if (nuevaFase && nuevaFase.startsWith('6. ') && vIdCheck && Array.isArray(ventas)) {
            const vRel = ventas.find(v => v.id.toString() === vIdCheck.toString());
            if (vRel) {
                const saldoVal = parseInt(vRel.saldo_pendiente || "0", 10);
                if (saldoVal > 0) {
                    await window.customAlert('ALERTA DE RECAUDO', `No puedes avanzar este envío a la fase "6. Entregado a Cliente Final" porque hay un saldo pendiente por cobrar de $${saldoVal.toLocaleString('es-CO')} COP.\n\nDebes ir primero a la Orden de Venta y asentar el pago para que el saldo quede en $0 antes de entregar el producto.`, 'warning');
                    return; // Stop form submission
                }
            }
        }
        
        let histArr = [];
        if (data.historial) {
            try { histArr = JSON.parse(data.historial); } catch(e){}
        }

        // Si cambió la fase, es un registro nuevo, o si el usuario escribió una nota, registramos en historial
        const notaFaseForm = (fd.get('notas_fase') || '').trim();
        if (nuevaFase !== data.fase || mode === 'INSERT' || notaFaseForm !== '') {
            const fechaAhora = new Date().toLocaleString('es-CO');
            histArr.push({
                fase: nuevaFase,
                fecha: fechaAhora,
                notas: notaFaseForm
            });
        }
        
        // Hacemos spread del objeto original anterior, pero sobreescribimos TODO
        // Para que los inputs escondidos que devuelven "" no borren info, comprobamos
        const extractFD = (key) => {
           let val = fd.get(key) || '';
           if (!val && data[key]) val = data[key]; // Keep original if submitted empty!
           return val;
        };

        const payload = { ...data }; // Conservar TODO lo antiguo.
        payload.id = id || Date.now().toString();
        payload.venta_id = extractFD('venta_id') || null;
        payload.fase = nuevaFase;
        payload.historial = JSON.stringify(histArr);
        payload.fecha_actualizacion = new Date().toISOString();
        
        // Asignar los fields mapeados, priorizando el formulario si no está vacio
        const fields = ['usa_guia','usa_empresa','usa_url','usa_fecha_envio','usa_fecha_estimada',
            'usa_bodega_nom','usa_bodega_fecha','usa_bodega_foto',
            'int_fecha_envio','int_guia','int_url',
            'col_bodega_fecha','col_bodega_foto','cliente_notificado',
            'cli_guia','cli_empresa','cli_url','cli_fecha_envio','cli_estado_entrega','cli_fecha_recibido',
            'valor_envio_interno_colombia','comprado_viaje_encargos'
        ];
        
        fields.forEach(kf => {
            const fVal = fd.get(kf);
            if(fVal) {
                payload[kf] = fVal;
            } else if (!fVal && data[kf]) {
                // keep data[kf] unchanged because field was hidden
                // except if they deliberately clear it? We'll prioritize data safety.
            }
        });

        const fPaq = fd.get('paq');
        if (fPaq) payload.paqueteria = fPaq;
        else if (fPaq === '' && !data.paqueteria) payload.paqueteria = '';
        
        const fUbi = fd.get('ubi');
        if (fUbi) payload.ubicacion = fUbi;
        else if (fUbi === '' && !data.ubicacion) payload.ubicacion = '';
        
        // Remove bad keys if they exist in data to prevent leaking
        delete payload.paq;
        delete payload.ubi;

        // Asegurar que si id_seguimiento_internacional principal no está, use el fallback de int_guia o usa_guia
        payload.id_seguimiento_internacional = fd.get('id_seguimiento_internacional') || payload.int_guia || payload.usa_guia || '';

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.innerHTML = '<i class="loader"></i> Guardando...';
        
        try {
            const fiUSA = document.getElementById('usa-foto-input');
            if (fiUSA && fiUSA.files.length > 0) {
                btn.innerHTML = '<i class="loader"></i> Subiendo Foto USA...';
                const urlObj = await uploadImageToSupabase(fiUSA.files[0]);
                if (urlObj) payload.usa_bodega_foto = urlObj;
            }
            
            const fiCOL = document.getElementById('col-foto-input');
            if (fiCOL && fiCOL.files.length > 0) {
                btn.innerHTML = '<i class="loader"></i> Subiendo Foto COL...';
                const urlObj = await uploadImageToSupabase(fiCOL.files[0]);
                if (urlObj) payload.col_bodega_foto = urlObj;
            }

            // --- Lógica de Consolidación ---
            const consolidateIds = fd.getAll('consolidate_ids');
            const guiaUSD = fd.get('guia_total_usd');
            const guiaCOP = fd.get('guia_total_cop');
            
            let newGuiaId = null;
            if (nuevaFase.includes('4.') && (guiaUSD || guiaCOP)) {
                btn.innerHTML = '<i class="loader"></i> Creando Guía Internacional...';
                newGuiaId = Date.now().toString();
                const guiaPayload = {
                    id: newGuiaId,
                    numero_guia: fd.get('int_guia') || payload.int_guia || '',
                    valor_usd: parseFloat(guiaUSD || 0),
                    valor_cop: parseInt(guiaCOP || 0),
                    courier: fd.get('paq') || payload.paqueteria || '',
                    fecha_creacion: new Date().toISOString()
                };
                await db.postData('GuiasInternacionales', guiaPayload, 'INSERT');
                payload.guia_internacional_id = newGuiaId;
            }

            btn.innerHTML = '<i class="loader"></i> Guardando Registro Principal...';
            const res = await db.postData('Logistica', payload, mode); 
            if(res.error) throw new Error(res.error);

            // Actualizar otros productos consolidados
            if (newGuiaId && consolidateIds.length > 0) {
                btn.innerHTML = `<i class="loader"></i> Consolidando ${consolidateIds.length} productos...`;
                for (const otherId of consolidateIds) {
                    const otherItem = list.find(it => it.id.toString() === otherId.toString());
                    if (otherItem) {
                        const otherPayload = { 
                            ...otherItem,
                            fase: nuevaFase,
                            guia_internacional_id: newGuiaId,
                            id_seguimiento_internacional: payload.id_seguimiento_internacional,
                            int_guia: payload.int_guia,
                            paqueteria: payload.paqueteria,
                            int_fecha_envio: payload.int_fecha_envio,
                            int_url: payload.int_url,
                            fecha_actualizacion: new Date().toISOString()
                        };
                        let otherHist = [];
                        try { otherHist = JSON.parse(otherItem.historial || '[]'); } catch(e){}
                        otherHist.push({
                            fase: nuevaFase,
                            fecha: new Date().toLocaleString('es-CO'),
                            notas: `Consolidado en guía ${payload.int_guia}`
                        });
                        otherPayload.historial = JSON.stringify(otherHist);
                        await db.postData('Logistica', otherPayload, 'UPDATE');
                    }
                }
            }

            window.closeModal(); 
            showToast('Guía logística procesada con éxito.', 'success');
            navigateTo('logistics'); 
        } catch (err) { 
            showToast(err.message, 'error');
            btn.disabled = false; 
            btn.innerText = "Reintentar"; 
        }
    };
};

// --- New Submodule: Envíos EEUU a Colombia ---
const renderEnviosEEUU = (list, ventas, clientes, compras, productos, guiasInt) => {
    if (guiasInt.length === 0) {
        return `
            <div class="glass-card" style="text-align:center; padding:4rem; opacity:0.6;">
                <div style="font-size:3rem; margin-bottom:1rem;">📦</div>
                <h3>No hay guías internacionales registradas</h3>
                <p>Las guías aparecerán aquí cuando consolides envíos desde Bodega USA.</p>
            </div>
        `;
    }

    return `
        <div class="glass-card" style="padding:0; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
            <div style="background:rgba(255,255,255,0.05); padding:1rem 1.5rem; border-bottom:1px solid var(--glass-border);">
                <h3 style="margin:0; font-size:1.1rem;">Relación de Guías Internacionales</h3>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%; text-align:left; border-collapse:collapse; white-space: nowrap;">
                    <thead style="opacity: 0.5; font-size: 0.7rem; background:rgba(0,0,0,0.2);">
                        <tr>
                            <th style="padding:15px 20px;">Nº GUÍA / COURIER</th>
                            <th style="padding:15px 20px;">FECHA CREACIÓN</th>
                            <th style="padding:15px 20px;">PRODUCTOS</th>
                            <th style="padding:15px 20px;">VALOR TOTAL (COP)</th>
                            <th style="padding:15px 20px;">VALOR TOTAL (USD)</th>
                            <th style="padding:15px 20px; text-align:right;">ACCIÓN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${guiasInt.reverse().map(g => {
                            const items = list.filter(l => l.guia_internacional_id?.toString() === g.id.toString());
                            if (items.length === 0) return '';
                            return `
                                <tr class="log-row">
                                    <td style="padding:15px 20px;">
                                        <strong style="color:var(--info-blue); font-family:monospace; font-size:1.1rem;">${g.numero_guia}</strong><br>
                                        <span style="font-size:0.75rem; opacity:0.6;">${g.courier || 'N/A'}</span>
                                    </td>
                                    <td style="padding:15px 20px;">${g.fecha_creacion ? g.fecha_creacion.split('T')[0] : 'N/A'}</td>
                                    <td style="padding:15px 20px;">
                                        <span style="background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:10px; font-weight:bold; font-size:0.8rem;">${items.length} ítems</span>
                                    </td>
                                    <td style="padding:15px 20px; font-weight:700;">${formatCOP(g.valor_cop || 0)}</td>
                                    <td style="padding:15px 20px; opacity:0.8;">$${g.valor_usd || 0} USD</td>
                                    <td style="padding:15px 20px; text-align:right;">
                                        <button class="btn-action" onclick="window.modalDetalleGuia('${g.id}')">👁️ Ver Detalle</button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

window.modalDetalleGuia = async (guiaId) => {
    const container = document.getElementById('modal-container');
    const content = document.getElementById('modal-content');
    content.innerHTML = `<div style="text-align:center; padding:2rem;"><div class="loader"></div> Cargando detalle de guía...</div>`;
    container.style.display = 'flex';

    const [guias, logistica, ventas, productos] = await Promise.all([
        db.fetchData('GuiasInternacionales'),
        db.fetchData('Logistica'),
        db.fetchData('Ventas'),
        db.fetchData('Productos')
    ]);

    const guiasList = Array.isArray(guias) ? guias : [];
    const guia = guiasList.find(g => g.id.toString() === guiaId.toString());
    if (!guia) {
        showToast('Guía no encontrada', 'error');
        window.closeModal();
        return;
    }

    const items = logistica.filter(l => l.guia_internacional_id?.toString() === guiaId.toString());
    
    // Preparar lista de otras guías para poder mover productos (únicas y válidas)
    const validOtherGuias = [];
    const seenGuias = new Set();
    
    for (const g of guiasList) {
        if (g.id.toString() === guiaId.toString()) continue;
        if (!g.numero_guia) continue;
        if (seenGuias.has(g.numero_guia)) continue;
        
        const gItems = logistica.filter(l => l.guia_internacional_id?.toString() === g.id.toString());
        if (gItems.length > 0) {
            validOtherGuias.push(g);
            seenGuias.add(g.numero_guia);
        }
    }

    const guiasOptionsSelect = validOtherGuias.map(g => `<option value="${g.numero_guia}">${g.numero_guia} ${g.courier ? `(${g.courier})` : ''}</option>`).join('');
    
    // Calcular suma de valores individuales
    let sumaIndividuales = 0;
    const itemsHtml = items.map(l => {
        const v = ventas.find(v => v.id.toString() === l.venta_id?.toString());
        const p = v ? productos.find(p => p.id.toString() === v.producto_id?.toString()) : null;
        const valorInt = v?.valor_envio_internacional || 0;
        sumaIndividuales += valorInt;

        return `
            <div id="item-row-${l.id}" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--glass-border); font-size:0.85rem;">
                <div style="flex:1;">
                    <strong>${p?.nombre_producto || 'Producto Stock'}</strong><br>
                    <span style="opacity:0.6; font-size:0.75rem;">Venta #${l.venta_id?.toString().slice(-4) || '-'}</span>
                </div>
                <div style="text-align:right; margin-right:15px; width: 100px;">
                    <div style="font-weight:700; color:#FFB703;">${formatCOP(valorInt)}</div>
                </div>
                ${validOtherGuias.length > 0 ? `
                <div style="display:flex; gap:10px; align-items:center;">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <select id="move-sel-${l.id}" style="font-size:0.75rem; padding:4px 6px; border-radius:4px; background:var(--input-bg); border:1px solid var(--glass-border); color:var(--text-main); max-width: 150px;" onchange="document.getElementById('move-txt-${l.id}').value = this.value">
                            <option value="">Elegir de lista...</option>
                            ${guiasOptionsSelect}
                        </select>
                        <input type="text" id="move-txt-${l.id}" placeholder="...o pegar guía" style="font-size:0.75rem; padding:4px 6px; border-radius:4px; background:var(--input-bg); border:1px solid var(--glass-border); color:var(--text-main); max-width: 150px;">
                    </div>
                    <button class="btn-action" style="padding:6px 12px; font-size:0.75rem; background:rgba(255,255,255,0.1); height: 100%;" onclick="window.moverArticuloGuia('${l.id}', document.getElementById('move-txt-${l.id}').value || document.getElementById('move-sel-${l.id}').value, '${guiaId}')">Mover</button>
                </div>
                ` : '<span style="font-size:0.75rem; opacity:0.5;">No hay otras guías disponibles</span>'}
            </div>
        `;
    }).join('');

    const diferencia = sumaIndividuales - (guia.valor_cop || 0);

    content.innerHTML = `
        <div class="modal-content modal-wide">
            <div class="modal-header">
                <h2 class="modal-title" style="color:var(--info-blue);">Detalle Guía: ${guia.numero_guia}</h2>
                <button class="modal-close" onclick="window.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2" style="margin-bottom:1.5rem;">
                    <div class="glass-card" style="padding:15px; text-align:center; border:1px solid var(--glass-border);">
                        <span style="font-size:0.75rem; opacity:0.6; text-transform:uppercase;">Valor Total Guía</span>
                        <div style="font-size:1.3rem; font-weight:bold; color:var(--success-green); margin:5px 0;">${formatCOP(guia.valor_cop || 0)}</div>
                        <div style="font-size:0.85rem; opacity:0.5;">$${guia.valor_usd || 0} USD</div>
                    </div>
                    <div class="glass-card" style="padding:15px; text-align:center; border:1px solid var(--glass-border);">
                        <span style="font-size:0.75rem; opacity:0.6; text-transform:uppercase;">Suma Individuales</span>
                        <div style="font-size:1.3rem; font-weight:bold; color:#FFB703; margin:5px 0;">${formatCOP(sumaIndividuales)}</div>
                        <div style="font-size:0.85rem; opacity:0.5;">Cobrado a clientes</div>
                    </div>
                </div>

                <div class="glass-card" style="padding:15px; margin-bottom:1.5rem; border:1px solid ${diferencia >= 0 ? 'rgba(6,214,160,0.3)' : 'rgba(230,57,70,0.3)'}; background:${diferencia >= 0 ? 'rgba(6,214,160,0.05)' : 'rgba(230,57,70,0.05)'};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-weight:700; font-size:0.95rem;">${diferencia >= 0 ? '💹 Ganancia Estimada Flete:' : '⚠️ Diferencia en Flete:'}</span>
                        <strong style="font-size:1.2rem; color:${diferencia >= 0 ? 'var(--success-green)' : 'var(--primary-red)'}">${formatCOP(Math.abs(diferencia))}</strong>
                    </div>
                </div>

                <h3 style="margin-bottom:12px; font-size:1.1rem;">Productos en esta Guía (${items.length})</h3>
                <p style="font-size:0.8rem; opacity:0.7; margin-top:-5px; margin-bottom:10px;">Puedes mover un producto a otra guía si fue empaquetado de manera diferente.</p>
                <div style="max-height:300px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:12px; border:1px solid var(--glass-border); margin-bottom:1rem;">
                    ${itemsHtml || '<div style="padding:20px; text-align:center; opacity:0.5;">No hay productos vinculados.</div>'}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.closeModal()">Cerrar</button>
            </div>
        </div>
    `;
};

window.moverArticuloGuia = async (logisticaId, newGuiaId, currentGuiaId) => {
    if (!newGuiaId) {
        window.showToast('Debes seleccionar una guía de destino', 'error');
        return;
    }
    
    try {
        const btn = document.querySelector(`#item-row-${logisticaId} button`);
        if(btn) { btn.disabled = true; btn.innerText = '⏳'; }
        
        const [logistica, guias] = await Promise.all([
            db.fetchData('Logistica'),
            db.fetchData('GuiasInternacionales')
        ]);
        
        const item = logistica.find(l => l.id.toString() === logisticaId.toString());
        const newGuia = guias.find(g => g.numero_guia === newGuiaId || g.id.toString() === newGuiaId.toString());
        
        if (!item || !newGuia) throw new Error("Guía de destino no encontrada o inválida");

        let histArr = [];
        try { histArr = JSON.parse(item.historial || '[]'); } catch(e){}
        histArr.push({
            fase: item.fase,
            fecha: new Date().toLocaleString('es-CO'),
            notas: `Movido a la guía internacional ${newGuia.numero_guia} por reacomodo de bodega.`
        });

        const payload = {
            ...item,
            guia_internacional_id: newGuia.id,
            int_guia: newGuia.numero_guia,
            paqueteria: newGuia.courier || item.paqueteria,
            id_seguimiento_internacional: newGuia.numero_guia,
            historial: JSON.stringify(histArr),
            fecha_actualizacion: new Date().toISOString()
        };

        const res = await db.postData('Logistica', payload, 'UPDATE');
        if (res.error) throw new Error(res.error);
        
        window.showToast('Producto movido exitosamente', 'success');
        
        // Recargar el modal para ver los cambios instantáneamente
        window.modalDetalleGuia(currentGuiaId);
        
        // Intentar recargar la vista principal si la función global existe
        const logisticsBtn = document.querySelector('nav button[onclick="window.loadSection(\\\'logistics\\\')"]');
        if (logisticsBtn) logisticsBtn.click();
        
    } catch(err) {
        window.showToast('Error moviendo artículo: ' + err.message, 'error');
        const btn = document.querySelector(`#item-row-${logisticaId} button`);
        if(btn) { btn.disabled = false; btn.innerText = 'Mover'; }
    }
};

