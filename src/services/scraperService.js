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

  // Guard: cliente Supabase disponible
  if (!db.client) throw new Error('Cliente Supabase no inicializado. Verifica credenciales en db.js.');

  // Registrar inicio en scraping_logs
  const { data: logEntry } = await client()
    .from('scraping_logs')
    .insert([{ estado: 'ejecutando' }])
    .select()
    .single();
  const logId = logEntry?.id;

  // Cargar cuentas_sin_datos de la última ejecución completada (para auto-desactivación)
  let sinDatosAnterior = [];
  try {
    const { data: lastLog } = await client()
      .from('scraping_logs')
      .select('resumen')
      .eq('estado', 'completado')
      .order('fecha_ejecucion', { ascending: false })
      .limit(1)
      .maybeSingle();
    sinDatosAnterior = lastLog?.resumen?.cuentas_sin_datos || [];
  } catch (_) {}

  const stats = {
    cuentas_procesadas:     0,
    posts_nuevos:           0,
    posts_virales:          0,
    errores:                0,
    cuentas_sin_datos:      [],
    cuentas_desactivadas:   [],
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

        // Detectar cuentas que Apify no devolvió (username inválido o privado)
        const usernamesConDatos = new Set(
          posts.map(p => (p.ownerUsername || '').toLowerCase())
        );
        const sinDatos = usernames.filter(u => !usernamesConDatos.has(u.toLowerCase()));
        if (sinDatos.length > 0) {
          console.warn('[Scraper] Sin datos en este lote:', sinDatos);
          _log(`⚠️ Sin datos: ${sinDatos.join(', ')}`);
          stats.cuentas_sin_datos.push(...sinDatos);
        }

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

    // ── Auto-desactivar cuentas con 0 datos en 2 ejecuciones consecutivas ─────
    if (stats.cuentas_sin_datos.length > 0 && sinDatosAnterior.length > 0) {
      const reincidentes = stats.cuentas_sin_datos.filter(u =>
        sinDatosAnterior.map(x => x.toLowerCase()).includes(u.toLowerCase())
      );
      if (reincidentes.length > 0) {
        _log(`🔕 Desactivando ${reincidentes.length} cuenta(s) reincidentes sin datos: ${reincidentes.join(', ')}`);
        for (const username of reincidentes) {
          try {
            const { error: deactErr } = await client()
              .from('cuentas_tracker')
              .update({
                activo: false,
                notas: 'Desactivada automáticamente: sin datos Apify en 2 ejecuciones consecutivas (posible cuenta privada o usuario incorrecto)',
              })
              .eq('usuario_ig', username);
            if (deactErr) throw deactErr;
            stats.cuentas_desactivadas.push(username);
          } catch (e) {
            console.error(`[Scraper] Error al desactivar ${username}:`, e.message);
          }
        }
        if (stats.cuentas_desactivadas.length > 0) {
          _log(`✅ Desactivadas: ${stats.cuentas_desactivadas.join(', ')}`);
        }
      }
    }

    const duracion = Math.round((Date.now() - inicio) / 1000);
    _log(`✅ Scraping completado en ${duracion}s`);
    _log(`📊 Posts analizados: ${stats.cuentas_procesadas * 30}`);
    _log(`🔥 Virales detectados: ${stats.posts_virales}`);
    _log(`⚠️ Errores: ${stats.errores}`);
    if (stats.cuentas_sin_datos.length > 0) {
      _log(`❌ Sin datos (${stats.cuentas_sin_datos.length}): ${stats.cuentas_sin_datos.join(', ')}`);
    }
    if (stats.cuentas_desactivadas.length > 0) {
      _log(`🔕 Desactivadas automáticamente (${stats.cuentas_desactivadas.length}): ${stats.cuentas_desactivadas.join(', ')}`);
    }

    if (logId) {
      await client().from('scraping_logs').update({
        estado: 'completado',
        cuentas_procesadas:       stats.cuentas_procesadas,
        posts_nuevos_detectados:  stats.posts_nuevos,
        posts_virales_detectados: stats.posts_virales,
        errores:                  stats.errores,
        duracion_segundos:        duracion,
        resumen: {
          virales:               stats.virales,
          cuentas_sin_datos:     stats.cuentas_sin_datos,
          cuentas_desactivadas:  stats.cuentas_desactivadas,
        },
      }).eq('id', logId);
    }

    return {
      stats,
      virales:                stats.virales,
      cuentas_sin_datos:      stats.cuentas_sin_datos,
      cuentas_desactivadas:   stats.cuentas_desactivadas,
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
  const input = { usernames, resultsLimit: 30, addParentData: false };
  console.log(`[Apify] Enviando lote (${usernames.length} cuentas):`, usernames);
  console.log('[Apify] Input enviado:', JSON.stringify(input));

  const runRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!runRes.ok) throw new Error(`Apify iniciar run: ${runRes.status} ${await runRes.text()}`);
  const runData = await runRes.json();
  const runId   = runData.data?.id;
  console.log('[Apify] Run iniciado, ID:', runId, '| runData.data:', JSON.stringify(runData.data));
  if (!runId) throw new Error(`Apify no devolvió runId. Respuesta: ${JSON.stringify(runData)}`);

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
    console.log(`[Apify] Status del run: ${run.status} (${Math.round((Date.now() - start) / 1000)}s)`);

    if (run.status === 'SUCCEEDED') break;
    if (['FAILED','ABORTED','TIMED-OUT'].includes(run.status)) {
      throw new Error(`Apify run terminó con status: ${run.status}`);
    }
  }

  const itemsRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` },
  });
  if (!itemsRes.ok) throw new Error(`Apify items: ${itemsRes.status}`);

  // El actor devuelve un array de PERFILES, no de posts individuales.
  // Cada perfil tiene { username, followersCount, latestPosts: [...], latestIgtvVideos: [...] }
  const perfiles = await itemsRes.json();
  console.log(`[Apify] Perfiles recibidos: ${perfiles.length}`,
    perfiles.map(p => `@${p.username}(${(p.latestPosts || []).length}posts)`).join(', '));

  // Aplanar perfiles → posts individuales con ownerUsername inyectado desde el perfil
  const allPosts = [];
  for (const perfil of perfiles) {
    const uname = perfil.username || '';
    const posts = [...(perfil.latestPosts || []), ...(perfil.latestIgtvVideos || [])];
    console.log(`[Apify] @${uname}: ${posts.length} posts (${(perfil.latestPosts || []).length} latestPosts + ${(perfil.latestIgtvVideos || []).length} IGTV)`);
    if (posts.length === 0) {
      console.warn(`[Apify] ⚠️ @${uname} tiene 0 posts — posible cuenta privada o sin publicaciones`);
    }
    for (const post of posts) {
      allPosts.push({ ...post, ownerUsername: uname });
    }
  }
  console.log(`[Apify] Total posts aplanados: ${allPosts.length}`);

  // DEBUG importaciones.nj
  if (usernames.some(u => u.toLowerCase() === 'importaciones.nj')) {
    const njPerfil = perfiles.find(p => (p.username || '').toLowerCase() === 'importaciones.nj');
    if (njPerfil) {
      console.log(`[DEBUG importaciones.nj] Perfil: ${njPerfil.followersCount} seguidores, ${njPerfil.postsCount} posts totales, ${(njPerfil.latestPosts || []).length} en latestPosts`);
      const njPosts = allPosts.filter(p => (p.ownerUsername || '').toLowerCase() === 'importaciones.nj');
      if (njPosts.length > 0) {
        console.log('[DEBUG importaciones.nj] Primer post:', JSON.stringify(njPosts[0], null, 2));
        console.log('[DEBUG importaciones.nj] Métricas:', njPosts.map(p => ({
          id: p.id || p.shortCode, type: p.type,
          videoViewCount: p.videoViewCount, videoPlayCount: p.videoPlayCount,
          likesCount: p.likesCount, url: p.url,
        })));
      }
    } else {
      console.warn('[DEBUG importaciones.nj] ⚠️ NO encontrado. Perfiles recibidos:', perfiles.map(p => p.username).join(', '));
    }
  }

  return allPosts;
}

// ── PROCESAMIENTO DE RESULTADOS ────────────────────────────────────────────────
async function _procesarResultados(posts, cuentasMap) {
  const loteStats = { nuevos: 0, virales: 0, detalle: { competencia: [], tiendas: [], inspiracion: [] } };

  for (const post of posts) {
    try {
      const username = (post.ownerUsername || '').toLowerCase();
      const cuenta   = cuentasMap[username];
      if (!cuenta) continue;

      const apifyId = post.id || post.shortCode;
      if (!apifyId) continue;

      const tipo        = _tipoContenido(post.type);          // 'Video'→reel, 'Sidecar'→carrusel, 'Image'→post
      const esVideo     = tipo === 'reel';
      const vistas      = post.videoViewCount || post.videoPlayCount || 0;
      const likes       = post.likesCount || 0;
      const comentarios = post.commentsCount || 0;
      // Para videos la métrica es vistas; para fotos/carruseles es likes (sin videoViewCount)
      const metrica     = esVideo ? vistas : likes;
      const fechaPost   = post.timestamp ? new Date(post.timestamp) : null;
      const caption     = post.caption || '';
      const hook        = caption.substring(0, 200);
      const cat         = _categoriaCaption(caption);
      const amenaza     = _nivelAmenaza(vistas || likes * 10, cuenta);

      // ── Buscar post existente ──────────────────────────────────────────────
      const { data: existing } = await client()
        .from('posts_tracker')
        .select('id, es_viral, analisis_ia')
        .eq('apify_post_id', String(apifyId))
        .maybeSingle();

      let postId;

      if (existing) {
        // Actualizar métricas con valores frescos de Apify
        postId = existing.id;
        await client().from('posts_tracker').update({
          vistas, likes_estimados: likes, comentarios,
        }).eq('id', postId);
      } else {
        // Post nuevo
        const { data: inserted, error: insErr } = await client()
          .from('posts_tracker')
          .insert([{
            cuenta_id:           cuenta.id,
            apify_post_id:       String(apifyId),
            url_post:            post.url || `https://instagram.com/p/${post.shortCode}/`,
            tipo_contenido:      tipo,
            vistas, likes_estimados: likes, comentarios,
            hook_texto:          hook,
            caption_completo:    caption,
            es_viral:            false, // se determina después
            nivel_amenaza:       amenaza,
            categoria_contenido: cat,
            fecha_publicacion:   fechaPost ? fechaPost.toISOString() : null,
            origen:              'automatico',
          }])
          .select()
          .single();

        if (insErr) {
          if (insErr.code === '23505') continue; // race condition
          throw insErr;
        }
        postId = inserted.id;
        loteStats.nuevos++;
      }

      // ── Snapshot diario + crecimiento ────────────────────────────────────
      await _guardarSnapshot(postId, vistas, likes, comentarios);
      const crecimiento = await _calcularCrecimiento(postId, vistas);

      await client().from('posts_tracker')
        .update({ crecimiento_24h: crecimiento })
        .eq('id', postId);

      // ── Detección de viralidad (umbral absoluto O crecimiento >50%) ──────
      const umbralBase    = cuenta.umbral_vistas || _umbralDefecto(cuenta.tier);
      // Videos: comparar vistas vs umbral completo
      // Fotos/carruseles: los likes son ~10% de vistas → umbral dividido entre 10
      const umbral        = esVideo ? umbralBase : Math.max(1, Math.round(umbralBase / 10));
      const esViralUmbral = metrica >= umbral;
      const esViralCrec   = crecimiento > 50;
      const esViral       = esViralUmbral || esViralCrec;
      const eraViralAntes   = existing?.es_viral || false;

      if (esViral) {
        await client().from('posts_tracker').update({
          es_viral: true, nivel_amenaza: amenaza,
        }).eq('id', postId);

        // Generar IA solo si no existe análisis previo
        const tieneIA = existing ? !!existing.analisis_ia : false;
        if (!tieneIA) {
          loteStats.virales++;
          try {
            // Construir objeto post para _groqAnalizar
            const postObj = {
              tipo_contenido: tipo, vistas, hook_texto: hook,
              caption_completo: caption, categoria_contenido: cat, nivel_amenaza: amenaza,
            };
            const ia = await _groqAnalizar(postObj, cuenta);
            // Verificar si ya existe recreacion para no duplicar
            const { data: recExist } = await client()
              .from('recreaciones_tracker').select('id')
              .eq('post_id', postId).maybeSingle();

            // Awaits explícitos — evita el bug de Promise.all con query builders lazy de Supabase v2
            await client().from('posts_tracker').update({ analisis_ia: ia.analisis }).eq('id', postId);
            if (!recExist) {
              await client().from('recreaciones_tracker').insert([{
                post_id:              postId,
                guion_recreacion:     ia.guion_recreacion,
                hook_jarapo:          ia.hook_jarapo,
                cta_sugerido:         ia.cta_sugerido,
                musica_sugerida:      ia.musica_sugerida,
                checklist_produccion: ia.checklist_produccion,
                estado:               'pendiente',
              }]);
            }
          } catch (iaErr) {
            console.warn('[Scraper] Error IA para post', postId, ':', iaErr.message);
          }
        } else if (!eraViralAntes) {
          // Pasó a viral desde hoy (crecimiento acelerado) pero ya tenía IA
          loteStats.virales++;
        }

        const resumenViral = {
          usuario_ig: cuenta.usuario_ig, tipo, vistas: metrica,
          hook_texto: hook, nivel_amenaza: amenaza, crecimiento,
        };
        if (cuenta.tipo_cuenta === 'competencia')   loteStats.detalle.competencia.push(resumenViral);
        else if (cuenta.tipo_cuenta === 'tienda')   loteStats.detalle.tiendas.push(resumenViral);
        else                                         loteStats.detalle.inspiracion.push(resumenViral);
      }
    } catch (err) {
      console.error('[Scraper] Error en post individual:', err.message, '| post.id:', post?.id);
    }
  }

  return loteStats;
}

