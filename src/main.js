import './style.css';
import { db } from './db.js';
import { auth, ROLE_LABELS, ROLE_COLORS, MODULE_LABELS } from './auth.js';
import { createIcons, LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText } from 'lucide';

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
import { renderCalculadora } from './views/calculadora.js';
import { renderLogin } from './views/login.js';
import { renderAdmin } from './views/admin.js';
import { renderViaje } from './views/viaje.js';
import { renderCotizador } from './views/cotizador.js';
import { TRMService } from './services/trm.js';
import { ConfigService } from './services/config.js';
import { AlertasService } from './services/alertas.js';
import { initJaraBot } from './components/jarabot.js';

// Init theme instantly to prevent flashing
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

window.auth = auth;
/**
 * Jarapo Admin - Aplicación Operativa Medellín (v3.0.0 · Auth + RBAC)
 */

const mainAppContent = document.querySelector('#app');

const state = {
  currentView: 'dashboard',
  // Siempre conectado — credenciales embebidas en db.js como fallback
  get isLoggedIn() { return true; }
};

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
      { view: 'viaje',       icon: 'plane',             label: 'Viaje EEUU',   module: null, roleOnly: ['admin','gerente'] },
    ]
  },
  {
    label: 'Gestión',
    items: [
      { view: 'clients',     icon: 'users',             label: 'Clientes',     module: 'clients'     },
      { view: 'finance',     icon: 'activity',          label: 'Finanzas',     module: 'finance'     },
      { view: 'calculadora', icon: 'calculator',        label: 'Calculadora',  module: 'calculadora' },
    ]
  },
  {
    label: 'Sistema',
    items: [
      { view: 'params',      icon: 'settings-2',        label: 'Parámetros',   module: 'params'      },
      { view: 'admin',       icon: 'shield',            label: 'Admin',        module: null, adminOnly: true },
      { view: 'settings',    icon: 'settings',          label: 'Configuración',module: null, adminOnly: true },
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
  const currentTheme = localStorage.getItem('theme') || 'dark';
  const profile = auth.getProfile();
  const roleColor = ROLE_COLORS[profile?.role] || '#64748B';
  const roleLabel = ROLE_LABELS[profile?.role] || 'Invitado';

  // Generar nav agrupado (filtrado por permisos)
  const profileLoaded = !!profile;
  const navHTML = NAV_GROUPS.map(group => {
    const groupItems = group.items.map(item => {
      if (item.adminOnly && profileLoaded && !auth.isAdmin()) return '';
      if (item.view === 'admin' && profileLoaded && !auth.isAdmin()) return '';
      if (item.roleOnly && profileLoaded && !item.roleOnly.includes(auth.getUserRole())) return '';
      if (profileLoaded && item.module && !auth.canAccess(item.module)) return '';
      const isReadOnly = profileLoaded && item.module && auth.canAccess(item.module) && !auth.canEdit(item.module);
      const isAdmin = item.view === 'admin';
      const alertBadge = item.view === 'dashboard' && _dangerAlertCount > 0
        ? `<span id="sidebar-alert-badge-dashboard" style="background:#ef4444;color:#fff;font-size:0.52rem;font-weight:800;min-width:15px;height:15px;padding:0 3px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;line-height:1;margin-left:auto;">${_dangerAlertCount}</span>`
        : (item.view === 'dashboard' ? `<span id="sidebar-alert-badge-dashboard" style="display:none;background:#ef4444;color:#fff;font-size:0.52rem;font-weight:800;min-width:15px;height:15px;padding:0 3px;border-radius:8px;display:none;align-items:center;justify-content:center;line-height:1;margin-left:auto;">${_dangerAlertCount}</span>` : '');
      const _hayViajeActivo = (() => { try { return !!JSON.parse(sessionStorage.getItem('JARAPP_VIAJE_ACTIVO') || 'null'); } catch { return false; } })();
      const viajeBadge = item.view === 'viaje' && _hayViajeActivo
        ? `<span class="viaje-badge" style="background:#06D6A0;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;letter-spacing:0.04em;margin-left:auto;">ACTIVO</span>`
        : '';
      return `
        <div class="nav-item ${state.currentView === item.view ? 'active' : ''} ${isAdmin ? 'nav-item-admin' : ''}" data-view="${item.view}">
          <i data-lucide="${item.icon}"></i>
          <span>${item.label}</span>
          ${isReadOnly ? '<span class="nav-readonly-badge">Ver</span>' : ''}
          ${alertBadge}${viajeBadge}
        </div>
      `;
    }).join('');
    if (!groupItems.trim()) return '';
    return `<div class="nav-section-label">${group.label}</div>${groupItems}`;
  }).join('');

  const adminNavItem = ''; // incluido en NAV_GROUPS › Sistema

  const _logoUrl = window.JARAPP_LOGO || sessionStorage.getItem('JARAPP_LOGO') || null;
  const _logoZoneHtml = _logoUrl
    ? `<div id="sidebar-logo-letter" class="sidebar-logo-mark">
         <img src="${_logoUrl}" style="width:100%;height:100%;object-fit:contain;" alt="Logo Jarapo">
       </div>
       <div class="sidebar-brand">
         <div style="font-size:14px;font-weight:700;letter-spacing:0.04em;">JARAPP</div>
         <div style="font-size:10px;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">Importaciones Jarapo</div>
       </div>`
    : `<div id="sidebar-logo-letter" class="sidebar-logo-mark">
         <span style="color:white;font-size:36px;font-weight:700;line-height:1;">J</span>
       </div>
       <div class="sidebar-brand">
         <div style="font-size:14px;font-weight:700;letter-spacing:0.04em;">JARAPP</div>
         <div style="font-size:10px;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">Importaciones Jarapo</div>
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
      <div class="sidebar-foot">Bogotá · ${new Date().getFullYear()}</div>
    </div>

    <!-- Overlay para cerrar sidebar en mobile -->
    <div id="sidebar-overlay"></div>

    <main class="main-content">
      <header class="header">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div class="welcome-msg">
            <p>Importaciones Jarapo</p>
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
    btn.onclick = () => navigateTo(btn.getAttribute('data-view'));
  });
  
  // Renderizar iconos svg
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText, Sparkles }
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
    
    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
       themeBtn.onclick = () => {
          const isLight = document.documentElement.getAttribute('data-theme') === 'light';
          const newTheme = isLight ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', newTheme);
          localStorage.setItem('theme', newTheme);
          // Re-renderizar el módulo actual para que los colores se actualicen
          const currentView = state.currentView || localStorage.getItem('JARAPP_VIEW') || 'dashboard';
          navigateTo(currentView);
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
        bootApp();
      };
    }
  }, 100);

  // Event listener del main-quick-btn removido
};

const TITULOS = {
  dashboard: 'Dashboard', inventory: 'Inventario', sales: 'Ventas',
  clients: 'Clientes', purchases: 'Compras', logistics: 'Logística',
  finance: 'Finanzas', params: 'Parámetros', calculadora: 'Calculadora',
  admin: 'Administración', settings: 'Configuración', viaje: 'Viaje EEUU',
  cotizador: 'Cotizador',
};

export const navigateTo = (view) => {
  state.currentView = view;
  localStorage.setItem('JARAPP_VIEW', view);
  document.title = `${TITULOS[view] ?? view} · JARAPP`;

  // (Credenciales siempre disponibles via fallback en db.js)

  // Guard: módulo admin solo para admin
  if (view === 'admin' && !auth.isAdmin()) {
    navigateTo('dashboard');
    return;
  }

  // Guard: configuración solo para admin si ya está logueado
  if (view === 'settings' && state.isLoggedIn && !auth.isAdmin()) {
    navigateTo('dashboard');
    return;
  }

  // Guard: verificar permiso de acceso al módulo
  const moduleMap = {
    clients: 'clients', inventory: 'inventory', sales: 'sales',
    purchases: 'purchases', logistics: 'logistics', finance: 'finance',
    params: 'params', calculadora: 'calculadora', cotizador: 'cotizador_ver'
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
    case 'dashboard':    renderDashboard(renderLayout, renderErrorInternal); break;
    case 'inventory':    renderInventory(renderLayout, navigateTo); break;
    case 'clients':      renderClients(renderLayout, navigateTo); break;
    case 'sales':        renderSales(renderLayout, navigateTo); break;
    case 'purchases':    renderPurchases(renderLayout, navigateTo); break;
    case 'finance':      renderFinance(renderLayout, navigateTo); break;
    case 'logistics':    renderLogistics(renderLayout, navigateTo); break;
    case 'params':       renderParams(renderLayout, navigateTo); break;
    case 'calculadora':  renderCalculadora(renderLayout, navigateTo); break;
    case 'settings':     renderSettingsView(renderLayout, navigateTo); break;
    case 'admin':        renderAdmin(renderLayout, navigateTo); break;
    case 'viaje':        renderViaje(renderLayout, navigateTo); break;
    case 'cotizador':    renderCotizador(renderLayout, navigateTo); break;
    default: renderPlaceholder(view); break;
  }
  
  // Re-pintar iconos al cambiar la vista
  setTimeout(() => {
    createIcons({
      icons: { LayoutDashboard, Package, ShoppingCart, Truck, Users, Activity, Settings, Settings2, Moon, Sun, Globe, Menu, LogOut, Shield, UserCircle, Calculator, Plane, FileText, Sparkles }
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

async function startApp() {
  const profile = auth.getProfile();

  if (!profile) {
    renderLogin(() => startApp());
    return;
  }

  // Cargar logo en background
  ConfigService.getLogo().then(url => {
    if (url) ConfigService.applyLogo(url);
  }).catch(() => {});

  // Cargar TRM en background — no bloquea la navegación
  TRMService.getTRMHoy().then(({ valor, fuente }) => {
    window.JARAPP_TRM = valor;
    window.JARAPP_TRM_FUENTE = fuente;

    // Actualizar badge en sidebar
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
  }).catch(() => {
    window.JARAPP_TRM = 4200;
    window.JARAPP_TRM_FUENTE = 'fallback';
  });

  // Ir al dashboard si tiene acceso, si no al primer módulo permitido
  if (auth.canAccess('dashboard')) {
    navigateTo('dashboard');
  } else {
    const firstModule = ['clients','inventory','sales','purchases','logistics','finance','params']
      .find(m => auth.canAccess(m));
    navigateTo(firstModule || 'settings');
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
}

// Arrancar App
bootApp();

// Registro del Service Worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[SW] Registro fallido:', err));
  });
}
