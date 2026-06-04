// src/dashboard/ventasAnalisisUtils.js
// Motor de análisis de oferta — reportes VA1 a VA8 del Dashboard 360°
// Sin dependencias externas — todo son funciones puras

// ─── Colores consistentes por marca ───────────────────────────────────────────
const BRAND_COLORS = {
  'Nike':       '#E63946',
  'Adidas':     '#4CC9F0',
  'New Balance':'#06D6A0',
  'Jordan':     '#FFB703',
  'Puma':       '#A78BFA',
  'Vans':       '#F472B6',
  'Converse':   '#2DD4BF',
  'Under Armour':'#FB923C',
  'Reebok':     '#34D399',
  'Asics':      '#818CF8',
};
const PALETTE = ['#4CC9F0','#06D6A0','#FFB703','#A78BFA','#E63946','#F472B6','#2DD4BF','#FB923C','#34D399','#818CF8','#60A5FA','#FBBF24','#A3E635','#E879F9'];

export const getBrandColor = (marca, idx = 0) => BRAND_COLORS[marca] || PALETTE[idx % PALETTE.length];

// ─── Normalización de tallas ──────────────────────────────────────────────────
export function normalizarTalla(talla) {
  if (!talla) return { original: '—', valor: null, sistema: null };
  const t = String(talla).trim().toUpperCase();
  if (['XS','S','M','L','XL','XXL','XXXL'].includes(t))
    return { original: t, valor: t, sistema: 'ROPA' };
  const matchUS = t.match(/^(\d+\.?\d*)\s*US$/);
  if (matchUS) return { original: t, valor: parseFloat(matchUS[1]), sistema: 'US' };
  const matchEU = t.match(/^(\d+\.?\d*)\s*EU$/);
  if (matchEU) return { original: t, valor: parseFloat(matchEU[1]), sistema: 'EU' };
  const matchCM = t.match(/^(\d+\.?\d*)\s*CM$/);
  if (matchCM) return { original: t, valor: parseFloat(matchCM[1]), sistema: 'CM' };
  const soloNum = t.match(/^(\d+\.?\d*)$/);
  if (soloNum) return { original: t, valor: parseFloat(soloNum[1]), sistema: 'US' };
  return { original: t, valor: null, sistema: 'OTRO' };
}

