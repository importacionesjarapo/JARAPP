import { db } from '../db.js';
const client = () => db.client;

const CACHE_TTL = 30 * 60 * 1000;
let _cache = null;
let _cacheTime = 0;

async function _fetchAlertas() {
  const ahora = new Date();
  const hoy = ahora.toISOString().split('T')[0];
  const hace3dias = new Date(ahora - 3 * 86400000).toISOString().split('T')[0];
  const hace5dias = new Date(ahora - 5 * 86400000).toISOString();
  const hace7ms   = 7 * 86400000;

  const alertas = [];

  // 1. Ventas con saldo pendiente > 3 días
  try {
    const { data: ventasSaldo } = await client()
      .from('Ventas')
      .select('id, cliente_id, saldo_pendiente, fecha')
      .gt('saldo_pendiente', 0)
      .lt('fecha', hace3dias);

    if (ventasSaldo?.length) {
      const cIds = [...new Set(ventasSaldo.map(v => v.cliente_id).filter(Boolean))];
      const clientesMap = {};
      if (cIds.length) {
        const { data: cData } = await client()
          .from('Clientes').select('id, nombre, whatsapp, telefono').in('id', cIds);
        if (cData) cData.forEach(c => { clientesMap[c.id] = c; });
      }
      alertas.push({
        tipo: 'cartera', nivel: 'danger', icono: '💸',
        titulo: `${ventasSaldo.length} venta${ventasSaldo.length !== 1 ? 's' : ''} con saldo sin pagar >3 días`,
        modulo: 'sales',
        detalle: ventasSaldo.slice(0, 5).map(v => {
          const c = clientesMap[v.cliente_id] || {};
          return {
            id:     v.id,
            tipo:   'venta',
            nombre: c.nombre || 'Sin nombre',
            saldo:  v.saldo_pendiente,
            dias:   Math.floor((Date.now() - new Date(v.fecha)) / 86400000),
            wa:     c.whatsapp || c.telefono || '',
          };
        }),
      });
    }
  } catch(e) { console.error('[Alertas] cartera:', e); }

  // 2. Pedidos logística sin actualización > 5 días (flat queries, sin joins)
  try {
    const { data: logSinAct } = await client()
      .from('Logistica')
      .select('id, venta_id, fase, fecha_actualizacion')
      .is('cli_fecha_recibido', null)
      .lt('fecha_actualizacion', hace5dias);

    if (logSinAct?.length) {
      const vIds = [...new Set(logSinAct.map(l => l.venta_id).filter(Boolean))];
      const ventasMap = {};
      const clientesMap2 = {};
      if (vIds.length) {
        const { data: vData } = await client()
          .from('Ventas').select('id, cliente_id').in('id', vIds);
        if (vData) {
          vData.forEach(v => { ventasMap[v.id] = v; });
          const cIds2 = [...new Set(vData.map(v => v.cliente_id).filter(Boolean))];
          if (cIds2.length) {
            const { data: cData2 } = await client()
              .from('Clientes').select('id, nombre, whatsapp, telefono').in('id', cIds2);
            if (cData2) cData2.forEach(c => { clientesMap2[c.id] = c; });
          }
        }
      }
      alertas.push({
        tipo: 'logistica', nivel: 'warning', icono: '📦',
        titulo: `${logSinAct.length} pedido${logSinAct.length !== 1 ? 's' : ''} sin actualización >5 días`,
        modulo: 'logistics',
        detalle: logSinAct.slice(0, 5).map(l => {
          const venta = ventasMap[l.venta_id] || {};
          const c = clientesMap2[venta.cliente_id] || {};
          return {
            id:       l.id,
            venta_id: l.venta_id,
            tipo:     'seguimiento',
            nombre:   c.nombre || `Ord #${l.venta_id?.toString().slice(-4) || '?'}`,
            saldo:    null,
            dias:     Math.floor((Date.now() - new Date(l.fecha_actualizacion)) / 86400000),
            wa:       c.whatsapp || c.telefono || '',
            fase:     l.fase?.split('(')[0]?.trim() || '',
          };
        }),
      });
    }
  } catch(e) { console.error('[Alertas] logistica:', e); }

  // 3. TRM variación > 2% respecto a ayer
  try {
    const ayer = new Date(ahora - 86400000).toISOString().split('T')[0];
    const [{ data: trmHoy }, { data: trmAyer }] = await Promise.all([
      client().from('trm_historico').select('valor').eq('fecha', hoy).maybeSingle(),
      client().from('trm_historico').select('valor').eq('fecha', ayer).maybeSingle(),
    ]);
    if (trmHoy?.valor && trmAyer?.valor) {
      const variacion = ((trmHoy.valor - trmAyer.valor) / trmAyer.valor) * 100;
      if (Math.abs(variacion) >= 2) {
        alertas.push({
          tipo: 'trm', nivel: Math.abs(variacion) >= 4 ? 'danger' : 'warning', icono: '💱',
          titulo: `TRM varió ${variacion > 0 ? '▲' : '▼'} ${Math.abs(variacion).toFixed(1)}% hoy`,
          modulo: 'params',
          detalle: [{
            nombre: `$${Math.round(trmHoy.valor).toLocaleString('es-CO')} COP/USD`,
            saldo: null, dias: null, wa: '',
            extra: `Ayer: $${Math.round(trmAyer.valor).toLocaleString('es-CO')}`,
          }],
        });
      }
    }
  } catch(e) { console.error('[Alertas] trm:', e); }

  // 4. Productos activos sin stock en ninguna bodega
  try {
    const { data: prods } = await client()
      .from('Productos')
      .select('id, nombre_producto, categoria, stock_medellin, stock_miami, stock_transito')
      .eq('estado_producto', 'Activo');

    const sinStock = (prods || []).filter(p =>
      (parseFloat(p.stock_medellin || 0) + parseFloat(p.stock_miami || 0) + parseFloat(p.stock_transito || 0)) === 0
    );
    if (sinStock.length) {
      alertas.push({
        tipo: 'inventario', nivel: 'warning', icono: '📭',
        titulo: `${sinStock.length} producto${sinStock.length !== 1 ? 's' : ''} activo${sinStock.length !== 1 ? 's' : ''} sin stock`,
        modulo: 'inventory',
        detalle: sinStock.slice(0, 5).map(p => ({
          id:     p.id,
          tipo:   'producto',
          nombre: p.nombre_producto || 'Sin nombre',
          saldo: null, dias: null, wa: '',
          fase:  p.categoria || '',
        })),
      });
    }
  } catch(e) { console.error('[Alertas] inventario:', e); }

  // 5. Pedidos en Fase 1 > 7 días sin tracking (timestamp extraído del ID)
  try {
    const { data: fase1Logs } = await client()
      .from('Logistica')
      .select('id, venta_id, fase')
      .ilike('fase', '1.%')
      .is('cli_fecha_recibido', null);

    const fase1Viejos = (fase1Logs || []).filter(l => {
      const tsStr = l.id?.replace('LOG', '');
      if (!tsStr || isNaN(tsStr)) return false;
      return (Date.now() - parseInt(tsStr)) > hace7ms;
    });

    if (fase1Viejos.length) {
      const vIds2 = [...new Set(fase1Viejos.map(l => l.venta_id).filter(Boolean))];
      const ventasMap2 = {};
      const clientesMap3 = {};
      if (vIds2.length) {
        const { data: vData2 } = await client()
          .from('Ventas').select('id, cliente_id').in('id', vIds2);
        if (vData2) {
          vData2.forEach(v => { ventasMap2[v.id] = v; });
          const cIds3 = [...new Set(vData2.map(v => v.cliente_id).filter(Boolean))];
          if (cIds3.length) {
            const { data: cData3 } = await client()
              .from('Clientes').select('id, nombre, whatsapp, telefono').in('id', cIds3);
            if (cData3) cData3.forEach(c => { clientesMap3[c.id] = c; });
          }
        }
      }
      alertas.push({
        tipo: 'fase1', nivel: 'warning', icono: '🛒',
        titulo: `${fase1Viejos.length} pedido${fase1Viejos.length !== 1 ? 's' : ''} comprado${fase1Viejos.length !== 1 ? 's' : ''} sin tracking >7 días`,
        modulo: 'logistics',
        detalle: fase1Viejos.slice(0, 5).map(l => {
          const tsStr = l.id?.replace('LOG', '');
          const venta = ventasMap2[l.venta_id] || {};
          const c = clientesMap3[venta.cliente_id] || {};
          return {
            id:       l.id,
            venta_id: l.venta_id,
            tipo:     'seguimiento',
            nombre:   c.nombre || `Ord #${l.venta_id?.toString().slice(-4) || '?'}`,
            saldo:    null,
            dias:     !isNaN(tsStr) ? Math.floor((Date.now() - parseInt(tsStr)) / 86400000) : null,
            wa:       c.whatsapp || c.telefono || '',
            fase:     l.fase?.split('(')[0]?.trim() || '',
          };
        }),
      });
    }
  } catch(e) { console.error('[Alertas] fase1:', e); }

  return alertas;
}

export const AlertasService = {
  async getAlertas(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _cache && (now - _cacheTime) < CACHE_TTL) return _cache;
    _cache = await _fetchAlertas();
    _cacheTime = now;
    return _cache;
  },

  invalidar() {
    _cache = null;
    _cacheTime = 0;
  },

  hayDanger() {
    return (_cache || []).some(a => a.nivel === 'danger');
  },

  dangerCount() {
    return (_cache || []).filter(a => a.nivel === 'danger').length;
  },
};
