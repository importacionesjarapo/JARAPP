-- Fase 1 de la expansión del Calendario de Contenido: soporte para marcar
-- publicaciones como publicadas (con fecha real) y para reprogramarlas,
-- llevando la cuenta de cuántas veces se reprogramó cada una.
--
-- Incluye un CREATE TABLE IF NOT EXISTS defensivo con el esquema completo
-- que usa el módulo (por si "ContenidoCalendario" tampoco existía todavía,
-- igual que pasó con "PlantillaSemanal" en la migración 010).
CREATE TABLE IF NOT EXISTS "ContenidoCalendario" (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                       DATE NOT NULL,
  hora                        TIME,
  canal                       TEXT,
  categoria                   TEXT,
  tipo_contenido              TEXT,
  estado                      TEXT NOT NULL DEFAULT 'idea',
  responsable                 TEXT,
  fecha_limite_entrega        DATE,
  hook                        TEXT,
  guion                       TEXT,
  copy_final                  TEXT,
  cta                         TEXT,
  marcas_productos            JSONB DEFAULT '[]'::jsonb,
  assets_necesarios           TEXT,
  codigo_descuento            TEXT,
  link_verificado             BOOLEAN DEFAULT false,
  codigo_verificado           BOOLEAN DEFAULT false,
  reglas_marca_revisadas      BOOLEAN DEFAULT false,
  fecha_publicacion_real      DATE,
  fecha_original_programada   DATE,
  veces_reprogramado          INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Por si la tabla ya existía con un esquema distinto/incompleto.
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS fecha_publicacion_real date;
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS fecha_original_programada date;
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS veces_reprogramado integer NOT NULL DEFAULT 0;
