-- Correo electrónico opcional del cliente — se usará más adelante para
-- enviarle notificaciones (confirmación de pedido, estado logístico, etc.).
ALTER TABLE "Clientes" ADD COLUMN IF NOT EXISTS email text;
