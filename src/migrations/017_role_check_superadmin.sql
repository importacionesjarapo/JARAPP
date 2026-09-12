-- El CHECK constraint de user_profiles.role (preexistente, de antes de este
-- proyecto, no vive en ninguna migración anterior de este repo) no incluía
-- 'superadmin' como valor válido — bloqueaba el UPDATE para crear el primer
-- superadmin (Fase D). Se recrea incluyéndolo.
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'gerente', 'ventas', 'logistica', 'finanzas', 'viewer', 'superadmin'));
