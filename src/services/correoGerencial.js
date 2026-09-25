// Fase 4 (#20): configuración del informe gerencial diario — a quién se le
// envía y si está activo. La generación/envío en sí corre server-side
// (netlify/functions/informe-gerencial.js, Scheduled Function), este
// archivo solo lee/guarda la configuración desde la app (Admin →
// Correo Gerencial), mismo patrón que loadCalcConfig/saveCalcConfig en
// calculadora.js.
import { db } from '../db.js';
import { auth } from '../auth.js';

export const CORREO_GERENCIAL_DEFAULT = { activo: false, destinatarios: [] };

export async function loadCorreoGerencialConfig() {
  try {
    const list = await db.fetchData('Configuracion');
    if (Array.isArray(list)) {
      const param = list.find(p => p.clave === 'CORREO_GERENCIAL');
      if (param && param.valor) {
        const parsed = JSON.parse(param.valor);
        return { ...CORREO_GERENCIAL_DEFAULT, ...parsed };
      }
    }
  } catch (e) {
    console.warn('[CorreoGerencial] Config no encontrada, usando defaults:', e.message);
  }
  return { ...CORREO_GERENCIAL_DEFAULT };
}

export async function saveCorreoGerencialConfig(config) {
  const list = await db.fetchData('Configuracion');
  const existing = Array.isArray(list) ? list.find(p => p.clave === 'CORREO_GERENCIAL') : null;
  const payload = {
    id: existing ? existing.id : 'CORREO_GERENCIAL_' + Date.now(),
    clave: 'CORREO_GERENCIAL',
    valor: JSON.stringify(config),
    empresa_id: auth.getEmpresaId(),
  };
  await db.postData('Configuracion', payload, existing ? 'UPDATE' : 'INSERT');
}
