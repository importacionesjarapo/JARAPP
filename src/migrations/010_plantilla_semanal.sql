-- Fase 2 de la expansión del Calendario de Contenido: columnas de la Plantilla
-- Semanal (una fila fija por día, 0=Lunes…6=Domingo) usada para sugerir
-- canal/categoría/tipo de contenido y para generar publicaciones en lote.
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS dia_semana smallint;
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS canal text;
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS categoria_sugerida text;
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS tipo_contenido_sugerido text;
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS notas text;
ALTER TABLE "PlantillaSemanal" ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "PlantillaSemanal" ADD CONSTRAINT plantillasemanal_dia_semana_key UNIQUE (dia_semana);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
