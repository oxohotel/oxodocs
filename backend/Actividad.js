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

    // appendRow es atómico: ya no hace falta el candado global en cada registro (serializaba a todos los usuarios).
    const idActividad = 'ACT-' + new Date().getTime();
    hoja.appendRow([idActividad, idUsuario, tipoRecurso, idRecurso, tipoInteraccion, new Date()]);

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
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Lista resuelta y agrupada por (usuario, tipo, id) — se queda solo con la interacción más
 *  reciente de cada recurso, para no repetir la misma carpeta 5 veces si se abrió 5 veces. */
function obtenerActividadReciente(idUsuario, limite) {
  try {
    limite = limite || 15;
    const ss = obtenerSpreadsheet_();
    const hoja = ss.getSheetByName('Actividad_Reciente');
    if (!hoja) return { success: true, actividad: [] };

    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues().slice(1);

    const porRecurso = {};
    for (let i = 0; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Usuario']]) !== String(idUsuario)) continue;

      const tipoRecurso = datos[i][idx['Tipo_Recurso']];
      const idRecurso = datos[i][idx['ID_Recurso']];
      const clave = tipoRecurso + '|' + idRecurso;
      const fechaHora = datos[i][idx['Fecha_Hora']];

      if (!porRecurso[clave] || new Date(fechaHora) > new Date(porRecurso[clave].fechaHora)) {
        porRecurso[clave] = {
          tipoRecurso: tipoRecurso, idRecurso: idRecurso,
          tipoInteraccion: datos[i][idx['Tipo_Interaccion']], fechaHora: fechaHora
        };
      }
    }

    const ordenados = Object.keys(porRecurso).map(function (k) { return porRecurso[k]; })
      .sort(function (a, b) { return new Date(b.fechaHora) - new Date(a.fechaHora); })
      .slice(0, limite);

    const actividad = ordenados
      .map(function (a) {
        const recurso = resolverRecurso_(a.tipoRecurso, a.idRecurso);
        if (!recurso.existe) return null;
        recurso.tipoInteraccion = a.tipoInteraccion;
        recurso.fechaHora = a.fechaHora ? a.fechaHora.toString() : '';
        return recurso;
      })
      .filter(Boolean);

    return { success: true, actividad: actividad };
  } catch (error) {
    Logger.log('Error obtenerActividadReciente: ' + error);
    return { success: false, message: error.toString(), actividad: [] };
  }
}
