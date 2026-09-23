// Panel de Superadmin (Fase D del plan SaaS multi-tenant): las únicas
// operaciones que cruzan tenants (crear empresa, activar su primer admin,
// renovar/suspender suscripción, listar empresas) pasan por acá, usando la
// service role key — nunca desde el cliente con la anon key, para no tener
// que abrir un hueco especial en las políticas RLS del resto de la app.
import { createClient } from '@supabase/supabase-js'

// createClient revienta de forma síncrona si la URL no es válida — si
// SUPABASE_URL/SUPABASE_SERVICE_KEY faltan (ej. no configuradas para el
// contexto de Deploy Preview en Netlify), eso pasaba ANTES de que el
// handler pudiera responder, y Netlify devolvía un 502 en blanco. Se
// guarda para poder devolver un error JSON claro en su lugar.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

// Mismo template que ROLE_TEMPLATES.admin en src/auth.js — se duplica acá
// porque esta función corre en Node/Netlify, fuera del bundle de Vite.
const ADMIN_PERMISSIONS = {
  dashboard: true, clients: 'edit', inventory: 'edit', sales: 'edit',
  purchases: 'edit', logistics: 'edit', finance: 'edit', vendedores: 'edit', params: 'edit', documentacion: 'edit',
  calculadora: 'edit', admin: true, feat_money: true, feat_usa: true, feat_calc_desglose: true,
  cotizador_ver: true, cotizador_desglose: true, cotizador_pdf_cliente: true, cotizador_pdf_interno: true,
  calendario_ver: true, calendario_crear: true, calendario_editar: true, calendario_eliminar: true,
  calendario_plantilla_editar: true, calendario_fechas_editar: true,
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const res = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) })

// Categorías del catálogo de datos semilla editable (tabla
// "DatosSemillaGlobal", ver migración 024) — el superadmin las administra
// desde el panel ("🌱 Datos semilla") en vez de que queden fijas en código.
const CATEGORIAS_SEMILLA = ['MetodosPago', 'Marca', 'Tienda', 'Categoria', 'Genero']

// Copia el catálogo global a una empresa nueva (#27): "MetodosPago" se
// inserta tal cual en la tabla del mismo nombre (mismo esquema que usa
// Parametrización: id, nombre, color, activo, orden, empresa_id); el resto
// de categorías (Marca, Tienda, Categoria, Genero) se insertan en
// "Configuracion" con clave = categoria, que es la misma tabla/clave que ya
// usa Parametrización (src/views/params.js) para esas listas desplegables
// — así lo que sembramos aquí es indistinguible de lo que el usuario
// hubiera agregado a mano, y lo puede editar o borrar libremente después.
async function sembrarDatosBase(empresaId) {
  const { data: semillas, error } = await supabase
    .from('DatosSemillaGlobal').select('categoria, valor').order('orden')
  if (error) { console.warn('[admin-empresas] No se pudo leer DatosSemillaGlobal:', error.message); return }

  const metodosPago = (semillas || []).filter(s => s.categoria === 'MetodosPago')
  const configuracion = (semillas || []).filter(s => s.categoria !== 'MetodosPago')

  if (metodosPago.length) {
    const filas = metodosPago.map((s, i) => ({
      id: (Date.now() + i).toString(), nombre: s.valor, color: '#6B7280', activo: true, orden: i, empresa_id: empresaId,
    }))
    const { error: errMP } = await supabase.from('MetodosPago').insert(filas)
    if (errMP) console.warn('[admin-empresas] No se pudo sembrar MetodosPago:', errMP.message)
  }

  if (configuracion.length) {
    const filas = configuracion.map((s, i) => ({
      id: (Date.now() + 10000 + i).toString(), clave: s.categoria, valor: s.valor, empresa_id: empresaId,
    }))
    const { error: errCfg } = await supabase.from('Configuracion').insert(filas)
    if (errCfg) console.warn('[admin-empresas] No se pudo sembrar Configuracion:', errCfg.message)
  }
}

