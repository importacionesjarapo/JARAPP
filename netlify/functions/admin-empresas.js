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

// Categorías del catálogo de datos semilla editable (tabla
// "DatosSemillaGlobal", ver migración 024) — el superadmin las administra
// desde el panel ("🌱 Datos semilla") en vez de que queden fijas en código.
const CATEGORIAS_SEMILLA = ['MetodosPago', 'Marca', 'Tienda', 'Categoria', 'Genero']

// Copia el catálogo global a una empresa nueva (#27): "MetodosPago" se
// inserta tal cual en la tabla del mismo nombre (mismo esquema que usa
// Parametrización: id, nombre, color, activo, orden, empresa_id); el resto
// de categorías (Marca, Tienda, Categoria, Genero) se insertan en
// "Configuracion" con clave = categoria, que es la misma tabla/clave que ya
// usa Parametrización (src/views/params.js) para esas listas desplegables
// — así lo que sembramos aquí es indistinguible de lo que el usuario
// hubiera agregado a mano, y lo puede editar o borrar libremente después.
async function sembrarDatosBase(empresaId) {
  const { data: semillas, error } = await supabase
    .from('DatosSemillaGlobal').select('categoria, valor').order('orden')
  if (error) { console.warn('[admin-empresas] No se pudo leer DatosSemillaGlobal:', error.message); return }

  const metodosPago = (semillas || []).filter(s => s.categoria === 'MetodosPago')
  const configuracion = (semillas || []).filter(s => s.categoria !== 'MetodosPago')

  if (metodosPago.length) {
    const filas = metodosPago.map((s, i) => ({
      id: (Date.now() + i).toString(), nombre: s.valor, color: '#6B7280', activo: true, orden: i, empresa_id: empresaId,
    }))
    const { error: errMP } = await supabase.from('MetodosPago').insert(filas)
    if (errMP) console.warn('[admin-empresas] No se pudo sembrar MetodosPago:', errMP.message)
  }

  if (configuracion.length) {
    const filas = configuracion.map((s, i) => ({
      id: (Date.now() + 10000 + i).toString(), clave: s.categoria, valor: s.valor, empresa_id: empresaId,
    }))
    const { error: errCfg } = await supabase.from('Configuracion').insert(filas)
    if (errCfg) console.warn('[admin-empresas] No se pudo sembrar Configuracion:', errCfg.message)
  }
}

/** Código de referido corto y legible a partir del slug — único por el
 * sufijo aleatorio, no depende de que el slug ya lo sea. */
function generarCodigoReferido(slug) {
  const base = (slug || 'empresa').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'EMPRESA'
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

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

/** Verifica el JWT del caller sin exigir ningún rol — usado por la acción de
 * autoservicio (crear_empresa_trial), que cualquier usuario recién
 * registrado desde la landing puede llamar sobre su propia cuenta. */
async function verificarUsuarioAutenticado(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: userData, error } = await supabase.auth.getUser(token)
  if (error || !userData?.user) return null
  return userData.user
}

