-- Fase B del plan SaaS multi-tenant (EncargosPro): tabla "Empresas" +
-- columna empresa_id en todas las tablas de negocio, con backfill hacia
-- "Importaciones Jarapo" (Tenant #1) ANTES de forzar NOT NULL, para no
-- romper la app mientras corre en producción.
--
-- Orden seguro: 1) crear Empresas + Jarapo  2) columna nullable en todo
-- 3) backfill  4) NOT NULL + FK + índice. Ejecutar tal cual, de arriba
-- hacia abajo — cada paso depende de que el anterior haya corrido.

-- ── 1) Tabla Empresas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Empresas" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  plan                TEXT NOT NULL DEFAULT 'basico',
  estado_suscripcion  TEXT NOT NULL DEFAULT 'trial' CHECK (estado_suscripcion IN ('activa', 'vencida', 'trial', 'cancelada')),
  fecha_vencimiento   DATE,
  logo_url            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Jarapo = Tenant #1. Insert idempotente vía slug único.
INSERT INTO "Empresas" (nombre, slug, plan, estado_suscripcion)
VALUES ('Importaciones Jarapo', 'jarapo', 'ilimitado', 'activa')
ON CONFLICT (slug) DO NOTHING;

-- ── 2) empresa_id NULLABLE en todas las tablas de negocio ──────────────────
-- user_profiles incluida: se queda nullable para siempre (además de este
-- paso) porque el rol "superadmin" de Fase D no pertenece a ninguna empresa.
-- trm_historico NO entra: es tasa de cambio pública, compartida por todos.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_profiles', 'Ventas', 'Clientes', 'Productos', 'Logistica', 'Gastos',
    'Compras', 'Abonos', 'GuiasInternacionales', 'MetodosPago', 'viajes',
    'Configuracion', 'MetasDashboard', 'login_logs', 'ContenidoCalendario',
    'PlantillaSemanal', 'FechasClave', 'cuentas_tracker', 'posts_tracker',
    'posts_descartados_permanente', 'recreaciones_tracker', 'scraping_logs',
    'snapshot_metricas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS empresa_id UUID', t);
  END LOOP;
END $$;

-- ── 3) Backfill: todo lo que existe hoy es de Jarapo ───────────────────────
DO $$
DECLARE
  t TEXT;
  jarapo_id UUID;
BEGIN
  SELECT id INTO jarapo_id FROM "Empresas" WHERE slug = 'jarapo';

  FOREACH t IN ARRAY ARRAY[
    'user_profiles', 'Ventas', 'Clientes', 'Productos', 'Logistica', 'Gastos',
    'Compras', 'Abonos', 'GuiasInternacionales', 'MetodosPago', 'viajes',
    'Configuracion', 'MetasDashboard', 'login_logs', 'ContenidoCalendario',
    'PlantillaSemanal', 'FechasClave', 'cuentas_tracker', 'posts_tracker',
    'posts_descartados_permanente', 'recreaciones_tracker', 'scraping_logs',
    'snapshot_metricas'
  ]
  LOOP
    EXECUTE format('UPDATE %I SET empresa_id = $1 WHERE empresa_id IS NULL', t) USING jarapo_id;
  END LOOP;
END $$;

-- ── 4) NOT NULL + FK + índice en todo EXCEPTO user_profiles ────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Ventas', 'Clientes', 'Productos', 'Logistica', 'Gastos',
    'Compras', 'Abonos', 'GuiasInternacionales', 'MetodosPago', 'viajes',
    'Configuracion', 'MetasDashboard', 'login_logs', 'ContenidoCalendario',
    'PlantillaSemanal', 'FechasClave', 'cuentas_tracker', 'posts_tracker',
    'posts_descartados_permanente', 'recreaciones_tracker', 'scraping_logs',
    'snapshot_metricas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN empresa_id SET NOT NULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = t || '_empresa_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (empresa_id) REFERENCES "Empresas"(id)',
        t, t || '_empresa_id_fkey'
      );
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (empresa_id)', 'idx_' || lower(t) || '_empresa_id', t);
  END LOOP;
END $$;

-- user_profiles: FK sí, NOT NULL no (superadmin no tiene empresa_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_empresa_id_fkey'
  ) THEN
    ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES "Empresas"(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_user_profiles_empresa_id ON user_profiles (empresa_id);