// Fase 3 (#11): texto del contrato de suscripción mostrado y aceptado
// durante el registro del trial. Se duplica en landing/index.html porque
// esa página es un sitio estático aparte que no pasa por este bundle de
// Netlify Functions ni por el de Vite — igual que ADMIN_PERMISSIONS arriba,
// cualquier cambio en el contrato debe replicarse a mano en ambos lugares.
//
// NOTA: los datos de identificación de ENCARGOS PRO (NIT, domicilio,
// representante legal) quedan como placeholders entre corchetes hasta que
// se confirmen — reemplazar antes de que un cliente real acepte este texto.
const CONTRATO_VERSION = 'v1-2026-09'
function buildContratoTexto({ nombreCompleto, nombreEmpresa, email }) {
  return `CONTRATO DE SUSCRIPCIÓN Y LICENCIA DE USO DE SOFTWARE COMO SERVICIO (SaaS) — PLATAFORMA "ENCARGOS PRO"

Entre los suscritos a saber:

1. Jarapo Asociados SAS, sociedad identificada con NIT 901.950.310-2, con domicilio principal en Bello (Antioquia), representada legalmente por Cristian Alexander Jaramillo Jaramillo, quien para efectos del presente contrato se denominará "ENCARGOS PRO" o "EL PRESTADOR".
2. ${nombreCompleto}, actuando en nombre de ${nombreEmpresa}, identificado con el correo electrónico ${email}, quien para efectos del presente contrato se denominará "EL SUSCRIPTOR" o "EL CLIENTE".

Ambas partes han decidido celebrar el presente Contrato de Suscripción (en adelante "el Contrato"), el cual se regirá por la legislación colombiana (en especial las Leyes 23 de 1982, 527 de 1999, 1480 de 2011, 1581 de 2012 y demás normas concordantes) y por las siguientes cláusulas, previas las siguientes:

CONSIDERACIONES PREVIAS

1. Que ENCARGOS PRO es titular, desarrollador y/o licenciatario exclusivo de la plataforma tecnológica de software como servicio (SaaS) denominada "Encargos Pro" (en adelante "la Plataforma"), destinada a la gestión, control y administración de encargos, pedidos, operaciones logísticas y/o tareas operativas.
2. Que ENCARGOS PRO presta, como parte integral e indivisible del servicio, el alojamiento (hosting) de la información del SUSCRIPTOR tanto en bases de datos como en infraestructura de almacenamiento en la nube (storage).
3. Que EL SUSCRIPTOR requiere acceder y utilizar la Plataforma bajo la modalidad de suscripción recurrente, manifestando haber leído, entendido y aceptado de manera voluntaria las condiciones técnicas, comerciales, legales y de precios aquí establecidas, bien sea mediante firma física o mediante mecanismos de aceptación electrónica en la Plataforma.

CLÁUSULA PRIMERA. OBJETO DEL CONTRATO
El presente Contrato tiene por objeto regular el otorgamiento de una licencia de uso no exclusiva, limitada, temporal y revocable sobre la Plataforma "Encargos Pro", así como la prestación del servicio de alojamiento (hosting) de datos y archivos en bases de datos y servicios de storage administrados por ENCARGOS PRO, a cambio del pago periódico y recurrente de una tarifa de suscripción, estableciendo de manera integral los derechos, responsabilidades, políticas de confidencialidad, seguridad y protección de propiedad intelectual de ambas partes.

CLÁUSULA SEGUNDA. PERIODO DE PRUEBA GRATUITO (FREE TRIAL)
Los nuevos suscriptores tendrán un periodo de prueba gratuito de veinte (20) días calendario para explorar y probar las funcionalidades de la Plataforma. Si al finalizar este plazo de 20 días el suscriptor no ha adquirido una suscripción de pago, el acceso a la Plataforma será suspendido automáticamente. Durante este periodo de prueba, todas las políticas de confidencialidad, seguridad, protección de datos y propiedad intelectual establecidas en este contrato aplican de manera estricta y vinculante.

CLÁUSULA TERCERA. DEFINICIONES

* Plataforma: El software, aplicaciones web, aplicaciones móviles, interfaces de programación (API), algoritmos, código fuente y objeto, bases de datos, diseños e infraestructura digital que componen "Encargos Pro".
* Suscripción: La modalidad contractual mediante la cual EL SUSCRIPTOR obtiene acceso temporal y no exclusivo a la Plataforma mediante el pago previo y recurrente de un precio.
* Información del Suscriptor / Datos del Cliente: Todo archivo, documento, base de datos, registro de clientes, pedidos, datos personales o contenido que EL SUSCRIPTOR o sus Usuarios Autorizados carguen, generen, procesen o almacenen en la Plataforma.
* Credenciales de Acceso: Nombre de usuario, contraseña, llaves de API, códigos de verificación y cualquier otro mecanismo de autenticación otorgado a EL SUSCRIPTOR para ingresar a la Plataforma.
* Usuarios Autorizados: Las personas naturales (empleados, colaboradores o contratistas) expresamente designadas por EL SUSCRIPTOR para acceder a la Plataforma dentro de los límites y cupos del plan contratado.
* SLA (Service Level Agreement): El compromiso del nivel de disponibilidad mensual del servicio ofrecido por ENCARGOS PRO.

CLÁUSULA CUARTA. LICENCIA DE USO Y RESTRICCIONES A LA DISTRIBUCIÓN
4.1. Otorgamiento: ENCARGOS PRO concede a EL SUSCRIPTOR, durante la vigencia del Contrato y sujeto al pago oportuno del precio, una licencia de uso limitada, no exclusiva, personal, intransferible, no sublicenciable y revocable para utilizar la Plataforma únicamente en el giro ordinario de sus actividades internas.

4.2. Prohibiciones expresas y protección de distribución: Queda estrictamente prohibido a EL SUSCRIPTOR y a sus Usuarios Autorizados:

* Distribuir, ceder, sublicenciar, arrendar, comercializar, revender o poner a disposición de terceros no autorizados el acceso a la Plataforma o sus funcionalidades.
* Copiar, reproducir, modificar, descompilar, realizar ingeniería inversa, desensamblar, traducir o intentar descubrir el código fuente, patrones de diseño o arquitectura de la Plataforma.
* Utilizar la Plataforma o sus contenidos para crear, desarrollar o alimentar productos o servicios competidores directos o indirectos de ENCARGOS PRO.
* Compartir las Credenciales de Acceso con personas ajenas a la organización o superar el número de usuarios permitidos en el plan contratado.
* Emplear herramientas automatizadas, bots, web scraping, o métodos masivos de extracción no autorizada de datos sobre la infraestructura de la Plataforma.
* Cargar o almacenar archivos con virus, código malicioso, malware, o datos ilegales que afecten la seguridad o estabilidad de la Plataforma.

4.3. Consecuencias del incumplimiento: Cualquier violación a esta cláusula facultará a ENCARGOS PRO a suspender o terminar de manera inmediata el contrato por justa causa, bloquear los accesos e iniciar las acciones penales y civiles correspondientes para la indemnización total de los daños y perjuicios causados.

CLÁUSULA QUINTA. PROPIEDAD INTELECTUAL, DERECHOS DE AUTOR E INDEMNIDAD
5.1. Titularidad de ENCARGOS PRO: La Plataforma, sus marcas, logotipos, nombres comerciales, código fuente y objeto, interfaces gráficas, documentación técnica, bases de datos y desarrollos derivados son de propiedad exclusiva de ENCARGOS PRO, protegidos por las Leyes 23 de 1982 y 1915 de 2018, la Decisión Andina 351 de 1993 y tratados internacionales. Nada en este Contrato transfiere titularidad de propiedad intelectual a EL SUSCRIPTOR.

5.2. Propiedad de la Información del Suscriptor: EL SUSCRIPTOR conserva en todo momento la propiedad y titularidad exclusiva sobre la Información y Datos que cargue o procese en la Plataforma. ENCARGOS PRO únicamente actúa como custodio y encargado del alojamiento.

5.3. Cláusula de Indemnidad por Contenidos: EL SUSCRIPTOR declara y garantiza que cuenta con todos los derechos de autor, licencias y autorizaciones sobre los documentos, imágenes o archivos que almacene en la Plataforma. EL SUSCRIPTOR mantendrá indemne a ENCARGOS PRO frente a cualquier reclamación, sanción, demanda o pleito judicial presentado por terceros o autoridades, derivado de la supuesta o real infracción de derechos de autor, marcas o propiedad intelectual de los archivos cargados por EL SUSCRIPTOR.

CLÁUSULA SEXTA. CONFIDENCIALIDAD
6.1. Definición: Constituye "Información Confidencial" toda información técnica, financiera, comercial, operativa, de clientes, códigos, secretos industriales o datos personales compartidos o alojados en virtud de este Contrato.

6.2. Obligaciones: Ambas partes se obligan a guardar estricta reserva de la Información Confidencial recibida de la otra parte, utilizando como mínimo el mismo grado de cuidado que aplican a su propia información confidencial (nunca inferior a un estándar razonable de la industria).

6.3. Duración: La obligación de confidencialidad se mantendrá vigente durante la ejecución del Contrato y por un término de cinco (5) años contados a partir de su terminación por cualquier causa.

CLÁUSULA SÉPTIMA. RESPONSABILIDADES Y GARANTÍAS DE ENCARGOS PRO
ENCARGOS PRO se compromete a:

1. Disponibilidad y Nivel de Servicio (SLA): Garantizar un nivel de disponibilidad mensual de la Plataforma del noventa y nueve por ciento (99.0% SLA), salvo mantenimientos programados informados previamente o eventos de fuerza mayor.
2. Infraestructura de Alojamiento: Proveer la capacidad de bases de datos y storage acordada en el plan contratado.
3. Copias de Respaldo (Backups): Ejecutar copias de seguridad periódicas de la información almacenada para garantizar la recuperabilidad en caso de contingencia técnica.
4. Seguridad y Confidencialidad: Proteger la información del cliente mediante controles de acceso y cifrado, no vendiendo ni divulgando la información a ningún tercero no autorizado.
5. Soporte Técnico: Atender requerimientos de soporte técnico dentro de los horarios e itinerarios definidos en la Plataforma.

CLÁUSULA OCTAVA. RESPONSABILIDADES Y DEBERES DEL SUSCRIPTOR
EL SUSCRIPTOR se compromete a:

1. Pagar oportunamente el valor de la Suscripción según el plan y tarifa vigentes.
2. Custodiar bajo estricta reserva sus Credenciales de Acceso y ser el único responsable por el uso que sus Usuarios Autorizados hagan del sistema.
3. Garantizar que la información cargada sea lícita, veraz y cuente con la autorización de los titulares de los datos.
4. Respetar los límites de uso de almacenamiento (storage), ancho de banda y cantidad de usuarios. ENCARGOS PRO podrá restringir o cobrar tarifas adicionales si el suscriptor supera desproporcionadamente el consumo estipulado.
5. Notificar a ENCARGOS PRO en un plazo no mayor a 24 horas sobre cualquier sospecha de vulneración a sus credenciales de acceso.

CLÁUSULA NOVENA. PRECIOS, MODIFICACIÓN DE TARIFAS Y FORMA DE PAGO
9.1. Planes y Tarifas: EL SUSCRIPTOR pagará a ENCARGOS PRO el valor correspondiente al plan seleccionado en la Plataforma o en el formulario de contratación (Básico, Profesional o Empresarial).

9.2. Modalidad y Cobro Anticipado: Los pagos se realizarán por adelantado de manera recurrente (mensual o anual) mediante los canales de pago autorizados (pasarelas de pago, tarjeta de crédito, PSE o transferencia). La renovación del servicio es automática salvo notificación en contrario.

9.3. Facultad de Ajuste y Modificación de Precios: ENCARGOS PRO se reserva el derecho de ajustar o modificar los precios de las suscripciones en cualquier momento durante la vigencia del contrato. Para que el ajuste sea efectivo, ENCARGOS PRO notificará a EL SUSCRIPTOR con una antelación mínima de quince (15) días calendario a través del correo electrónico registrado o mediante un aviso destacado en la Plataforma. Si EL SUSCRIPTOR no acepta el nuevo precio, podrá cancelar su suscripción antes de la fecha de entrada en vigencia del reajuste, sin sanción alguna. El uso continuado del servicio o el pago del siguiente período constituirá la aceptación expresa del nuevo valor.

9.4. Suspensión por Mora: El no pago oportuno de la Suscripción facultará a ENCARGOS PRO para suspender el acceso de los usuarios generales a la medianoche (12:00 AM) de la fecha de vencimiento. La cuenta del administrador conservará permisos de solo lectura ("permisos de lectura") por un periodo máximo de tres (3) días calendario posteriores al vencimiento para revisión de información. Transcurridos estos 3 días, el acceso será restringido totalmente y comenzará el periodo de exportación de 30 días.

CLÁUSULA DÉCIMA. VIGENCIA
El presente contrato tendrá una duración igual al período de suscripción contratado (mensual o anual) y se renovará automáticamente por períodos idénticos de manera sucesiva, a menos que cualquiera de las partes manifieste su decisión de cancelarlo conforme a la Cláusula Décima Primera.

CLÁUSULA DÉCIMA PRIMERA. POLÍTICA DE CANCELACIÓN Y RETIRO
11.1. Cancelación Voluntaria: EL SUSCRIPTOR podrá cancelar su suscripción en cualquier momento desde el panel de configuración de la Plataforma o mediante solicitud escrita enviada al soporte técnico.

11.2. Efectos del Retiro: La cancelación detendrá la renovación del siguiente ciclo de facturación. EL SUSCRIPTOR mantendrá el acceso al servicio hasta la finalización del período ya pagado. No habrá lugar a reembolsos ni devoluciones de dinero por períodos parciales transcurridos, salvo lo previsto para el derecho de retracto.

11.3. Derecho de Retracto Legal: De conformidad con el artículo 47 de la Ley 1480 de 2011 (Estatuto del Consumidor de Colombia), cuando la contratación se realice por medios electrónicos, EL SUSCRIPTOR podrá ejercer el derecho de retracto dentro de los cinco (5) días hábiles siguientes a la compra, siempre y cuando no haya hecho uso efectivo de las funcionalidades operativas de la Plataforma, procediendo la devolución íntegra del dinero.

CLÁUSULA DÉCIMA SEGUNDA. SEGURIDAD DE LA INFORMACIÓN EN BASE DE DATOS Y STORAGE
12.1. Alojamiento y Proveedores de Nube: La información se alojará en servidores seguros (propios o de terceros internacionales reconocidos como AWS, Google Cloud o Microsoft Azure) bajo estándares de seguridad reconocidos en la industria.

12.2. Medidas Técnicas Implementadas:

* Cifrado de datos en tránsito (Protocolo HTTPS / TLS) y en reposo cuando aplique.
* Segregación lógica de datos entre cuentas de suscriptores para evitar acceso cruzado.
* Autenticación restringida basada en roles.
* Copias de respaldo (backups) automáticas periódicas.

12.3. Notificación de Incidentes: En caso de detectarse un incidente de seguridad que comprometa la confidencialidad de la información, ENCARGOS PRO notificará a EL SUSCRIPTOR dentro de las setenta y dos (72) horas siguientes a la confirmación técnica del evento, detallando las medidas correctivas adoptadas.

CLÁUSULA DÉCIMA TERCERA. TRATAMIENTO DE LA INFORMACIÓN EN CASO DE RETIRO O TERMINACIÓN
13.1. Período de Gracia para Exportación (30 Días): Finalizada la suscripción por cualquier causa, la cuenta entrará en modo de deshabilitación operativa, concediendo a EL SUSCRIPTOR un plazo improrrogable de treinta (30) días calendario para descargar e exportar la totalidad de su información y archivos desde la Plataforma.

13.2. Eliminación Definitiva de Datos: Transcurridos los treinta (30) días de gracia sin que la cuenta haya sido reactivada o los datos descargados, ENCARGOS PRO procederá a la eliminación segura y permanente de toda la información, bases de datos y archivos almacenados en el storage, sin que conserve copias activas y liberando a ENCARGOS PRO de cualquier responsabilidad por la pérdida de datos subsiguiente.

13.3. Certificación de Supresión: A solicitud expresa de EL SUSCRIPTOR dentro del término legal, ENCARGOS PRO emitirá una certificación escrita confirmando la destrucción de los datos personales y archivos de sus servidores.

CLÁUSULA DÉCIMA CUARTA. PROTECCIÓN DE DATOS PERSONALES (HABEAS DATA)
14.1. En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013 de la República de Colombia, EL SUSCRIPTOR actúa en calidad de Responsable del Tratamiento de los datos personales cargados en la Plataforma, y ENCARGOS PRO actúa como Encargado del Tratamiento.

14.2. ENCARGOS PRO únicamente tratará los datos conforme a las instrucciones del SUSCRIPTOR y para la ejecución de los servicios del software, absteniéndose de aplicarlos con fines propios de comercialización a terceros. EL SUSCRIPTOR garantiza expresamente que cuenta con la autorización previa e informada de los titulares de los datos cargados.

CLÁUSULA DÉCIMA QUINTA. LIMITACIÓN DE RESPONSABILIDAD
15.1. ENCARGOS PRO no será responsable por lucro cesante, pérdidas indirectas, daños emergentes, pérdida de negocios o interrupción de actividades comerciales derivadas del mal uso de la Plataforma por parte de EL SUSCRIPTOR.

15.2. La responsabilidad total acumulada de ENCARGOS PRO frente a EL SUSCRIPTOR por cualquier concepto estará limitada como máximo a la suma efectivamente pagada por EL SUSCRIPTOR a ENCARGOS PRO en los últimos seis (6) meses anteriores al hecho generador de la reclamación.

CLÁUSULA DÉCIMA SEXTA. ACEPTACIÓN ELECTRÓNICA (VALIDEZ LEGAL CLICKWRAP)
De conformidad con la Ley 527 de 1999 de Comercio Electrónico de Colombia, la aceptación de este Contrato mediante mecanismos digitales, tales como marcar la casilla "Acepto Términos y Condiciones", presionar el botón de registro/pago, o la utilización continuada del servicio, producirá los mismos efectos jurídicos y vinculantes que la firma manuscrita, constituyendo plena prueba de la voluntad de las partes.

CLÁUSULA DÉCIMA SÉPTIMA. MEJORAS Y SOLICITUDES PERSONALIZADAS
ENCARGOS PRO trabajará continuamente en actualizaciones y mejoras de la Plataforma basadas en los planes de suscripción para proporcionar mayor valor. En caso de que EL SUSCRIPTOR solicite modificaciones personalizadas o funcionalidades dedicadas para su empresa, estas deberán ser evaluadas por las directivas de ENCARGOS PRO para determinar su viabilidad técnica, alineación con la hoja de ruta (roadmap) y los posibles costos adicionales que dichas solicitudes puedan generar.

CLÁUSULA DÉCIMA OCTAVA. LEY APLICABLE Y JURISDICCIÓN
El presente Contrato se regirá e interpretará bajo las leyes de la República de Colombia. Cualquier controversia será sometida en primera instancia a arreglo directo entre las partes dentro de un plazo de quince (15) días hábiles. De no llegar a un acuerdo, las partes acudirán a los jueces ordinarios de la ciudad de Bello (Antioquia), Colombia.

Leído, entendido y aceptado electrónicamente por el SUSCRIPTOR al momento de crear su cuenta o realizar el pago en la plataforma "Encargos Pro".`
}

