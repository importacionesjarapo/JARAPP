-- Fase 3 de la expansión del Calendario de Contenido: tabla Fechas Clave
-- (viajes a EEUU, temporadas de descuento, fechas comerciales) que se
-- muestran como franja de color sobre las celdas del calendario mensual.
CREATE TABLE IF NOT EXISTS "FechasClave" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_inicio  DATE NOT NULL,
  fecha_fin     DATE,
  titulo        TEXT NOT NULL,
  tipo          TEXT NOT NULL,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Por si la tabla ya existía con un esquema distinto/incompleto.
ALTER TABLE "FechasClave" ADD COLUMN IF NOT EXISTS fecha_inicio date;
ALTER TABLE "FechasClave" ADD COLUMN IF NOT EXISTS fecha_fin date;
ALTER TABLE "FechasClave" ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE "FechasClave" ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE "FechasClave" ADD COLUMN IF NOT EXISTS notas text;
