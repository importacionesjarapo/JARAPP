-- Fase 1 del plan de expansión a suscripciones (piezas finales): fechas de
-- activación/último pago en Empresas, registro de pagos de cada tenant
-- hacia EncargosPro, y el parámetro global de días de gracia en modo
-- solo-lectura al vencer la suscripción.

-- ── Fechas de activación y último pago en Empresas ─────────────────────────
-- fecha_vencimiento ya existía (013). Estas dos son nuevas:
-- fecha_activacion: cuándo empezó a pagar (distinto de created_at, que es
-- cuándo se creó la fila — puede llevar tiempo en trial antes de activarse).
-- fecha_ultimo_pago: se actualiza automáticamente cada vez que se registra
-- un pago nuevo en PagosSuscripciones (ver admin-empresas.js).
ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS fecha_activacion DATE;
ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS fecha_ultimo_pago DATE;

-- ── Registro de pagos de cada empresa hacia EncargosPro ────────────────────
-- Historial financiero de cada tenant hacia NOSOTROS — no confundir con
-- "Abonos"/pagos de los CLIENTES de cada tenant, que es negocio normal del
-- tenant y ya vive aislado por RLS. Esto es información sensible cross-
-- tenant, así que sigue el mismo patrón que "PoliticaTrial" (RLS activo,
-- CERO políticas): solo accesible vía admin-empresas.js con la service
-- role key, nunca directo desde el cliente con la anon key.
CREATE TABLE IF NOT EXISTS "PagosSuscripciones" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES "Empresas"(id) ON DELETE CASCADE,
  monto          NUMERIC NOT NULL CHECK (monto > 0),
  moneda         TEXT NOT NULL DEFAULT 'COP',
  metodo_pago    TEXT,
  fecha_pago     DATE NOT NULL,
  periodo_desde  DATE,
  periodo_hasta  DATE,
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagossuscripciones_empresa_id ON "PagosSuscripciones" (empresa_id);
ALTER TABLE "PagosSuscripciones" ENABLE ROW LEVEL SECURITY;

-- ── Modo solo-lectura al vencer (parametrizable) ───────────────────────────
-- Fila única y GLOBAL, mismo patrón que PoliticaTrial — cuántos días después
-- de fecha_vencimiento el ADMIN de una empresa vencida sigue pudiendo
-- CONSULTAR (nunca crear/editar); el resto de roles se corta de inmediato.
-- A diferencia de PoliticaTrial, esta sí necesita SELECT público: la app
-- evalúa este número en cada login para decidir si activa el modo
-- solo-lectura (ver auth.js getPoliticaSuscripcion()/isReadOnlyMode()).
CREATE TABLE IF NOT EXISTS "PoliticaSuscripcion" (
  id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dias_gracia_solo_lectura  INT NOT NULL DEFAULT 3 CHECK (dias_gracia_solo_lectura >= 0),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO "PoliticaSuscripcion" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE "PoliticaSuscripcion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PoliticaSuscripcion_select_todos" ON "PoliticaSuscripcion";
CREATE POLICY "PoliticaSuscripcion_select_todos" ON "PoliticaSuscripcion" FOR SELECT USING (true);
-- Sin política de escritura a propósito: solo admin-empresas.js (service
-- role, ignora RLS) puede cambiar los días de gracia.
