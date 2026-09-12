-- Fase B (fix): fuga real de datos entre empresas confirmada por
-- diagnóstico — varias tablas se quedaron con políticas PERMISSIVE de
-- antes del multi-tenant (ej. "Allow all on Abonos", "Public Access for
-- Compras", "Lectura libre cuentas_tracker") que la migración 014 nunca
-- llegó a borrar porque sus nombres no seguían el patrón "<tabla>_all"
-- que ese script buscaba.
--
-- En Postgres, cuando una tabla tiene varias políticas PERMISSIVE para el
-- mismo comando, se combinan con OR. Eso significa que la política nueva
-- "<tabla>_empresa_isolation" (empresa_id = current_empresa_id()) queda
-- completamente anulada por cualquier política vieja con USING(true) —
-- cualquier fila cumple con AL MENOS UNA de las dos, así que se ve. Por
-- eso Ventas/Clientes/Productos/Logistica (sin política vieja) quedaban
-- bien aisladas, pero Compras/Gastos/Abonos/MetodosPago/
-- ContenidoCalendario/MetasDashboard/cuentas_tracker/posts_tracker/
-- recreaciones_tracker/scraping_logs/posts_descartados_permanente/
-- snapshot_metricas seguían mostrando datos de todas las empresas.
--
-- Aparte: user_profiles tenía 4 políticas heredadas (read_policy,
-- insert_policy, update_policy, delete_policy) basadas en is_admin(),
-- una función vieja que solo verifica el rol y NUNCA compara empresa_id
-- -cualquier admin de cualquier empresa podía leer/crear/editar/borrar
-- usuarios de CUALQUIER otra empresa a través de esas políticas, aunque
-- ya existieran las nuevas user_profiles_* correctamente aisladas por
-- empresa_id. Se borran también. Mismo problema en login_logs
-- ("admin_all").
--
-- Idempotente: DROP POLICY IF EXISTS no falla si ya no existen.
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Allow all on Abonos" ON "Abonos"';
  EXECUTE 'DROP POLICY IF EXISTS "Public Access for Compras" ON "Compras"';
  EXECUTE 'DROP POLICY IF EXISTS "Public Access for Gastos" ON "Gastos"';
  EXECUTE 'DROP POLICY IF EXISTS "allow_all_metodos_pago" ON "MetodosPago"';
  EXECUTE 'DROP POLICY IF EXISTS "ContenidoCalendario_select" ON "ContenidoCalendario"';
  EXECUTE 'DROP POLICY IF EXISTS "MetasDashboard_select" ON "MetasDashboard"';
  EXECUTE 'DROP POLICY IF EXISTS "Lectura libre cuentas_tracker" ON "cuentas_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Acceso libre posts_descartados_permanente" ON "posts_descartados_permanente"';

  EXECUTE 'DROP POLICY IF EXISTS "Actualizar posts_tracker" ON "posts_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Eliminar posts_tracker" ON "posts_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Insertar posts_tracker" ON "posts_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Lectura libre posts_tracker" ON "posts_tracker"';

  EXECUTE 'DROP POLICY IF EXISTS "Actualizar recreaciones_tracker" ON "recreaciones_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Eliminar recreaciones_tracker" ON "recreaciones_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Insertar recreaciones_tracker" ON "recreaciones_tracker"';
  EXECUTE 'DROP POLICY IF EXISTS "Lectura libre recreaciones_tracker" ON "recreaciones_tracker"';

  EXECUTE 'DROP POLICY IF EXISTS "Actualizar scraping_logs" ON "scraping_logs"';
  EXECUTE 'DROP POLICY IF EXISTS "Insertar scraping_logs" ON "scraping_logs"';
  EXECUTE 'DROP POLICY IF EXISTS "Lectura libre scraping_logs" ON "scraping_logs"';

  EXECUTE 'DROP POLICY IF EXISTS "Acceso libre snapshot_metricas" ON "snapshot_metricas"';
  EXECUTE 'DROP POLICY IF EXISTS "Eliminar snapshot_metricas" ON "snapshot_metricas"';

  EXECUTE 'DROP POLICY IF EXISTS "read_policy" ON "user_profiles"';
  EXECUTE 'DROP POLICY IF EXISTS "insert_policy" ON "user_profiles"';
  EXECUTE 'DROP POLICY IF EXISTS "update_policy" ON "user_profiles"';
  EXECUTE 'DROP POLICY IF EXISTS "delete_policy" ON "user_profiles"';

  EXECUTE 'DROP POLICY IF EXISTS "admin_all" ON "login_logs"';
END $$;
