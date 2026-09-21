/**
 * auth.js — Módulo de Autenticación y Control de Acceso (RBAC)
 * JARAPP 2026 · Supabase Auth + user_profiles
 */
import { createClient } from '@supabase/supabase-js';

// Permisos por defecto para cada rol predefinido
export const ROLE_TEMPLATES = {
  admin: {
    dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
    purchases: 'edit', logistics: 'edit', finance: 'edit', vendedores: 'edit', params: 'edit', documentacion: 'edit',
    calculadora: 'edit', admin: true, feat_money: true, feat_usa: true, feat_calc_desglose: true,
    cotizador_ver: true, cotizador_desglose: true, cotizador_pdf_cliente: true, cotizador_pdf_interno: true,
    calendario_ver: true, calendario_crear: true, calendario_editar: true, calendario_eliminar: true,
    calendario_plantilla_editar: true, calendario_fechas_editar: true,
  },
  gerente: {
    dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
    purchases: 'edit', logistics: 'edit', finance: 'edit', vendedores: 'edit', params: 'view', documentacion: 'edit',
    calculadora: 'edit', admin: false, feat_money: true, feat_usa: true, feat_calc_desglose: true,
    cotizador_ver: true, cotizador_desglose: true, cotizador_pdf_cliente: true, cotizador_pdf_interno: true,
    calendario_ver: true, calendario_crear: true, calendario_editar: true, calendario_eliminar: true,
    calendario_plantilla_editar: true, calendario_fechas_editar: true,
  },
  ventas: {
    dashboard: true, clients: 'edit', inventory: 'view', sales: 'edit',
    purchases: false, logistics: 'view', finance: false, vendedores: 'view', params: false, documentacion: 'view',
    calculadora: 'edit', admin: false, feat_money: false, feat_usa: false, feat_calc_desglose: false,
    cotizador_ver: true, cotizador_desglose: false, cotizador_pdf_cliente: true, cotizador_pdf_interno: false,
    calendario_ver: true, calendario_crear: false, calendario_editar: false, calendario_eliminar: false,
    calendario_plantilla_editar: false, calendario_fechas_editar: false,
  },
  logistica: {
    dashboard: true, clients: 'view', inventory: 'edit', sales: 'view',
    purchases: 'edit', logistics: 'edit', finance: false, vendedores: false, params: false, documentacion: 'view',
    calculadora: 'view', admin: false, feat_money: false, feat_usa: true, feat_calc_desglose: false,
    cotizador_ver: false, cotizador_desglose: false, cotizador_pdf_cliente: false, cotizador_pdf_interno: false,
    calendario_ver: false, calendario_crear: false, calendario_editar: false, calendario_eliminar: false,
    calendario_plantilla_editar: false, calendario_fechas_editar: false,
  },
  finanzas: {
    dashboard: true, clients: 'view', inventory: 'view', sales: 'view',
    purchases: 'view', logistics: 'view', finance: 'edit', vendedores: 'edit', params: false, documentacion: 'view',
    calculadora: 'view', admin: false, feat_money: true, feat_usa: false, feat_calc_desglose: true,
    cotizador_ver: false, cotizador_desglose: false, cotizador_pdf_cliente: false, cotizador_pdf_interno: false,
    calendario_ver: false, calendario_crear: false, calendario_editar: false, calendario_eliminar: false,
    calendario_plantilla_editar: false, calendario_fechas_editar: false,
  },
  viewer: {
    dashboard: true, clients: false, inventory: false, sales: false,
    purchases: false, logistics: false, finance: false, vendedores: false, params: false, documentacion: false,
    calculadora: false, admin: false, feat_money: false, feat_usa: false, feat_calc_desglose: false,
    cotizador_ver: false, cotizador_desglose: false, cotizador_pdf_cliente: false, cotizador_pdf_interno: false,
    calendario_ver: false, calendario_crear: false, calendario_editar: false, calendario_eliminar: false,
    calendario_plantilla_editar: false, calendario_fechas_editar: false,
  }
};