// ── SNAPSHOTS ─────────────────────────────────────────────────────────────────
async function _guardarSnapshot(postId, vistas, likes, comentarios) {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const { error } = await client().from('snapshot_metricas').upsert(
      { post_id: postId, vistas, likes, comentarios, fecha_snapshot: hoy },
      { onConflict: 'post_id,fecha_snapshot' }
    );
    if (error) console.warn('[Scraper] snapshot_metricas upsert error:', error.message);
  } catch (e) {
    console.warn('[Scraper] _guardarSnapshot falló (¿tabla existe?):', e.message);
  }
}

async function _calcularCrecimiento(postId, vistasHoy) {
  try {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.toISOString().split('T')[0];

    const { data: snapAyer } = await client()
      .from('snapshot_metricas')
      .select('vistas')
      .eq('post_id', postId)
      .eq('fecha_snapshot', ayerStr)
      .maybeSingle();

    if (!snapAyer || !snapAyer.vistas || snapAyer.vistas === 0) return 0;
    const crec = ((vistasHoy - snapAyer.vistas) / snapAyer.vistas) * 100;
    return Math.max(0, Math.round(crec));
  } catch (e) {
    console.warn('[Scraper] _calcularCrecimiento falló:', e.message);
    return 0;
  }
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
  // Fallback si umbral_vistas es null en BD. Debe coincidir con los UPDATEs en Supabase.
  return tier === 1 ? 1000 : 3000;
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

// ── TEST APIFY (diagnóstico) ───────────────────────────────────────────────────
// Llama al actor con UN SOLO username y devuelve el JSON raw sin procesar.
// Usado desde el botón "🧪 Test Apify" del panel de Scraping.
export async function testApifyUno(username = 'servicomprasusa1', onProgress = null) {
  const log = (msg) => { console.log('[TestApify]', msg); onProgress?.(msg); };

  log(`Iniciando test con @${username}...`);

  // ── 1. Iniciar run ──────────────────────────────────────────────────────────
  const input = { usernames: [username], resultsLimit: 5, addParentData: false };
  log(`Input enviado: ${JSON.stringify(input)}`);

  const runRes = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR}/runs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const runRaw = await runRes.text();
  log(`Respuesta HTTP ${runRes.status} al iniciar run`);
  log(`Run raw: ${runRaw.substring(0, 300)}`);

  if (!runRes.ok) return { error: `HTTP ${runRes.status}`, raw: runRaw };

  const runData = JSON.parse(runRaw);
  const runId = runData.data?.id;
  log(`Run ID: ${runId || 'NO OBTENIDO'}`);
  if (!runId) return { error: 'No se obtuvo runId', runData };

  // ── 2. Polling (timeout 3 min) ──────────────────────────────────────────────
  const TIMEOUT = 3 * 60 * 1000;
  const start = Date.now();
  let lastStatus = '';

  while (true) {
    if (Date.now() - start > TIMEOUT) {
      log('⏱ Timeout 3 min alcanzado');
      return { error: 'Timeout 3 min', runId, lastStatus };
    }
    await new Promise(r => setTimeout(r, 3000));

    const stRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` },
    });
    const stData = await stRes.json();
    lastStatus = stData.data?.status || 'UNKNOWN';
    log(`Status: ${lastStatus} (${Math.round((Date.now() - start) / 1000)}s)`);

    if (lastStatus === 'SUCCEEDED') break;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(lastStatus)) {
      return { error: `Run terminó con: ${lastStatus}`, runId, runData: stData.data };
    }
  }

  // ── 3. Dataset items (son PERFILES, no posts directos) ─────────────────────
  const itemsRes = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items`, {
    headers: { 'Authorization': `Bearer ${APIFY_TOKEN}` },
  });
  const perfiles = await itemsRes.json();
  log(`Perfiles recibidos: ${Array.isArray(perfiles) ? perfiles.length : 'NO ES ARRAY'}`);

  let primerPerfil = null;
  let latestPost0  = null;

  if (Array.isArray(perfiles) && perfiles.length > 0) {
    const p = perfiles[0];
    primerPerfil = {
      username:         p.username,
      fullName:         p.fullName,
      followersCount:   p.followersCount,
      followsCount:     p.followsCount,
      postsCount:       p.postsCount,
      latestPostsCount: (p.latestPosts || []).length,
      igtvCount:        (p.latestIgtvVideos || []).length,
    };
    log(`Perfil: @${p.username} | ${p.followersCount?.toLocaleString('es-CO')} seguidores | ${p.postsCount} posts totales`);
    log(`latestPosts.length: ${(p.latestPosts || []).length}`);
    log(`latestIgtvVideos.length: ${(p.latestIgtvVideos || []).length}`);

    if ((p.latestPosts || []).length > 0) {
      latestPost0 = p.latestPosts[0];
      log(`--- latestPosts[0] ---`);
      log(`Campos: ${Object.keys(latestPost0).join(', ')}`);
      log(`id:              ${latestPost0.id}`);
      log(`shortCode:       ${latestPost0.shortCode}`);
      log(`type:            ${latestPost0.type}`);
      log(`videoViewCount:  ${latestPost0.videoViewCount}`);
      log(`videoPlayCount:  ${latestPost0.videoPlayCount}`);
      log(`likesCount:      ${latestPost0.likesCount}`);
      log(`commentsCount:   ${latestPost0.commentsCount}`);
      log(`timestamp:       ${latestPost0.timestamp}`);
      log(`url:             ${latestPost0.url}`);
      log(`caption (100c):  ${String(latestPost0.caption || '').substring(0, 100)}`);
    } else {
      log(`⚠️ latestPosts está vacío para @${p.username}`);
    }
  }

  return {
    runId,
    status:       lastStatus,
    perfilesCount: Array.isArray(perfiles) ? perfiles.length : 0,
    primerPerfil,
    latestPost0,
    perfiles,
  };
}
