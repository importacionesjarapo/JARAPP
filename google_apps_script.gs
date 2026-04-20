/**
 * Puente Google Apps Script - Importaciones Jarapo Admin
 * Implementar como aplicación web (Ejecutar como: Yo, Acceso: Cualquier persona)
 */

var CLAVE_API = "jarapo_secret_123";

function doGet(e) {
  var apiKey = e.parameter.apiKey;
  var nombreHoja = e.parameter.sheet;
  var action = e.parameter.action || 'READ';
  var payloadString = e.parameter.payload;

  if (apiKey !== CLAVE_API) {
    return createJsonResponse({ error: "Clave API inválida" });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    return createJsonResponse({ error: "Hoja no encontrada: " + nombreHoja });
  }

  // --- MODO LECTURA ---
  if (action === 'READ') {
    var rango = hoja.getDataRange();
    var datos = rango.getValues();
    if (datos.length <= 1 && datos[0][0] === "") return createJsonResponse([]);

    var encabezados = datos[0];
    var filas = datos.slice(1);
    var resultado = filas.map(function(fila) {
      var obj = {};
      encabezados.forEach(function(encabezado, i) { obj[encabezado] = fila[i]; });
      return obj;
    });
    return createJsonResponse(resultado);
  }

  // --- MODO ESCRITURA (VIA GET PARA EVITAR CORS) ---
  if (action === 'INSERT' && payloadString) {
    var payload = JSON.parse(decodeURIComponent(payloadString));
    var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var nuevaFila = encabezados.map(function(h) {
      return payload[h] !== undefined ? payload[h] : "";
    });
    hoja.appendRow(nuevaFila);
    return createJsonResponse({ status: "success", message: "Fila insertada correctamente" });
  }

  if (action === 'UPDATE' && payloadString) {
    var payload = JSON.parse(decodeURIComponent(payloadString));
    var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var datosColA = hoja.getRange(1, 1, hoja.getLastRow()).getValues();
    var filaIndice = -1;
    
    for (var i = 1; i < datosColA.length; i++) {
       if (datosColA[i][0].toString() === payload.id.toString()) {
          filaIndice = i + 1;
          break;
       }
    }

    if (filaIndice === -1) return createJsonResponse({ error: "ID no encontrado para actualizar" });

    encabezados.forEach(function(h, idx) {
       if (payload[h] !== undefined) {
          hoja.getRange(filaIndice, idx + 1).setValue(payload[h]);
       }
    });

    return createJsonResponse({ status: "success", message: "Fila actualizada correctamente" });
  }

  return createJsonResponse({ error: "Acción no reconocida o parámetros faltantes" });
}

// Función auxiliar para respuestas JSON consistentes
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var res = JSON.parse(e.postData.contents);
  var apiKey = res.apiKey;
  var nombreHoja = res.sheet;
  var accion = res.action; // 'INSERT' o 'UPDATE'
  var payload = res.payload;

  if (apiKey !== CLAVE_API) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Clave API inválida" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);

  if (!hoja) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Hoja no encontrada" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (accion === 'INSERT') {
    var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var nuevaFila = encabezados.map(function(h) {
      return payload[h] || "";
    });
    hoja.appendRow(nuevaFila);
    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Fila insertada" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (accion === 'UPDATE') {
    var encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var datosColA = hoja.getRange(1, 1, hoja.getLastRow()).getValues();
    var filaIndice = -1;
    
    // Buscar la fila por ID (asumiendo que ID está en la Columna A)
    for (var i = 1; i < datosColA.length; i++) {
       if (datosColA[i][0].toString() === payload.id.toString()) {
          filaIndice = i + 1;
          break;
       }
    }

    if (filaIndice === -1) {
       return ContentService.createTextOutput(JSON.stringify({ error: "ID no encontrado" }))
         .setMimeType(ContentService.MimeType.JSON);
    }

    // Actualizar campos
    encabezados.forEach(function(h, idx) {
       if (payload[h] !== undefined) {
          hoja.getRange(filaIndice, idx + 1).setValue(payload[h]);
       }
    });

    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Fila actualizada" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ error: "Acción no soportada" }))
    .setMimeType(ContentService.MimeType.JSON);
}
