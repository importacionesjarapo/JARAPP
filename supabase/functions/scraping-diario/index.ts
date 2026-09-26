// supabase/functions/scraping-diario/index.ts
//
// Corre con la service role key (salta RLS a propósito, por eso necesita
// filtrar/asignar empresa_id a mano en cada consulta e insert).
//
// Antes de este cambio, esta función traía TODAS las cuentas_tracker de
// TODAS las empresas en un solo lote plano y nunca seteaba empresa_id al
// insertar en posts_tracker / snapshot_metricas / recreaciones_tracker /
// scraping_logs. Como esas columnas quedaron NOT NULL después de la
// migración multi-tenant (013_multitenant_empresas.sql), esos inserts
// muy probablemente llevan tiempo fallando en silencio (el error se
// loguea a consola pero no interrumpe la ejecución) — no era solo un
// tema de personalizar el prompt de IA, era un bug de funcionalidad real.
//
// Ahora cada lote se agrupa por empresa_id antes de procesar: se llama a
// Apify UNA sola vez por lote (eficiente, no importa de qué empresa sea
// cada cuenta), pero el guardado en base de datos, el log de scraping y
// el prompt de IA se hacen por empresa, con su propio perfil de marca
// (ver obtenerPerfilMarca) — mismo patrón que src/services/scraperService.js
// del lado del cliente para la ejecución manual.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APIFY_TOKEN = Deno.env.get('APIFY_TOKEN')!
const APIFY_ACTOR = 'apify~instagram-profile-scraper'
const MAX_IA_POR_RUN = 3 // por EMPRESA, no global — así un tenant con muchos virales no le quita cupo a otro
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const TAMANO_LOTE = 20

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Perfil de marca para el prompt de IA — configurable por tenant desde
// Competitor Tracker → "⚙️ Configurar marca IA" (guardado en Configuracion,
// misma tabla/patrón que GLOBAL_LOGO). Genéricos a propósito: se usan en el
// prompt real de la IA si una empresa no configuró su marca, y no deben
// hacerle creer a la IA que es un negocio distinto al que realmente es.
const PERFIL_MARCA_DEFAULTS: Record<string, string> = {
  TRACKER_NOMBRE_EMPRESA: 'EncargosPro',
  TRACKER_DESCRIPCION: 'una empresa que trae productos originales desde el exterior para sus clientes',
  TRACKER_IG_HANDLE: '',
  TRACKER_IG_SEGUIDORES: '',
  TRACKER_DESTINO_VIAJE: 'Estados Unidos',
  TRACKER_TONO: 'cercano, directo y persuasivo',
  TRACKER_WHATSAPP: '',
}