export const MODULE_LABELS = {
  dashboard: 'Dashboard', clients: 'Clientes', inventory: 'Inventario',
  sales: 'Ventas', purchases: 'Compras USA', documentacion: 'Documentación',
  cotizador_ver: 'Cotizador — Ver cotizaciones',
  cotizador_desglose: 'Cotizador — Ver desglose interno',
  cotizador_pdf_cliente: 'Cotizador — PDF Cliente',
  cotizador_pdf_interno: 'Cotizador — PDF Interno',
  logistics: 'Seguimientos', finance: 'Gastos y Finanzas', vendedores: 'Vendedores', params: 'Parametrización',
  calculadora: 'Calculadora de Precios', admin: 'Administración',
  feat_money: 'Ver Tarjetas de Dinero', feat_usa: 'Ver Submódulo EEUU',
  feat_calc_desglose: 'Ver Desglose en Calculadora',
  calendario_ver: 'Calendario de Contenido — Ver',
  calendario_crear: 'Calendario de Contenido — Crear',
  calendario_editar: 'Calendario de Contenido — Editar',
  calendario_eliminar: 'Calendario de Contenido — Eliminar',
  calendario_plantilla_editar: 'Calendario de Contenido — Editar Plantilla Semanal',
  calendario_fechas_editar: 'Calendario de Contenido — Editar Fechas Clave',
};

export const ROLE_LABELS = {
  admin: 'Administrador', gerente: 'Gerente', ventas: 'Ventas',
  logistica: 'Logística', finanzas: 'Finanzas', viewer: 'Solo Lectura',
  superadmin: 'Superadmin',
};

export const ROLE_COLORS = {
  admin: '#D91010', gerente: '#7C3AED', ventas: '#059669',
  logistica: '#2563EB', finanzas: '#D97706', viewer: '#64748B',
  superadmin: '#0E1420',
};

// Helper: promesa con timeout para evitar cuelgues infinitos
const withTimeout = (promise, ms = 10000, msg = 'Tiempo de espera agotado') =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);

// Perfil en memoria por defecto (fallback cuando la BD no responde)
const makeMemoryProfile = (session) => ({
  id: session.user.id,
  full_name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
  email: session.user.email,
  role: 'viewer',
  permissions: {
    dashboard: true, clients: false, inventory: false, sales: false,
    purchases: false, logistics: false, finance: false, params: false, admin: false
  },
  is_active: true,
  _isMemoryProfile: true
});

class Auth {
  constructor() {
    this._client = null;
    this._session = null;
    this._profile = null;
    this._listeners = [];
    this._empresa = null;
  }

