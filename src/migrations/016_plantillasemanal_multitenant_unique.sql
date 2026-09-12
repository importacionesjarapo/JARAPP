-- Fix descubierto al inyectar empresa_id en la app (Fase C): 010_plantilla_semanal.sql
-- dejó "dia_semana" como UNIQUE global (una sola fila por día de la semana en
-- TODA la tabla). Eso funcionaba en single-tenant, pero en multi-tenant
-- impediría que la Empresa B tenga su propia plantilla de lunes si la
-- Empresa A ya creó la suya (el upsert de la primera empresa que llegue
-- bloquearía a todas las demás). La unicidad debe ser por (empresa_id, dia_semana).
--
-- Requiere que 013_multitenant_empresas.sql ya haya corrido (empresa_id
-- poblado en "PlantillaSemanal").
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plantillasemanal_dia_semana_key'
  ) THEN
    ALTER TABLE "PlantillaSemanal" DROP CONSTRAINT plantillasemanal_dia_semana_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plantillasemanal_empresa_dia_key'
  ) THEN
    ALTER TABLE "PlantillaSemanal" ADD CONSTRAINT plantillasemanal_empresa_dia_key UNIQUE (empresa_id, dia_semana);
  END IF;
END $$;
