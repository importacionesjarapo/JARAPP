-- #Viaje de Encargos — Ventas — vincula una Venta (tipo Encargo tomado
-- durante un viaje a EEUU) al viaje activo en el momento del registro,
-- igual que ya existe para Compras (compras.viaje_id).
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS viaje_id UUID REFERENCES viajes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ventas_viaje_id ON "Ventas"(viaje_id);
