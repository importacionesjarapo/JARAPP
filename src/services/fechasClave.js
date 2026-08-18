/**
 * fechasClave.js — Servicio CRUD para el módulo Fechas Clave
 * Tabla Supabase: "FechasClave" (PascalCase — requiere comillas dobles en SQL crudo,
 * pero el cliente supabase-js se encarga de eso automáticamente vía .from()).
 */
import { db } from '../db.js';

const TABLE = 'FechasClave';

export const TIPOS_FECHA_CLAVE = ['viaje_eeuu', 'temporada_descuento', 'fecha_comercial'];

export const TIPO_FECHA_LABELS = {
  viaje_eeuu: 'Viaje EEUU', temporada_descuento: 'Temporada de descuento', fecha_comercial: 'Fecha comercial'
};

export const TIPO_FECHA_COLORS = {
  viaje_eeuu: '#1F6FEB', temporada_descuento: '#DC6803', fecha_comercial: '#7C3AED'
};

/** true si la fecha clave (con fecha_fin opcional) cubre la fecha 'YYYY-MM-DD' dada */
export const fechaClaveAplicaA = (fc, fechaStr) => {
  if (!fc?.fecha_inicio) return false;
  const inicio = String(fc.fecha_inicio).slice(0, 10);
  const fin = fc.fecha_fin ? String(fc.fecha_fin).slice(0, 10) : inicio;
  return fechaStr >= inicio && fechaStr <= fin;
};

export const FechasClaveService = {
  async fetchAll() {
    if (!db.client) throw new Error('Conexión a Supabase no configurada. Ve a Configuración.');
    const { data, error } = await db.client.from(TABLE).select('*').order('fecha_inicio', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async create(payload) {
    if (!db.client) throw new Error('Conexión a Supabase no configurada.');
    const { data, error } = await db.client.from(TABLE).insert([payload]).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, payload) {
    if (!db.client) throw new Error('Conexión a Supabase no configurada.');
    const { data, error } = await db.client.from(TABLE).update(payload).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async remove(id) {
    if (!db.client) throw new Error('Conexión a Supabase no configurada.');
    const { error } = await db.client.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export default FechasClaveService;
