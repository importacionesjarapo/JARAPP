import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const APP_URL = process.env.APP_URL || 'https://app.encargospro.com'

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

/** Cada empresa registra su propio webhook de Kommo apuntando a esta misma
 * función con ?empresa=<slug> en la URL — así identificamos de qué tenant
 * es el lead sin depender de nada que Kommo incluya en el payload. */
async function resolverEmpresaPorSlug(slug) {
  if (!slug) return null
  const { data } = await supabase
    .from('Empresas').select('id, nombre, slug').eq('slug', slug).maybeSingle()
  return data || null
}

/** Integración de Kommo configurada por empresa en Parámetros (Configuracion,
 * claves KOMMO_*). Si una empresa no la configuró aún, se usan las variables
 * de entorno globales como respaldo transitorio (la cuenta de Kommo original
 * de Importaciones Jarapo), para no romper nada mientras cada tenant migra a
 * su propia integración. */
async function obtenerKommoConfig(empresaId) {
  const config = {
    subdomain: process.env.KOMMO_SUBDOMAIN || null,
    accessToken: process.env.KOMMO_ACCESS_TOKEN || null,
    estadoGanadoId: parseInt(process.env.KOMMO_WON_STATUS_ID || '142', 10),
    webhookSecret: process.env.KOMMO_WEBHOOK_SECRET || null,
  }
  if (!empresaId) return config
  const { data } = await supabase
    .from('Configuracion').select('clave, valor')
    .in('clave', ['KOMMO_SUBDOMAIN', 'KOMMO_ACCESS_TOKEN', 'KOMMO_WON_STATUS_ID', 'KOMMO_WEBHOOK_SECRET'])
    .eq('empresa_id', empresaId)
  ;(data || []).forEach(row => {
    if (row.clave === 'KOMMO_SUBDOMAIN' && row.valor) config.subdomain = row.valor
    if (row.clave === 'KOMMO_ACCESS_TOKEN' && row.valor) config.accessToken = row.valor
    if (row.clave === 'KOMMO_WON_STATUS_ID' && row.valor) config.estadoGanadoId = parseInt(row.valor, 10)
    if (row.clave === 'KOMMO_WEBHOOK_SECRET' && row.valor) config.webhookSecret = row.valor
  })
  return config
}

function validarFirmaKommo(body, signature, webhookSecret) {
  if (!webhookSecret) return true
  const expected = crypto
    .createHmac('sha1', webhookSecret)
    .update(body)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''))
  } catch {
    return false
  }
}

async function enviarLinkPortalWhatsApp({ telefono, nombre, portalUrl, leadId, empresaNombre, kommo }) {
  if (!kommo.subdomain || !kommo.accessToken) {
    console.warn(`[Kommo] Integración no configurada — omitiendo envío (empresa: ${empresaNombre || 's/n'})`)
    return { ok: false }
  }
  const mensaje =
    `¡Hola ${nombre}! 👋\n\n` +
    `Tu pedido en *${empresaNombre || 'EncargosPro'}* ha sido confirmado. ` +
    `Puedes hacer seguimiento aquí:\n\n` +
    `🔗 ${portalUrl}\n\n` +
    `Guarda este link para ver el estado de tu pedido siempre. ¡Gracias! 🛍️`
  try {
    const res = await fetch(`https://${kommo.subdomain}.kommo.com/api/v4/talks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${kommo.accessToken}`, 'Content-Type': 'application/json' },
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

  const empresaSlug = event.queryStringParameters?.empresa
  const empresa = await resolverEmpresaPorSlug(empresaSlug)
  if (!empresa) {
    console.error(`[Kommo] Webhook recibido sin empresa válida (slug="${empresaSlug || ''}"). Configura la URL del webhook en Kommo como: ${APP_URL}/.netlify/functions/kommo-webhook?empresa=<tu-slug>`)
    return { statusCode: 400, body: 'Falta o es inválido el parámetro empresa en la URL del webhook' }
  }

  const kommo = await obtenerKommoConfig(empresa.id)

  const signature = event.headers['x-kommo-signature'] || event.headers['x-signature']
  if (!validarFirmaKommo(event.body, signature, kommo.webhookSecret)) return { statusCode: 401, body: 'Unauthorized' }

  let payload
  try { payload = JSON.parse(event.body) } catch { return { statusCode: 400, body: 'Invalid JSON' } }

  const leads = payload?.leads?.update || payload?.leads?.add || []

  for (const lead of leads) {
    if (lead.status_id !== kommo.estadoGanadoId) continue

    const leadId = lead.id?.toString()
    const camposContacto = lead._embedded?.contacts?.[0]?.custom_fields_values || []
    const campoTel = camposContacto.find(f => f.field_code === 'PHONE' || f.field_type === 'multitext')
    const telefono = normalizarTelefono(campoTel?.values?.[0]?.value || null)
    const nombreContacto = lead._embedded?.contacts?.[0]?.name || lead.name || 'Cliente'

    if (!telefono) continue

    let clienteId
    const { data: clienteExistente } = await supabase
      .from('Clientes').select('id, portal_token')
      .eq('telefono', telefono).eq('empresa_id', empresa.id).maybeSingle()

    if (clienteExistente) {
      clienteId = clienteExistente.id
      await supabase.from('Clientes').update({ numero_lead_kommo: leadId }).eq('id', clienteId)
    } else {
      const { data: nuevo, error } = await supabase
        .from('Clientes')
        .insert({ nombre: nombreContacto, telefono, numero_lead_kommo: leadId, tipo_cliente: 'b2c', empresa_id: empresa.id })
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

    const portalUrl = `${APP_URL}/portal/${empresa.slug}?t=${portalToken}`
    await enviarLinkPortalWhatsApp({ telefono, nombre: nombreContacto, portalUrl, leadId, empresaNombre: empresa.nombre, kommo })
    console.log(`[${empresa.nombre}] Lead ${leadId} procesado — portal: ${portalUrl}`)
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
