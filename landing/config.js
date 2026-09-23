// Único archivo a editar para reconfigurar la landing sin tocar el HTML.
window.ENCARGOSPRO_CONFIG = {
  // Formato internacional sin "+", ej: "573001234567".
  whatsapp: '573207761097',
  mensajeWhatsapp: 'Hola, quiero información sobre EncargosPro para mi negocio de importaciones.',

  // Mismo proyecto y anon key que usa la app (src/db.js) — la anon key es
  // segura para el cliente, las políticas RLS son las que protegen los
  // datos. Se usan para el registro "Empieza gratis" (auth.signUp /
  // signInWithOAuth) y para llamar a la Netlify Function que crea la
  // empresa de prueba.
  supabaseUrl: 'https://vygfsqdveudpzytnnhiq.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5Z2ZzcWR2ZXVkcHp5dG5uaGlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNTk2NjMsImV4cCI6MjA5MDYzNTY2M30.ZfkBk625C6X1Hgs51MRIB5TbRLYoztD1YS-QESL2x9M',

  // URL real de la app (sitio de Netlify aparte, dominio distinto a esta
  // landing) — ahí termina el registro y ahí debe loguearse el usuario
  // después. La función admin-empresas.js vive en ese mismo sitio.
  // Subdominio propio (app.encargospro.com) apuntando por CNAME al mismo
  // sitio de Netlify (importaciones-jarapo.netlify.app) — así "Iniciar
  // sesión" y el registro no saltan a un dominio .netlify.app distinto.
  appUrl: 'https://app.encargospro.com',
};
