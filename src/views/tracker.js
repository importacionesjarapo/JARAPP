import { db } from '../db.js';
import { auth } from '../auth.js';
import { getEstadoScheduler, ejecutarAhora } from '../services/schedulerService.js';
import { construirMensajeWhatsApp } from '../services/scraperService.js';

const client = () => db.client;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_KEY     = import.meta.env.VITE_GROQ_API_KEY;

// ─── Module state ─────────────────────────────────────────────────────────────
let _tab           = 'competidores';
let _filterTipo    = 'todos-comp';
let _filterTier    = 'todos';
let _filterSearch  = '';
let _filterAmenaza = 'todos';
let _filterConten  = 'todos';
let _filterEstado  = 'todos';
let _cuentas       = [];
let _posts         = [];
let _recs          = [];
let _scrapingLogs  = null; // null = aún no cargados
let _renderLayout  = null;

// ─── Styles (injected once) ───────────────────────────────────────────────────
function _injectStyles() {
  if (document.getElementById('tracker-global-styles')) return;
  const s = document.createElement('style');
  s.id = 'tracker-global-styles';
  s.textContent = `
    .tr-tab { background:none;border:none;padding:10px 18px;font-size:0.88rem;font-weight:600;color:var(--text-faint);cursor:pointer;border-bottom:3px solid transparent;transition:all 0.18s;font-family:var(--font);white-space:nowrap; }
    .tr-tab:hover { color:var(--text-main); }
    .tr-tab-active { color:#D91010 !important;border-bottom-color:#D91010 !important; }
    .tr-sel { background:var(--surface-2);border:1px solid var(--border-base);color:var(--text-main);padding:8px 14px;border-radius:10px;font-family:var(--font);font-size:0.84rem;cursor:pointer;outline:none; }
    .tr-inp { background:var(--surface-2);border:1px solid var(--border-base);color:var(--text-main);padding:8px 14px;border-radius:10px;font-family:var(--font);font-size:0.84rem;outline:none;transition:border-color 0.18s; }
    .tr-inp:focus { border-color:#D91010; }
    textarea.tr-inp { resize:vertical; }
    .tr-label { font-size:0.78rem;font-weight:600;color:var(--text-faint);display:block;margin-bottom:6px; }
    @keyframes tr-spin { to { transform:rotate(360deg); } }
    @keyframes tr-fadein { from { opacity:0;transform:translateY(6px); } to { opacity:1;transform:translateY(0); } }
    #tr-tab-content { animation:tr-fadein 0.22s ease; }
    .tr-card { transition:box-shadow 0.18s,transform 0.18s; }
    .tr-card:hover { transform:translateY(-1px);box-shadow:0 8px 30px rgba(0,0,0,0.18); }
    .tr-inspo-card { transition:transform 0.15s; }
    .tr-inspo-card:hover { transform:translateY(-2px); }
  `;
  document.head.appendChild(s);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function _toast(msg, type = 'info') {
  const colors = { info:'#3B82F6', success:'#10B981', danger:'#D91010', warning:'#F97316' };
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${colors[type]||colors.info};color:#fff;padding:12px 24px;border-radius:12px;font-weight:600;font-size:0.88rem;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:90vw;text-align:center;animation:tr-fadein 0.2s ease;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─── Badges ───────────────────────────────────────────────────────────────────
const AMENAZA = {
  alto:  { bg:'#D91010', label:'🔴 Alto' },
  medio: { bg:'#F97316', label:'🟠 Medio' },
  bajo:  { bg:'#6B7280', label:'⚪ Bajo' },
};
const ESTADO_REC = {
  pendiente:     { bg:'#6B728022', color:'#9CA3AF', label:'Pendiente' },
  en_produccion: { bg:'#F9731622', color:'#F97316', label:'En producción' },
  publicada:     { bg:'#10B98122', color:'#10B981', label:'Publicada' },
  descartada:    { bg:'#D9101022', color:'#D91010', label:'Descartada' },
};
const CAT_INSPO = {
  retail_usa: { label:'🛍 Retail USA',       color:'#3B82F6' },
  tienda_co:  { label:'🇨🇴 Tiendas Colombia', color:'#10B981' },
  sneakers:   { label:'👟 Sneakers',         color:'#F97316' },
  marketing:  { label:'📣 Marketing',        color:'#7C3AED' },
  creador:    { label:'🎬 Creadores',        color:'#D91010' },
  otros:      { label:'📦 Otros',            color:'#6B7280' },
};

function _bdg(bg, color, text) {
  return `<span style="background:${bg};color:${color};border:1px solid ${color}44;padding:3px 10px;border-radius:99px;font-size:0.72rem;font-weight:700;letter-spacing:0.03em;">${text}</span>`;
}

// ─── Groq ─────────────────────────────────────────────────────────────────────
const _SYSTEM_PROMPT = `Eres el estratega de contenido de Importaciones Jarapo, una empresa colombiana de personal shopping que importa productos originales desde USA (calzado, ropa, accesorios, vitaminas, perfumes, tecnología). El perfil de Instagram es @importaciones_jarapo con 36.3K seguidores verificados. El viaje es siempre a Orlando, nunca a Miami. El tono de contenido es "copy violento" — impactante, aspiracional, emocional y directo. El CTA siempre dirige a WhatsApp.

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

async function _groqAnalizar(post, cuenta) {
  const userMsg = `Analiza este post viral de @${cuenta?.usuario_ig || 'competidor'}:
- Tipo: ${post.tipo_contenido}
- Vistas: ${(post.vistas || 0).toLocaleString('es-CO')}
- Hook/primeras palabras: "${post.hook_texto || ''}"
- Caption: "${post.caption_completo || ''}"
- Categoría: ${post.categoria_contenido || ''}
- Nivel de amenaza: ${post.nivel_amenaza || ''}`;

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: _SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw  = data.choices[0].message.content;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Respuesta IA sin JSON válido');
  return JSON.parse(match[0]);
}

// ─── Alerta WhatsApp (stub) ───────────────────────────────────────────────────
function _alertaTracker(post, cuenta) {
  // TODO Sprint 2: enviar vía Kommo API
  // const msg = `🚨 *VIRAL DETECTADO*\n@${cuenta.usuario_ig} publicó un ${post.tipo_contenido} con ${(post.vistas||0).toLocaleString('es-CO')} vistas\nNivel: ${post.nivel_amenaza}\nHook: "${post.hook_texto}"\nVer en JARAPP → https://importacionesjarapo-jarapp.netlify.app/`;
  _toast(`🚨 VIRAL: @${cuenta?.usuario_ig} · ${(post.vistas||0).toLocaleString('es-CO')} vistas · Nivel ${post.nivel_amenaza}`, 'danger');
}

// ─── Data loaders ─────────────────────────────────────────────────────────────
async function _loadCuentas() {
  const { data, error } = await client()
    .from('cuentas_tracker')
    .select('*')
    .order('tipo_cuenta', { ascending: true })
    .order('nombre_display', { ascending: true });
  console.log('[Tracker] cuentas raw:', data, 'error:', error);
  if (error) throw error;
  _cuentas = data || [];
  console.log('[Tracker] _cuentas.length:', _cuentas.length, '| sample[0]:', _cuentas[0]);
  return _cuentas;
}

async function _loadPosts() {
  const { data, error } = await client()
    .from('posts_tracker')
    .select('*, cuenta:cuenta_id(usuario_ig,nombre_display)')
    .order('fecha_deteccion', { ascending: false });
  if (error) throw error;
  _posts = data || [];
  return _posts;
}

async function _loadRecs() {
  const { data, error } = await client()
    .from('recreaciones_tracker')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  _recs = data || [];
  return _recs;
}

async function _loadScrapingLogs() {
  const { data, error } = await client()
    .from('scraping_logs')
    .select('*')
    .order('fecha_ejecucion', { ascending: false })
    .limit(10);
  if (error) throw error;
  _scrapingLogs = data || [];
  return _scrapingLogs;
}

// ─── KPI strip ────────────────────────────────────────────────────────────────
function _kpis() {
  const comp   = _cuentas.filter(c => c.tipo_cuenta === 'competencia');
  const t1     = comp.filter(c => c.tier === 1);
  const viral  = _posts.filter(p => p.es_viral);
  const altos  = _posts.filter(p => p.nivel_amenaza === 'alto');
  return `
    <div class="kpi-strip" style="margin-bottom:24px;">
      <div class="kpi-strip-card">
        <span class="kpi-strip-icon">🏆</span>
        <div class="kpi-strip-value" style="color:#D91010;">${comp.length}</div>
        <div class="kpi-strip-label">Competidores</div>
      </div>
      <div class="kpi-strip-card">
        <span class="kpi-strip-icon">🎯</span>
        <div class="kpi-strip-value" style="color:#F97316;">${t1.length}</div>
        <div class="kpi-strip-label">Tier 1 críticos</div>
      </div>
      <div class="kpi-strip-card">
        <span class="kpi-strip-icon">🔥</span>
        <div class="kpi-strip-value" style="color:#D91010;">${viral.length}</div>
        <div class="kpi-strip-label">Posts virales</div>
      </div>
      <div class="kpi-strip-card">
        <span class="kpi-strip-icon">⚠️</span>
        <div class="kpi-strip-value" style="color:${altos.length ? '#D91010' : '#10B981'};">${altos.length}</div>
        <div class="kpi-strip-label">Amenaza alta</div>
      </div>
    </div>`;
}

// ─── Debug helper ────────────────────────────────────────────────────────────
function _debugSinResultados() {
  if (_cuentas.length === 0) {
    return `
      <div style="text-align:center;padding:40px;color:var(--text-faint);background:var(--surface-2);border-radius:12px;margin-top:8px;">
        <div style="font-size:2.5rem;margin-bottom:12px;">🔒</div>
        <p style="font-weight:700;color:var(--text-main);margin-bottom:8px;">No se cargaron cuentas (array vacío)</p>
        <p style="font-size:0.84rem;margin-bottom:12px;">Posible causa: <strong>Row Level Security (RLS)</strong> activo en <code>cuentas_tracker</code> sin política para el rol <code>anon</code>.</p>
        <p style="font-size:0.82rem;">Solución: en Supabase → Authentication → Policies → <strong>cuentas_tracker</strong> → agregar política de lectura para <code>anon</code>.<br>O bien: desactivar RLS en esa tabla.</p>
        <p style="font-size:0.78rem;margin-top:12px;color:#F97316;">Revisa el console.log '[Tracker] cuentas raw' en DevTools para confirmar.</p>
      </div>`;
  }
  // Data arrived but tipo_cuenta filter produced 0 — show actual field values for diagnosis
  const tiposEncontrados = [...new Set(_cuentas.map(c => c.tipo_cuenta))].join(', ');
  const camposEjemplo = _cuentas[0] ? Object.keys(_cuentas[0]).join(', ') : '—';
  return `
    <div style="padding:20px;background:var(--surface-2);border-radius:12px;border:1px solid #F97316;margin-top:8px;">
      <p style="font-weight:700;color:#F97316;margin-bottom:10px;">⚠️ Filtro sin resultados — datos presentes pero no coinciden</p>
      <p style="font-size:0.84rem;margin-bottom:6px;"><strong>Total cuentas cargadas:</strong> ${_cuentas.length}</p>
      <p style="font-size:0.84rem;margin-bottom:6px;"><strong>Valores de tipo_cuenta en DB:</strong> <code>${tiposEncontrados}</code></p>
      <p style="font-size:0.84rem;"><strong>Campos disponibles:</strong> <code>${camposEjemplo}</code></p>
    </div>`;
}

// ─── Tab: Competidores ────────────────────────────────────────────────────────
function _tabCompetidores() {
  let lista;
  if (_filterTipo === 'tienda') lista = _cuentas.filter(c => c.tipo_cuenta === 'tienda');
  else if (_filterTipo === 'todos-comp') lista = _cuentas.filter(c => c.tipo_cuenta === 'competencia' || c.tipo_cuenta === 'tienda');
  else lista = _cuentas.filter(c => c.tipo_cuenta === 'competencia');
  if (_filterTier !== 'todos') lista = lista.filter(c => String(c.tier) === _filterTier);
  if (_filterSearch) {
    const q = _filterSearch.toLowerCase();
    lista = lista.filter(c => c.usuario_ig.toLowerCase().includes(q) || c.nombre_display.toLowerCase().includes(q));
  }

  const COLORES = ['#D91010','#F97316','#3B82F6','#7C3AED','#10B981'];
  const rows = lista.map(c => {
    const col   = COLORES[c.nombre_display?.charCodeAt(0) % COLORES.length] || '#6B7280';
    const ini   = (c.nombre_display || '?').charAt(0).toUpperCase();
    const tier  = c.tier ? `<span style="background:${c.tier===1?'#D91010':'#F97316'};color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:800;">T${c.tier}</span>` : '<span style="color:var(--text-faint);font-size:0.8rem;">—</span>';
    const tipo  = { competencia:'#D91010', tienda:'#3B82F6', inspiracion:'#10B981' }[c.tipo_cuenta] || '#6B7280';
    const tipoL = { competencia:'Competencia', tienda:'Tienda', inspiracion:'Inspiración' }[c.tipo_cuenta] || c.tipo_cuenta;
    const activo = c.activo
      ? `<span style="color:#10B981;font-size:0.82rem;font-weight:600;">● Activo</span>`
      : `<span style="color:#6B7280;font-size:0.82rem;">○ Pausado</span>`;
    return `
      <tr style="border-bottom:1px solid var(--border-base);">
        <td style="padding:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:10px;background:${col}22;color:${col};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0;">${ini}</div>
            <div>
              <div><a href="https://instagram.com/${c.usuario_ig}" target="_blank" style="font-weight:700;color:var(--text-main);text-decoration:none;font-size:0.9rem;" onmouseover="this.style.color='#D91010'" onmouseout="this.style.color='var(--text-main)'">@${c.usuario_ig}</a></div>
              <div style="font-size:0.76rem;color:var(--text-faint);">${c.nombre_display}</div>
            </div>
          </div>
        </td>
        <td style="padding:12px;">${tier}</td>
        <td style="padding:12px;">${_bdg(tipo+'22', tipo, tipoL)}</td>
        <td style="padding:12px;font-size:0.82rem;color:var(--text-faint);">${c.pais || 'CO'}</td>
        <td style="padding:12px;">${activo}</td>
        <td style="padding:12px;">
          <button class="btn-action" style="border-color:#D91010;color:#D91010;font-size:0.78rem;"
            onclick="window._trPost('${c.id}','${c.usuario_ig}','${(c.nombre_display||'').replace(/'/g,"\\'").replace(/"/g,'\\"')}')">
            + Post viral
          </button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center;">
      <select class="tr-sel" onchange="window._trFilter('tipo',this.value)">
        <option value="todos-comp" ${_filterTipo==='todos-comp'?'selected':''}>Todos (competencia + tiendas)</option>
        <option value="competencia" ${_filterTipo==='competencia'?'selected':''}>Solo competencia</option>
        <option value="tienda" ${_filterTipo==='tienda'?'selected':''}>Solo tiendas</option>
      </select>
      <select class="tr-sel" onchange="window._trFilter('tier',this.value)">
        <option value="todos" ${_filterTier==='todos'?'selected':''}>Todos los tiers</option>
        <option value="1" ${_filterTier==='1'?'selected':''}>Tier 1</option>
        <option value="2" ${_filterTier==='2'?'selected':''}>Tier 2</option>
      </select>
      <input class="tr-inp" style="flex:1;min-width:200px;" type="text" placeholder="🔍 Buscar @usuario o nombre..."
        value="${_filterSearch}" oninput="window._trFilter('search',this.value)">
      <button class="btn-primary" onclick="window._trAddCuenta()">+ Agregar cuenta</button>
    </div>
    ${!lista.length ? _debugSinResultados() : `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid var(--border-base);">
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">CUENTA</th>
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">TIER</th>
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">TIPO</th>
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">PAÍS</th>
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">ESTADO</th>
            <th style="text-align:left;padding:10px 12px;font-size:0.75rem;color:var(--text-faint);font-weight:700;">ACCIÓN</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;color:var(--text-faint);font-size:0.8rem;">${lista.length} cuentas</div>
    `}`;
}

// ─── Tab: Posts virales ───────────────────────────────────────────────────────
function _tabPosts() {
  let lista = [..._posts];
  const recMap = {};
  _recs.forEach(r => { recMap[r.post_id] = r; });

  // Counts per state (always from full dataset, independent of other filters)
  const stateCounts = {
    pendiente:     _posts.filter(p => recMap[p.id]?.estado === 'pendiente').length,
    en_produccion: _posts.filter(p => recMap[p.id]?.estado === 'en_produccion').length,
    publicada:     _posts.filter(p => recMap[p.id]?.estado === 'publicada').length,
    descartada:    _posts.filter(p => recMap[p.id]?.estado === 'descartada').length,
  };

  // Apply all filters (combinable)
  if (_filterAmenaza !== 'todos') lista = lista.filter(p => p.nivel_amenaza === _filterAmenaza);
  if (_filterConten  !== 'todos') lista = lista.filter(p => p.tipo_contenido === _filterConten);
  if (_filterEstado  !== 'todos') lista = lista.filter(p => recMap[p.id]?.estado === _filterEstado);

  // Summary mini-cards
  const stateCards = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      <div style="background:#6B72801A;border:1px solid #6B728033;border-radius:12px;padding:12px 14px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:800;color:#9CA3AF;">${stateCounts.pendiente}</div>
        <div style="font-size:0.75rem;color:#9CA3AF;font-weight:600;margin-top:2px;">⏳ Pendiente</div>
      </div>
      <div style="background:#F9731618;border:1px solid #F9731633;border-radius:12px;padding:12px 14px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:800;color:#F97316;">${stateCounts.en_produccion}</div>
        <div style="font-size:0.75rem;color:#F97316;font-weight:600;margin-top:2px;">🎬 En producción</div>
      </div>
      <div style="background:#DCFCE7;border:1px solid #16653433;border-radius:12px;padding:12px 14px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:800;color:#166534;">${stateCounts.publicada}</div>
        <div style="font-size:0.75rem;color:#166534;font-weight:600;margin-top:2px;">✅ Publicada</div>
      </div>
      <div style="background:#FCA5A51A;border:1px solid #FCA5A555;border-radius:12px;padding:12px 14px;text-align:center;">
        <div style="font-size:1.4rem;font-weight:800;color:#991B1B;">${stateCounts.descartada}</div>
        <div style="font-size:0.75rem;color:#991B1B;font-weight:600;margin-top:2px;">❌ Descartada</div>
      </div>
    </div>`;

  // State pill/tab buttons
  const estadoPills = [
    { val:'todos',         emoji:'',   label:'Todos' },
    { val:'pendiente',     emoji:'⏳', label:'Pendiente' },
    { val:'en_produccion', emoji:'🎬', label:'En producción' },
    { val:'publicada',     emoji:'✅', label:'Publicada' },
    { val:'descartada',    emoji:'❌', label:'Descartada' },
  ];
  const pillsHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
      ${estadoPills.map(p => {
        const active = _filterEstado === p.val;
        return `<button onclick="window._trFilterPost('estado','${p.val}')"
          style="padding:7px 16px;border-radius:99px;border:2px solid ${active?'#D91010':'var(--border-base)'};background:${active?'#D91010':'var(--surface-2)'};color:${active?'#fff':'var(--text-faint)'};font-size:0.82rem;font-weight:700;cursor:pointer;font-family:var(--font);transition:all 0.15s;">
          ${p.emoji ? p.emoji+' ' : ''}${p.label}
        </button>`;
      }).join('')}
    </div>`;

  const filters = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center;">
      <select class="tr-sel" onchange="window._trFilterPost('amenaza',this.value)">
        <option value="todos" ${_filterAmenaza==='todos'?'selected':''}>Todos los niveles</option>
        <option value="alto"  ${_filterAmenaza==='alto' ?'selected':''}>🔴 Alto</option>
        <option value="medio" ${_filterAmenaza==='medio'?'selected':''}>🟠 Medio</option>
        <option value="bajo"  ${_filterAmenaza==='bajo' ?'selected':''}>⚪ Bajo</option>
      </select>
      <select class="tr-sel" onchange="window._trFilterPost('contenido',this.value)">
        <option value="todos"    ${_filterConten==='todos'?   'selected':''}>Todos los formatos</option>
        <option value="reel"     ${_filterConten==='reel'?    'selected':''}>Reel</option>
        <option value="carrusel" ${_filterConten==='carrusel'?'selected':''}>Carrusel</option>
        <option value="post"     ${_filterConten==='post'?    'selected':''}>Post</option>
        <option value="story"    ${_filterConten==='story'?   'selected':''}>Story</option>
      </select>
      <span style="color:var(--text-faint);font-size:0.82rem;margin-left:auto;">${lista.length} post${lista.length!==1?'s':''}</span>
    </div>`;

  if (!lista.length) return stateCards + pillsHTML + filters + `
    <div style="text-align:center;padding:60px;color:var(--text-faint);">
      <div style="font-size:3rem;margin-bottom:16px;">📭</div>
      <p>No hay posts${_filterEstado !== 'todos' ? ' con este estado' : ''} registrados.<br>
      ${_filterEstado !== 'todos' ? 'Prueba seleccionar otro estado.' : 'Ve a <strong>Competidores</strong> y usa el botón <em>"+ Post viral"</em>.'}
      </p>
    </div>`;

  const cards = lista.map(p => {
    const am  = AMENAZA[p.nivel_amenaza] || { bg:'#6B7280', label:'—' };
    const rec = recMap[p.id];
    const er  = rec ? (ESTADO_REC[rec.estado] || ESTADO_REC.pendiente) : null;
    const cu  = p.cuenta || {};
    const fDet = p.fecha_deteccion
      ? new Date(p.fecha_deteccion).toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const fPub = p.fecha_publicacion
      ? new Date(p.fecha_publicacion).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) : '—';

    return `
      <div class="glass-card tr-card" style="padding:20px;margin-bottom:14px;border-left:4px solid ${am.bg};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span style="background:${am.bg};color:#fff;padding:4px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;">${am.label}</span>
            <span style="background:var(--surface-2);color:var(--text-faint);padding:4px 10px;border-radius:8px;font-size:0.73rem;font-weight:600;">${(p.tipo_contenido||'—').toUpperCase()}</span>
            ${p.es_viral ? `<span style="background:#D9101022;color:#D91010;border:1px solid #D9101055;padding:4px 10px;border-radius:8px;font-size:0.73rem;font-weight:700;">🔥 VIRAL</span>` : ''}
          </div>
          ${er ? `<span style="background:${er.bg};color:${er.color};border:1px solid ${er.color}55;padding:4px 10px;border-radius:8px;font-size:0.72rem;font-weight:600;">${er.label}</span>` : ''}
        </div>

        <div style="margin-bottom:10px;">
          <a href="https://instagram.com/${cu.usuario_ig||''}" target="_blank" style="font-weight:700;color:var(--text-main);text-decoration:none;font-size:0.95rem;"
            onmouseover="this.style.color='#D91010'" onmouseout="this.style.color='var(--text-main)'">@${cu.usuario_ig||'—'}</a>
          <span style="color:var(--text-faint);font-size:0.82rem;"> · ${cu.nombre_display||''}</span>
        </div>

        ${p.hook_texto ? `<div style="font-style:italic;padding:12px;background:var(--surface-2);border-radius:10px;font-size:0.88rem;margin-bottom:12px;line-height:1.5;">"${p.hook_texto}"</div>` : ''}

        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px;align-items:center;">
          <span style="color:var(--text-faint);font-size:0.82rem;">👁 <strong style="color:var(--text-main);">${(p.vistas||0).toLocaleString('es-CO')}</strong></span>
          <span style="color:var(--text-faint);font-size:0.82rem;">❤️ <strong style="color:var(--text-main);">${(p.likes_estimados||0).toLocaleString('es-CO')}</strong></span>
          <span style="color:var(--text-faint);font-size:0.82rem;">💬 <strong style="color:var(--text-main);">${(p.comentarios||0).toLocaleString('es-CO')}</strong></span>
          <span style="color:var(--text-faint);font-size:0.82rem;">📅 Pub: ${fPub}</span>
          <span style="color:var(--text-faint);font-size:0.82rem;">🔍 Det: ${fDet}</span>
          ${p.crecimiento_24h > 0 ? `<span style="background:${p.crecimiento_24h >= 50 ? '#10B98120' : '#F9731620'};color:${p.crecimiento_24h >= 50 ? '#10B981' : '#F97316'};border:1px solid ${p.crecimiento_24h >= 50 ? '#10B98155' : '#F9731655'};padding:3px 10px;border-radius:99px;font-size:0.72rem;font-weight:700;">📈 +${Math.round(p.crecimiento_24h)}% en 24h</span>` : ''}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${p.url_post ? `<a href="${p.url_post}" target="_blank" class="btn-action" style="text-decoration:none;">Ver post ↗</a>` : ''}
          ${p.analisis_ia ? `<button class="btn-action" onclick="window._trToggle('tria-${p.id}')">📊 Análisis IA</button>` : ''}
          ${rec ? `<button class="btn-action" onclick="window._trToggle('trrec-${p.id}')">🎬 Recreación</button>` : ''}
          ${rec ? `<button class="btn-action" onclick="window._trEstado('${rec.id}','${rec.estado}')">Cambiar estado</button>` : ''}
          ${!p.analisis_ia ? `<button class="btn-action" style="border-color:#7C3AED;color:#7C3AED;" onclick="window._trGenIA('${p.id}',this)">✨ Generar IA</button>` : ''}
        </div>

        ${p.analisis_ia ? `
          <div id="tria-${p.id}" style="display:none;margin-top:14px;padding:16px;background:var(--surface-2);border-radius:12px;">
            <div style="font-weight:700;margin-bottom:8px;color:#7C3AED;font-size:0.88rem;">🤖 Análisis IA</div>
            <p style="font-size:0.86rem;line-height:1.7;white-space:pre-wrap;">${p.analisis_ia}</p>
          </div>` : ''}

        ${rec ? `
          <div id="trrec-${p.id}" style="display:none;margin-top:14px;padding:16px;background:#D9101008;border-radius:12px;border:1px solid #D9101033;">
            <div style="font-weight:700;margin-bottom:12px;color:#D91010;font-size:0.88rem;">🎬 Propuesta de Recreación para Jarapo</div>
            ${rec.hook_jarapo ? `<div style="margin-bottom:10px;"><span style="font-size:0.75rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">Hook:</span><br><span style="font-size:0.9rem;font-weight:700;color:#D91010;">"${rec.hook_jarapo}"</span></div>` : ''}
            ${rec.guion_recreacion ? `<div style="margin-bottom:10px;"><span style="font-size:0.75rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">Guión:</span><br><p style="font-size:0.86rem;line-height:1.7;white-space:pre-wrap;margin-top:4px;">${rec.guion_recreacion}</p></div>` : ''}
            ${rec.cta_sugerido ? `<div style="margin-bottom:10px;"><span style="font-size:0.75rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">CTA:</span><br><span style="font-size:0.86rem;">${rec.cta_sugerido}</span></div>` : ''}
            ${rec.musica_sugerida ? `<div style="margin-bottom:10px;"><span style="font-size:0.75rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">Música:</span> ${rec.musica_sugerida}</div>` : ''}
            ${rec.checklist_produccion?.length ? `
              <div><span style="font-size:0.75rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">Checklist producción:</span>
                <ul style="margin-top:8px;padding-left:20px;font-size:0.84rem;line-height:2.1;">
                  ${rec.checklist_produccion.map(s => `<li>${s}</li>`).join('')}
                </ul>
              </div>` : ''}
          </div>` : ''}
      </div>`;
  }).join('');

  return stateCards + pillsHTML + filters + cards;
}

// ─── Tab: Inspiración ─────────────────────────────────────────────────────────
function _tabInspiracion() {
  const cuentas = _cuentas.filter(c => c.tipo_cuenta === 'tienda' || c.tipo_cuenta === 'inspiracion');
  const grouped = {};
  cuentas.forEach(c => {
    const cat = c.categoria || 'otros';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  const sections = Object.entries(CAT_INSPO).map(([cat, meta]) => {
    const items = grouped[cat];
    if (!items?.length) return '';
    return `
      <div style="margin-bottom:30px;">
        <h3 style="font-size:0.95rem;font-weight:700;color:${meta.color};margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid ${meta.color}33;">
          ${meta.label} <span style="font-weight:400;font-size:0.82rem;color:var(--text-faint);">(${items.length})</span>
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;">
          ${items.map(c => {
            const ini = (c.nombre_display||'?').charAt(0).toUpperCase();
            return `
              <a href="https://instagram.com/${c.usuario_ig}" target="_blank" style="text-decoration:none;">
                <div class="glass-card tr-inspo-card" style="padding:14px;display:flex;align-items:center;gap:10px;border-left:3px solid ${meta.color};">
                  <div style="width:38px;height:38px;border-radius:10px;background:${meta.color}22;color:${meta.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0;">${ini}</div>
                  <div style="overflow:hidden;min-width:0;">
                    <div style="font-weight:600;font-size:0.85rem;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${c.usuario_ig}</div>
                    <div style="font-size:0.73rem;color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.nombre_display}</div>
                  </div>
                </div>
              </a>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  return sections || `<div style="text-align:center;padding:60px;color:var(--text-faint);">Sin cuentas de inspiración.</div>`;
}

// ─── Tab: Scraping (solo admin) ───────────────────────────────────────────────
function _tabScraping() {
  const sched   = getEstadoScheduler();
  const proxima = sched.proximaEjecucion
    ? sched.proximaEjecucion.toLocaleString('es-CO', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : '—';

  const ultimoLog    = _scrapingLogs?.[0];
  const ultimaFecha  = ultimoLog?.fecha_ejecucion
    ? new Date(ultimoLog.fecha_ejecucion).toLocaleString('es-CO', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : 'Nunca';
  const ultimoEstado = ultimoLog?.estado || '—';
  const estadoColor  = ultimoEstado === 'completado' ? '#10B981' : ultimoEstado === 'error' ? '#D91010' : '#F97316';

  const secEstado = `
    <div class="glass-card" style="padding:22px;margin-bottom:18px;">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:16px;">📡 Estado del sistema</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:16px;">
        <div style="background:var(--surface-2);border-radius:10px;padding:14px;">
          <div style="font-size:0.72rem;color:var(--text-faint);font-weight:700;margin-bottom:4px;text-transform:uppercase;">Estado</div>
          <div style="font-size:0.95rem;font-weight:700;">${sched.activo ? '🟢 Activo' : '🔴 Inactivo'}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:14px;">
          <div style="font-size:0.72rem;color:var(--text-faint);font-weight:700;margin-bottom:4px;text-transform:uppercase;">Próxima ejecución</div>
          <div style="font-size:0.88rem;font-weight:600;">${proxima}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:14px;">
          <div style="font-size:0.72rem;color:var(--text-faint);font-weight:700;margin-bottom:4px;text-transform:uppercase;">Última ejecución</div>
          <div style="font-size:0.88rem;font-weight:600;">${ultimaFecha}</div>
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:14px;">
          <div style="font-size:0.72rem;color:var(--text-faint);font-weight:700;margin-bottom:4px;text-transform:uppercase;">Último estado</div>
          <div style="font-size:0.9rem;font-weight:700;color:${estadoColor};">${ultimoEstado}</div>
        </div>
      </div>
      <div style="background:#F9731615;border:1px solid #F9731633;border-radius:10px;padding:12px 14px;font-size:0.82rem;color:#F97316;">
        ⚠️ El scheduler solo corre mientras JARAPP esté abierto en el navegador.
        En Sprint 3 se migrará a Supabase Edge Functions para ejecución continua.
      </div>
    </div>`;

  const secManual = `
    <div class="glass-card" style="padding:22px;margin-bottom:18px;">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:4px;">▶ Ejecución manual</h3>
      <p style="color:var(--text-faint);font-size:0.84rem;margin-bottom:16px;">
        Inicia el scraping inmediatamente. Puede tardar varios minutos según el número de cuentas.
      </p>
      <button id="tr-scraping-btn" class="btn-primary" style="font-size:0.92rem;" onclick="window._trEjecutarScraping()">
        ▶ Ejecutar scraping ahora
      </button>
      <div id="tr-scraping-log" style="display:none;margin-top:18px;background:var(--surface-2);border-radius:12px;padding:16px;font-family:monospace;font-size:0.82rem;line-height:2;max-height:240px;overflow-y:auto;white-space:pre-wrap;"></div>
    </div>`;

  // Historial
  let histBody = '';
  if (!_scrapingLogs) {
    histBody = `<div style="padding:20px;text-align:center;color:var(--text-faint);">Cargando historial...</div>`;
  } else if (_scrapingLogs.length === 0) {
    histBody = `<div style="padding:24px;text-align:center;color:var(--text-faint);">Sin ejecuciones registradas aún.<br>Usa el botón "Ejecutar scraping ahora" para comenzar.</div>`;
  } else {
    const rows = _scrapingLogs.map(log => {
      const fecha = new Date(log.fecha_ejecucion).toLocaleString('es-CO', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const ec = log.estado === 'completado' ? '#10B981' : log.estado === 'error' ? '#D91010' : '#F97316';
      return `<tr style="border-bottom:1px solid var(--border-base);">
        <td style="padding:10px 12px;font-size:0.82rem;">${fecha}</td>
        <td style="padding:10px 12px;text-align:center;font-size:0.82rem;">${log.cuentas_procesadas}</td>
        <td style="padding:10px 12px;text-align:center;font-size:0.82rem;">${log.posts_nuevos_detectados}</td>
        <td style="padding:10px 12px;text-align:center;font-size:0.82rem;color:#D91010;font-weight:700;">${log.posts_virales_detectados}</td>
        <td style="padding:10px 12px;text-align:center;font-size:0.82rem;">${log.errores || 0}</td>
        <td style="padding:10px 12px;text-align:center;font-size:0.82rem;">${log.duracion_segundos ? log.duracion_segundos + 's' : '—'}</td>
        <td style="padding:10px 12px;text-align:center;">
          <span style="color:${ec};font-size:0.78rem;font-weight:700;">${log.estado}</span>
        </td>
      </tr>`;
    }).join('');
    histBody = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid var(--border-base);">
            <th style="text-align:left;padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">FECHA/HORA</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">CUENTAS</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">NUEVOS</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">VIRALES</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">ERRORES</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">DURACIÓN</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">ESTADO</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const secHistorial = `
    <div class="glass-card" style="padding:22px;margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-size:1rem;font-weight:800;">📋 Historial de ejecuciones</h3>
        <button class="btn-action" onclick="window._trRefrescarLogs()">🔄 Refrescar</button>
      </div>
      ${histBody}
    </div>`;

  // Umbrales
  const cuentasUmbral = _cuentas.filter(c => c.tipo_cuenta === 'competencia' || c.tipo_cuenta === 'tienda');
  const umbralRows = cuentasUmbral.map(c => {
    const umbral = c.umbral_vistas
      ? c.umbral_vistas.toLocaleString('es-CO')
      : (c.tier === 1 ? '10.000' : '30.000') + ' (defecto)';
    return `<tr style="border-bottom:1px solid var(--border-base);">
      <td style="padding:10px 12px;font-size:0.83rem;font-weight:600;">@${c.usuario_ig}</td>
      <td style="padding:10px 12px;font-size:0.82rem;color:var(--text-faint);">${c.nombre_display}</td>
      <td style="padding:10px 12px;text-align:center;">
        ${c.tier ? `<span style="background:${c.tier===1?'#D91010':'#F97316'};color:#fff;padding:2px 7px;border-radius:6px;font-size:0.7rem;font-weight:800;">T${c.tier}</span>` : '—'}
      </td>
      <td style="padding:10px 12px;text-align:center;font-size:0.83rem;font-weight:700;">${umbral}</td>
      <td style="padding:10px 12px;">
        <button class="btn-action" style="font-size:0.76rem;"
          onclick="window._trEditarUmbral('${c.id}','${c.usuario_ig}',${c.umbral_vistas || ''})">
          ✏️ Editar
        </button>
      </td>
    </tr>`;
  }).join('');

  // Sección: Cuentas sin datos (del último scraping)
  const sinDatosUltimo = _scrapingLogs?.[0]?.resumen?.cuentas_sin_datos || [];
  const secSinDatos = sinDatosUltimo.length === 0 ? '' : `
    <div class="glass-card" style="padding:22px;margin-bottom:18px;border-left:4px solid #F97316;">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:6px;color:#F97316;">⚠️ Cuentas sin datos (última ejecución)</h3>
      <p style="color:var(--text-faint);font-size:0.82rem;margin-bottom:14px;">
        Apify no devolvió posts para estas cuentas. Pueden tener el username incorrecto,
        ser privadas, o haber sido suspendidas. Verifica en Instagram y corrige en la pestaña Competidores.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${sinDatosUltimo.map(u => `
          <a href="https://instagram.com/${u}" target="_blank"
            style="background:#F9731618;color:#F97316;border:1px solid #F9731644;padding:5px 12px;border-radius:99px;font-size:0.82rem;font-weight:600;text-decoration:none;">
            @${u} ↗
          </a>`).join('')}
      </div>
    </div>`;

  // Sección: Cuentas desactivadas automáticamente
  const desactivadasUltimo = _scrapingLogs?.[0]?.resumen?.cuentas_desactivadas || [];
  const secDesactivadas = desactivadasUltimo.length === 0 ? '' : `
    <div class="glass-card" style="padding:22px;margin-bottom:18px;border-left:4px solid #EF4444;">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:6px;color:#EF4444;">
        🔕 ${desactivadasUltimo.length} cuenta${desactivadasUltimo.length !== 1 ? 's' : ''} desactivada${desactivadasUltimo.length !== 1 ? 's' : ''} automáticamente
      </h3>
      <p style="color:var(--text-faint);font-size:0.82rem;margin-bottom:14px;">
        Estas cuentas no devolvieron datos en 2 ejecuciones consecutivas y fueron desactivadas.
        Para reactivarlas corrige el username en Supabase y activa la cuenta manualmente.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${desactivadasUltimo.map(u => `
          <a href="https://instagram.com/${u}" target="_blank"
            style="background:#EF444418;color:#EF4444;border:1px solid #EF444444;padding:5px 12px;border-radius:99px;font-size:0.82rem;font-weight:600;text-decoration:none;">
            @${u} ↗
          </a>`).join('')}
      </div>
    </div>`;

  const secUmbrales = `
    <div class="glass-card" style="padding:22px;">
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:4px;">⚙️ Umbrales de detección</h3>
      <p style="color:var(--text-faint);font-size:0.82rem;margin-bottom:16px;">
        Si un post supera este número de vistas se marca como viral y genera análisis IA automáticamente.
      </p>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="border-bottom:2px solid var(--border-base);">
            <th style="text-align:left;padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">@USUARIO</th>
            <th style="text-align:left;padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">NOMBRE</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">TIER</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">UMBRAL VISTAS</th>
            <th style="padding:8px 12px;font-size:0.72rem;color:var(--text-faint);font-weight:700;">ACCIÓN</th>
          </tr></thead>
          <tbody>${umbralRows}</tbody>
        </table>
      </div>
    </div>`;

  return secEstado + secManual + secHistorial + secSinDatos + secDesactivadas + secUmbrales;
}

// ─── Sync posts tab counter without full re-render ───────────────────────────
function _syncPostsTabCount() {
  const rm = {};
  _recs.forEach(r => { rm[r.post_id] = r; });
  const count = _filterEstado === 'todos'
    ? _posts.length
    : _posts.filter(p => rm[p.id]?.estado === _filterEstado).length;
  const el = document.getElementById('tr-posts-count');
  if (el) el.textContent = count;
}

// ─── Render UI ────────────────────────────────────────────────────────────────
function _renderUI() {
  console.log('[Tracker] _renderUI called | _cuentas:', _cuentas.length, '| _posts:', _posts.length, '| _recs:', _recs.length);
  const rm = {};
  _recs.forEach(r => { rm[r.post_id] = r; });
  const postsCount = _filterEstado === 'todos'
    ? _posts.length
    : _posts.filter(p => rm[p.id]?.estado === _filterEstado).length;

  const tabs = [
    { id:'competidores', label:'🏆 Competidores', count: _cuentas.filter(c=>c.tipo_cuenta==='competencia').length },
    { id:'posts',        label:'🔥 Posts virales', count: postsCount },
    { id:'inspiracion',  label:'💡 Inspiración',   count: _cuentas.filter(c=>c.tipo_cuenta!=='competencia').length },
    ...(auth.isAdmin() ? [{ id:'scraping', label:'⚙️ Scraping', count: null }] : []),
  ];

  const tabsHTML = tabs.map(t => `
    <button class="tr-tab ${_tab===t.id?'tr-tab-active':''}" onclick="window._trTab('${t.id}')">
      ${t.label}
      ${t.count !== null ? `<span ${t.id==='posts'?'id="tr-posts-count"':''} style="background:var(--surface-2);color:var(--text-faint);padding:2px 7px;border-radius:99px;font-size:0.7rem;margin-left:6px;">${t.count}</span>` : ''}
    </button>`).join('');

  let content = '';
  if (_tab === 'competidores') content = _tabCompetidores();
  else if (_tab === 'posts')   content = _tabPosts();
  else if (_tab === 'scraping') content = _tabScraping();
  else                         content = _tabInspiracion();

  _renderLayout(`
    <div>
      <div style="margin-bottom:20px;">
        <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:4px;">📊 Competitor Tracker</h2>
        <p style="color:var(--text-faint);font-size:0.85rem;">Monitoreo Instagram · Registro manual de posts virales · Análisis IA con Groq</p>
      </div>

      ${_kpis()}

      <div class="glass-card" style="padding:0;overflow:hidden;">
        <div style="display:flex;border-bottom:1px solid var(--border-base);padding:0 16px;overflow-x:auto;">
          ${tabsHTML}
        </div>
        <div id="tr-tab-content" style="padding:24px;">
          ${content}
        </div>
      </div>
    </div>
  `);
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function renderTracker(renderLayout, navigateTo) {
  _renderLayout = renderLayout;
  _injectStyles();

  renderLayout(`
    <div style="display:flex;align-items:center;justify-content:center;height:50vh;gap:14px;">
      <div style="width:26px;height:26px;border:3px solid #D91010;border-top-color:transparent;border-radius:50%;animation:tr-spin 0.8s linear infinite;"></div>
      <span style="color:var(--text-faint);">Cargando Competitor Tracker…</span>
    </div>`);

  try {
    await Promise.all([_loadCuentas(), _loadPosts(), _loadRecs()]);
    _renderUI();
    _registerHandlers();
  } catch(err) {
    renderLayout(`
      <div style="text-align:center;padding:60px;">
        <div style="font-size:3rem;margin-bottom:16px;">❌</div>
        <p style="color:var(--text-faint);margin-bottom:16px;">Error al cargar: ${err.message}</p>
        <button class="btn-primary" onclick="window._navigateTo('tracker')">Reintentar</button>
      </div>`);
  }
}

// ─── Global handlers (registered once, reused across re-renders) ──────────────
let _handlersRegistered = false;
function _registerHandlers() {
  if (_handlersRegistered) return;
  _handlersRegistered = true;

  window._trTab = async (tab) => {
    _tab = tab;
    _renderUI(); // render inmediato (puede mostrar "Cargando historial...")
    if (tab === 'scraping' && _scrapingLogs === null) {
      await _loadScrapingLogs().catch(() => { _scrapingLogs = []; });
      _renderUI(); // re-render con datos reales
    }
  };

  window._trFilter = (type, val) => {
    if (type === 'tipo')   { _filterTipo = val; }
    if (type === 'tier')   _filterTier   = val;
    if (type === 'search') _filterSearch = val;
    const el = document.getElementById('tr-tab-content');
    if (el) el.innerHTML = _tabCompetidores();
  };

  window._trFilterPost = (type, val) => {
    if (type === 'amenaza')   _filterAmenaza = val;
    if (type === 'contenido') _filterConten  = val;
    if (type === 'estado')    _filterEstado  = val;
    const el = document.getElementById('tr-tab-content');
    if (el) el.innerHTML = _tabPosts();
    // Sync tab counter when estado filter changes
    if (type === 'estado') _syncPostsTabCount();
  };

  window._trToggle = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  };

  window._trPost = (cuentaId, usuarioIg, nombreDisplay) => {
    _modalRegistrarPost(cuentaId, usuarioIg, nombreDisplay);
  };

  window._trAddCuenta = () => {
    _modalAgregarCuenta();
  };

  window._trEstado = (recId, estadoActual) => {
    _modalCambiarEstado(recId, estadoActual);
  };

  window._trGenIA = async (postId, btn) => {
    const post = _posts.find(p => p.id === postId);
    if (!post) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando…'; }
    try {
      const cuenta = _cuentas.find(c => c.id === post.cuenta_id);
      const ia = await _groqAnalizar(post, cuenta);
      await Promise.all([
        client().from('posts_tracker').update({ analisis_ia: ia.analisis }).eq('id', postId),
        client().from('recreaciones_tracker').upsert({
          post_id: postId,
          guion_recreacion: ia.guion_recreacion,
          hook_jarapo: ia.hook_jarapo,
          cta_sugerido: ia.cta_sugerido,
          musica_sugerida: ia.musica_sugerida,
          checklist_produccion: ia.checklist_produccion,
          estado: 'pendiente',
        }),
      ]);
      _toast('✅ Análisis IA generado y guardado.', 'success');
      await Promise.all([_loadPosts(), _loadRecs()]);
      _renderUI();
    } catch(err) {
      _toast(`Error IA: ${err.message}`, 'danger');
      if (btn) { btn.disabled = false; btn.textContent = '✨ Generar IA'; }
    }
  };
}

// ─── Modal: Registrar post viral ──────────────────────────────────────────────
function _modalRegistrarPost(cuentaId, usuarioIg, nombreDisplay) {
  const c = document.getElementById('modal-container');
  const m = document.getElementById('modal-content');
  if (!c || !m) return;

  m.innerHTML = `
    <div class="modal-content" style="max-width:800px;">
      <div class="modal-header">
        <div>
          <h2>+ Registrar post viral</h2>
          <p style="color:var(--text-faint);font-size:0.82rem;margin-top:4px;font-weight:400;">@${usuarioIg} · ${nombreDisplay}</p>
        </div>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>

      <div class="modal-body" style="display:grid;gap:18px;">
        <!-- Fila 1: URL completa -->
        <div>
          <label class="tr-label">URL del post *</label>
          <input id="trp-url" type="url" class="tr-inp" style="width:100%;" placeholder="https://www.instagram.com/reel/...">
        </div>

        <!-- Fila 2: Tipo | Amenaza -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">Tipo de contenido</label>
            <select id="trp-tipo" class="tr-sel" style="width:100%;">
              <option value="reel">Reel</option>
              <option value="carrusel">Carrusel</option>
              <option value="post">Post</option>
              <option value="story">Story</option>
            </select>
          </div>
          <div>
            <label class="tr-label">Nivel de amenaza</label>
            <select id="trp-amenaza" class="tr-sel" style="width:100%;">
              <option value="alto">🔴 Alto</option>
              <option value="medio" selected>🟠 Medio</option>
              <option value="bajo">⚪ Bajo</option>
            </select>
          </div>
        </div>

        <!-- Fila 3: Vistas | Likes | Comentarios -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">Vistas actuales</label>
            <input id="trp-vistas" type="number" class="tr-inp" style="width:100%;" placeholder="10000">
          </div>
          <div>
            <label class="tr-label">Likes estimados</label>
            <input id="trp-likes" type="number" class="tr-inp" style="width:100%;" placeholder="500">
          </div>
          <div>
            <label class="tr-label">Comentarios</label>
            <input id="trp-coms" type="number" class="tr-inp" style="width:100%;" placeholder="50">
          </div>
        </div>

        <!-- Fila 4: Hook -->
        <div>
          <label class="tr-label">Hook / primeras palabras del post</label>
          <input id="trp-hook" type="text" class="tr-inp" style="width:100%;" placeholder="Las primeras palabras o idea central del reel…">
        </div>

        <!-- Fila 5: Caption -->
        <div>
          <label class="tr-label">Caption completo</label>
          <textarea id="trp-caption" class="tr-inp" style="width:100%;height:110px;" placeholder="Pega el caption completo del post aquí…"></textarea>
        </div>

        <!-- Fila 6: Categoría | Fecha -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">Categoría de contenido</label>
            <select id="trp-cat" class="tr-sel" style="width:100%;">
              <option value="historia_personal">Historia personal</option>
              <option value="producto">Producto</option>
              <option value="precio">Precio / Ahorro</option>
              <option value="oferta">Oferta</option>
              <option value="lifestyle">Lifestyle</option>
              <option value="educativo">Educativo</option>
            </select>
          </div>
          <div>
            <label class="tr-label">Fecha de publicación</label>
            <input id="trp-fecha" type="date" class="tr-inp" style="width:100%;" value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>

        <!-- Fila 7: Viral checkbox -->
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--surface-2);border-radius:10px;">
          <input type="checkbox" id="trp-viral" style="width:18px;height:18px;accent-color:#D91010;flex-shrink:0;">
          <label for="trp-viral" style="font-size:0.92rem;font-weight:600;cursor:pointer;">Marcar como viral 🔥 <span style="font-size:0.8rem;font-weight:400;color:var(--text-faint);">(activa alerta WhatsApp)</span></label>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button id="trp-btn" class="btn-primary" onclick="window._trGuardarPost('${cuentaId}')">
          💾 Guardar y generar análisis IA
        </button>
      </div>
    </div>`;

  c.style.display = 'flex';
}

window._trGuardarPost = async (cuentaId) => {
  const url     = document.getElementById('trp-url')?.value?.trim();
  const tipo    = document.getElementById('trp-tipo')?.value;
  const amenaza = document.getElementById('trp-amenaza')?.value;
  const vistas  = parseInt(document.getElementById('trp-vistas')?.value) || 0;
  const likes   = parseInt(document.getElementById('trp-likes')?.value) || 0;
  const coms    = parseInt(document.getElementById('trp-coms')?.value) || 0;
  const hook    = document.getElementById('trp-hook')?.value?.trim() || '';
  const caption = document.getElementById('trp-caption')?.value?.trim() || '';
  const cat     = document.getElementById('trp-cat')?.value;
  const fecha   = document.getElementById('trp-fecha')?.value;
  const viral   = document.getElementById('trp-viral')?.checked || false;

  if (!url) { _toast('La URL del post es obligatoria.', 'warning'); return; }

  const btn = document.getElementById('trp-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando…'; }

  try {
    const { data: inserted, error } = await client()
      .from('posts_tracker')
      .insert([{
        cuenta_id: cuentaId, url_post: url, tipo_contenido: tipo,
        vistas, likes_estimados: likes, comentarios: coms,
        hook_texto: hook, caption_completo: caption, es_viral: viral,
        categoria_contenido: cat, nivel_amenaza: amenaza,
        fecha_publicacion: fecha ? new Date(fecha).toISOString() : null,
      }])
      .select().single();
    if (error) throw error;

    window.closeModal();
    _toast('Post guardado. Generando análisis IA…', 'info');

    try {
      const cuenta = _cuentas.find(c => c.id === cuentaId);
      const ia = await _groqAnalizar(inserted, cuenta);
      await Promise.all([
        client().from('posts_tracker').update({ analisis_ia: ia.analisis }).eq('id', inserted.id),
        client().from('recreaciones_tracker').insert([{
          post_id: inserted.id,
          guion_recreacion: ia.guion_recreacion,
          hook_jarapo: ia.hook_jarapo,
          cta_sugerido: ia.cta_sugerido,
          musica_sugerida: ia.musica_sugerida,
          checklist_produccion: ia.checklist_produccion,
          estado: 'pendiente',
        }]),
      ]);
      _toast('✅ Análisis IA generado y guardado.', 'success');
    } catch(iaErr) {
      _toast(`Post guardado, pero error IA: ${iaErr.message}`, 'warning');
    }

    if (viral || amenaza === 'alto') {
      const cuenta = _cuentas.find(c => c.id === cuentaId);
      _alertaTracker(inserted, cuenta);
    }

    await Promise.all([_loadPosts(), _loadRecs()]);
    _tab = 'posts';
    _renderUI();

  } catch(err) {
    _toast(`Error: ${err.message}`, 'danger');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar y generar análisis IA'; }
  }
};

// ─── Modal: Agregar cuenta ────────────────────────────────────────────────────
function _modalAgregarCuenta() {
  const c = document.getElementById('modal-container');
  const m = document.getElementById('modal-content');
  if (!c || !m) return;

  m.innerHTML = `
    <div class="modal-content" style="max-width:600px;">
      <div class="modal-header">
        <h2>+ Agregar cuenta</h2>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">@Usuario de Instagram *</label>
            <input id="trac-usr" type="text" class="tr-inp" style="width:100%;" placeholder="sin_arroba_al_inicio">
          </div>
          <div>
            <label class="tr-label">Nombre display *</label>
            <input id="trac-nom" type="text" class="tr-inp" style="width:100%;" placeholder="Nombre legible">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">Tipo</label>
            <select id="trac-tipo" class="tr-sel" style="width:100%;">
              <option value="competencia">Competencia</option>
              <option value="tienda">Tienda</option>
              <option value="inspiracion">Inspiración</option>
            </select>
          </div>
          <div>
            <label class="tr-label">Tier</label>
            <select id="trac-tier" class="tr-sel" style="width:100%;">
              <option value="">Sin tier</option>
              <option value="1">Tier 1 (crítico)</option>
              <option value="2">Tier 2</option>
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div>
            <label class="tr-label">Categoría</label>
            <select id="trac-cat" class="tr-sel" style="width:100%;">
              <option value="personal_shopper">Personal Shopper</option>
              <option value="retail_usa">Retail USA</option>
              <option value="tienda_co">Tienda CO</option>
              <option value="sneakers">Sneakers</option>
              <option value="marketing">Marketing</option>
              <option value="creador">Creador</option>
              <option value="otros">Otros</option>
            </select>
          </div>
          <div>
            <label class="tr-label">País</label>
            <input id="trac-pais" type="text" class="tr-inp" style="width:100%;" value="Colombia">
          </div>
        </div>
        <div>
          <label class="tr-label">Notas (opcional)</label>
          <textarea id="trac-notas" class="tr-inp" style="width:100%;height:70px;" placeholder="Observaciones sobre esta cuenta…"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button id="trac-btn" class="btn-primary" onclick="window._trGuardarCuenta()">Agregar cuenta</button>
      </div>
    </div>`;

  c.style.display = 'flex';
}

window._trGuardarCuenta = async () => {
  const usr   = document.getElementById('trac-usr')?.value?.trim().replace('@','');
  const nom   = document.getElementById('trac-nom')?.value?.trim();
  const tipo  = document.getElementById('trac-tipo')?.value;
  const tier  = document.getElementById('trac-tier')?.value;
  const cat   = document.getElementById('trac-cat')?.value;
  const pais  = document.getElementById('trac-pais')?.value?.trim() || 'Colombia';
  const notas = document.getElementById('trac-notas')?.value?.trim() || null;

  if (!usr || !nom) { _toast('Usuario y nombre son obligatorios.', 'warning'); return; }

  const btn = document.getElementById('trac-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    const { error } = await client().from('cuentas_tracker').insert([{
      usuario_ig: usr, nombre_display: nom, tipo_cuenta: tipo,
      tier: tier ? parseInt(tier) : null,
      categoria: cat, pais, notas, activo: true,
    }]);
    if (error) throw error;

    window.closeModal();
    _toast(`✅ @${usr} agregado correctamente.`, 'success');
    await _loadCuentas();
    _renderUI();
  } catch(err) {
    _toast(`Error: ${err.message}`, 'danger');
    if (btn) { btn.disabled = false; btn.textContent = 'Agregar cuenta'; }
  }
};

// ─── Modal: Cambiar estado recreación ────────────────────────────────────────
function _modalCambiarEstado(recId, estadoActual) {
  const c = document.getElementById('modal-container');
  const m = document.getElementById('modal-content');
  if (!c || !m) return;

  const estados = ['pendiente','en_produccion','publicada','descartada'];
  m.innerHTML = `
    <div class="modal-content" style="max-width:440px;">
      <div class="modal-header">
        <h2>Cambiar estado</h2>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:8px;">
        ${estados.map(e => {
          const meta = ESTADO_REC[e];
          const activo = e === estadoActual;
          return `<button onclick="window._trActualizarEstado('${recId}','${e}')"
            style="background:${meta.bg};color:${meta.color};border:2px solid ${activo?meta.color:'transparent'};padding:14px 18px;border-radius:12px;font-size:0.92rem;font-weight:600;cursor:pointer;text-align:left;font-family:var(--font);">
            ${meta.label}${activo?' <span style="opacity:0.6;font-size:0.8rem;font-weight:400;">← actual</span>':''}
          </button>`;
        }).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
      </div>
    </div>`;

  c.style.display = 'flex';
}

window._trActualizarEstado = async (recId, nuevoEstado) => {
  try {
    const { error } = await client().from('recreaciones_tracker').update({ estado: nuevoEstado }).eq('id', recId);
    if (error) throw error;
    window.closeModal();
    _toast(`Estado actualizado: ${ESTADO_REC[nuevoEstado]?.label}`, 'success');
    await Promise.all([_loadPosts(), _loadRecs()]);
    _renderUI();
  } catch(err) {
    _toast(`Error: ${err.message}`, 'danger');
  }
};

// ─── Modal: Editar umbral de cuenta ──────────────────────────────────────────
function _modalEditarUmbral(cuentaId, usuarioIg, umbralActual) {
  const c = document.getElementById('modal-container');
  const m = document.getElementById('modal-content');
  if (!c || !m) return;

  m.innerHTML = `
    <div class="modal-content" style="max-width:440px;">
      <div class="modal-header">
        <h2>⚙️ Umbral de @${usuarioIg}</h2>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:16px;">
        <p style="color:var(--text-faint);font-size:0.86rem;line-height:1.6;">
          Define cuántas vistas mínimas debe tener un post para ser marcado como viral y generar análisis IA automáticamente.
        </p>
        <div>
          <label class="tr-label">Umbral de vistas *</label>
          <input id="tru-umbral" type="number" class="tr-inp" style="width:100%;"
            value="${umbralActual || ''}" placeholder="Ej: 10000" min="1">
        </div>
        <div style="background:var(--surface-2);border-radius:10px;padding:12px;font-size:0.8rem;color:var(--text-faint);">
          💡 Referencia: Tier 1 = 10.000 (defecto) · Tier 2 = 30.000 (defecto)
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cancelar</button>
        <button id="tru-btn" class="btn-primary" onclick="window._trGuardarUmbral('${cuentaId}')">Guardar</button>
      </div>
    </div>`;

  c.style.display = 'flex';
}

// ─── Modal: Resumen WhatsApp tras scraping ────────────────────────────────────
function _modalResumenWhatsApp(resumen) {
  const c = document.getElementById('modal-container');
  const m = document.getElementById('modal-content');
  if (!c || !m) return;

  const msg = construirMensajeWhatsApp(resumen);
  const { stats } = resumen;

  m.innerHTML = `
    <div class="modal-content" style="max-width:600px;">
      <div class="modal-header">
        <div>
          <h2>✅ Scraping completado</h2>
          <p style="color:var(--text-faint);font-size:0.82rem;margin-top:4px;font-weight:400;">
            ${stats.cuentas_procesadas} cuentas · ${stats.posts_nuevos} posts nuevos · 🔥 ${stats.posts_virales} virales
          </p>
        </div>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;">
        <div style="font-size:0.8rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;">Mensaje para WhatsApp</div>
        <textarea id="tr-wsp-msg" class="tr-inp" style="width:100%;height:260px;font-size:0.82rem;line-height:1.7;"
          readonly>${msg}</textarea>
        <p style="font-size:0.8rem;color:var(--text-faint);">
          Copia el mensaje y pégalo manualmente en WhatsApp. La integración automática con Kommo va en Sprint 3.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="window.closeModal()">Cerrar</button>
        <button class="btn-primary" onclick="
          navigator.clipboard.writeText(document.getElementById('tr-wsp-msg').value);
          this.textContent='✅ Copiado!';
          setTimeout(()=>this.textContent='📋 Copiar mensaje',2000);
        ">📋 Copiar mensaje</button>
      </div>
    </div>`;

  c.style.display = 'flex';
}

// ─── Handlers globales: Scraping ──────────────────────────────────────────────
window._trEjecutarScraping = async () => {
  const btn = document.getElementById('tr-scraping-btn');
  const log = document.getElementById('tr-scraping-log');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ejecutando...'; }
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  const append = (msg) => {
    if (log) { log.textContent += msg + '\n'; log.scrollTop = log.scrollHeight; }
  };

  try {
    const resumen = await ejecutarAhora(append);
    await _loadScrapingLogs().catch(() => {});
    _renderUI();
    _modalResumenWhatsApp(resumen);
  } catch (err) {
    append(`❌ Error: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '▶ Ejecutar scraping ahora'; }
    _toast(`Error en scraping: ${err.message}`, 'danger');
  }
};

window._trRefrescarLogs = async () => {
  _scrapingLogs = null;
  const el = document.getElementById('tr-tab-content');
  if (el) el.innerHTML = _tabScraping();
  await _loadScrapingLogs().catch(() => { _scrapingLogs = []; });
  if (el) el.innerHTML = _tabScraping();
};

window._trEditarUmbral = (cuentaId, usuarioIg, umbralActual) => {
  _modalEditarUmbral(cuentaId, usuarioIg, umbralActual);
};

window._trGuardarUmbral = async (cuentaId) => {
  const val = parseInt(document.getElementById('tru-umbral')?.value);
  if (!val || val < 1) { _toast('Ingresa un umbral válido (número mayor a 0).', 'warning'); return; }
  const btn = document.getElementById('tru-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const { error } = await client().from('cuentas_tracker').update({ umbral_vistas: val }).eq('id', cuentaId);
    if (error) throw error;
    window.closeModal();
    _toast(`✅ Umbral actualizado: ${val.toLocaleString('es-CO')} vistas`, 'success');
    await _loadCuentas();
    _renderUI();
  } catch (err) {
    _toast(`Error: ${err.message}`, 'danger');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
  }
};
