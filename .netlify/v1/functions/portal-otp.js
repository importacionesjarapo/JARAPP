import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function generarOTP() {
  return String(crypto.randomInt(100000, 999999))
}

async function enviarOTPWhatsApp({ telefono, otp }) {
  const subdomain = process.env.KOMMO_SUBDOMAIN
  const accessToken = process.env.KOMMO_ACCESS_TOKEN
  if (!subdomain || !accessToken) {
    console.log(`OTP para ${telefono}: ${otp}`)
    return { ok: true, dev: true }
  }
  const mensaje = `Tu código de verificación para el portal de *Importaciones Jarapo* es:\n\n*${otp}*\n\nVálido por 10 minutos. No lo compartas.`
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/talks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `57${telefono}`, message: mensaje, origin: 'whatsapp' })
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('Error enviando OTP:', err)
    return { ok: false }
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const { accion, telefono, otp, token_portal } = JSON.parse(event.body || '{}')

  // ── SOLICITAR OTP ──
  if (accion === 'solicitar') {
    if (!telefono) return { statusCode: 400, body: JSON.stringify({ error: 'telefono requerido' }) }

    const { count } = await supabase
      .from('portal_otps').select('*', { count: 'exact', head: true })
      .eq('telefono', telefono)
      .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

    if (count >= 3) return { statusCode: 429, body: JSON.stringify({ error: 'Demasiados intentos. Espera 10 minutos.' }) }

    const { data: cliente } = await supabase
      .from('Clientes').select('id').eq('telefono', telefono).maybeSingle()

    if (!cliente) return { statusCode: 200, body: JSON.stringify({ ok: true, mensaje: 'Si el número está registrado, recibirás un código.' }) }

    const codigo = generarOTP()
    await supabase.from('portal_otps').insert({ telefono, otp_code: codigo })
    await enviarOTPWhatsApp({ telefono, otp: codigo })

    return { statusCode: 200, body: JSON.stringify({ ok: true, mensaje: 'Código enviado por WhatsApp' }) }
  }

  // ── VERIFICAR OTP ──
  if (accion === 'verificar') {
    if (!telefono || !otp) return { statusCode: 400, body: JSON.stringify({ error: 'telefono y otp requeridos' }) }

    const { data: registro } = await supabase
      .from('portal_otps').select('*')
      .eq('telefono', telefono).eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()

    if (!registro) return { statusCode: 400, body: JSON.stringify({ error: 'Código inválido o expirado' }) }

    if (registro.attempts >= 5) {
      await supabase.from('portal_otps').update({ used: true }).eq('id', registro.id)
      return { statusCode: 400, body: JSON.stringify({ error: 'Demasiados intentos. Solicita un nuevo código.' }) }
    }

    if (registro.otp_code !== otp) {
      await supabase.from('portal_otps').update({ attempts: registro.attempts + 1 }).eq('id', registro.id)
      return { statusCode: 400, body: JSON.stringify({ error: 'Código incorrecto' }) }
    }

    await supabase.from('portal_otps').update({ used: true }).eq('id', registro.id)

    const { data: cliente } = await supabase
      .from('Clientes').select('id, nombre, portal_token').eq('telefono', telefono).single()

    let portalToken = cliente.portal_token
    if (!portalToken) {
      portalToken = crypto.randomBytes(32).toString('hex')
      await supabase.from('Clientes').update({ portal_token: portalToken }).eq('id', cliente.id)
      await supabase.from('portal_tokens').insert({ cliente_id: cliente.id, token: portalToken })
    }

    await supabase.from('portal_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', portalToken)

    return { statusCode: 200, body: JSON.stringify({ ok: true, token: portalToken, nombre: cliente.nombre, redirect: `/portal?t=${portalToken}` }) }
  }

  // ── VALIDAR TOKEN ──
  if (accion === 'validar_token') {
    if (!token_portal) return { statusCode: 400, body: JSON.stringify({ error: 'token requerido' }) }

    const { data: tokenData } = await supabase
      .from('portal_tokens').select('cliente_id, expires_at, is_active')
      .eq('token', token_portal).maybeSingle()

    if (!tokenData || !tokenData.is_active || new Date(tokenData.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Token inválido o expirado' }) }
    }

    await supabase.from('portal_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token_portal)

    const { data: cliente } = await supabase
      .from('Clientes').select('id, nombre, telefono').eq('id', tokenData.cliente_id).single()

    return { statusCode: 200, body: JSON.stringify({ ok: true, cliente }) }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Acción no reconocida' }) }
}
