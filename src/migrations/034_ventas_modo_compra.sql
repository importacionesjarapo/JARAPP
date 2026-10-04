-- #Viaje de Encargos — la venta "En Viaje USA" ya distingue entre submodo
-- "online" y "tienda" (createSaleModal / MODO_COMPRA_VIAJE_CARDS en
-- sales.js), pero ese valor solo se usaba para decidir qué formulario
-- mostrar y nunca se guardaba. Compras USA necesita saber, para cada
-- encargo pendiente de un viaje, si se debe comprar en línea o en una
-- tienda física — se persiste aquí para poder consultarlo después.
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS modo_compra text
  CHECK (modo_compra IS NULL OR modo_compra IN ('online', 'tienda'));
