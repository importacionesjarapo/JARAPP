-- Fase 1 del plan de expansión a suscripciones: catálogo real de planes
-- (Prueba/Básico/Pro/Empresarial), con qué módulos incluye cada uno y
-- cuántos usuarios permite. Reemplaza el uso de "PoliticaTrial" (020) como
-- fuente de los módulos habilitados en el self-serve trial — ese módulo ya
-- no alcanza porque ahora TODOS los planes (no solo el trial) necesitan un
-- set de módulos + límite de usuarios parametrizable por el superadmin.
--
-- A diferencia de PoliticaTrial (bloqueada por completo detrás de RLS sin
-- política, solo accesible vía la Netlify Function con service role key),
-- "Planes" SÍ debe poder leerse desde el cliente: la app arma el sidebar
-- (módulo visible pero bloqueado con candado si no está en el plan
-- contratado) usando esta tabla directamente vía auth.getPlan(). No hay
-- nada sensible en el catálogo (nombre del plan, límites, módulos), así
-- que el SELECT queda abierto; la escritura sigue reservada al superadmin
-- vía admin-empresas.js (service role, ignora RLS).
CREATE TABLE IF NOT EXISTS "Planes" (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  max_usuarios  INT,              -- NULL = sin límite (ej. Empresarial a medida)
  dias_prueba   INT,              -- solo aplica al plan 'trial'; NULL en el resto
  modulos       JSONB NOT NULL DEFAULT '{}',
  orden         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 'dashboard' no aparece explícito en ningún plan porque lo tiene todo el
-- mundo siempre (mismo criterio que ya usaba MODULOS_TRIAL_TOGGLES en
-- superadmin.js) — pero se guarda en true por claridad al leer la fila.
INSERT INTO "Planes" (id, nombre, max_usuarios, dias_prueba, modulos, orden) VALUES
  ('trial', 'Prueba', 1, 7, '{
    "dashboard": true, "finance": true, "inventory": true, "sales": true,
    "purchases": true, "calculadora": true, "logistics": true, "vendedores": true,
    "clients": true, "params": true, "documentacion": true,
    "admin": false, "cotizador_ver": false, "calendario_ver": false,
    "viaje": false, "tracker": false
  }'::jsonb, 0),
  ('basico', 'Básico', 2, NULL, '{
    "dashboard": true, "sales": true, "purchases": true, "logistics": true,
    "vendedores": true, "clients": true, "calculadora": true, "viaje": true,
    "inventory": true, "finance": true, "params": true, "documentacion": true,
    "admin": true,
    "cotizador_ver": false, "calendario_ver": false, "tracker": false
  }'::jsonb, 1),
  ('pro', 'Pro', 5, NULL, '{
    "dashboard": true, "sales": true, "purchases": true, "cotizador_ver": true,
    "logistics": true, "vendedores": true, "clients": true, "calculadora": true,
    "viaje": true, "inventory": true, "finance": true, "params": true,
    "documentacion": true, "admin": true, "tracker": true, "calendario_ver": true
  }'::jsonb, 2),
  ('empresarial', 'Empresarial', NULL, NULL, '{
    "dashboard": true, "sales": true, "purchases": true, "cotizador_ver": true,
    "logistics": true, "vendedores": true, "clients": true, "calculadora": true,
    "viaje": true, "inventory": true, "finance": true, "params": true,
    "documentacion": true, "admin": true, "tracker": true, "calendario_ver": true
  }'::jsonb, 3)
ON CONFLICT (id) DO NOTHING;

-- Si el superadmin ya había personalizado PoliticaTrial (días u otros
-- módulos) antes de esta migración, se preserva esa configuración en vez
-- de perderla con el seed de arriba.
DO $$
DECLARE pol RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PoliticaTrial') THEN
    SELECT * INTO pol FROM "PoliticaTrial" WHERE id = 1;
    IF FOUND THEN
      UPDATE "Planes"
        SET dias_prueba = pol.dias_prueba,
            modulos = modulos || COALESCE(pol.modulos_habilitados, '{}'::jsonb)
        WHERE id = 'trial';
    END IF;
  END IF;
END $$;

ALTER TABLE "Planes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Planes_select_todos" ON "Planes";
CREATE POLICY "Planes_select_todos" ON "Planes" FOR SELECT USING (true);
-- Sin políticas de INSERT/UPDATE/DELETE a propósito: solo admin-empresas.js
-- (service role key, ignora RLS) puede modificar el catálogo.
