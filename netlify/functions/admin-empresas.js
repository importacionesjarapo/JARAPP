// Panel de Superadmin (Fase D del plan SaaS multi-tenant): las únicas
// operaciones que cruzan tenants (crear empresa, activar su primer admin,
// renovar/suspender suscripción, listar empresas) pasan por acá, usando la
// service role key — nunca desde el cliente con la anon key, para no tener
// que abrir un hueco especial en las políticas RLS del resto de la app.
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Mismo template que ROLE_TEMPLATES.admin en src/auth.js — se duplica acá
// porque esta función corre en Node/Netlify, fuera del bundle de Vite.
const ADMIN_PERMISSIONS = {
  dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
  purchases: 'edit', logistics: 'edit', finance: 'edit', vendedores: 'edit', params: 'edit', documentacion: 'edit',
  calculadora: 'edit', admin: true, feat_money: true, feat_usa: true, feat_calc_desglose: true,
  cotizador_ver: true, cotizador_desglose: true, cotizador_pdf_cliente: true, cotizador_pdf_interno: true,
  calendario_ver: true, calendario_crear: true, calendario_editar: true, calendario_eliminar: true,
  calendario_plantilla_editar: true, calendario_fechas_editar: true,
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const res = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) })

/** Verifica el JWT del caller y confirma que su perfil tiene role='superadmin'. */
async function verificarSuperadmin(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: userData, error: errUser } = await supabase.auth.getUser(token)
  if (errUser || !userData?.user) return null

  const { data: profile, error: errProfile } = await supabase
    .from('user_profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (errProfile || profile?.role !== 'superadmin') return null

  return userData.user
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' })

  const caller = await verificarSuperadmin(event.headers.authorization || event.headers.Authorization)
  if (!caller) return res(403, { error: 'Solo el superadmin puede usar este panel.' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return res(400, { error: 'JSON inválido' }) }
  const { accion } = body

  // ── LISTAR EMPRESAS ──
  if (accion === 'listar_empresas') {
    const { data: empresas, error } = await supabase
      .from('Empresas').select('*').order('created_at', { ascending: false })
    if (error) return res(500, { error: error.message })

    const { data: perfiles } = await supabase.from('user_profiles').select('empresa_id')
    const counts = {}
    for (const p of perfiles || []) {
      if (p.empresa_id) counts[p.empresa_id] = (counts[p.empresa_id] || 0) + 1
    }
    return res(200, { ok: true, empresas: empresas.map(e => ({ ...e, num_usuarios: counts[e.id] || 0 })) })
  }

  // ── CREAR EMPRESA + PRIMER ADMIN ──
  if (accion === 'crear_empresa') {
    const { nombre, slug, plan, nombreAdmin, emailAdmin, passwordAdmin } = body
    if (!nombre || !slug || !nombreAdmin || !emailAdmin || !passwordAdmin) {
      return res(400, { error: 'nombre, slug, nombreAdmin, emailAdmin y passwordAdmin son obligatorios.' })
    }

    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas')
      .insert({ nombre, slug, plan: plan || 'basico', estado_suscripcion: 'trial' })
      .select().single()
    if (errEmpresa) return res(400, { error: errEmpresa.message })

    const { data: authUser, error: errAuth } = await supabase.auth.admin.createUser({
      email: emailAdmin, password: passwordAdmin, email_confirm: true,
      user_metadata: { full_name: nombreAdmin },
    })
    if (errAuth) {
      // No dejar una Empresa huérfana sin admin si signup falla.
      await supabase.from('Empresas').delete().eq('id', empresa.id)
      return res(400, { error: errAuth.message })
    }

    const { error: errProfile } = await supabase.from('user_profiles').upsert({
      id: authUser.user.id, full_name: nombreAdmin, email: emailAdmin,
      role: 'admin', permissions: ADMIN_PERMISSIONS, is_active: true,
      empresa_id: empresa.id,
    }, { onConflict: 'id' })
    if (errProfile) return res(500, { error: errProfile.message })

    return res(200, { ok: true, empresa, admin: { id: authUser.user.id, email: emailAdmin } })
  }

  // ── RENOVAR / SUSPENDER SUSCRIPCIÓN ──
  if (accion === 'actualizar_suscripcion') {
    const { empresa_id, estado_suscripcion, fecha_vencimiento } = body
    const validos = ['activa', 'vencida', 'trial', 'cancelada']
    if (!empresa_id || !validos.includes(estado_suscripcion)) {
      return res(400, { error: `empresa_id requerido y estado_suscripcion debe ser uno de: ${validos.join(', ')}` })
    }

    const updates = { estado_suscripcion }
    if (fecha_vencimiento !== undefined) updates.fecha_vencimiento = fecha_vencimiento

    const { data, error } = await supabase.from('Empresas').update(updates).eq('id', empresa_id).select().single()
    if (error) return res(400, { error: error.message })
    return res(200, { ok: true, empresa: data })
  }

  return res(400, { error: 'Acción no reconocida' })
}
