// Panel de Superadmin (Fase D del plan SaaS multi-tenant): las únicas
// operaciones que cruzan tenants (crear empresa, activar su primer admin,
// renovar/suspender suscripción, listar empresas) pasan por acá, usando la
// service role key — nunca desde el cliente con la anon key, para no tener
// que abrir un hueco especial en las políticas RLS del resto de la app.
import { createClient } from '@supabase/supabase-js'

// createClient revienta de forma síncrona si la URL no es válida — si
// SUPABASE_URL/SUPABASE_SERVICE_KEY faltan (ej. no configuradas para el
// contexto de Deploy Preview en Netlify), eso pasaba ANTES de que el
// handler pudiera responder, y Netlify devolvía un 502 en blanco. Se
// guarda para poder devolver un error JSON claro en su lugar.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

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
  if (!supabase) return res(500, { error: 'Función mal configurada: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en este entorno de Netlify.' })

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

  // ── MIGRAR IMÁGENES DEL BUCKET VIEJO "jarapo-images" (Tenant #1) ──
  // Antes de la Fase B, fotos de producto, logo y comprobantes de pago
  // vivían todos juntos en un único bucket plano y público. Esta acción
  // (de un solo uso, pensada para correr una vez desde el panel) copia
  // cada archivo al bucket nuevo que le corresponde según qué tabla lo
  // referencia (productos-publico o comprobantes-privado, bajo la
  // carpeta de la empresa Jarapo), actualiza esa referencia con la URL
  // nueva, y NO borra nada del bucket viejo — el borrado queda como paso
  // manual aparte una vez confirmado que todo se ve bien.
  if (accion === 'migrar_imagenes_jarapo') {
    const { data: jarapo, error: errJarapo } = await supabase
      .from('Empresas').select('id').eq('slug', 'jarapo').maybeSingle()
    if (errJarapo) return res(500, { error: errJarapo.message })
    if (!jarapo) return res(400, { error: 'No se encontró una empresa con slug="jarapo".' })
    const empresaId = jarapo.id

    // Referencias conocidas a archivos de jarapo-images, por tabla/columna.
    const REFERENCIAS = [
      { tabla: 'Productos', columna: 'url_imagen',            categoria: 'productos' },
      { tabla: 'Ventas',    columna: 'comprobante_url',        categoria: 'comprobantes' },
      { tabla: 'Ventas',    columna: 'comprobante_ultimo_abono', categoria: 'comprobantes' },
      { tabla: 'Abonos',    columna: 'comprobante_url',        categoria: 'comprobantes' },
      { tabla: 'Compras',   columna: 'comprobante_url',        categoria: 'comprobantes' },
      { tabla: 'Gastos',    columna: 'comprobante_url',        categoria: 'comprobantes' },
    ]

    // Mapa oldUrl -> { tabla, columna, id, categoria }
    const referenciasPorUrl = new Map()
    for (const ref of REFERENCIAS) {
      const { data: filas, error: errFilas } = await supabase
        .from(ref.tabla).select(`id, ${ref.columna}`)
        .eq('empresa_id', empresaId)
        .not(ref.columna, 'is', null)
      if (errFilas) return res(500, { error: `Leyendo ${ref.tabla}.${ref.columna}: ${errFilas.message}` })
      for (const fila of filas || []) {
        const url = fila[ref.columna]
        if (url) referenciasPorUrl.set(url, { tabla: ref.tabla, columna: ref.columna, id: fila.id, categoria: ref.categoria })
      }
    }
    // Logo global (Configuracion.valor donde clave='GLOBAL_LOGO')
    const { data: logoRows, error: errLogo } = await supabase
      .from('Configuracion').select('id, valor').eq('empresa_id', empresaId).eq('clave', 'GLOBAL_LOGO')
    if (errLogo) return res(500, { error: `Leyendo Configuracion: ${errLogo.message}` })
    for (const fila of logoRows || []) {
      if (fila.valor) referenciasPorUrl.set(fila.valor, { tabla: 'Configuracion', columna: 'valor', id: fila.id, categoria: 'logos' })
    }

    // Listar el bucket viejo (paginado — es plano, sin carpetas).
    const objetos = []
    let offset = 0
    const LIMITE = 100
    while (true) {
      const { data: pagina, error: errList } = await supabase.storage
        .from('jarapo-images').list('', { limit: LIMITE, offset })
      if (errList) return res(500, { error: `Listando jarapo-images: ${errList.message}` })
      objetos.push(...(pagina || []))
      if (!pagina || pagina.length < LIMITE) break
      offset += LIMITE
    }

    const oldBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/jarapo-images/`
    const resultado = { migrados: [], huerfanos: [], errores: [], totalObjetos: objetos.length }

    for (const obj of objetos) {
      // Los "objetos" que en realidad son carpetas vienen sin id en la API de Storage.
      if (!obj.id) continue
      const oldUrl = oldBase + obj.name
      const match = referenciasPorUrl.get(oldUrl)
      if (!match) { resultado.huerfanos.push(obj.name); continue }

      try {
        const { data: archivo, error: errDown } = await supabase.storage.from('jarapo-images').download(obj.name)
        if (errDown) throw errDown

        const bucketNuevo = match.categoria === 'comprobantes' ? 'comprobantes-privado' : 'productos-publico'
        const pathNuevo = `${match.categoria}/${empresaId}/${obj.name}`

        const { error: errUp } = await supabase.storage.from(bucketNuevo)
          .upload(pathNuevo, archivo, { upsert: true, contentType: archivo.type || undefined })
        if (errUp) throw errUp

        let urlNueva
        if (bucketNuevo === 'productos-publico') {
          urlNueva = supabase.storage.from(bucketNuevo).getPublicUrl(pathNuevo).data?.publicUrl
        } else {
          const { data: firmada, error: errFirma } = await supabase.storage
            .from(bucketNuevo).createSignedUrl(pathNuevo, 60 * 60 * 24 * 365 * 10)
          if (errFirma) throw errFirma
          urlNueva = firmada.signedUrl
        }

        const { error: errUpdate } = await supabase.from(match.tabla)
          .update({ [match.columna]: urlNueva }).eq('id', match.id)
        if (errUpdate) throw errUpdate

        resultado.migrados.push({ archivo: obj.name, tabla: match.tabla, columna: match.columna, id: match.id })
      } catch (e) {
        resultado.errores.push({ archivo: obj.name, error: e.message })
      }
    }

    return res(200, { ok: true, ...resultado })
  }

  return res(400, { error: 'Acción no reconocida' })
}
