/**
 * JARAPP — Modo Viaje EEUU
 * Gestión de gastos de viaje y distribución de costos entre productos importados.
 * Solo accesible para admin y gerente.
 */

import { auth } from '../auth.js';
import { ViajeService, ViajeState } from '../services/viajes.js';
import { formatCOP, showToast } from '../utils.js';

let _rl = null;
let _nav = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => parseFloat(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUSD = (n) => `$${fmt(n)}`;
const diasDesde = (fecha) => {
  if (!fecha) return 0;
  return Math.floor((Date.now() - new Date(fecha)) / 86400000);
};
const hoy = () => new Date().toISOString().split('T')[0];

const margenColor = (pct) => {
  if (pct === null || pct === undefined) return '';
  if (pct < 20) return 'background:rgba(239,68,68,0.08);color:#ef4444;';
  if (pct < 30) return 'background:rgba(234,179,8,0.08);color:#ca8a04;';
  return 'background:rgba(34,197,94,0.08);color:#16a34a;';
};
const margenIcon = (pct) => {
  if (pct === null || pct === undefined) return '';
  if (pct < 20) return ' ⚠️';
  if (pct < 30) return ' ~';
  return ' ✓';
};

// ─── Pantalla vacía (sin viaje activo) ───────────────────────────────────────
const renderSinViaje = async () => {
  let historial = [];
  try { historial = await ViajeService.getHistorial(); } catch(e) { /* sin historial */ }

  const histHTML = historial.length === 0 ? '' : `
    <div style="margin-top:2.5rem;width:100%;max-width:900px;">
      <h3 style="font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-faint);margin-bottom:1rem;">Historial de viajes</h3>
      <div style="overflow-x:auto;border-radius:12px;border:1px solid var(--border-base);">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
          <thead>
            <tr style="background:var(--surface-2);border-bottom:1px solid var(--border-base);">
              <th style="padding:10px 14px;text-align:left;font-weight:700;opacity:0.6;">Nombre</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;opacity:0.6;">Destino</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;opacity:0.6;">Inicio</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;opacity:0.6;">Cierre</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;opacity:0.6;">Gasto total USD</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;opacity:0.6;">Modo</th>
            </tr>
          </thead>
          <tbody>
            ${historial.map((v, i) => {
              const gTotal = (
                parseFloat(v.gasto_tiquetes||0) + parseFloat(v.gasto_hotel||0) +
                parseFloat(v.gasto_flete||0) + parseFloat(v.gasto_overweight||0) +
                parseFloat(v.gasto_vehiculo||0) + parseFloat(v.gasto_gasolina||0) +
                parseFloat(v.gasto_telefonia||0) + parseFloat(v.gasto_cajas||0) +
                parseFloat(v.gasto_compras_outlet||0) + parseFloat(v.gasto_otros||0) +
                parseFloat(v.gasto_alimentacion||0) + parseFloat(v.gasto_parques||0) +
                parseFloat(v.gasto_compras_personales||0)
              );
              return `
              <tr style="border-bottom:1px solid var(--border-base);${i % 2 === 1 ? 'background:var(--surface-1);' : ''}">
                <td style="padding:10px 14px;font-weight:600;">${v.nombre}</td>
                <td style="padding:10px 14px;opacity:0.7;">📍 ${v.destino}</td>
                <td style="padding:10px 14px;text-align:center;opacity:0.7;">${v.fecha_inicio || '—'}</td>
                <td style="padding:10px 14px;text-align:center;opacity:0.7;">${v.fecha_fin || '—'}</td>
                <td style="padding:10px 14px;text-align:right;font-weight:700;">${fmtUSD(gTotal)}</td>
                <td style="padding:10px 14px;text-align:center;">
                  <span style="font-size:0.7rem;padding:2px 8px;border-radius:8px;background:var(--surface-3);font-weight:600;">
                    ${v.modo_distribucion === 'uniforme' ? 'Uniforme' : 'Por valor'}
                  </span>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  _rl(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;gap:1.2rem;padding:2rem;text-align:center;">
      <div style="font-size:4rem;line-height:1;">✈️</div>
      <h1 style="font-size:1.6rem;font-weight:900;margin:0;">No hay viaje activo</h1>
      <p style="color:var(--text-faint);max-width:420px;line-height:1.6;margin:0;font-size:0.9rem;">
        Los viajes a EEUU permiten calcular el costo real de cada producto importado distribuyendo los gastos de tiquetes, hotel, flete y overweight.
      </p>
      <button onclick="window.viajeIniciarModal()" style="margin-top:0.5rem;padding:12px 28px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:8px;">
        ✈️ Iniciar viaje a EEUU
      </button>
      ${histHTML}
    </div>

    <!-- Modal iniciar viaje -->
    <div id="viaje-modal-iniciar" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:var(--surface-0);border:1px solid var(--border-base);border-radius:16px;padding:2rem;width:100%;max-width:480px;margin:1rem;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <h2 style="margin:0;font-size:1.2rem;font-weight:800;">✈️ Iniciar viaje a EEUU</h2>
          <button onclick="document.getElementById('viaje-modal-iniciar').style.display='none'" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-faint);">×</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div>
            <label style="font-size:0.78rem;font-weight:700;opacity:0.7;display:block;margin-bottom:4px;">Nombre del viaje *</label>
            <input id="vi-nombre" type="text" placeholder="Viaje Orlando Ago 2026" style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border-base);background:var(--surface-1);color:var(--text-main);font-size:0.88rem;font-family:inherit;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;opacity:0.7;display:block;margin-bottom:4px;">Destino</label>
            <input id="vi-destino" type="text" placeholder="Orlando, EEUU" value="Orlando, EEUU" style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border-base);background:var(--surface-1);color:var(--text-main);font-size:0.88rem;font-family:inherit;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;opacity:0.7;display:block;margin-bottom:4px;">Fecha de inicio *</label>
            <input id="vi-fecha" type="date" value="${hoy()}" style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border-base);background:var(--surface-1);color:var(--text-main);font-size:0.88rem;font-family:inherit;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;opacity:0.7;display:block;margin-bottom:6px;">Modo de distribución de gastos</label>
            <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--border-base);border-radius:9px;cursor:pointer;margin-bottom:6px;background:var(--surface-1);">
              <input type="radio" name="vi-modo" value="uniforme" checked style="margin-top:2px;accent-color:var(--primary);">
              <div>
                <div style="font-size:0.85rem;font-weight:700;">Uniforme</div>
                <div style="font-size:0.72rem;opacity:0.6;line-height:1.4;">Divide el gasto total equitativamente entre todos los productos del viaje</div>
              </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--border-base);border-radius:9px;cursor:pointer;background:var(--surface-1);">
              <input type="radio" name="vi-modo" value="por_valor" style="margin-top:2px;accent-color:var(--primary);">
              <div>
                <div style="font-size:0.85rem;font-weight:700;">Por valor</div>
                <div style="font-size:0.72rem;opacity:0.6;line-height:1.4;">Proporcional al costo de cada producto (los más caros absorben más gastos)</div>
              </div>
            </label>
          </div>
          <div>
            <label style="font-size:0.78rem;font-weight:700;opacity:0.7;display:block;margin-bottom:4px;">Notas (opcional)</label>
            <textarea id="vi-notas" rows="2" placeholder="Ej: Compras para temporada escolar 2026..." style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border-base);background:var(--surface-1);color:var(--text-main);font-size:0.85rem;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:1.5rem;">
          <button onclick="document.getElementById('viaje-modal-iniciar').style.display='none'" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border-base);background:none;color:var(--text-muted);font-size:0.88rem;font-weight:600;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button onclick="window.viajeIniciarConfirm()" id="vi-btn-iniciar" style="flex:2;padding:11px;border-radius:9px;border:none;background:var(--primary);color:#fff;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;">✈️ Iniciar viaje</button>
        </div>
      </div>
    </div>
  `);

  window.viajeIniciarModal = () => {
    document.getElementById('viaje-modal-iniciar').style.display = 'flex';
  };

  window.viajeIniciarConfirm = async () => {
    const nombre = document.getElementById('vi-nombre').value.trim();
    const destino = document.getElementById('vi-destino').value.trim() || 'Orlando, EEUU';
    const fecha_inicio = document.getElementById('vi-fecha').value;
    const modo_distribucion = document.querySelector('input[name="vi-modo"]:checked')?.value || 'uniforme';
    const notas = document.getElementById('vi-notas').value.trim();

    if (!nombre) { showToast('El nombre del viaje es obligatorio', 'error'); return; }
    if (!fecha_inicio) { showToast('La fecha de inicio es obligatoria', 'error'); return; }

    const btn = document.getElementById('vi-btn-iniciar');
    btn.disabled = true; btn.textContent = 'Iniciando…';

    try {
      await ViajeService.iniciar({ nombre, destino, fecha_inicio, modo_distribucion, notas });
      showToast(`Viaje "${nombre}" iniciado ✈️`, 'success');
      renderViaje(_rl, _nav);
    } catch(e) {
      showToast(e.message, 'error');
      btn.disabled = false; btn.textContent = '✈️ Iniciar viaje';
    }
  };
};

// ─── Vista con viaje activo ───────────────────────────────────────────────────
const renderConViaje = async (viaje) => {
  const dias = diasDesde(viaje.fecha_inicio);
  const gastoNegocio = (
    parseFloat(viaje.gasto_tiquetes||0) + parseFloat(viaje.gasto_hotel||0) +
    parseFloat(viaje.gasto_flete||0) + parseFloat(viaje.gasto_overweight||0) +
    parseFloat(viaje.gasto_vehiculo||0) + parseFloat(viaje.gasto_gasolina||0) +
    parseFloat(viaje.gasto_telefonia||0) + parseFloat(viaje.gasto_cajas||0) +
    parseFloat(viaje.gasto_compras_outlet||0) + parseFloat(viaje.gasto_otros||0)
  );
  const gastoPersonal = (
    parseFloat(viaje.gasto_alimentacion||0) + parseFloat(viaje.gasto_parques||0) +
    parseFloat(viaje.gasto_compras_personales||0) + parseFloat(viaje.gasto_personales_otros||0)
  );
  const gastoTotalViaje = gastoNegocio + gastoPersonal;

  let productos = [];
  try { productos = await ViajeService.getProductos(viaje.id); } catch(e) { /* vacío */ }

  const trm = window.JARAPP_TRM || 4200;

  const inversionTotal = productos.reduce((s, p) => s + parseFloat(p.precio_usd || 0), 0);
  const margenesValidos = productos
    .map(p => ViajeService.calcularMargenReal(
      parseFloat(p.precio_venta_cop || p.precio_cop || 0),
      parseFloat(p.costo_total_real_usd || p.precio_usd || 0),
      trm
    ))
    .filter(m => m !== null);
  const margenPromedio = margenesValidos.length > 0
    ? margenesValidos.reduce((s, m) => s + m, 0) / margenesValidos.length
    : null;

  const masRentable = productos.length > 0
    ? productos.reduce((best, p) => {
        const m = ViajeService.calcularMargenReal(
          parseFloat(p.precio_venta_cop || p.precio_cop || 0),
          parseFloat(p.costo_total_real_usd || p.precio_usd || 0),
          trm
        );
        if (m === null) return best;
        const bm = ViajeService.calcularMargenReal(
          parseFloat(best.precio_venta_cop || best.precio_cop || 0),
          parseFloat(best.costo_total_real_usd || best.precio_usd || 0),
          trm
        );
        return (m > (bm || -Infinity)) ? p : best;
      }, productos[0])
    : null;

  const tablaProductos = productos.length === 0
    ? `<tr><td colspan="8" style="text-align:center;padding:2rem;opacity:0.4;font-size:0.85rem;">Sin productos vinculados. Agrega compras al viaje.</td></tr>`
    : productos.map(p => {
        const margen = ViajeService.calcularMargenReal(
          parseFloat(p.precio_venta_cop || p.precio_cop || 0),
          parseFloat(p.costo_total_real_usd || p.precio_usd || 0),
          trm
        );
        const mc = margenColor(margen);
        const mi = margenIcon(margen);
        return `
        <tr style="border-bottom:1px solid var(--border-base);">
          <td style="padding:9px 12px;font-size:0.8rem;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.proveedor || p.descripcion || '—'}</td>
          <td style="padding:9px 12px;text-align:center;font-size:0.8rem;">${p.cantidad || 1}</td>
          <td style="padding:9px 12px;text-align:right;font-size:0.8rem;">${fmtUSD(p.precio_usd)}</td>
          <td style="padding:9px 12px;text-align:right;font-size:0.8rem;color:#eab308;">${fmtUSD(p.costo_viaje_usd)}</td>
          <td style="padding:9px 12px;text-align:right;font-size:0.8rem;font-weight:700;">${fmtUSD(p.costo_total_real_usd || p.precio_usd)}</td>
          <td style="padding:9px 12px;text-align:right;font-size:0.8rem;">${p.precio_venta_cop || p.precio_cop ? formatCOP(p.precio_venta_cop || p.precio_cop) : '—'}</td>
          <td style="padding:9px 12px;text-align:center;font-size:0.8rem;">${p.trm || trm}</td>
          <td style="padding:9px 12px;text-align:right;font-size:0.8rem;font-weight:700;border-radius:6px;${mc}">
            ${margen !== null ? `${margen.toFixed(1)}%${mi}` : '—'}
          </td>
        </tr>`;
      }).join('');

  const filaTotal = productos.length > 0 ? `
    <tr style="background:var(--surface-2);font-weight:700;border-top:2px solid var(--border-base);">
      <td style="padding:9px 12px;font-size:0.8rem;" colspan="2">TOTALES</td>
      <td style="padding:9px 12px;text-align:right;font-size:0.8rem;">${fmtUSD(inversionTotal)}</td>
      <td style="padding:9px 12px;text-align:right;font-size:0.8rem;color:#eab308;">${fmtUSD(gastoNegocio)}</td>
      <td style="padding:9px 12px;text-align:right;font-size:0.8rem;">${fmtUSD(inversionTotal + gastoNegocio)}</td>
      <td colspan="2"></td>
      <td style="padding:9px 12px;text-align:right;font-size:0.8rem;${margenColor(margenPromedio)}">
        ${margenPromedio !== null ? `${margenPromedio.toFixed(1)}% prom.` : '—'}
      </td>
    </tr>` : '';

  _rl(`
    <!-- Banner viaje activo -->
    <div style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:14px;padding:1.2rem 1.5rem;margin-bottom:1.5rem;color:#fff;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;">
      <div style="display:flex;align-items:center;gap:14px;">
        <span style="font-size:2.2rem;">✈️</span>
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:1.1rem;font-weight:900;">${viaje.nombre}</span>
            <span style="font-size:0.7rem;font-weight:800;background:rgba(255,255,255,0.25);padding:2px 10px;border-radius:20px;letter-spacing:1px;">EN CURSO</span>
          </div>
          <div style="font-size:0.82rem;opacity:0.85;margin-top:3px;">📍 ${viaje.destino} · Inicio: ${viaje.fecha_inicio} · ${dias} día${dias !== 1 ? 's' : ''} activo</div>
          ${viaje.notas ? `<div style="font-size:0.75rem;opacity:0.7;margin-top:2px;font-style:italic;">${viaje.notas}</div>` : ''}
        </div>
      </div>
      <button onclick="window.viajeCerrarModal()" style="padding:9px 20px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.35);color:#fff;border-radius:9px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
        🔒 Cerrar viaje
      </button>
    </div>

    <!-- 4 KPI cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem;">
      <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:12px;padding:1rem;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;margin-bottom:6px;">💵 Inversión total USD</div>
        <div style="font-size:1.3rem;font-weight:900;">${fmtUSD(inversionTotal)}</div>
        <div style="font-size:0.7rem;opacity:0.45;margin-top:3px;">sin gastos de viaje</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:12px;padding:1rem;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;margin-bottom:6px;">📦 Productos vinculados</div>
        <div style="font-size:1.3rem;font-weight:900;">${productos.length}</div>
        <div style="font-size:0.7rem;opacity:0.45;margin-top:3px;">compras en este viaje</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:12px;padding:1rem;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;margin-bottom:6px;">📊 Margen promedio real</div>
        <div style="font-size:1.3rem;font-weight:900;${margenPromedio !== null ? (margenPromedio < 20 ? 'color:#ef4444;' : margenPromedio >= 30 ? 'color:#16a34a;' : 'color:#ca8a04;') : ''}">
          ${margenPromedio !== null ? `${margenPromedio.toFixed(1)}%` : '—'}
        </div>
        <div style="font-size:0.7rem;opacity:0.45;margin-top:3px;">TRM: $${trm.toLocaleString('es-CO')}</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:12px;padding:1rem;">
        <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;opacity:0.5;margin-bottom:6px;">🏆 Más rentable</div>
        <div style="font-size:0.95rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${masRentable ? (masRentable.proveedor || masRentable.descripcion || '—') : '—'}
        </div>
        <div style="font-size:0.7rem;opacity:0.45;margin-top:3px;">
          ${masRentable ? (() => {
            const m = ViajeService.calcularMargenReal(
              parseFloat(masRentable.precio_venta_cop || masRentable.precio_cop || 0),
              parseFloat(masRentable.costo_total_real_usd || masRentable.precio_usd || 0),
              trm
            );
            return m !== null ? `${m.toFixed(1)}% margen` : 'sin precio venta';
          })() : 'sin datos'}
        </div>
      </div>
    </div>

    <!-- Gastos del viaje -->
    <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem;">
      <h3 style="margin:0 0 1.4rem;font-size:0.95rem;font-weight:800;">💸 Gastos del viaje (USD)</h3>

      <!-- Grupo 1: Gastos del negocio -->
      <div style="margin-bottom:1.4rem;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.8rem;">
          <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:var(--primary);">💼 Gastos del negocio</span>
          <span style="font-size:0.66rem;color:var(--text-faint);font-style:italic;">— se distribuyen entre productos</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:0.7rem;">
          ${[
            { id: 'gasto_tiquetes',       label: '✈️ Tiquetes',              val: viaje.gasto_tiquetes       },
            { id: 'gasto_hotel',          label: '🏨 Hotel',                  val: viaje.gasto_hotel          },
            { id: 'gasto_flete',          label: '📦 Flete',                  val: viaje.gasto_flete          },
            { id: 'gasto_overweight',     label: '⚖️ Overweight',             val: viaje.gasto_overweight     },
            { id: 'gasto_vehiculo',       label: '🚗 Alquiler vehículo',      val: viaje.gasto_vehiculo       },
            { id: 'gasto_gasolina',       label: '⛽ Gasolina',               val: viaje.gasto_gasolina       },
            { id: 'gasto_telefonia',      label: '📱 Telefonía',              val: viaje.gasto_telefonia      },
            { id: 'gasto_cajas',          label: '📦 Cajas para envío',       val: viaje.gasto_cajas          },
            { id: 'gasto_compras_outlet', label: '🛍️ Compras outlets',        val: viaje.gasto_compras_outlet },
            { id: 'gasto_otros',          label: '💰 Otros negocio',          val: viaje.gasto_otros          },
          ].map(g => `
            <div>
              <label style="font-size:0.72rem;font-weight:700;opacity:0.65;display:block;margin-bottom:3px;">${g.label}</label>
              <input id="${g.id}" type="number" step="0.01" min="0" value="${parseFloat(g.val||0).toFixed(2)}"
                oninput="window.viajeRecalcTotal()"
                style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-base);background:var(--surface-0);color:var(--text-main);font-size:0.85rem;font-family:inherit;box-sizing:border-box;">
            </div>`).join('')}
        </div>
      </div>

      <!-- Grupo 2: Gastos personales -->
      <div style="margin-bottom:1.4rem;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.8rem;">
          <span style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-muted);">🎯 Gastos personales</span>
          <span style="font-size:0.66rem;color:var(--text-faint);font-style:italic;">— solo para control del viaje, no afectan costo del producto</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:0.7rem;">
          ${[
            { id: 'gasto_alimentacion',       label: '🍔 Alimentación',               val: viaje.gasto_alimentacion       },
            { id: 'gasto_parques',            label: '🎡 Parques y entretenimiento',   val: viaje.gasto_parques            },
            { id: 'gasto_compras_personales', label: '🛒 Compras personales',          val: viaje.gasto_compras_personales },
            { id: 'gasto_personales_otros',   label: '💰 Otros conceptos personales',  val: viaje.gasto_personales_otros   },
          ].map(g => `
            <div>
              <label style="font-size:0.72rem;font-weight:700;opacity:0.65;display:block;margin-bottom:3px;">${g.label}</label>
              <input id="${g.id}" type="number" step="0.01" min="0" value="${parseFloat(g.val||0).toFixed(2)}"
                oninput="window.viajeRecalcTotal()"
                style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--border-base);background:var(--surface-0);color:var(--text-main);font-size:0.85rem;font-family:inherit;box-sizing:border-box;opacity:0.85;">
            </div>`).join('')}
        </div>
      </div>

      <!-- Totales + tooltip + controles -->
      <div style="padding-top:1rem;border-top:1px solid var(--border-base);">
        <div style="display:flex;flex-wrap:wrap;gap:1.2rem;margin-bottom:0.7rem;">
          <div>
            <span style="font-size:0.7rem;opacity:0.5;">💼 Total negocio:</span>
            <span id="viaje-total-negocio" style="font-size:1rem;font-weight:900;margin-left:6px;color:var(--primary);">${fmtUSD(gastoNegocio)}</span>
          </div>
          <div>
            <span style="font-size:0.7rem;opacity:0.5;">🎯 Total personal:</span>
            <span id="viaje-total-personal" style="font-size:1rem;font-weight:700;margin-left:6px;opacity:0.6;">${fmtUSD(gastoPersonal)}</span>
          </div>
          <div>
            <span style="font-size:0.7rem;opacity:0.5;">✈️ Total viaje:</span>
            <span id="viaje-total-completo" style="font-size:1rem;font-weight:900;margin-left:6px;">${fmtUSD(gastoTotalViaje)}</span>
          </div>
        </div>
        <p style="font-size:0.68rem;color:var(--text-faint);margin:0 0 1rem;line-height:1.5;">
          ℹ️ Solo los gastos del negocio se distribuyen entre los productos para calcular el costo real de importación.
        </p>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;cursor:pointer;">
            <input type="radio" name="vj-modo" value="uniforme" ${viaje.modo_distribucion === 'uniforme' ? 'checked' : ''} style="accent-color:var(--primary);">
            <span><strong>Uniforme</strong> — divide equitativamente</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;cursor:pointer;">
            <input type="radio" name="vj-modo" value="por_valor" ${viaje.modo_distribucion === 'por_valor' ? 'checked' : ''} style="accent-color:var(--primary);">
            <span><strong>Por valor</strong> — proporcional al costo</span>
          </label>
          <button onclick="window.viajeGuardarGastos('${viaje.id}')" style="padding:9px 18px;background:var(--primary);color:#fff;border:none;border-radius:9px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
            💾 Guardar y redistribuir
          </button>
        </div>
      </div>
    </div>

    <!-- Tabla de productos -->
    <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:14px;padding:1.5rem;margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.8rem;">
        <h3 style="margin:0;font-size:0.95rem;font-weight:800;">📦 Productos del viaje</h3>
        <button onclick="window.viajeAgregarCompraModal('${viaje.id}')" style="padding:8px 16px;background:var(--surface-2);border:1px solid var(--border-base);color:var(--text-main);border-radius:9px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;">
          ➕ Agregar compra al viaje
        </button>
      </div>
      <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border-base);">
        <table style="width:100%;border-collapse:collapse;font-size:0.8rem;min-width:720px;">
          <thead>
            <tr style="background:var(--surface-2);border-bottom:1px solid var(--border-base);">
              <th style="padding:9px 12px;text-align:left;font-weight:700;opacity:0.6;">Producto</th>
              <th style="padding:9px 12px;text-align:center;font-weight:700;opacity:0.6;">Cant.</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;opacity:0.6;">Costo proveedor USD</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;opacity:0.6;">Costo viaje USD</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;opacity:0.6;">Costo real USD</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;opacity:0.6;">Precio venta COP</th>
              <th style="padding:9px 12px;text-align:center;font-weight:700;opacity:0.6;">TRM</th>
              <th style="padding:9px 12px;text-align:right;font-weight:700;opacity:0.6;">Margen REAL %</th>
            </tr>
          </thead>
          <tbody>
            ${tablaProductos}
            ${filaTotal}
          </tbody>
        </table>
      </div>
      ${productos.length > 0 ? `<p style="font-size:0.68rem;opacity:0.4;margin:8px 0 0;line-height:1.5;">TRM utilizado: $${trm.toLocaleString('es-CO')} · Rojo &lt;20% · Amarillo 20–30% · Verde &gt;30%</p>` : ''}
    </div>

    <!-- Modal cerrar viaje -->
    <div id="viaje-modal-cerrar" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:var(--surface-0);border:1px solid var(--border-base);border-radius:16px;padding:2rem;width:100%;max-width:440px;margin:1rem;">
        <h2 style="margin:0 0 0.8rem;font-size:1.1rem;font-weight:800;">🔒 Cerrar viaje</h2>
        <p style="font-size:0.85rem;opacity:0.7;line-height:1.6;margin-bottom:1.2rem;">
          Al cerrar el viaje se distribuirán los gastos finales entre todos los productos vinculados y el viaje quedará en estado <strong>cerrado</strong>. Esta acción no se puede deshacer.
        </p>
        <div style="background:var(--surface-2);border-radius:10px;padding:1rem;margin-bottom:1.2rem;font-size:0.82rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="opacity:0.6;">Viaje</span><strong>${viaje.nombre}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="opacity:0.6;">Productos</span><strong>${productos.length}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="opacity:0.6;">Inversión</span><strong>${fmtUSD(inversionTotal)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="opacity:0.6;">Gasto negocio</span><strong style="color:var(--primary);">${fmtUSD(gastoNegocio)}</strong></div>
          <div style="display:flex;justify-content:space-between;"><span style="opacity:0.6;">Total viaje completo</span><strong>${fmtUSD(gastoTotalViaje)}</strong></div>
        </div>
        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('viaje-modal-cerrar').style.display='none'" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border-base);background:none;color:var(--text-muted);font-size:0.88rem;font-weight:600;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button onclick="window.viajeCerrarConfirm('${viaje.id}')" id="vj-btn-cerrar" style="flex:2;padding:11px;border-radius:9px;border:none;background:#dc2626;color:#fff;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;">🔒 Confirmar cierre</button>
        </div>
      </div>
    </div>

    <!-- Modal agregar compra al viaje -->
    <div id="viaje-modal-compras" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:var(--surface-0);border:1px solid var(--border-base);border-radius:16px;padding:1.5rem;width:100%;max-width:640px;margin:1rem;max-height:80vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h2 style="margin:0;font-size:1rem;font-weight:800;">➕ Vincular compra al viaje</h2>
          <button onclick="document.getElementById('viaje-modal-compras').style.display='none'" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-faint);">×</button>
        </div>
        <div id="viaje-compras-lista" style="flex:1;overflow-y:auto;font-size:0.82rem;">
          <div style="text-align:center;padding:2rem;opacity:0.4;">Cargando compras disponibles…</div>
        </div>
      </div>
    </div>
  `);

  // ── Handlers globales ──────────────────────────────────────────────────────
  window.viajeRecalcTotal = () => {
    const idsNegocio = ['gasto_tiquetes','gasto_hotel','gasto_flete','gasto_overweight',
      'gasto_vehiculo','gasto_gasolina','gasto_telefonia','gasto_cajas','gasto_compras_outlet','gasto_otros'];
    const idsPersonal = ['gasto_alimentacion','gasto_parques','gasto_compras_personales','gasto_personales_otros'];
    const negocio = idsNegocio.reduce((s, id) => s + parseFloat(document.getElementById(id)?.value || 0), 0);
    const personal = idsPersonal.reduce((s, id) => s + parseFloat(document.getElementById(id)?.value || 0), 0);
    const elN = document.getElementById('viaje-total-negocio');
    const elP = document.getElementById('viaje-total-personal');
    const elT = document.getElementById('viaje-total-completo');
    if (elN) elN.textContent = fmtUSD(negocio);
    if (elP) elP.textContent = fmtUSD(personal);
    if (elT) elT.textContent = fmtUSD(negocio + personal);
  };

  window.viajeGuardarGastos = async (id) => {
    const gastos = {
      gasto_tiquetes:          parseFloat(document.getElementById('gasto_tiquetes')?.value          || 0),
      gasto_hotel:             parseFloat(document.getElementById('gasto_hotel')?.value             || 0),
      gasto_flete:             parseFloat(document.getElementById('gasto_flete')?.value             || 0),
      gasto_overweight:        parseFloat(document.getElementById('gasto_overweight')?.value        || 0),
      gasto_vehiculo:          parseFloat(document.getElementById('gasto_vehiculo')?.value          || 0),
      gasto_gasolina:          parseFloat(document.getElementById('gasto_gasolina')?.value          || 0),
      gasto_telefonia:         parseFloat(document.getElementById('gasto_telefonia')?.value         || 0),
      gasto_cajas:             parseFloat(document.getElementById('gasto_cajas')?.value             || 0),
      gasto_compras_outlet:    parseFloat(document.getElementById('gasto_compras_outlet')?.value    || 0),
      gasto_otros:             parseFloat(document.getElementById('gasto_otros')?.value             || 0),
      gasto_alimentacion:      parseFloat(document.getElementById('gasto_alimentacion')?.value      || 0),
      gasto_parques:           parseFloat(document.getElementById('gasto_parques')?.value           || 0),
      gasto_compras_personales: parseFloat(document.getElementById('gasto_compras_personales')?.value || 0),
      gasto_personales_otros:   parseFloat(document.getElementById('gasto_personales_otros')?.value   || 0),
      modo_distribucion: document.querySelector('input[name="vj-modo"]:checked')?.value || 'uniforme',
    };
    try {
      await ViajeService.actualizarGastos(id, gastos);
      showToast('Gastos guardados y costos redistribuidos ✓', 'success');
      renderViaje(_rl, _nav);
    } catch(e) {
      showToast(e.message, 'error');
    }
  };

  window.viajeCerrarModal = () => {
    document.getElementById('viaje-modal-cerrar').style.display = 'flex';
  };

  window.viajeCerrarConfirm = async (id) => {
    const btn = document.getElementById('vj-btn-cerrar');
    btn.disabled = true; btn.textContent = 'Cerrando…';
    try {
      await ViajeService.cerrar(id);
      showToast('Viaje cerrado correctamente 🔒', 'success');
      renderViaje(_rl, _nav);
    } catch(e) {
      showToast(e.message, 'error');
      btn.disabled = false; btn.textContent = '🔒 Confirmar cierre';
    }
  };

  window.viajeAgregarCompraModal = async (viajeId) => {
    document.getElementById('viaje-modal-compras').style.display = 'flex';
    const lista = document.getElementById('viaje-compras-lista');
    try {
      const compras = await ViajeService.getComprasSinViaje();
      if (compras.length === 0) {
        lista.innerHTML = `<div style="text-align:center;padding:2rem;opacity:0.4;">No hay compras sin viaje asignado</div>`;
        return;
      }
      lista.innerHTML = compras.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border-base);gap:1rem;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.proveedor || c.descripcion || '—'}</div>
            <div style="font-size:0.72rem;opacity:0.5;">${c.fecha_pedido || ''} · ${fmtUSD(c.precio_usd)} · Cant: ${c.cantidad || 1}</div>
          </div>
          <button onclick="window.viajeVincularCompra('${c.id}','${viajeId}')" style="padding:6px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
            Vincular
          </button>
        </div>`).join('');
    } catch(e) {
      lista.innerHTML = `<div style="text-align:center;padding:2rem;color:#ef4444;">${e.message}</div>`;
    }
  };

  window.viajeVincularCompra = async (compraId, viajeId) => {
    try {
      await ViajeService.vincularCompra(compraId, viajeId);
      showToast('Compra vinculada al viaje ✓', 'success');
      document.getElementById('viaje-modal-compras').style.display = 'none';
      renderViaje(_rl, _nav);
    } catch(e) {
      showToast(e.message, 'error');
    }
  };
};

