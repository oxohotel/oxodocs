/**
 * Gestiona archivos: subida a Drive, registro en Sheets y listado de archivos
 */

function obtenerArchivosDeUnaCarpeta(idCarpeta) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Archivos');

    if (!hoja) {
      return { success: false, message: 'Hoja de Archivos no encontrada' };
    }

    const datos = hoja.getDataRange().getValues();
    if (datos.length <= 1) {
      return { success: true, archivos: [] };
    }

    const encabezados = datos[0];
    const indexIdCarpeta = encabezados.indexOf('ID_Carpeta');
    let indexTamano = encabezados.indexOf('Tamaño_Bytes');
    if (indexTamano === -1) indexTamano = obtenerOAgregarColumna_(hoja, 'Tamaño_Bytes');

    const archivos = [];
    const idCarpetaStr = String(idCarpeta).trim();

    for (let i = 1; i < datos.length; i++) {
      const valorCelda = String(datos[i][indexIdCarpeta]).trim();
      if (valorCelda === idCarpetaStr) {
        let tamano = datos[i][indexTamano];
        if (!tamano) tamano = asegurarTamanoArchivo_(hoja, i + 1, indexTamano, datos[i], encabezados);
        archivos.push(construirObjetoArchivo(datos[i], encabezados, tamano));
      }
    }

    Logger.log('obtenerArchivosDeUnaCarpeta: Buscando ID_Carpeta=' + idCarpetaStr + ', encontrados: ' + archivos.length);
    return { success: true, archivos };
  } catch (error) {
    Logger.log('Error obtenerArchivosDeUnaCarpeta: ' + error);
    return { success: false, message: error.toString() };
  }
}

function construirObjetoArchivo(fila, encabezados, tamanoOverride) {
  const indices = {
    id: encabezados.indexOf('ID_Archivo'),
    carpeta: encabezados.indexOf('ID_Carpeta'),
    nombre: encabezados.indexOf('Nombre_Archivo'),
    extension: encabezados.indexOf('Extension'),
    tipo: encabezados.indexOf('Tipo_Documento'),
    estado: encabezados.indexOf('Estado_Documento'),
    responsable: encabezados.indexOf('Responsable'),
    driveUrl: encabezados.indexOf('DriveUrl'),
    fecha: encabezados.indexOf('Fecha_Creacion'),
    fechaModificacion: encabezados.indexOf('Fecha_Modificacion'),
    driveFileId: encabezados.indexOf('DriveFileId'),
    tamano: encabezados.indexOf('Tamaño_Bytes')
  };

  return {
    id: fila[indices.id],
    idCarpeta: fila[indices.carpeta],
    nombre: fila[indices.nombre],
    extension: fila[indices.extension],
    tipo: fila[indices.tipo],
    estado: fila[indices.estado],
    responsable: fila[indices.responsable],
    driveUrl: fila[indices.driveUrl],
    fecha: fila[indices.fecha] ? fila[indices.fecha].toString() : '',
    fechaModificacion: indices.fechaModificacion !== -1 && fila[indices.fechaModificacion] ? fila[indices.fechaModificacion].toString() : '',
    driveFileId: fila[indices.driveFileId],
    tamano: tamanoOverride != null ? tamanoOverride : (indices.tamano !== -1 ? (fila[indices.tamano] || 0) : 0)
  };
}

/** Agrega una columna al final de "hoja" si todavía no existe (encabezado exacto) y devuelve
 *  su índice 0-based — usado para ir sumando campos nuevos (como el tamaño) sin romper filas
 *  ya existentes ni tener que recrear la hoja. */
function obtenerOAgregarColumna_(hoja, nombreColumna) {
  const ultimaColumna = hoja.getLastColumn();
  const encabezados = hoja.getRange(1, 1, 1, ultimaColumna).getValues()[0];
  const index = encabezados.indexOf(nombreColumna);
  if (index !== -1) return index;

  hoja.getRange(1, ultimaColumna + 1).setValue(nombreColumna);
  return ultimaColumna;
}

/** Los archivos subidos antes de que existiera la columna "Tamaño_Bytes" la tienen vacía —
 *  se calcula una sola vez desde Drive y se escribe de vuelta en la celda, así la próxima
 *  lectura ya la encuentra ahí (evita repetir la llamada a Drive cada vez que se abre la carpeta). */
