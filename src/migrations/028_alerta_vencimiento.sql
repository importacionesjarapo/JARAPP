-- Fase 3 (#13): alerta de vencimiento de trial/suscripción por correo.
-- Guarda para qué fecha_vencimiento ya se envió el aviso, para que la
-- función programada (netlify/functions/alertas-vencimiento.js, corre a
-- diario) no reenvíe el mismo correo cada día durante toda la ventana de
-- aviso (5 días) — solo una vez por ciclo. Si la empresa renueva y
-- fecha_vencimiento cambia, el aviso vuelve a poder dispararse para la
-- nueva fecha.
ALTER TABLE "Empresas" ADD COLUMN IF NOT EXISTS alerta_vencimiento_enviada_para DATE;
