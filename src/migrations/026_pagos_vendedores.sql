-- Fase 4 (#19): estado de pago de comisión por vendedor/mes — pendiente o
-- pagado, con fecha de pago y comprobante opcional. El módulo Vendedores ya
-- CALCULABA cuánto se le debe a cada vendedor (ganancia_calc_analista en
-- ventas_finanzas_view); esto agrega el registro de que efectivamente se le
-- pagó, separado de esa comisión que ya la venta trae.
--
-- Un registro por (vendedor, año, mes) — la comisión se paga en bloque
-- mensual, no venta por venta.
CREATE TABLE IF NOT EXISTS "PagosVendedores" (
  id              TEXT PRIMARY KEY,
  vendedor_id     UUID NOT NULL REFERENCES user_profiles(id),
  anio            INT NOT NULL,
  mes             INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto           NUMERIC NOT NULL DEFAULT 0,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
  fecha_pago      DATE,
  comprobante_url TEXT,
  empresa_id      UUID NOT NULL REFERENCES "Empresas"(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vendedor_id, anio, mes)
);

ALTER TABLE "PagosVendedores" ENABLE ROW LEVEL SECURITY;

-- Mismo patrón de aislamiento por tenant que el resto de tablas de negocio
-- (ver current_empresa_id() en 014_multitenant_rls.sql).
DROP POLICY IF EXISTS "PagosVendedores_empresa_isolation" ON "PagosVendedores";
CREATE POLICY "PagosVendedores_empresa_isolation" ON "PagosVendedores"
  FOR ALL USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

CREATE INDEX IF NOT EXISTS idx_pagosvendedores_empresa_id ON "PagosVendedores"(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagosvendedores_vendedor ON "PagosVendedores"(vendedor_id, anio, mes);