  _getClient() {
    if (this._client) return this._client;
    const url = import.meta.env?.VITE_SUPABASE_URL || localStorage.getItem('JARAPO_SUPA_URL');
    const key = import.meta.env?.VITE_SUPABASE_KEY || localStorage.getItem('JARAPO_SUPA_KEY');
    if (!url || !key) return null;
    this._client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: -1 } },
    });
    return this._client;
  }

  /**
   * Único cliente de Supabase de toda la app — db.js y las vistas lo usan
   * en vez de crear el suyo propio. Antes db.js tenía su propia instancia
   * de createClient(), con su propio GoTrueClient en memoria: un login/
   * logout posterior actualizaba el cliente de Auth pero esa segunda
   * instancia se quedaba con el JWT de la sesión con la que se creó,
   * filtrando datos de esa sesión vieja a cualquier usuario que iniciara
   * sesión después en la misma pestaña. Con un solo cliente compartido eso
   * ya no puede pasar.
   */
  getClient() { return this._getClient(); }

  /** Fuerza que la próxima llamada a getClient() reconstruya el cliente con las credenciales actuales de localStorage/env (usado tras cambiar la conexión en Ajustes). */
  reconnect() { this._client = null; }

  /** Inicializa el módulo y verifica sesión activa */
  async init() {
    const client = this._getClient();
    if (!client) return { session: null, profile: null };

    try {
      const { data } = await withTimeout(
        client.auth.getSession(),
        8000,
        'Timeout al verificar sesión'
      );
      this._session = data.session;
      if (this._session) {
        await this._loadProfile();
      }
    } catch (e) {
      console.error('[Auth] init error:', e);
      this._session = null;
      this._profile = null;
    }

    // Listener de cambios de sesión
    client.auth.onAuthStateChange(async (event, session) => {
      // Solo actualizar sesión cuando cambia realmente (login/logout/refresh)
      if (event === 'SIGNED_OUT') {
        this._session = null;
        this._profile = null;
      } else if (session) {
        const currentUserId = this._profile?.id;
        const newUserId = session.user?.id;

        // Cambio real de identidad en esta pestaña: ya había un perfil
        // cargado (no es el primer login) y el usuario de la sesión nueva
        // es otro distinto. Pasa, por ejemplo, cuando en OTRA pestaña del
        // mismo sitio se inicia sesión con otra cuenta — Supabase comparte
        // la sesión vía localStorage entre pestañas y esta pestaña recibe
        // el cambio. Los módulos de vista cachean datos ya cargados en
        // variables de módulo que nunca se limpian solas (mismo motivo por
        // el que "Cerrar sesión" fuerza un reload) — sin esto, la pestaña
        // podía seguir mostrando datos reales de la empresa anterior
        // mezclados con los del usuario nuevo.
        if (this._profile && currentUserId && currentUserId !== newUserId) {
          window.location.reload();
          return;
        }

        this._session = session;
        // Solo recargar perfil si no lo tenemos ya, o si el usuario cambió
        if (!this._profile || currentUserId !== newUserId) {
          const loaded = await this._loadProfile();
          // Si falla la carga pero ya teníamos perfil previo, conservarlo
          if (!loaded && this._profile === null) {
            // No limpiar perfil existente — puede ser fallo de red temporal
          }
        }
        // En TOKEN_REFRESHED solo actualizar la sesión, no tocar el perfil
      }
      this._listeners.forEach(fn => fn(event, session, this._profile));
    });

    return { session: this._session, profile: this._profile };
  }

  /** Carga el perfil del usuario actual desde user_profiles */
  async _loadProfile() {
    const client = this._getClient();
    if (!client || !this._session) return null;

    const previousProfile = this._profile; // guardar copia antes de sobreescribir

    try {
      const { data, error } = await withTimeout(
        client
          .from('user_profiles')
          .select('*')
          .eq('id', this._session.user.id)
          .maybeSingle(),
        8000,
        'Timeout al cargar perfil de usuario'
      );

      if (error) {
        console.error('[Auth] _loadProfile error:', error.message, error.code);
        // Preservar perfil anterior si ya teníamos uno — no degradar permisos por error de red
        if (previousProfile) {
          console.warn('[Auth] Conservando perfil en caché por error temporal.');
          return previousProfile;
        }
        this._profile = null;
      } else if (data) {
        this._profile = data;
      } else {
        // No hay fila en user_profiles — solo limpiar si no teníamos perfil previo
        if (!previousProfile) this._profile = null;
        else {
          console.warn('[Auth] Sin fila en user_profiles; manteniendo perfil en caché.');
        }
      }
    } catch (e) {
      console.error('[Auth] _loadProfile exception:', e.message);
      // Preservar perfil anterior ante fallos de red/timeout
      if (previousProfile) {
        console.warn('[Auth] Conservando perfil en caché tras excepción.');
        return previousProfile;
      }
      this._profile = null;
    }
    return this._profile;
  }

  /**
   * Fila de "Empresas" del tenant actual (nombre, logo, estado_suscripcion).
   * null para superadmin (no tiene empresa) o si aún no hay perfil cargado.
   * Se cachea en memoria durante la sesión — se limpia en logout().
   */
  async getEmpresa() {
    if (!this.getEmpresaId()) return null;
    if (this._empresa && this._empresa.id === this.getEmpresaId()) return this._empresa;

    const client = this._getClient();
    if (!client) return null;
    try {
      const { data, error } = await withTimeout(
        client.from('Empresas').select('*').eq('id', this.getEmpresaId()).maybeSingle(),
        8000, 'Timeout al cargar la empresa'
      );
      if (error) { console.error('[Auth] getEmpresa error:', error.message); return null; }
      this._empresa = data;
      return data;
    } catch (e) {
      console.error('[Auth] getEmpresa exception:', e.message);
      return null;
    }
  }

  /** Login con email y password */
  async login(email, password) {
    const client = this._getClient();
    if (!client) throw new Error('Supabase no configurado. Ve a Configuración primero.');

    // ── Paso 1: Autenticar ────────────────────────────────
    const authResult = await withTimeout(
      client.auth.signInWithPassword({ email, password }),
      12000,
      'Tiempo de espera agotado. Verifica tu conexión a internet.'
    );
    if (authResult.error) throw new Error(this._translateError(authResult.error.message));
    this._session = authResult.data.session;

    // ── Paso 2: Cargar perfil ─────────────────────────────
    await this._loadProfile();

    // ── Paso 3: Si no hay perfil, intentar crearlo ────────
    if (!this._profile) {
      console.warn('[Auth] Perfil no encontrado. Intentando upsert...');
      try {
        await withTimeout(
          client.from('user_profiles').upsert({
            id: this._session.user.id,
            full_name: this._session.user.user_metadata?.full_name
                       || this._session.user.email.split('@')[0],
            email: this._session.user.email,
            role: 'viewer',
            permissions: {
              dashboard: true, clients: false, inventory: false, sales: false,
              purchases: false, logistics: false, finance: false, params: false, admin: false
            },
            is_active: true
          }, { onConflict: 'id' }),
          5000,
          'Timeout al crear perfil'
        );
        // Recargar tras upsert
        await this._loadProfile();
      } catch (e) {
        console.warn('[Auth] Upsert falló:', e.message);
      }
    }

    // ── Paso 4: Fallback en memoria si la BD no coopera ───
    if (!this._profile) {
      console.warn('[Auth] Usando perfil en memoria (sin persistencia en BD).');
      this._profile = makeMemoryProfile(this._session);
    }

    // ── Paso 5: Verificar cuenta activa ───────────────────
    if (!this._profile.is_active && this._profile.role !== 'admin') {
      await client.auth.signOut();
      this._session = null;
      this._profile = null;
      throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
    }

    // ── Registro de Logueo ────────────────────────────────
    // Va después de resolver el perfil porque empresa_id es NOT NULL en
    // login_logs (RLS exige empresa_id = current_empresa_id()). Si por algún
    // caso borde no hay empresa (perfil huérfano en memoria), se omite el
    // registro en vez de forzar un insert que la BD va a rechazar.
    if (this.getEmpresaId()) {
      try {
        await client.from('login_logs').insert({
          user_id: this._session.user.id,
          email: this._session.user.email,
          empresa_id: this.getEmpresaId(),
        });
      } catch (e) {
        console.warn('[Auth] Error registrando log de logueo:', e.message);
      }
    }

    return { session: this._session, profile: this._profile };
  }

  /** Logout */
  async logout() {
    const client = this._getClient();
    try {
      if (client) await withTimeout(client.auth.signOut(), 5000);
    } catch (_) { /* no bloquear el logout */ }
    this._session = null;
    this._profile = null;
    this._empresa = null;
  }

  /** Crear nuevo usuario (solo admin puede hacer esto desde el panel) */
  async createUser(email, password, fullName, role, permissions) {
    const client = this._getClient();
    if (!client) throw new Error('Supabase no configurado.');
    if (!this.isAdmin()) throw new Error('Solo el administrador puede crear usuarios.');

    // 1. Validar que el correo no exista ya
    const { data: existingUser } = await client
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      throw new Error('El correo electrónico ya está vinculado a un usuario existente.');
    }

    // 2. Crear un cliente temporal sin persistir sesión para no desloguear al admin
    const url = import.meta.env?.VITE_SUPABASE_URL || localStorage.getItem('JARAPO_SUPA_URL');
    const key = import.meta.env?.VITE_SUPABASE_KEY || localStorage.getItem('JARAPO_SUPA_KEY');
    const tempClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await withTimeout(
      tempClient.auth.signUp({
        email, 
        password,
        options: {
          data: { full_name: fullName }
        }
      }),
      15000, 'Timeout al crear usuario'
    );

    if (error) throw new Error(this._translateError(error.message));
    if (!data.user) throw new Error('No se pudo crear el usuario.');

    const { error: profileError } = await withTimeout(
      client.from('user_profiles').upsert({
        id: data.user.id, full_name: fullName, email,
        role, permissions, is_active: true,
        empresa_id: this.getEmpresaId(),
      }, { onConflict: 'id' }),
      8000, 'Timeout al guardar perfil'
    );

    if (profileError) throw new Error(profileError.message);
    return data.user;
  }

  /** Obtener todos los usuarios (solo admin) */
  async getAllUsers() {
    const client = this._getClient();
    if (!client) throw new Error('Supabase no configurado.');
    const { data, error } = await withTimeout(
      client.from('user_profiles').select('*').order('created_at', { ascending: true }),
      10000, 'Timeout al cargar usuarios'
    );
    if (error) throw new Error(error.message);
    return data || [];
  }

  /** Actualizar perfil de un usuario */
  async updateUserProfile(userId, updates) {
    const client = this._getClient();
    if (!client) throw new Error('Supabase no configurado.');
    if (!this.isAdmin()) throw new Error('Solo el administrador puede editar usuarios.');
    const { error } = await withTimeout(
      client.from('user_profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', userId),
      8000, 'Timeout al actualizar usuario'
    );
    if (error) throw new Error(error.message);
  }

  /** Toggle activar/desactivar usuario */
  async toggleUserActive(userId, isActive) {
    await this.updateUserProfile(userId, { is_active: isActive });
  }

  /** Restablecer contraseña */
  async resetUserPassword(userId, newPassword) {
    const client = this._getClient();
    if (!client) throw new Error('Supabase no configurado.');
    if (!this.isAdmin()) throw new Error('Solo el administrador puede hacer esto.');
    
    // NOTA: No podemos usar client.auth.admin.updateUserById en el frontend
    // porque requiere la Service Role Key de Supabase (por seguridad, el frontend solo tiene la Anon Key).
    // Usaremos un RPC (Procedimiento Almacenado) que se ejecutará del lado del servidor.
    const { error } = await withTimeout(
      client.rpc('admin_reset_password', { target_user_id: userId, new_password: newPassword }),
      10000, 'Timeout al cambiar contraseña'
    );
    if (error) throw new Error(this._translateError(error.message));
  }

  // ── Accessors ──────────────────────────────────────────
  getSession() { return this._session; }
  getProfile() { return this._profile; }
  isAuthenticated() { return !!this._session && !!this._profile; }
  isAdmin() { return this._profile?.role === 'admin'; }
  isSuperadmin() { return this._profile?.role === 'superadmin'; }
  getUserRole() { return this._profile?.role || 'viewer'; }
  getUserName() { return this._profile?.full_name || 'Usuario'; }
  getUserEmail() { return this._profile?.email || this._session?.user?.email || ''; }
  /** empresa_id del tenant actual — null para superadmin, que no pertenece a ninguna empresa */
  getEmpresaId() { return this._profile?.empresa_id || null; }

  canAccess(module) {
    if (!this._profile || !this._profile.is_active) return false;
    // El módulo 'superadmin' es exclusivo de ese rol — ni siquiera el admin
    // de una empresa normal debe verlo (si no, el bypass de admin de abajo
    // le daría acceso al panel cross-tenant).
    if (module === 'superadmin') return this._profile.role === 'superadmin';
    // Superadmin no opera ningún módulo de negocio — solo el panel de Fase D
    if (this._profile.role === 'superadmin') return false;
    // OJO: a propósito NO hay un atajo "role==='admin' => true" acá. Un
    // admin de trial también tiene role='admin', y sus permisos vienen
    // deliberadamente acotados por PoliticaTrial (netlify/functions/
    // admin-empresas.js, crear_empresa_trial) — un bypass por rol anularía
    // esa restricción y le daría acceso total a cualquier cuenta de prueba.
    // El admin de una empresa paga sigue teniendo acceso total porque su
    // `permissions` ya se guarda igual a ROLE_TEMPLATES.admin (ver
    // ADMIN_PERMISSIONS en admin-empresas.js), así que el fallback de abajo
    // produce el mismo resultado sin necesitar el atajo.
    // Resolver permisos: preferir los guardados en BD, si no usar el template del rol
    const storedPerms = this._profile.permissions;
    const hasStoredPerms = storedPerms && typeof storedPerms === 'object' && Object.keys(storedPerms).length > 0;
    const perms = hasStoredPerms ? storedPerms : (ROLE_TEMPLATES[this._profile.role] || {});
    const perm = perms[module];
    return perm === true || perm === 'view' || perm === 'edit';
  }

  canEdit(module) {
    if (!this._profile || !this._profile.is_active) return false;
    if (module === 'superadmin') return this._profile.role === 'superadmin';
    if (this._profile.role === 'superadmin') return false;
    // Ver el comentario equivalente en canAccess() — mismo motivo para no
    // tener un atajo "role==='admin' => true" acá.
    // Resolver permisos: preferir los guardados en BD, si no usar el template del rol
    const storedPerms = this._profile.permissions;
    const hasStoredPerms = storedPerms && typeof storedPerms === 'object' && Object.keys(storedPerms).length > 0;
    const perms = hasStoredPerms ? storedPerms : (ROLE_TEMPLATES[this._profile.role] || {});
    const perm = perms[module];
    return perm === true || perm === 'edit';
  }

  onAuthChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _translateError(msg) {
    const map = {
      'Invalid login credentials': 'Credenciales incorrectas. Verifica tu email y contraseña.',
      'Email not confirmed': 'Email no confirmado. Contacta al administrador.',
      'User already registered': 'El email ya está registrado.',
      'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.',
      'Unable to validate email address: invalid format': 'Formato de email inválido.',
      'signup is disabled': 'El registro público está deshabilitado.',
      'User not allowed': 'No tienes permisos para esta operación.',
    };
    return map[msg] || msg;
  }
}

export const auth = new Auth();
export default auth;
