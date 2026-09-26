-- Distingue, para ventas de tipo Encargo, si se compró durante un viaje de
-- encargos a EEUU (el viajero la trae en la maleta) o si se compró en una
-- tienda online de USA (encargo web). El checkbox "Comprado en viaje de
-- encargos (EEUU)" ya existía en el formulario de Ventas pero su valor
-- nunca se guardaba — solo se usaba para hacer opcionales algunos campos.
ALTER TABLE "Ventas" ADD COLUMN IF NOT EXISTS comprado_en_viaje boolean NOT NULL DEFAULT false;
