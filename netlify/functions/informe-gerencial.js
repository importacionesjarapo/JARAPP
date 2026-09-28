// Fase 4 (#20): Netlify Scheduled Function (ver `config` al final) que le
// envía a diario un resumen de gestión del día anterior a los correos
// configurados en Admin → Correo Gerencial (Configuracion, clave
// 'CORREO_GERENCIAL', un registro por empresa). Mismo patrón de cliente
// service-role y envío por Resend que las otras funciones de este
// directorio.
//
// NOTA sobre el filtrado por "ayer": Ventas/Gastos no tienen una columna
// de fecha confiable para filtrar server-side (el campo "fecha" es texto
// con formato de locale del navegador, ej. "23/9/2026"). En cambio, el id
// de estas filas es siempre Date.now().toString() (ver sales.js/finance.js
// — 13 dígitos hasta el año ~2286), así que comparar el id como texto
// contra los límites del día en milisegundos da el mismo resultado que
// compararlo como número, sin necesitar un cast.
import { createClient } from '@supabase/supabase-js'

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

function limitesDeAyer() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1)
  return { inicioAyerMs: String(ayer.getTime()), inicioHoyMs: String(hoy.getTime()) }
}

function formatCOP(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-CO')
}

/** Envuelve el contenido del correo en un documento HTML completo que
 * fuerza modo claro siempre, sin importar el modo oscuro del dispositivo
 * — Gmail/Outlook/Apple Mail auto-invierten colores en correos sin estas
 * señales, y el logo (con fondo transparente) queda ilegible sobre un
 * fondo oscuro que nunca se diseñó para él. Mismo wrapper en las otras
 * funciones que envían correo (alertas-vencimiento.js, admin-empresas.js). */
