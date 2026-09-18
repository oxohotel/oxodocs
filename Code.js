/**
 * Punto de entrada de la Web App y API Backend Headless.
 *
 * - doGet(e): Sirve la plantilla HTML si se accede directo, o responde a consultas GET.
 * - doPost(e): Despacha peticiones API JSON desde el frontend externo (GitHub Pages, etc.)
 *   hacia las funciones de backend (Auth, Carpetas, Archivos, Drive, etc.).
 */

function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (errParse) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;
    const args = Array.isArray(payload.args) ? payload.args : [];

    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'No se especificó ninguna acción en el payload.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const globalScope = this;
    if (typeof globalScope[action] === 'function') {
      const result = globalScope[action].apply(null, args);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        data: result
      })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'La función "' + action + '" no existe en el backend de Apps Script.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    Logger.log('Error en doPost API: ' + error);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Error interno en el servidor: ' + (error.message || error.toString())
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Si la petición GET incluye el parámetro 'action', responder como API JSON (ej. ping / healthcheck)
  if (e && e.parameter && e.parameter.action) {
    try {
      const action = e.parameter.action;
      const globalScope = this;
      if (typeof globalScope[action] === 'function') {
        const result = globalScope[action].apply(null);
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          data: result
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Repositorio de Proyectos')
    .setFaviconUrl('https://acabrales-oxohotel.github.io/repo-imagenes/logo-oxodocs.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nombreArchivo) {
  return HtmlService.createTemplateFromFile(nombreArchivo).evaluate().getContent();
}

