import './style.css';
import { db } from './db.js';
import { auth, ROLE_LABELS, ROLE_COLORS, MODULE_LABELS } from './auth.js';
import { createIcons, LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle } from 'lucide';

// Importación de módulos refactorizados
import { renderDashboard } from './views/dashboard.js';
import { renderClients, createClientModal } from './views/clients.js';
import { renderInventory, createProductModal } from './views/inventory.js';
import { renderSettingsView } from './views/settings.js';
import { renderSales, createSaleModal, openSaleDetailModal } from './views/sales.js';
import { renderPurchases, createPurchaseModal } from './views/purchases.js';
import { renderFinance, createFinanceModal } from './views/finance.js';
import { renderLogistics, createLogisticsModal } from './views/logistics.js';
import { renderParams } from './views/params.js';
import { renderLogin } from './views/login.js';
import { renderAdmin } from './views/admin.js';

// Init theme instantly to prevent flashing
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

/**
 * Jarapo Admin - Aplicación Operativa Medellín (v3.0.0 · Auth + RBAC)
 */

const mainAppContent = document.querySelector('#app');

const state = {
  currentView: 'dashboard',
  get isLoggedIn() { return !!localStorage.getItem('JARAPO_SUPA_URL'); }
};

// ── Nav Items definición (filtrados dinámicamente por permisos) ──
const NAV_ITEMS = [
  { view: 'dashboard',  icon: 'layout-dashboard', label: 'Dashboard',         module: 'dashboard'  },
  { view: 'clients',    icon: 'users',             label: 'Clientes',           module: 'clients'    },
  { view: 'inventory',  icon: 'package',           label: 'Inventario',         module: 'inventory'  },
  { view: 'sales',      icon: 'shopping-cart',     label: 'Ventas',             module: 'sales'      },
  { view: 'purchases',  icon: 'globe',             label: 'Compras USA',        module: 'purchases'  },
  { view: 'logistics',  icon: 'truck',             label: 'Seguimientos',       module: 'logistics'  },
  { divider: true },
  { view: 'finance',    icon: 'activity',          label: 'Gastos y Finanzas',  module: 'finance'    },
  { divider: true },
  { view: 'params',     icon: 'settings-2',        label: 'Parametrización',    module: 'params'     },
  { view: 'settings',   icon: 'settings',          label: 'Configuración',      module: null, always: true },
];

const logoUrl = () => localStorage.getItem('GLOBAL_LOGO_URL') || '/logo.png';

