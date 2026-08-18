/**
 * plantillaSemanal.js — Servicio CRUD para el módulo Plantilla Semanal
 * Tabla Supabase: "PlantillaSemanal" (PascalCase — requiere comillas dobles en SQL crudo,
 * pero el cliente supabase-js se encarga de eso automáticamente vía .from()).
 * dia_semana: 0=Lunes … 6=Domingo (mismo criterio que el resto del módulo Calendario).
 */
import { db } from '../db.js';

const TABLE = 'PlantillaSemanal';

export const DIAS_SEMANA_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const TIPOS_CONTENIDO = ['educativo', 'humor', 'venta', 'testimonial', 'fomo', 'aspiracional'];

export const TIPO_CONTENIDO_LABELS = {
  educativo: 'Educativo', humor: 'Humor', venta: 'Venta', testimonial: 'Testimonial',
  fomo: 'FOMO', aspiracional: 'Aspiracional'
};

/** dia_semana (0=Lunes…6=Domingo) para una fecha 'YYYY-MM-DD' */
export const diaSemanaDeFecha = (fechaStr) => {
  const [y, m, d] = String(fechaStr).slice(0, 10).split('-').map(Number);
  return (new Date(y, (m || 1) - 1, d || 1).getDay() + 6) % 7;
};

/** true si la categoría de una publicación no coincide con la sugerida por la plantilla activa de ese día */
export const esFueraDePlantilla = (item, plantillaDelDia) => {
  if (!item || !plantillaDelDia || !plantillaDelDia.activo) return false;
  return item.categoria !== plantillaDelDia.categoria_sugerida;
};

export const PlantillaService = {
  async fetchAll() {
    if (!db.client) throw new Error('Conexión a Supabase no configurada. Ve a Configuración.');
    const { data, error } = await db.client.from(TABLE).select('*').order('dia_semana', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Crea o actualiza la fila de un día de la semana (una sola fila por dia_semana). */
  async upsertDia(diaSemana, payload) {
    if (!db.client) throw new Error('Conexión a Supabase no configurada.');
    const { data, error } = await db.client
      .from(TABLE)
      .upsert([{ dia_semana: diaSemana, ...payload }], { onConflict: 'dia_semana' })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
};

export default PlantillaService;