function asegurarTamanoArchivo_(hoja, numeroFila, indexTamano, fila, encabezados) {
  try {
    const indexDriveFileId = encabezados.indexOf('DriveFileId');
    const driveFileId = fila[indexDriveFileId];
    if (!driveFileId) return 0;

    const tamano = DriveApp.getFileById(driveFileId).getSize();
    hoja.getRange(numeroFila, indexTamano + 1).setValue(tamano);
    return tamano;
  } catch (error) {
    Logger.log('No se pudo calcular el tamaño del archivo: ' + error);
    return 0;
  }
}

function guardarArchivoEnDrive(idCarpeta, nombreArchivo, datosArchivo, mimeType, tipoDocumento, estadoDocumento, responsable, idUsuarioOToken, usuariosRestringidos) {
  if (!usuarioTienePermiso(idUsuarioOToken, 'Subir_Documento')) {
    return { success: false, message: 'No tienes permiso para subir archivos' };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;
  const responsableFinal = (solicitante && solicitante.nombre) || responsable || 'Sistema';

  try {
    Logger.log('=== GUARDAR ARCHIVO INICIO ===');
    Logger.log('idCarpeta: ' + idCarpeta);
    Logger.log('nombreArchivo: ' + nombreArchivo);

    if (idCarpeta === null || idCarpeta === undefined || String(idCarpeta).trim() === '') {
      Logger.log('ERROR: idCarpeta está vacío o nulo');
      return { success: false, message: 'No se especificó una carpeta de destino' };
    }

    // Obtener la carpeta del Drive
    const carpeta = obtenerCarpetaDrive(idCarpeta);
    if (!carpeta) {
      Logger.log('ERROR: Carpeta no encontrada en Drive para idCarpeta=' + idCarpeta);
      return { success: false, message: 'La carpeta destino no está disponible. Recarga la página e intenta de nuevamente.' };
    }

    Logger.log('Carpeta encontrada en Drive');

    // Convertir base64 a Blob
    const blob = Utilities.newBlob(Utilities.base64Decode(datosArchivo), mimeType, nombreArchivo);

    // Subir archivo a Drive
    const archivoCreado = carpeta.createFile(blob);
    const driveFileId = archivoCreado.getId();
    const driveUrl = archivoCreado.getUrl();
    const tamanoBytes = archivoCreado.getSize();

    Logger.log('Archivo subido a Drive: ' + driveFileId);

    // Registrar en la hoja de Archivos
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Archivos');

    if (!hoja) {
      Logger.log('ERROR: Hoja "Archivos" no existe');
      return { success: false, message: 'Hoja Archivos no existe en el Sheet' };
    }

    Logger.log('Hoja Archivos encontrada');

    const indexTamano = obtenerOAgregarColumna_(hoja, 'Tamaño_Bytes');
    const idArchivo = generarIdArchivo();
    const extension = nombreArchivo.split('.').pop() || 'sin extensión';
    const fechaCreacion = new Date();

    hoja.appendRow([
      idArchivo,                          // ID_Archivo
      idCarpeta,                          // ID_Carpeta
      driveFileId,                        // DriveFileId
      nombreArchivo,                      // Nombre_Archivo
      extension,                          // Extension
      tipoDocumento || 'Otro',            // Tipo_Documento
      estadoDocumento || 'En revisión',   // Estado_Documento
      responsable || 'Sistema',           // Responsable
      mimeType,                           // MimeType
      driveUrl,                           // DriveUrl
      fechaCreacion,                       // Fecha_Creacion
      fechaCreacion,                       // Fecha_Modificacion
      fechaCreacion                        // Fecha_Sincronizacion
    ]);
    hoja.getRange(hoja.getLastRow(), indexTamano + 1).setValue(tamanoBytes);

    Logger.log(`✅ Archivo ${nombreArchivo} subido a Drive y registrado`);

    // Guardar permisos si se especificaron
    if (usuariosRestringidos && usuariosRestringidos.length > 0) {
      try {
        guardarPermisosArchivo(idArchivo, usuariosRestringidos);
        Logger.log('✅ Permisos guardados para archivo: ' + idArchivo);
      } catch (permError) {
        Logger.log('⚠️  Error guardando permisos (no afecta el archivo): ' + permError);
      }
    }

    return {
      success: true,
      archivo: {
        id: idArchivo,
        idCarpeta: idCarpeta,
        nombre: nombreArchivo,
        extension: extension,
        tipo: tipoDocumento || 'Otro',
        estado: estadoDocumento || 'En revisión',
        responsable: responsable || 'Sistema',
        driveFileId: driveFileId,
        driveUrl: driveUrl,
        fecha: fechaCreacion.toString(),
        fechaModificacion: fechaCreacion.toString(),
        tamano: tamanoBytes
      }
    };
  } catch (error) {
    Logger.log('Error guardarArchivoEnDrive: ' + error);
    return { success: false, message: error.toString() };
  }
}

function obtenerCarpetaDrive(idCarpeta) {
  try {
    Logger.log('🔍 obtenerCarpetaDrive - Buscando idCarpeta=' + idCarpeta + ' (type: ' + typeof idCarpeta + ')');

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Carpetas');

    if (!hoja) {
      Logger.log('❌ Hoja Carpetas no encontrada');
      return null;
    }

    const datos = hoja.getDataRange().getValues();
    Logger.log('📊 Total de filas en Carpetas: ' + datos.length);

    const encabezados = datos[0];
    const indexId = encabezados.indexOf('ID_Carpeta');
    const indexDriveFolderId = encabezados.indexOf('DriveFolderId');

    Logger.log('📍 indexId=' + indexId + ', indexDriveFolderId=' + indexDriveFolderId);
    Logger.log('📍 Encabezados: ' + JSON.stringify(encabezados));

    const idCarpetaStr = String(idCarpeta).trim();
    Logger.log('🔎 Buscando: idCarpetaStr="' + idCarpetaStr + '"');

    // Buscar la carpeta
    let encontrada = false;
    for (let i = 1; i < datos.length; i++) {
      const valorCelda = String(datos[i][indexId]).trim();

      // Log detallado solo para la carpeta buscada y algunas más
      if (i <= 5 || valorCelda === idCarpetaStr) {
        Logger.log('  Fila ' + (i + 1) + ': ID="' + valorCelda + '" (tipo: ' + typeof datos[i][indexId] + ', valor bruto: [' + datos[i][indexId] + '])');
      }

      if (valorCelda === idCarpetaStr) {
        encontrada = true;
        Logger.log('✅ ENCONTRADA fila ' + (i + 1) + ' con ID=' + valorCelda);
        const driveFolderId = datos[i][indexDriveFolderId];
        Logger.log('📂 DriveFolderId=' + driveFolderId);

        if (driveFolderId) {
          try {
            const carpeta = DriveApp.getFolderById(driveFolderId);
            Logger.log('✅ Carpeta de Drive accedida: ' + carpeta.getName());
            return carpeta;
          } catch (driveError) {
            Logger.log('❌ Error accediendo a DriveFolder ' + driveFolderId + ': ' + driveError);
            return null;
          }
        } else {
          Logger.log('❌ DriveFolderId está vacío');
          return null;
        }
      }
    }

    if (!encontrada) {
      Logger.log('❌ CRÍTICO: Carpeta con ID="' + idCarpetaStr + '" NO ENCONTRADA después de revisar ' + (datos.length - 1) + ' filas');
      Logger.log('❌ La carpeta 67 debe estar registrada en la hoja Carpetas con un DriveFolderId válido');
      Logger.log('❌ Verifica: 1) ¿Existe la fila con ID_Carpeta=67? 2) ¿Tiene un DriveFolderId válido?');
    }
    return null;
  } catch (error) {
    Logger.log('❌ Error obtenerCarpetaDrive: ' + error);
    return null;
  }
}

function generarIdArchivo() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Archivos');
    const maxRow = hoja.getLastRow();

    if (maxRow <= 1) {
      return 'ARC-001';
    }

    const ultimaFila = hoja.getRange(maxRow, 1).getValue();
    const partes = String(ultimaFila).split('-');
    const numero = (partes.length > 1 ? parseInt(partes[1], 10) : maxRow) + 1;
    return 'ARC-' + String(numero).padStart(3, '0');
  } catch (e) {
    Logger.log('Aviso generarIdArchivo lock: ' + e);
    return 'ARC-' + Date.now().toString().slice(-6);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function validarPropiedadOAdmin_(idArchivoODriveId, idUsuarioOToken, esDriveId = false) {
  // 1. Es admin?
  const esAdmin = usuarioTienePermiso(idUsuarioOToken, 'Gestionar_Hoteles_Carpetas');
  if (esAdmin) return { autorizado: true };

  // 2. Resolver usuario
  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : null;
  
  if (!solicitante || !solicitante.usuario) {
    // Fallback de seguridad
    if (usuarioTienePermiso(idUsuarioOToken, 'Eliminar_Documentos')) return { autorizado: true };
    return { autorizado: false, mensaje: 'No autorizado' };
  }

  const nombreUsuario = solicitante.usuario.Nombre_Completo;
  const emailUsuario = solicitante.usuario.Email;

  // 3. Buscar Responsable
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  const hoja = ss.getSheetByName('Archivos');
  if (!hoja) return { autorizado: false, mensaje: 'Error de BD' };

  const datos = hoja.getDataRange().getValues();
  const colBusqueda = esDriveId ? datos[0].indexOf('DriveFileId') : datos[0].indexOf('ID_Archivo');
  const colResp = datos[0].indexOf('Responsable');

  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][colBusqueda]) === String(idArchivoODriveId)) {
      const resp = String(datos[i][colResp] || '').trim();
      if (resp === nombreUsuario || resp === emailUsuario || resp === 'Sistema') {
        return { autorizado: true };
      }
      return { autorizado: false, mensaje: 'Solo el creador (' + resp + ') o un Administrador puede hacer esto.' };
    }
  }
  return { autorizado: false, mensaje: 'Archivo no encontrado.' };
}

