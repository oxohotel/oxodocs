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

/** "forzar" (botón "Recargar sistema"): descarta el caché de usuarios/hoteles antes de leer, como máximo una vez por minuto. */
function obtenerDatosInicio(token, idUsuario, forzar) {
  const reloj = cronometro_();
  const lecturasAntes = _lecturasDeHoja_;
  // Solo con una sesión válida (la acción es pública) y como máximo una vez por minuto en todo el sistema
  let refrescoForzado;
  if (forzar === true) refrescoForzado = !!(token && obtenerUsuarioPorToken(token)) && refrescarCachesForzado_();

  function intentar_(fn, parte) {
    try { return fn(); } catch (e) {
      Logger.log('Error en obtenerDatosInicio: ' + e);
      return null;
    } finally {
      reloj.marca(parte);
    }
  }

  const resultado = {
    modulos: intentar_(function () { return obtenerModulosConHoteles(token, idUsuario); }, 'hoteles'),
    idsFavoritos: intentar_(function () { return obtenerIdsFavoritosUsuario(idUsuario); }, 'idsFav'),
    actividad: intentar_(function () { return obtenerActividadReciente(idUsuario, 4); }, 'actividad'),
    favoritos: intentar_(function () { return obtenerFavoritosDetallados(idUsuario); }, 'favoritos'),
    // Solicitudes de acceso que esta persona puede resolver (null si no gestiona usuarios): insignia en "Usuarios"
    pendientes: intentar_(function () { return contarPendientesAprobacion_(token, idUsuario); }, 'pendientes'),
    // Avisos de la campana: lo que le corresponde a esta persona y cuántos no ha visto
    avisos: intentar_(function () { return obtenerAvisos(idUsuario); }, 'avisos')
  };

  if (forzar === true) resultado.refrescoForzado = refrescoForzado; // false = se omitió (límite por minuto o sesión no válida)

  // Si tardó más de 3 s se guarda el desglose y si el caché estaba frío (lecturas de hoja > 0): así se sabe qué parte es la lenta
  registrarMetrica_('obtenerDatosInicio.partes', reloj.total(), null, reloj.detalle() + ' lecturasHoja=' + (_lecturasDeHoja_ - lecturasAntes), 3000);
  return resultado;
}
