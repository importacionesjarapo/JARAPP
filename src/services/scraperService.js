import { db } from '../db.js';

const client = () => db.client;

const APIFY_TOKEN = import.meta.env.VITE_APIFY_TOKEN;
const APIFY_ACTOR = 'apify~instagram-profile-scraper';
const APIFY_BASE  = 'https://api.apify.com/v2';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_KEY     = import.meta.env.VITE_GROQ_API_KEY;

const GROQ_SYSTEM = `Eres el estratega de contenido de Importaciones Jarapo, una empresa colombiana de personal shopping que importa productos originales desde USA (calzado, ropa, accesorios, vitaminas, perfumes, tecnología). El perfil de Instagram es @importaciones_jarapo con 36.3K seguidores verificados. El viaje es siempre a Orlando, nunca a Miami. El tono de contenido es "copy violento" — impactante, aspiracional, emocional y directo. El CTA siempre dirige a WhatsApp.

Cuando recibas datos de un post viral de la competencia, debes:
1. ANÁLISIS: Explicar en 3-4 líneas por qué funcionó este post (hook, formato, emoción activada, CTA)
2. RECREACIÓN JARAPO: Proponer el guion o texto completo adaptado al tono Jarapo
3. HOOK: Primera frase o primeros 3 segundos del reel para Jarapo
4. CTA: Call to action final con link a WhatsApp wa.me/573207761097
5. MÚSICA: Sugerencia de tipo de audio (no nombrar canciones específicas)
6. CHECKLIST: Lista de 4-5 pasos de producción (qué grabar, duración, formato)

Responde SOLO en JSON con esta estructura exacta:
{
  "analisis": "...",
  "guion_recreacion": "...",
  "hook_jarapo": "...",
  "cta_sugerido": "...",
  "musica_sugerida": "...",
  "checklist_produccion": ["paso 1", "paso 2", "paso 3", "paso 4", "paso 5"]
}`;

// Callback de progreso inyectado por el caller (panel de Scraping)
let _onProgress = null;

function _log(msg) {
  console.log('[Scraper]', msg);
  _onProgress?.(msg);
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── PRINCIPAL ──────────────────────────────────────────────────────────────────
export async function ejecutarScrapingDiario(onProgress = null) {
  _onProgress = onProgress;
  const inicio = Date.now();

  // Registrar inicio en scraping_logs
  const { data: logEntry } = await client()
    .from('scraping_logs')
    .insert([{ estado: 'ejecutando' }])
    .select()
    .single();
  const logId = logEntry?.id;

  const stats = {
    cuentas_procesadas: 0,
    posts_nuevos: 0,
    posts_virales: 0,
    errores: 0,
    virales: { competencia: [], tiendas: [], inspiracion: [] },
  };

  try {
    // Obtener cuentas activas
    _log('⏳ Obteniendo cuentas de Supabase...');
    const { data: cuentas, error: errCuentas } = await client()
      .from('cuentas_tracker')
      .select('*')
      .eq('activo', true);
    if (errCuentas) throw errCuentas;

    _log(`⏳ ${cuentas.length} cuentas activas encontradas`);

    const cuentasMap = {};
    cuentas.forEach(c => { cuentasMap[c.usuario_ig.toLowerCase()] = c; });

    // Dividir en lotes de 20
    const BATCH = 20;
    const lotes = [];
    for (let i = 0; i < cuentas.length; i += BATCH) lotes.push(cuentas.slice(i, i + BATCH));

    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      const usernames = lote.map(c => c.usuario_ig);
      const preview = usernames.slice(0, 3).join(', ') + (usernames.length > 3 ? '...' : '');
      _log(`⏳ Procesando lote ${i + 1}/${lotes.length} (${preview})`);

      try {
        const posts = await _runApifyActor(usernames);
        const loteStats = await _procesarResultados(posts, cuentasMap);
        stats.cuentas_procesadas += lote.length;
        stats.posts_nuevos       += loteStats.nuevos;
        stats.posts_virales      += loteStats.virales;
        stats.virales.competencia.push(...loteStats.detalle.competencia);
        stats.virales.tiendas.push(...loteStats.detalle.tiendas);
        stats.virales.inspiracion.push(...loteStats.detalle.inspiracion);
      } catch (err) {
        console.error(`[Scraper] Error en lote ${i + 1}:`, err);
        stats.errores++;
      }

      if (i < lotes.length - 1) await _sleep(2000);
    }

    const duracion = Math.round((Date.now() - inicio) / 1000);
    _log(`✅ Scraping completado en ${duracion}s`);
    _log(`📊 Posts analizados: ${stats.cuentas_procesadas * 5}`);
    _log(`🔥 Virales detectados: ${stats.posts_virales}`);
    _log(`⚠️ Errores: ${stats.errores}`);

    if (logId) {
      await client().from('scraping_logs').update({
        estado: 'completado',
        cuentas_procesadas:       stats.cuentas_procesadas,
        posts_nuevos_detectados:  stats.posts_nuevos,
        posts_virales_detectados: stats.posts_virales,
        errores:                  stats.errores,
        duracion_segundos:        duracion,
        resumen:                  { virales: stats.virales },
      }).eq('id', logId);
    }

    return {
      stats,
      virales: stats.virales,
      fecha: new Date().toLocaleDateString('es-CO', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
    };

  } catch (err) {
    const duracion = Math.round((Date.now() - inicio) / 1000);
    if (logId) {
      await client().from('scraping_logs').update({
        estado: 'error',
        errores: stats.errores + 1,
        duracion_segundos: duracion,
        resumen: { error: err.message },
      }).eq('id', logId).catch(() => {});
    }
    throw err;
  }
}

// ── APIFY ──────────────────────────────────────────────────────────────────────
async function _runApifyActor(usernames) {
  const runRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ usernames, resultsLimit: 5, addParentData: false }),
  });
  if (!runRes.ok) throw new Error(`Apify iniciar run: ${runRes.status} ${await runRes.text()}`);
  const runData = await runRes.json();
  const runId   = runData.data.id;

  // Polling hasta SUCCEEDED (timeout 5 min)
  const TIMEOUT = 5 * 60 * 1000;
  const start   = Date.now();
  while (true) {
    if (Date.now() - start > TIMEOUT) throw new Error('Apify timeout (5 min)');
    await _sleep(3000);

    const stRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` },
    });
    if (!stRes.ok) throw new Error(`Apify status check: ${stRes.status}`);
    const { data: run } = await stRes.json();

    if (run.status === 'SUCCEEDED') break;
    if (['FAILED','ABORTED','TIMED-OUT'].includes(run.status)) {
      throw new Error(`Apify run terminó con status: ${run.status}`);
    }
  }

  const itemsRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` },
  });
  if (!itemsRes.ok) throw new Error(`Apify items: ${itemsRes.status}`);
  return await itemsRes.json();
}

