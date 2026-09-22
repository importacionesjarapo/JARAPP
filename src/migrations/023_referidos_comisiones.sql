-- Fase 5 (SaaS EncargosPro): código de referido por empresa (#32) y
-- parametrización de descuentos/comisiones de referidos (#31). Los días
-- de prueba ya eran configurables desde 021 (Planes.trial.dias_prueba);
-- esto añade lo que faltaba de ese punto.
--
-- El código de referido es autogenerado (a partir del slug) para que toda
-- empresa nueva pueda compartir el suyo sin que el superadmin tenga que
-- asignarlo a mano. "referido_por" guarda el id de la empresa que trajo a
-- esta nueva — se resuelve en el momento del registro (ver
-- netlify/functions/admin-empresas.js, acción crear_empresa_trial).

ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS codigo_referido TEXT;
ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS referido_por UUID REFERENCES "Empresas"(id);

-- Backfill de códigos para empresas que ya existían antes de este cambio.
UPDATE "Empresas"
SET codigo_referido = UPPER(slug) || '-' || SUBSTRING(id::TEXT, 1, 4)
WHERE codigo_referido IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_codigo_referido_key'
  ) THEN
    ALTER TABLE "Empresas" ADD CONSTRAINT empresas_codigo_referido_key UNIQUE (codigo_referido);
  END IF;
END $$;

-- Comisión para quien refiere y descuento para el referido — porcentajes
-- (0-100) que el superadmin aplica manualmente al facturar, ya que los
-- pagos de esta app se registran a mano (no hay pasarela de cobro).
ALTER TABLE "PoliticaSuscripcion" ADD COLUMN IF NOT EXISTS descuento_referido_pct NUMERIC(5,2) NOT NULL DEFAULT 10;
ALTER TABLE "PoliticaSuscripcion" ADD COLUMN IF NOT EXISTS comision_referido_pct NUMERIC(5,2) NOT NULL DEFAULT 10;
