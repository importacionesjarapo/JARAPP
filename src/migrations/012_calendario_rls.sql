-- Row Level Security del módulo Calendario de Contenido.
-- La app usa una sola anon key compartida y hace el control de acceso en el
-- cliente (permisos calendario_* en auth.js), así que aquí solo habilitamos
-- RLS y dejamos políticas permisivas — igual que "MetasDashboard" en
-- dashboard_setup.sql — para que Supabase no bloquee lecturas/escrituras
-- con "new row violates row-level security policy".
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ContenidoCalendario', 'PlantillaSemanal', 'FechasClave']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_all'
    ) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true)', t || '_all', t);
    END IF;
  END LOOP;
END $$;