function eliminarArchivo(driveFileId, idUsuarioOToken) {
  const auth = validarPropiedadOAdmin_(driveFileId, idUsuarioOToken, true);
  if (!auth.autorizado) {
    return { success: false, message: auth.mensaje };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : { idUsuario: idUsuarioOToken };

  try {
    const archivo = DriveApp.getFileById(driveFileId);
    archivo.setTrashed(true);

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Archivos');

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexDriveFileId = encabezados.indexOf('DriveFileId');

    for (let i = 1; i < datos.length; i++) {
      if (datos[i][indexDriveFileId] == driveFileId) {
        hoja.deleteRow(i + 1);
        break;
      }
    }

    if (solicitante && solicitante.idUsuario) {
      registrarAuditoriaSimple_(solicitante.idUsuario, 'ELIMINAR_ARCHIVO', 'Eliminó un archivo', 'Archivo');
    }
    Logger.log(`✅ Archivo ${driveFileId} eliminado`);
    return { success: true };
  } catch (error) {
    Logger.log('Error eliminarArchivo: ' + error);
    return { success: false, message: error.toString() };
  }
}

/** Renombra un archivo tanto en Drive como en la hoja "Archivos" — conserva la extensión
 *  original aunque quien escriba el nuevo nombre no la incluya. */
function renombrarArchivo(idArchivo, nuevoNombre, idUsuarioOToken) {
  const auth = validarPropiedadOAdmin_(idArchivo, idUsuarioOToken, false);
  if (!auth.autorizado) {
    return { success: false, message: auth.mensaje };
  }

  const solicitante = typeof resolverUsuarioSolicitante_ === 'function'
    ? resolverUsuarioSolicitante_(idUsuarioOToken)
    : { idUsuario: idUsuarioOToken };

  try {
    const nombreLimpio = String(nuevoNombre || '').trim();
    if (!nombreLimpio) return { success: false, message: 'El nombre no puede estar vacío' };

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Archivos');
    if (!hoja) return { success: false, message: 'Hoja Archivos no encontrada' };

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.indexOf('ID_Archivo');
    const indexNombre = encabezados.indexOf('Nombre_Archivo');
    const indexExtension = encabezados.indexOf('Extension');
    const indexDriveFileId = encabezados.indexOf('DriveFileId');
    const indexFechaMod = encabezados.indexOf('Fecha_Modificacion');

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][indexId]) === String(idArchivo)) {
        const extensionActual = datos[i][indexExtension];
        const yaTraeExtension = extensionActual && nombreLimpio.toLowerCase().endsWith('.' + String(extensionActual).toLowerCase());
        const nombreFinal = (extensionActual && !yaTraeExtension) ? nombreLimpio + '.' + extensionActual : nombreLimpio;

        const driveFileId = datos[i][indexDriveFileId];
        if (driveFileId) {
          try { DriveApp.getFileById(driveFileId).setName(nombreFinal); }
          catch (error) { Logger.log('No se pudo renombrar el archivo en Drive: ' + error); }
        }

        hoja.getRange(i + 1, indexNombre + 1).setValue(nombreFinal);
        if (indexFechaMod !== -1) hoja.getRange(i + 1, indexFechaMod + 1).setValue(new Date());

        registrarAuditoriaSimple_(idUsuario, 'RENOMBRAR_ARCHIVO', 'Renombró un archivo a "' + nombreFinal + '"', 'Archivo');
        return { success: true, nombre: nombreFinal };
      }
    }
    return { success: false, message: 'Archivo no encontrado' };
  } catch (error) {
    Logger.log('Error renombrarArchivo: ' + error);
    return { success: false, message: error.toString() };
  }
}

