/**
 * Gestión del árbol de carpetas: las áreas fijas de cada hotel (ID_Padre en blanco, creadas
 * por backend/Drive.js) y, debajo de cada área, las subcarpetas que los propios usuarios
 * pueden ir creando libremente (ID_Padre = la carpeta contenedora). Un mismo nodo del árbol
 * puede tener subcarpetas Y archivos al mismo tiempo, en cualquier nivel.
 */

/** Áreas (nivel superior, ID_Padre en blanco) de un hotel — lo que se ve al entrar a un hotel. */
function obtenerCarpetasDelHotel(idHotel, idUsuarioOToken, idUsuarioFallback) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaCarpetas = ss.getSheetByName('Carpetas');
    const hojaHoteles = ss.getSheetByName('Hoteles');

    if (!hojaCarpetas || !hojaHoteles) {
      return { success: false, message: 'Hojas requeridas no encontradas', carpetas: [] };
    }

    // Validar restricción de acceso al hotel según permisos del usuario
    if (idUsuarioOToken || idUsuarioFallback) {
      let solicitante = null;
      if (typeof resolverUsuarioSolicitante_ === 'function') {
        if (idUsuarioOToken) solicitante = resolverUsuarioSolicitante_(idUsuarioOToken);
        if (!solicitante && idUsuarioFallback) solicitante = resolverUsuarioSolicitante_(idUsuarioFallback);
      } else {
        const id = idUsuarioFallback || idUsuarioOToken;
        if (id) solicitante = { idUsuario: String(id).trim() };
      }

      if (solicitante && solicitante.idUsuario) {
        const rolValor = typeof obtenerRolDeUsuario_ === 'function' ? obtenerRolDeUsuario_(solicitante.idUsuario) : null;
        const infoRol = typeof obtenerInfoRol_ === 'function' ? obtenerInfoRol_(rolValor) : null;
        const esSuperadmin = (infoRol && String(infoRol.id) === '3');

        if (!esSuperadmin) {
          const hojaUsuarios = ss.getSheetByName('Usuarios');
          if (hojaUsuarios) {
            const datosU = hojaUsuarios.getDataRange().getValues();
            const encabezadosU = datosU[0];
            const idxIdU = encabezadosU.findIndex(h => String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') === 'idusuario' || String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') === 'id');
            const idxHoteles = encabezadosU.findIndex(h => String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') === 'hotelespermitidos' || String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') === 'hoteles');

            if (idxIdU !== -1 && idxHoteles !== -1) {
              for (let i = 1; i < datosU.length; i++) {
                if (String(datosU[i][idxIdU]).trim() === String(solicitante.idUsuario).trim()) {
                  const val = String(datosU[i][idxHoteles] || '').trim();
                  if (val && val !== '*' && val.toUpperCase() !== 'TODOS') {
                    const permitidos = new Set(val.split(',').map(s => String(s).trim()));
                    if (!permitidos.has(String(idHotel).trim())) {
                      return { success: false, message: 'No tienes acceso a los proyectos de este hotel', carpetas: [] };
                    }
                  } else if (!val) {
                    return { success: false, message: 'No tienes hoteles asignados para consultar', carpetas: [] };
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }

    const idxHoteles = indiceEncabezados_(hojaHoteles);
    const datosHoteles = hojaHoteles.getDataRange().getValues();
    let hotelEncontrado = false;
    for (let i = 1; i < datosHoteles.length; i++) {
      if (String(datosHoteles[i][idxHoteles['ID_Hotel']]) === String(idHotel)) { hotelEncontrado = true; break; }
    }
    if (!hotelEncontrado) {
      return { success: false, message: 'Hotel no encontrado', carpetas: [] };
    }

    const resumenArchivosPorCarpeta = calcularResumenArchivosPorCarpeta_(ss);
    const idx = indiceEncabezados_(hojaCarpetas);
    const datos = hojaCarpetas.getDataRange().getValues();
    const carpetas = [];

    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      const esDelHotel = String(row[idx['ID_Hotel']]) === String(idHotel);
      const esNivelSuperior = !row[idx['ID_Padre']];
      if (esDelHotel && esNivelSuperior) {
        carpetas.push(construirObjetoCarpeta_(row, idx, resumenArchivosPorCarpeta));
      }
    }

    Logger.log('✅ obtenerCarpetasDelHotel: ' + carpetas.length + ' áreas para el hotel ' + idHotel);
    return { success: true, carpetas: carpetas };
  } catch (error) {
    Logger.log('❌ Error en obtenerCarpetasDelHotel: ' + error.toString());
    return { success: false, message: 'Error al obtener las carpetas: ' + error.toString(), carpetas: [] };
  }
}

/** Contenido de CUALQUIER carpeta (área o subcarpeta): sus subcarpetas directas + sus archivos
 *  directos, más los datos de la carpeta misma (para breadcrumb/contexto al llegar por un
 *  enlace directo desde Favoritos/Recientes).
 *  @param {string} idCarpeta - ID de la carpeta
 *  @param {string} idUsuario - (Opcional) ID del usuario para filtrar archivos bloqueados */
function obtenerContenidoCarpeta(idCarpeta, idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaCarpetas = ss.getSheetByName('Carpetas');
    if (!hojaCarpetas) {
      return { success: false, message: 'Hoja Carpetas no encontrada', subcarpetas: [], archivos: [] };
    }

    const resumenArchivosPorCarpeta = calcularResumenArchivosPorCarpeta_(ss);
    const idx = indiceEncabezados_(hojaCarpetas);
    const datos = hojaCarpetas.getDataRange().getValues();

    const subcarpetas = [];
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Padre']]) === String(idCarpeta)) {
        subcarpetas.push(construirObjetoCarpeta_(datos[i], idx, resumenArchivosPorCarpeta));
      }
    }

    let archivosResultado = obtenerArchivosDeUnaCarpeta(idCarpeta);

    // Filtrar archivos bloqueados si se proporciona idUsuario
    if (archivosResultado.success && archivosResultado.archivos && idUsuario) {
      archivosResultado.archivos = filtrarArchivosNoRestringidos_(archivosResultado.archivos, idUsuario, ss);
    }

    const carpetaActual = resolverCarpeta_(ss, idCarpeta);

    return {
      success: true,
      carpetaActual: carpetaActual.existe ? carpetaActual : null,
      subcarpetas: subcarpetas,
      archivos: archivosResultado.success ? archivosResultado.archivos : []
    };
  } catch (error) {
    Logger.log('❌ Error en obtenerContenidoCarpeta: ' + error.toString());
    return { success: false, message: error.toString(), subcarpetas: [], archivos: [] };
  }
}

