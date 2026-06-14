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
    console.log(`[DEV] OTP para ${telefono}: ${otp}`)
    return { ok: true, dev: true }
  }
  const mensaje = `Tu código de verificación para el portal de *Importaciones Jarapo* es:\n\n*${otp}*\n\nVálido por 10 minutos. No lo compartas.`
  const telefonoCompleto = `57${telefono}`
  try {
    // Paso 1: Buscar el contacto en Kommo por teléfono
    console.log('[Kommo] Token primeros 20 chars:', accessToken?.substring(0, 20))
    console.log('[Kommo] Subdomain:', subdomain)
    const busquedaRes = await fetch(
      `https://${subdomain}.kommo.com/api/v4/contacts?query=${telefonoCompleto}&limit=1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    )
    const busquedaText = await busquedaRes.text()
    console.log('[Kommo] Búsqueda raw:', busquedaRes.status, busquedaText.substring(0, 200))
    let busquedaData = {}
    try { busquedaData = JSON.parse(busquedaText) } catch(e) { console.error('[Kommo] Parse error búsqueda:', e.message) }
    const contactId = busquedaData?._embedded?.contacts?.[0]?.id
    console.log('[Kommo] ContactId encontrado:', contactId)
    if (!contactId) {
      console.warn('[Kommo] Contacto no encontrado para:', telefonoCompleto)
      // Intentar envío directo por número sin contacto
      const directRes = await fetch(
        `https://${subdomain}.kommo.com/api/v4/chats/template`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: telefonoCompleto, message: mensaje })
        }
      )
      const directData = await directRes.json()
      console.log('[Kommo] Envío directo:', JSON.stringify(directData))
      return { ok: directRes.ok, data: directData }
    }
    // Paso 2: Enviar mensaje WhatsApp via Kommo
    // Intentar con el endpoint correcto de chats
    const msgRes = await fetch(
      `https://${subdomain}.kommo.com/api/v4/contacts/${contactId}/chats`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: mensaje })
      }
    )
    const msgText = await msgRes.text()
    console.log('[Kommo] Respuesta envío (raw):', msgRes.status, msgText.substring(0, 300))
    let msgData = {}
    try { msgData = JSON.parse(msgText) } catch { msgData = { raw: msgText } }
    return { ok: msgRes.ok, data: msgData }
  } catch (err) {
    console.error('[Kommo] Error:', err)
    return { ok: false, error: err.message }
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const res = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) })

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' }

  const { accion, telefono, otp, token_portal } = JSON.parse(event.body || '{}')

  // ── SOLICITAR OTP ──
  if (accion === 'solicitar') {
    if (!telefono) return res(400, { error: 'telefono requerido' })

    const { count } = await supabase
      .from('portal_otps').select('*', { count: 'exact', head: true })
      .eq('whatsapp', telefono)
      .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

    if (count >= 3) return res(429, { error: 'Demasiados intentos. Espera 10 minutos.' })

    const { data: byWA, error: errWA } = await supabase
      .from('Clientes').select('id').ilike('whatsapp', `%${telefono}%`).limit(1)
    if (errWA) return res(500, { error: 'DB whatsapp: ' + errWA.message })

    let cliente = byWA?.[0] || null

    if (!cliente) {
      const { data: byTel, error: errTel } = await supabase
        .from('Clientes').select('id').eq('telefono', telefono).maybeSingle()
      if (errTel) return res(500, { error: 'DB telefono: ' + errTel.message })
      cliente = byTel || null
    }

    if (!cliente) return res(404, { error: 'Número no registrado. Contacta a Importaciones Jarapo.' })

    const codigo = generarOTP()
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const { error: insertErr } = await supabase
      .from('portal_otps')
      .insert({ whatsapp: telefono, otp_code: codigo, expires_at })
    if (insertErr) {
      console.error('[OTP] Error insertando:', insertErr)
      return res(500, { error: 'Error generando código: ' + insertErr.message })
    }
    console.log('[OTP] Insert exitoso para', telefono)
    await enviarOTPWhatsApp({ telefono, otp: codigo })

    return res(200, { ok: true, mensaje: 'Código enviado por WhatsApp' })
  }

  // ── VERIFICAR OTP ──
  if (accion === 'verificar') {
    if (!telefono || !otp) return res(400, { error: 'telefono y otp requeridos' })

    const { data: registro } = await supabase
      .from('portal_otps').select('*')
      .eq('whatsapp', telefono).eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()

    if (!registro) return res(400, { error: 'Código inválido o expirado' })

    if (registro.attempts >= 5) {
      await supabase.from('portal_otps').update({ used: true }).eq('id', registro.id)
      return res(400, { error: 'Demasiados intentos. Solicita un nuevo código.' })
    }

    if (registro.otp_code !== otp) {
      await supabase.from('portal_otps').update({ attempts: registro.attempts + 1 }).eq('id', registro.id)
      return res(400, { error: 'Código incorrecto' })
    }

    await supabase.from('portal_otps').update({ used: true }).eq('id', registro.id)

    const { data: clientes2 } = await supabase
      .from('Clientes').select('id, nombre, portal_token')
      .or(`whatsapp.ilike.%${telefono}%,telefono.ilike.%${telefono}%`)
      .limit(1)
    const cliente = clientes2?.[0] || null
    if (!cliente) return res(400, { error: 'Cliente no encontrado' })

    let portalToken = cliente.portal_token
    if (!portalToken) {
      portalToken = crypto.randomBytes(32).toString('hex')
      await supabase.from('Clientes').update({ portal_token: portalToken }).eq('id', cliente.id)
      await supabase.from('portal_tokens').insert({ cliente_id: cliente.id, token: portalToken })
    }

    await supabase.from('portal_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', portalToken)

    return res(200, { ok: true, token: portalToken, nombre: cliente.nombre, redirect: `/portal?t=${portalToken}` })
  }

  // ── VALIDAR TOKEN ──
  if (accion === 'validar_token') {
    if (!token_portal) return res(400, { error: 'token requerido' })

    // Buscar primero en portal_tokens
    const { data: tokenData } = await supabase
      .from('portal_tokens').select('cliente_id, expires_at, is_active')
      .eq('token', token_portal).maybeSingle()

    // Si no está en portal_tokens, buscar directamente en Clientes por portal_token
    let clienteId = tokenData?.cliente_id
    if (!tokenData) {
      const { data: clienteDirecto } = await supabase
        .from('Clientes').select('id')
        .eq('portal_token', token_portal).maybeSingle()
      if (clienteDirecto) clienteId = clienteDirecto.id
    }

    if (!clienteId) return res(401, { error: 'Token inválido o expirado' })

    // Si existe en portal_tokens, validar expiración
    if (tokenData && tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      return res(401, { error: 'Token expirado' })
    }

    // Actualizar last_used_at si existe en portal_tokens
    if (tokenData) {
      await supabase.from('portal_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('token', token_portal)
    }

    const { data: cliente } = await supabase
      .from('Clientes').select('id, nombre, whatsapp').eq('id', clienteId).single()

    return res(200, { ok: true, cliente })
  }

  return res(400, { error: 'Acción no reconocida' })
}
