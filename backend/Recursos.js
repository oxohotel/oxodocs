/**
 * Resuelve un (Tipo_Recurso, ID_Recurso) genérico contra las hojas reales — usado por
 * Favoritos.js y Actividad.js, que solo guardan esa referencia (nunca datos denormalizados),
 * para construir al vuelo un objeto listo para mostrar en una tarjeta. Así el nombre/contexto
 * mostrado siempre está al día, aunque el hotel/carpeta/archivo se haya renombrado después.
 *
 * Usa encabezados.indexOf(...) en vez de índices fijos de columna porque la hoja "Carpetas"
 * en producción tiene columnas adicionales agregadas a mano (ver backend/Carpetas.js).
 *
 * Optimización: obtenerFavoritosDetallados/obtenerActividadReciente llaman a resolverRecurso_
 * una vez POR CADA favorito/actividad (hasta 40 veces en una sola petición) — sin cachear, cada
 * una de esas llamadas releía y volvía a recorrer las hojas Hoteles/Carpetas/Archivos completas
 * desde cero. obtenerIndiceHoja_ lee cada hoja una sola vez por ejecución y la indexa por ID en
 * un mapa, así la 2ª, 3ª... 40ª resolución de esa misma hoja son lookups O(1) en memoria en vez
 * de releer y re-escanear filas. El caché vive en una variable global: en Apps Script eso dura
 * solo mientras corre ESTA ejecución (cada llamada desde el cliente arranca una ejecución nueva
 * con estado limpio), así que nunca hay riesgo de servir datos de una petición anterior.
 */

var _cacheIndiceHojas_ = {};

function obtenerIndiceHoja_(ss, nombreHoja, columnaClave) {
  const clave = nombreHoja + '::' + columnaClave;
  if (_cacheIndiceHojas_[clave]) return _cacheIndiceHojas_[clave];

  const resultado = { encabezados: {}, porId: {} };

  // Hoteles y Carpetas ya se guardan en caché (backend/Cache.js y backend/CacheArchivos.js): se indexan desde ahí, sin leer la hoja
  let datosDeCache = null;
  if (nombreHoja === 'Hoteles' && typeof leerHojaConCache_ === 'function') datosDeCache = leerHojaConCache_('Hoteles');
  else if (nombreHoja === 'Carpetas' && typeof leerCarpetasConCache_ === 'function') {
    const c = leerCarpetasConCache_(ss);
    datosDeCache = c.existe ? [c.encabezados].concat(c.filas) : null;
  }
  if (datosDeCache) {
    if (datosDeCache.length) {
      datosDeCache[0].forEach(function (nombre, i) { resultado.encabezados[nombre] = i; });
      const idxClaveCache = resultado.encabezados[columnaClave];
      for (let i = 1; i < datosDeCache.length; i++) resultado.porId[String(datosDeCache[i][idxClaveCache])] = datosDeCache[i];
    }
    _cacheIndiceHojas_[clave] = resultado;
    return resultado;
  }

  const hoja = ss.getSheetByName(nombreHoja);

  if (hoja) {
    const datos = hoja.getDataRange().getValues();
    if (datos.length) {
      datos[0].forEach(function (nombre, i) { resultado.encabezados[nombre] = i; });
      const idxClave = resultado.encabezados[columnaClave];
      for (let i = 1; i < datos.length; i++) {
        resultado.porId[String(datos[i][idxClave])] = datos[i];
      }
    }
  }

  _cacheIndiceHojas_[clave] = resultado;
  return resultado;
}

function resolverRecurso_(tipoRecurso, idRecurso) {
  const ss = obtenerSpreadsheet_();

  if (tipoRecurso === 'Hotel') return resolverHotel_(ss, idRecurso);
  if (tipoRecurso === 'Carpeta') return resolverCarpeta_(ss, idRecurso);
  if (tipoRecurso === 'Archivo') return resolverArchivo_(ss, idRecurso);
  return { existe: false };
}