// ─── Enriquecer cada venta con campos del producto relacionado ────────────────
// productosMap: Map o objeto { [producto_id]: producto } construido desde raw.productos
export function enriquecerVenta(venta, productosMap = {}) {
  // ── Join con la tabla Productos ──────────────────────────────────────────────
  const prodId = venta.producto_id?.toString();
  const prod   = prodId ? (productosMap[prodId] || null) : null;

  // Financieros: pueden venir de Ventas directamente
  const valorCotizadoUSD = parseFloat(venta.valor_cotizado_usd || venta.valorCotizadoUSD || prod?.precio_usd || 0);
  const trmCotizada      = parseFloat(venta.trm_cotizada || venta.trmCotizada || 0);
  const valorVentaCOP    = parseFloat(venta.valor_venta_cop || venta.valorVentaCOP || venta.valor_total_cop || prod?.precio_cop || 0);
  const gananciaCalcCOP  = parseFloat(venta.ganancia_calc_cop || venta.gananciaCalcCOP || 0);
  const abonoInicialCOP  = parseFloat(venta.abono_inicial_cop || venta.abonoInicialCOP || venta.abonos_acumulados || 0);
  const cantidad         = parseInt(venta.cantidad || 1);
  const pesoEstimadoLbs  = parseFloat(venta.peso_estimado_lbs || venta.pesoEstimadoLbs || 0);

  // Campos derivados
  const valorUSDenCOP    = valorCotizadoUSD * trmCotizada;
  const margenPct        = valorVentaCOP > 0 ? (gananciaCalcCOP / valorVentaCOP) * 100 : 0;
  const markupPct        = valorUSDenCOP > 0 ? ((valorVentaCOP - valorUSDenCOP) / valorUSDenCOP) * 100 : 0;
  const costoPorLibra    = pesoEstimadoLbs > 0 ? valorCotizadoUSD / pesoEstimadoLbs : 0;
  const tasaAbono        = valorVentaCOP > 0 ? (abonoInicialCOP / valorVentaCOP) * 100 : 0;
  const revenueTotalCOP  = valorVentaCOP * cantidad;
  const gananciaTotalCOP = gananciaCalcCOP * cantidad;

  // ── Dimensiones de producto: del join, o fallback a campos en Ventas ─────────
  // Tabla Productos: nombre_producto, marca, categoria, genero, talla,
  //                  tienda_cotizacion, link_producto, url_imagen, sku
  const marca         = prod?.marca           || venta.marca           || venta.marca_producto    || 'Sin marca';
  const categoria     = prod?.categoria       || venta.categoria       || venta.categoria_producto || 'Sin categoría';
  const genero        = prod?.genero          || venta.genero          || venta.genero_producto   || 'Sin especificar';
  const talla         = prod?.talla           || venta.talla           || venta.talla_producto    || '—';
  const tiendaCotizar = prod?.tienda_cotizacion || venta.tienda_cotizar || venta.tienda_cotizacion || venta.tiendaCotizar || 'Sin tienda';
  const nombreModelo  = prod?.nombre_producto || venta.nombre_modelo   || venta.nombreModelo      || venta.descripcion   || 'Sin nombre';
  const urlProducto   = prod?.link_producto   || venta.url_producto    || venta.urlProducto       || '';
  const fotoReferencia= prod?.url_imagen      || venta.foto_referencia || venta.fotoReferencia    || '';
  const skuProducto   = prod?.sku             || venta.sku             || '';

  return {
    ...venta,
    // Campos normalizados financieros
    valorCotizadoUSD, trmCotizada, valorVentaCOP, gananciaCalcCOP,
    abonoInicialCOP, cantidad, pesoEstimadoLbs,
    // Campos derivados
    valorUSDenCOP, margenPct, markupPct, costoPorLibra,
    tasaAbono, revenueTotalCOP, gananciaTotalCOP,
    // Dimensiones del producto (JOIN)
    marca, categoria, genero, talla, tiendaCotizar,
    nombreModelo, urlProducto, fotoReferencia, skuProducto,
    // Metadata
    tallaInfo:  normalizarTalla(talla),
    fecha:      venta.fecha || venta.fecha_registro || '',
    clienteId:  venta.cliente_id?.toString() || '',
    productoId: prodId || '',
    // Referencia al producto original
    _producto: prod,
  };
}

// ─── Agrupar ventas por dimensión ─────────────────────────────────────────────
export function agruparPorDimension(ventas, dimension) {
  return ventas.reduce((acc, venta) => {
    const key = venta[dimension] || 'Sin especificar';
    if (!acc[key]) acc[key] = {
      ventas: 0, unidades: 0, revenueCOP: 0, gananciaCOP: 0,
      sumaMargen: 0, sumaTRM: 0, sumaUSD: 0,
      marcas: new Set(), categorias: new Set(), tallas: new Set(),
      tiendas: new Set(), clientes: new Set(),
      registros: [],
    };
    const g = acc[key];
    g.ventas++;
    g.unidades     += venta.cantidad;
    g.revenueCOP   += venta.revenueTotalCOP;
    g.gananciaCOP  += venta.gananciaTotalCOP;
    g.sumaMargen   += venta.margenPct;
    g.sumaTRM      += venta.trmCotizada;
    g.sumaUSD      += venta.valorCotizadoUSD;
    if (venta.marca) g.marcas.add(venta.marca);
    if (venta.categoria) g.categorias.add(venta.categoria);
    if (venta.talla) g.tallas.add(venta.talla);
    if (venta.tiendaCotizar) g.tiendas.add(venta.tiendaCotizar);
    if (venta.clienteId) g.clientes.add(venta.clienteId);
    g.registros.push(venta);
    return acc;
  }, {});
}

