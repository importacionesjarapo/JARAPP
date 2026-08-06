-- Columnas nuevas en Ventas (antes solo persistidas en localStorage como fallback)
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS ganancia_aplica_analista boolean DEFAULT true;
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS observaciones_analista text;
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS analista_id uuid REFERENCES user_profiles(id);

CREATE INDEX IF NOT EXISTS idx_ventas_analista_id ON "Ventas"(analista_id);

-- Vista combinada Ventas + Cliente + Producto + Compra + Analista, usada por las pestañas
-- Rentabilidad y Ganancias Analista de Finanzas. ganancia_calc_analista lee el parámetro
-- Configuracion.PctGananciaAnalista en cada consulta (no queda "congelado" si el % cambia).
CREATE OR REPLACE VIEW ventas_finanzas_view AS
SELECT
  v.*,
  c.nombre            AS cliente_nombre,
  p.nombre_producto   AS producto_nombre,
  p.categoria         AS producto_categoria,
  p.marca             AS producto_marca,
  cp.proveedor        AS compra_proveedor,
  cp.costo_cop        AS compra_costo_cop,
  up.full_name        AS analista_nombre,
  COALESCE(v.ganancia_calculada, 0) *
    (COALESCE((SELECT valor::numeric FROM "Configuracion" WHERE clave = 'PctGananciaAnalista' LIMIT 1), 0) / 100)
    AS ganancia_calc_analista
FROM "Ventas" v
LEFT JOIN "Clientes" c     ON c.id::text = v.cliente_id::text
LEFT JOIN "Productos" p    ON p.id::text = v.producto_id::text
LEFT JOIN LATERAL (
  SELECT cp2.proveedor, cp2.costo_cop
  FROM "Compras" cp2
  WHERE cp2.venta_id::text = v.id::text
  LIMIT 1
) cp ON true
LEFT JOIN user_profiles up ON up.id = v.analista_id;

-- Vista de Egresos: une Gastos + Compras (misma unión que hoy arma renderEgrTabla en JS),
-- usada por la pestaña Egresos/tabla de Finanzas.
CREATE OR REPLACE VIEW egresos_view AS
SELECT
  id, fecha_real_factura::text AS fecha, numero_factura, tipo_gasto AS tipo, concepto AS descripcion,
  moneda, valor_origen, trm, valor_cop AS total_cop, comprobante_url,
  false AS es_compra, NULL::text AS venta_id
FROM "Gastos"
UNION ALL
SELECT
  id, fecha_pedido::text AS fecha, NULL::text AS numero_factura, 'Compra USA Proveedor' AS tipo,
  proveedor AS descripcion, 'USD' AS moneda, costo_usd AS valor_origen, NULL::numeric AS trm,
  costo_cop AS total_cop, NULL::text AS comprobante_url,
  true AS es_compra, venta_id
FROM "Compras"
WHERE COALESCE(costo_cop, 0) > 0;
