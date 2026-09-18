/**
 * Favoritos por usuario (carpetas y archivos). La hoja "Favoritos" solo guarda la referencia
 * (Tipo_Recurso + ID_Recurso) — el detalle para mostrar (nombre, hotel, etc.) se resuelve al
 * vuelo con resolverRecurso_ (backend/Recursos.js), así nunca queda desactualizado.
 */

function alternarFavorito(idUsuarioOToken, tipoRecurso, idRecurso) {
  let idUsuario = idUsuarioOToken;
  if (typeof resolverUsuarioSolicitante_ === 'function') {
    const userSesion = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (userSesion && userSesion.idUsuario) idUsuario = userSesion.idUsuario;
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Favoritos');
    if (!hoja) return { success: false, message: 'Hoja Favoritos no encontrada' };

    const datos = hoja.getDataRange().getValues();
    const idx = indiceEncabezados_(hoja);

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Usuario']]) === String(idUsuario) &&
          datos[i][idx['Tipo_Recurso']] === tipoRecurso &&
          String(datos[i][idx['ID_Recurso']]) === String(idRecurso)) {
        hoja.deleteRow(i + 1);
        return { success: true, esFavorito: false };
      }
    }

    const idFavorito = 'FAV-' + new Date().getTime();
    hoja.appendRow([idFavorito, idUsuario, tipoRecurso, idRecurso, new Date()]);
    return { success: true, esFavorito: true };
  } catch (error) {
    Logger.log('Error alternarFavorito: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Devuelve solo las claves "Tipo|ID" — liviano, para hidratar el estado de las estrellas en cualquier vista. */
function obtenerIdsFavoritosUsuario(idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Favoritos');
    if (!hoja) return { success: true, favoritos: [] };

    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues().slice(1);
    const favoritos = [];

    for (let i = 0; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Usuario']]) === String(idUsuario)) {
        favoritos.push(datos[i][idx['Tipo_Recurso']] + '|' + datos[i][idx['ID_Recurso']]);
      }
    }
    return { success: true, favoritos: favoritos };
  } catch (error) {
    Logger.log('Error obtenerIdsFavoritosUsuario: ' + error);
    return { success: false, message: error.toString(), favoritos: [] };
  }
}

/** Lista completa y resuelta, para el apartado "Favoritos" — más reciente primero. */
function obtenerFavoritosDetallados(idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Favoritos');
    if (!hoja) return { success: true, favoritos: [] };

    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues().slice(1);
    const propios = [];

    for (let i = 0; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Usuario']]) === String(idUsuario)) {
        propios.push({
          tipoRecurso: datos[i][idx['Tipo_Recurso']],
          idRecurso: datos[i][idx['ID_Recurso']],
          fechaMarcado: datos[i][idx['Fecha_Marcado']]
        });
      }
    }

    propios.sort(function (a, b) { return new Date(b.fechaMarcado) - new Date(a.fechaMarcado); });

    const favoritos = propios
      .map(function (f) {
        const recurso = resolverRecurso_(f.tipoRecurso, f.idRecurso);
        if (!recurso.existe) return null;
        recurso.fechaMarcado = f.fechaMarcado ? f.fechaMarcado.toString() : '';
        return recurso;
      })
      .filter(Boolean);

    return { success: true, favoritos: favoritos };
  } catch (error) {
    Logger.log('Error obtenerFavoritosDetallados: ' + error);
    return { success: false, message: error.toString(), favoritos: [] };
  }
}