async function obtenerPerfilMarca(empresaId: string): Promise<Record<string, string>> {
  try {
    const { data } = await supabase
      .from('Configuracion')
      .select('clave, valor')
      .eq('empresa_id', empresaId)
      .in('clave', Object.keys(PERFIL_MARCA_DEFAULTS))
    const perfil = { ...PERFIL_MARCA_DEFAULTS }
    for (const fila of data || []) {
      if (fila.valor) perfil[fila.clave] = fila.valor
    }
    return perfil
  } catch (e) {
    console.warn('[Scraping] No se pudo cargar perfil de marca, usando default:', (e as Error).message)
    return { ...PERFIL_MARCA_DEFAULTS }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Leer qué lote procesar
  let loteIndex = 0
  try {
    const body = await req.json()
    loteIndex = body.lote ?? 0
  } catch { loteIndex = 0 }

  console.log(`[Scraping Diario] Iniciando lote ${loteIndex}...`)

  const resumenGlobal = {
    lote: loteIndex,
    empresasProcesadas: 0,
    cuentas: 0, nuevos: 0, virales: 0, errores: 0,
    duracion: 0, inicio: Date.now(),
  }

  try {
    // Obtener todas las cuentas activas de TODAS las empresas, ordenadas
    // consistentemente (para que la paginación por lote sea estable entre
    // llamadas). empresa_id ya es una columna real de cuentas_tracker.
    const { data: todasCuentas, error: errCuentas } = await supabase
      .from('cuentas_tracker')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: true })

    if (errCuentas || !todasCuentas) {
      throw new Error('Error obteniendo cuentas: ' + errCuentas?.message)
    }

    // Tomar solo las cuentas del lote actual (lote = página sobre el listado
    // GLOBAL de todas las empresas combinadas, no por empresa individual)
    const inicio = loteIndex * TAMANO_LOTE
    const cuentas = todasCuentas.slice(inicio, inicio + TAMANO_LOTE)

    if (cuentas.length === 0) {
      console.log(`[Scraping] Lote ${loteIndex} vacío — no hay cuentas`)
      resumenGlobal.duracion = Math.round((Date.now() - resumenGlobal.inicio) / 1000)
      return new Response(JSON.stringify({ ok: true, mensaje: 'Lote vacío', resumen: resumenGlobal }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    resumenGlobal.cuentas = cuentas.length
    const usernames = cuentas.map(c => c.usuario_ig)
    console.log(`[Scraping] Lote ${loteIndex}: ${cuentas.length} cuentas → ${usernames.join(', ')}`)

    // Una sola llamada a Apify para todo el lote — no importa de qué
    // empresa sea cada cuenta, es más eficiente que llamar por tenant.
    const items = await runApifyActor(usernames)
    const itemsPorUsername = new Map(items.map((p: any) => [p.username, p]))

    // Agrupar las cuentas de este lote por empresa_id — de acá en adelante
    // todo (log, perfil de marca, cupo de IA) se maneja por empresa.
    const cuentasPorEmpresa = new Map<string, any[]>()
    for (const c of cuentas) {
      const key = c.empresa_id
      if (!key) { console.warn(`[Scraping] Cuenta @${c.usuario_ig} sin empresa_id — se omite`); continue }
      if (!cuentasPorEmpresa.has(key)) cuentasPorEmpresa.set(key, [])
      cuentasPorEmpresa.get(key)!.push(c)
    }

    for (const [empresaId, cuentasEmpresa] of cuentasPorEmpresa) {
      const logId = await iniciarLog(loteIndex, empresaId)
      const perfilMarca = await obtenerPerfilMarca(empresaId)
      const resumenEmpresa = { cuentas: cuentasEmpresa.length, nuevos: 0, virales: 0, errores: 0, duracion: 0, inicio: Date.now() }
      let iaCount = 0

      for (const cuenta of cuentasEmpresa) {
        const perfilApify = itemsPorUsername.get(cuenta.usuario_ig)
        const posts = perfilApify?.latestPosts || []
        console.log(`[Scraping] @${cuenta.usuario_ig} (empresa ${empresaId}): ${posts.length} posts`)

        for (const post of posts) {
          try {
            const resultado = await procesarPost(post, cuenta, empresaId, perfilMarca, iaCount < MAX_IA_POR_RUN)
            if (resultado.guardado) resumenEmpresa.nuevos++
            if (resultado.viral) resumenEmpresa.virales++
            if (resultado.iaGenerada) iaCount++
          } catch (err) {
            console.warn(`[Scraping] Error en post de @${cuenta.usuario_ig}:`, (err as Error).message)
            resumenEmpresa.errores++
          }
        }
      }

      resumenEmpresa.duracion = Math.round((Date.now() - resumenEmpresa.inicio) / 1000)
      await finalizarLog(logId, resumenEmpresa)

      resumenGlobal.empresasProcesadas++
      resumenGlobal.nuevos += resumenEmpresa.nuevos
      resumenGlobal.virales += resumenEmpresa.virales
      resumenGlobal.errores += resumenEmpresa.errores
    }

  } catch (err) {
    console.error('[Scraping] Error general:', (err as Error).message)
    resumenGlobal.errores++
  } finally {
    resumenGlobal.duracion = Math.round((Date.now() - resumenGlobal.inicio) / 1000)
    console.log(`[Scraping] Lote ${loteIndex} completado:`, resumenGlobal)
  }

  return new Response(JSON.stringify({ ok: true, resumen: resumenGlobal }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

// ── APIFY ─────────────────────────────────────────────────────────────────────
async function runApifyActor(usernames: string[]): Promise<any[]> {
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/runs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIFY_TOKEN}`
      },
      body: JSON.stringify({
        usernames,
        resultsLimit: 30,
        addParentData: false
      })
    }
  )

  const startData = await startRes.json()

  console.log('[Apify] HTTP Status:', startRes.status)
  console.log('[Apify] Respuesta completa:', JSON.stringify(startData))

  const runId = startData?.data?.id
  if (!runId) {
    throw new Error(`No runId. Status: ${startRes.status}. Respuesta: ${JSON.stringify(startData)}`)
  }

  console.log(`[Apify] Run iniciado: ${runId}`)

  const maxWait = 2 * 60 * 1000
  const inicio = Date.now()

  while (Date.now() - inicio < maxWait) {
    await new Promise(r => setTimeout(r, 5000))

    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` } }
    )
    const statusData = await statusRes.json()
    const status = statusData?.data?.status

    console.log(`[Apify] Status: ${status}`)

    if (status === 'SUCCEEDED') {
      const itemsRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items`,
        { headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` } }
      )
      const items = await itemsRes.json()
      console.log(`[Apify] Items recibidos: ${items.length}`)
      return items
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}: ${JSON.stringify(statusData?.data)}`)
    }
  }

  throw new Error('Apify timeout después de 2 minutos')
}

// ── PROCESAR POST ─────────────────────────────────────────────────────────────
async function procesarPost(
  post: any,
  cuenta: any,
  empresaId: string,
  perfilMarca: Record<string, string>,
  puedeGenerarIA: boolean
): Promise<{ guardado: boolean; viral: boolean; iaGenerada: boolean }> {

  const tipo = post.type === 'Video' ? 'reel'
    : post.type === 'Sidecar' ? 'carrusel' : 'post'

  const vistas = tipo === 'reel'
    ? (post.videoViewCount || 0)
    : (post.likesCount || 0) * 10

  const umbral = cuenta.umbral_vistas || 10000

  // Si no supera el umbral solo guardar snapshot
  if (vistas < umbral) {
    const apifyPostId = sanitize(post.shortCode || String(post.id || ''), 50)
    const { data: existente } = await supabase
      .from('posts_tracker')
      .select('id')
      .eq('apify_post_id', apifyPostId)
      .maybeSingle()
    if (existente) await guardarSnapshot(post, existente.id, empresaId)
    return { guardado: false, viral: false, iaGenerada: false }
  }

  // Verificar si ya existe
  const apifyPostId = sanitize(post.shortCode || String(post.id || ''), 50)

  // Verificar lista negra
  const { data: enListaNegra } = await supabase
    .from('posts_descartados_permanente')
    .select('id')
    .eq('apify_post_id', apifyPostId)
    .maybeSingle()

  if (enListaNegra) {
    console.log(`[Scraper] Post en lista negra, ignorando: ${apifyPostId}`)
    return { guardado: false, viral: false, iaGenerada: false }
  }

  // Post nuevo que supera el umbral — insertar
  const nivel = nivelAmenaza(vistas, cuenta)
  const categoria = detectarCategoria(post.caption || '')
  const hookTexto = sanitize((post.caption || '').substring(0, 200), 200)
  const captionCompleto = sanitize(post.caption || '', 2000)

  const { data: postInsertado, error: errInsert } = await supabase
    .from('posts_tracker')
    .insert({
      cuenta_id: cuenta.id,
      empresa_id: empresaId,
      url_post: post.url || '',
      tipo_contenido: tipo,
      vistas: Math.max(vistas, 0),
      likes_estimados: post.likesCount || 0,
      comentarios: post.commentsCount || 0,
      hook_texto: hookTexto,
      caption_completo: captionCompleto,
      es_viral: true,
      categoria_contenido: categoria,
      nivel_amenaza: nivel,
      fecha_publicacion: post.timestamp || new Date().toISOString(),
      origen: 'automatico',
      apify_post_id: apifyPostId,
    })
    .select('id')
    .single()

  if (errInsert || !postInsertado) {
    console.error('[Scraping] Error insertando post:', errInsert?.message)
    return { guardado: false, viral: false, iaGenerada: false }
  }

  await guardarSnapshot(post, postInsertado.id, empresaId)

  // Generar análisis IA si hay cupo (por empresa, ver MAX_IA_POR_RUN)
  let iaGenerada = false
  if (puedeGenerarIA && nivel !== 'bajo') {
    await new Promise(r => setTimeout(r, 3000))
    const analisis = await generarAnalisisIA(post, cuenta, tipo, vistas, nivel, perfilMarca)

    if (analisis) {
      await supabase
        .from('posts_tracker')
        .update({ analisis_ia: analisis.analisis })
        .eq('id', postInsertado.id)

      await supabase
        .from('recreaciones_tracker')
        .insert({
          post_id: postInsertado.id,
          empresa_id: empresaId,
          guion_recreacion: analisis.guion_recreacion,
          hook_jarapo: analisis.hook_jarapo,
          cta_sugerido: analisis.cta_sugerido,
          musica_sugerida: analisis.musica_sugerida,
          checklist_produccion: analisis.checklist_produccion,
          estado: 'pendiente'
        })

      iaGenerada = true
    }
  }

  return { guardado: true, viral: true, iaGenerada }
}

// ── GROQ IA ───────────────────────────────────────────────────────────────────
async function generarAnalisisIA(
  post: any, cuenta: any, tipo: string, vistas: number, nivel: string, perfil: Record<string, string>
): Promise<any | null> {
  try {
    const systemPrompt = `Eres el estratega de contenido de ${perfil.TRACKER_NOMBRE_EMPRESA}, ${perfil.TRACKER_DESCRIPCION}. Instagram: ${perfil.TRACKER_IG_HANDLE}, ${perfil.TRACKER_IG_SEGUIDORES}. Los viajes son siempre a ${perfil.TRACKER_DESTINO_VIAJE}. Tono: ${perfil.TRACKER_TONO}. CTA siempre dirige a WhatsApp wa.me/${perfil.TRACKER_WHATSAPP}. Responde ÚNICAMENTE con JSON válido sin texto adicional ni backticks.`

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Analiza este post viral y genera la recreación adaptada a la marca:
- Cuenta: @${cuenta.usuario_ig}
- Tipo: ${tipo}
- Vistas: ${vistas.toLocaleString()}
- Nivel de amenaza: ${nivel}
- Hook: ${sanitize(post.caption?.substring(0, 200) || '', 200)}
- Caption: ${sanitize(post.caption?.substring(0, 500) || '', 500)}

JSON exacto:
{
  "analisis": "Por qué funcionó en 3-4 líneas",
  "guion_recreacion": "Guion completo adaptado al tono de la marca",
  "hook_jarapo": "Primera frase impactante",
  "cta_sugerido": "CTA con wa.me/${perfil.TRACKER_WHATSAPP}",
  "musica_sugerida": "Tipo de audio recomendado",
  "checklist_produccion": ["Paso 1", "Paso 2", "Paso 3", "Paso 4", "Paso 5"]
}`
          }
        ]
      })
    })

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch (err) {
    console.warn('[IA] Error generando análisis:', (err as Error).message)
    return null
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function guardarSnapshot(post: any, postId: string | undefined, empresaId: string) {
  if (!postId) return
  const hoy = new Date().toISOString().split('T')[0]

  await supabase
    .from('snapshot_metricas')
    .upsert({
      post_id: postId,
      empresa_id: empresaId,
      vistas: post.videoViewCount || 0,
      likes: post.likesCount || 0,
      comentarios: post.commentsCount || 0,
      fecha_snapshot: hoy
    }, { onConflict: 'post_id,fecha_snapshot' })
}

function nivelAmenaza(vistas: number, cuenta: any): string {
  if (cuenta.tipo_cuenta === 'competencia') {
    if (cuenta.tier === 1) return vistas > 50000 ? 'alto' : vistas > 10000 ? 'medio' : 'bajo'
    return vistas > 100000 ? 'alto' : vistas > 20000 ? 'medio' : 'bajo'
  }
  return vistas > 200000 ? 'alto' : vistas > 50000 ? 'medio' : 'bajo'
}

function detectarCategoria(caption: string): string {
  const c = caption.toLowerCase()
  if (/empec[eé]|años|antes|historia|sue[ñn]o|comenc[eé]/.test(c)) return 'historia_personal'
  if (/precio|ahorro|barato|descuento|oferta|menos que/.test(c)) return 'precio'
  if (/nike|adidas|jordan|new balance|puma|coach|michael kors/.test(c)) return 'producto'
  if (/c[oó]mo|tip|aprende|proceso|paso/.test(c)) return 'educativo'
  if (/look|outfit|estilo|moda/.test(c)) return 'lifestyle'
  return 'producto'
}

function sanitize(str: string, maxLen: number): string {
  if (!str) return ''
  const clean = [...str]
    .filter(ch => {
      const code = ch.codePointAt(0) || 0
      return !(code >= 0xD800 && code <= 0xDFFF)
    })
    .join('')
  return clean.substring(0, maxLen)
}

async function iniciarLog(lote: number, empresaId: string): Promise<string> {
  const { data, error } = await supabase
    .from('scraping_logs')
    .insert({ estado: 'ejecutando', empresa_id: empresaId, resumen: { lote } })
    .select('id')
    .single()
  if (error) console.error('[Log] Error creando scraping_log:', error.message)
  return data?.id || ''
}

async function finalizarLog(logId: string, resumen: any) {
  if (!logId) return
  try {
    await supabase
      .from('scraping_logs')
      .update({
        estado: 'completado',
        cuentas_procesadas: resumen.cuentas,
        posts_nuevos_detectados: resumen.nuevos,
        posts_virales_detectados: resumen.virales,
        errores: resumen.errores,
        duracion_segundos: resumen.duracion,
        resumen
      })
      .eq('id', logId)
  } catch (err) {
    console.error('[Log] Error finalizando log:', err)
  }
}
