// Fase 3 (#13): corre a diario (Netlify Scheduled Function, ver `config`
// al final) y le avisa por correo al/los admin(es) de cada empresa en
// trial/vencida cuya fecha_vencimiento cae dentro de los próximos 5 días
// — antes de que el guard de acceso en auth.js la bloquee o la pase a
// solo-lectura. Usa el mismo patrón de cliente service-role y envío por
// Resend que netlify/functions/admin-empresas.js.
import { createClient } from '@supabase/supabase-js'

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

const DIAS_AVISO = 5

function diasHasta(fechaStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const fecha = new Date(fechaStr + 'T00:00:00')
  return Math.round((fecha - hoy) / 86400000)
}

async function enviarCorreoAlerta({ email, nombreEmpresa, dias, esTrial }) {
  if (!process.env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurada' }
  const textoDias = dias <= 0 ? 'hoy' : `en ${dias} día${dias === 1 ? '' : 's'}`
  const asunto = esTrial ? `Tu prueba gratis de EncargosPro vence ${textoDias}` : `Tu suscripción a EncargosPro vence ${textoDias}`
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'EncargosPro <no-reply@mail.encargospro.com>',
        to: [email],
        subject: asunto,
        html: `<div style="background-color:#F2F3F6;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(22,27,46,0.08);">
            <tr><td style="background:#FFFFFF;padding:32px 32px 20px;text-align:center;border-bottom:1px solid rgba(22,27,46,0.08);">
              <img src="https://encargospro.com/logo-full.png" alt="EncargosPro" height="64" style="height:64px;">
            </td></tr>
            <tr><td style="padding:36px 32px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#161B2E;">${esTrial ? 'Tu prueba gratis está por vencer' : 'Tu suscripción está por vencer'}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5B6478;">
                La cuenta de <strong>${nombreEmpresa}</strong> en EncargosPro ${dias <= 0 ? 'vence hoy' : `vence en ${dias} día${dias === 1 ? '' : 's'}`}. Contrata un plan para no perder acceso a tu información.
              </p>
              <table role="presentation" style="margin:0 auto;"><tr><td style="border-radius:10px;background:#EA168F;">
                <a href="https://encargospro.com" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">Ver planes</a>
              </td></tr></table>
            </td></tr>
            <tr><td style="padding:20px 32px;background:#F8F9FB;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8891A6;">EncargosPro · Gestión para personal shoppers e importadores</p>
            </td></tr>
          </table>
        </div>`,
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
    console.error('[alertas-vencimiento] Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY')
    return new Response('Config faltante', { status: 500 })
  }

  const { data: empresas, error } = await supabase
    .from('Empresas')
    .select('id, nombre, estado_suscripcion, fecha_vencimiento, alerta_vencimiento_enviada_para')
    .in('estado_suscripcion', ['trial', 'vencida'])
    .not('fecha_vencimiento', 'is', null)
  if (error) {
    console.error('[alertas-vencimiento] Error listando empresas:', error.message)
    return new Response('Error', { status: 500 })
  }

  let enviados = 0
  for (const empresa of empresas || []) {
    const dias = diasHasta(empresa.fecha_vencimiento)
    if (dias < 0 || dias > DIAS_AVISO) continue
    if (empresa.alerta_vencimiento_enviada_para === empresa.fecha_vencimiento) continue

    const { data: admins } = await supabase
      .from('user_profiles').select('email')
      .eq('empresa_id', empresa.id).eq('role', 'admin').eq('is_active', true)
    const destinatarios = (admins || []).map(a => a.email).filter(Boolean)
    if (!destinatarios.length) continue

    let algunoEnviado = false
    for (const email of destinatarios) {
      const { enviado, error: errEnvio } = await enviarCorreoAlerta({
        email, nombreEmpresa: empresa.nombre, dias, esTrial: empresa.estado_suscripcion === 'trial',
      })
      if (enviado) algunoEnviado = true
      else console.warn(`[alertas-vencimiento] No se pudo avisar a ${email} (${empresa.nombre}):`, errEnvio)
    }

    if (algunoEnviado) {
      await supabase.from('Empresas')
        .update({ alerta_vencimiento_enviada_para: empresa.fecha_vencimiento })
        .eq('id', empresa.id)
      enviados++
    }
  }

  return new Response(JSON.stringify({ ok: true, empresasAvisadas: enviados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// Netlify Scheduled Function: corre todos los días a las 13:00 UTC
// (8:00 a.m. Colombia) — https://docs.netlify.com/functions/scheduled-functions/
export const config = {
  schedule: '0 13 * * *',
}