/** Filtra archivos bloqueados para un usuario específico
 *  Devuelve solo los archivos que el usuario SÍ puede ver */
function filtrarArchivosNoRestringidos_(archivos, idUsuario, ss) {
  try {
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return archivos; // Si no existe la hoja de permisos, devolver todos
    }

    const datosPermisos = hojaPermisos.getDataRange().getValues();
    const idUsuarioStr = String(idUsuario);

    // Crear set de IDs de archivos restringidos para este usuario
    const archivosRestringidos = new Set();
    for (let i = 1; i < datosPermisos.length; i++) {
      const idArchivoPermiso = String(datosPermisos[i][1]); // Columna ID_Archivo
      const idUsuarioPermiso = String(datosPermisos[i][2]); // Columna ID_Usuario_RESTRINGIDO

      if (idUsuarioPermiso === idUsuarioStr) {
        archivosRestringidos.add(idArchivoPermiso);
      }
    }

    // Filtrar: devolver solo archivos que NO están en la lista de restringidos
    return archivos.filter(function(archivo) {
      return !archivosRestringidos.has(String(archivo.id));
    });
  } catch (error) {
    Logger.log('⚠️ Error filtrando archivos restringidos: ' + error);
    return archivos; // En caso de error, devolver todos los archivos
  }
}