// ── PROCESAMIENTO DE RESULTADOS ────────────────────────────────────────────────
async function _procesarResultados(posts, cuentasMap) {
  const loteStats = { nuevos: 0, virales: 0, detalle: { competencia: [], tiendas: [], inspiracion: [] } };
  const hace24h   = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const post of posts) {
    try {
      const username = (post.ownerUsername || '').toLowerCase();
      const cuenta   = cuentasMap[username];
      if (!cuenta) continue;

      // Solo posts de las últimas 24 horas
      const fechaPost = post.timestamp ? new Date(post.timestamp) : null;
      if (fechaPost && fechaPost < hace24h) continue;

      const apifyId = post.id || post.shortCode;
      if (!apifyId) continue;

      // Deduplicación por apify_post_id
      const { data: existing } = await client()
        .from('posts_tracker')
        .select('id')
        .eq('apify_post_id', String(apifyId))
        .maybeSingle();
      if (existing) continue;

      const vistas   = post.videoViewCount || post.videoPlayCount || 0;
      const likes    = post.likesCount || 0;
      const metrica  = vistas || likes;
      const umbral   = cuenta.umbral_vistas || _umbralDefecto(cuenta.tier);
      const esViral  = metrica >= umbral;
      const amenaza  = _nivelAmenaza(metrica, cuenta);
      const tipo     = _tipoContenido(post.type || post.productType);
      const caption  = post.caption || '';
      const hook     = caption.substring(0, 200);
      const cat      = _categoriaCaption(caption);

      const { data: inserted, error: insErr } = await client()
        .from('posts_tracker')
        .insert([{
          cuenta_id:           cuenta.id,
          apify_post_id:       String(apifyId),
          url_post:            post.url || `https://instagram.com/p/${post.shortCode}/`,
          tipo_contenido:      tipo,
          vistas:              vistas,
          likes_estimados:     likes,
          comentarios:         post.commentsCount || 0,
          hook_texto:          hook,
          caption_completo:    caption,
          es_viral:            esViral,
          nivel_amenaza:       amenaza,
          categoria_contenido: cat,
          fecha_publicacion:   fechaPost ? fechaPost.toISOString() : null,
          origen:              'automatico',
        }])
        .select()
        .single();

      if (insErr) {
        if (insErr.code === '23505') continue; // race condition duplicado
        throw insErr;
      }

      loteStats.nuevos++;

      // Análisis IA solo para virales (conservar tokens Groq)
      if (esViral) {
        loteStats.virales++;
        try {
          const ia = await _groqAnalizar(inserted, cuenta);
          await Promise.all([
            client().from('posts_tracker')
              .update({ analisis_ia: ia.analisis })
              .eq('id', inserted.id),
            client().from('recreaciones_tracker').insert([{
              post_id:            inserted.id,
              guion_recreacion:   ia.guion_recreacion,
              hook_jarapo:        ia.hook_jarapo,
              cta_sugerido:       ia.cta_sugerido,
              musica_sugerida:    ia.musica_sugerida,
              checklist_produccion: ia.checklist_produccion,
              estado:             'pendiente',
            }]),
          ]);
        } catch (iaErr) {
          console.warn('[Scraper] Error IA para post', inserted.id, ':', iaErr.message);
        }

        const resumenViral = {
          usuario_ig:    cuenta.usuario_ig,
          tipo,
          vistas:        metrica,
          hook_texto:    hook,
          nivel_amenaza: amenaza,
        };
        if (cuenta.tipo_cuenta === 'competencia')       loteStats.detalle.competencia.push(resumenViral);
        else if (cuenta.tipo_cuenta === 'tienda')       loteStats.detalle.tiendas.push(resumenViral);
        else                                             loteStats.detalle.inspiracion.push(resumenViral);
      }
    } catch (err) {
      console.error('[Scraper] Error en post individual:', err.message, '| post.id:', post?.id);
    }
  }

  return loteStats;
}

