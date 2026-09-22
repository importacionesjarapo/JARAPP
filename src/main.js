import './style.css';
import { db } from './db.js';
import { auth, ROLE_LABELS, ROLE_COLORS, MODULE_LABELS } from './auth.js';
import { createIcons, LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText, Sparkles, PanelLeftOpen, TrendingUp, Calendar, Lock } from 'lucide';

// Importación de módulos refactorizados
import { renderDashboard } from './views/dashboard.js';
import { renderClients, createClientModal } from './views/clients.js';
import { renderInventory, createProductModal } from './views/inventory.js';
import { renderSettingsView } from './views/settings.js';
import { renderSales, createSaleModal, openSaleDetailModal, openAbonoModal } from './views/sales.js';
import { renderPurchases, createPurchaseModal } from './views/purchases.js';
import { renderFinance, createFinanceModal } from './views/finance.js';
import { renderLogistics, createLogisticsModal } from './views/logistics.js';
import { renderParams } from './views/params.js';
import { renderCalculadora } from './views/calculadora.js';
import { renderLogin } from './views/login.js';
import { renderAdmin } from './views/admin.js';
import { renderViaje } from './views/viaje.js';
import { renderCotizador } from './views/cotizador.js';
import { renderDocumentacion } from './views/documentacion.js';
import { renderTracker } from './views/tracker.js';
import { renderVendedores } from './views/vendedores.js';
import { renderCalendarioContenido } from './views/calendario.js';
import { renderSuperadmin } from './views/superadmin.js';
import { TRMService } from './services/trm.js';
import { ConfigService } from './services/config.js';
import { AlertasService } from './services/alertas.js';
import { initJaraBot } from './components/jarabot.js';

// Init theme instantly to prevent flashing
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

window.auth = auth;
/**
 * EncargosPro - Aplicación Operativa (v3.0.0 · Auth + RBAC)
 */

const mainAppContent = document.querySelector('#app');

const state = {
  currentView: 'dashboard',
  // Siempre conectado — credenciales embebidas en db.js como fallback
  get isLoggedIn() { return true; }
};

let _uiListenersInit = false;

// ── Nav agrupado en 3 secciones ──
const NAV_GROUPS = [
  {
    label: 'Operaciones',
    items: [
      { view: 'dashboard',   icon: 'layout-dashboard', label: 'Dashboard',    module: 'dashboard'   },
      { view: 'inventory',   icon: 'package',           label: 'Inventario',   module: 'inventory'   },
      { view: 'sales',       icon: 'shopping-cart',     label: 'Ventas',       module: 'sales'       },
      { view: 'cotizador',   icon: 'file-text',         label: 'Cotizador',    module: 'cotizador_ver' },
      { view: 'purchases',   icon: 'globe',             label: 'Compras USA',  module: 'purchases'   },
      { view: 'logistics',   icon: 'truck',             label: 'Seguimientos', module: 'logistics'   },
      { view: 'viaje',       icon: 'plane',             label: 'Viaje EEUU',   module: null, planModule: 'viaje', roleOnly: ['admin','gerente'] },
      { view: 'tracker',     icon: 'trending-up',       label: 'Competitor Tracker', module: null, planModule: 'tracker', roleOnly: ['admin','gerente'] },
    ]
  },
  {
    label: 'Gestión',
    items: [
      { view: 'clients',     icon: 'users',             label: 'Clientes',     module: 'clients'     },
      { view: 'finance',     icon: 'activity',          label: 'Finanzas',     module: 'finance'     },
      { view: 'vendedores',  icon: 'user-circle',       label: 'Vendedores',   module: 'vendedores'  },
      { view: 'calculadora', icon: 'calculator',        label: 'Calculadora',  module: 'calculadora' },
      { view: 'calendario',  icon: 'calendar',          label: 'Calendario de Contenido', module: 'calendario_ver' },
    ]
  },
  {
    label: 'Sistema',
    items: [
      { view: 'params',        icon: 'settings-2',        label: 'Parámetros',   module: 'params'        },
      { view: 'documentacion', icon: 'book-open',         label: 'Documentación',module: 'documentacion' },
      { view: 'admin',         icon: 'shield',            label: 'Admin',        module: null, planModule: 'admin', adminOnly: true },
      { view: 'settings',      icon: 'settings',          label: 'Configuración',module: null, superadminOnly: true },
      { view: 'superadmin',    icon: 'shield',            label: 'Empresas',     module: 'superadmin' },
    ]
  }
];

const logoUrl = () => localStorage.getItem('GLOBAL_LOGO_URL') || '/logo.png';

// Contador de alertas danger para el badge del sidebar
let _dangerAlertCount = 0;

// Actualiza el badge sin forzar re-render del layout completo
window._actualizarBadgeAlertas = () => {
  const badge = document.getElementById('sidebar-alert-badge-dashboard');
  if (badge) {
    badge.textContent = _dangerAlertCount;
    badge.style.display = _dangerAlertCount > 0 ? 'inline-flex' : 'none';
  }
};

// Actualiza el badge "ACTIVO" del ítem Viaje EEUU en el sidebar
window._actualizarBadgeViaje = (viajeActivo) => {
  const viajeItem = document.querySelector('[data-view="viaje"]');
  if (!viajeItem) return;
  viajeItem.querySelector('.viaje-badge')?.remove();
  if (viajeActivo) {
    viajeItem.style.position = 'relative';
    viajeItem.insertAdjacentHTML('beforeend', `
      <span class="viaje-badge" style="
        position:absolute;top:50%;right:8px;transform:translateY(-50%);
        background:#06D6A0;color:white;
        font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;
        letter-spacing:0.04em;pointer-events:none;
      ">ACTIVO</span>
    `);
  }
};

