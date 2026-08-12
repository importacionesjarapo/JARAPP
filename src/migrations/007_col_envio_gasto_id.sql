-- Vincula cada registro de Logistica con el Gasto que se creó automáticamente al
-- registrar el "Valor Envío Local (COP)" en la fase "6. Entregado a Cliente Final".
-- Permite que, si el valor se edita después, se actualice ese mismo Gasto en vez
-- de crear uno nuevo cada vez que se guarda el formulario.
ALTER TABLE "Logistica" ADD COLUMN IF NOT EXISTS col_envio_gasto_id text;