function indiceEncabezados_(hoja) {
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const mapa = {};
  encabezados.forEach(function (nombre, i) { mapa[nombre] = i; });
  return mapa;
}

function resolverHotel_(ss, idHotel) {
  const indice = obtenerIndiceHoja_(ss, 'Hoteles', 'ID_Hotel');
  const fila = indice.porId[String(idHotel)];
  if (!fila) return { existe: false };

  const nombre = fila[indice.encabezados['Nombre_Hotel']] || 'Hotel';
  return {
    existe: true, tipoRecurso: 'Hotel', idRecurso: idHotel,
    nombre: nombre, contexto: 'Hotel', idHotel: idHotel, nombreHotel: nombre
  };
}

function resolverCarpeta_(ss, idCarpeta) {
  const indice = obtenerIndiceHoja_(ss, 'Carpetas', 'ID_Carpeta');
  const fila = indice.porId[String(idCarpeta)];
  if (!fila) return { existe: false };

  const idHotel = fila[indice.encabezados['ID_Hotel']];
  const nombreHotel = obtenerNombreHotel_(ss, idHotel);
  const nombre = fila[indice.encabezados['Nombre_Carpeta']] || 'Carpeta';

  return {
    existe: true, tipoRecurso: 'Carpeta', idRecurso: idCarpeta,
    nombre: nombre, contexto: nombreHotel, idHotel: idHotel, nombreHotel: nombreHotel
  };
}

var _busquedasDeArchivo_ = 0; // cuántos archivos se buscaron uno a uno en esta ejecución

/**
 * Fila de un archivo como objeto { Encabezado: valor } o null. Las primeras búsquedas de la ejecución van directas a la fila (sin
 * descargar la hoja de archivos, que puede tener miles); si hay muchas (p. ej. una lista de favoritos) es más barato leerla una vez.
 */
function leerFilaDeArchivo_(ss, idArchivo) {
  if (!_cacheIndiceHojas_['Archivos::ID_Archivo'] && _busquedasDeArchivo_ < 3 && typeof filaPorColumna_ === 'function') {
    _busquedasDeArchivo_++;
    return filaPorColumna_('Archivos', 'ID_Archivo', String(idArchivo));
  }
  const indice = obtenerIndiceHoja_(ss, 'Archivos', 'ID_Archivo');
  const fila = indice.porId[String(idArchivo)];
  if (!fila) return null;
  const objeto = {};
  Object.keys(indice.encabezados).forEach(function (n) { objeto[n] = fila[indice.encabezados[n]]; });
  return objeto;
}

function resolverArchivo_(ss, idArchivo) {
  const fila = leerFilaDeArchivo_(ss, idArchivo);
  if (!fila) return { existe: false };

  const idCarpeta = fila['ID_Carpeta'];
  const infoCarpeta = resolverCarpeta_(ss, idCarpeta);
  const nombre = fila['Nombre_Archivo'] || 'Archivo';
  const contexto = infoCarpeta.existe
    ? [infoCarpeta.nombreHotel, infoCarpeta.nombre].filter(Boolean).join(' / ')
    : '';

  return {
    existe: true, tipoRecurso: 'Archivo', idRecurso: idArchivo,
    nombre: nombre, contexto: contexto,
    idHotel: infoCarpeta.idHotel, nombreHotel: infoCarpeta.nombreHotel,
    idCarpeta: idCarpeta, nombreCarpeta: infoCarpeta.nombre,
    driveFileId: fila['DriveFileId'], driveUrl: fila['DriveUrl'],
    extension: fila['Extension']
  };
}

function obtenerNombreHotel_(ss, idHotel) {
  if (!idHotel) return '';
  const indice = obtenerIndiceHoja_(ss, 'Hoteles', 'ID_Hotel');
  const fila = indice.porId[String(idHotel)];
  return fila ? (fila[indice.encabezados['Nombre_Hotel']] || '') : '';
}
