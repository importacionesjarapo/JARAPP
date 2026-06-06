const NIVEL_COLORES = {
  danger:  { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.3)',  text: '#ef4444' },
  warning: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
  info:    { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6' },
};

function _detalleItem(d, c) {
  const waLink = d.wa
    ? `<a href="https://wa.me/57${d.wa.replace(/\D/g, '')}" target="_blank"
         onclick="event.stopPropagation()"
         style="font-size:10px;padding:3px 8px;border-radius:99px;background:#25D366;color:#fff;text-decoration:none;font-weight:600;white-space:nowrap;flex-shrink:0;line-height:1.4;">
         📱 WA
       </a>`
    : '';

  const saldoHtml  = d.saldo ? `<span style="font-size:11px;color:${c.text};opacity:0.8;">$${Number(d.saldo).toLocaleString('es-CO')}</span>` : '';
  const faseHtml   = d.fase  ? `<span style="font-size:10px;color:${c.text};opacity:0.65;background:rgba(0,0,0,0.07);padding:1px 6px;border-radius:99px;white-space:nowrap;">${d.fase}</span>` : '';
  const diasHtml   = d.dias  ? `<span style="font-size:10px;color:${c.text};opacity:0.65;">${d.dias}d</span>` : '';

  return `
  <div class="alerta-detalle-item"
    data-tipo="${d.tipo || ''}"
    data-id="${d.id || ''}"
    data-venta-id="${d.venta_id || d.id || ''}"
    style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.06);border:0.5px solid ${c.border};transition:background 0.15s;"
    onmouseover="this.style.background='rgba(255,255,255,0.12)'"
    onmouseout="this.style.background='rgba(255,255,255,0.06)'">
    <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden;">
      <span style="font-size:11px;color:${c.text};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${d.nombre}</span>
      ${saldoHtml}${faseHtml}${diasHtml}
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:6px;">
      ${waLink}
      <span style="font-size:11px;color:${c.text};opacity:0.5;">→</span>
    </div>
  </div>`;
}

export function renderAlertasPanel(alertas) {
  if (!alertas?.length) return '';

  const hasDanger   = alertas.some(a => a.nivel === 'danger');
  const totalCount  = alertas.length;
  const headerColor = hasDanger ? '#ef4444' : '#f59e0b';

  return `
  <div id="alertas-inteligentes-panel" style="margin-bottom:1.2rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.65rem;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.68rem;text-transform:uppercase;letter-spacing:2px;font-weight:800;color:${headerColor};">
          ${hasDanger ? '🚨' : '⚠️'} Alertas del Sistema
        </span>
        <span style="background:${headerColor};color:#fff;font-size:0.56rem;font-weight:800;padding:1px 7px;border-radius:10px;">${totalCount}</span>
      </div>
      <button onclick="window._refrescarAlertas?.()"
        style="font-size:0.63rem;padding:3px 10px;border-radius:7px;border:1px solid var(--border-base);background:none;color:var(--text-faint);cursor:pointer;font-family:inherit;"
        onmouseover="this.style.color='var(--text-main)'" onmouseout="this.style.color='var(--text-faint)'">
        ↻ Refrescar
      </button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${alertas.map(a => {
        const c = NIVEL_COLORES[a.nivel] || NIVEL_COLORES.info;
        const detalleHtml = a.detalle?.length ? `
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
            ${a.detalle.map(d => _detalleItem(d, c)).join('')}
          </div>` : '';
        return `
        <div data-modulo="${a.modulo}"
          style="background:${c.bg};border:1px solid ${c.border};border-radius:12px;padding:0.85rem 1rem;">
          <div onclick="window._navigateTo('${a.modulo}')"
            style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;${a.detalle?.length ? 'margin-bottom:0;' : ''}"
            onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:1.05rem;">${a.icono}</span>
              <span style="font-size:0.79rem;font-weight:700;color:${c.text};">${a.titulo}</span>
            </div>
            <span style="font-size:0.63rem;color:${c.text};opacity:0.7;flex-shrink:0;margin-left:8px;">Ver →</span>
          </div>
          ${detalleHtml}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}
