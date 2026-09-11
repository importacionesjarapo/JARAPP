-- Fase B (cont.) del plan SaaS multi-tenant: aislamiento real por empresa vía
-- Row Level Security. Requiere que 013_multitenant_empresas.sql ya haya
-- corrido (empresa_id NOT NULL + backfilled en todas las tablas de negocio).
--
-- current_empresa_id() es SECURITY DEFINER a propósito: si no lo fuera, la
-- política RLS de user_profiles se autobloquearía al intentar leerse a sí
-- misma dentro de la función (RLS aplicándose sobre su propia subconsulta).

CREATE OR REPLACE FUNCTION current_empresa_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM user_profiles WHERE id = auth.uid();
$$;

-- ── Aislamiento por tenant en todas las tablas de negocio ──────────────────
-- Reemplaza cualquier política permisiva previa (ej. "<tabla>_all" con
-- USING(true), como quedó "ContenidoCalendario"/"PlantillaSemanal"/
-- "FechasClave" en 012_calendario_rls.sql) por el aislamiento real.
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
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_all', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_empresa_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id())',
        t || '_empresa_isolation', t
      );
    END IF;
  END LOOP;
END $$;

-- ── user_profiles ───────────────────────────────────────────────────────────
-- OJO: a propósito NO se usa una sola política "FOR ALL" con
-- "id = auth.uid() OR empresa_id = current_empresa_id()". Eso permitiría a
-- cualquier usuario autenticado hacer INSERT/UPDATE sobre su propia fila con
-- CUALQUIER empresa_id (WITH CHECK solo exige id = auth.uid()), es decir,
-- auto-asignarse a la empresa de otro cliente — el hueco de aislamiento que
-- toda esta fase existe para cerrar. Por eso van separadas: lectura amplia
-- (para poder leer el propio perfil incluso sin empresa asignada todavía),
-- escritura solo dentro de la propia empresa.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_all ON user_profiles;
DROP POLICY IF EXISTS user_profiles_empresa_isolation ON user_profiles;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_select'
  ) THEN
    CREATE POLICY user_profiles_select ON user_profiles
      FOR SELECT USING (id = auth.uid() OR empresa_id = current_empresa_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_insert'
  ) THEN
    -- El self-heal de login() (perfil faltante) intenta un upsert sin
    -- empresa_id: current_empresa_id() da NULL para quien aún no tiene
    -- perfil, así que esta política lo bloquea de forma segura (NULL = NULL
    -- no es true) y el flujo cae al perfil en memoria de solo lectura. La
    -- alta real de usuarios ocurre en admin.js/Fase D, que sí manda
    -- empresa_id explícito.
    CREATE POLICY user_profiles_insert ON user_profiles
      FOR INSERT WITH CHECK (empresa_id = current_empresa_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_update'
  ) THEN
    CREATE POLICY user_profiles_update ON user_profiles
      FOR UPDATE USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'user_profiles_delete'
  ) THEN
    CREATE POLICY user_profiles_delete ON user_profiles
      FOR DELETE USING (empresa_id = current_empresa_id());
  END IF;
END $$;

-- ── Empresas ─────────────────────────────────────────────────────────────
-- Cada usuario solo puede LEER la fila de su propia empresa (nombre/logo/
-- estado de suscripción). No hay política de escritura: INSERT/UPDATE/
-- DELETE quedan bloqueados para cualquier rol de cliente (anon/authenticated)
-- — crear o renovar tenants pasa solo por la Netlify Function de Fase D,
-- que usa la service role key y por lo tanto no pasa por RLS.
ALTER TABLE "Empresas" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Empresas' AND policyname = 'Empresas_select_propia'
  ) THEN
    CREATE POLICY "Empresas_select_propia" ON "Empresas"
      FOR SELECT USING (id = current_empresa_id());
  END IF;
END $$;