// ── GROQ ───────────────────────────────────────────────────────────────────────
async function _groqAnalizar(post, cuenta) {
  const userMsg = `Analiza este post viral de @${cuenta?.usuario_ig || 'competidor'}:
- Tipo: ${post.tipo_contenido}
- Vistas: ${(post.vistas || 0).toLocaleString('es-CO')}
- Hook/primeras palabras: "${post.hook_texto || ''}"
- Caption: "${(post.caption_completo || '').substring(0, 300)}"
- Categoría: ${post.categoria_contenido || ''}
- Nivel de amenaza: ${post.nivel_amenaza || ''}`;

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: GROQ_SYSTEM },
        { role: 'user',   content: userMsg },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data  = await res.json();
  const raw   = data.choices[0].message.content;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Respuesta IA sin JSON válido');
  return JSON.parse(match[0]);
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function _umbralDefecto(tier) {
  return tier === 1 ? 10000 : 30000;
}

function _nivelAmenaza(vistas, cuenta) {
  if (cuenta.tier === 1) {
    if (vistas > 50000)  return 'alto';
    if (vistas > 10000)  return 'medio';
    return 'bajo';
  }
  if (vistas > 100000) return 'alto';
  if (vistas > 30000)  return 'medio';
  return 'bajo';
}

function _tipoContenido(type) {
  if (!type) return 'post';
  const t = type.toLowerCase();
  if (t.includes('video') || t.includes('reel') || t === 'clips') return 'reel';
  if (t.includes('sidecar') || t.includes('carousel'))            return 'carrusel';
  return 'post';
}

function _categoriaCaption(caption) {
  if (!caption) return 'producto';
  const c = caption.toLowerCase();
  if (/empecé|años|antes|historia|sueño|comencé/.test(c))         return 'historia_personal';
  if (/precio|ahorro|barato|descuento|oferta|vale|cuesta/.test(c)) return 'precio';
  if (/cómo|tip|aprende|proceso|tutorial|paso/.test(c))            return 'educativo';
  if (/vida|look|outfit|estilo|moda|fashion/.test(c))              return 'lifestyle';
  return 'producto';
}

// ── MENSAJE WHATSAPP ───────────────────────────────────────────────────────────
export function construirMensajeWhatsApp(resumen) {
  const { virales, fecha } = resumen;
  let msg = `📊 *JARAPO TRACKER — Reporte diario*\n📅 ${fecha}\n\n`;

  if (virales.competencia.length > 0) {
    msg += `🔴 *VIRALES DE COMPETENCIA (${virales.competencia.length})*\n`;
    virales.competencia.forEach(p => {
      msg += `• @${p.usuario_ig} — ${p.tipo} — 👁 ${(p.vistas || 0).toLocaleString('es-CO')} vistas\n`;
      if (p.hook_texto) msg += `  "${p.hook_texto.substring(0, 60)}..."\n`;
      msg += `  Nivel: ${(p.nivel_amenaza || '').toUpperCase()}\n\n`;
    });
  }

  if (virales.tiendas.length > 0) {
    msg += `🔵 *DESTACADOS DE TIENDAS (${virales.tiendas.length})*\n`;
    virales.tiendas.forEach(p => {
      msg += `• @${p.usuario_ig} — 👁 ${(p.vistas || 0).toLocaleString('es-CO')} vistas\n`;
    });
    msg += '\n';
  }

  if (virales.inspiracion.length > 0) {
    msg += `🟢 *INSPIRACIÓN DESTACADA (${virales.inspiracion.length})*\n`;
    virales.inspiracion.forEach(p => {
      msg += `• @${p.usuario_ig} — 👁 ${(p.vistas || 0).toLocaleString('es-CO')} vistas\n`;
    });
    msg += '\n';
  }

  if (!virales.competencia.length && !virales.tiendas.length && !virales.inspiracion.length) {
    msg += `✅ Sin novedades destacadas en las últimas 24 horas.\n`;
  }

  msg += `\n🔗 Ver detalles en JARAPP → Competitor Tracker`;
  return msg;
}