/** Lista TODOS los objetos de un bucket plano, con páginas grandes para minimizar viajes de red. */
async function listarBucketCompleto(bucket) {
  const objetos = []
  let offset = 0
  const LIMITE = 1000
  while (true) {
    const { data: pagina, error } = await supabase.storage.from(bucket).list('', { limit: LIMITE, offset })
    if (error) throw new Error(`Listando ${bucket}: ${error.message}`)
    objetos.push(...(pagina || []))
    if (!pagina || pagina.length < LIMITE) break
    offset += LIMITE
  }
  return objetos
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' })
  if (!supabase) return res(500, { error: 'Función mal configurada: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en este entorno de Netlify.' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return res(400, { error: 'JSON inválido' }) }
  const { accion } = body
  const authHeader = event.headers.authorization || event.headers.Authorization

  // crear_empresa_trial es autoservicio: la llama cualquier usuario recién
  // registrado desde la landing sobre SU PROPIA cuenta, no un superadmin.
  // Todo lo demás en este archivo sigue exigiendo role='superadmin'.
  let caller
  if (accion === 'crear_empresa_trial') {
    caller = await verificarUsuarioAutenticado(authHeader)
    if (!caller) return res(401, { error: 'Sesión no válida. Inicia sesión de nuevo e intenta otra vez.' })
  } else {
    caller = await verificarSuperadmin(authHeader)
    if (!caller) return res(403, { error: 'Solo el superadmin puede usar este panel.' })
  }

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

    const planId = plan || 'basico'
    // Validar contra el catálogo real — una empresa con un plan_id que no
    // existe en "Planes" queda sin restricción alguna en el sidebar
    // (getPlanModules() lo trata como "sin catálogo = no bloquear nada"),
    // así que un typo acá terminaría regalando todos los módulos.
    const { data: planExiste, error: errPlanExiste } = await supabase
      .from('Planes').select('id').eq('id', planId).maybeSingle()
    if (errPlanExiste) return res(500, { error: errPlanExiste.message })
    if (!planExiste) return res(400, { error: `El plan "${planId}" no existe en el catálogo.` })

    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas')
      .insert({ nombre, slug, plan: planId, estado_suscripcion: 'trial', codigo_referido: generarCodigoReferido(slug) })
      .select().single()
    if (errEmpresa) return res(400, { error: errEmpresa.message })
    await sembrarDatosBase(empresa.id)

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
    const { empresa_id, estado_suscripcion, fecha_vencimiento, fecha_activacion, plan } = body
    const validos = ['activa', 'vencida', 'trial', 'cancelada']
    if (!empresa_id || !validos.includes(estado_suscripcion)) {
      return res(400, { error: `empresa_id requerido y estado_suscripcion debe ser uno de: ${validos.join(', ')}` })
    }

    const updates = { estado_suscripcion }
    if (fecha_vencimiento !== undefined) updates.fecha_vencimiento = fecha_vencimiento
    if (fecha_activacion !== undefined) updates.fecha_activacion = fecha_activacion
    if (plan !== undefined) {
      const { data: planExiste, error: errPlanExiste } = await supabase
        .from('Planes').select('id').eq('id', plan).maybeSingle()
      if (errPlanExiste) return res(500, { error: errPlanExiste.message })
      if (!planExiste) return res(400, { error: `El plan "${plan}" no existe en el catálogo.` })
      updates.plan = plan
    }

    const { data, error } = await supabase.from('Empresas').update(updates).eq('id', empresa_id).select().single()
    if (error) return res(400, { error: error.message })
    return res(200, { ok: true, empresa: data })
  }

  // ── PAGOS DE SUSCRIPCIÓN (cada empresa hacia EncargosPro) ──

  if (accion === 'listar_pagos') {
    const { empresa_id } = body
    if (!empresa_id) return res(400, { error: 'empresa_id es obligatorio.' })
    const { data, error } = await supabase
      .from('PagosSuscripciones').select('*').eq('empresa_id', empresa_id).order('fecha_pago', { ascending: false })
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, pagos: data })
  }

  if (accion === 'registrar_pago') {
    const { empresa_id, monto, fecha_pago, metodo_pago, periodo_desde, periodo_hasta, notas } = body
    if (!empresa_id || !monto || !fecha_pago) {
      return res(400, { error: 'empresa_id, monto y fecha_pago son obligatorios.' })
    }
    if (Number(monto) <= 0) return res(400, { error: 'El monto debe ser mayor a 0.' })

    const { data: pago, error: errPago } = await supabase
      .from('PagosSuscripciones')
      .insert({ empresa_id, monto, fecha_pago, metodo_pago: metodo_pago || null, periodo_desde: periodo_desde || null, periodo_hasta: periodo_hasta || null, notas: notas || null })
      .select().single()
    if (errPago) return res(500, { error: errPago.message })

    // fecha_ultimo_pago es un espejo de conveniencia — el historial real
    // vive en PagosSuscripciones. Solo se avanza (nunca retrocede) para no
    // pisar un pago posterior con uno cargado tarde/retroactivo.
    const { data: empresaActual } = await supabase.from('Empresas').select('fecha_ultimo_pago').eq('id', empresa_id).maybeSingle()
    if (!empresaActual?.fecha_ultimo_pago || fecha_pago > empresaActual.fecha_ultimo_pago) {
      await supabase.from('Empresas').update({ fecha_ultimo_pago: fecha_pago }).eq('id', empresa_id)
    }

    return res(200, { ok: true, pago })
  }

  // ── POLÍTICA DE SOLO-LECTURA AL VENCER ──
  // La lectura (obtener_politica_suscripcion) no hace falta acá — la tabla
  // "PoliticaSuscripcion" tiene SELECT público (ver migración 022), así que
  // la app la consulta directo con la anon key. Solo la escritura pasa por
  // acá, exigiendo superadmin.
  if (accion === 'guardar_politica_suscripcion') {
    const { dias_gracia_solo_lectura, descuento_referido_pct, comision_referido_pct } = body
    if (dias_gracia_solo_lectura === undefined || dias_gracia_solo_lectura < 0) {
      return res(400, { error: 'dias_gracia_solo_lectura debe ser un número mayor o igual a 0.' })
    }
    const updates = { dias_gracia_solo_lectura, updated_at: new Date().toISOString() }
    if (descuento_referido_pct !== undefined) {
      if (descuento_referido_pct < 0 || descuento_referido_pct > 100) {
        return res(400, { error: 'descuento_referido_pct debe estar entre 0 y 100.' })
      }
      updates.descuento_referido_pct = descuento_referido_pct
    }
    if (comision_referido_pct !== undefined) {
      if (comision_referido_pct < 0 || comision_referido_pct > 100) {
        return res(400, { error: 'comision_referido_pct debe estar entre 0 y 100.' })
      }
      updates.comision_referido_pct = comision_referido_pct
    }
    const { data, error } = await supabase
      .from('PoliticaSuscripcion')
      .update(updates)
      .eq('id', 1).select().single()
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, politica: data })
  }

  // ── EXPORTAR TODOS LOS DATOS DE UNA EMPRESA (#30) ──
  // Pensado para cuando una empresa cancela: le entregamos toda su
  // información en un archivo antes de bloquearle el acceso. Trae cada
  // tabla de negocio filtrada por empresa_id — el front (superadmin.js)
  // arma el Excel con una hoja por tabla usando la librería xlsx que ya
  // usa el resto de la app para exportar reportes.
  if (accion === 'exportar_datos_empresa') {
    const { empresa_id } = body
    if (!empresa_id) return res(400, { error: 'empresa_id es obligatorio.' })

    const TABLAS = [
      'Ventas', 'Clientes', 'Productos', 'Logistica', 'Gastos', 'Compras',
      'Abonos', 'GuiasInternacionales', 'MetodosPago', 'viajes', 'Configuracion',
    ]
    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas').select('*').eq('id', empresa_id).maybeSingle()
    if (errEmpresa) return res(500, { error: errEmpresa.message })
    if (!empresa) return res(404, { error: 'Empresa no encontrada.' })

    const resultados = await Promise.all(
      TABLAS.map(t => supabase.from(t).select('*').eq('empresa_id', empresa_id))
    )
    const datos = {}
    for (let i = 0; i < TABLAS.length; i++) {
      const { data, error } = resultados[i]
      if (error) return res(500, { error: `Exportando ${TABLAS[i]}: ${error.message}` })
      datos[TABLAS[i]] = data || []
    }

    return res(200, { ok: true, empresa, datos })
  }

  // ── CATÁLOGO DE DATOS SEMILLA (#27) — editable desde Superadmin ──
  if (accion === 'listar_datos_semilla') {
    const { data, error } = await supabase
      .from('DatosSemillaGlobal').select('*').order('categoria').order('orden')
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, items: data || [] })
  }

  if (accion === 'guardar_dato_semilla') {
    const { categoria, valor } = body
    if (!CATEGORIAS_SEMILLA.includes(categoria)) {
      return res(400, { error: `categoria debe ser una de: ${CATEGORIAS_SEMILLA.join(', ')}` })
    }
    if (!valor || !valor.trim()) return res(400, { error: 'valor es obligatorio.' })

    const { count } = await supabase
      .from('DatosSemillaGlobal').select('id', { count: 'exact', head: true }).eq('categoria', categoria)
    const { data, error } = await supabase
      .from('DatosSemillaGlobal').insert({ categoria, valor: valor.trim(), orden: count || 0 }).select().single()
    if (error) return res(400, { error: error.message.includes('duplicate') ? `"${valor}" ya existe en ${categoria}.` : error.message })
    return res(200, { ok: true, item: data })
  }

  if (accion === 'eliminar_dato_semilla') {
    const { id } = body
    if (!id) return res(400, { error: 'id es obligatorio.' })
    const { error } = await supabase.from('DatosSemillaGlobal').delete().eq('id', id)
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true })
  }

  // ── MIGRAR IMÁGENES DEL BUCKET VIEJO "jarapo-images" (Tenant #1) ──
  // Antes de la Fase B, fotos de producto, logo y comprobantes de pago
  // vivían todos juntos en un único bucket plano y público. Se divide en
  // dos acciones para no toparse con el timeout de ~10s de las funciones
  // síncronas de Netlify: un "plan" de solo lectura (rápido, sin importar
  // cuántos archivos haya) y lotes pequeños de copiado real, que el
  // cliente va llamando uno por uno. NO borra nada del bucket viejo — el
  // borrado queda como paso manual aparte una vez confirmado que todo se
  // ve bien.

  async function empresaIdJarapo() {
    const { data: jarapo, error } = await supabase
      .from('Empresas').select('id').eq('slug', 'jarapo').maybeSingle()
    if (error) throw new Error(error.message)
    if (!jarapo) throw new Error('No se encontró una empresa con slug="jarapo".')
    return jarapo.id
  }

  // Referencias conocidas a archivos de jarapo-images, por tabla/columna.
  const REFERENCIAS_IMAGENES = [
    { tabla: 'Productos', columna: 'url_imagen',              categoria: 'productos' },
    { tabla: 'Ventas',    columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Ventas',    columna: 'comprobante_ultimo_abono', categoria: 'comprobantes' },
    { tabla: 'Abonos',    columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Compras',   columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Gastos',    columna: 'comprobante_url',          categoria: 'comprobantes' },
  ]

  if (accion === 'plan_migracion_imagenes') {
    try {
      const empresaId = await empresaIdJarapo()

      // Todas las consultas de referencias (6 tablas + Configuracion) y el
      // listado del bucket corren en paralelo, no en cadena — con varios
      // años de datos, hacerlo secuencial fue lo que agotó los ~10s de la
      // función síncrona en el intento anterior.
      const [resultadosRefs, logoResult, objetos] = await Promise.all([
        Promise.all(REFERENCIAS_IMAGENES.map(ref =>
          supabase.from(ref.tabla).select(`id, ${ref.columna}`)
            .eq('empresa_id', empresaId).not(ref.columna, 'is', null)
            .then(({ data, error }) => {
              if (error) throw new Error(`Leyendo ${ref.tabla}.${ref.columna}: ${error.message}`)
              return { ref, filas: data || [] }
            })
        )),
        supabase.from('Configuracion').select('id, valor').eq('empresa_id', empresaId).eq('clave', 'GLOBAL_LOGO')
          .then(({ data, error }) => {
            if (error) throw new Error(`Leyendo Configuracion: ${error.message}`)
            return data || []
          }),
        listarBucketCompleto('jarapo-images'),
      ])

      // Mapa oldUrl -> { tabla, columna, id, categoria }
      const referenciasPorUrl = new Map()
      for (const { ref, filas } of resultadosRefs) {
        for (const fila of filas) {
          const url = fila[ref.columna]
          if (url) referenciasPorUrl.set(url, { tabla: ref.tabla, columna: ref.columna, id: fila.id, categoria: ref.categoria })
        }
      }
      for (const fila of logoResult) {
        if (fila.valor) referenciasPorUrl.set(fila.valor, { tabla: 'Configuracion', columna: 'valor', id: fila.id, categoria: 'logos' })
      }

      const oldBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/jarapo-images/`
      const porMigrar = []
      const huerfanos = []
      for (const obj of objetos) {
        if (!obj.id) continue // carpetas: la API de Storage las lista sin id
        const match = referenciasPorUrl.get(oldBase + obj.name)
        if (match) porMigrar.push({ archivo: obj.name, ...match })
        else huerfanos.push(obj.name)
      }

      return res(200, { ok: true, empresaId, totalObjetos: objetos.length, porMigrar, huerfanos })
    } catch (e) {
      return res(500, { error: e.message })
    }
  }

  // Procesa un lote chico (lo decide el cliente, ideal 5-10) de los
  // archivos que ya vinieron marcados como "porMigrar" en el plan.
  if (accion === 'migrar_lote_imagenes') {
    const { empresaId, archivos } = body
    if (!empresaId || !Array.isArray(archivos) || archivos.length === 0) {
      return res(400, { error: 'empresaId y archivos (array) son obligatorios.' })
    }

    const resultado = { migrados: [], errores: [] }
    for (const item of archivos) {
      const { archivo, tabla, columna, id, categoria } = item
      try {
        const { data: bytes, error: errDown } = await supabase.storage.from('jarapo-images').download(archivo)
        if (errDown) throw errDown

        const bucketNuevo = categoria === 'comprobantes' ? 'comprobantes-privado' : 'productos-publico'
        const pathNuevo = `${categoria}/${empresaId}/${archivo}`

        const { error: errUp } = await supabase.storage.from(bucketNuevo)
          .upload(pathNuevo, bytes, { upsert: true, contentType: bytes.type || undefined })
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

        const { error: errUpdate } = await supabase.from(tabla).update({ [columna]: urlNueva }).eq('id', id)
        if (errUpdate) throw errUpdate

        resultado.migrados.push({ archivo, tabla, columna, id })
      } catch (e) {
        resultado.errores.push({ archivo, error: e.message })
      }
    }

    return res(200, { ok: true, ...resultado })
  }

  // ── CATÁLOGO DE PLANES (Prueba/Básico/Pro/Empresarial) ──

  // Listar los 4 planes con sus módulos y límites — panel de superadmin.
  if (accion === 'listar_planes') {
    const { data, error } = await supabase.from('Planes').select('*').order('orden')
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, planes: data })
  }

  // Actualiza un plan del catálogo (módulos incluidos, límite de usuarios,
  // días de prueba si aplica). No crea planes nuevos — los 4 vienen
  // sembrados por la migración 021_planes_catalogo.sql.
  if (accion === 'guardar_plan') {
    const { plan_id, max_usuarios, dias_prueba, modulos } = body
    if (!plan_id) return res(400, { error: 'plan_id es obligatorio.' })
    if (!modulos || typeof modulos !== 'object') {
      return res(400, { error: 'modulos es obligatorio.' })
    }
    const updates = { modulos, updated_at: new Date().toISOString() }
    if (max_usuarios !== undefined) updates.max_usuarios = max_usuarios
    if (dias_prueba !== undefined) updates.dias_prueba = dias_prueba
    const { data, error } = await supabase.from('Planes')
      .update(updates).eq('id', plan_id).select().maybeSingle()
    if (error) return res(500, { error: error.message })
    if (!data) return res(404, { error: `No existe el plan "${plan_id}".` })
    return res(200, { ok: true, plan: data })
  }

  // Crea la empresa + perfil admin del usuario que se acaba de registrar
  // solo desde la landing (self-serve) — nunca desde un superadmin. El
  // caller ya viene verificado como "cualquier usuario autenticado" más
  // arriba; acá solo falta que no tenga ya una empresa asociada.
  if (accion === 'crear_empresa_trial') {
    const { nombreCompleto, nombreEmpresa, codigoReferido } = body
    if (!nombreCompleto || !nombreEmpresa) {
      return res(400, { error: 'nombreCompleto y nombreEmpresa son obligatorios.' })
    }

    const { data: perfilExistente, error: errPerfil } = await supabase
      .from('user_profiles').select('id, empresa_id').eq('id', caller.id).maybeSingle()
    if (errPerfil) return res(500, { error: errPerfil.message })
    if (perfilExistente?.empresa_id) {
      return res(400, { error: 'Esta cuenta ya tiene una empresa activa. Inicia sesión en la app en vez de crear una nueva.' })
    }

    const { data: planTrial, error: errPlan } = await supabase
      .from('Planes').select('*').eq('id', 'trial').maybeSingle()
    if (errPlan) return res(500, { error: errPlan.message })
    const diasPrueba = planTrial?.dias_prueba ?? 7

    // Código de referido opcional: si viene y existe, queda registrado en
    // "referido_por" para que el superadmin sepa a quién aplicarle la
    // comisión (PoliticaSuscripcion.comision_referido_pct) y al nuevo
    // tenant el descuento (descuento_referido_pct) al facturarle — ambos
    // se aplican a mano porque los pagos de esta app se registran a mano,
    // no hay pasarela de cobro. Un código inválido no bloquea el registro,
    // solo se ignora.
    let referidoPorId = null
    if (codigoReferido && codigoReferido.trim()) {
      const { data: empresaReferente } = await supabase
        .from('Empresas').select('id').eq('codigo_referido', codigoReferido.trim().toUpperCase()).maybeSingle()
      referidoPorId = empresaReferente?.id || null
    }

    // Slug único a partir del nombre — no puede depender de que el usuario
    // elija uno bueno (a diferencia de crear_empresa, que sí lo pide).
    const slugBase = nombreEmpresa.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'empresa'
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`

    const fechaVencimiento = new Date()
    fechaVencimiento.setDate(fechaVencimiento.getDate() + diasPrueba)

    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas')
      .insert({
        nombre: nombreEmpresa, slug, plan: 'trial', estado_suscripcion: 'trial',
        fecha_vencimiento: fechaVencimiento.toISOString().split('T')[0],
        codigo_referido: generarCodigoReferido(slug), referido_por: referidoPorId,
      })
      .select().single()
    if (errEmpresa) return res(400, { error: errEmpresa.message })
    await sembrarDatosBase(empresa.id)

    // El usuario de trial recibe el mismo nivel de permisos "admin" que un
    // admin de empresa paga (ADMIN_PERMISSIONS) — es la única persona del
    // trial, así que dentro de su cuenta puede operar cualquier módulo sin
    // restricción de ROL. Qué módulos ve disponibles de verdad lo decide el
    // catálogo "Planes" (tabla Planes, fila 'trial'), que la app consulta
    // aparte vía auth.getPlan()/isModuleLockedByPlan() para pintar en el
    // sidebar los módulos no incluidos como bloqueados (candado + upsell)
    // en vez de ocultarlos — separar "qué puede hacer este usuario" de "qué
    // trae contratado la empresa" es lo que corrige el bug de que un trial
    // veía todo (antes ambas cosas vivían mezcladas en `permissions`).
    const { error: errProfile } = await supabase.from('user_profiles').upsert({
      id: caller.id, full_name: nombreCompleto, email: caller.email,
      role: 'admin', permissions: ADMIN_PERMISSIONS, is_active: true,
      empresa_id: empresa.id,
    }, { onConflict: 'id' })
    if (errProfile) {
      // No dejar una Empresa huérfana si el perfil falla.
      await supabase.from('Empresas').delete().eq('id', empresa.id)
      return res(500, { error: errProfile.message })
    }

    return res(200, { ok: true, empresa })
  }

  return res(400, { error: 'Acción no reconocida' })
}
