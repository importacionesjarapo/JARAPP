-- Tabla viajes
CREATE TABLE IF NOT EXISTS viajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  destino TEXT NOT NULL DEFAULT 'Orlando, EEUU',
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
  gasto_tiquetes NUMERIC(10,2) DEFAULT 0,
  gasto_hotel NUMERIC(10,2) DEFAULT 0,
  gasto_flete NUMERIC(10,2) DEFAULT 0,
  gasto_overweight NUMERIC(10,2) DEFAULT 0,
  gasto_otros NUMERIC(10,2) DEFAULT 0,
  modo_distribucion TEXT NOT NULL DEFAULT 'uniforme' CHECK (modo_distribucion IN ('uniforme', 'por_valor')),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columnas en compras para vincular al viaje
ALTER TABLE compras ADD COLUMN IF NOT EXISTS viaje_id UUID REFERENCES viajes(id) ON DELETE SET NULL;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS costo_viaje_usd NUMERIC(10,2) DEFAULT 0;
ALTER TABLE compras ADD COLUMN IF NOT EXISTS costo_total_real_usd NUMERIC(10,2) DEFAULT 0;

-- Índices
CREATE INDEX IF NOT EXISTS idx_compras_viaje_id ON compras(viaje_id);
CREATE INDEX IF NOT EXISTS idx_viajes_estado ON viajes(estado);

-- Función: distribuir gastos del viaje entre sus compras
CREATE OR REPLACE FUNCTION distribuir_gastos_viaje(p_viaje_id UUID)
RETURNS VOID AS $$
DECLARE
  v_gasto_total NUMERIC;
  v_modo TEXT;
  v_n_productos INTEGER;
  v_inversion_total NUMERIC;
BEGIN
  SELECT (gasto_tiquetes + gasto_hotel + gasto_flete + gasto_overweight + gasto_otros), modo_distribucion
  INTO v_gasto_total, v_modo FROM viajes WHERE id = p_viaje_id;

  SELECT COUNT(*), SUM(precio_usd * cantidad)
  INTO v_n_productos, v_inversion_total
  FROM compras WHERE viaje_id = p_viaje_id;

  IF v_n_productos = 0 THEN RETURN; END IF;

  IF v_modo = 'uniforme' THEN
    UPDATE compras SET
      costo_viaje_usd = ROUND(v_gasto_total / v_n_productos, 2),
      costo_total_real_usd = precio_usd + ROUND(v_gasto_total / v_n_productos, 2),
      updated_at = NOW()
    WHERE viaje_id = p_viaje_id;
  ELSE
    UPDATE compras SET
      costo_viaje_usd = ROUND((precio_usd / v_inversion_total) * v_gasto_total, 2),
      costo_total_real_usd = precio_usd + ROUND((precio_usd / v_inversion_total) * v_gasto_total, 2),
      updated_at = NOW()
    WHERE viaje_id = p_viaje_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Función: cerrar viaje
CREATE OR REPLACE FUNCTION cerrar_viaje(p_viaje_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM distribuir_gastos_viaje(p_viaje_id);
  UPDATE viajes SET estado = 'cerrado', fecha_fin = COALESCE(fecha_fin, CURRENT_DATE), updated_at = NOW()
  WHERE id = p_viaje_id;
END;
$$ LANGUAGE plpgsql;
