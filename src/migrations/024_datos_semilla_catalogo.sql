-- Fase 5 (#27): catálogo de datos semilla editable desde Superadmin, en vez
-- de quedar fijo en el código de netlify/functions/admin-empresas.js. Cada
-- fila es un valor sugerido que se copia a una empresa nueva al registrarse:
--   - categoria = 'MetodosPago' -> se inserta en la tabla "MetodosPago".
--   - categoria = 'Marca' | 'Tienda' | 'Categoria' | 'Genero' -> se inserta
--     en "Configuracion" con clave = categoria (mismas claves que ya usa
--     Parametrización en src/views/params.js para esas listas desplegables).
-- RLS sin políticas: solo la Netlify Function (service role) la lee/escribe,
-- igual que "PagosSuscripciones" — no hace falta que el cliente la consulte.
CREATE TABLE IF NOT EXISTS "DatosSemillaGlobal" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria   TEXT NOT NULL CHECK (categoria IN ('MetodosPago', 'Marca', 'Tienda', 'Categoria', 'Genero')),
  valor       TEXT NOT NULL,
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (categoria, valor)
);
ALTER TABLE "DatosSemillaGlobal" ENABLE ROW LEVEL SECURITY;

-- Semilla inicial — el superadmin la ajusta libremente desde el panel
-- ("🌱 Datos semilla") sin necesidad de tocar código nunca más.
INSERT INTO "DatosSemillaGlobal" (categoria, valor, orden) VALUES
  ('MetodosPago', 'Efectivo', 0),
  ('MetodosPago', 'Transferencia', 1),
  ('MetodosPago', 'Nequi', 2),
  ('MetodosPago', 'Daviplata', 3),
  ('MetodosPago', 'Zelle', 4),
  ('MetodosPago', 'PayPal', 5),
  ('Tienda', 'Nike.com', 0),
  ('Tienda', 'Amazon', 1),
  ('Tienda', 'FootLocker', 2),
  ('Tienda', 'Sephora', 3),
  ('Tienda', 'Ulta Beauty', 4),
  ('Tienda', 'Ross', 5),
  ('Tienda', 'Marshalls', 6),
  ('Tienda', 'TJ Maxx', 7),
  ('Tienda', 'Walmart', 8),
  ('Tienda', 'Target', 9),
  ('Tienda', 'Best Buy', 10),
  ('Marca', 'Nike', 0),
  ('Marca', 'Adidas', 1),
  ('Marca', 'Tommy Hilfiger', 2),
  ('Marca', 'Under Armour', 3),
  ('Marca', 'New Balance', 4),
  ('Marca', 'Puma', 5),
  ('Marca', 'Levi''s', 6),
  ('Marca', 'Calvin Klein', 7),
  ('Marca', 'Ralph Lauren', 8),
  ('Marca', 'Skechers', 9),
  ('Categoria', 'Calzado', 0),
  ('Categoria', 'Ropa', 1),
  ('Categoria', 'Accesorios', 2),
  ('Categoria', 'Tecnología', 3),
  ('Categoria', 'Perfumería', 4),
  ('Categoria', 'Suplementos y Vitaminas', 5),
  ('Genero', 'Hombre', 0),
  ('Genero', 'Mujer', 1),
  ('Genero', 'Unisex', 2),
  ('Genero', 'Niño', 3),
  ('Genero', 'Niña', 4)
ON CONFLICT (categoria, valor) DO NOTHING;