// Convertir resultado de agruparPorDimension a array enriquecido
export function dimensionToArray(agrupado, keyName = 'dimension') {
  return Object.entries(agrupado).map(([key, g]) => ({
    [keyName]: key,
    ventas: g.ventas,
    unidades: g.unidades,
    revenueCOP: g.revenueCOP,
    gananciaCOP: g.gananciaCOP,
    margenPct: g.ventas > 0 ? g.sumaMargen / g.ventas : 0,
    trmPromedio: g.ventas > 0 ? g.sumaTRM / g.ventas : 0,
    valorUSDPromedio: g.ventas > 0 ? g.sumaUSD / g.ventas : 0,
    markupPct: g.sumaUSD > 0 && g.sumaTRM > 0
      ? ((g.revenueCOP / g.unidades - (g.sumaUSD / g.ventas) * (g.sumaTRM / g.ventas)) /
         ((g.sumaUSD / g.ventas) * (g.sumaTRM / g.ventas))) * 100
      : 0,
    marcas: [...g.marcas],
    categorias: [...g.categorias],
    tallas: [...g.tallas],
    tiendas: [...g.tiendas],
    clientes: g.clientes.size,
    registros: g.registros,
  }));
}

// ─── Matriz Marca × Categoría para VA6 ────────────────────────────────────────
export function construirMatrizMarcaCategoria(ventas, metrica = 'unidades') {
  const marcas = [...new Set(ventas.map(v => v.marca).filter(Boolean))].sort();
  const categorias = [...new Set(ventas.map(v => v.categoria).filter(Boolean))].sort();

  const matriz = marcas.map((marca, mi) => ({
    marca,
    color: getBrandColor(marca, mi),
    valores: categorias.map(categoria => {
      const sub = ventas.filter(v => v.marca === marca && v.categoria === categoria);
      if (sub.length === 0) return { valor: 0, ventas: [] };
      let valor = 0;
      switch (metrica) {
        case 'unidades': valor = sub.reduce((s, v) => s + v.cantidad, 0); break;
        case 'revenue':  valor = sub.reduce((s, v) => s + v.revenueTotalCOP, 0); break;
        case 'margen':   valor = sub.reduce((s, v) => s + v.margenPct, 0) / sub.length; break;
        case 'ganancia': valor = sub.reduce((s, v) => s + v.gananciaTotalCOP, 0); break;
        default:         valor = sub.reduce((s, v) => s + v.cantidad, 0);
      }
      return { valor, ventas: sub };
    }),
  }));

  return { marcas, categorias, matriz };
}

// ─── Rangos de precio USD para VA7 ────────────────────────────────────────────
export function agruparPorRangoPrecioUSD(ventas) {
  const rangos = [
    { label: '$0–50',    min: 0,   max: 50   },
    { label: '$51–100',  min: 51,  max: 100  },
    { label: '$101–200', min: 101, max: 200  },
    { label: '$201–500', min: 201, max: 500  },
    { label: '$500+',    min: 501, max: Infinity },
  ];
  return rangos.map(rango => {
    const sub = ventas.filter(v =>
      v.valorCotizadoUSD >= rango.min && v.valorCotizadoUSD <= rango.max);
    return {
      rango: rango.label,
      ventas: sub.length,
      unidades: sub.reduce((s, v) => s + v.cantidad, 0),
      revenueCOP: sub.reduce((s, v) => s + v.revenueTotalCOP, 0),
      gananciaCOP: sub.reduce((s, v) => s + v.gananciaTotalCOP, 0),
      margenPromedio: sub.length > 0 ? sub.reduce((s, v) => s + v.margenPct, 0) / sub.length : 0,
    };
  });
}

