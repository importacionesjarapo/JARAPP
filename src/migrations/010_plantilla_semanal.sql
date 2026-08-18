-- Fase 2 de la expansión del Calendario de Contenido: tabla Plantilla Semanal
-- (una fila fija por día, 0=Lunes…6=Domingo) usada para sugerir
-- canal/categoría/tipo de contenido y para generar publicaciones en lote.
CREATE TABLE IF NOT EXISTS "PlantillaSemanal" (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_semana               SMALLINT NOT NULL UNIQUE,
  canal                    TEXT,
  categoria_sugerida       TEXT,
  tipo_contenido_sugerido  TEXT,
  notas                    TEXT,
  activo                   BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Por si la tabla ya existía con un esquema distinto/incompleto.
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
