import { db } from '../db.js';
import { renderError, showToast, uploadImageToSupabase, downloadExcel, renderPagination, paginate } from '../utils.js';

let _logStartDate = '';
let _logEndDate = '';

export const renderLogistics = async (renderLayout, navigateTo) => {
    renderLayout(`<div style="text-align:center; padding:5rem;"><div class="loader"></div> Cargando Módulo de Logística...</div>`);
    
    const [list, ventas, clientes, compras, productos] = await Promise.all([
        db.fetchData('Logistica'),
        db.fetchData('Ventas'),
        db.fetchData('Clientes'),
        db.fetchData('Compras'),
        db.fetchData('Productos')
    ]);
    
    if (list.error) return renderError(renderLayout, list.error, navigateTo);

    const applyLogFilter = () => {
        _logStartDate = document.getElementById('log-date-start').value;
        _logEndDate = document.getElementById('log-date-end').value;
        renderLogistics(renderLayout, navigateTo);
    };
    window.applyLogDateFilter = applyLogFilter;

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
            <button class="btn-primary" onclick="window.modalLogistica()">+ Agregar Seguimiento</button>
        </div>
      </div>
      
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
                          
                          let td1 = '-';
                          let td3 = '-';

                          if (i === 0) {
                              // Phase 1: Comprado
                              td1 = `<strong style="font-family:monospace; font-size:1.0rem; color:var(--info-blue); display:inline-block; margin-bottom:4px;">Orden: ${compraAsoc ? compraAsoc.numero_orden || 'S/N' : '-'}</strong><br><span style="font-size:0.75rem; opacity:0.6;">Ult. Act: ${c.fecha_actualizacion ? c.fecha_actualizacion.split('T')[0] : '-'}</span>`;
                              td3 = `<strong>${compraAsoc ? compraAsoc.proveedor || '-' : '-'}</strong><br><div style="margin-top:4px;">${compraAsoc?.url_orden ? `<a href="${compraAsoc.url_orden}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Ver Tienda]</a>` : ''}</div>`;
                          } else if (i === 1 || i === 2) {
                              // Phase 2, 3: Local USA
                              let arrivalHtml = `<div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8;">Est: <strong>${c.usa_fecha_estimada || '?'}</strong></span></div>`;
                              if (i === 2 && c.usa_bodega_fecha) {
                                  arrivalHtml += `<div style="margin-top:4px;"><span style="font-size:0.75rem; color:var(--success-green); font-weight:bold; background:rgba(6,214,160,0.1); padding:2px 6px; border-radius:4px;">Fecha Real: ${c.usa_bodega_fecha}</span></div>`;
                              }
                              td1 = `<strong style="color:var(--primary-red); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.usa_guia || 'Pendiente'}</strong><br>
                                     <span style="font-size:0.75rem; opacity:0.8;">Envío: <strong>${c.usa_fecha_envio || '?'}</strong></span>${arrivalHtml}`;
                              td3 = `<strong>${c.usa_empresa || 'S/N'}</strong><br><div style="margin-top:4px;">${c.usa_url ? `<a href="${c.usa_url}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Rastrear Paquete USA]</a>` : ''}</div>`;
                          } else if (i === 3) {
                              // Phase 4: Internacional
                              td1 = `<strong style="color:var(--info-blue); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.int_guia || c.id_seguimiento_internacional || 'Pendiente'}</strong>`;
                              td3 = `<strong>${c.paqueteria || 'S/N'}</strong><br><div style="margin-top:4px;">${c.int_url ? `<a href="${c.int_url}" target="_blank" style="font-size:0.7rem; color:var(--success-green); text-decoration:none;">[🔗 Rastrear Vuelo/Aduana]</a>` : ''}</div>`;
                          } else if (i === 4) {
                              // Phase 5: Bodega Colombia
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
                          } else if (i === 5) {
                              // Phase 6: Local COL
                              td1 = `<strong style="color:var(--success-green); font-family:monospace; font-size:1.1rem; display:inline-block; margin-bottom:4px;">${c.cli_guia || 'Pendiente Guía'}</strong><br>
                                     <div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8;">Envío: <strong>${c.cli_fecha_envio || '?'}</strong></span></div>`;
                              
                              let estadoBadge = c.cli_estado_entrega === 'Recibido' 
                                  ? `<span style="background:rgba(6,214,160,0.1); color:var(--success-green); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(6,214,160,0.2);">✅ Recibido (${c.cli_fecha_recibido || 'Sin fecha'})</span>`
                                  : `<span style="background:rgba(255,190,11,0.1); color:var(--warning-orange); padding:4px 8px; border-radius:12px; font-weight:bold; font-size:0.75rem; border:1px solid rgba(255,190,11,0.2);">🚚 En Tránsito Local</span>`;
                                  
                              td3 = `${estadoBadge}<br><div style="margin-top:10px; font-size:0.8rem;"><strong>${c.cli_empresa || 'S/N'}</strong> ${c.cli_url ? `<a href="${c.cli_url}" target="_blank" style="margin-left:5px; color:var(--success-green); text-decoration:none;">[🔗 Rastrear]</a>` : ''}</div>`;
                          }

                          let td4 = '-';
                          if (i === 0) {
                              td4 = c.ubicacion || '-';
                          } else if (i === 1 || i === 2) {
                              td4 = c.usa_bodega_nom || 'Por Asignar (USA)';
                          } else if (i === 3) {
                              td4 = `<span style="font-size:0.75rem; opacity:0.8;">Recibido en USA: <strong>${c.usa_bodega_fecha || 'Pendiente'}</strong></span><br>
                                     <div style="margin-top:4px;"><span style="font-size:0.75rem; opacity:0.8; color:var(--info-blue);">Despachado a COL: <strong>${c.int_fecha_envio || 'Pendiente'}</strong></span></div>`;
                          } else if (i === 4) {
                              
                              let badgeSaldoHtml = '';
                              if (ventaAsoc) {
                                   const saldoVal = parseInt(ventaAsoc.saldo_pendiente || '0', 10);
                                   if (saldoVal <= 0) {
                                        badgeSaldoHtml = `<div style="margin-top:8px;"><span style="padding:3px 6px; background:rgba(6,214,160,0.1); border:1px solid var(--success-green); border-radius:6px; font-size:0.7rem; font-weight:bold; color:var(--success-green); display:inline-block;">✅ Al día (Pagado)</span></div>`;
                                   } else {
                                        badgeSaldoHtml = `<div style="margin-top:8px;"><span style="padding:4px 8px; background:rgba(230,57,70,0.1); border:1px solid var(--primary-red); border-radius:6px; font-size:0.75rem; font-weight:bold; color:var(--primary-red); display:inline-block;">⚠️ Debe: $${saldoVal.toLocaleString('es-CO')}</span></div>`;
                                   }
                              }

                              if (prodAsoc) {
                                  td4 = `<strong style="font-size:0.9rem;">${prodAsoc.nombre_producto || 'Sin Nombre'}</strong><br><span style="font-size:0.75rem; opacity:0.7; display:inline-block; margin-top:4px;">Talla: <strong>${prodAsoc.talla || 'N/A'}</strong> | Marca: <strong>${prodAsoc.marca || 'N/A'}</strong></span>${badgeSaldoHtml}`;
                              } else {
                                  td4 = `<span style="opacity:0.5; font-size:0.8rem;">Sin producto asociado</span>${badgeSaldoHtml}`;
                              }
                          } else if (i === 5) {
                              td4 = `<strong style="color:var(--info-blue); font-size:0.9rem;">${nombreCli}</strong><br><span style="font-size:0.75rem; opacity:0.7; display:inline-block; margin-top:4px;">${prodAsoc ? prodAsoc.nombre_producto : 'Sin Producto'}</span>`;
                          }

                          let ultimaNota = '';
                          try {
                              if (c.historial) {
                                  let histArr = typeof c.historial === 'string' ? JSON.parse(c.historial) : c.historial;
                                  if (histArr.length > 0) {
                                      for (let k = histArr.length - 1; k >= 0; k--) {
                                          let notaTexto = histArr[k] && histArr[k].notas ? String(histArr[k].notas).trim() : '';
                                          let faseLog = histArr[k].fase || c.fase;
                                          if (notaTexto !== '' && mapFase(faseLog) === f) {
                                              ultimaNota = notaTexto;
                                              break;
                                          }
                                      }
                                  }
                              }
                          } catch(e) {
                              console.warn("No se pudo parsear el historial:", e);
                          }
                          
                          if (!ultimaNota && c.notas && mapFase(c.fase) === f) {
                              ultimaNota = c.notas;
                          }


                          const searchStr = `${c.id_seguimiento_internacional || ''} ${nombreCli} ${c.ubicacion || ''} ${ultimaNota} ${f} ${prodAsoc ? prodAsoc.nombre_producto : ''} ${c.usa_guia || ''} ${c.int_guia || ''} ${c.cli_guia || ''} ${compraAsoc ? compraAsoc.numero_orden : ''} ${c.usa_empresa || ''} ${c.paqueteria || ''} ${c.cli_empresa || ''}`.replace(/\s+/g, ' ').trim();
                          const safeSearchStr = searchStr.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

                          return `
                              <tr style="border-top: 1px solid var(--glass-border); transition: 0.3s;" class="log-row" data-text="${safeSearchStr}">
                                <td style="padding:15px 20px; vertical-align:middle;">
                                    ${td1}
                                </td>
                                <td style="padding:15px 20px; vertical-align:middle; white-space:normal; min-width:200px;">
                                    <strong style="color:var(--warning-orange);">${nombreCli}</strong><br>
                                    <span style="display:inline-block; margin-top:4px; margin-bottom:6px; font-size:0.7rem; opacity:0.6;">Dcto Venta: #${c.venta_id ? c.venta_id.toString().slice(-4) : '-'}</span>
                                    ${ultimaNota ? `
                                    <div style="background:rgba(255,255,255,0.08); padding:6px 10px; border-radius:6px; border-left:3px solid var(--warning-orange); font-size:0.75rem; color:var(--text-main); line-height:1.3; margin-top:4px;">
                                        <i style="font-style:normal; opacity:0.6; font-size:0.7rem;">💬 Nota:</i><br><i>${ultimaNota}</i>
                                    </div>
                                    ` : ''}
                                </td>
                                <td style="padding:15px 20px; vertical-align:middle;">${td3}</td>
                                <td style="padding:15px 20px; vertical-align:middle;">${td4}</td>
                                <td style="padding:15px 20px; vertical-align:middle;">
                                    <div style="display:flex; gap:10px; align-items:center; justify-content:flex-end;">
                                        <button class="btn-action" onclick="window.modalDetalleLogistica('${c.id}')" title="Ver Historial" style="font-size:1.2rem; padding: 5px 10px;">👁️</button>
                                        <button class="btn-action" onclick="window.modalLogistica('${c.id}')" title="Editar Fase" style="font-size:1.2rem; padding: 5px 10px;">✏️</button>
                                    </div>
                                </td>
                              </tr>
                          `;
                      }).join('') : `<tr><td colspan="5" class="empty-log-row" style="text-align:center; padding:2rem; opacity:0.5;">No hay envíos actualmente en esta fase.</td></tr>`}
                  </tbody>
                  </table>
              </div>
          </div>
          `;
      }).join('')}
      </div>
      ${renderPagination(filteredList.length, _page, _rpp, 'logistics')}
    `;
    renderLayout(html);
    if(window.lucide) window.lucide.createIcons();

    // Búsqueda
    setTimeout(() => {
        const fi = document.getElementById('find-it');
        if (fi) {
            fi.oninput = (e) => {
                const k = e.target.value.toLowerCase().trim();
                
                document.querySelectorAll('#list-body .log-fase-block').forEach(block => {
                    let hasVisibleRow = false;
                    
                    block.querySelectorAll('.log-row').forEach(r => {
                        const text = r.getAttribute('data-text') || '';
                        const match = text.toLowerCase().includes(k);
                        r.style.display = match ? '' : 'none';
                        if (match) hasVisibleRow = true;
                    });
                    
                    const emptyRow = block.querySelector('.empty-log-row');
                    if (emptyRow) {
                        // Si la fase no tiene envios de por si
                        block.style.display = (k === '') ? '' : 'none';
                    } else {
                        // Si tiene envios, mostrar u ocultar basado en si hubo matchs
                        block.style.display = (hasVisibleRow || k === '') ? '' : 'none';
                    }
                });
            };
        }
    }, 150);
    
    // Función global para ver historial
    window.modalDetalleLogistica = async (id) => {
        const item = reversedList.find(i => i.id.toString() === id.toString());
        if (!item) return;

        let histArr = [];
        if (item.historial) {
            try { histArr = JSON.parse(item.historial); } catch(e){}
        }

        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        
        const compraRef = !compras.error ? compras.find(cmp => cmp.id.toString() === item.compra_id?.toString() || (item.venta_id && cmp.venta_id?.toString() === item.venta_id?.toString())) : null;
        const ventaAsoc = (!ventas.error && item.venta_id) ? ventas.find(v => v.id.toString() === item.venta_id.toString()) : null;
        
        let pFechaVenta = '';
        if (ventaAsoc && ventaAsoc.fecha) {
            let dateV;
            let dateStr = String(ventaAsoc.fecha).split(' ')[0]; // Limpiar la hora si la trae
            
            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts[2]?.length === 4) {
                    // Es DD/MM/YYYY o D/M/YYYY
                    dateV = new Date(parts[2], parts[1] - 1, parts[0]);
                } else if (parts[0]?.length === 4) {
                    // Es YYYY/MM/DD
                    dateV = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    dateV = new Date(dateStr);
                }
            } else if (dateStr.includes('-')) {
                const parts = dateStr.split('T')[0].split('-');
                if (parts[0]?.length === 4) {
                    // YYYY-MM-DD
                    dateV = new Date(parts[0], parts[1] - 1, parts[2]);
                } else {
                    dateV = new Date(dateStr);
                }
            } else {
                dateV = new Date(dateStr);
            }
            
            const hoy = new Date();
            const dias = Math.floor((hoy - dateV) / (1000 * 60 * 60 * 24));
            
            pFechaVenta = `
                  <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); grid-column: span 2;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">🤝</i>Fecha de Venta Original del Encargo</span><br>
                      <strong>${dateStr}</strong> <span style="font-size:0.8rem; background:rgba(230,57,70,0.2); color:var(--primary-red); padding:3px 8px; border-radius:10px; margin-left:5px; font-weight:bold;">Hace ${dias >= 0 ? dias : 0} día(s)</span>
                  </div>
            `;
        }
        
        let compraBoxHtml = '';
        if (compraRef || pFechaVenta) {
            compraBoxHtml = `
            <div style="background:var(--glass-hover); border:1px solid var(--glass-border); padding:1.5rem; border-radius:12px; margin-bottom:2rem;">
               <h3 style="margin:0 0 15px 0; font-size:1.1rem; color:var(--text-main); text-transform:uppercase; letter-spacing:1px;"><span style="color:var(--info-blue);">🛍️</span> Detalles de la Compra Origen</h3>
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
                  <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                      <span style="opacity:0.6;"><i style="font-style:normal; margin-right:5px;">🔗</i>Enlace Oficial</span><br>
                      ${compraRef?.url_orden ? `<a href="${compraRef?.url_orden}" target="_blank" style="display:inline-block; margin-top:4px; background:rgba(6,214,160,0.2); color:var(--success-green); border:1px solid rgba(6,214,160,0.3); padding:4px 10px; border-radius:15px; text-decoration:none; font-size:0.8rem; font-weight:bold;">Visitar Tienda</a>` : '<span style="opacity:0.4;">Enlace No Adjunto</span>'}
                  </div>
               </div>
            </div>
            `;
        }

        let virtualHistArr = [];

        if (ventaAsoc && ventaAsoc.fecha) {
            virtualHistArr.push({
                fase: "Venta Registrada (Sistema Origen)",
                fecha: String(ventaAsoc.fecha).split('T')[0],
                notas: `Asignado a doc de venta #${ventaAsoc.id.toString().slice(-4)}`
            });
        }
        
        if (compraRef && compraRef.fecha_pedido) {
            virtualHistArr.push({
                fase: "Compra Proveedor Exterior",
                fecha: String(compraRef.fecha_pedido).split('T')[0],
                notas: `Orden Oficial #${compraRef.numero_orden || 'S/N'}, Tienda: ${compraRef.proveedor || 'N/A'}`
            });
        }

        virtualHistArr = [...virtualHistArr, ...histArr];

        let timelineHtml = virtualHistArr.length > 0 ? virtualHistArr.map((h, idx) => {
            let cleanFase = h.fase.replace(/^(\d+[\.\-\)]?\s*)/, '');
            return `
            <div style="position:relative; padding-left:25px; margin-bottom:15px;">
                <div style="position:absolute; left:0; top:5px; width:10px; height:10px; border-radius:50%; background:var(--primary-red); border:2px solid var(--body-bg);"></div>
                <div style="position:absolute; left:4px; top:15px; width:2px; height:calc(100% + 15px); background:var(--glass-border);"></div>
                <strong style="color:var(--text-main); font-size:0.95rem;">${idx + 1}. ${cleanFase}</strong><br>
                <span style="opacity:0.5; font-size:0.75rem;">${h.fecha}</span>
                ${h.notas ? `<p style="margin:5px 0 0; font-size:0.8rem; opacity:0.8; background:var(--glass-hover); padding:5px 10px; border-radius:8px;">${h.notas}</p>` : ''}
            </div>
            `;
        }).join('') : '<p style="opacity:0.5;">Sin historial registrado previo.</p>';

        content.innerHTML = `
            <h2>Línea de Vida Logística</h2>
            <div style="margin-top:1.5rem;">
                ${compraBoxHtml}
                <h3 style="margin-bottom:15px; font-size:1.1rem; color:var(--text-main); text-transform:uppercase; letter-spacing:1px;"><span style="color:var(--primary-red);">⏳</span> Cronología de Fases</h3>
                ${timelineHtml}
            </div>
            
            <h3 style="margin-top:2rem; border-top:1px solid var(--glass-border); padding-top:1rem;">Detalles Relevantes Asociados</h3>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.8rem;">
                ${item.usa_guia ? `<div><strong>Guía USA:</strong> ${item.usa_guia}</div>` : ''}
                ${item.usa_empresa ? `<div><strong>Transportadora USA:</strong> ${item.usa_empresa}</div>` : ''}
                ${item.usa_bodega_nom ? `<div><strong>Bodega USA:</strong> ${item.usa_bodega_nom}</div>` : ''}
                ${item.int_guia ? `<div><strong>Tracking Int:</strong> ${item.int_guia}</div>` : ''}
                ${item.cli_guia ? `<div><strong>Guía Colombia:</strong> ${item.cli_guia}</div>` : ''}
                ${item.cli_empresa ? `<div><strong>Transportadora COL:</strong> ${item.cli_empresa}</div>` : ''}
            </div>

            <div style="margin-top:2rem;">
               <button type="button" class="btn-primary" onclick="window.closeModal()" style="width:100%;">Cerrar</button>
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

    if (id) {
       content.innerHTML = `<div style="text-align:center; padding:2rem;"><div class="loader"></div> Recuperando Seguimiento...</div>`;
       container.style.display = 'flex';
       const list = await db.fetchData('Logistica');
       const target = list.find(it => it.id.toString() === id.toString());
       if (target) data = { ...target };
    }

    const [ventas, productos, clientes, conf, comprasData] = await Promise.all([
        db.fetchData('Ventas'),
        db.fetchData('Productos'),
        db.fetchData('Clientes'),
        db.fetchData('Configuracion'),
        db.fetchData('Compras')
    ]);
    
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
        <h2 style="margin-bottom:1.5rem;">${id ? 'Actualizar Envio' : 'Registrar Nuevo Envio'}</h2>
        <form id="form-crud" style="display:flex; flex-direction:column; gap:1.2rem; max-height: 70vh; overflow-y: auto; padding-right:15px;">
            
            <div style="background:var(--glass-hover); padding:1rem; border-radius:12px; border:1px solid var(--glass-border);">
                 <label style="font-weight:bold; color:var(--info-blue);">Cambiar Estado / Fase actual:</label>
                 <select name="fase" id="log-fase-select" style="font-size:1.1rem; padding:10px; margin-top:5px; background:var(--input-bg); color:var(--text-main);">
                     ${selectOptionsHtml}
                 </select>
            </div>

            <div>
               <label>Asociar a Orden de Venta (Opcional)</label>
               <select name="venta_id" id="log-venta-select">
                  <option value="">-- Sin Vincular --</option>
                  ${!(ventas.error) ? ventas.reverse().map(v => `<option value="${v.id}" ${data.venta_id == v.id ? 'selected' : ''}>Orden #${v.id} - ${v.fecha || 'Sin fecha'}</option>`).join('') : ''}
               </select>
               <div id="log-preview-box" style="display:none; margin-top:15px;"></div>
            </div>
            
            <!-- BLOQUE 1 Y 2: Tienda a Bodega USA -->
            <div id="fase-b12" style="display:none; gap:1rem; flex-direction:column; padding:15px; border-left:3px solid var(--primary-red); background:rgba(255,0,0,0.05);">
                <h4>Detalles Tracking Origen -> Estados Unidos</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Guía Tienda (USA)</label><input type="text" name="usa_guia" value="${data.usa_guia || ''}"></div>
                    <div><label>Empresa Transporte USA</label>
                         <select name="usa_empresa">
                            <option value="">-- Parametrizar Option --</option>
                            ${transpUSA.map(t => `<option value="${t.valor}" ${data.usa_empresa === t.valor ? 'selected' : ''}>${t.valor}</option>`).join('')}
                         </select>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr; gap:1rem;">
                    <div><label>URL Tracking USA</label><input type="url" name="usa_url" value="${data.usa_url || ''}"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Fecha de Envío USA</label><input type="date" name="usa_fecha_envio" value="${data.usa_fecha_envio || ''}"></div>
                    <div><label>Fecha Estimada de Llegada a Bodega</label><input type="date" name="usa_fecha_estimada" value="${data.usa_fecha_estimada || ''}"></div>
                </div>
            </div>

            <!-- BLOQUE 3: Bodega USA -->
            <div id="fase-b3" style="display:none; gap:1rem; flex-direction:column; padding:15px; border-left:3px solid var(--warning-orange); background:rgba(255,165,0,0.05);">
                <h4>Llegada a Bodega USA</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Bodega USA de Recepción</label>
                         <select name="usa_bodega_nom">
                            <option value="">-- Seleccionar --</option>
                            ${bodegasUSA.map(t => `<option value="${t.valor}" ${data.usa_bodega_nom === t.valor ? 'selected' : ''}>${t.valor}</option>`).join('')}
                         </select>
                    </div>
                    <div><label>Fecha Llegada a Bodega</label><input type="date" name="usa_bodega_fecha" value="${data.usa_bodega_fecha || ''}"></div>
                </div>
                <div>
                    <label>Evidencia Entrega / Guía Recibida (Opcional)</label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="width:60px; height:60px; border-radius:8px; overflow:hidden; background:var(--glass-hover); border:1px solid var(--glass-border); display:flex; justify-content:center; align-items:center;">
                            <img id="usa-preview" src="${data.usa_bodega_foto || ''}" style="${data.usa_bodega_foto ? 'width:100%; height:100%; object-fit:cover;' : 'display:none;'}">
                            <span id="usa-ph" style="font-size:0.6rem; opacity:0.5; text-align:center; ${data.usa_bodega_foto ? 'display:none;' : ''}">SIN<br>FOTO</span>
                        </div>
                        <div style="flex:1;">
                            <input type="file" id="usa-foto-input" accept="image/*" style="font-size:0.8rem; padding:8px; width:100%; border:1px dashed var(--glass-border); border-radius:8px; cursor:pointer;">
                            <input type="hidden" name="usa_bodega_foto" value="${data.usa_bodega_foto || ''}">
                        </div>
                    </div>
                </div>
            </div>

            <!-- BLOQUE 4: Internacional / Aduana -->
            <div id="fase-b4" style="display:none; gap:1rem; flex-direction:column; padding:15px; border-left:3px solid var(--info-blue); background:rgba(0,100,255,0.05);">
                <h4>Tracking Aéreo / Internacional</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Fecha Recepción en Bodega USA</label><input type="date" name="usa_bodega_fecha" value="${data.usa_bodega_fecha || ''}"></div>
                    <div><label>Fecha Despacho Hacia COL</label><input type="date" name="int_fecha_envio" value="${data.int_fecha_envio || ''}"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                     <div><label>Guía Consolidada (Aerolínea/Tracking Int)</label><input type="text" name="int_guia" value="${data.int_guia || data.id_seguimiento_internacional || ''}"></div>
                     <div><label>Courier Int. (Paquetería)</label><input type="text" name="paq" value="${data.paqueteria || ''}"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr; gap:1rem;">
                     <div><label>URL Tracking Internacional</label><input type="url" name="int_url" value="${data.int_url || ''}"></div>
                </div>
            </div>
            
            <!-- BLOQUE 5: Bodega Colombia -->
            <div id="fase-b5" style="display:none; gap:1rem; flex-direction:column; padding:15px; border-left:3px solid #ccc; background:rgba(255,255,255,0.05);">
                <h4>Arribo a Bodega Colombia (MDE)</h4>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Fecha de LLegada COL</label><input type="date" name="col_bodega_fecha" value="${data.col_bodega_fecha || ''}"></div>
                    <div>
                        <label>¿Notificado al Cliente?</label>
                        <select name="cliente_notificado">
                            <option value="No" ${data.cliente_notificado === 'No' || !data.cliente_notificado ? 'selected' : ''}>No, pendiente notificación</option>
                            <option value="Sí" ${data.cliente_notificado === 'Sí' ? 'selected' : ''}>Sí, cliente informado</option>
                        </select>
                    </div>
                </div>

                <div id="fase5-action-board" style="display:none; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:12px; padding:15px; margin-top:5px;">
                    <!-- Filled by JS with Client contact info and link to Sale -->
                </div>

                <div style="margin-top:0.5rem;">
                    <label>Foto Recibido Colombia (Opcional)</label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="width:60px; height:60px; border-radius:8px; overflow:hidden; background:var(--glass-hover); border:1px solid var(--glass-border); display:flex; justify-content:center; align-items:center;">
                            <img id="col-preview" src="${data.col_bodega_foto || ''}" style="${data.col_bodega_foto ? 'width:100%; height:100%; object-fit:cover;' : 'display:none;'}">
                            <span id="col-ph" style="font-size:0.6rem; opacity:0.5; text-align:center; ${data.col_bodega_foto ? 'display:none;' : ''}">SIN<br>FOTO</span>
                        </div>
                        <div style="flex:1;">
                            <input type="file" id="col-foto-input" accept="image/*" style="font-size:0.8rem; padding:8px; width:100%; border:1px dashed var(--glass-border); border-radius:8px; cursor:pointer;">
                            <input type="hidden" name="col_bodega_foto" value="${data.col_bodega_foto || ''}">
                        </div>
                    </div>
                </div>
            </div>

            <!-- BLOQUE 6: Entregado Cliente Final -->
            <div id="fase-b6" style="display:none; gap:1rem; flex-direction:column; padding:15px; border-left:3px solid var(--success-green); background:rgba(0,255,0,0.05);">
                <h4>Despacho a Cliente Final</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Empresa Transporte COL</label>
                         <select name="cli_empresa">
                            <option value="">-- Parametrizar Option --</option>
                            ${transpCOL.map(t => `<option value="${t.valor}" ${data.cli_empresa === t.valor ? 'selected' : ''}>${t.valor}</option>`).join('')}
                         </select>
                    </div>
                    <div><label>Guía Nacional</label><input type="text" name="cli_guia" value="${data.cli_guia || ''}"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                    <div><label>Fecha Envío Local</label><input type="date" name="cli_fecha_envio" value="${data.cli_fecha_envio || ''}"></div>
                    <div><label>URL Tracking Local</label><input type="url" name="cli_url" value="${data.cli_url || ''}"></div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:5px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
                    <div>
                        <label>Estado de Recepción</label>
                        <select name="cli_estado_entrega">
                            <option value="En Tránsito" ${data.cli_estado_entrega === 'En Tránsito' || !data.cli_estado_entrega ? 'selected' : ''}>🚚 En Tránsito Local</option>
                            <option value="Recibido" ${data.cli_estado_entrega === 'Recibido' ? 'selected' : ''}>✅ Entregado al Cliente Final</option>
                        </select>
                    </div>
                    <div><label>Fecha Recibido</label><input type="date" name="cli_fecha_recibido" value="${data.cli_fecha_recibido || ''}"></div>
                </div>
            </div>

            <!-- GLOBALES -->
            <hr style="opacity:0.2;">
            <div style="display:grid; grid-template-columns:1fr; gap:1rem;">
               <div><label>Añadir Nota / Comentario al Historial</label><input type="text" name="notas_fase" value="" placeholder="Opcional. Breve novedad en este estado."></div>
               <div style="display:none;"><label>Ubicación Actual Histórica</label><input type="text" name="ubi" value="${data.ubicacion}"></div>
               <input type="hidden" name="id_seguimiento_internacional" value="${data.id_seguimiento_internacional || ''}">
            </div>

            <div style="display:flex; gap:15px; margin-top:0.5rem;">
               <button type="submit" class="btn-primary" style="flex:1;">Guardar Fase</button>
               <button type="button" onclick="window.closeModal()" style="flex:1; background:none; border:1px solid var(--glass-border); color:var(--text-main); border-radius:16px;">Cerrar</button>
            </div>
        </form>
    `;
    
    container.style.display = 'flex';
    
    // UI logic for form dynamic display
    const applyDynamicFields = () => {
        const fsel = document.getElementById('log-fase-select');
        if(!fsel) return;
        const val = fsel.value;

        // Hide all initially
        document.getElementById('fase-b12').style.display = 'none';
        document.getElementById('fase-b3').style.display  = 'none';
        document.getElementById('fase-b4').style.display  = 'none';
        document.getElementById('fase-b5').style.display  = 'none';
        document.getElementById('fase-b6').style.display  = 'none';

        if(val.includes('1.') || val.includes('2.')) {
            document.getElementById('fase-b12').style.display = 'flex';
        } else if (val.includes('3.')) {
            document.getElementById('fase-b12').style.display = 'flex'; // show prev
            document.getElementById('fase-b3').style.display = 'flex';
        } else if (val.includes('4.')) {
            document.getElementById('fase-b4').style.display = 'flex';
        } else if (val.includes('5.')) {
            document.getElementById('fase-b4').style.display = 'flex'; // show prev related
            document.getElementById('fase-b5').style.display = 'flex';
        } else if (val.includes('6.')) {
            document.getElementById('fase-b6').style.display = 'flex';
        }
    };

    const fsel = document.getElementById('log-fase-select');
    if (fsel) { fsel.addEventListener('change', applyDynamicFields); applyDynamicFields(); }

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
                    alert(`⚠️ ALERTA DE RECAUDO ⚠️\n\nNo puedes avanzar este envío a la fase "6. Entregado a Cliente Final" porque hay un saldo pendiente por cobrar de $${saldoVal.toLocaleString('es-CO')} COP.\n\nDebes ir primero a la Orden de Venta y asentar el pago para que el saldo quede en $0 antes de entregar el producto.`);
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
            'cli_guia','cli_empresa','cli_url','cli_fecha_envio','cli_estado_entrega','cli_fecha_recibido'
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
        } catch(e) {
            showToast("Hubo un error subiendo la fotografía: " + e.message, "error");
            btn.disabled = false; btn.innerText = "Guadar Fase";
            return;
        }

        btn.innerHTML = '<i class="loader"></i> Finalizando Registro...';
        
        try { 
            const res = await db.postData('Logistica', payload, mode); 
            if(res.error) throw new Error(res.error);
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
