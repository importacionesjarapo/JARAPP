-- Compras USA "Stock Propio" (sin cliente) ahora también generan
-- trazabilidad en Logística. Esas filas no tienen venta_id, así que se
-- necesita guardar a qué Producto corresponden y cuántas unidades se
-- deben sumar al stock de Medellín cuando lleguen a Bodega Colombia.
ALTER TABLE "Logistica" ADD COLUMN IF NOT EXISTS producto_id text;
ALTER TABLE "Logistica" ADD COLUMN IF NOT EXISTS cantidad integer;