// ── renderLayout (con filtrado de nav por permisos) ──────────────
export const renderLayout = (contentHTML) => {
  const currentTheme = localStorage.getItem('theme') || 'dark';
  const profile = auth.getProfile();
  const roleColor = ROLE_COLORS[profile?.role] || '#64748B';
  const roleLabel = ROLE_LABELS[profile?.role] || 'Invitado';

  // Filtrar nav items según permisos
  // Si el perfil no ha cargado aún (null), mostrar todos los items para evitar nav vacío
  const profileLoaded = !!profile;
  const navHTML = NAV_ITEMS.map(item => {
    if (item.divider) return `<div class="nav-divider"></div>`;

    // Configuración siempre visible
    if (item.always) {
      return `<div class="nav-item ${state.currentView === item.view ? 'active' : ''}" data-view="${item.view}">
        <i data-lucide="${item.icon}"></i> <span>${item.label}</span>
      </div>`;
    }

    // Admin solo para rol admin (solo filtrar si el perfil está cargado)
    if (item.view === 'admin' && profileLoaded && !auth.isAdmin()) return '';

    // Filtrar por permisos de módulo SOLO si el perfil está cargado
    if (profileLoaded && item.module && !auth.canAccess(item.module)) return '';

    const isReadOnly = profileLoaded && item.module && auth.canAccess(item.module) && !auth.canEdit(item.module);
    return `
      <div class="nav-item ${state.currentView === item.view ? 'active' : ''}" data-view="${item.view}">
        <i data-lucide="${item.icon}"></i>
        <span>${item.label}</span>
        ${isReadOnly ? '<span class="nav-readonly-badge">Ver</span>' : ''}
      </div>
    `;
  }).join('');

  // Nav Admin (solo para admins)
  const adminNavItem = auth.isAdmin() ? `
    <div class="nav-divider"></div>
    <div class="nav-item nav-item-admin ${state.currentView === 'admin' ? 'active' : ''}" data-view="admin">
      <i data-lucide="shield"></i> <span>Administración</span>
    </div>
  ` : '';

  const imgUrl = logoUrl();
  mainAppContent.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-logo-zone">
        <div class="sidebar-logo-ring">
           <img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;" onerror="this.outerHTML='<div style=\\'font-size:2rem; font-weight:800; color:var(--primary-red);\\'>J</div>'">
        </div>
        <div class="sidebar-brand">
          <h2>JARAPP</h2>
          <span>Importaciones Jarapo</span>
        </div>
      </div>
      
      <nav>
        ${navHTML}
        ${adminNavItem}
      </nav>

      <!-- User profile zone -->
      <div class="sidebar-user-zone">
        <div class="sidebar-user-avatar" style="background:${roleColor}22; color:${roleColor};">
          ${(profile?.full_name || 'U').charAt(0).toUpperCase()}
        </div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">${profile?.full_name || 'Usuario'}</span>
          <span class="sidebar-user-role" style="color:${roleColor};">${roleLabel}</span>
        </div>
      </div>

      <div class="theme-toggle-wrapper">
         <button id="sidebar-toggle-btn" class="theme-toggle" style="margin-bottom: 8px;">
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
      <div class="sidebar-foot">Medellín · ${new Date().getFullYear()}</div>
    </div>

    <main class="main-content">
      <header class="header">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
            <div class="welcome-msg">
              <p>Dirección Medellín</p>
              <h1>Gestión Operativa</h1>
            </div>
            <button id="mobile-menu-btn" style="display:none; background:var(--glass-hover); border:1px solid var(--glass-border); color:var(--text-main); padding:8px 12px; border-radius:8px; cursor:pointer;">
                <i data-lucide="menu"></i>
            </button>
        </div>
        <div class="actions" style="display:flex; gap:12px; align-items:center;">
           <button class="btn-primary" id="main-quick-btn" ${auth.canEdit(state.currentView) || state.currentView === 'dashboard' ? '' : 'style="display:none;"'}>+ Nuevo Registro</button>
        </div>
      </header>

      <div id="module-view">${contentHTML}</div>
    </main>

    <div id="modal-container" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:var(--modal-overlay); z-index:9999; justify-content:center; align-items:center;">
       <div id="modal-content" class="glass-card" style="width:620px; max-width:96%; padding:2.5rem; overflow-y:auto; max-height:92vh;">
          <!-- Inyección Formulario -->
       </div>
    </div>
  `;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => navigateTo(btn.getAttribute('data-view'));
  });
  
  // Renderizar iconos svg
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle }
    });
    
    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
       themeBtn.onclick = () => {
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          const newTheme = isLight ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
          themeBtn.innerHTML = `
             <i data-lucide="${newTheme === 'light' ? 'moon' : 'sun'}"></i>
             <span>${newTheme === 'light' ? 'Oscuro' : 'Claro'}</span>
          `;
          createIcons({ icons: { Moon, Sun }});
       };
    }
    
    // Sidebar Toggle (Desktop)
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    if (sidebarToggleBtn) {
       sidebarToggleBtn.onclick = () => {
          document.body.classList.toggle('sidebar-collapsed');
       };
    }

    // Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.onclick = () => {
            document.body.classList.toggle('mobile-nav-open');
        };
    }

    // Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        if (!confirm('¿Cerrar sesión?')) return;
        await auth.logout();
        bootApp();
      };
    }
  }, 100);

  document.getElementById('main-quick-btn')?.addEventListener('click', () => {
    if (state.currentView === 'clients') window.modalCliente();
    else if (state.currentView === 'inventory') window.modalProducto();
    else if (state.currentView === 'sales') window.modalVenta();
    else if (state.currentView === 'purchases') window.modalCompra();
    else if (state.currentView === 'finance') window.modalGasto();
    else if (state.currentView === 'logistics') window.modalLogistica();
    else alert("Elige un módulo para agregar un nuevo registro.");
  });
};

export const navigateTo = (view) => {
  state.currentView = view;

  // Guard: Supabase no configurado → settings
  if (!state.isLoggedIn && view !== 'settings') {
    renderSettingsView(renderLayout, navigateTo, 'Indica la URL de tu base de datos para comenzar.');
    return;
  }

  // Guard: módulo admin solo para admin
  if (view === 'admin' && !auth.isAdmin()) {
    navigateTo('dashboard');
    return;
  }

  // Guard: verificar permiso de acceso al módulo
  const moduleMap = {
    clients: 'clients', inventory: 'inventory', sales: 'sales',
    purchases: 'purchases', logistics: 'logistics', finance: 'finance',
    params: 'params'
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

  // Routing Map
  switch(view) {
    case 'dashboard': renderDashboard(renderLayout, renderErrorInternal); break;
    case 'inventory': renderInventory(renderLayout, navigateTo); break;
    case 'clients': renderClients(renderLayout, navigateTo); break;
    case 'sales': renderSales(renderLayout, navigateTo); break;
    case 'purchases': renderPurchases(renderLayout, navigateTo); break;
    case 'finance': renderFinance(renderLayout, navigateTo); break;
    case 'logistics': renderLogistics(renderLayout, navigateTo); break;
    case 'params': renderParams(renderLayout, navigateTo); break;
    case 'settings': renderSettingsView(renderLayout, navigateTo); break;
    case 'admin': renderAdmin(renderLayout, navigateTo); break;
    default: renderPlaceholder(view); break;
  }
  
  // Re-pintar iconos al cambiar la vista
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle }
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
window.modalCompra = (ventaId) => createPurchaseModal(navigateTo, ventaId);
window.modalGasto = () => createFinanceModal(navigateTo);
window.modalLogistica = (id) => createLogisticsModal(id, navigateTo);
window._navigateTo = navigateTo;

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

function startApp() {
  // Navegar al primer módulo accesible
  const profile = auth.getProfile();
  
  if (!profile) {
    renderLogin(() => startApp());
    return;
  }

  // Ir al dashboard si tiene acceso, si no al primer módulo permitido
  if (auth.canAccess('dashboard')) {
    navigateTo('dashboard');
  } else {
    const firstModule = ['clients','inventory','sales','purchases','logistics','finance','params']
      .find(m => auth.canAccess(m));
    navigateTo(firstModule || 'settings');
  }
}

// Arrancar App
bootApp();
