-- Contenido de marketing de la landing (sección "Precios") editable por el
-- superadmin, en vez de quedar hardcodeado en landing/index.html. Se agrega
-- directo a "Planes" (mismo catálogo que ya gatea módulos por plan) en vez
-- de crear una tabla aparte, para que precio/bullets nunca queden
-- desincronizados de qué plan es cuál.
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS nombre_publico   TEXT;
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS precio_mensual   INTEGER;
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS precio_texto     TEXT;
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS bullets_publico  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS destacado        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Planes" ADD COLUMN IF NOT EXISTS visible_landing  BOOLEAN NOT NULL DEFAULT true;

-- Semilla: mismo contenido que hoy está hardcodeado en la landing, para que
-- nada cambie visualmente hasta que el superadmin edite algo.
UPDATE "Planes" SET
  nombre_publico  = 'Starter',
  precio_mensual  = 79000,
  precio_texto    = NULL,
  bullets_publico = '["Hasta 2 usuarios", "Ventas, Clientes, Inventario y Calculadora", "Soporte por WhatsApp"]'::jsonb,
  destacado       = false,
  visible_landing = true
WHERE id = 'basico';

UPDATE "Planes" SET
  nombre_publico  = 'Pro',
  precio_mensual  = 149000,
  precio_texto    = NULL,
  bullets_publico = '["Hasta 8 usuarios", "Todos los módulos operativos + Cotizador", "Finanzas y Dashboard 360°", "Soporte prioritario"]'::jsonb,
  destacado       = true,
  visible_landing = true
WHERE id = 'pro';

UPDATE "Planes" SET
  nombre_publico  = 'Empresarial',
  precio_mensual  = NULL,
  precio_texto    = 'A la medida',
  bullets_publico = '["Usuarios ilimitados", "Todos los módulos + Calendario de Contenido", "Onboarding acompañado"]'::jsonb,
  destacado       = false,
  visible_landing = true
WHERE id = 'empresarial';

-- El plan de prueba interno no se ofrece como tarjeta propia en la landing
-- (el CTA "Empieza gratis" ya cubre eso).
UPDATE "Planes" SET visible_landing = false WHERE id = 'trial';

-- Promoción activable de la landing — una sola fila (singleton), igual
-- patrón que PoliticaSuscripcion. SELECT público (contenido de marketing,
-- sin nada sensible); solo admin-empresas.js (service role) escribe.
CREATE TABLE IF NOT EXISTS "PromocionLanding" (
  id          INT PRIMARY KEY DEFAULT 1,
  activo      BOOLEAN NOT NULL DEFAULT false,
  badge_texto TEXT,
  titulo      TEXT,
  descripcion TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT promocion_landing_singleton CHECK (id = 1)
);
INSERT INTO "PromocionLanding" (id, activo) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE "PromocionLanding" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PromocionLanding_select_todos" ON "PromocionLanding";
CREATE POLICY "PromocionLanding_select_todos" ON "PromocionLanding" FOR SELECT USING (true);
-- Sin políticas de escritura a propósito: solo el superadmin vía
-- admin-empresas.js (service role, ignora RLS).
