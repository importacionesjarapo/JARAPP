-- Fase B (cont.) — Storage por tenant.
--
-- Hoy TODO (fotos de producto, logos y comprobantes de pago) vive junto en
-- un único bucket público "jarapo-images", sin carpetas — es decir, los
-- comprobantes de pago (dato financiero sensible) son públicamente
-- accesibles por URL directa. Este archivo crea los dos buckets nuevos y
-- sus políticas; NO mueve los archivos existentes (eso requiere un script
-- aparte con la service role key, ver nota al final).
--
-- Convención de rutas dentro de cada bucket: "<categoria>/<empresa_id>/...",
-- ej. "productos/<uuid>/foto.jpg", "logos/<uuid>/logo.png",
-- "comprobantes/<uuid>/comprobante.jpg" — por eso las políticas leen la
-- POSICIÓN 2 de storage.foldername(name) (posición 1 = la categoría).

INSERT INTO storage.buckets (id, name, public)
VALUES ('productos-publico', 'productos-publico', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes-privado', 'comprobantes-privado', false)
ON CONFLICT (id) DO NOTHING;

-- productos-publico: lectura abierta para cualquiera (necesario para el
-- portal de clientes y cotizaciones compartidas por link/WhatsApp), pero
-- la escritura sí queda restringida a la propia empresa.
DROP POLICY IF EXISTS "productos_publico_select" ON storage.objects;
CREATE POLICY "productos_publico_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'productos-publico');

DROP POLICY IF EXISTS "productos_publico_write" ON storage.objects;
CREATE POLICY "productos_publico_write" ON storage.objects
  FOR ALL
  USING     (bucket_id = 'productos-publico' AND (storage.foldername(name))[2] = current_empresa_id()::text)
  WITH CHECK(bucket_id = 'productos-publico' AND (storage.foldername(name))[2] = current_empresa_id()::text);

-- comprobantes-privado: bucket NO público. Solo la propia empresa puede
-- leer/escribir sus comprobantes; el frontend los sirve con
-- createSignedUrl() de corta duración, nunca con URL pública fija.
DROP POLICY IF EXISTS "comprobantes_privado_all" ON storage.objects;
CREATE POLICY "comprobantes_privado_all" ON storage.objects
  FOR ALL
  USING     (bucket_id = 'comprobantes-privado' AND (storage.foldername(name))[2] = current_empresa_id()::text)
  WITH CHECK(bucket_id = 'comprobantes-privado' AND (storage.foldername(name))[2] = current_empresa_id()::text);

-- ── Pendiente (no incluido aquí, requiere ejecución aparte) ────────────────
-- Migrar los objetos que ya existen en el bucket viejo "jarapo-images" hacia
-- los buckets nuevos, bajo el prefijo de Jarapo (empresa_id del Tenant #1),
-- separando por tipo (productos/logos → productos-publico,
-- comprobantes → comprobantes-privado). No es SQL puro: requiere listar +
-- descargar + subir + borrar vía la Storage API con la service role key.
-- Se hace en Fase C junto con el cambio de uploadImageToSupabase() para que
-- reciba empresa_id.