// ─── Ranking de modelos para VA8 ──────────────────────────────────────────────
export function rankingModelos(ventas) {
  const mapa = {};
  ventas.forEach(v => {
    const key = (v.nombreModelo || 'sin nombre').trim().toLowerCase();
    if (!mapa[key]) mapa[key] = {
      nombre:        v.nombreModelo || 'Sin nombre',
      marca:         v.marca,
      categoria:     v.categoria,
      genero:        v.genero,
      urlProducto:   v.urlProducto,
      fotoReferencia:v.fotoReferencia,
      unidades: 0, revenueCOP: 0, gananciaCOP: 0,
      sumaMargen: 0, vecesRepetido: 0,
      sumaUSD: 0, sumaTRM: 0,
      tallas: new Set(), tiendas: new Set(), clientes: new Set(), registros: [],
    };
    const m = mapa[key];
    m.unidades       += v.cantidad;
    m.revenueCOP     += v.revenueTotalCOP;
    m.gananciaCOP    += v.gananciaTotalCOP;
    m.sumaMargen     += v.margenPct;
    m.sumaUSD        += v.valorCotizadoUSD;
    m.sumaTRM        += v.trmCotizada;
    m.vecesRepetido++;
    if (v.talla && v.talla !== '—') m.tallas.add(v.talla);
    if (v.tiendaCotizar) m.tiendas.add(v.tiendaCotizar);
    if (v.clienteId) m.clientes.add(v.clienteId);
    m.registros.push(v);
  });
  return Object.values(mapa).map(m => ({
    ...m,
    tallas:        [...m.tallas].join(', ') || '—',
    tiendas:       [...m.tiendas].join(', ') || '—',
    clientes:      m.clientes.size,
    margenPromedio:m.vecesRepetido > 0 ? m.sumaMargen / m.vecesRepetido : 0,
    usdPromedio:   m.vecesRepetido > 0 ? m.sumaUSD / m.vecesRepetido : 0,
    trmPromedio:   m.vecesRepetido > 0 ? m.sumaTRM / m.vecesRepetido : 0,
    candidatoStock:m.vecesRepetido >= 3 ? 'si' : m.vecesRepetido === 2 ? 'potencial' : 'puntual',
  })).sort((a, b) => b.unidades - a.unidades);
}

// ─── Análisis por talla cruzado con marca ─────────────────────────────────────
export function matrizTallaMarca(ventas) {
  const tallas    = [...new Set(ventas.map(v => v.talla).filter(t => t && t !== '—'))].sort();
  const marcas    = [...new Set(ventas.map(v => v.marca).filter(Boolean))].sort();
  const matriz    = tallas.map(talla => ({
    talla,
    valores: marcas.map(marca => {
      const sub = ventas.filter(v => v.talla === talla && v.marca === marca);
      return sub.reduce((s, v) => s + v.cantidad, 0);
    }),
  }));
  return { tallas, marcas, matriz };
}

// ─── Top N de una dimensión por talla/marca/categoría ─────────────────────────
export function topPorTalla(ventas, campo, tallaFiltro = null) {
  const filtered = tallaFiltro ? ventas.filter(v => v.talla === tallaFiltro) : ventas;
  const agrup    = agruparPorDimension(filtered, campo);
  return dimensionToArray(agrup, campo).sort((a, b) => b.unidades - a.unidades).slice(0, 5);
}

