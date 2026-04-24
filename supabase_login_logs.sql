-- ============================================================
-- JARAPP — Login Tracking Setup
-- Ejecutar completo con "Run this query" en Supabase SQL Editor
-- ============================================================

-- 1. Crear tabla login_logs
CREATE TABLE IF NOT EXISTS public.login_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    login_time TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar RLS en la tabla
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de seguridad

-- Permitir que un administrador pueda ver todos los logs
CREATE POLICY "admin_read_all_logs"
  ON public.login_logs FOR SELECT TO authenticated
  USING ( public.is_admin() );

-- Permitir que un usuario inserte su propio log de acceso
CREATE POLICY "user_insert_own_log"
  ON public.login_logs FOR INSERT TO authenticated
  WITH CHECK ( auth.uid() = user_id );

-- 4. Opcional: Eliminar políticas anteriores si se vuelve a correr este script
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'login_logs' AND schemaname = 'public' AND policyname NOT IN ('admin_read_all_logs', 'user_insert_own_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.login_logs', pol.policyname);
  END LOOP;
END$$;