// ── renderLayout (con filtrado de nav por permisos) ──────────────
export const renderLayout = (contentHTML) => {
  // Fast path: sidebar ya renderizado — solo actualizar contenido y estado activo
  const existingView = document.getElementById('module-view');
  if (existingView) {
    existingView.innerHTML = contentHTML;
    const view = state.currentView;
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.bottom-nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    const alertBadge = document.getElementById('sidebar-alert-badge-dashboard');
    if (alertBadge) {
      alertBadge.style.display = _dangerAlertCount > 0 ? 'inline-flex' : 'none';
      if (_dangerAlertCount > 0) alertBadge.textContent = _dangerAlertCount;
    }
    return;
  }

  // Full render (primera vez o tras logout)
  const currentTheme = localStorage.getItem('theme') || 'dark';
  const profile = auth.getProfile();
  const roleColor = ROLE_COLORS[profile?.role] || '#64748B';
  const roleLabel = ROLE_LABELS[profile?.role] || 'Invitado';

  // Generar nav agrupado (filtrado por permisos)
  const profileLoaded = !!profile;
  const navHTML = NAV_GROUPS.map(group => {
    const groupItems = group.items.map(item => {
      if (item.adminOnly && profileLoaded && !auth.isAdmin()) return '';
      if (item.superadminOnly && profileLoaded && !auth.isSuperadmin()) return '';
      if (item.view === 'admin' && profileLoaded && !auth.isAdmin()) return '';
      if (item.roleOnly && profileLoaded && !item.roleOnly.includes(auth.getUserRole())) return '';
      if (profileLoaded && item.module && !auth.canAccess(item.module)) return '';
      const isReadOnly = profileLoaded && item.module && auth.canAccess(item.module) && !auth.canEdit(item.module);
      const isAdmin = item.view === 'admin';
      // Bloqueo por PLAN (independiente de canAccess/permisos de rol): el
      // módulo pasó todos los checks de arriba (el usuario SÍ podría
      // operarlo), pero la empresa no lo tiene contratado. Se muestra
      // visible-pero-bloqueado (candado + modal de upgrade) en vez de
      // ocultarlo, para invitar a actualizar de plan.
      const planKey = item.planModule || item.module;
      const isLockedByPlan = profileLoaded && planKey && auth.isModuleLockedByPlan(planKey);
      const alertBadge = item.view === 'dashboard' && _dangerAlertCount > 0
        ? `<span id="sidebar-alert-badge-dashboard" style="background:#ef4444;color:#fff;font-size:0.52rem;font-weight:800;min-width:15px;height:15px;padding:0 3px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;line-height:1;margin-left:auto;">${_dangerAlertCount}</span>`
        : (item.view === 'dashboard' ? `<span id="sidebar-alert-badge-dashboard" style="display:none;background:#ef4444;color:#fff;font-size:0.52rem;font-weight:800;min-width:15px;height:15px;padding:0 3px;border-radius:8px;display:none;align-items:center;justify-content:center;line-height:1;margin-left:auto;">${_dangerAlertCount}</span>` : '');
      const _hayViajeActivo = (() => { try { return !!JSON.parse(sessionStorage.getItem('JARAPP_VIAJE_ACTIVO') || 'null'); } catch { return false; } })();
      const viajeBadge = item.view === 'viaje' && _hayViajeActivo
        ? `<span class="viaje-badge" style="background:#06D6A0;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;letter-spacing:0.04em;margin-left:auto;">ACTIVO</span>`
        : '';
      return `
        <div class="nav-item ${state.currentView === item.view ? 'active' : ''} ${isAdmin ? 'nav-item-admin' : ''} ${isLockedByPlan ? 'nav-item-locked' : ''}" data-view="${item.view}" ${isLockedByPlan ? `data-locked-module="${planKey}" data-locked-label="${item.label}"` : ''}>
          <i data-lucide="${item.icon}"></i>
          <span>${item.label}</span>
          ${isLockedByPlan ? '<i data-lucide="lock" class="nav-lock-icon"></i>' : ''}
          ${!isLockedByPlan && isReadOnly ? '<span class="nav-readonly-badge">Ver</span>' : ''}
          ${!isLockedByPlan ? `${alertBadge}${viajeBadge}` : ''}
        </div>
      `;
    }).join('');
    if (!groupItems.trim()) return '';
    return `<div class="nav-section-label">${group.label}</div>${groupItems}`;
  }).join('');

  const adminNavItem = ''; // incluido en NAV_GROUPS › Sistema

  const _logoUrl = window.JARAPP_LOGO || sessionStorage.getItem('JARAPP_LOGO') || null;
  const _empresaNombre = auth.isSuperadmin() ? 'Panel Superadmin' : auth.getEmpresaNombre();
  const _logoZoneHtml = _logoUrl
    ? `<div id="sidebar-logo-letter" class="sidebar-logo-mark">
         <img src="${_logoUrl}" style="width:100%;height:100%;object-fit:cover;" alt="Logo de ${_empresaNombre}">
       </div>
       <div class="sidebar-brand">
         <div style="font-size:14px;font-weight:700;letter-spacing:0.04em;">EncargosPro</div>
         <div style="font-size:10px;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">${_empresaNombre}</div>
       </div>`
    : `<div id="sidebar-logo-letter" class="sidebar-logo-mark">
         <img src="/logo-encargospro.png" style="width:100%;height:100%;object-fit:contain;" alt="EncargosPro">
       </div>
       <div class="sidebar-brand">
         <div style="font-size:14px;font-weight:700;letter-spacing:0.04em;">EncargosPro</div>
         <div style="font-size:10px;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">${_empresaNombre}</div>
       </div>`;

  mainAppContent.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-logo-zone">
        ${_logoZoneHtml}
      </div>

      <nav>
        ${navHTML}
      </nav>

      <!-- Zona de usuario -->
      <div class="sidebar-user-zone">
        <div class="sidebar-user-avatar" style="background:${roleColor}22; color:${roleColor};">
          ${(profile?.full_name || 'U').charAt(0).toUpperCase()}
        </div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">${profile?.full_name || 'Usuario'}</span>
          <span class="sidebar-user-role" style="color:${roleColor};">${roleLabel}</span>
        </div>
      </div>

      <div class="sidebar-trm-badge" id="sidebar-trm-badge" title="Tasa de cambio USD/COP actual">
        <span class="sidebar-trm-label" id="sidebar-trm-label">TRM: —</span>
        <span class="trm-badge-source" id="sidebar-trm-source"></span>
      </div>

      <div class="theme-toggle-wrapper">
        <button id="sidebar-toggle-btn" class="theme-toggle" style="margin-bottom:8px;">
          <i data-lucide="menu"></i>
          <span>Retraer / Fijar</span>
        </button>
        <button id="theme-toggle-btn" class="theme-toggle">
          <i data-lucide="${currentTheme === 'light' ? 'moon' : 'sun'}"></i>
          <span>${currentTheme === 'light' ? 'Modo Oscuro' : 'Modo Claro'}</span>
        </button>
        <button id="logout-btn" class="theme-toggle logout-btn">
          <i data-lucide="log-out"></i>
          <span>Cerrar Sesión</span>
        </button>
      </div>
      <div class="sidebar-foot">EncargosPro · ${new Date().getFullYear()}</div>
    </div>

    <!-- Overlay para cerrar sidebar en mobile -->
    <div id="sidebar-overlay"></div>

    <main class="main-content">
      ${auth.isReadOnlyMode() ? bannerSoloLectura(auth.getEmpresaSync()) : ''}
      <header class="header">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div class="welcome-msg">
            <p>${_empresaNombre}</p>
            <h1>Gestión Operativa</h1>
          </div>
          <button id="mobile-menu-btn" style="display:none; background:var(--surface-2); border:1px solid var(--border-base); color:var(--text-main); padding:8px 12px; border-radius:8px; cursor:pointer;">
            <i data-lucide="menu"></i>
          </button>
        </div>
      </header>

      <div id="module-view">${contentHTML}</div>
    </main>

    <!-- Bottom Navigation (mobile) -->
    <nav class="bottom-nav">
      <div class="bottom-nav-item ${state.currentView === 'dashboard'  ? 'active' : ''}" data-view="dashboard">
        <i data-lucide="layout-dashboard"></i><span>Inicio</span>
      </div>
      <div class="bottom-nav-item ${state.currentView === 'inventory'  ? 'active' : ''}" data-view="inventory">
        <i data-lucide="package"></i><span>Inventario</span>
      </div>
      <div class="bottom-nav-item ${state.currentView === 'sales'      ? 'active' : ''}" data-view="sales">
        <i data-lucide="shopping-cart"></i><span>Ventas</span>
      </div>
      <div class="bottom-nav-item ${state.currentView === 'clients'    ? 'active' : ''}" data-view="clients">
        <i data-lucide="users"></i><span>Clientes</span>
      </div>
      <div class="bottom-nav-item" id="bottom-nav-more">
        <i data-lucide="menu"></i><span>Más</span>
      </div>
    </nav>

    <div id="modal-container" style="display:none;">
      <div id="modal-content"></div>
    </div>

    <div id="custom-dialog-container" style="display:none;">
      <div id="custom-dialog-content" class="glass-card"></div>
    </div>
  `;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.lockedModule) {
        abrirModalUpgradePlan(btn.dataset.lockedModule, btn.dataset.lockedLabel);
        return;
      }
      navigateTo(btn.getAttribute('data-view'));
    };
  });

  // Aplicar estado colapsado del sidebar síncronamente (antes del primer paint)
  if (localStorage.getItem('jarapp-sidebar-collapsed') === 'true') {
    document.body.classList.add('sidebar-collapsed');
  } else {
    document.body.classList.remove('sidebar-collapsed');
  }

  // Renderizar iconos svg (delay 0 = próximo microtask, sin flash visible)
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText, Sparkles, PanelLeftOpen, TrendingUp, Calendar, Lock }
    });

    // Restaurar logo desde sessionStorage (persiste entre navegaciones)
    const logoStored = window.JARAPP_LOGO || sessionStorage.getItem('JARAPP_LOGO');
    if (logoStored) ConfigService.applyLogo(logoStored);

    // Restaurar badge TRM desde sessionStorage (persiste entre navegaciones)
    const trmCached = sessionStorage.getItem('JARAPP_TRM');
    const trmFecha  = sessionStorage.getItem('JARAPP_TRM_FECHA');
    const trmFuente = sessionStorage.getItem('JARAPP_TRM_FUENTE') || 'manual';
    const hoyStr    = new Date().toISOString().split('T')[0];
    if (trmCached && trmFecha === hoyStr) {
      window.JARAPP_TRM = parseFloat(trmCached);
      window.JARAPP_TRM_FUENTE = trmFuente;
      const labelEl  = document.getElementById('sidebar-trm-label');
      const sourceEl = document.getElementById('sidebar-trm-source');
      if (labelEl)  labelEl.textContent = `TRM: $${Math.round(parseFloat(trmCached)).toLocaleString('es-CO')}`;
      if (sourceEl) {
        const esAuto = trmFuente !== 'manual' && trmFuente !== 'fallback';
        sourceEl.textContent = esAuto ? 'Auto' : 'Manual';
        sourceEl.className   = `trm-badge-source ${esAuto ? 'trm-auto' : 'trm-manual'}`;
      }
    }
    
    // Registrar UI listeners una sola vez — evita duplicados por re-renders de renderLayout
    if (!_uiListenersInit) {
      _uiListenersInit = true;

      // Modo oscuro/claro — actualiza atributo + icono sin re-renderizar la vista
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#theme-toggle-btn')) return;
        const html = document.documentElement;
        const newTheme = (html.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
          btn.innerHTML = `<i data-lucide="${newTheme === 'light' ? 'moon' : 'sun'}"></i><span>${newTheme === 'light' ? 'Modo Oscuro' : 'Modo Claro'}</span>`;
          if (window.lucide) lucide.createIcons();
          else createIcons({ icons: { Moon, Sun } });
        }
      });

      // Retraer/fijar sidebar — persiste en localStorage
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#sidebar-toggle-btn')) return;
        const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('jarapp-sidebar-collapsed', isCollapsed);
        const btn = document.getElementById('sidebar-toggle-btn');
        if (btn) {
          btn.innerHTML = `<i data-lucide="${isCollapsed ? 'panel-left-open' : 'menu'}"></i><span>${isCollapsed ? 'Expandir' : 'Retraer / Fijar'}</span>`;
          createIcons({ icons: { Menu, PanelLeftOpen } });
        }
      });
    }

    // Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const closeMobileNav = () => {
        document.body.classList.remove('mobile-nav-open');
    };
    if (mobileMenuBtn) {
        mobileMenuBtn.onclick = () => {
            document.body.classList.toggle('mobile-nav-open');
        };
    }
    // Close sidebar when tapping the overlay
    if (sidebarOverlay) {
        sidebarOverlay.onclick = closeMobileNav;
    }
    // Auto-close sidebar after navigating on mobile
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeMobileNav();
      }, { capture: true });
    });

    // Bottom nav — items directos
    document.querySelectorAll('.bottom-nav-item[data-view]').forEach(btn => {
      btn.onclick = () => navigateTo(btn.getAttribute('data-view'));
    });
    // Bottom nav — "Más" abre el sidebar en mobile
    const bottomMore = document.getElementById('bottom-nav-more');
    if (bottomMore) {
      bottomMore.onclick = () => document.body.classList.toggle('mobile-nav-open');
    }

    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        const ok = await window.customConfirm('Cerrar sesión', '¿Estás seguro de que deseas salir?');
        if (!ok) return;
        await auth.logout();
        // Recarga completa (en vez de solo bootApp()): los módulos de vista
        // guardan los datos ya cargados en variables de módulo (caché en
        // memoria) que nunca se limpian solas — sin esto, el siguiente login
        // en la misma pestaña podía seguir mostrando datos de la sesión
        // anterior hasta que esas variables se sobrescribieran.
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
        }
        window.location.reload();
      };
    }
  }, 100);

  // Event listener del main-quick-btn removido
};

const TITULOS = {
  dashboard: 'Dashboard', inventory: 'Inventario', sales: 'Ventas',
  clients: 'Clientes', purchases: 'Compras', logistics: 'Logística',
  finance: 'Finanzas', vendedores: 'Vendedores', params: 'Parámetros', calculadora: 'Calculadora',
  admin: 'Administración', settings: 'Configuración', viaje: 'Viaje EEUU', documentacion: 'Documentación',
  cotizador: 'Cotizador', tracker: 'Competitor Tracker', calendario: 'Calendario de Contenido',
};

export const navigateTo = (view) => {
  state.currentView = view;
  window._currentView = view;
  localStorage.setItem('JARAPP_VIEW', view);
  document.title = `${TITULOS[view] ?? view} · EncargosPro`;

  // (Credenciales siempre disponibles via fallback en db.js)

  // Guard: módulo admin solo para admin
  if (view === 'admin' && !auth.isAdmin()) {
    navigateTo('dashboard');
    return;
  }

  // Guard: la pantalla de conexión a Supabase (URL/anon key) es exclusiva
  // del superadmin — ningún admin de tenant debe poder verla ni tocarla.
  if (view === 'settings' && state.isLoggedIn && !auth.isSuperadmin()) {
    navigateTo('dashboard');
    return;
  }

  // Guard: verificar permiso de acceso al módulo
  const moduleMap = {
    clients: 'clients', inventory: 'inventory', sales: 'sales',
    purchases: 'purchases', logistics: 'logistics', finance: 'finance',
    vendedores: 'vendedores',
    params: 'params', calculadora: 'calculadora', cotizador: 'cotizador_ver', calendario: 'calendario_ver',
    superadmin: 'superadmin',
  };
  
  if (moduleMap[view] && !auth.canAccess(moduleMap[view])) {
    renderLayout(`
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:50vh; gap:1rem; text-align:center;">
        <div style="font-size:3rem;">🔒</div>
        <h2 style="color:var(--text-main);">Acceso Restringido</h2>
        <p style="color:var(--text-faint); max-width:360px;">
          No tienes permiso para acceder al módulo <strong>${MODULE_LABELS[view] || view}</strong>.<br>
          Contacta al administrador para solicitar acceso.
        </p>
        <button class="btn-primary" onclick="window._navigateTo('dashboard')">← Ir al Dashboard</button>
      </div>
    `);
    return;
  }

  // Guard: módulo no incluido en el plan contratado — respaldo por si se
  // navega directo (sin pasar por el candado del sidebar en renderLayout).
  const planKeyMap = { ...moduleMap, admin: 'admin', viaje: 'viaje', tracker: 'tracker' };
  if (planKeyMap[view] && auth.isModuleLockedByPlan(planKeyMap[view])) {
    renderLayout(`
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:50vh; gap:1rem; text-align:center;">
        <div style="font-size:3rem;">🔒</div>
        <h2 style="color:var(--text-main);">No incluido en tu plan</h2>
        <p style="color:var(--text-faint); max-width:360px;">
          <strong>${MODULE_LABELS[view] || view}</strong> no está disponible en tu plan actual.<br>
          Actualiza tu suscripción para desbloquearlo.
        </p>
        <button class="btn-primary" onclick="window._navigateTo('dashboard')">← Ir al Dashboard</button>
      </div>
    `);
    return;
  }

  // Routing Map
  switch(view) {
    case 'dashboard':    renderDashboard(renderLayout, renderErrorInternal); break;
    case 'inventory':    renderInventory(renderLayout, navigateTo); break;
    case 'clients':      renderClients(renderLayout, navigateTo); break;
    case 'sales':        renderSales(renderLayout, navigateTo); break;
    case 'purchases':    renderPurchases(renderLayout, navigateTo); break;
    case 'finance':      renderFinance(renderLayout, navigateTo); break;
    case 'vendedores':   renderVendedores(renderLayout, navigateTo); break;
    case 'logistics':    renderLogistics(renderLayout, navigateTo); break;
    case 'params':       renderParams(renderLayout, navigateTo); break;
    case 'calculadora':  renderCalculadora(renderLayout, navigateTo); break;
    case 'settings':     renderSettingsView(renderLayout, navigateTo); break;
    case 'admin':        renderAdmin(renderLayout, navigateTo); break;
    case 'viaje':        renderViaje(renderLayout, navigateTo); break;
    case 'cotizador':    renderCotizador(renderLayout, navigateTo); break;
    case 'documentacion': renderDocumentacion(renderLayout, navigateTo); break;
    case 'tracker':       renderTracker(renderLayout, navigateTo); break;
    case 'calendario':    renderCalendarioContenido(renderLayout, navigateTo); break;
    case 'superadmin':    renderSuperadmin(renderLayout); break;
    default: renderPlaceholder(view); break;
  }
  
  // Re-pintar iconos al cambiar la vista
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText, Sparkles, PanelLeftOpen, TrendingUp, Calendar, Lock }
    });
  }, 200);
};

const renderPlaceholder = (v) => renderLayout(`<h2>Módulo ${v}</h2><p style="opacity:0.4;">En desarrollo.</p>`);

const renderErrorInternal = (m) => {
    import('./utils.js').then(({ renderError }) => renderError(renderLayout, m, navigateTo));
};

// --- Inyección Global de los Modales CRUD ---
window.closeModal = () => document.getElementById('modal-container').style.display = 'none';
window.modalCliente = (id) => createClientModal(id, navigateTo);
window.modalProducto = (id) => createProductModal(id, navigateTo);
window.modalVenta = () => createSaleModal(navigateTo);
window.modalDetalleVentaGlobal = (id, backAction) => openSaleDetailModal(id, backAction);
// Registrado una sola vez al arrancar la app (no dentro de renderSales/renderFinance)
// para que funcione sin importar qué módulo se haya visitado antes en la sesión.
window.modalAbono = (ventaId, saldoPendiente, backAction) => openAbonoModal(ventaId, saldoPendiente, backAction);
window.modalCompra = (ventaId) => createPurchaseModal(navigateTo, ventaId);
window.modalGasto = () => createFinanceModal(navigateTo);
window.modalLogistica = (id) => createLogisticsModal(id, navigateTo);
window._navigateTo = navigateTo;

window.customAlert = (title, message, type = 'warning') => {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        const content = document.getElementById('custom-dialog-content');
        let iconHtml = '⚠️';
        let color = 'var(--warning-orange)';
        if (type === 'error') { iconHtml = '❌'; color = 'var(--primary-red)'; }
        if (type === 'success') { iconHtml = '✅'; color = 'var(--success-green)'; }
        
        content.innerHTML = `
            <div style="font-size:4rem; margin-bottom:1.5rem; filter:drop-shadow(0 0 10px ${color}44);">${iconHtml}</div>
            <h3 style="color:${color}; font-weight:800; font-size:1.6rem; margin-bottom:1rem;">${title}</h3>
            <p style="opacity:0.8; font-size:1.05rem; line-height:1.6; margin-bottom:2.5rem; white-space:pre-wrap; color:var(--text-main);">${message}</p>
            <button class="btn-primary" style="width:100%; padding:14px; font-size:1rem;" id="dialog-btn-ok">Entendido</button>
        `;
        container.style.display = 'flex';
        
        document.getElementById('dialog-btn-ok').onclick = () => {
            container.style.display = 'none';
            resolve(true);
        };
    });
};

window.customConfirm = (title, message) => {
    return new Promise((resolve) => {
        const container = document.getElementById('custom-dialog-container');
        const content = document.getElementById('custom-dialog-content');
        
        content.innerHTML = `
            <div style="font-size:4rem; margin-bottom:1.5rem; filter:drop-shadow(0 0 10px rgba(76,201,240,0.3));">❓</div>
            <h3 style="color:var(--text-main); font-weight:800; font-size:1.6rem; margin-bottom:1rem;">${title}</h3>
            <p style="opacity:0.8; font-size:1.05rem; line-height:1.6; margin-bottom:2.5rem; white-space:pre-wrap;">${message}</p>
            <div style="display:flex; gap:12px; width:100%;">
                <button class="btn-secondary" style="flex:1; padding:14px;" id="dialog-btn-cancel">Cancelar</button>
                <button class="btn-primary" style="flex:1; padding:14px;" id="dialog-btn-ok">Confirmar</button>
            </div>
        `;
        container.style.display = 'flex';
        
        document.getElementById('dialog-btn-ok').onclick = () => {
            container.style.display = 'none';
            resolve(true);
        };
        document.getElementById('dialog-btn-cancel').onclick = () => {
            container.style.display = 'none';
            resolve(false);
        };
    });
};

// Pagination Handlers
window.changePage = (view, page) => {
    localStorage.setItem(`${view}_page`, page);
    navigateTo(view);
};
window.changeRPP = (view, rpp) => {
    localStorage.setItem(`${view}_rpp`, rpp);
    localStorage.setItem(`${view}_page`, 1);
    navigateTo(view);
};


// Estilos globales de formularios (inyectados)
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    .btn-action { background:var(--surface-2); border:1px solid var(--border-base); color:var(--text-muted); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.78rem; font-weight:600; transition:all 0.18s ease; white-space:nowrap; font-family:'Inter',sans-serif; }
    .btn-action:hover { background:var(--surface-3); color:var(--text-main); transform:scale(1.03); }
`;
document.head.appendChild(styleSheet);

// ── BOOT ────────────────────────────────────────────────────────
async function bootApp() {
  // Si no hay Supabase configurado, ir a settings
  if (!state.isLoggedIn) {
    renderSettingsView(renderLayout, (view) => {
      if (view === 'dashboard') bootApp();
      else navigateTo(view);
    }, 'Primero configura tu conexión a Supabase.');
    return;
  }

  // Cargar logo global desde BD
  try {
    const { db } = await import('./db.js');
    const config = await db.fetchData('Configuracion');
    if (Array.isArray(config)) {
      const logoParam = config.find(p => p.clave === 'GLOBAL_LOGO');
      if (logoParam && logoParam.valor) {
        localStorage.setItem('GLOBAL_LOGO_URL', logoParam.valor);
        const logoImg = document.querySelector('.sidebar-logo-ring img');
        if (logoImg && logoImg.src !== logoParam.valor) {
            logoImg.src = logoParam.valor;
        }
      }
    }
  } catch (e) {
    console.error("Error cargando logo global:", e);
  }

  // Inicializar auth (verifica sesión existente)
  const { session, profile } = await auth.init();

  if (!session || !profile) {
    // No autenticado → pantalla de login
    renderLogin((userProfile) => {
      // Login exitoso → arrancar app
      startApp();
    });
    return;
  }

  if (!profile.is_active) {
    // Usuario desactivado
    renderLogin(() => startApp());
    return;
  }

  // Ya autenticado → arrancar directamente
  startApp();
}

// Contenido de venta por módulo bloqueado — ícono, titular persuasivo,
// descripción y beneficios reales del módulo (no un genérico "no incluido").
// Solo hace falta contenido curado para los módulos que realmente quedan
// fuera de algún plan hoy (admin, cotizador_ver, calendario_ver, viaje,
// tracker — ver Planes.modulos); el resto usa un fallback genérico por si
// el superadmin reconfigura los planes más adelante.
const UPGRADE_CONTENT = {
  cotizador_ver: {
    icon: '📝',
    headline: 'Cotiza en segundos y da una imagen profesional',
    desc: 'El Cotizador convierte tu Calculadora en una cotización lista para enviar por WhatsApp, con tu logo y todo el desglose de costos automático.',
    bullets: [
      'Cotización profesional en PDF lista para el cliente',
      'Cálculo automático: producto + envío + aduanas + tu margen',
      'Guarda tus fórmulas — no repitas el cálculo a mano cada vez',
      'Incluye tu logo y los datos de tu negocio',
    ],
  },
  calendario_ver: {
    icon: '🗓️',
    headline: 'Nunca más te quedes sin qué publicar',
    desc: 'Planifica el contenido de tus redes con un calendario semanal, plantillas reutilizables y las fechas clave del año ya cargadas.',
    bullets: [
      'Plantilla semanal de contenido reutilizable',
      'Fechas clave y días especiales ya cargados',
      'Reprograma publicaciones sin perder el hilo',
      'Mantén tu marca activa en redes sin improvisar',
    ],
  },
  tracker: {
    icon: '🔎',
    headline: 'Descubre qué le está funcionando a tu competencia',
    desc: 'Monitorea automáticamente cuentas de otros personal shoppers y tiendas — qué contenido se vuelve viral y qué formatos funcionan.',
    bullets: [
      'Seguimiento automático de cuentas de competencia',
      'Detecta qué publicaciones se vuelven virales',
      'Recreaciones de contenido con IA',
      'Reportes periódicos de rendimiento',
    ],
  },
  viaje: {
    icon: '✈️',
    headline: 'Organiza cada viaje de compras a Estados Unidos',
    desc: 'Lleva el control completo de un viaje de encargos: qué productos vas a traer, cuánto pesan y el estado de cada uno, todo en un solo lugar.',
    bullets: [
      'Modo especial para gestionar un viaje activo',
      'Control de peso y cantidad de productos por viaje',
      'Tu equipo ve el estado del viaje en tiempo real',
      'Evita perder o duplicar encargos durante el viaje',
    ],
  },
  admin: {
    icon: '🛡️',
    headline: 'Dale acceso a tu equipo sin perder el control',
    desc: 'Crea cuentas para tus vendedores, logística o finanzas con permisos específicos para cada uno — tú decides qué puede ver y editar cada persona.',
    bullets: [
      'Crea usuarios según el límite de tu plan',
      'Permisos específicos por módulo y por persona',
      'Historial de accesos de cada usuario',
      'Ideal cuando tu equipo empieza a crecer',
    ],
  },
};

function getUpgradeContent(moduleKey, label) {
  return UPGRADE_CONTENT[moduleKey] || {
    icon: '🔒',
    headline: `Desbloquea ${label}`,
    desc: `${label} no está incluido en tu plan actual — actualiza tu suscripción para empezar a usarlo.`,
    bullets: [
      'Accede a todas las funciones de este módulo',
      'Impulsa la gestión de tu negocio',
      'Disponible en planes superiores',
    ],
  };
}

/** Modal de upgrade — se abre al hacer clic en un módulo del sidebar bloqueado por el plan actual (ver isModuleLockedByPlan en auth.js). */
async function abrirModalUpgradePlan(moduleKey, label) {
  const container = document.getElementById('modal-container');
  const content = document.getElementById('modal-content');
  if (!container || !content) return;

  const info = getUpgradeContent(moduleKey, label);

  // Plan más económico que sí incluye este módulo, para mostrarlo como
  // gancho ("Disponible desde el plan Pro"). Si falla (red, RLS, etc.) el
  // modal igual se muestra, solo sin ese dato — nunca bloquea el CTA.
  let planNombre = null;
  try {
    const client = auth.getClient();
    if (client) {
      const { data } = await client.from('Planes').select('nombre, orden, modulos').order('orden');
      planNombre = (data || []).find(p => p.modulos?.[moduleKey])?.nombre || null;
    }
  } catch (_) { /* sin dato de plan, el modal sigue funcionando igual */ }

  const numeroWhatsapp = import.meta.env?.VITE_WHATSAPP_COMERCIAL || '573207761097';
  const mensaje = encodeURIComponent(`Hola, quiero actualizar mi plan de EncargosPro para desbloquear ${label}.`);
  const check = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:1px;">
      <circle cx="12" cy="12" r="10" fill="var(--success)" opacity="0.15"/>
      <path d="M8 12.5l2.5 2.5L16 9" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  content.innerHTML = `
    <div class="modal-content" style="max-width:440px;">
      <div style="position:relative; padding:28px 28px 0;">
        <button onclick="window.closeModal()" class="modal-close" style="position:absolute; top:16px; right:16px;">&times;</button>
        ${planNombre ? `
          <span style="position:absolute; top:18px; left:28px; background:rgba(124,58,237,0.12); color:#7C3AED; border:1px solid rgba(124,58,237,0.25); font-size:0.62rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; padding:4px 10px; border-radius:999px;">● ${planNombre}</span>
        ` : ''}
        <div style="width:72px;height:72px;border-radius:20px;background:var(--surface-2);border:1px solid var(--border-base);display:flex;align-items:center;justify-content:center;margin:38px auto 20px;font-size:2.1rem;position:relative;">
          ${info.icon}
          <span style="position:absolute; bottom:-4px; right:-4px; width:26px;height:26px;border-radius:50%;background:#7C3AED;display:flex;align-items:center;justify-content:center;font-size:0.8rem;box-shadow:0 2px 8px rgba(0,0,0,0.3);">🔒</span>
        </div>
      </div>
      <div class="modal-body" style="padding-top:0; text-align:center;">
        <h2 style="margin:0 0 10px;font-size:1.3rem;font-weight:800;line-height:1.25;">${info.headline}</h2>
        <p style="color:var(--text-faint);font-size:0.88rem;margin:0 0 22px;line-height:1.5;">${info.desc}</p>
        <ul style="list-style:none;padding:0;margin:0 0 22px;display:flex;flex-direction:column;gap:12px;text-align:left;">
          ${info.bullets.map(b => `
            <li style="display:flex;gap:10px;align-items:flex-start;font-size:0.85rem;color:var(--text-main);font-weight:600;">
              ${check}
              <span>${b}</span>
            </li>
          `).join('')}
        </ul>
        <div style="background:var(--surface-2); border:1px solid var(--border-base); border-radius:14px; padding:16px 18px; margin-bottom:20px; text-align:left;">
          <p style="margin:0 0 4px;font-weight:800;font-size:0.9rem;">${planNombre ? `Disponible desde el plan ${planNombre}` : 'No incluido en tu plan actual'}</p>
          <p style="margin:0;font-size:0.76rem;color:var(--text-faint);">Escríbenos y te ayudamos a actualizar tu suscripción hoy mismo.</p>
        </div>
        <a href="https://wa.me/${numeroWhatsapp}?text=${mensaje}" target="_blank" rel="noopener"
           style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#20BD5C;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:800;font-size:0.9rem;text-decoration:none;box-sizing:border-box;">
          💬 Hablar por WhatsApp para actualizar mi plan
        </a>
      </div>
    </div>`;
  container.style.display = 'flex';
}

function renderSuscripcionVencida(empresa, motivo) {
  // Configurable vía variable de entorno VITE_WHATSAPP_COMERCIAL (Netlify →
  // Site settings → Environment variables), sin tocar código. El número de
  // Jarapo queda solo como fallback de desarrollo si no está configurada.
  const numeroWhatsapp = import.meta.env?.VITE_WHATSAPP_COMERCIAL || '573207761097';
  const mensaje = encodeURIComponent(`Hola, mi suscripción a EncargosPro (${empresa.nombre}) está ${empresa.estado_suscripcion}. Quiero renovarla.`);
  const textoDefault = `El acceso de <strong>${empresa.nombre}</strong> a EncargosPro está pausado. Contáctanos por WhatsApp para reactivar tu suscripción.`;
  document.querySelector('#app').innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; gap:1rem; text-align:center; padding:2rem;">
      <div style="font-size:3rem;">⏸️</div>
      <h2 style="color:var(--text-main);">Suscripción ${empresa.estado_suscripcion === 'cancelada' ? 'cancelada' : 'vencida'}</h2>
      <p style="color:var(--text-faint); max-width:380px;">
        ${motivo || textoDefault}
      </p>
      <a class="btn-primary" href="https://wa.me/${numeroWhatsapp}?text=${mensaje}" target="_blank" rel="noopener">
        💬 Reactivar por WhatsApp
      </a>
      <button class="btn-secondary" onclick="window.location.reload()">Ya renové — Recargar</button>
    </div>
  `;
}

/** Banner persistente cuando el admin está operando en modo solo-lectura (gracia post-vencimiento). */
function bannerSoloLectura(empresa) {
  const numeroWhatsapp = import.meta.env?.VITE_WHATSAPP_COMERCIAL || '573207761097';
  const mensaje = encodeURIComponent(`Hola, mi suscripción a EncargosPro (${empresa?.nombre || ''}) venció y estoy en modo de solo lectura. Quiero renovarla.`);
  return `
    <div id="banner-solo-lectura" style="background:#7C1D1D; color:#fff; padding:10px 20px; display:flex; align-items:center; justify-content:center; gap:14px; flex-wrap:wrap; font-size:0.82rem; text-align:center;">
      <span>🔒 Tu suscripción venció — estás en modo de <strong>solo consulta</strong>. No puedes crear ni editar información.</span>
      <a href="https://wa.me/${numeroWhatsapp}?text=${mensaje}" target="_blank" rel="noopener" style="background:#20BD5C; color:#fff; padding:5px 14px; border-radius:8px; font-weight:700; text-decoration:none; white-space:nowrap;">
        💬 Renovar ahora
      </a>
    </div>
  `;
}

async function startApp() {
  const profile = auth.getProfile();

  if (!profile) {
    renderLogin(() => startApp());
    return;
  }

  // Precargar el plan contratado ANTES de construir el sidebar por primera
  // vez — renderLayout() arma el menú de forma síncrona (auth.getPlanModules()),
  // así que el catálogo ya tiene que estar en caché para esa primera llamada.
  // Va acá (y no en bootApp) porque este es el único punto por el que pasan
  // TODOS los caminos: sesión ya activa al recargar Y login recién hecho
  // (los callbacks de renderLogin() llaman directo a startApp(), sin pasar
  // por el resto de bootApp) — antes solo se precargaba en el primero, así
  // que un login recién hecho nunca veía los candados hasta refrescar.
  await auth.getPlan();

  // Guard de suscripción: bloqueo total, modo solo-lectura (solo admin,
  // durante los días de gracia configurados), o acceso normal. El
  // superadmin no tiene empresa propia y evaluarAccesoSuscripcion() nunca
  // lo bloquea (ver auth.js). Va acá y no en bootApp por el mismo motivo
  // que auth.getPlan() arriba: este es el único punto por el que pasan
  // todos los caminos de login.
  const acceso = await auth.evaluarAccesoSuscripcion();
  const empresaActual = auth.getEmpresaSync();
  if (acceso.bloqueado) {
    renderSuscripcionVencida(empresaActual);
    return;
  }
  if (acceso.soloLectura && !auth.isAdmin()) {
    renderSuscripcionVencida(empresaActual, `El acceso de <strong>${empresaActual?.nombre || ''}</strong> venció. Solo el administrador puede consultar información durante el periodo de gracia — contacta a tu administrador o renueven la suscripción.`);
    return;
  }
  auth.setReadOnlyMode(acceso.soloLectura && auth.isAdmin());

  // Cargar logo en background
  ConfigService.getLogo().then(url => {
    if (url) ConfigService.applyLogo(url);
  }).catch(() => {});

  // Cargar TRM en background — delay para esperar DOM listo
  setTimeout(() => {
    TRMService.getTRMHoy().then(({ valor, fuente }) => {
      window.JARAPP_TRM = valor;
      window.JARAPP_TRM_FUENTE = fuente;
      sessionStorage.setItem('JARAPP_TRM', valor);
      sessionStorage.setItem('JARAPP_TRM_FUENTE', fuente);
      sessionStorage.setItem('JARAPP_TRM_FECHA', new Date().toISOString().split('T')[0]);

      // Actualizar badge en sidebar cuando esté disponible
      const updateTrmBadge = () => {
        const labelEl = document.getElementById('sidebar-trm-label');
        const sourceEl = document.getElementById('sidebar-trm-source');
        if (labelEl) labelEl.textContent = `TRM: $${Math.round(valor).toLocaleString('es-CO')}`;
        if (sourceEl) {
          const esAuto = fuente !== 'manual' && fuente !== 'fallback';
          sourceEl.textContent = esAuto ? 'Auto' : 'Manual';
          sourceEl.className = `trm-badge-source ${esAuto ? 'trm-auto' : 'trm-manual'}`;
          if (!esAuto) {
            const badge = document.getElementById('sidebar-trm-badge');
            if (badge) badge.title = 'TRM ingresada manualmente en Configuración';
          }
        }
      };
      updateTrmBadge();
      // Reintentar si los elementos aún no están listos
      if (!document.getElementById('sidebar-trm-label')) {
        setTimeout(updateTrmBadge, 500);
      }
    }).catch((err) => {
      console.error('[TRM] Error al cargar:', err);
      const cachedVal = sessionStorage.getItem('JARAPP_TRM');
      const valor = cachedVal ? parseFloat(cachedVal) : 3700;
      window.JARAPP_TRM = valor;
      window.JARAPP_TRM_FUENTE = 'fallback';
      sessionStorage.setItem('JARAPP_TRM', String(valor));
      sessionStorage.setItem('JARAPP_TRM_FUENTE', 'fallback');
      const labelEl  = document.getElementById('sidebar-trm-label');
      const sourceEl = document.getElementById('sidebar-trm-source');
      if (labelEl)  labelEl.textContent = `TRM: $${Math.round(valor).toLocaleString('es-CO')}`;
      if (sourceEl) { sourceEl.textContent = 'Manual'; sourceEl.className = 'trm-badge-source trm-manual'; }
    });
  }, 1500);

  // Superadmin no tiene dashboard de negocio — va directo a su panel de empresas
  if (auth.isSuperadmin()) {
    navigateTo('superadmin');
    return;
  }

  // Ir al dashboard si tiene acceso, si no al primer módulo permitido
  if (auth.canAccess('dashboard')) {
    navigateTo('dashboard');
  } else {
    const firstModule = ['clients','inventory','sales','purchases','logistics','finance','params']
      .find(m => auth.canAccess(m));
    navigateTo(firstModule || 'dashboard');
  }

  // Cargar alertas en background y mostrar badge en sidebar
  AlertasService.getAlertas().then(alertas => {
    _dangerAlertCount = alertas.filter(a => a.nivel === 'danger').length;
    window._actualizarBadgeAlertas?.();
  }).catch(() => {});

  // Refrescar alertas automáticamente cada 30 minutos
  setInterval(() => {
    AlertasService.invalidar();
    AlertasService.getAlertas().then(alertas => {
      _dangerAlertCount = alertas.filter(a => a.nivel === 'danger').length;
      window._actualizarBadgeAlertas?.();
    }).catch(() => {});
  }, 30 * 60 * 1000);

  // Cargar viaje activo en background y mostrar badge "ACTIVO" en sidebar
  import('./services/viajes.js').then(({ ViajeService }) => {
    ViajeService.getActivo().then(v => {
      window._actualizarBadgeViaje?.(v);
    }).catch(() => {});
  }).catch(() => {});

  // Iniciar JaraBot para admin y gerente (solo una vez por sesión)
  initJaraBot(auth);

  // Iniciar scheduler de scraping para admin y gerente
  if (['admin', 'gerente'].includes(auth.getUserRole())) {
    import('./services/schedulerService.js').then(({ iniciarScheduler }) => {
      iniciarScheduler();
    }).catch(err => console.warn('[Scheduler] Error al iniciar:', err));
  }
}

// Arrancar App
bootApp();

// Registro del Service Worker (PWA) — solo en build de producción.
// En `vite dev` un SW cache-first sirve JS desactualizado y rompe HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registro fallido:', err));
  });
}

// ── Indicador de conectividad offline ────────────────────────────────────────
function initConectividad() {
  const mostrarEstado = (online) => {
    document.getElementById('offline-banner')?.remove();
    if (!online) {
      const banner = document.createElement('div');
      banner.id = 'offline-banner';
      banner.innerHTML = `
        <div style="
          position:fixed;bottom:0;left:0;right:0;z-index:99999;
          background:#1D3557;color:white;
          text-align:center;padding:8px;
          padding-bottom:calc(8px + env(safe-area-inset-bottom));
          font-size:13px;display:flex;align-items:center;
          justify-content:center;gap:8px;
        ">
          <span>📵</span>
          <span>Sin conexión — mostrando datos en caché</span>
        </div>`;
      document.body.appendChild(banner);
    }
  };
  window.addEventListener('online',  () => mostrarEstado(true));
  window.addEventListener('offline', () => mostrarEstado(false));
  mostrarEstado(navigator.onLine);
}
initConectividad();

// ── Banner de instalación para iOS ───────────────────────────────────────────
function mostrarBannerInstalacioniOS() {
  const esIOS    = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const esPWA    = window.navigator.standalone === true;
  const yaVisto  = sessionStorage.getItem('pwa-banner-visto');
  if (!esIOS || esPWA || yaVisto) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.innerHTML = `
    <div style="
      position:fixed;bottom:0;left:0;right:0;z-index:99998;
      background:var(--surface-0);border-top:1px solid var(--glass-border);
      backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom));
      display:flex;align-items:center;gap:12px;
      box-shadow:0 -4px 20px rgba(0,0,0,0.2);
    ">
      <img src="/icon-192.png" style="width:40px;height:40px;border-radius:10px;flex-shrink:0;">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;color:var(--text-main);">Instalar EncargosPro</div>
        <div style="font-size:12px;color:var(--text-muted);">
          Toca <strong>⬆️ Compartir</strong> → <strong>"Añadir a inicio"</strong>
        </div>
      </div>
      <button onclick="sessionStorage.setItem('pwa-banner-visto','1');document.getElementById('ios-install-banner').remove();"
        style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;color:var(--text-faint);">✕</button>
    </div>`;
  document.body.appendChild(banner);
}
mostrarBannerInstalacioniOS();