// ─── Interpretaciones dinámicas ───────────────────────────────────────────────
const cop = (n) => {
  const abs = Math.abs(Number(n) || 0);
  if (abs >= 1_000_000) return '$' + (abs / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (abs >= 1_000)    return '$' + (abs / 1_000).toFixed(0) + 'k';
  return '$' + Math.round(abs).toLocaleString('es-CO');
};
const pct = (n, d = 1) => (Number(n) || 0).toFixed(d).replace('.', ',') + '%';

export function interpretarMarcas(marcas, totalRevenue, metaMargenMin = 15) {
  if (!marcas || marcas.length === 0)
    return 'No hay datos de ventas por marca en el período seleccionado.';
  const sorted       = [...marcas].sort((a, b) => b.revenueCOP - a.revenueCOP);
  const top          = sorted[0];
  const topMargen    = [...marcas].sort((a, b) => b.margenPct - a.margenPct)[0];
  const concentracion= totalRevenue > 0 ? (top.revenueCOP / totalRevenue * 100).toFixed(1) : 0;
  const criticas     = marcas.filter(m => m.margenPct < metaMargenMin);
  let txt = `${top.marca} lidera en revenue con ${cop(top.revenueCOP)} (${concentracion}% del total en el período). `;
  txt += `La marca con mejor margen promedio es ${topMargen.marca} con ${pct(topMargen.margenPct)}. `;
  txt += criticas.length > 0
    ? `${criticas.length} marca(s) con margen por debajo del mínimo: ${criticas.map(m => m.marca).join(', ')}. Revisar estrategia de precios.`
    : 'Todas las marcas superan el margen mínimo establecido. ✅';
  return txt;
}

export function interpretarCategorias(categorias, totalRevenue) {
  if (!categorias || categorias.length === 0)
    return 'No hay datos de ventas por categoría en el período.';
  const sorted   = [...categorias].sort((a, b) => b.unidades - a.unidades);
  const topVol   = sorted[0];
  const topRev   = [...categorias].sort((a, b) => b.revenueCOP - a.revenueCOP)[0];
  const topMargen= [...categorias].sort((a, b) => b.margenPct - a.margenPct)[0];
  const pctTotal = totalRevenue > 0 ? (topVol.revenueCOP / totalRevenue * 100).toFixed(1) : 0;
  let txt = `La categoría con mayor demanda es ${topVol.categoria} con ${topVol.unidades} unidades (${pctTotal}% del revenue total). `;
  txt += `La más rentable es ${topMargen.categoria} con ${pct(topMargen.margenPct)} de margen. `;
  if (topRev.categoria !== topVol.categoria)
    txt += `${topRev.categoria} lidera en revenue con ${cop(topRev.revenueCOP)}.`;
  return txt;
}

export function interpretarTiendas(tiendas) {
  if (!tiendas || tiendas.length === 0)
    return 'No hay datos de tiendas en el período seleccionado.';
  const topUso    = [...tiendas].sort((a, b) => b.ventas - a.ventas)[0];
  const topMargen = [...tiendas].sort((a, b) => b.margenPct - a.margenPct)[0];
  const masBarata = [...tiendas].filter(t => t.valorUSDPromedio > 0).sort((a, b) => a.valorUSDPromedio - b.valorUSDPromedio)[0];
  let txt = `${topUso.tiendaCotizar || topUso.dimension} es la tienda más usada con ${topUso.ventas} cotizaciones. `;
  txt += `${topMargen.tiendaCotizar || topMargen.dimension} ofrece el mejor margen promedio: ${pct(topMargen.margenPct)}. `;
  if (masBarata)
    txt += `La tienda con precio USD promedio más bajo es ${masBarata.tiendaCotizar || masBarata.dimension} con $${(masBarata.valorUSDPromedio).toFixed(2)} USD por artículo. `;
  txt += `Oportunidad: cotizar más en ${topMargen.tiendaCotizar || topMargen.dimension} puede mejorar el margen global.`;
  return txt;
}

export function interpretarTallas(tallas) {
  if (!tallas || tallas.length === 0)
    return 'No hay datos de tallas en el período.';
  const top3 = [...tallas].sort((a, b) => b.unidades - a.unidades).slice(0, 3);
  const escasas = tallas.filter(t => t.unidades === 1);
  let txt = `Tallas más demandadas: ${top3.map(t => `${t.talla} (${t.unidades} uds)`).join(', ')}. `;
  if (escasas.length > 0)
    txt += `${escasas.length} talla(s) con solo 1 pedido — puede ser demanda puntual. `;
  txt += `Recomendación: al hacer encargos de ${top3[0]?.talla || '—'} se garantiza la mayor probabilidad de venta inmediata.`;
  return txt;
}

export function interpretarGeneros(generos, totalRevenue) {
  if (!generos || generos.length === 0)
    return 'No hay datos de género en el período.';
  const dominante = [...generos].sort((a, b) => b.revenueCOP - a.revenueCOP)[0];
  const pctDom    = totalRevenue > 0 ? (dominante.revenueCOP / totalRevenue * 100).toFixed(1) : 0;
  const topMargen = [...generos].sort((a, b) => b.margenPct - a.margenPct)[0];
  let txt = `El género ${dominante.genero} domina con ${pctDom}% del revenue total. `;
  txt += `El género con mejor margen es ${topMargen.genero} con ${pct(topMargen.margenPct)}. `;
  if (dominante.genero !== topMargen.genero)
    txt += `Oportunidad: aumentar la oferta de ${topMargen.genero} puede mejorar el margen global del negocio.`;
  return txt;
}

export function interpretarMatriz(marcas, categorias, ventas) {
  const topComb = [];
  marcas.forEach(m => {
    categorias.forEach(c => {
      const sub = ventas.filter(v => v.marca === m && v.categoria === c);
      if (sub.length > 0) {
        topComb.push({
          marca: m, categoria: c,
          unidades: sub.reduce((s, v) => s + v.cantidad, 0),
          revenue:  sub.reduce((s, v) => s + v.revenueTotalCOP, 0),
          margen:   sub.reduce((s, v) => s + v.margenPct, 0) / sub.length,
        });
      }
    });
  });
  if (topComb.length === 0) return 'No hay combinaciones de marca × categoría en el período.';
  const top      = topComb.sort((a, b) => b.revenue - a.revenue)[0];
  const topMrg   = topComb.sort((a, b) => b.margen - a.margen)[0];
  const sinVentas= marcas.length * categorias.length - topComb.length;
  let txt = `La combinación más vendida es ${top.marca} × ${top.categoria} con ${top.unidades} unidades y ${cop(top.revenue)} en revenue. `;
  txt += `La más rentable: ${topMrg.marca} × ${topMrg.categoria} con ${pct(topMrg.margen)} de margen. `;
  if (sinVentas > 0)
    txt += `Hay ${sinVentas} combinaciones sin ventas en el período — podrían representar oportunidades de oferta activa.`;
  return txt;
}

export function interpretarPreciosTRM(ventas) {
  if (!ventas || ventas.length === 0) return 'No hay datos de precio/TRM en el período.';
  const trmProm  = ventas.reduce((s, v) => s + v.trmCotizada, 0) / ventas.length;
  const altaTRM  = ventas.filter(v => v.trmCotizada > 4000);
  const bajaTRM  = ventas.filter(v => v.trmCotizada <= 4000);
  const mAlt     = altaTRM.length > 0 ? altaTRM.reduce((s, v) => s + v.margenPct, 0) / altaTRM.length : 0;
  const mBaj     = bajaTRM.length > 0 ? bajaTRM.reduce((s, v) => s + v.margenPct, 0) / bajaTRM.length : 0;
  let txt = `TRM promedio del período: ${Math.round(trmProm).toLocaleString('es-CO')}. `;
  if (altaTRM.length > 0 && bajaTRM.length > 0) {
    txt += `Con TRM alta (>4000) el margen promedio es ${pct(mAlt)}. Con TRM baja (≤4000) es ${pct(mBaj)}. `;
    txt += mAlt > mBaj
      ? 'La TRM alta favorece los márgenes — buen momento para hacer más encargos.'
      : 'Los márgenes se mantienen independientes de la TRM — el pricing es sólido.';
  } else {
    txt += `Todas las ventas del período usaron una TRM ${altaTRM.length > 0 ? 'alta (>4000)' : 'baja (≤4000)'}.`;
  }
  return txt;
}

export function interpretarModelos(modelos) {
  if (!modelos || modelos.length === 0) return 'No hay datos de modelos en el período.';
  const top5 = modelos.slice(0, 5);
  const candidatos = modelos.filter(m => m.vecesRepetido >= 3);
  const topGanancia = [...modelos].sort((a, b) => b.gananciaCOP - a.gananciaCOP)[0];
  let txt = `Top modelos del período: ${top5.map(m => `"${m.nombre.slice(0, 25)}" (${m.unidades} uds)`).join(', ')}. `;
  txt += `El más rentable es "${topGanancia?.nombre?.slice(0, 30)}" con ${cop(topGanancia?.gananciaCOP || 0)} en ganancia total. `;
  txt += candidatos.length > 0
    ? `${candidatos.length} modelo(s) pedido(s) 3+ veces: ${candidatos.slice(0, 3).map(m => m.nombre.slice(0, 20)).join(', ')}. Son candidatos para stock permanente. ✅`
    : 'Ningún modelo supera 3 repeticiones — la demanda es altamente personalizada.';
  return txt;
}
