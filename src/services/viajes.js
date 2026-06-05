import { db } from '../db.js';

const client = () => db.client;

// ─── Cache de sesión ──────────────────────────────────────────────────────────
const SESSION_KEY = 'JARAPP_VIAJE_ACTIVO';

export const ViajeState = {
  set(v) {
    if (v) sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(SESSION_KEY);
  },
  get() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  },
  isActive() { return !!this.get(); },
};

// ─── Servicio ─────────────────────────────────────────────────────────────────
export const ViajeService = {

  async getActivo() {
    const { data, error } = await client()
      .from('viajes')
      .select('*')
      .eq('estado', 'activo')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    ViajeState.set(data);
    return data;
  },

  async getHistorial() {
    const { data, error } = await client()
      .from('viajes')
      .select('*')
      .eq('estado', 'cerrado')
      .order('fecha_inicio', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async iniciar({ nombre, destino, fecha_inicio, modo_distribucion, notas }) {
    // Validar que no haya uno activo
    const activo = await this.getActivo();
    if (activo) throw new Error('Ya hay un viaje activo. Ciérralo antes de iniciar uno nuevo.');

    const { data, error } = await client()
      .from('viajes')
      .insert([{ nombre, destino, fecha_inicio, modo_distribucion, notas }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    ViajeState.set(data);
    return data;
  },

  async actualizarGastos(viajeId, gastos) {
    const { error } = await client()
      .from('viajes')
      .update({ ...gastos, updated_at: new Date().toISOString() })
      .eq('id', viajeId);
    if (error) throw new Error(error.message);

    const { error: rpcError } = await client().rpc('distribuir_gastos_viaje', { p_viaje_id: viajeId });
    if (rpcError) throw new Error(rpcError.message);

    // Refrescar cache
    await this.getActivo();
  },

  async cerrar(viajeId) {
    const { error } = await client().rpc('cerrar_viaje', { p_viaje_id: viajeId });
    if (error) throw new Error(error.message);
    ViajeState.set(null);
  },

  async getProductos(viajeId) {
    const { data, error } = await client()
      .from('Compras')
      .select('*')
      .eq('viaje_id', viajeId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getComprasSinViaje() {
    const { data, error } = await client()
      .from('Compras')
      .select('*')
      .is('viaje_id', null)
      .order('fecha_pedido', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async vincularCompra(compraId, viajeId) {
    const { error } = await client()
      .from('Compras')
      .update({ viaje_id: viajeId })
      .eq('id', compraId);
    if (error) throw new Error(error.message);

    const { error: rpcError } = await client().rpc('distribuir_gastos_viaje', { p_viaje_id: viajeId });
    if (rpcError) throw new Error(rpcError.message);
  },

  calcularMargenReal(precioVentaCop, costoTotalRealUsd, trmActual) {
    if (!precioVentaCop || !costoTotalRealUsd || !trmActual) return null;
    const costoCop = costoTotalRealUsd * trmActual;
    return ((precioVentaCop - costoCop) / precioVentaCop) * 100;
  },
};
