/**
 * Actividad reciente por usuario (feed de UX, distinto de "Auditoria" que es bitácora de
 * seguridad). Solo guarda la referencia (Tipo_Recurso + ID_Recurso) — el detalle se resuelve
 * al vuelo con resolverRecurso_ (backend/Recursos.js).
 */

const ACTIVIDAD_LIMITE_FILAS = 300; // recorta filas viejas para que la hoja no crezca sin límite

function registrarActividad(idUsuarioOToken, tipoRecurso, idRecurso, tipoInteraccion) {
  let idUsuario = idUsuarioOToken;
  if (typeof resolverUsuarioSolicitante_ === 'function') {
    const userSesion = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (userSesion && userSesion.idUsuario) idUsuario = userSesion.idUsuario;
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Actividad_Reciente');
    if (!hoja) return { success: false, message: 'Hoja Actividad_Reciente no encontrada' };

    const idActividad = 'ACT-' + new Date().getTime();
    hoja.appendRow([idActividad, idUsuario, tipoRecurso, idRecurso, tipoInteraccion, new Date()]);

    if (hoja.getLastRow() > ACTIVIDAD_LIMITE_FILAS + 1) {
      hoja.deleteRow(2); // fila más antigua (justo debajo del encabezado)
    }

    return { success: true };
  } catch (error) {
    Logger.log('Error registrarActividad: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Lista resuelta y agrupada por (usuario, tipo, id) — se queda solo con la interacción más
 *  reciente de cada recurso, para no repetir la misma carpeta 5 veces si se abrió 5 veces. */
function obtenerActividadReciente(idUsuario, limite) {
  try {
    limite = limite || 15;
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
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
