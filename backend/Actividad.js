/**
 * Actividad reciente por usuario (feed de UX, distinto de "Auditoria" que es bitácora de
 * seguridad). Solo guarda la referencia (Tipo_Recurso + ID_Recurso) — el detalle se resuelve
 * al vuelo con resolverRecurso_ (backend/Recursos.js).
 */

// Límite TOTAL de la hoja (todas las personas juntas). Antes eran 300: con cientos de usuarios, cada quien conservaba
// menos de una fila y "Recientes" quedaba vacío. Al pasarse del límite se recorta de un golpe hasta (límite - holgura).
const ACTIVIDAD_LIMITE_FILAS = 3000;
const ACTIVIDAD_HOLGURA_FILAS = 300;

function registrarActividad(idUsuarioOToken, tipoRecurso, idRecurso, tipoInteraccion) {
  let idUsuario = idUsuarioOToken;
  if (typeof resolverUsuarioSolicitante_ === 'function') {
    const userSesion = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (userSesion && userSesion.idUsuario) idUsuario = userSesion.idUsuario;
  }

  try {
    const ss = obtenerSpreadsheet_();
    const hoja = ss.getSheetByName('Actividad_Reciente');
    if (!hoja) return { success: false, message: 'Hoja Actividad_Reciente no encontrada' };

    // appendRow NO es seguro entre ejecuciones simultáneas (la prueba real perdió 2 de cada 3 filas): se agrega con candado corto.
    const idActividad = 'ACT-' + new Date().getTime();
    agregarFilaSegura_(hoja, function () { return [idActividad, idUsuario, tipoRecurso, idRecurso, tipoInteraccion, new Date()]; }, { soloEscribir: true });
    invalidarCacheDeActividadDe_(idUsuario); // ya escrita y con flush: lo guardado de ESTA persona deja de valer (las demás no se tocan)

    if (hoja.getLastRow() > ACTIVIDAD_LIMITE_FILAS + 1) recortarActividad_(hoja);

    return { success: true };
  } catch (error) {
    Logger.log('Error registrarActividad: ' + error);
    return { success: false, message: error.toString() };
  }
}

/** Borra de un golpe las filas más antiguas; el candado solo se toma aquí (y rara vez), no en cada registro. */
function recortarActividad_(hoja) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // otra ejecución ya lo está recortando
  try {
    const exceso = hoja.getLastRow() - 1 - (ACTIVIDAD_LIMITE_FILAS - ACTIVIDAD_HOLGURA_FILAS);
    if (exceso > 0) hoja.deleteRows(2, exceso); // desde la fila 2: justo debajo del encabezado
  } finally {
    liberarCandado_(lock);
  }
}

/** Lista resuelta y agrupada por (usuario, tipo, id) — se queda solo con la interacción más
 *  reciente de cada recurso, para no repetir la misma carpeta 5 veces si se abrió 5 veces. */
var ACTIVIDAD_VENTANA_FILAS_ = 800; // se lee primero solo el final de la hoja: las filas nuevas siempre se agregan abajo

/** Generación propia de la actividad de una persona: sube cada vez que ella registra una. */
function generacionDeActividadDe_(idUsuario) {
  try { return CacheService.getScriptCache().get('oxo:ag:' + String(idUsuario).trim()) || '0'; } catch (e) { return '0'; }
}

function invalidarCacheDeActividadDe_(idUsuario) {
  try { CacheService.getScriptCache().put('oxo:ag:' + String(idUsuario).trim(), String(Date.now()) + String(Math.floor(Math.random() * 1000)), 21600); } catch (e) {}
}

/** Agrupa las filas de una persona por recurso, quedándose con la interacción más reciente de cada uno. */
function agruparActividadDe_(filas, idx, idUsuario) {
  const porRecurso = {};
  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i][idx['ID_Usuario']]) !== String(idUsuario)) continue;

    const tipoRecurso = filas[i][idx['Tipo_Recurso']];
    const idRecurso = filas[i][idx['ID_Recurso']];
    const clave = tipoRecurso + '|' + idRecurso;
    const fechaHora = filas[i][idx['Fecha_Hora']];

    if (!porRecurso[clave] || new Date(fechaHora) > new Date(porRecurso[clave].fechaHora)) {
      porRecurso[clave] = {
        tipoRecurso: tipoRecurso, idRecurso: idRecurso,
        tipoInteraccion: filas[i][idx['Tipo_Interaccion']], fechaHora: fechaHora instanceof Date ? fechaHora.toISOString() : fechaHora
      };
    }
  }
  return porRecurso;
}

/** Lo más reciente de una persona, ya resuelto (sin filtrar por propiedades). Lee solo el final de la hoja y, si no alcanza para llenar
 *  "limite" recursos distintos (persona con poca actividad), la hoja completa. */
function actividadResueltaDe_(ss, hoja, idUsuario, limite) {
  const idx = indiceEncabezados_(hoja);
  const ultima = hoja.getLastRow();
  const ancho = hoja.getLastColumn();
  let porRecurso = null;
  if (ultima - 1 > ACTIVIDAD_VENTANA_FILAS_) {
    const filas = hoja.getRange(ultima - ACTIVIDAD_VENTANA_FILAS_ + 1, 1, ACTIVIDAD_VENTANA_FILAS_, ancho).getValues();
    const enLaVentana = agruparActividadDe_(filas, idx, idUsuario);
    if (Object.keys(enLaVentana).length >= limite) porRecurso = enLaVentana; // el final de la hoja ya trae lo más reciente
  }
  if (!porRecurso) porRecurso = agruparActividadDe_(hoja.getDataRange().getValues().slice(1), idx, idUsuario); // hoja corta o poca actividad: se lee entera

  const ordenados = Object.keys(porRecurso).map(function (k) { return porRecurso[k]; })
    .sort(function (a, b) { return new Date(b.fechaHora) - new Date(a.fechaHora); })
    .slice(0, limite);

  return ordenados.map(function (a) {
    const recurso = resolverRecurso_(a.tipoRecurso, a.idRecurso);
    if (!recurso.existe) return null;
    recurso.tipoInteraccion = a.tipoInteraccion;
    recurso.fechaHora = a.fechaHora ? new Date(a.fechaHora).toString() : '';
    return recurso;
  });
}

function obtenerActividadReciente(idUsuario, limite) {
  try {
    limite = limite || 15;
    const ss = obtenerSpreadsheet_();
    const hoja = ss.getSheetByName('Actividad_Reciente');
    if (!hoja) return { success: true, actividad: [] };

    // Lo resuelto se guarda por persona y se invalida cuando ELLA registra actividad o cambia algo de carpetas/archivos/favoritos
    const resueltos = conCacheArchivos_('act:' + String(idUsuario).trim() + ':' + limite,
      function () { return actividadResueltaDe_(ss, hoja, idUsuario, limite); }, null,
      function () { return generacionDeActividadDe_(idUsuario); });

    const alcance = alcanceDeHoteles_(idUsuario); // la actividad de una propiedad que ya no es suya no se muestra
    const actividad = resueltos.filter(function (r) { return r && alcancePermiteHotel_(alcance, r.idHotel); });

    return { success: true, actividad: actividad };
  } catch (error) {
    Logger.log('Error obtenerActividadReciente: ' + error);
    return { success: false, message: error.toString(), actividad: [] };
  }
}
