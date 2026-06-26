// Ejecuta el scraping diario a las 7:00 AM hora Colombia (UTC-5 = 12:00 UTC).
// ✅ Scraping automático activo vía Supabase Edge Functions —
// corre todos los días entre 7:00 y 7:10 AM aunque JARAPP esté cerrado.

import { ejecutarScrapingDiario } from './scraperService.js';

let _schedulerActivo  = false;
let _proximaEjecucion = null;
let _timeoutId        = null;
let _intervalId       = null;

// ── INICIALIZAR ────────────────────────────────────────────────────────────────
export function iniciarScheduler() {
  if (_schedulerActivo) return; // ya inicializado en esta sesión
  _schedulerActivo = true;

  _proximaEjecucion = _calcularProximaEjecucion(new Date());
  const msHasta = _proximaEjecucion - Date.now();

  console.log(`[Scheduler] Próxima ejecución: ${_proximaEjecucion.toLocaleString('es-CO')}`);
  console.log(`[Scheduler] Tiempo restante: ${Math.round(msHasta / 1000 / 60)} minutos`);

  _timeoutId = setTimeout(async () => {
    await _ejecutarCiclo();
    _intervalId = setInterval(_ejecutarCiclo, 24 * 60 * 60 * 1000);
  }, msHasta);
}

export function detenerScheduler() {
  if (_timeoutId)  clearTimeout(_timeoutId);
  if (_intervalId) clearInterval(_intervalId);
  _schedulerActivo  = false;
  _proximaEjecucion = null;
  _timeoutId        = null;
  _intervalId       = null;
  console.log('[Scheduler] Detenido.');
}

export function getEstadoScheduler() {
  return {
    activo:           _schedulerActivo,
    proximaEjecucion: _proximaEjecucion,
  };
}

// ── EJECUCIÓN MANUAL (panel admin) ────────────────────────────────────────────
export async function ejecutarAhora(onProgress = null) {
  console.log('[Scheduler] Ejecución manual iniciada...');
  return await ejecutarScrapingDiario(onProgress);
}

// ── PRIVADAS ───────────────────────────────────────────────────────────────────
function _calcularProximaEjecucion(ahora) {
  // 7:00 AM Colombia = 12:00:00 UTC
  const proxima = new Date(ahora);
  proxima.setUTCHours(12, 0, 0, 0);
  if (proxima <= ahora) proxima.setUTCDate(proxima.getUTCDate() + 1);
  return proxima;
}

async function _ejecutarCiclo() {
  console.log('[Scheduler] Iniciando scraping diario automático...');
  // Actualizar próxima ejecución para que el panel la refleje
  _proximaEjecucion = _calcularProximaEjecucion(new Date());
  _proximaEjecucion.setUTCDate(_proximaEjecucion.getUTCDate() + 1);
  try {
    const resumen = await ejecutarScrapingDiario();
    console.log('[Scheduler] Scraping completado:', resumen.stats);
  } catch (err) {
    console.error('[Scheduler] Error en ciclo automático:', err);
  }
}