/** Crea una subcarpeta real en Drive (dentro de la carpeta padre) y la registra en la hoja
 *  "Carpetas" enlazada por ID_Padre. Se puede anidar en cualquier profundidad. */
function crearSubcarpeta(idCarpetaPadre, nombreCarpeta, idUsuarioOToken) {
  if (!usuarioTienePermiso(idUsuarioOToken, 'Gestionar_Hoteles_Carpetas')) {
    return { success: false, message: 'No tienes permiso para crear carpetas' };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const nombreLimpio = String(nombreCarpeta || '').trim();
    if (!nombreLimpio) return { success: false, message: 'El nombre de la carpeta no puede estar vacío' };

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Carpetas');
    if (!hoja) return { success: false, message: 'Hoja Carpetas no encontrada' };

    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues();

    let filaPadre = null;
    let maxId = 0;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Carpeta']]) === String(idCarpetaPadre)) filaPadre = datos[i];
      const idNumerico = Number(datos[i][idx['ID_Carpeta']]);
      if (!isNaN(idNumerico) && idNumerico > maxId) maxId = idNumerico;
    }

    if (!filaPadre) return { success: false, message: 'Carpeta padre no encontrada' };

    const driveFolderIdPadre = filaPadre[idx['DriveFolderId']];
    const idHotel = filaPadre[idx['ID_Hotel']];
    if (!driveFolderIdPadre) return { success: false, message: 'La carpeta padre no tiene una carpeta de Drive asociada' };

    const carpetaPadreDrive = DriveApp.getFolderById(driveFolderIdPadre);
    const carpetaNuevaDrive = carpetaPadreDrive.createFolder(nombreLimpio);

    const nuevoId = maxId + 1;
    const filaDestino = hoja.getLastRow() + 1;
    const valoresPorColumna = {
      'ID_Carpeta': nuevoId,
      'ID_Hotel': idHotel,
      'Nombre_Carpeta': nombreLimpio,
      'DriveFolderId': carpetaNuevaDrive.getId(),
      'Fecha_Creacion': new Date(),
      'ID_Padre': idCarpetaPadre
    };
    Object.keys(valoresPorColumna).forEach(function (nombreColumna) {
      if (idx[nombreColumna] !== undefined) {
        hoja.getRange(filaDestino, idx[nombreColumna] + 1).setValue(valoresPorColumna[nombreColumna]);
      }
    });

    if (solicitante && solicitante.idUsuario) {
      registrarActividad(solicitante.idUsuario, 'Carpeta', nuevoId, 'Creó');
    }

    return {
      success: true,
      carpeta: {
        id: String(nuevoId), idHotel: idHotel, idPadre: idCarpetaPadre,
        nombre: nombreLimpio, driveFolderId: carpetaNuevaDrive.getId(),
        cantidad: 0, tamanoTotal: 0, fechaUltimaActividad: null, fechaCreacion: valoresPorColumna['Fecha_Creacion'].toString()
      }
    };
  } catch (error) {
    Logger.log('Error crearSubcarpeta: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Crea una nueva área (nivel superior, ID_Padre en blanco) directamente dentro de la carpeta
 *  de Drive del hotel — a diferencia de las áreas fijas (AREAS_FIJAS, backend/Drive.js), estas
 *  las agrega un administrador desde la app cuando falta alguna. */
function crearArea(idHotel, nombreArea, idUsuarioOToken) {
  if (!usuarioTienePermiso(idUsuarioOToken, 'Gestionar_Hoteles_Carpetas')) {
    return { success: false, message: 'No tienes permiso para crear áreas' };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const nombreLimpio = String(nombreArea || '').trim();
    if (!nombreLimpio) return { success: false, message: 'El nombre del área no puede estar vacío' };

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaHoteles = ss.getSheetByName('Hoteles');
    const hojaCarpetas = ss.getSheetByName('Carpetas');
    if (!hojaHoteles || !hojaCarpetas) return { success: false, message: 'Hojas requeridas no encontradas' };

    const idxHoteles = indiceEncabezados_(hojaHoteles);
    const datosHoteles = hojaHoteles.getDataRange().getValues();
    let driveFolderIdHotel = null;
    for (let i = 1; i < datosHoteles.length; i++) {
      if (String(datosHoteles[i][idxHoteles['ID_Hotel']]) === String(idHotel)) {
        driveFolderIdHotel = datosHoteles[i][idxHoteles['DriveFolderId']];
        break;
      }
    }
    if (!driveFolderIdHotel) return { success: false, message: 'Hotel no encontrado o sin carpeta de Drive asociada' };

    const carpetaHotelDrive = DriveApp.getFolderById(driveFolderIdHotel);
    const carpetaAreaDrive = carpetaHotelDrive.createFolder(nombreLimpio);

    const idx = indiceEncabezados_(hojaCarpetas);
    const datos = hojaCarpetas.getDataRange().getValues();
    let maxId = 0;
    for (let i = 1; i < datos.length; i++) {
      const idNumerico = Number(datos[i][idx['ID_Carpeta']]);
      if (!isNaN(idNumerico) && idNumerico > maxId) maxId = idNumerico;
    }

    const nuevoId = maxId + 1;
    const filaDestino = hojaCarpetas.getLastRow() + 1;
    const valoresPorColumna = {
      'ID_Carpeta': nuevoId,
      'ID_Hotel': idHotel,
      'Nombre_Carpeta': nombreLimpio,
      'DriveFolderId': carpetaAreaDrive.getId(),
      'Fecha_Creacion': new Date()
      // ID_Padre queda en blanco a propósito: es un área, no una subcarpeta de otra cosa.
    };
    Object.keys(valoresPorColumna).forEach(function (nombreColumna) {
      if (idx[nombreColumna] !== undefined) {
        hojaCarpetas.getRange(filaDestino, idx[nombreColumna] + 1).setValue(valoresPorColumna[nombreColumna]);
      }
    });

    if (solicitante && solicitante.idUsuario) {
      registrarAuditoriaSimple_(solicitante.idUsuario, 'CREAR_AREA', 'Creó el área "' + nombreLimpio + '"', 'Carpeta');
    }

    return {
      success: true,
      carpeta: {
        id: String(nuevoId), idHotel: idHotel, idPadre: null,
        nombre: nombreLimpio, driveFolderId: carpetaAreaDrive.getId(),
        cantidad: 0, tamanoTotal: 0, fechaUltimaActividad: null, fechaCreacion: valoresPorColumna['Fecha_Creacion'].toString()
      }
    };
  } catch (error) {
    Logger.log('Error crearArea: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Renombra una carpeta (área o subcarpeta) tanto en Drive como en la hoja "Carpetas". */
function renombrarCarpeta(idCarpeta, nuevoNombre, idUsuarioOToken) {
  if (!usuarioTienePermiso(idUsuarioOToken, 'Gestionar_Hoteles_Carpetas')) {
    return { success: false, message: 'No tienes permiso para renombrar carpetas' };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;

  try {
    const nombreLimpio = String(nuevoNombre || '').trim();
    if (!nombreLimpio) return { success: false, message: 'El nombre no puede estar vacío' };

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Carpetas');
    if (!hoja) return { success: false, message: 'Hoja Carpetas no encontrada' };

    const idx = indiceEncabezados_(hoja);
    const datos = hoja.getDataRange().getValues();

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Carpeta']]) === String(idCarpeta)) {
        const driveFolderId = datos[i][idx['DriveFolderId']];
        if (driveFolderId) {
          try { DriveApp.getFolderById(driveFolderId).setName(nombreLimpio); }
          catch (error) { Logger.log('No se pudo renombrar la carpeta en Drive: ' + error); }
        }

        hoja.getRange(i + 1, idx['Nombre_Carpeta'] + 1).setValue(nombreLimpio);
        if (solicitante && solicitante.idUsuario) {
          registrarAuditoriaSimple_(solicitante.idUsuario, 'RENOMBRAR_CARPETA', 'Renombró una carpeta a "' + nombreLimpio + '"', 'Carpeta');
        }
        return { success: true, nombre: nombreLimpio };
      }
    }
    return { success: false, message: 'Carpeta no encontrada' };
  } catch (error) {
    Logger.log('Error renombrarCarpeta: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Utilidad de alto rendimiento para eliminar filas en bloque sin loops lentos de deleteRow.
 */
function eliminarFilasPorIdsEnHojaLote_(hoja, nombreColumnaId, idsSet) {
  const datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return;
  const encabezados = datos[0];
  const idxId = encabezados.indexOf(nombreColumnaId);
  if (idxId === -1) return;

  const filasConservar = [encabezados];
  let cambio = false;

  for (let i = 1; i < datos.length; i++) {
    const idFila = String(datos[i][idxId]);
    if (idsSet.has(idFila)) {
      cambio = true;
    } else {
      filasConservar.push(datos[i]);
    }
  }

  if (cambio) {
    hoja.clearContents();
    hoja.getRange(1, 1, filasConservar.length, filasConservar[0].length).setValues(filasConservar);
    const exceso = hoja.getMaxRows() - filasConservar.length;
    if (exceso > 50) {
      try { hoja.deleteRows(filasConservar.length + 1, exceso - 10); } catch (e) {}
    }
  }
}

/** Elimina una carpeta (área o subcarpeta) Y TODA su subrama: subcarpetas descendientes y
 *  cualquier archivo dentro de cualquiera de ellas. Optimizado en lote para evitar timeouts. */
function eliminarCarpeta(idCarpeta, idUsuarioOToken) {
  if (!usuarioTienePermiso(idUsuarioOToken, 'Gestionar_Hoteles_Carpetas')) {
    return { success: false, message: 'No tienes permiso para eliminar carpetas' };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaCarpetas = ss.getSheetByName('Carpetas');
    const hojaArchivos = ss.getSheetByName('Archivos');
    if (!hojaCarpetas) return { success: false, message: 'Hoja Carpetas no encontrada' };

    const idx = indiceEncabezados_(hojaCarpetas);
    const datos = hojaCarpetas.getDataRange().getValues();

    let driveFolderIdObjetivo = null;
    let existe = false;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][idx['ID_Carpeta']]) === String(idCarpeta)) {
        driveFolderIdObjetivo = datos[i][idx['DriveFolderId']];
        existe = true;
        break;
      }
    }
    if (!existe) return { success: false, message: 'Carpeta no encontrada' };

    // Recolectar recursivamente toda la subrama
    const idsDeLaSubrama = [String(idCarpeta)];
    let siguioCreciendo = true;
    while (siguioCreciendo) {
      siguioCreciendo = false;
      for (let i = 1; i < datos.length; i++) {
        const idFila = String(datos[i][idx['ID_Carpeta']]);
        const idPadreFila = datos[i][idx['ID_Padre']] ? String(datos[i][idx['ID_Padre']]) : '';
        if (idsDeLaSubrama.indexOf(idFila) === -1 && idsDeLaSubrama.indexOf(idPadreFila) !== -1) {
          idsDeLaSubrama.push(idFila);
          siguioCreciendo = true;
        }
      }
    }

    if (driveFolderIdObjetivo) {
      try { DriveApp.getFolderById(driveFolderIdObjetivo).setTrashed(true); }
      catch (error) { Logger.log('No se pudo enviar la carpeta a la papelera en Drive: ' + error); }
    }

    const idsSet = new Set(idsDeLaSubrama);

    // Borrado optimizado en lote de Archivos
    if (hojaArchivos) {
      eliminarFilasPorIdsEnHojaLote_(hojaArchivos, 'ID_Carpeta', idsSet);
    }

    // Borrado optimizado en lote de Carpetas
    eliminarFilasPorIdsEnHojaLote_(hojaCarpetas, 'ID_Carpeta', idsSet);

    if (solicitante && solicitante.idUsuario) {
      registrarAuditoriaSimple_(solicitante.idUsuario, 'ELIMINAR_CARPETA',
        'Eliminó una carpeta junto con ' + (idsDeLaSubrama.length - 1) + ' subcarpeta(s)', 'Carpeta');
    }

    return { success: true };
  } catch (error) {
    Logger.log('Error eliminarCarpeta: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function construirObjetoCarpeta_(row, idx, resumenArchivosPorCarpeta) {
  const idCarpeta = String(row[idx['ID_Carpeta']]);
  const resumen = resumenArchivosPorCarpeta[idCarpeta];
  const fechaCreacion = row[idx['Fecha_Creacion']];

  return {
    id: idCarpeta,
    idHotel: row[idx['ID_Hotel']],
    idPadre: row[idx['ID_Padre']] ? String(row[idx['ID_Padre']]) : null,
    nombre: row[idx['Nombre_Carpeta']] || '',
    cantidad: (resumen && resumen.cantidad) || 0,
    tamanoTotal: (resumen && resumen.tamanoTotal) || 0,
    fechaUltimaActividad: (resumen && resumen.fechaUltima) ? resumen.fechaUltima.toString() : null,
    driveFolderId: row[idx['DriveFolderId']] ? String(row[idx['DriveFolderId']]) : null,
    fechaCreacion: fechaCreacion ? fechaCreacion.toString() : null
  };
}

/** Resumen por carpeta (una sola lectura de la hoja "Archivos"): cuántos archivos tiene,
 *  cuánto pesan en total y cuándo fue la actividad más reciente — para que la tarjeta de
 *  carpeta muestre datos reales en vez de "0 elementos" siempre. Cuenta solo archivos
 *  DIRECTOS de cada carpeta (no agrega recursivamente los de sus subcarpetas).
 *  Usa asegurarTamanoArchivo_ (backend/Archivos.js) para calcular sobre la marcha el tamaño
 *  de archivos subidos antes de que existiera esa columna, y lo deja escrito para la próxima. */
function calcularResumenArchivosPorCarpeta_(ss) {
  const hojaArchivos = ss.getSheetByName('Archivos');
  if (!hojaArchivos) return {};

  const datos = hojaArchivos.getDataRange().getValues();
  if (datos.length <= 1) return {};

  const encabezados = datos[0];
  const indexIdCarpeta = encabezados.indexOf('ID_Carpeta');
  if (indexIdCarpeta === -1) return {};

  let indexTamano = encabezados.indexOf('Tamaño_Bytes');
  if (indexTamano === -1) indexTamano = obtenerOAgregarColumna_(hojaArchivos, 'Tamaño_Bytes');
  const indexFechaMod = encabezados.indexOf('Fecha_Modificacion');

  const resumen = {};
  for (let i = 1; i < datos.length; i++) {
    const idCarpeta = String(datos[i][indexIdCarpeta]).trim();
    if (!idCarpeta) continue;

    let tamano = datos[i][indexTamano];
    if (!tamano) tamano = asegurarTamanoArchivo_(hojaArchivos, i + 1, indexTamano, datos[i], encabezados);

    if (!resumen[idCarpeta]) resumen[idCarpeta] = { cantidad: 0, tamanoTotal: 0, fechaUltima: null };
    resumen[idCarpeta].cantidad++;
    resumen[idCarpeta].tamanoTotal += Number(tamano) || 0;

    const fechaMod = indexFechaMod !== -1 ? datos[i][indexFechaMod] : null;
    if (fechaMod && (!resumen[idCarpeta].fechaUltima || new Date(fechaMod) > new Date(resumen[idCarpeta].fechaUltima))) {
      resumen[idCarpeta].fechaUltima = fechaMod;
    }
  }
  return resumen;
}
