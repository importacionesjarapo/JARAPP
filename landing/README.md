# Landing page — EncargosPro

Sitio estático independiente (sin build, sin dependencias) para la landing comercial de EncargosPro. No forma parte del build de la app principal (`npm run build` en la raíz no lo toca).

## Editar

- **Número de WhatsApp / mensaje prellenado**: un solo lugar, `config.js`.
- **Copy, planes y precios**: directamente en `index.html` (todo tiene comentarios `[placeholder]` donde falta contenido real — buscar "$XX.000" para los precios y la sección `.mockup-body` para la captura de pantalla pendiente).
- **Captura del producto**: reemplazar el bloque `<div class="mockup-body">...</div>` en `index.html` por una `<img>` real del Dashboard.

## Publicar como segundo sitio de Netlify

Este sitio se despliega **aparte** de la app principal (JARAPP/EncargosPro), con su propio dominio:

1. En Netlify → "Add new site" → "Import an existing project" → mismo repositorio de GitHub.
2. **Base directory**: `landing`
3. **Build command**: (vacío — no hay build)
4. **Publish directory**: `.` (ya viene resuelto por `landing/netlify.toml`)
5. Configurar el dominio propio de la landing en ese sitio de Netlify (distinto al de la app).

No comparte variables de entorno ni base de datos con la app — es solo marketing + un botón de WhatsApp.
