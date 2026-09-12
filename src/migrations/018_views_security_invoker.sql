-- Fase B (fix): las vistas ventas_con_cliente / egresos_view /
-- ventas_finanzas_view (usadas por sales.js, finance.js y vendedores.js)
-- no están en ninguna migración de este repo — se crearon a mano en algún
-- momento anterior desde el editor SQL de Supabase, lo que en Postgres las
-- deja con el dueño = el rol superusuario del editor.
--
-- Por defecto, una vista aplica las políticas RLS de las tablas que
-- consulta usando los privilegios de QUIEN CREÓ LA VISTA, no de quien la
-- consulta — así que aunque "Ventas"/"Gastos"/etc. tengan RLS perfecto
-- (confirmado por separado), estas 3 vistas lo estaban esquivando por
-- completo y devolviendo filas de TODAS las empresas a cualquier usuario
-- autenticado. security_invoker=true (Postgres 15+, disponible en
-- Supabase) hace que la vista respete el RLS del usuario que consulta.
--
-- Idempotente: si alguna vista no existe todavía en este proyecto, se
-- omite en vez de fallar.
DO $$
DECLARE
  v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'ventas_con_cliente', 'egresos_view', 'ventas_finanzas_view'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v
    ) THEN
      EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;
