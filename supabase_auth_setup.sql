-- ============================================================
-- JARAPP — Auth RBAC · SQL FINAL CORREGIDO
-- Políticas SIN recursión infinita
-- Ejecutar completo con "Run this query" en Supabase SQL Editor
-- ============================================================

-- 1. Tabla (si no existe)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT 'Usuario',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'gerente', 'ventas', 'logistica', 'finanzas', 'viewer')),
  permissions JSONB NOT NULL DEFAULT '{
    "dashboard": true, "clients": false, "inventory": false, "sales": false,
    "purchases": false, "logistics": false, "finance": false, "params": false, "admin": false
  }'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar TODAS las políticas anteriores (limpieza total)
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'user_profiles' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_profiles', pol.policyname);
  END LOOP;
END$$;

-- 4. Función helper para verificar si el usuario actual es admin
-- SECURITY DEFINER evita la recursión al ejecutarse con privilegios de superusuario
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 5. Políticas SIN recursión (usan is_admin() que se ejecuta fuera del contexto RLS)

-- SELECT: usuarios ven su propio perfil; admins ven todo
CREATE POLICY "read_policy"
  ON public.user_profiles FOR SELECT TO authenticated
  USING ( auth.uid() = id OR public.is_admin() );

-- INSERT: usuario inserta su propio perfil (primer login) O admin crea cualquiera
CREATE POLICY "insert_policy"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK ( auth.uid() = id OR public.is_admin() );

-- UPDATE: usuario actualiza el suyo O admin actualiza cualquiera
CREATE POLICY "update_policy"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING ( auth.uid() = id OR public.is_admin() );

-- DELETE: solo admins
CREATE POLICY "delete_policy"
  ON public.user_profiles FOR DELETE TO authenticated
  USING ( public.is_admin() );

-- 6. Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Trigger auto-crear perfil al crear usuario en auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, email, role, permissions, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email, 'viewer',
    '{"dashboard":true,"clients":false,"inventory":false,"sales":false,
      "purchases":false,"logistics":false,"finance":false,"params":false,"admin":false}'::jsonb,
    true
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 8. PROMOVER ADMIN — Inserta o actualiza el perfil admin
-- ============================================================
INSERT INTO public.user_profiles (id, full_name, email, role, permissions, is_active)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
  au.email,
  'admin',
  '{"dashboard":true,"clients":"edit","inventory":"edit","sales":"edit",
    "purchases":"edit","logistics":"edit","finance":"edit","params":"edit","admin":true}'::jsonb,
  true
FROM auth.users au
WHERE au.email = 'importaciones.jarapo@gmail.com'
ON CONFLICT (id) DO UPDATE SET
  role        = 'admin',
  is_active   = true,
  permissions = '{"dashboard":true,"clients":"edit","inventory":"edit","sales":"edit",
                  "purchases":"edit","logistics":"edit","finance":"edit","params":"edit","admin":true}'::jsonb,
  updated_at  = NOW();

-- 9. Verificación final (debe mostrar: role=admin, is_active=true)
SELECT id, email, role, is_active, created_at
FROM public.user_profiles
WHERE email = 'importaciones.jarapo@gmail.com';
