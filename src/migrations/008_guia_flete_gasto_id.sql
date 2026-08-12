-- Vincula cada guía internacional con el Gasto que se creó automáticamente al
-- registrar su "Costo Guía/Flete (USD/COP)" en la fase "4. Tránsito Internacional /
-- Aduana". El gasto se registra UNA sola vez por guía (no por cada producto
-- consolidado en ella): si el valor se edita después, se actualiza ese mismo Gasto
-- en vez de crear uno nuevo cada vez que se guarda el formulario.
ALTER TABLE "GuiasInternacionales" ADD COLUMN IF NOT EXISTS gasto_id text;
