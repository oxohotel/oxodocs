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
    tomarCandado_(lock, 10000);
    const ss = obtenerSpreadsheet_();
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
    liberarCandado_(lock);
  }
}

/**
 * Favoritos de una persona tal como están en la hoja (sin resolver), con caché por persona: lo comparten la lista de estrellas y el
 * detalle, que antes leían la hoja completa cada uno. Se invalida con el despachador (alternarFavorito invalida por defecto).
 */
function favoritosPropios_(idUsuario) {
  return conCacheArchivos_('favs:' + String(idUsuario).trim(), function () {
    const hoja = obtenerSpreadsheet_().getSheetByName('Favoritos');
    if (!hoja) return { existe: false, propios: [] };
    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues().slice(1);
    const propios = [];
    for (let i = 0; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Usuario']]) === String(idUsuario)) {
        const f = datos[i][idx['Fecha_Marcado']];
        propios.push({ tipoRecurso: datos[i][idx['Tipo_Recurso']], idRecurso: datos[i][idx['ID_Recurso']], fechaMarcado: f instanceof Date ? f.toISOString() : f });
      }
    }
    return { existe: true, propios: propios };
  });
}

/** Devuelve solo las claves "Tipo|ID" — liviano, para hidratar el estado de las estrellas en cualquier vista. */
function obtenerIdsFavoritosUsuario(idUsuario) {
  try {
    const lista = favoritosPropios_(idUsuario);
    if (!lista.existe) return { success: true, favoritos: [] };
    const favoritos = lista.propios.map(function (f) { return f.tipoRecurso + '|' + f.idRecurso; });
    return { success: true, favoritos: favoritos };
  } catch (error) {
    Logger.log('Error obtenerIdsFavoritosUsuario: ' + error);
    return { success: false, message: error.toString(), favoritos: [] };
  }
}

/** Lista completa y resuelta, para el apartado "Favoritos" — más reciente primero. */
function obtenerFavoritosDetallados(idUsuario) {
  try {
    const lista = favoritosPropios_(idUsuario);
    if (!lista.existe) return { success: true, favoritos: [] };

    // Lo resuelto (nombres, propiedad...) se guarda por persona; el filtro por propiedades NO, porque cambia cuando le cambian sus accesos
    const resueltos = conCacheArchivos_('favdet:' + String(idUsuario).trim(), function () {
      const propios = lista.propios.slice().sort(function (a, b) { return new Date(b.fechaMarcado) - new Date(a.fechaMarcado); });
      return propios.map(function (f) {
        const recurso = resolverRecurso_(f.tipoRecurso, f.idRecurso);
        if (!recurso.existe) return null;
        recurso.fechaMarcado = f.fechaMarcado ? f.fechaMarcado.toString() : '';
        return recurso;
      }).filter(Boolean);
    });

    const alcance = alcanceDeHoteles_(idUsuario); // un favorito de una propiedad que ya no es suya no se muestra
    const favoritos = resueltos.filter(function (r) { return alcancePermiteHotel_(alcance, r.idHotel); });

    return { success: true, favoritos: favoritos };
  } catch (error) {
    Logger.log('Error obtenerFavoritosDetallados: ' + error);
    return { success: false, message: error.toString(), favoritos: [] };
  }
}
