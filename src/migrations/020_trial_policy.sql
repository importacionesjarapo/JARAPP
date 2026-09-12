-- Fase E (self-serve trial): política global de prueba gratis, configurada
-- por el superadmin desde el panel — cuántos días dura y qué módulos vienen
-- habilitados para cualquiera que se registre solo desde la landing.
--
-- Es una fila única y GLOBAL (no por empresa, por eso no lleva empresa_id ni
-- sigue el patrón de Configuracion). Se protege con RLS sin ninguna política
-- — así ni el rol anon ni authenticated pueden leerla/escribirla directo;
-- solo la Netlify Function admin-empresas.js con la service role key (que
-- ignora RLS) puede tocarla.
CREATE TABLE IF NOT EXISTS "PoliticaTrial" (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dias_prueba           INT NOT NULL DEFAULT 7 CHECK (dias_prueba > 0),
  modulos_habilitados   JSONB NOT NULL DEFAULT '{
    "dashboard": true, "clients": "edit", "inventory": "edit", "sales": "edit"
  }'::jsonb,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO "PoliticaTrial" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE "PoliticaTrial" ENABLE ROW LEVEL SECURITY;
