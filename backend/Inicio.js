/**
 * Datos de la pantalla de Inicio en UNA sola llamada.
 *
 * Antes el Inicio disparaba 4 llamadas al Web App en paralelo (hoteles del menú, ids de favoritos,
 * actividad reciente y favoritos). Cada llamada al Web App paga su propio arranque y su propia apertura
 * de la hoja de cálculo, y en paralelo se estorban entre sí (7-9 s cada una en producción). Aquí se
 * ejecutan las mismas cuatro funciones, sin cambiar su lógica ni sus permisos, en una sola ejecución que
 * comparte la hoja abierta (ver obtenerSpreadsheet_ en Drive.js).
 *
 * Cada parte se resuelve por separado: si una falla, las demás igualmente se devuelven y el cliente
 * solo reintenta la que falló.
 */

var _spreadsheetEjecucion_ = null;

/** Hoja de cálculo principal, abierta una sola vez por ejecución (el estado global de Apps Script se reinicia
 *  en cada llamada del cliente, así que nunca se sirve algo de una petición anterior). */
function obtenerSpreadsheet_() {
  if (!_spreadsheetEjecucion_) _spreadsheetEjecucion_ = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  return _spreadsheetEjecucion_;
}

function obtenerDatosInicio(token, idUsuario) {
  function intentar_(fn) {
    try { return fn(); } catch (e) {
      Logger.log('Error en obtenerDatosInicio: ' + e);
      return null;
    }
  }

  return {
    modulos: intentar_(function () { return obtenerModulosConHoteles(token, idUsuario); }),
    idsFavoritos: intentar_(function () { return obtenerIdsFavoritosUsuario(idUsuario); }),
    actividad: intentar_(function () { return obtenerActividadReciente(idUsuario, 4); }),
    favoritos: intentar_(function () { return obtenerFavoritosDetallados(idUsuario); })
  };
}
