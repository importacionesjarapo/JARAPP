-- Fecha en la que se notificó al cliente que su pedido llegó a Bodega Colombia.
-- Se usa en Seguimientos → fase "5. En Bodega Colombia" para filtrar
-- notificados/no notificados y calcular los días transcurridos desde el aviso.
ALTER TABLE "Logistica" ADD COLUMN IF NOT EXISTS col_fecha_notificacion date;
