-- La integración de Kommo (Parámetros → Integraciones) es algo muy propio
-- de cómo trabaja Importaciones Jarapo hoy — no sabemos qué integraciones
-- maneja cada empresa nueva, así que por ahora queda oculta para todas y
-- el superadmin la habilita empresa por empresa desde su panel.
ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS integraciones_habilitadas boolean NOT NULL DEFAULT false;

-- Importaciones Jarapo (Tenant #1) ya usa esta integración en producción.
UPDATE "Empresas" SET integraciones_habilitadas = true WHERE slug = 'jarapo';
