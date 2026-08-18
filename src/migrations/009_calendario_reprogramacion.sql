-- Fase 1 de la expansión del Calendario de Contenido: soporte para marcar
-- publicaciones como publicadas (con fecha real) y para reprogramarlas,
-- llevando la cuenta de cuántas veces se reprogramó cada una.
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS fecha_publicacion_real date;
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS fecha_original_programada date;
ALTER TABLE "ContenidoCalendario" ADD COLUMN IF NOT EXISTS veces_reprogramado integer NOT NULL DEFAULT 0;
