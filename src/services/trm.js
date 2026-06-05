import { db } from '../db.js';

const client = () => db.client;
const TRM_API_URL = 'https://open.er-api.com/v6/latest/USD';

export const TRMService = {

  _guardarEnSession(fecha, valor, fuente) {
    sessionStorage.setItem('JARAPP_TRM', valor);
    sessionStorage.setItem('JARAPP_TRM_FECHA', fecha);
    sessionStorage.setItem('JARAPP_TRM_FUENTE', fuente);
    window.JARAPP_TRM = valor;
    window.JARAPP_TRM_FUENTE = fuente;
  },

  async getTRMHoy() {
    const hoy = new Date().toISOString().split('T')[0];

    // 0) sessionStorage — evita llamadas repetidas en la misma sesión
    const cached = sessionStorage.getItem('JARAPP_TRM');
    const cachedFecha = sessionStorage.getItem('JARAPP_TRM_FECHA');
    if (cached && cachedFecha === hoy) {
      const fuente = sessionStorage.getItem('JARAPP_TRM_FUENTE') || 'manual';
      window.JARAPP_TRM = parseFloat(cached);
      window.JARAPP_TRM_FUENTE = fuente;
      return { valor: parseFloat(cached), fuente, cached: true };
    }

    // 1) trm_historico en Supabase
    try {
      const { data } = await client()
        .from('trm_historico')
        .select('valor, fuente')
        .eq('fecha', hoy)
        .maybeSingle();
      if (data?.valor) {
        this._guardarEnSession(hoy, parseFloat(data.valor), data.fuente || 'supabase');
        return { valor: parseFloat(data.valor), fuente: data.fuente || 'supabase', cached: true };
      }
    } catch (e) { console.warn('Error consultando trm_historico:', e); }

    // 2) API externa open.er-api.com
    try {
      const res = await fetch(TRM_API_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        const cop = json?.rates?.COP;
        if (cop && cop > 3000 && cop < 6000) {
          const valor = Math.round(cop);
          const { error } = await client()
            .from('trm_historico')
            .upsert([{ fecha: hoy, valor, fuente: 'open.er-api.com' }], { onConflict: 'fecha' });
          if (error) console.warn('Error guardando TRM en Supabase:', error);
          this._guardarEnSession(hoy, valor, 'open.er-api.com');
          return { valor, fuente: 'open.er-api.com', cached: false };
        }
      }
    } catch (e) { console.warn('API TRM falló:', e); }

    // 3) Fallback hardcodeado
    console.warn('TRM API no disponible, usando valor por defecto');
    this._guardarEnSession(hoy, 3700, 'manual');
    return { valor: 3700, fuente: 'manual', cached: false };
  },

  async getTRMHistorico(dias = 30) {
    const { data, error } = await client()
      .from('trm_historico')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(dias);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getTRMParaFecha(fecha) {
    const { data } = await client()
      .from('trm_historico')
      .select('valor, fuente')
      .eq('fecha', fecha)
      .maybeSingle();
    return data || null;
  },

  formatear(valor) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(valor);
  },
};
