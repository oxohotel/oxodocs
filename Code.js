/**
 * Punto de entrada de la Web App y API Backend Headless.
 *
 * - doGet(e): Sirve la plantilla HTML si se accede directo, o responde a consultas GET.
 * - doPost(e): Despacha peticiones API JSON desde el frontend externo (GitHub Pages, etc.)
 *   hacia las funciones de backend (Auth, Carpetas, Archivos, Drive, etc.).
 */

/**
 * Las funciones cuyo nombre termina en guion bajo (`_`) son auxiliares internas (crear sesiones, calcular hashes, escribir
 * en las hojas...). Nunca deben poder invocarse desde fuera: el despachador las trata como si no existieran.
 */
function accionPermitida_(nombre) {
  return typeof nombre === 'string' && nombre.length > 0 && nombre.slice(-1) !== '_';
}

function doPost(e) {
  const inicioMs = Date.now();
  let accionMedida = '';
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
    accionMedida = action;
    const args = Array.isArray(payload.args) ? payload.args : [];

    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'No se especificó ninguna acción en el payload.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const globalScope = this;
    if (accionPermitida_(action) && typeof globalScope[action] === 'function') {
      const result = globalScope[action].apply(null, args);
      const salida = ContentService.createTextOutput(JSON.stringify({
        success: true,
        data: result
      })).setMimeType(ContentService.MimeType.JSON);
      registrarMetrica_(action, Date.now() - inicioMs, null); // solo guarda si fue lenta (backend/Metricas.js)
      return salida;
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'La función "' + action + '" no existe en el backend de Apps Script.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    Logger.log('Error en doPost API: ' + error);
    registrarMetrica_(accionMedida, Date.now() - inicioMs, (error && error.message) || String(error));
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
      if (accionPermitida_(action) && typeof globalScope[action] === 'function') {
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
    .setTitle('Repositorio de Documentos')
    .setFaviconUrl('https://acabrales-oxohotel.github.io/repo-imagenes/logo-oxodocs.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nombreArchivo) {
  return HtmlService.createTemplateFromFile(nombreArchivo).evaluate().getContent();
}

/**
 * Función global para forzar la limpieza del caché del navegador (localStorage)
 * de todos los usuarios de la aplicación.
 * Al ejecutar esta función desde el editor de Apps Script, se incrementa
 * la versión global del caché, lo que hace que los clientes borren su estado local.
 */
function resetearCacheGlobalAplicativo() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty('APP_CACHE_VERSION');
  if (!version) { version = '1'; }
  const nuevaVersion = String(parseInt(version, 10) + 1);
  props.setProperty('APP_CACHE_VERSION', nuevaVersion);
  Logger.log('✅ Caché global reseteado. Nueva versión: ' + nuevaVersion);
  return 'Caché global reseteado a versión ' + nuevaVersion;
}

/**
 * Función expuesta al Frontend para verificar la versión del caché
 */
function obtenerVersionCacheGlobal() {
  return PropertiesService.getScriptProperties().getProperty('APP_CACHE_VERSION') || '1';
}
