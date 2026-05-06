/**
 * auth.js — Módulo de Autenticación y Control de Acceso (RBAC)
 * JARAPP 2026 · Supabase Auth + user_profiles
 */
import { createClient } from '@supabase/supabase-js';

// Permisos por defecto para cada rol predefinido
export const ROLE_TEMPLATES = {
  admin: {
    dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
    purchases: 'edit', logistics: 'edit', finance: 'edit', params: 'edit',
    calculadora: 'edit', admin: true, feat_money: true, feat_usa: true
  },
  gerente: {
    dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
    purchases: 'edit', logistics: 'edit', finance: 'edit', params: 'view',
    calculadora: 'edit', admin: false, feat_money: true, feat_usa: true
  },
  ventas: {
    dashboard: true, clients: 'edit', inventory: 'view', sales: 'edit',
    purchases: false, logistics: 'view', finance: false, params: false,
    calculadora: 'edit', admin: false, feat_money: false, feat_usa: false
  },
  logistica: {
    dashboard: true, clients: 'view', inventory: 'edit', sales: 'view',
    purchases: 'edit', logistics: 'edit', finance: false, params: false,
    calculadora: 'view', admin: false, feat_money: false, feat_usa: true
  },
  finanzas: {
    dashboard: true, clients: 'view', inventory: 'view', sales: 'view',
    purchases: 'view', logistics: 'view', finance: 'edit', params: false,
    calculadora: 'view', admin: false, feat_money: true, feat_usa: false
  },
  viewer: {
    dashboard: true, clients: false, inventory: false, sales: false,
    purchases: false, logistics: false, finance: false, params: false,
    calculadora: false, admin: false, feat_money: false, feat_usa: false
  }
};

export const MODULE_LABELS = {
  dashboard: 'Dashboard', clients: 'Clientes', inventory: 'Inventario',
  sales: 'Ventas', purchases: 'Compras USA', logistics: 'Seguimientos',
  finance: 'Gastos y Finanzas', params: 'Parametrización',
  calculadora: 'Calculadora de Precios', admin: 'Administración',
  feat_money: 'Ver Tarjetas de Dinero', feat_usa: 'Ver Submódulo EEUU'
};

export const ROLE_LABELS = {
  admin: 'Administrador', gerente: 'Gerente', ventas: 'Ventas',
  logistica: 'Logística', finanzas: 'Finanzas', viewer: 'Solo Lectura'
};

export const ROLE_COLORS = {
  admin: '#D91010', gerente: '#7C3AED', ventas: '#059669',
  logistica: '#2563EB', finanzas: '#D97706', viewer: '#64748B'
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
  }

  _getClient() {
    if (this._client) return this._client;
    const url = import.meta.env?.VITE_SUPABASE_URL || localStorage.getItem('JARAPO_SUPA_URL');
    const key = import.meta.env?.VITE_SUPABASE_KEY || localStorage.getItem('JARAPO_SUPA_KEY');
    if (!url || !key) return null;
    this._client = createClient(url, key);
    return this._client;
  }

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
        this._session = session;
        // Solo recargar perfil si no lo tenemos ya, o si el usuario cambió
        const currentUserId = this._profile?.id;
        const newUserId = session.user?.id;
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

    // ── Registro de Logueo ────────────────────────────────
    try {
      await client.from('login_logs').insert({
        user_id: this._session.user.id,
        email: this._session.user.email
      });
    } catch (e) {
      console.warn('[Auth] Error registrando log de logueo:', e.message);
    }

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
        role, permissions, is_active: true
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
  getUserRole() { return this._profile?.role || 'viewer'; }
  getUserName() { return this._profile?.full_name || 'Usuario'; }
  getUserEmail() { return this._profile?.email || this._session?.user?.email || ''; }

  canAccess(module) {
    if (!this._profile || !this._profile.is_active) return false;
    // Admin siempre tiene acceso total
    if (this._profile.role === 'admin') return true;
    // Resolver permisos: preferir los guardados en BD, si no usar el template del rol
    const storedPerms = this._profile.permissions;
    const hasStoredPerms = storedPerms && typeof storedPerms === 'object' && Object.keys(storedPerms).length > 0;
    const perms = hasStoredPerms ? storedPerms : (ROLE_TEMPLATES[this._profile.role] || {});
    const perm = perms[module];
    return perm === true || perm === 'view' || perm === 'edit';
  }

  canEdit(module) {
    if (!this._profile || !this._profile.is_active) return false;
    // Admin siempre puede editar
    if (this._profile.role === 'admin') return true;
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