/** Envía por correo (Resend API) la copia del contrato aceptado. No lanza
 * si falla — el registro de la empresa/perfil ya se hizo y no debe
 * revertirse por un problema de envío; el error queda logueado en la fila
 * de ContratosAceptados para poder reintentar/revisar manualmente. */
async function enviarCorreoContrato({ email, nombreCompleto, textoContrato }) {
  if (!process.env.RESEND_API_KEY) return { enviado: false, error: 'RESEND_API_KEY no configurada' }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'EncargosPro <no-reply@mail.encargospro.com>',
        to: [email],
        subject: 'Tu contrato de suscripción a EncargosPro',
        html: `<p>Hola ${nombreCompleto || ''},</p><p>Gracias por registrarte en EncargosPro. Adjunto va la copia del contrato de suscripción que aceptaste al crear tu cuenta.</p><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.5;">${textoContrato.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
      }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      return { enviado: false, error: data.message || `Resend respondió ${resp.status}` }
    }
    return { enviado: true }
  } catch (err) {
    return { enviado: false, error: err.message }
  }
}

/** Código de referido corto y legible a partir del slug — único por el
 * sufijo aleatorio, no depende de que el slug ya lo sea. */
function generarCodigoReferido(slug) {
  const base = (slug || 'empresa').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'EMPRESA'
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

/** Verifica el JWT del caller y confirma que su perfil tiene role='superadmin'. */
async function verificarSuperadmin(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: userData, error: errUser } = await supabase.auth.getUser(token)
  if (errUser || !userData?.user) return null

  const { data: profile, error: errProfile } = await supabase
    .from('user_profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (errProfile || profile?.role !== 'superadmin') return null

  return userData.user
}

/** Verifica el JWT del caller sin exigir ningún rol — usado por la acción de
 * autoservicio (crear_empresa_trial), que cualquier usuario recién
 * registrado desde la landing puede llamar sobre su propia cuenta. */
async function verificarUsuarioAutenticado(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: userData, error } = await supabase.auth.getUser(token)
  if (error || !userData?.user) return null
  return userData.user
}

/** Lista TODOS los objetos de un bucket plano, con páginas grandes para minimizar viajes de red. */
async function listarBucketCompleto(bucket) {
  const objetos = []
  let offset = 0
  const LIMITE = 1000
  while (true) {
    const { data: pagina, error } = await supabase.storage.from(bucket).list('', { limit: LIMITE, offset })
    if (error) throw new Error(`Listando ${bucket}: ${error.message}`)
    objetos.push(...(pagina || []))
    if (!pagina || pagina.length < LIMITE) break
    offset += LIMITE
  }
  return objetos
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' })
  if (!supabase) return res(500, { error: 'Función mal configurada: faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en este entorno de Netlify.' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return res(400, { error: 'JSON inválido' }) }
  const { accion } = body
  const authHeader = event.headers.authorization || event.headers.Authorization

  // crear_empresa_trial es autoservicio: la llama cualquier usuario recién
  // registrado desde la landing sobre SU PROPIA cuenta, no un superadmin.
  // Todo lo demás en este archivo sigue exigiendo role='superadmin'.
  let caller
  if (accion === 'crear_empresa_trial') {
    caller = await verificarUsuarioAutenticado(authHeader)
    if (!caller) return res(401, { error: 'Sesión no válida. Inicia sesión de nuevo e intenta otra vez.' })
  } else {
    caller = await verificarSuperadmin(authHeader)
    if (!caller) return res(403, { error: 'Solo el superadmin puede usar este panel.' })
  }

  // ── LISTAR EMPRESAS ──
  if (accion === 'listar_empresas') {
    const { data: empresas, error } = await supabase
      .from('Empresas').select('*').order('created_at', { ascending: false })
    if (error) return res(500, { error: error.message })

    const { data: perfiles } = await supabase.from('user_profiles').select('empresa_id')
    const counts = {}
    for (const p of perfiles || []) {
      if (p.empresa_id) counts[p.empresa_id] = (counts[p.empresa_id] || 0) + 1
    }
    return res(200, { ok: true, empresas: empresas.map(e => ({ ...e, num_usuarios: counts[e.id] || 0 })) })
  }

  // ── CREAR EMPRESA + PRIMER ADMIN ──
  if (accion === 'crear_empresa') {
    const { nombre, slug, plan, nombreAdmin, emailAdmin, passwordAdmin } = body
    if (!nombre || !slug || !nombreAdmin || !emailAdmin || !passwordAdmin) {
      return res(400, { error: 'nombre, slug, nombreAdmin, emailAdmin y passwordAdmin son obligatorios.' })
    }

    const planId = plan || 'basico'
    // Validar contra el catálogo real — una empresa con un plan_id que no
    // existe en "Planes" queda sin restricción alguna en el sidebar
    // (getPlanModules() lo trata como "sin catálogo = no bloquear nada"),
    // así que un typo acá terminaría regalando todos los módulos.
    const { data: planExiste, error: errPlanExiste } = await supabase
      .from('Planes').select('id').eq('id', planId).maybeSingle()
    if (errPlanExiste) return res(500, { error: errPlanExiste.message })
    if (!planExiste) return res(400, { error: `El plan "${planId}" no existe en el catálogo.` })

    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas')
      .insert({ nombre, slug, plan: planId, estado_suscripcion: 'trial', codigo_referido: generarCodigoReferido(slug) })
      .select().single()
    if (errEmpresa) return res(400, { error: errEmpresa.message })
    await sembrarDatosBase(empresa.id)

    const { data: authUser, error: errAuth } = await supabase.auth.admin.createUser({
      email: emailAdmin, password: passwordAdmin, email_confirm: true,
      user_metadata: { full_name: nombreAdmin },
    })
    if (errAuth) {
      // No dejar una Empresa huérfana sin admin si signup falla.
      await supabase.from('Empresas').delete().eq('id', empresa.id)
      return res(400, { error: errAuth.message })
    }

    const { error: errProfile } = await supabase.from('user_profiles').upsert({
      id: authUser.user.id, full_name: nombreAdmin, email: emailAdmin,
      role: 'admin', permissions: ADMIN_PERMISSIONS, is_active: true,
      empresa_id: empresa.id,
    }, { onConflict: 'id' })
    if (errProfile) return res(500, { error: errProfile.message })

    return res(200, { ok: true, empresa, admin: { id: authUser.user.id, email: emailAdmin } })
  }

  // ── RENOVAR / SUSPENDER SUSCRIPCIÓN ──
  if (accion === 'actualizar_suscripcion') {
    const { empresa_id, estado_suscripcion, fecha_vencimiento, fecha_activacion, plan } = body
    const validos = ['activa', 'vencida', 'trial', 'cancelada']
    if (!empresa_id || !validos.includes(estado_suscripcion)) {
      return res(400, { error: `empresa_id requerido y estado_suscripcion debe ser uno de: ${validos.join(', ')}` })
    }

    const updates = { estado_suscripcion }
    if (fecha_vencimiento !== undefined) updates.fecha_vencimiento = fecha_vencimiento
    if (fecha_activacion !== undefined) updates.fecha_activacion = fecha_activacion
    if (plan !== undefined) {
      const { data: planExiste, error: errPlanExiste } = await supabase
        .from('Planes').select('id').eq('id', plan).maybeSingle()
      if (errPlanExiste) return res(500, { error: errPlanExiste.message })
      if (!planExiste) return res(400, { error: `El plan "${plan}" no existe en el catálogo.` })
      updates.plan = plan
    }

    const { data, error } = await supabase.from('Empresas').update(updates).eq('id', empresa_id).select().single()
    if (error) return res(400, { error: error.message })
    return res(200, { ok: true, empresa: data })
  }

  // ── PAGOS DE SUSCRIPCIÓN (cada empresa hacia EncargosPro) ──

  if (accion === 'listar_pagos') {
    const { empresa_id } = body
    if (!empresa_id) return res(400, { error: 'empresa_id es obligatorio.' })
    const { data, error } = await supabase
      .from('PagosSuscripciones').select('*').eq('empresa_id', empresa_id).order('fecha_pago', { ascending: false })
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, pagos: data })
  }

  if (accion === 'registrar_pago') {
    const { empresa_id, monto, fecha_pago, metodo_pago, periodo_desde, periodo_hasta, notas } = body
    if (!empresa_id || !monto || !fecha_pago) {
      return res(400, { error: 'empresa_id, monto y fecha_pago son obligatorios.' })
    }
    if (Number(monto) <= 0) return res(400, { error: 'El monto debe ser mayor a 0.' })

    const { data: pago, error: errPago } = await supabase
      .from('PagosSuscripciones')
      .insert({ empresa_id, monto, fecha_pago, metodo_pago: metodo_pago || null, periodo_desde: periodo_desde || null, periodo_hasta: periodo_hasta || null, notas: notas || null })
      .select().single()
    if (errPago) return res(500, { error: errPago.message })

    // fecha_ultimo_pago es un espejo de conveniencia — el historial real
    // vive en PagosSuscripciones. Solo se avanza (nunca retrocede) para no
    // pisar un pago posterior con uno cargado tarde/retroactivo.
    const { data: empresaActual } = await supabase.from('Empresas').select('fecha_ultimo_pago').eq('id', empresa_id).maybeSingle()
    if (!empresaActual?.fecha_ultimo_pago || fecha_pago > empresaActual.fecha_ultimo_pago) {
      await supabase.from('Empresas').update({ fecha_ultimo_pago: fecha_pago }).eq('id', empresa_id)
    }

    return res(200, { ok: true, pago })
  }

  // ── POLÍTICA DE SOLO-LECTURA AL VENCER ──
  // La lectura (obtener_politica_suscripcion) no hace falta acá — la tabla
  // "PoliticaSuscripcion" tiene SELECT público (ver migración 022), así que
  // la app la consulta directo con la anon key. Solo la escritura pasa por
  // acá, exigiendo superadmin.
  if (accion === 'guardar_politica_suscripcion') {
    const { dias_gracia_solo_lectura, descuento_referido_pct, comision_referido_pct } = body
    if (dias_gracia_solo_lectura === undefined || dias_gracia_solo_lectura < 0) {
      return res(400, { error: 'dias_gracia_solo_lectura debe ser un número mayor o igual a 0.' })
    }
    const updates = { dias_gracia_solo_lectura, updated_at: new Date().toISOString() }
    if (descuento_referido_pct !== undefined) {
      if (descuento_referido_pct < 0 || descuento_referido_pct > 100) {
        return res(400, { error: 'descuento_referido_pct debe estar entre 0 y 100.' })
      }
      updates.descuento_referido_pct = descuento_referido_pct
    }
    if (comision_referido_pct !== undefined) {
      if (comision_referido_pct < 0 || comision_referido_pct > 100) {
        return res(400, { error: 'comision_referido_pct debe estar entre 0 y 100.' })
      }
      updates.comision_referido_pct = comision_referido_pct
    }
    const { data, error } = await supabase
      .from('PoliticaSuscripcion')
      .update(updates)
      .eq('id', 1).select().single()
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, politica: data })
  }

  // ── EXPORTAR TODOS LOS DATOS DE UNA EMPRESA (#30) ──
  // Pensado para cuando una empresa cancela: le entregamos toda su
  // información en un archivo antes de bloquearle el acceso. Trae cada
  // tabla de negocio filtrada por empresa_id — el front (superadmin.js)
  // arma el Excel con una hoja por tabla usando la librería xlsx que ya
  // usa el resto de la app para exportar reportes.
  if (accion === 'exportar_datos_empresa') {
    const { empresa_id } = body
    if (!empresa_id) return res(400, { error: 'empresa_id es obligatorio.' })

    const TABLAS = [
      'Ventas', 'Clientes', 'Productos', 'Logistica', 'Gastos', 'Compras',
      'Abonos', 'GuiasInternacionales', 'MetodosPago', 'viajes', 'Configuracion',
    ]
    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas').select('*').eq('id', empresa_id).maybeSingle()
    if (errEmpresa) return res(500, { error: errEmpresa.message })
    if (!empresa) return res(404, { error: 'Empresa no encontrada.' })

    const resultados = await Promise.all(
      TABLAS.map(t => supabase.from(t).select('*').eq('empresa_id', empresa_id))
    )
    const datos = {}
    for (let i = 0; i < TABLAS.length; i++) {
      const { data, error } = resultados[i]
      if (error) return res(500, { error: `Exportando ${TABLAS[i]}: ${error.message}` })
      datos[TABLAS[i]] = data || []
    }

    return res(200, { ok: true, empresa, datos })
  }

  // ── CATÁLOGO DE DATOS SEMILLA (#27) — editable desde Superadmin ──
  if (accion === 'listar_datos_semilla') {
    const { data, error } = await supabase
      .from('DatosSemillaGlobal').select('*').order('categoria').order('orden')
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, items: data || [] })
  }

  if (accion === 'guardar_dato_semilla') {
    const { categoria, valor } = body
    if (!CATEGORIAS_SEMILLA.includes(categoria)) {
      return res(400, { error: `categoria debe ser una de: ${CATEGORIAS_SEMILLA.join(', ')}` })
    }
    if (!valor || !valor.trim()) return res(400, { error: 'valor es obligatorio.' })

    const { count } = await supabase
      .from('DatosSemillaGlobal').select('id', { count: 'exact', head: true }).eq('categoria', categoria)
    const { data, error } = await supabase
      .from('DatosSemillaGlobal').insert({ categoria, valor: valor.trim(), orden: count || 0 }).select().single()
    if (error) return res(400, { error: error.message.includes('duplicate') ? `"${valor}" ya existe en ${categoria}.` : error.message })
    return res(200, { ok: true, item: data })
  }

  if (accion === 'eliminar_dato_semilla') {
    const { id } = body
    if (!id) return res(400, { error: 'id es obligatorio.' })
    const { error } = await supabase.from('DatosSemillaGlobal').delete().eq('id', id)
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true })
  }

  // ── MIGRAR IMÁGENES DEL BUCKET VIEJO "jarapo-images" (Tenant #1) ──
  // Antes de la Fase B, fotos de producto, logo y comprobantes de pago
  // vivían todos juntos en un único bucket plano y público. Se divide en
  // dos acciones para no toparse con el timeout de ~10s de las funciones
  // síncronas de Netlify: un "plan" de solo lectura (rápido, sin importar
  // cuántos archivos haya) y lotes pequeños de copiado real, que el
  // cliente va llamando uno por uno. NO borra nada del bucket viejo — el
  // borrado queda como paso manual aparte una vez confirmado que todo se
  // ve bien.

  async function empresaIdJarapo() {
    const { data: jarapo, error } = await supabase
      .from('Empresas').select('id').eq('slug', 'jarapo').maybeSingle()
    if (error) throw new Error(error.message)
    if (!jarapo) throw new Error('No se encontró una empresa con slug="jarapo".')
    return jarapo.id
  }

  // Referencias conocidas a archivos de jarapo-images, por tabla/columna.
  const REFERENCIAS_IMAGENES = [
    { tabla: 'Productos', columna: 'url_imagen',              categoria: 'productos' },
    { tabla: 'Ventas',    columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Ventas',    columna: 'comprobante_ultimo_abono', categoria: 'comprobantes' },
    { tabla: 'Abonos',    columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Compras',   columna: 'comprobante_url',          categoria: 'comprobantes' },
    { tabla: 'Gastos',    columna: 'comprobante_url',          categoria: 'comprobantes' },
  ]

  if (accion === 'plan_migracion_imagenes') {
    try {
      const empresaId = await empresaIdJarapo()

      // Todas las consultas de referencias (6 tablas + Configuracion) y el
      // listado del bucket corren en paralelo, no en cadena — con varios
      // años de datos, hacerlo secuencial fue lo que agotó los ~10s de la
      // función síncrona en el intento anterior.
      const [resultadosRefs, logoResult, objetos] = await Promise.all([
        Promise.all(REFERENCIAS_IMAGENES.map(ref =>
          supabase.from(ref.tabla).select(`id, ${ref.columna}`)
            .eq('empresa_id', empresaId).not(ref.columna, 'is', null)
            .then(({ data, error }) => {
              if (error) throw new Error(`Leyendo ${ref.tabla}.${ref.columna}: ${error.message}`)
              return { ref, filas: data || [] }
            })
        )),
        supabase.from('Configuracion').select('id, valor').eq('empresa_id', empresaId).eq('clave', 'GLOBAL_LOGO')
          .then(({ data, error }) => {
            if (error) throw new Error(`Leyendo Configuracion: ${error.message}`)
            return data || []
          }),
        listarBucketCompleto('jarapo-images'),
      ])

      // Mapa oldUrl -> { tabla, columna, id, categoria }
      const referenciasPorUrl = new Map()
      for (const { ref, filas } of resultadosRefs) {
        for (const fila of filas) {
          const url = fila[ref.columna]
          if (url) referenciasPorUrl.set(url, { tabla: ref.tabla, columna: ref.columna, id: fila.id, categoria: ref.categoria })
        }
      }
      for (const fila of logoResult) {
        if (fila.valor) referenciasPorUrl.set(fila.valor, { tabla: 'Configuracion', columna: 'valor', id: fila.id, categoria: 'logos' })
      }

      const oldBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/jarapo-images/`
      const porMigrar = []
      const huerfanos = []
      for (const obj of objetos) {
        if (!obj.id) continue // carpetas: la API de Storage las lista sin id
        const match = referenciasPorUrl.get(oldBase + obj.name)
        if (match) porMigrar.push({ archivo: obj.name, ...match })
        else huerfanos.push(obj.name)
      }

      return res(200, { ok: true, empresaId, totalObjetos: objetos.length, porMigrar, huerfanos })
    } catch (e) {
      return res(500, { error: e.message })
    }
  }

  // Procesa un lote chico (lo decide el cliente, ideal 5-10) de los
  // archivos que ya vinieron marcados como "porMigrar" en el plan.
  if (accion === 'migrar_lote_imagenes') {
    const { empresaId, archivos } = body
    if (!empresaId || !Array.isArray(archivos) || archivos.length === 0) {
      return res(400, { error: 'empresaId y archivos (array) son obligatorios.' })
    }

    const resultado = { migrados: [], errores: [] }
    for (const item of archivos) {
      const { archivo, tabla, columna, id, categoria } = item
      try {
        const { data: bytes, error: errDown } = await supabase.storage.from('jarapo-images').download(archivo)
        if (errDown) throw errDown

        const bucketNuevo = categoria === 'comprobantes' ? 'comprobantes-privado' : 'productos-publico'
        const pathNuevo = `${categoria}/${empresaId}/${archivo}`

        const { error: errUp } = await supabase.storage.from(bucketNuevo)
          .upload(pathNuevo, bytes, { upsert: true, contentType: bytes.type || undefined })
        if (errUp) throw errUp

        let urlNueva
        if (bucketNuevo === 'productos-publico') {
          urlNueva = supabase.storage.from(bucketNuevo).getPublicUrl(pathNuevo).data?.publicUrl
        } else {
          const { data: firmada, error: errFirma } = await supabase.storage
            .from(bucketNuevo).createSignedUrl(pathNuevo, 60 * 60 * 24 * 365 * 10)
          if (errFirma) throw errFirma
          urlNueva = firmada.signedUrl
        }

        const { error: errUpdate } = await supabase.from(tabla).update({ [columna]: urlNueva }).eq('id', id)
        if (errUpdate) throw errUpdate

        resultado.migrados.push({ archivo, tabla, columna, id })
      } catch (e) {
        resultado.errores.push({ archivo, error: e.message })
      }
    }

    return res(200, { ok: true, ...resultado })
  }

  // ── CATÁLOGO DE PLANES (Prueba/Básico/Pro/Empresarial) ──

  // Listar los 4 planes con sus módulos y límites — panel de superadmin.
  if (accion === 'listar_planes') {
    const { data, error } = await supabase.from('Planes').select('*').order('orden')
    if (error) return res(500, { error: error.message })
    return res(200, { ok: true, planes: data })
  }

  // Actualiza un plan del catálogo (módulos incluidos, límite de usuarios,
  // días de prueba si aplica). No crea planes nuevos — los 4 vienen
  // sembrados por la migración 021_planes_catalogo.sql.
  if (accion === 'guardar_plan') {
    const { plan_id, max_usuarios, dias_prueba, modulos } = body
    if (!plan_id) return res(400, { error: 'plan_id es obligatorio.' })
    if (!modulos || typeof modulos !== 'object') {
      return res(400, { error: 'modulos es obligatorio.' })
    }
    const updates = { modulos, updated_at: new Date().toISOString() }
    if (max_usuarios !== undefined) updates.max_usuarios = max_usuarios
    if (dias_prueba !== undefined) updates.dias_prueba = dias_prueba
    const { data, error } = await supabase.from('Planes')
      .update(updates).eq('id', plan_id).select().maybeSingle()
    if (error) return res(500, { error: error.message })
    if (!data) return res(404, { error: `No existe el plan "${plan_id}".` })
    return res(200, { ok: true, plan: data })
  }

  // Crea la empresa + perfil admin del usuario que se acaba de registrar
  // solo desde la landing (self-serve) — nunca desde un superadmin. El
  // caller ya viene verificado como "cualquier usuario autenticado" más
  // arriba; acá solo falta que no tenga ya una empresa asociada.
  if (accion === 'crear_empresa_trial') {
    const { nombreCompleto, nombreEmpresa, codigoReferido, contratoAceptado } = body
    if (!nombreCompleto || !nombreEmpresa) {
      return res(400, { error: 'nombreCompleto y nombreEmpresa son obligatorios.' })
    }
    // #11: sin aceptación explícita del contrato de suscripción no se crea
    // la empresa — el checkbox de la landing solo se habilita tras hacer
    // scroll hasta el final del texto (ver auth-screen-contrato).
    if (contratoAceptado !== true) {
      return res(400, { error: 'Debes leer y aceptar el contrato de suscripción para continuar.' })
    }

    const { data: perfilExistente, error: errPerfil } = await supabase
      .from('user_profiles').select('id, empresa_id').eq('id', caller.id).maybeSingle()
    if (errPerfil) return res(500, { error: errPerfil.message })
    if (perfilExistente?.empresa_id) {
      return res(400, { error: 'Esta cuenta ya tiene una empresa activa. Inicia sesión en la app en vez de crear una nueva.' })
    }

    const { data: planTrial, error: errPlan } = await supabase
      .from('Planes').select('*').eq('id', 'trial').maybeSingle()
    if (errPlan) return res(500, { error: errPlan.message })
    const diasPrueba = planTrial?.dias_prueba ?? 7

    // Código de referido opcional: si viene y existe, queda registrado en
    // "referido_por" para que el superadmin sepa a quién aplicarle la
    // comisión (PoliticaSuscripcion.comision_referido_pct) y al nuevo
    // tenant el descuento (descuento_referido_pct) al facturarle — ambos
    // se aplican a mano porque los pagos de esta app se registran a mano,
    // no hay pasarela de cobro. Un código inválido no bloquea el registro,
    // solo se ignora.
    let referidoPorId = null
    if (codigoReferido && codigoReferido.trim()) {
      const { data: empresaReferente } = await supabase
        .from('Empresas').select('id').eq('codigo_referido', codigoReferido.trim().toUpperCase()).maybeSingle()
      referidoPorId = empresaReferente?.id || null
    }

    // Slug único a partir del nombre — no puede depender de que el usuario
    // elija uno bueno (a diferencia de crear_empresa, que sí lo pide).
    const slugBase = nombreEmpresa.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'empresa'
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 7)}`

    const fechaVencimiento = new Date()
    fechaVencimiento.setDate(fechaVencimiento.getDate() + diasPrueba)

    const { data: empresa, error: errEmpresa } = await supabase
      .from('Empresas')
      .insert({
        nombre: nombreEmpresa, slug, plan: 'trial', estado_suscripcion: 'trial',
        fecha_vencimiento: fechaVencimiento.toISOString().split('T')[0],
        codigo_referido: generarCodigoReferido(slug), referido_por: referidoPorId,
      })
      .select().single()
    if (errEmpresa) return res(400, { error: errEmpresa.message })
    await sembrarDatosBase(empresa.id)

    // El usuario de trial recibe el mismo nivel de permisos "admin" que un
    // admin de empresa paga (ADMIN_PERMISSIONS) — es la única persona del
    // trial, así que dentro de su cuenta puede operar cualquier módulo sin
    // restricción de ROL. Qué módulos ve disponibles de verdad lo decide el
    // catálogo "Planes" (tabla Planes, fila 'trial'), que la app consulta
    // aparte vía auth.getPlan()/isModuleLockedByPlan() para pintar en el
    // sidebar los módulos no incluidos como bloqueados (candado + upsell)
    // en vez de ocultarlos — separar "qué puede hacer este usuario" de "qué
    // trae contratado la empresa" es lo que corrige el bug de que un trial
    // veía todo (antes ambas cosas vivían mezcladas en `permissions`).
    const { error: errProfile } = await supabase.from('user_profiles').upsert({
      id: caller.id, full_name: nombreCompleto, email: caller.email,
      role: 'admin', permissions: ADMIN_PERMISSIONS, is_active: true,
      empresa_id: empresa.id,
    }, { onConflict: 'id' })
    if (errProfile) {
      // No dejar una Empresa huérfana si el perfil falla.
      await supabase.from('Empresas').delete().eq('id', empresa.id)
      return res(500, { error: errProfile.message })
    }

    // #11: registrar la aceptación (con snapshot exacto del texto mostrado)
    // y enviarle al suscriptor una copia por correo. Un fallo acá no debe
    // tumbar el registro que ya se completó — la empresa y el perfil ya
    // existen — así que solo se loguea en la fila de auditoría.
    const textoContrato = buildContratoTexto({ nombreCompleto, nombreEmpresa, email: caller.email })
    const ipAceptacion = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '').split(',')[0].trim() || null
    const userAgent = event.headers['user-agent'] || null
    const { enviado, error: errorEnvio } = await enviarCorreoContrato({ email: caller.email, nombreCompleto, textoContrato })

    const { error: errContrato } = await supabase.from('ContratosAceptados').insert({
      id: Date.now().toString(),
      empresa_id: empresa.id, user_id: caller.id,
      version_contrato: CONTRATO_VERSION, texto_contrato: textoContrato,
      nombre_completo: nombreCompleto, email: caller.email,
      ip_aceptacion: ipAceptacion, user_agent: userAgent,
      email_enviado: enviado, email_enviado_en: enviado ? new Date().toISOString() : null,
      email_error: errorEnvio || null,
    })
    if (errContrato) console.warn('[admin-empresas] No se pudo registrar ContratosAceptados:', errContrato.message)

    return res(200, { ok: true, empresa })
  }

  return res(400, { error: 'Acción no reconocida' })
}
