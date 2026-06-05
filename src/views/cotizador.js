import { loadCalcConfig, CALC_DEFAULT_CONFIG } from './calculadora.js';
import { db } from '../db.js';
import { auth } from '../auth.js';

const client = () => db.client;

const fmt    = (n) => Math.round(n || 0).toLocaleString('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 });
const fmtUSD = (n) => `$${(parseFloat(n)||0).toFixed(2)} USD`;
const hoy    = () => new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' });
const hoyISO = () => new Date().toISOString().split('T')[0];

// ── Cargar CALC_CONFIG (misma fuente que calculadora.js) + params extra ────────
async function cargarConfig() {
  const calcCfg = await loadCalcConfig();
  const { data } = await client().from('Configuracion').select('clave,valor');
  const map = {};
  (data || []).forEach(r => { map[r.clave] = r.valor; });
  return {
    calc:      calcCfg,
    whatsapp:  map['WHATSAPP']  || map['TELEFONO'] || '',
    instagram: map['INSTAGRAM'] || '@importacionesjarapo',
  };
}

// ── Fórmula idéntica a calculadora.js ─────────────────────────────────────────
function calcular(inputs, cfg) {
  const { precioUSD, descuentoUSD, pesoLbs, trm, categoria, conDomicilio } = inputs;
  const { taxUsa, comisionTC, valorLibraUsd, valorLibra, costoDomicilio, categorias } = cfg;

  const gananciaFija   = parseFloat(categorias?.[categoria]?.ganancia) || 50000;
  const precioFinalUSD = (precioUSD || 0) - (descuentoUSD || 0);

  const valorConTax    = precioFinalUSD * (1 + (taxUsa || 7) / 100);
  const pesosBase      = valorConTax * (trm || 4200);
  const comisionCOP    = pesosBase * ((comisionTC || 3) / 100);
  const pesosConComis  = pesosBase + comisionCOP;
  const valorLibraCOP  = valorLibraUsd
    ? parseFloat(valorLibraUsd) * (trm || 4200)
    : (parseFloat(valorLibra) || 0);
  const costoLogistica = (pesoLbs || 0) * valorLibraCOP;

  const subtotal       = pesosConComis + gananciaFija + costoLogistica;
  const valorProducto  = Math.ceil(subtotal / 1000) * 1000;
  const domicilioCOP   = conDomicilio ? (costoDomicilio || 20000) : 0;
  const totalFinal     = valorProducto + domicilioCOP;
  const taxCOP         = Math.round((valorConTax - precioFinalUSD) * (trm || 4200));
  const anticipo35     = Math.ceil(totalFinal * 0.35 / 1000) * 1000;

  return {
    precioFinalUSD, valorConTax, taxCOP,
    pesosBase:      Math.round(pesosBase),
    comisionCOP:    Math.round(comisionCOP),
    costoLogistica: Math.round(costoLogistica),
    gananciaFija,
    subtotal:       Math.round(subtotal),
    valorProducto,
    domicilioCOP,
    totalFinal,
    anticipo35,
    necesitaDomicilio: valorProducto < 200000,
  };
}

// ── Mensaje WhatsApp ───────────────────────────────────────────────────────────
function generarMensajeWA(f, r) {
  let msg = `Hola ${f.cliente || 'cliente'} 👋\n\nTe cotizamos el producto que solicitaste:\n\n`;
  msg += `✈️ *${f.producto}*\n`;
  if (f.descripcion) msg += `📋 ${f.descripcion}\n`;
  if (f.tienda)      msg += `🏪 ${f.tienda}\n`;
  if (f.link)        msg += `🔗 ${f.link}\n`;
  msg += `\n💰 *Valor total: ${fmt(r.totalFinal)} COP*\n`;
  msg += `🚚 Envío incluido ✓\n`;
  msg += `\n⚠️ *Válida únicamente hoy ${hoy()}*\n`;
  msg += `⏳ Sujeto a disponibilidad y vigencia de la promoción\n`;
  msg += `\nPara apartar necesitamos:\n`;
  msg += `💳 *Anticipo 35%: ${fmt(r.anticipo35)} COP*\n\n`;
  msg += `¡Escríbenos para confirmar! 🙌\n_Importaciones Jarapo_ ✈️🇨🇴`;
  return msg;
}

// ── Logo helper (dataURL desde URL) ───────────────────────────────────────────
async function logoDataUrl() {
  const url = window.JARAPP_LOGO || sessionStorage.getItem('JARAPP_LOGO');
  if (!url) return null;
  try {
    const blob = await fetch(url).then(r => r.blob());
    return await new Promise(res => {
      const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ── PDF CLIENTE — versión limpia para compartir ───────────────────────────────
async function generarPDFCliente(f, r, params) {
  const pdfmake  = await import('pdfmake/build/pdfmake.js');
  const pdfFonts = await import('pdfmake/build/vfs_fonts.js');
  const lib = pdfmake.default || pdfmake;
  lib.vfs   = (pdfFonts.default || pdfFonts).pdfMake?.vfs || pdfFonts.vfs;

  const rojo  = '#E63946';
  const gris  = '#64748B';
  const numCot = `COT-${String(Date.now()).slice(-6)}`;
  const imgData = await logoDataUrl();

  const headerLeft = imgData
    ? { stack:[{ image:imgData, fit:[72,72] }, { text:'Importaciones Jarapo', fontSize:8, color:gris, margin:[0,4,0,0] }], alignment:'left' }
    : { stack:[
        { canvas:[{ type:'rect', x:0, y:0, w:56, h:56, r:10, color:rojo }] },
        { text:'J', fontSize:28, bold:true, color:'#fff', margin:[18,-44,0,0] },
        { text:'Importaciones Jarapo', fontSize:8, color:gris, margin:[0,10,0,0] },
      ], alignment:'left' };

  const docDef = {
    pageSize:'A4', pageMargins:[40,40,40,50],
    defaultStyle:{ font:'Roboto', fontSize:10, color:'#0F172A' },
    content:[
      // HEADER
      { columns:[
          headerLeft,
          { stack:[
              { text:'COTIZACIÓN', fontSize:24, bold:true },
              { text:[{ text:'N° ', color:gris }, numCot], fontSize:10, margin:[0,4,0,2] },
              { text:[{ text:'Fecha: ', color:gris }, hoy()], fontSize:10 },
            ], alignment:'right' },
        ], margin:[0,0,0,10] },
      { canvas:[{ type:'line', x1:0, y1:0, x2:515, y2:0, lineWidth:2, lineColor:rojo }], margin:[0,0,0,14] },

      // CLIENTE
      { columns:[
          { text:' ' },
          { stack:[
              { text:'PARA', bold:true, fontSize:8, color:gris, margin:[0,0,0,3] },
              { text: f.cliente || '—', fontSize:14, bold:true },
            ], alignment:'right' },
        ], margin:[0,0,0,16] },

      // PRODUCTO
      { text:'PRODUCTO SOLICITADO', bold:true, fontSize:9, color:gris, margin:[0,0,0,6] },
      {
        table:{
          widths:['*'],
          body:[
            [{ stack:[
                { text: f.producto || '—', bold:true, fontSize:12 },
                ...(f.descripcion ? [{ text: f.descripcion, fontSize:9, color:gris, margin:[0,4,0,0] }] : []),
                { columns:[
                    ...(f.tienda ? [{ text:[{ text:'Tienda: ', bold:true, fontSize:9, color:gris }, { text:f.tienda, fontSize:9 }] }] : []),
                    ...(f.link   ? [{ text:[{ text:'Referencia: ', bold:true, fontSize:9, color:gris }, { text:f.link, color:'#3B82F6', fontSize:9, decoration:'underline' }] }] : []),
                  ], columnGap:10, margin:[0,6,0,0] },
              ], margin:[0,2,0,2] }],
          ],
        },
        layout:{ hLineColor:()=>'#E2E8F0', vLineColor:()=>'#E2E8F0',
          paddingLeft:()=>12, paddingRight:()=>12, paddingTop:()=>10, paddingBottom:()=>10 },
        margin:[0,0,0,20],
      },

      // RESUMEN — solo valor total, sin desglose ni USD
      { text:'RESUMEN', bold:true, fontSize:9, color:gris, margin:[0,0,0,6] },
      {
        table:{
          widths:['*', 130],
          headerRows:1,
          body:[
            [
              { text:'Descripción', bold:true, fillColor:'#F1F5F9', fontSize:9 },
              { text:'Valor', bold:true, fillColor:'#F1F5F9', fontSize:9, alignment:'right' },
            ],
            [
              { text:'Producto encargado', fontSize:10 },
              { text: fmt(r.totalFinal), fontSize:10, alignment:'right' },
            ],
            [
              { text:'TOTAL A PAGAR', bold:true, fontSize:12, color:rojo },
              { text: fmt(r.totalFinal), bold:true, fontSize:12, color:rojo, alignment:'right' },
            ],
          ],
        },
        layout:{
          hLineColor:(i,n) => i===n.table.body.length-1 ? rojo : '#E2E8F0',
          hLineWidth:(i,n) => i===n.table.body.length-1 ? 1.5 : 0.5,
          vLineWidth:()=>0,
          paddingLeft:()=>6, paddingRight:()=>6, paddingTop:()=>8, paddingBottom:()=>8,
        },
        margin:[0,0,0,18],
      },

      // CONDICIONES
      { canvas:[{ type:'line', x1:0, y1:0, x2:515, y2:0, lineWidth:0.5, lineColor:'#CBD5E1' }], margin:[0,0,0,10] },
      { text:'CONDICIONES', bold:true, fontSize:9, color:gris, margin:[0,0,0,5] },
      {
        ul:[
          { text:`Anticipo 35% para apartar: ${fmt(r.anticipo35)} COP`, bold:true },
          'Cotización válida únicamente hoy ' + hoy() + '.',
          'Precio sujeto a disponibilidad y vigencia de la promoción.',
          'Tiempo de entrega estimado: 10-15 días hábiles.',
          ...(r.domicilioCOP > 0 ? ['Envío incluido.'] : []),
        ],
        fontSize:9, color:gris,
      },
    ],
    footer: () => ({
      stack:[
        { canvas:[{ type:'line', x1:40, y1:0, x2:555, y2:0, lineWidth:1.5, lineColor:rojo }], margin:[0,0,0,5] },
        { text:`Instagram: ${params.instagram}${params.whatsapp ? '  ·  WhatsApp: '+params.whatsapp : ''}`,
          fontSize:8, color:gris, alignment:'center' },
      ], margin:[0,8,0,0],
    }),
  };

  lib.createPdf(docDef).download(`CotizacionCliente_${(f.cliente||'Cliente').replace(/\s+/g,'_')}_${hoyISO()}.pdf`);
}

// ── PDF INTERNO — desglose completo para el equipo ────────────────────────────
async function generarPDFInterno(f, r, cfg, params) {
  const pdfmake  = await import('pdfmake/build/pdfmake.js');
  const pdfFonts = await import('pdfmake/build/vfs_fonts.js');
  const lib = pdfmake.default || pdfmake;
  lib.vfs   = (pdfFonts.default || pdfFonts).pdfMake?.vfs || pdfFonts.vfs;

  const rojo  = '#E63946';
  const gris  = '#64748B';
  const numCot = `COT-${String(Date.now()).slice(-6)}`;
  const imgData = await logoDataUrl();

  const headerLeft = imgData
    ? { stack:[{ image:imgData, fit:[72,72] }, { text:'Importaciones Jarapo', fontSize:8, color:gris, margin:[0,4,0,0] }], alignment:'left' }
    : { stack:[
        { canvas:[{ type:'rect', x:0, y:0, w:56, h:56, r:10, color:rojo }] },
        { text:'J', fontSize:28, bold:true, color:'#fff', margin:[18,-44,0,0] },
        { text:'Importaciones Jarapo', fontSize:8, color:gris, margin:[0,10,0,0] },
      ], alignment:'left' };

  const fRow = (label, valor, opts={}) => [
    { text:label, fontSize: opts.big?11:9, bold:!!opts.big, color: opts.color || gris },
    { text:valor, fontSize: opts.big?11:9, bold:!!opts.big, color: opts.vColor || '#0F172A', alignment:'right' },
  ];

  const cats = cfg.categorias || {};
  const catLabel = cats[f.categoria]?.label || f.categoria || '—';

  const docDef = {
    pageSize:'A4', pageMargins:[40,40,40,50],
    defaultStyle:{ font:'Roboto', fontSize:10, color:'#0F172A' },
    content:[
      // HEADER
      { columns:[
          headerLeft,
          { stack:[
              { text:'COTIZACIÓN INTERNA', fontSize:20, bold:true },
              { text:'Solo para uso del equipo Jarapo', fontSize:8, color:rojo, margin:[0,3,0,2] },
              { text:[{ text:'N° ', color:gris }, numCot], fontSize:10, margin:[0,2,0,2] },
              { text:[{ text:'Fecha: ', color:gris }, hoy()], fontSize:10 },
            ], alignment:'right' },
        ], margin:[0,0,0,10] },
      { canvas:[{ type:'line', x1:0, y1:0, x2:515, y2:0, lineWidth:2, lineColor:rojo }], margin:[0,0,0,12] },

      // INFO
      { columns:[
          { stack:[
              { text:[{ text:'Cliente: ', bold:true }, f.cliente || '—'] },
              { text:[{ text:'Producto: ', bold:true }, f.producto || '—'], margin:[0,3,0,0] },
              ...(f.descripcion ? [{ text:[{ text:'Descripción: ', bold:true }, f.descripcion], margin:[0,3,0,0], fontSize:9 }] : []),
              { text:[{ text:'Tienda: ', bold:true }, f.tienda || '—'], margin:[0,3,0,0], fontSize:9 },
              { text:[{ text:'Categoría: ', bold:true }, catLabel], margin:[0,3,0,0], fontSize:9 },
            ], fontSize:9 },
          { stack:[
              { text:'VÁLIDA HOY', bold:true, fontSize:8, color:gris },
              { text:hoy(), fontSize:11, bold:true, margin:[0,2,0,0] },
            ], alignment:'right' },
        ], margin:[0,0,0,16] },

      // DESGLOSE COMPLETO
      { text:'DESGLOSE DE COSTOS', bold:true, fontSize:9, color:gris, margin:[0,0,0,6] },
      {
        table:{
          widths:['*', 120],
          body:[
            fRow('Precio tienda (USD)', fmtUSD(f.precioUSD)),
            ...(f.descuentoUSD > 0 ? [fRow('− Descuento', `–${fmtUSD(f.descuentoUSD)}`)] : []),
            fRow('= Precio final USD', fmtUSD(r.precioFinalUSD)),
            fRow(`+ Tax USA (${cfg.taxUsa||7}%)`, fmt(r.taxCOP)),
            fRow(`  TRM aplicado`, `$${Math.round(f.trm).toLocaleString('es-CO')}`),
            fRow('= Base en COP', fmt(r.pesosBase)),
            fRow(`+ Comisión TC (${cfg.comisionTC||3}%)`, fmt(r.comisionCOP)),
            fRow(`+ Flete aéreo (${f.pesoLbs} lbs × $${(cfg.valorLibraUsd||3).toFixed(2)} USD)`, fmt(r.costoLogistica)),
            fRow(`+ Ganancia fija (${catLabel})`, fmt(r.gananciaFija)),
            fRow('= Subtotal (pre-redondeo)', fmt(r.subtotal)),
            fRow('VALOR PRODUCTO', fmt(r.valorProducto), { big:true, color:'#0F172A' }),
            ...(r.domicilioCOP > 0 ? [fRow('+ Domicilio Colombia', fmt(r.domicilioCOP), { color:'#E67E22' })] : []),
            fRow('TOTAL A PAGAR', fmt(r.totalFinal), { big:true, color:rojo, vColor:rojo }),
          ],
        },
        layout:{
          hLineColor:(i,n) => (i===n.table.body.length-1||i===n.table.body.length-1) ? rojo : '#F1F5F9',
          hLineWidth:(i,n) => i===n.table.body.length-1 ? 1.5 : 0.5,
          vLineWidth:()=>0,
          paddingLeft:()=>5, paddingRight:()=>5, paddingTop:()=>6, paddingBottom:()=>6,
        },
        margin:[0,0,0,16],
      },

      // ANTICIPO
      { table:{ widths:['*', 120], body:[
          [{ text:'Anticipo 35% para apartar', bold:true, fontSize:10 },
           { text:fmt(r.anticipo35), bold:true, fontSize:10, alignment:'right', color:rojo }],
        ]},
        layout:{ hLineColor:()=>'#E2E8F0', vLineWidth:()=>0,
          paddingLeft:()=>5, paddingRight:()=>5, paddingTop:()=>7, paddingBottom:()=>7 },
        margin:[0,0,0,16] },

      // CONDICIONES
      { canvas:[{ type:'line', x1:0, y1:0, x2:515, y2:0, lineWidth:0.5, lineColor:'#CBD5E1' }], margin:[0,0,0,8] },
      { ul:[
          'Cotización válida únicamente el día de emisión.',
          'Precio sujeto a disponibilidad y vigencia de la promoción.',
          'Tiempo de entrega estimado: 10-15 días hábiles.',
        ], fontSize:9, color:gris },
      ...(f.notas ? [
        { text:'Notas: ', bold:true, fontSize:9, margin:[0,10,0,2] },
        { text:f.notas, fontSize:9, color:gris },
      ] : []),
    ],
    footer: (cur, total) => ({
      stack:[
        { canvas:[{ type:'line', x1:40, y1:0, x2:555, y2:0, lineWidth:1.5, lineColor:rojo }], margin:[0,0,0,5] },
        { columns:[
            { text:`Instagram: ${params.instagram}${params.whatsapp ? '  ·  WhatsApp: '+params.whatsapp : ''}`,
              fontSize:7, color:gris, margin:[40,0,0,0] },
            { text:`Pág. ${cur}/${total}`, fontSize:7, color:gris, alignment:'right', margin:[0,0,40,0] },
          ]},
      ], margin:[0,8,0,0],
    }),
  };

  lib.createPdf(docDef).download(`CotizacionInterna_${(f.cliente||'Equipo').replace(/\s+/g,'_')}_${hoyISO()}.pdf`);
}

// ── Vista principal ────────────────────────────────────────────────────────────
export const renderCotizador = async (renderLayout, navigateTo) => {
  renderLayout(`<div style="text-align:center;padding:5rem;"><div class="loader"></div> Cargando cotizador...</div>`);

  const { calc: cfg, whatsapp, instagram } = await cargarConfig();
  const trmActual = window.JARAPP_TRM || parseFloat(sessionStorage.getItem('JARAPP_TRM')) || 4200;
  const cats      = cfg.categorias || CALC_DEFAULT_CONFIG.categorias;
  const catKeys   = Object.keys(cats);
  const catDefault= catKeys[0] || 'calzado';

  // RBAC — permisos granulares
  if (!auth.canAccess('cotizador_ver')) { navigateTo('dashboard'); return; }
  const puedeVerDesglose = auth.canAccess('cotizador_desglose');
  const puedePDFCliente  = auth.canAccess('cotizador_pdf_cliente');
  const puedeVerPDFInt   = auth.canAccess('cotizador_pdf_interno');

  const catOptions = catKeys.map(k =>
    `<option value="${k}">${cats[k].label}</option>`
  ).join('');

  const html = `
  <div style="max-width:960px;margin:0 auto;padding:0 0 60px;">

    <!-- HEADER -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:1.4rem;font-weight:700;color:var(--text-main);margin:0;">Generador de Cotizaciones</h2>
        <p style="color:var(--text-faint);font-size:0.82rem;margin:3px 0 0;">Encargos internacionales · Fórmula completa de importación</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button id="btn-wa"
          style="background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.35);color:#25D366;
                 font-weight:700;padding:9px 18px;border-radius:10px;cursor:pointer;font-size:0.85rem;">
          📋 Copiar WhatsApp
        </button>
        ${puedePDFCliente ? `<button id="btn-pdf-cliente" class="btn-primary" style="padding:9px 18px;">
          📄 PDF Cliente
        </button>` : ''}
        ${puedeVerPDFInt ? `<button id="btn-pdf-interno"
          style="background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.35);color:#7C3AED;
                 font-weight:700;padding:9px 18px;border-radius:10px;cursor:pointer;font-size:0.85rem;">
          📋 PDF Interno
        </button>` : ''}
      </div>
    </div>

    <div id="cot-grid" style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:start;">

      <!-- FORMULARIO -->
      <div style="background:var(--surface-1);border:1px solid var(--border-base);border-radius:16px;padding:24px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

          <div class="cot-g">
            <label class="cot-l">Nombre del cliente *</label>
            <input id="c-cliente" type="text" class="cot-i" placeholder="María García">
          </div>
          <div class="cot-g">
            <label class="cot-l">Nombre del producto *</label>
            <input id="c-producto" type="text" class="cot-i" placeholder="Nike Air Max 270">
          </div>

          <div class="cot-g" style="grid-column:span 2;">
            <label class="cot-l">Descripción / detalles</label>
            <textarea id="c-desc" class="cot-i" rows="2" placeholder="Talla, color, referencia..."></textarea>
          </div>

          <div class="cot-g">
            <label class="cot-l">Tienda / página</label>
            <input id="c-tienda" type="text" class="cot-i" placeholder="Nike.com, Amazon...">
          </div>
          <div class="cot-g">
            <label class="cot-l">Link del producto</label>
            <input id="c-link" type="url" class="cot-i" placeholder="https://...">
          </div>

          <div class="cot-g" style="grid-column:span 2;">
            <label class="cot-l">Categoría</label>
            <select id="c-categoria" class="cot-i">${catOptions}</select>
            <div id="c-cat-info" style="margin-top:6px;font-size:0.77rem;color:var(--text-faint);
              padding:6px 10px;background:var(--surface-2);border-radius:7px;"></div>
          </div>

          <div class="cot-g">
            <label class="cot-l">Precio USD en tienda *</label>
            <input id="c-precio" type="number" class="cot-i" min="0" step="0.01" placeholder="0.00">
          </div>
          <div class="cot-g">
            <label class="cot-l">Descuento USD (promo)</label>
            <input id="c-descuento" type="number" class="cot-i" min="0" step="0.01" placeholder="0.00" value="0">
          </div>

          <div class="cot-g">
            <label class="cot-l">Peso del producto (lbs)
              <span style="font-size:0.7rem;color:var(--text-faint);">pre-llenado por categoría</span>
            </label>
            <input id="c-peso" type="number" class="cot-i" min="0" step="0.5" placeholder="0">
          </div>
          <div class="cot-g">
            <label class="cot-l">TRM aplicado
              <span style="font-size:0.7rem;color:var(--text-faint);">hoy: $${Math.round(trmActual).toLocaleString('es-CO')}</span>
            </label>
            <input id="c-trm" type="number" class="cot-i" min="1000" step="1" value="${Math.round(trmActual)}">
          </div>

          <div class="cot-g" style="grid-column:span 2;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input id="c-domicilio" type="checkbox" style="width:16px;height:16px;accent-color:var(--primary);">
              <span class="cot-l" style="margin:0;">¿Incluir domicilio Colombia?</span>
              <span id="c-dom-badge" style="font-size:0.71rem;padding:2px 8px;border-radius:99px;
                background:rgba(230,57,70,0.12);color:var(--primary);font-weight:700;display:none;">Auto</span>
            </label>
            <div style="margin-left:24px;font-size:0.76rem;color:var(--text-faint);margin-top:3px;">
              Costo domicilio: ${fmt(cfg.costoDomicilio || 20000)} · Auto si total &lt; $200.000
            </div>
          </div>

          <div class="cot-g" style="grid-column:span 2;">
            <label class="cot-l">Notas adicionales</label>
            <textarea id="c-notas" class="cot-i" rows="2" placeholder="Condiciones especiales, tiempos, etc..."></textarea>
          </div>

        </div>
      </div>

      <!-- PANEL DERECHO -->
      <div id="cot-resumen" style="background:var(--surface-1);border:1px solid var(--border-base);
        border-radius:16px;padding:18px;position:sticky;top:20px;">
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
          color:var(--text-faint);margin-bottom:12px;">
          ${puedeVerDesglose ? 'Desglose en tiempo real' : 'Resumen'}
        </div>
        <div id="cot-res-content">
          <p style="color:var(--text-faint);font-size:0.83rem;text-align:center;padding:20px 0;">
            Ingresa el precio USD para calcular
          </p>
        </div>
      </div>

    </div>
  </div>

  <style>
    .cot-l { display:block;font-size:0.77rem;font-weight:600;color:var(--text-muted);margin-bottom:5px; }
    .cot-i {
      width:100%;box-sizing:border-box;
      background:var(--surface-2);border:1px solid var(--border-base);
      border-radius:8px;padding:9px 12px;color:var(--text-main);
      font-size:0.87rem;font-family:var(--font);outline:none;transition:border-color .15s;
    }
    .cot-i:focus { border-color:var(--primary); }
    .cot-g { display:flex;flex-direction:column; }
    @media(max-width:768px){
      #cot-grid { grid-template-columns:1fr !important; }
    }
  </style>
  `;

  renderLayout(html);

  // ── Prellenar categoría ──────────────────────────────────────────────────
  const selCat = document.getElementById('c-categoria');
  const inPeso = document.getElementById('c-peso');

  function actualizarCategoria() {
    const key = selCat?.value || catDefault;
    const cat = cats[key] || {};
    if (inPeso) inPeso.value = cat.peso || '';
    const info = document.getElementById('c-cat-info');
    if (info) info.textContent =
      `Peso sugerido: ${cat.peso || '—'} lbs · Ganancia fija: ${fmt(cat.ganancia || 0)}`;
    recalcular();
  }

  if (selCat) { selCat.value = catDefault; selCat.addEventListener('change', actualizarCategoria); }
  actualizarCategoria();

  // ── Leer formulario ──────────────────────────────────────────────────────
  function leer() {
    return {
      cliente:     document.getElementById('c-cliente')?.value.trim() || '',
      producto:    document.getElementById('c-producto')?.value.trim() || '',
      descripcion: document.getElementById('c-desc')?.value.trim() || '',
      tienda:      document.getElementById('c-tienda')?.value.trim() || '',
      link:        document.getElementById('c-link')?.value.trim() || '',
      categoria:   document.getElementById('c-categoria')?.value || catDefault,
      precioUSD:   parseFloat(document.getElementById('c-precio')?.value) || 0,
      descuentoUSD:parseFloat(document.getElementById('c-descuento')?.value) || 0,
      pesoLbs:     parseFloat(document.getElementById('c-peso')?.value) || 0,
      trm:         parseFloat(document.getElementById('c-trm')?.value) || trmActual,
      conDomicilio:document.getElementById('c-domicilio')?.checked || false,
      notas:       document.getElementById('c-notas')?.value.trim() || '',
    };
  }

  // ── Recalcular en tiempo real ────────────────────────────────────────────
  function recalcular() {
    const f  = leer();
    const r0 = calcular(f, cfg);

    // Auto-domicilio
    const chk   = document.getElementById('c-domicilio');
    const badge = document.getElementById('c-dom-badge');
    if (chk && !chk._touched) chk.checked = r0.necesitaDomicilio;
    if (badge) badge.style.display = r0.necesitaDomicilio ? 'inline' : 'none';

    const conDom = chk?.checked || false;
    const r = calcular({ ...f, conDomicilio: conDom }, cfg);

    if (!f.precioUSD) {
      document.getElementById('cot-res-content').innerHTML =
        `<p style="color:var(--text-faint);font-size:0.83rem;text-align:center;padding:20px 0;">
          Ingresa el precio USD para calcular</p>`;
      return;
    }

    const taxUsa = cfg.taxUsa || 7;
    const comTC  = cfg.comisionTC || 3;
    const vLibra = cfg.valorLibraUsd || 3;

    // Panel para admin/gerente — desglose completo
    const resumenAdmin = `
      <div style="font-size:0.81rem;line-height:1.9;">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">Precio tienda</span>
          <span style="color:var(--text-main);">${fmtUSD(f.precioUSD)}</span>
        </div>
        ${f.descuentoUSD > 0 ? `<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">− Descuento</span>
          <span style="color:var(--text-main);">–${fmtUSD(f.descuentoUSD)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">= Precio final USD</span>
          <span style="color:var(--text-main);">${fmtUSD(r.precioFinalUSD)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">+ Tax USA (${taxUsa}%)</span>
          <span style="color:var(--text-main);">+${fmtUSD(r.valorConTax - r.precioFinalUSD)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">× TRM $${Math.round(f.trm).toLocaleString('es-CO')}</span>
          <span style="color:var(--text-faint);">→</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">= Base en COP</span>
          <span style="color:var(--text-main);">${fmt(r.pesosBase)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">+ Comisión TC (${comTC}%)</span>
          <span style="color:var(--text-main);">+${fmt(r.comisionCOP)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">+ Flete (${f.pesoLbs}lbs × $${vLibra})</span>
          <span style="color:var(--text-main);">+${fmt(r.costoLogistica)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">+ Ganancia (${cats[f.categoria]?.label || f.categoria})</span>
          <span style="color:var(--text-main);">+${fmt(r.gananciaFija)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;border-bottom:2px solid var(--border-base);padding:4px 0;">
          <span style="color:var(--text-muted);">= Subtotal</span>
          <span style="color:var(--text-main);">${fmt(r.subtotal)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-weight:700;">
          <span style="color:var(--text-main);">VALOR PRODUCTO</span>
          <span style="color:var(--text-main);">${fmt(r.valorProducto)}</span>
        </div>
        ${conDom ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-base);">
          <span style="color:#E67E22;">+ Domicilio Colombia</span>
          <span style="color:#E67E22;">+${fmt(r.domicilioCOP)}</span>
        </div>` : ''}
      </div>`;

    // Panel para ventas — solo total y anticipo
    const resumenVentas = '';

    const totalBox = `
      <div style="background:rgba(230,57,70,0.09);border-radius:10px;padding:10px 12px;
        display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span style="font-weight:700;color:var(--text-main);font-size:0.9rem;">TOTAL A PAGAR</span>
        <span style="font-size:1.2rem;font-weight:800;color:var(--primary);">${fmt(r.totalFinal)}</span>
      </div>
      <div style="margin-top:8px;padding:7px 10px;background:var(--surface-2);border-radius:8px;font-size:0.8rem;color:var(--text-muted);">
        Anticipo 35%: <strong style="color:var(--text-main);">${fmt(r.anticipo35)}</strong>
      </div>
      <div style="margin-top:8px;font-size:0.7rem;color:var(--text-faint);text-align:center;">
        TRM: $${Math.round(f.trm).toLocaleString('es-CO')} · Tax ${taxUsa}% · Válida hoy ${hoy()}
      </div>`;

    document.getElementById('cot-res-content').innerHTML =
      (puedeVerDesglose ? resumenAdmin : '') + totalBox;
  }

  // Eventos
  document.querySelectorAll('.cot-i').forEach(el => el.addEventListener('input', recalcular));
  const chkDom = document.getElementById('c-domicilio');
  if (chkDom) chkDom.addEventListener('change', () => { chkDom._touched = true; recalcular(); });

  // ── Botón WhatsApp ───────────────────────────────────────────────────────
  document.getElementById('btn-wa')?.addEventListener('click', () => {
    const f = leer();
    if (!f.producto || !f.precioUSD) {
      window.customAlert?.('Faltan datos','Completa el nombre del producto y el precio USD.','warning'); return;
    }
    const conDom = document.getElementById('c-domicilio')?.checked || false;
    const r = calcular({ ...f, conDomicilio: conDom }, cfg);
    const msg = generarMensajeWA(f, r);
    navigator.clipboard.writeText(msg).then(() => {
      const btn = document.getElementById('btn-wa');
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copiado — listo para WhatsApp/Instagram';
      btn.style.background = 'rgba(37,211,102,0.3)';
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 3000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = msg; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
  });

  // ── Botón PDF Cliente ────────────────────────────────────────────────────
  document.getElementById('btn-pdf-cliente')?.addEventListener('click', async () => {
    const f = leer();
    if (!f.producto || !f.precioUSD) {
      window.customAlert?.('Faltan datos','Completa el nombre del producto y el precio USD.','warning'); return;
    }
    const btn = document.getElementById('btn-pdf-cliente');
    btn.disabled = true; btn.textContent = 'Generando...';
    try {
      const conDom = document.getElementById('c-domicilio')?.checked || false;
      const r = calcular({ ...f, conDomicilio: conDom }, cfg);
      await generarPDFCliente(f, r, { whatsapp, instagram });
    } catch (e) {
      console.error('[PDF Cliente]', e);
      window.customAlert?.('Error PDF','No se pudo generar el PDF cliente.','error');
    } finally { btn.disabled = false; btn.innerHTML = '📄 PDF Cliente'; }
  });

  // ── Botón PDF Interno (solo admin/gerente) ───────────────────────────────
  document.getElementById('btn-pdf-interno')?.addEventListener('click', async () => {
    const f = leer();
    if (!f.producto || !f.precioUSD) {
      window.customAlert?.('Faltan datos','Completa el nombre del producto y el precio USD.','warning'); return;
    }
    const btn = document.getElementById('btn-pdf-interno');
    btn.disabled = true; btn.textContent = 'Generando...';
    try {
      const conDom = document.getElementById('c-domicilio')?.checked || false;
      const r = calcular({ ...f, conDomicilio: conDom }, cfg);
      await generarPDFInterno(f, r, cfg, { whatsapp, instagram });
    } catch (e) {
      console.error('[PDF Interno]', e);
      window.customAlert?.('Error PDF','No se pudo generar el PDF interno.','error');
    } finally { btn.disabled = false; btn.innerHTML = '📋 PDF Interno'; }
  });

  recalcular();
};