function construirEmailHTML(contenidoInterior) {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title></title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color:#F2F3F6 !important; }
    .email-card, .email-card td { background-color:#FFFFFF !important; }
    .email-text { color:#161B2E !important; }
    .email-muted { color:#8891A6 !important; }
  }
  [data-ogsc] .email-bg { background-color:#F2F3F6 !important; }
  [data-ogsc] .email-card, [data-ogsc] .email-card td { background-color:#FFFFFF !important; }
  [data-ogsc] .email-text { color:#161B2E !important; }
  [data-ogsc] .email-muted { color:#8891A6 !important; }
</style>
</head>
<body class="email-bg" style="margin:0;padding:0;background-color:#F2F3F6;" bgcolor="#F2F3F6">
${contenidoInterior}
</body>
</html>`
}

async function enviarInformeGerencial({ email, empresa, resumen }) {
  if (!process.env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'EncargosPro <no-reply@mail.encargospro.com>',
        to: [email],
        subject: `Informe diario de ${empresa} — ${resumen.fechaLabel}`,
        html: construirEmailHTML(`<div class="email-bg" style="background-color:#F2F3F6;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;" bgcolor="#F2F3F6">
          <table role="presentation" width="100%" class="email-card" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(22,27,46,0.08);" bgcolor="#FFFFFF">
            <tr><td style="background:#FFFFFF;padding:32px 32px 20px;text-align:center;border-bottom:1px solid rgba(22,27,46,0.08);" bgcolor="#FFFFFF">
              <img src="https://encargospro.com/logo-full.png" alt="EncargosPro" height="56" style="height:56px;">
            </td></tr>
            <tr><td style="padding:32px;background:#FFFFFF;" bgcolor="#FFFFFF">
              <h1 class="email-text" style="margin:0 0 4px;font-size:19px;color:#161B2E;">Informe diario de gestión</h1>
              <p class="email-muted" style="margin:0 0 24px;font-size:13px;color:#8891A6;">${empresa} · ${resumen.fechaLabel}</p>
              <table role="presentation" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td class="email-muted" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;color:#5B6478;">Ventas registradas</td>
                  <td class="email-text" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;font-weight:700;color:#161B2E;text-align:right;">${resumen.numVentas}</td>
                </tr>
                <tr>
                  <td class="email-muted" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;color:#5B6478;">Total facturado</td>
                  <td class="email-text" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;font-weight:700;color:#161B2E;text-align:right;">${formatCOP(resumen.totalFacturado)}</td>
                </tr>
                <tr>
                  <td class="email-muted" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;color:#5B6478;">Ganancia calculada</td>
                  <td style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;font-weight:700;color:#0E9C5A;text-align:right;">${formatCOP(resumen.totalGanancia)}</td>
                </tr>
                <tr>
                  <td class="email-muted" style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;color:#5B6478;">Gastos del día</td>
                  <td style="padding:12px 0;border-bottom:1px solid #ECEDF2;font-size:14px;font-weight:700;color:#910E59;text-align:right;">${formatCOP(resumen.totalGastos)}</td>
                </tr>
                <tr>
                  <td class="email-muted" style="padding:12px 0;font-size:14px;color:#5B6478;">Cartera pendiente por cobrar</td>
                  <td class="email-text" style="padding:12px 0;font-size:14px;font-weight:700;color:#161B2E;text-align:right;">${formatCOP(resumen.carteraPendiente)}</td>
                </tr>
              </table>
              <p class="email-muted" style="margin:24px 0 0;font-size:12px;color:#8891A6;">Entra a EncargosPro para ver el detalle completo en el Dashboard.</p>
            </td></tr>
            <tr><td style="padding:20px 32px;background:#F8F9FB;text-align:center;" bgcolor="#F8F9FB">
              <p class="email-muted" style="margin:0;font-size:12px;color:#8891A6;">EncargosPro · Gestión para personal shoppers e importadores</p>
            </td></tr>
          </table>
        </div>`),
      }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      return { enviado: false, error: data.message || `Resend respondió ${resp.status}` }
    }
    return { enviado: true }
  } catch (err) {
    return { enviado: false, error: err.message }
  }
}

export default async () => {
  if (!supabase) {
    console.error('[informe-gerencial] Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY')
    return new Response('Config faltante', { status: 500 })
  }

  const { data: configs, error } = await supabase
    .from('Configuracion').select('empresa_id, valor').eq('clave', 'CORREO_GERENCIAL')
  if (error) {
    console.error('[informe-gerencial] Error listando configuraciones:', error.message)
    return new Response('Error', { status: 500 })
  }

  const { inicioAyerMs, inicioHoyMs } = limitesDeAyer()
  const fechaLabel = new Date(Number(inicioAyerMs)).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

  let enviados = 0
  for (const cfg of configs || []) {
    let parsed
    try { parsed = JSON.parse(cfg.valor || '{}') } catch { continue }
    const destinatarios = (parsed.destinatarios || []).filter(Boolean)
    if (!parsed.activo || !destinatarios.length || !cfg.empresa_id) continue

    const { data: empresaRow } = await supabase
      .from('Empresas').select('nombre').eq('id', cfg.empresa_id).maybeSingle()
    const nombreEmpresa = empresaRow?.nombre || 'Tu empresa'

    const { data: ventasAyer } = await supabase
      .from('Ventas').select('valor_total_cop, ganancia_calculada')
      .eq('empresa_id', cfg.empresa_id).gte('id', inicioAyerMs).lt('id', inicioHoyMs)
    const { data: ventasConSaldo } = await supabase
      .from('Ventas').select('saldo_pendiente').eq('empresa_id', cfg.empresa_id).gt('saldo_pendiente', 0)
    const { data: gastosAyer } = await supabase
      .from('Gastos').select('valor_cop')
      .eq('empresa_id', cfg.empresa_id).gte('id', inicioAyerMs).lt('id', inicioHoyMs)

    const resumen = {
      fechaLabel,
      numVentas: (ventasAyer || []).length,
      totalFacturado: (ventasAyer || []).reduce((a, v) => a + (parseFloat(v.valor_total_cop) || 0), 0),
      totalGanancia: (ventasAyer || []).reduce((a, v) => a + (parseFloat(v.ganancia_calculada) || 0), 0),
      totalGastos: (gastosAyer || []).reduce((a, g) => a + (parseFloat(g.valor_cop) || 0), 0),
      carteraPendiente: (ventasConSaldo || []).reduce((a, v) => a + (parseFloat(v.saldo_pendiente) || 0), 0),
    }

    for (const email of destinatarios) {
      const { enviado, error: errEnvio } = await enviarInformeGerencial({ email, empresa: nombreEmpresa, resumen })
      if (enviado) enviados++
      else console.warn(`[informe-gerencial] No se pudo enviar a ${email} (${nombreEmpresa}):`, errEnvio)
    }
  }

  return new Response(JSON.stringify({ ok: true, correosEnviados: enviados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// Netlify Scheduled Function: corre todos los días a las 11:00 UTC
// (6:00 a.m. Colombia) — https://docs.netlify.com/functions/scheduled-functions/
export const config = {
  schedule: '0 11 * * *',
}
