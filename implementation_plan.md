# Implementation Plan: Importaciones Jarapo Admin

This document outlines the architecture and execution steps for building the professional management application for **Importaciones Jarapo**, using **Google Sheets** as a cloud database and a modern **Vanilla JS + Vite** frontend.

## 1. Database Architecture (Google Sheets)

We will use a single Google Spreadsheet with multiple sheets (tabs) to serve as our relational database.

### Sheets & Schema

| Nombre de Pestaña | Columnas Clave |
| :--- | :--- |
| **Clientes** | `id`, `nombre`, `numero_identificacion`, `numero_lead_kommo`, `direccion`, `ciudad`, `whatsapp`, `fecha_registro` |
| **Productos** | `id`, `sku`, `nombre_producto`, `marca`, `categoria`, `precio_usd`, `precio_cop`, `stock_medellin`, `stock_miami`, `stock_transito`, `url_imagen`, `estado_producto` (Pendiente de compra / Producto Vendido / Entregado / Disponible) |
| **Ventas** | `id`, `cliente_id`, `producto_id`, `fecha`, `valor_total_cop`, `metodo_pago`, `estado_orden`, `id_seguimiento` |
| **Compras** | `id`, `proveedor`, `producto_id`, `cantidad`, `costo_usd`, `fecha_pedido`, `estado_compra`, `llegada_estimada` |
| **Logistica** | `id`, `id_seguimiento`, `fase` (Bodega/Transito/Aduana/Entrega), `ultima_actualizacion`, `ubicacion_actual` |
| **Configuracion** | `clave`, `valor` (ej: `trm_usd_cop`, `nombre_empresa`, `direccion_miami`) |

## 2. The Bridge: Google Apps Script (GAS)

To connect the frontend securely to Google Sheets, we will deploy a small Script as a Web App that acts as a JSON API (REST).

- **Functionality**:
  - `doGet(e)`: Handles data fetching (READ).
  - `doPost(e)`: Handles data modification (CREATE/UPDATE).
- **Security**: The script will be accessible via a `web_app_url` and will require a simple API Key or shared secret in the headers/params.

## 3. Frontend Architecture (Vite + Vanilla JS)

We will build a Single Page Application (SPA) with a component-based structure.

### Project Structure
- `src/main.js`: Entry point and Router (handles switching between Dashboard, Inventory, etc.).
- `src/db.js`: Service layer for fetching/sending data to the Google Apps Script.
- `src/style.css`: Core design system (Glassmorphism, Soft UI, Transitions).
- `src/views/`: Directory containing the HTML/Logic for each module:
  - `dashboard.js`
  - `inventory.js`
  - `sales.js`
  - `clients.js`
  - `finance.js`

## 4. Design System (Stitch Inspired)

- **Colors**:
  - Primary: `#E63946` (Vibrant Red)
  - Secondary: `#1D3557` (Deep Blue)
  - Surface: Translucent White/Grey (Glassmorphism)
- **Visuals**:
  - **Charts**: Interactive sales and stock reports using `Chart.js`.
  - **Icons**: Minimalist, professional iconography via `Lucide`.
  - **Experience**: Micro-interactions on buttons, smooth module transitions (fade/slide).

## 5. Next Steps

1. **GAS Deployment**: I will provide the GAS code for you to paste into your Google Sheet's script editor.
2. **Project Setup**: I will initialize the frontend files and design system.
3. **Module Implementation**: We will build the Dashboard first to verify the connection.

> [!IMPORTANT]
> To proceed, please create a new Google Sheet named **"Importaciones Jarapo DB"** and confirm you are ready for the GAS code.
