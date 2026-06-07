import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function validarFirmaKommo(body, signature) {
  if (!process.env.KOMMO_WEBHOOK_SECRET) return true
  const expected = crypto
    .createHmac('sha1', process.env.KOMMO_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''))
}

function generarToken() {
  return crypto.randomBytes(32).toString('hex')
}

function normalizarTelefono(tel) {
  if (!tel) return null
  const limpio = tel.replace(/\D/g, '')
  if (limpio.startsWith('57') && limpio.length === 12) return limpio.slice(2)
  if (limpio.length === 10) return limpio
  return limpio
}

async function enviarLinkPortalWhatsApp({ telefono, nombre, portalUrl, leadId }) {
  const subdomain = process.env.KOMMO_SUBDOMAIN
  const accessToken = process.env.KOMMO_ACCESS_TOKEN
  if (!subdomain || !accessToken) {
    console.warn('Kommo WA no configurado — omitiendo envío')
    return { ok: false }
  }
  const mensaje =
    `¡Hola ${nombre}! 👋\n\n` +
    `Tu pedido en *Importaciones Jarapo* ha sido confirmado. ` +
    `Puedes hacer seguimiento aquí:\n\n` +
    `🔗 ${portalUrl}\n\n` +
    `Guarda este link para ver el estado de tu pedido siempre. ¡Gracias! 🛍️`
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/talks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'leads', entity_id: leadId, origin: 'whatsapp', message: mensaje })
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('Error enviando WA:', err)
    return { ok: false }
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }

  const signature = event.headers['x-kommo-signature'] || event.headers['x-signature']
  if (!validarFirmaKommo(event.body, signature)) return { statusCode: 401, body: 'Unauthorized' }

  let payload
  try { payload = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

  const leads = payload?.leads?.update || payload?.leads?.add || []
  const ESTADO_GANADO_ID = parseInt(process.env.KOMMO_WON_STATUS_ID || '142')

  for (const lead of leads) {
    if (lead.status_id !== ESTADO_GANADO_ID) continue

    const leadId = lead.id?.toString()
    const camposContacto = lead._embedded?.contacts?.[0]?.custom_fields_values || []
    const campoTel = camposContacto.find(f => f.field_code === 'PHONE' || f.field_type === 'multitext')
    const telefono = normalizarTelefono(campoTel?.values?.[0]?.value || null)
    const nombreContacto = lead._embedded?.contacts?.[0]?.name || lead.name || 'Cliente'

    if (!telefono) continue

    let clienteId
    const { data: clienteExistente } = await supabase
      .from('Clientes').select('id, portal_token').eq('telefono', telefono).maybeSingle()

    if (clienteExistente) {
      clienteId = clienteExistente.id
      await supabase.from('Clientes').update({ numero_lead_kommo: leadId }).eq('id', clienteId)
    } else {
      const { data: nuevo, error } = await supabase
        .from('Clientes').insert({ nombre: nombreContacto, telefono, numero_lead_kommo: leadId, tipo_cliente: 'b2c' })
        .select('id').single()
      if (error) { console.error('Error creando cliente:', error); continue }
      clienteId = nuevo.id
    }

    let portalToken
    const { data: tokenExistente } = await supabase
      .from('portal_tokens').select('token').eq('cliente_id', clienteId).eq('is_active', true).maybeSingle()

    if (tokenExistente) {
      portalToken = tokenExistente.token
    } else {
      portalToken = generarToken()
      await supabase.from('portal_tokens').insert({ cliente_id: clienteId, token: portalToken })
      await supabase.from('Clientes').update({ portal_token: portalToken }).eq('id', clienteId)
    }

    const portalUrl = `${process.env.APP_URL}/portal?t=${portalToken}`
    await enviarLinkPortalWhatsApp({ telefono, nombre: nombreContacto, portalUrl, leadId })
    console.log(`Lead ${leadId} procesado — portal: ${portalUrl}`)
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