// ─── PUNTO DE ENTRADA ─────────────────────────────────────────────────────────
export const renderViaje = async (renderLayout, navigateTo) => {
  _rl = renderLayout;
  _nav = navigateTo;

  // RBAC: solo admin y gerente
  const role = auth.getUserRole();
  if (!['admin', 'gerente'].includes(role)) {
    renderLayout(`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;gap:1rem;text-align:center;">
        <div style="font-size:3rem;">🔒</div>
        <h2 style="color:var(--text-main);">Acceso Restringido</h2>
        <p style="color:var(--text-faint);max-width:360px;">Solo administradores y gerentes pueden gestionar los viajes a EEUU.</p>
        <button style="padding:10px 24px;background:var(--primary);color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-family:inherit;" onclick="window._navigateTo('dashboard')">← Ir al Dashboard</button>
      </div>`);
    return;
  }

  // Loading state
  renderLayout(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:1rem;">
      <div class="loader"></div>
      <p style="opacity:0.5;font-size:0.9rem;">Cargando Modo Viaje…</p>
    </div>`);

  try {
    const viaje = await ViajeService.getActivo();
    if (viaje) {
      await renderConViaje(viaje);
    } else {
      await renderSinViaje();
    }
  } catch(e) {
    renderLayout(`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50vh;gap:1rem;text-align:center;">
        <div style="font-size:3rem;">⚠️</div>
        <h2 style="color:var(--text-main);">Error al cargar</h2>
        <p style="color:var(--text-faint);">${e.message}</p>
        <button style="padding:10px 24px;background:var(--primary);color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-family:inherit;" onclick="window._navigateTo('viaje')">Reintentar</button>
      </div>`);
  }
};
