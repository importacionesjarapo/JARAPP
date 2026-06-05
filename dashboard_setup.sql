-- ============================================================
-- JARAPP — Dashboard 360° Setup SQL
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Agregar campo fecha_vencimiento a la tabla Ventas
--    (Si ya existe, este comando no fallará con IF NOT EXISTS)
ALTER TABLE "Ventas"
  ADD COLUMN IF NOT EXISTS fecha_vencimiento TEXT;

-- Por defecto: fecha_vencimiento = fecha + 30 días para registros existentes
UPDATE "Ventas"
SET fecha_vencimiento = TO_CHAR(
    TO_DATE(SPLIT_PART(fecha::TEXT, 'T', 1), 'YYYY-MM-DD') + INTERVAL '30 days',
    'YYYY-MM-DD'
)
WHERE fecha_vencimiento IS NULL AND fecha IS NOT NULL;

-- 2. Crear tabla MetasDashboard para metas configurables
CREATE TABLE IF NOT EXISTS "MetasDashboard" (
  id           TEXT PRIMARY KEY,
  clave        TEXT NOT NULL,
  valor        TEXT NOT NULL,
  descripcion  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Insertar metas por defecto (si no existen)
INSERT INTO "MetasDashboard" (id, clave, valor, descripcion)
VALUES
  ('meta_facturacion_mensual',     'meta_facturacion_mensual',     '50000000',  'Meta de facturación mensual en COP'),
  ('meta_cobrado_mensual',         'meta_cobrado_mensual',         '45000000',  'Meta de cobrado (ingresos reales) mensual en COP'),
  ('meta_margen_neto_pct',         'meta_margen_neto_pct',         '25',        'Meta de margen neto en % (ej: 25 = 25%)'),
  ('meta_cartera_maxima',          'meta_cartera_maxima',          '30000000',  'Cartera vencida máxima aceptable en COP'),
  ('meta_dso_dias',                'meta_dso_dias',                '30',        'Días promedio de cobro objetivo (DSO)'),
  ('meta_rotacion_inventario',     'meta_rotacion_inventario',     '4',         'Rotación de inventario anual objetivo'),
  ('meta_envios_tiempo_pct',       'meta_envios_tiempo_pct',       '90',        'Porcentaje de envíos a tiempo objetivo'),
  ('meta_nuevos_clientes_mes',     'meta_nuevos_clientes_mes',     '5',         'Meta de nuevos clientes por mes'),
  ('meta_conversion_pct',          'meta_conversion_pct',          '60',        'Tasa de conversión cotización→venta objetivo en %'),
  ('umbral_caja_minima',           'umbral_caja_minima',           '5000000',   'Saldo mínimo de caja operativa en COP'),
  ('umbral_margen_minimo_pct',     'umbral_margen_minimo_pct',     '15',        'Margen mínimo por producto en % (alerta si cae debajo)'),
  ('dias_inactividad_cliente',     'dias_inactividad_cliente',     '45',        'Días sin compra para considerar cliente en riesgo'),
  ('dias_vencimiento_cotizacion',  'dias_vencimiento_cotizacion',  '5',         'Días sin respuesta para alertar cotización pendiente'),
  ('dias_retraso_envio_critico',   'dias_retraso_envio_critico',   '7',         'Días de retraso de un envío para alerta crítica'),
  ('plazo_vencimiento_factura',    'plazo_vencimiento_factura',    '30',        'Días de crédito por defecto para calcular vencimiento')
ON CONFLICT (id) DO NOTHING;

-- 4. Habilitar RLS en MetasDashboard (ajustar según tus políticas)
ALTER TABLE "MetasDashboard" ENABLE ROW LEVEL SECURITY;

-- Crear política SELECT (ignora si ya existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'MetasDashboard'
      AND policyname = 'MetasDashboard_select'
  ) THEN
    EXECUTE 'CREATE POLICY "MetasDashboard_select"
             ON "MetasDashboard" FOR SELECT USING (true)';
  END IF;
END;
$$;

-- Crear política ALL (ignora si ya existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'MetasDashboard'
      AND policyname = 'MetasDashboard_all'
  ) THEN
    EXECUTE 'CREATE POLICY "MetasDashboard_all"
             ON "MetasDashboard" FOR ALL USING (true)';
  END IF;
END;
$$;

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================
