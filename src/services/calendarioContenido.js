/**
 * calendarioContenido.js — Servicio CRUD para el módulo Calendario de Contenido
 * Tabla Supabase: "ContenidoCalendario" (PascalCase — requiere comillas dobles en SQL crudo,
 * pero el cliente supabase-js se encarga de eso automáticamente vía .from()).
 */
import { db } from '../db.js';

const TABLE = 'ContenidoCalendario';

export const CATEGORIAS = ['calzado', 'tecnologia', 'perfumes', 'vitaminas', 'bolsos', 'relojes', 'ropa', 'b2b'];

export const CATEGORIA_LABELS = {
  calzado: 'Calzado', tecnologia: 'Tecnología', perfumes: 'Perfumes', vitaminas: 'Vitaminas',
  bolsos: 'Bolsos', relojes: 'Relojes', ropa: 'Ropa', b2b: 'B2B'
};

export const CATEGORIA_COLORS = {
  calzado: '#1F6FEB', tecnologia: '#7C3AED', perfumes: '#C026A3', vitaminas: '#059669',
  bolsos: '#B7791F', relojes: '#334155', ropa: '#DC6803', b2b: '#0E7490'
};

export const CANALES = ['instagram_post', 'instagram_story', 'instagram_reel', 'facebook', 'tiktok', 'whatsapp_grupo', 'whatsapp_estado', 'email'];

export const CANAL_LABELS = {
  instagram_post: 'Instagram · Post', instagram_story: 'Instagram · Historia', instagram_reel: 'Instagram · Reel',
  facebook: 'Facebook', tiktok: 'TikTok', whatsapp_grupo: 'WhatsApp · Grupo',
  whatsapp_estado: 'WhatsApp · Estado', email: 'Email'
};

export const CANAL_GRIS = '#94A3B8';

export const ESTADOS = ['idea', 'redaccion', 'aprobado', 'programado', 'publicado'];

export const ESTADO_LABELS = {
  idea: 'Idea', redaccion: 'Redacción', aprobado: 'Aprobado', programado: 'Programado', publicado: 'Publicado'
};

// { texto, fondo }
export const ESTADO_BADGE_COLORS = {
  idea:       { text: '#475569', bg: '#E2E8F0' },
  redaccion:  { text: '#B7791F', bg: '#FDF3E3' },
  aprobado:   { text: '#1B8A5A', bg: '#E7F6EF' },
  programado: { text: '#1F6FEB', bg: '#EAF1FF' },
  publicado:  { text: '#FFFFFF', bg: '#0E1420' },
};

/** Color del pill de una publicación: gris fijo si canal es whatsapp_grupo, si no por categoría */
export const colorDePublicacion = (item) => {
  if (item?.canal === 'whatsapp_grupo') return CANAL_GRIS;
  return CATEGORIA_COLORS[item?.categoria] || '#64748B';
};

/** true si el registro requiere atención (link sin verificar, o código de descuento sin verificar) */
export const requiereAtencion = (item) => {
  if (!item) return false;
  if (item.link_verificado === false) return true;
  if (item.codigo_descuento && item.codigo_verificado === false) return true;
  return false;
};

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** true si se publicó en fecha distinta a la fecha programada */
export const esPublicadoTarde = (item) => {
  if (!item?.fecha_publicacion_real) return false;
  return String(item.fecha_publicacion_real).slice(0, 10) !== String(item.fecha).slice(0, 10);
};

/** true si la fecha programada ya pasó y la publicación no quedó publicada ni cancelada */
export const esVencidoSinPublicar = (item) => {
  if (!item?.fecha) return false;
  return String(item.fecha).slice(0, 10) < hoyISO() && item.estado !== 'publicado' && item.estado !== 'cancelado';
};

/** true si el botón "Publicado" debe mostrarse: programado y con fecha ya cumplida */
export const puedeMarcarPublicado = (item) => {
  if (!item) return false;
  return item.estado === 'programado' && String(item.fecha).slice(0, 10) <= hoyISO();
};

export const CalendarioService = {
  async fetchAll() {
    if (!db.client) throw new Error('Conexión a Supabase no configurada. Ve a Configuración.');
    const { data, error } = await db.client
      .from(TABLE)
      .select('*')
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true });
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

  /** Marca una publicación como publicada hoy. */
  async marcarPublicado(item) {
    return this.update(item.id, { estado: 'publicado', fecha_publicacion_real: hoyISO() });
  },

  /** Reprograma una publicación a una nueva fecha/hora, llevando la cuenta de reprogramaciones. */
  async reprogramar(item, nuevaFecha, nuevaHora) {
    const payload = {
      fecha: nuevaFecha,
      hora: nuevaHora || null,
      estado: 'programado',
      veces_reprogramado: (item.veces_reprogramado || 0) + 1,
    };
    if (!item.fecha_original_programada) payload.fecha_original_programada = item.fecha;
    return this.update(item.id, payload);
  },
};

export default CalendarioService;
