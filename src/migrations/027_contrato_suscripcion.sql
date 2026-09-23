-- Fase 3 (#11, #12): contrato de suscripción aceptado durante el registro
-- de trial (landing) — guarda una copia exacta del texto aceptado (no solo
-- la versión) para que la auditoría no dependa de que el contrato "vigente"
-- no haya cambiado después, más los metadatos de cuándo/desde dónde se
-- aceptó y si el correo con la copia se logró enviar.
CREATE TABLE IF NOT EXISTS "ContratosAceptados" (
  id               TEXT PRIMARY KEY,
  empresa_id       UUID NOT NULL REFERENCES "Empresas"(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version_contrato TEXT NOT NULL,
  texto_contrato   TEXT NOT NULL,
  nombre_completo  TEXT,
  email            TEXT NOT NULL,
  ip_aceptacion    TEXT,
  user_agent       TEXT,
  fecha_aceptacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_enviado    BOOLEAN NOT NULL DEFAULT false,
  email_enviado_en TIMESTAMPTZ,
  email_error      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "ContratosAceptados" ENABLE ROW LEVEL SECURITY;

-- Mismo patrón de aislamiento por tenant que el resto de tablas de negocio
-- (ver current_empresa_id() en 014_multitenant_rls.sql) — así el admin de
-- cada empresa puede ver su propio contrato aceptado desde Documentación
-- sin exponer los de otras empresas.
DROP POLICY IF EXISTS "ContratosAceptados_empresa_isolation" ON "ContratosAceptados";
CREATE POLICY "ContratosAceptados_empresa_isolation" ON "ContratosAceptados"
  FOR ALL USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

CREATE INDEX IF NOT EXISTS idx_contratosaceptados_empresa_id ON "ContratosAceptados"(empresa_id);
