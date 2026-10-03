-- #Viaje de Encargos — Compras USA se divide en 2 submódulos (Compras
-- Online / Compras en Viaje). Se necesita una columna simple (no una
-- consulta con join a Ventas) para que TablaPro pueda filtrar cada
-- submódulo directamente contra Supabase.
ALTER TABLE "Compras" ADD COLUMN IF NOT EXISTS es_viaje boolean NOT NULL DEFAULT false;
UPDATE "Compras" SET es_viaje = true WHERE viaje_id IS NOT NULL AND es_viaje = false;
CREATE INDEX IF NOT EXISTS idx_compras_es_viaje ON "Compras"(es_viaje);