// ==================== Funciones de Google Drive en Vivo ====================

function obtenerTipoDocPorExtension_(nombreOExtension) {
  const str = String(nombreOExtension || '').toLowerCase();
  const ext = str.indexOf('.') !== -1 ? str.split('.').pop() : str;
  const mapa = {
    pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel',
    ppt: 'PowerPoint', pptx: 'PowerPoint', png: 'Imagen', jpg: 'Imagen', jpeg: 'Imagen',
    gif: 'Imagen', svg: 'Imagen', txt: 'Texto', zip: 'Comprimido', rar: 'Comprimido', '7z': 'Comprimido',
    mp3: 'Audio', html: 'Código', htm: 'Código', css: 'Código', js: 'Código', php: 'Código',
    sql: 'Código', xml: 'Código'
  };
  return mapa[ext] || 'Otro';
}

/**
 * Busca archivos en Google Drive para permitir al usuario migrarlos hacia el repositorio OxoHotel.
 * Si se especifica un término, busca archivos por título; si no, devuelve los archivos más recientes.
 */
function buscarArchivosEnGoogleDrive(termino, limite) {
  try {
    const qTerm = String(termino || '').trim();
    const archivos = [];
    const idsAgregados = new Set();
    const maxResultados = Number(limite) || 40;

    let filesIter;
    if (qTerm) {
      const safeTerm = qTerm.replace(/'/g, "\\'");
      filesIter = DriveApp.searchFiles("trashed = false and title contains '" + safeTerm + "' and mimeType != 'application/vnd.google-apps.folder'");
    } else {
      filesIter = DriveApp.getFiles();
    }

    while (filesIter.hasNext() && archivos.length < maxResultados) {
      const file = filesIter.next();
      if (!idsAgregados.has(file.getId())) {
        idsAgregados.add(file.getId());
        archivos.push({
          id: file.getId(),
          nombre: file.getName(),
          mimeType: file.getMimeType(),
          tamano: file.getSize(),
          url: file.getUrl(),
          fechaModificacion: file.getLastUpdated() ? Utilities.formatDate(file.getLastUpdated(), "GMT-5", "yyyy-MM-dd HH:mm") : '',
          tipo: obtenerTipoDocPorExtension_(file.getName())
        });
      }
    }

    return { success: true, archivos: archivos };
  } catch (error) {
    Logger.log('Error buscarArchivosEnGoogleDrive: ' + error);
    return { success: false, message: error.toString(), archivos: [] };
  }
}

/**
 * Migra/Copia múltiples archivos de Drive hacia la carpeta destino de OxoHotel en una sola operación.
 */
function guardarArchivosMultiplesDesdeDrive(idCarpeta, arrayItems, idUsuarioOToken) {
  if (!Array.isArray(arrayItems) || arrayItems.length === 0) {
    return { success: false, message: 'No se recibieron archivos para migrar' };
  }

  const exitosos = [];
  let fallidos = 0;

  for (let i = 0; i < arrayItems.length; i++) {
    const item = arrayItems[i];
    const fileId = typeof item === 'object' ? item.id : item;
    const nombre = typeof item === 'object' ? item.nombre : null;
    const mime = typeof item === 'object' ? item.mimeType : null;
    const tipoDoc = typeof item === 'object' ? item.tipoDocumento : null;

    try {
      const res = guardarArchivoDesdePreview(idCarpeta, fileId, nombre, mime, tipoDoc, idUsuarioOToken);
      if (res && res.success) {
        exitosos.push(res.archivo);
      } else {
        fallidos++;
      }
    } catch (errItem) {
      Logger.log('Error migrando archivo individual Drive (' + fileId + '): ' + errItem);
      fallidos++;
    }
  }

  return {
    success: exitosos.length > 0,
    archivos: exitosos,
    totalProcesados: arrayItems.length,
    totalExitosos: exitosos.length,
    totalFallidos: fallidos,
    message: exitosos.length > 0
      ? 'Se migraron ' + exitosos.length + ' archivo(s) correctamente' + (fallidos > 0 ? ' (' + fallidos + ' no se pudieron copiar).' : '.')
      : 'No se pudo migrar ninguno de los archivos seleccionados.'
  };
}

/**
 * Obtiene los metadatos de un archivo de Drive a partir de su ID o URL completa.
 */
function obtenerArchivoPorIdOUrl(idOUrl) {
  try {
    const str = String(idOUrl || '').trim();
    let fileId = str;

    const regexDrive = /[-\w]{25,}/;
    const match = str.match(regexDrive);
    if (match) {
      fileId = match[0];
    }

    const file = DriveApp.getFileById(fileId);
    if (!file || file.isTrashed()) {
      return { success: false, message: 'Archivo no encontrado o está en la papelera' };
    }

    return {
      success: true,
      archivo: {
        id: file.getId(),
        name: file.getName(),
        nombre: file.getName(),
        mimeType: file.getMimeType(),
        size: file.getSize(),
        tamano: file.getSize(),
        url: file.getUrl(),
        fechaModificacion: file.getLastUpdated() ? Utilities.formatDate(file.getLastUpdated(), "GMT-5", "yyyy-MM-dd HH:mm") : '',
        tipo: obtenerTipoDocPorExtension_(file.getName())
      }
    };
  } catch (error) {
    Logger.log('Error obtenerArchivoPorIdOUrl: ' + error);
    return { success: false, message: 'No se pudo acceder al archivo. Verifica que el enlace sea correcto y tengas permisos.' };
  }
}

function guardarArchivoDesdePreview(idCarpeta, fileId, nombreArchivo, mimeType, tipoDocumento, idUsuario, usuariosRestringidos) {
  try {
    if (idCarpeta === null || idCarpeta === undefined || String(idCarpeta).trim() === '') {
      return { success: false, message: 'No se especificó una carpeta de destino' };
    }

    const archivoOriginal = DriveApp.getFileById(fileId);

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaCarpetas = ss.getSheetByName('Carpetas');
    if (!hojaCarpetas) return { success: false, message: 'Hoja Carpetas no encontrada' };

    const datosCarpetas = hojaCarpetas.getDataRange().getValues();
    const encabezadosCarpetas = datosCarpetas[0];
    const idxIdCarpeta = encabezadosCarpetas.indexOf('ID_Carpeta');
    const idxDriveFolderId = encabezadosCarpetas.indexOf('DriveFolderId');

    let carpetaDestino = null;
    const idCarpetaStr = String(idCarpeta).trim();

    for (let i = 1; i < datosCarpetas.length; i++) {
      if (String(datosCarpetas[i][idxIdCarpeta]).trim() === idCarpetaStr) {
        const driveFolderId = datosCarpetas[i][idxDriveFolderId];
        if (driveFolderId) {
          try {
            carpetaDestino = DriveApp.getFolderById(driveFolderId);
          } catch (e) {
            Logger.log('Error accediendo carpeta destino: ' + e);
          }
        }
        break;
      }
    }

    if (!carpetaDestino) {
      return { success: false, message: 'La carpeta destino no está disponible. Recarga la página e intenta de nuevo.' };
    }

    const nombreFinal = nombreArchivo || archivoOriginal.getName();
    const archivoCopia = archivoOriginal.makeCopy(nombreFinal, carpetaDestino);
    const nuevoFileId = archivoCopia.getId();

    const hojaArchivos = ss.getSheetByName('Archivos');
    if (!hojaArchivos) return { success: false, message: 'Hoja de Archivos no encontrada' };

    const idArchivo = generarIdArchivo();
    const realMime = String(mimeType || archivoOriginal.getMimeType() || '').toLowerCase();

    let extension = '';
    if (nombreFinal.indexOf('.') !== -1) {
      extension = nombreFinal.split('.').pop().toLowerCase();
    } else {
      if (realMime.includes('spreadsheet') || realMime.includes('sheet') || realMime.includes('excel')) extension = 'xlsx';
      else if (realMime.includes('presentation') || realMime.includes('slide') || realMime.includes('powerpoint')) extension = 'pptx';
      else if (realMime.includes('pdf')) extension = 'pdf';
      else if (realMime.includes('image')) extension = 'png';
      else if (realMime.includes('document') || realMime.includes('word')) extension = 'docx';
      else extension = 'docx';
    }

    let tipoFinal = tipoDocumento;
    if (!tipoFinal || tipoFinal === 'Otro') {
      if (realMime.includes('spreadsheet') || realMime.includes('sheet') || realMime.includes('excel') || extension === 'xlsx' || extension === 'xls' || extension === 'csv') tipoFinal = 'Excel';
      else if (realMime.includes('presentation') || realMime.includes('slide') || realMime.includes('powerpoint') || extension === 'pptx' || extension === 'ppt') tipoFinal = 'PowerPoint';
      else if (realMime.includes('pdf') || extension === 'pdf') tipoFinal = 'PDF';
      else if (realMime.includes('document') || realMime.includes('word') || extension === 'docx' || extension === 'doc') tipoFinal = 'Word';
      else if (realMime.includes('image')) tipoFinal = 'Imagen';
      else tipoFinal = obtenerTipoDocPorExtension_(nombreFinal);
    }

    const ahora = new Date();
    const tamano = archivoCopia.getSize();

    hojaArchivos.appendRow([
      idArchivo,
      idCarpeta,
      nuevoFileId,
      nombreFinal,
      extension,
      tipoFinal,
      'Activo',
      idUsuario || '',
      realMime,
      'https://drive.google.com/file/d/' + nuevoFileId + '/view',
      ahora,
      ahora,
      ahora,
      tamano
    ]);

    Logger.log('✅ Archivo vinculado desde Drive: ' + nombreFinal + ' (ID: ' + idArchivo + ', Ext: ' + extension + ', Tipo: ' + tipoFinal + ')');
    registrarAuditoriaSimple_(idUsuario, 'VINCULAR_ARCHIVO_DRIVE', 'Vinculó desde Google Drive: ' + nombreFinal, 'Archivo');

    // Guardar permisos si se especificaron
    if (usuariosRestringidos && usuariosRestringidos.length > 0) {
      try {
        guardarPermisosArchivo(idArchivo, usuariosRestringidos);
        Logger.log('✅ Permisos guardados para archivo: ' + idArchivo);
      } catch (permError) {
        Logger.log('⚠️  Error guardando permisos (no afecta el archivo): ' + permError);
      }
    }

    return {
      success: true,
      message: 'Archivo vinculado correctamente',
      archivo: {
        id: idArchivo,
        idCarpeta: idCarpeta,
        nombre: nombreFinal,
        extension: extension,
        tipo: tipoFinal,
        driveUrl: 'https://drive.google.com/file/d/' + nuevoFileId + '/view',
        driveFileId: nuevoFileId,
        tamano: tamano,
        fecha: ahora.toISOString()
      }
    };
  } catch (error) {
    Logger.log('Error guardarArchivoDesdePreview: ' + error);
    return { success: false, message: 'Error al vincular archivo: ' + error.toString() };
  }
}
