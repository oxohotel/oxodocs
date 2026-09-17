/**
 * Automatización idempotente de la estructura de Google Drive:
 * Carpeta raíz -> 4 Módulos (3 de hoteles + Corporativo) -> 35 hoteles + 1 sede corporativa
 * -> áreas fijas cada uno (ver AREAS_FIJAS).
 * Dentro de cada área, el usuario puede crear subcarpetas y subir archivos libremente en
 * cualquier nivel (ver backend/Carpetas.js: crearSubcarpeta/obtenerContenidoCarpeta) — esas
 * subcarpetas quedan registradas en la hoja "Carpetas" enlazadas por "ID_Padre"; las áreas en
 * sí (esta primera capa fija) siempre tienen "ID_Padre" en blanco.
 * - Idempotente: usa getFoldersByName antes de crear, nunca duplica en reintentos.
 * - Resumible: guarda progreso en PropertiesService y se auto-continúa vía trigger si se acerca al límite de 6 min.
 * - Escribe cada DriveFolderId de vuelta en las hojas "Modulos", "Hoteles" y "Carpetas".
 * - Resiliente: reintenta con backoff exponencial ante errores transitorios de Drive/Sheets
 *   (ej. "Service Spreadsheets failed"), y si un hotel falla tras agotar reintentos, guarda el
 *   progreso justo ahí en vez de dejar que la excepción tumbe la ejecución sin registrar avance.
 */

const DRIVE_CONFIG = {
  SPREADSHEET_ID: '1XmIWSanOTBZspA3Zblq6zzmfjnfmDCJRFj4rdJn0Lcc', // mismo Sheet ID que BaseDatos.js
  ROOT_FOLDER_ID: '1witDS7Rl9So3knwTRXkAZ4_P2DgyS4DL', // carpeta raíz ya existente, provista por el usuario
  PROP_PROGRESO_INDICE: 'DRIVE_PROGRESO_INDICE_HOTEL',
  PROP_TRIGGER_ID: 'DRIVE_TRIGGER_CONTINUACION_ID',
  MAX_MS_EJECUCION: 5 * 60 * 1000,
  MODULOS: ['Hoteles en operación', 'Hoteles en pre-apertura', 'Hoteles en desarrollo', 'Corporativo'],
  AREAS_FIJAS: [
    'Alimentos y Bebidas',
    'CAF',
    'IT',
    'Jurídico',
    'Presidencia',
    'Relación con Inversionistas',
    'Revenue',
    'Comercial',
    'Desarrollo',
    'Operaciones',
    'Talento Humano'
  ]
};

// -------- Hoteles en operación (28) --------
// -------- Hoteles en pre-apertura (3) --------
// -------- Hoteles en desarrollo (4) --------
// -------- Corporativo (1 sola sede) --------
const HOTELES_REALES = [
  { nombre: 'AC Hotel by Marriott Bogotá Zona T', modulo: 'Hoteles en operación' },
  { nombre: 'The Artisan D.C. Hotel, Autograph Collection', modulo: 'Hoteles en operación' },
  { nombre: 'Courtyard by Marriott Bogotá Airport', modulo: 'Hoteles en operación' },
  { nombre: 'Residence Inn by Marriott Bogotá', modulo: 'Hoteles en operación' },
  { nombre: 'Holiday Inn Express & Suites Bogotá', modulo: 'Hoteles en operación' },
  { nombre: 'Holiday Inn Express Bogotá Parque La 93', modulo: 'Hoteles en operación' },
  { nombre: '84 DC', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Chicó Parque 93', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Coco', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Distrito ZF', modulo: 'Hoteles en operación' },
  { nombre: 'Ermita Cartagena, a Tribute Portfolio Hotel', modulo: 'Hoteles en operación' },
  { nombre: 'Nácar Hotel Cartagena, Curio Collection by Hilton', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Grand Sirenis Cartagena', modulo: 'Hoteles en operación' },
  { nombre: 'Holiday Inn Express Cartagena Bocagrande', modulo: 'Hoteles en operación' },
  { nombre: 'Isla Corona', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Santa Catalina', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Sophia', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Grand Sirenis San Andrés', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel San Luis Beach House', modulo: 'Hoteles en operación' },
  { nombre: 'Loma Medellín, A Tribute Portfolio Hotel', modulo: 'Hoteles en operación' },
  { nombre: 'Fairfield by Marriott Medellín Sabaneta', modulo: 'Hoteles en operación' },
  { nombre: 'AC Hotel by Marriott Santa Marta', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Porto Horizonte Pozos Colorados', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Waya Guajira', modulo: 'Hoteles en operación' },
  { nombre: 'NAIO Hotel & Villas', modulo: 'Hoteles en operación' },
  { nombre: 'Hotel Bari', modulo: 'Hoteles en operación' },
  { nombre: 'Holiday Inn Express Yopal', modulo: 'Hoteles en operación' },
  { nombre: 'MIA Hotel Chocó', modulo: 'Hoteles en operación' },
  { nombre: 'Tapestry Miraflores', modulo: 'Hoteles en pre-apertura' },
  { nombre: 'Tapestry San Isidro', modulo: 'Hoteles en pre-apertura' },
  { nombre: 'Hilton Garden Inn Pereira', modulo: 'Hoteles en pre-apertura' },
  { nombre: 'DoubleTree Cali', modulo: 'Hoteles en desarrollo' },
  { nombre: 'City Express Tocancipá', modulo: 'Hoteles en desarrollo' },
  { nombre: 'Le Jardinier', modulo: 'Hoteles en desarrollo' },
  { nombre: 'Residence Inn Cartagena', modulo: 'Hoteles en desarrollo' },
  // -------- Corporativo (1 sola sede) --------
  { nombre: 'Corporativo', modulo: 'Corporativo' }
];

function crearEstructuraDriveCompleta() {
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);

  const hojaModulos = obtenerOCrearHoja_(ss, 'Modulos', ['ID_Modulo', 'Nombre_Modulo', 'Orden', 'DriveFolderId', 'Fecha_Creacion']);
  const hojaHoteles = obtenerOCrearHoja_(ss, 'Hoteles', ['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId', 'Fecha_Creacion']);
  const hojaCarpetas = obtenerOCrearHoja_(ss, 'Carpetas', ['ID_Carpeta', 'ID_Hotel', 'ID_Plantilla', 'Nombre_Carpeta', 'DriveFolderId', 'Fecha_Creacion']);
  // Columna para subcarpetas creadas a mano dentro de un área (en blanco = es un área, no una
  // subcarpeta) — se agrega sola si la hoja ya existía de antes sin ella.
  obtenerOAgregarColumna_(hojaCarpetas, 'ID_Padre');

  const idxModulos = construirIndice_(hojaModulos, function (row) { return row[1]; }); // Nombre_Modulo
  const idxHoteles = construirIndice_(hojaHoteles, function (row) { return row[2] + '|' + row[1]; }); // ID_Modulo|Nombre_Hotel
  const idxCarpetas = construirIndice_(hojaCarpetas, function (row) { return row[1] + '|' + row[3]; }); // ID_Hotel|Nombre_Carpeta

  const carpetaRaiz = DriveApp.getFolderById(DRIVE_CONFIG.ROOT_FOLDER_ID);

  const idsModuloDrive = {};
  const idsModuloLogico = {};
  DRIVE_CONFIG.MODULOS.forEach(function (nombreModulo, i) {
    const r = obtenerOCrearSubcarpeta_(carpetaRaiz, nombreModulo);
    const idLogico = upsert_(hojaModulos, idxModulos, nombreModulo, [nombreModulo, i + 1, r.carpeta.getId(), new Date()]);
    idsModuloDrive[nombreModulo] = r.carpeta;
    idsModuloLogico[nombreModulo] = idLogico;
    Logger.log((r.creada ? '✅ Creado' : '↺ Ya existía') + ' módulo: ' + nombreModulo);
  });

  const hoteles = obtenerListaHoteles_(ss);

  let indiceInicio = Number(props.getProperty(DRIVE_CONFIG.PROP_PROGRESO_INDICE) || 0);
  for (let i = indiceInicio; i < hoteles.length; i++) {
    if (Date.now() - inicio > DRIVE_CONFIG.MAX_MS_EJECUCION) {
      props.setProperty(DRIVE_CONFIG.PROP_PROGRESO_INDICE, String(i));
      programarContinuacion_();
      Logger.log('⏳ Progreso guardado en hotel #' + i + '. Continuación automática programada.');
      return;
    }
    const hotel = hoteles[i];
    const idModuloLogico = idsModuloLogico[hotel.modulo];
    const carpetaModuloDrive = idsModuloDrive[hotel.modulo];
    if (!idModuloLogico) {
      Logger.log('❌ Módulo no reconocido para "' + hotel.nombre + '": ' + hotel.modulo);
      continue;
    }

    try {
      const rHotel = obtenerOCrearSubcarpeta_(carpetaModuloDrive, hotel.nombre);
      const idHotelLogico = upsert_(hojaHoteles, idxHoteles, idModuloLogico + '|' + hotel.nombre,
        [hotel.nombre, idModuloLogico, rHotel.carpeta.getId(), new Date()]);

      DRIVE_CONFIG.AREAS_FIJAS.forEach(function (nombreArea, j) {
        const rArea = obtenerOCrearSubcarpeta_(rHotel.carpeta, nombreArea);
        // Solo llena las primeras 5 columnas (ID_Hotel, ID_Plantilla, Nombre_Carpeta,
        // DriveFolderId, Fecha_Creacion) — ID_Padre queda en blanco a propósito: un área no
        // tiene padre, es la raíz de su propio árbol de subcarpetas.
        upsert_(hojaCarpetas, idxCarpetas, idHotelLogico + '|' + nombreArea,
          [idHotelLogico, j + 1, nombreArea, rArea.carpeta.getId(), new Date()]);
        Utilities.sleep(150); // pequeño respiro entre escrituras para no saturar el servicio de Sheets
      });

      Logger.log((rHotel.creada ? '✅ Creado' : '↺ Ya existía') + ' hotel [' + (i + 1) + '/' + hoteles.length + ']: ' + hotel.nombre);
    } catch (e) {
      // Agotados los reintentos automáticos: se guarda el progreso EXACTO en este hotel (no en el último
      // checkpoint de tiempo) para que la próxima corrida no tenga que re-verificar hoteles ya completados.
      props.setProperty(DRIVE_CONFIG.PROP_PROGRESO_INDICE, String(i));
      Logger.log('❌ Falló el hotel [' + (i + 1) + '/' + hoteles.length + '] "' + hotel.nombre + '" tras reintentos: ' + e.message);
      Logger.log('⏳ Progreso guardado en hotel #' + i + '. Vuelve a ejecutar la función para reintentar desde aquí.');
      throw e;
    }
  }

  props.deleteProperty(DRIVE_CONFIG.PROP_PROGRESO_INDICE);
  limpiarTriggerContinuacion_();
  Logger.log('🎉 Completo: ' + DRIVE_CONFIG.MODULOS.length + ' módulos, ' + hoteles.length + ' hoteles, ' +
    (hoteles.length * DRIVE_CONFIG.AREAS_FIJAS.length) + ' áreas verificadas/creadas.');
}

/** Reintenta fn() con backoff exponencial ante errores transitorios de servicios de Google (Drive/Sheets). */
function conReintentos_(fn, intentosMax) {
  intentosMax = intentosMax || 5;
  for (let intento = 1; intento <= intentosMax; intento++) {
    try {
      return fn();
    } catch (e) {
      if (intento === intentosMax) throw e;
      const esperaMs = Math.pow(2, intento) * 500; // 1s, 2s, 4s, 8s, 16s...
      Logger.log('⚠️ Error transitorio ("' + e.message + '"), reintento ' + intento + '/' + intentosMax + ' en ' + esperaMs + 'ms');
      Utilities.sleep(esperaMs);
    }
  }
}

function obtenerOCrearSubcarpeta_(carpetaPadre, nombre) {
  const it = conReintentos_(function () { return carpetaPadre.getFoldersByName(nombre); });
  if (it.hasNext()) return { carpeta: it.next(), creada: false };
  return { carpeta: conReintentos_(function () { return carpetaPadre.createFolder(nombre); }), creada: true };
}

function obtenerOCrearHoja_(ss, nombre, encabezados) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(encabezados);
    hoja.setFrozenRows(1);
    const r = hoja.getRange(1, 1, 1, encabezados.length);
    r.setBackground('#4285F4');
    r.setFontColor('#FFFFFF');
    r.setFontWeight('bold');
  }
  return hoja; // NUNCA se borra/recrea — a diferencia de inicializarBaseDatos(), aquí viven los DriveFolderId reales
}

function construirIndice_(hoja, claveFn) {
  const filas = hoja.getDataRange().getValues();
  // siguienteFila se calcula UNA vez aquí y se incrementa en memoria en cada upsert_ — nunca se vuelve
  // a preguntar a Sheets "cuál es la última fila", que es justo lo que appendRow() hacía mal al reintentar.
  const indice = { mapa: {}, siguienteId: 1, siguienteFila: filas.length + 1 };
  for (let i = 1; i < filas.length; i++) {
    if (!filas[i][0]) continue;
    indice.mapa[claveFn(filas[i])] = { fila: i + 1, id: filas[i][0] };
    indice.siguienteId = Math.max(indice.siguienteId, Number(filas[i][0]) + 1);
  }
  return indice;
}

function upsert_(hoja, indice, clave, valoresSinId) {
  const existente = indice.mapa[clave];
  if (existente) return existente.id;
  const idNuevo = indice.siguienteId++;
  const filaDestino = indice.siguienteFila++; // fija ANTES de reintentar: reescribirla es inofensivo
  const valores = [idNuevo].concat(valoresSinId);
  conReintentos_(function () {
    hoja.getRange(filaDestino, 1, 1, valores.length).setValues([valores]);
  });
  indice.mapa[clave] = { fila: filaDestino, id: idNuevo };
  return idNuevo;
}

/** Borra filas duplicadas de "hoja" según las columnas clave dadas (0-indexadas), conservando la primera aparición. */
function eliminarFilasDuplicadas_(hoja, indicesColumnasClave) {
  const datos = hoja.getDataRange().getValues();
  const vistos = new Set();
  const filasABorrar = [];
  for (let i = 1; i < datos.length; i++) {
    const clave = indicesColumnasClave.map(function (c) { return datos[i][c]; }).join('|');
    if (vistos.has(clave)) {
      filasABorrar.push(i + 1); // número de fila real en la hoja (1-indexado, +1 por encabezado)
    } else {
      vistos.add(clave);
    }
  }
  filasABorrar.sort(function (a, b) { return b - a; }).forEach(function (fila) { hoja.deleteRow(fila); });
  return filasABorrar.length;
}

/**
 * Ejecutar UNA VEZ para limpiar las filas duplicadas que generó el bug de reintentos en appendRow()
 * (ya corregido en upsert_ arriba). Seguro de re-ejecutar: si no hay duplicados, no borra nada.
 */
function limpiarDuplicadosGenerados() {
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  const resultados = {};
  const hojaModulos = ss.getSheetByName('Modulos');
  if (hojaModulos) resultados.Modulos = eliminarFilasDuplicadas_(hojaModulos, [1]); // Nombre_Modulo
  const hojaHoteles = ss.getSheetByName('Hoteles');
  if (hojaHoteles) resultados.Hoteles = eliminarFilasDuplicadas_(hojaHoteles, [2, 1]); // ID_Modulo, Nombre_Hotel
  const hojaCarpetas = ss.getSheetByName('Carpetas');
  if (hojaCarpetas) resultados.Carpetas = eliminarFilasDuplicadas_(hojaCarpetas, [1, 2]); // ID_Hotel, ID_Plantilla
  Logger.log('🧹 Duplicados eliminados: ' + JSON.stringify(resultados));
}

function obtenerListaHoteles_(ss) {
  const hoja = ss.getSheetByName('Hoteles_Seed'); // hoja opcional de override manual, NO la hoja final "Hoteles"
  if (hoja && hoja.getLastRow() > 1) {
    return hoja.getDataRange().getValues().slice(1)
      .filter(function (f) { return f[0] && f[1]; })
      .map(function (f) { return { nombre: String(f[0]).trim(), modulo: String(f[1]).trim() }; });
  }
  return HOTELES_REALES;
}

function programarContinuacion_() {
  limpiarTriggerContinuacion_();
  const t = ScriptApp.newTrigger('crearEstructuraDriveCompleta').timeBased().after(60 * 1000).create();
  PropertiesService.getScriptProperties().setProperty(DRIVE_CONFIG.PROP_TRIGGER_ID, t.getUniqueId());
}

function limpiarTriggerContinuacion_() {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty(DRIVE_CONFIG.PROP_TRIGGER_ID);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crearEstructuraDriveCompleta' && (!idGuardado || t.getUniqueId() === idGuardado)) {
      ScriptApp.deleteTrigger(t);
    }
  });
  props.deleteProperty(DRIVE_CONFIG.PROP_TRIGGER_ID);
}

/** Utilidad de administración: reinicia solo el puntero de progreso (no borra nada de Drive ni de la hoja). */
function reiniciarProgresoCreacionDrive() {
  PropertiesService.getScriptProperties().deleteProperty(DRIVE_CONFIG.PROP_PROGRESO_INDICE);
  limpiarTriggerContinuacion_();
  Logger.log('🔄 Progreso reiniciado. La próxima corrida empezará desde el hotel #0 (no duplicará carpetas ya creadas, solo las verificará).');
}

/**
 * DESTRUCTIVO — ejecutar a mano UNA VEZ desde el editor, nunca desde la app: vacía cada
 * carpeta de hotel en Drive (envía a la papelera todo lo que tenga adentro — las 17 carpetas
 * viejas y cualquier archivo subido) y deja en blanco las hojas Carpetas/Archivos/Favoritos/
 * Actividad_Reciente (solo encabezados), para reconstruir desde cero con las áreas nuevas
 * (AREAS_FIJAS). Las carpetas de Módulo y de Hotel NO se tocan, solo su contenido.
 * Después de correr esto, ejecutar crearEstructuraDriveCompleta() para regenerar todo.
 */
function vaciarYRegenerarEstructura() {
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);

  const hojaHoteles = ss.getSheetByName('Hoteles');
  if (hojaHoteles && hojaHoteles.getLastRow() > 1) {
    const datos = hojaHoteles.getDataRange().getValues();
    const indexDriveFolderId = datos[0].indexOf('DriveFolderId');

    for (let i = 1; i < datos.length; i++) {
      const driveFolderId = datos[i][indexDriveFolderId];
      if (!driveFolderId) continue;

      try {
        const carpetaHotel = DriveApp.getFolderById(driveFolderId);

        const subcarpetas = carpetaHotel.getFolders();
        while (subcarpetas.hasNext()) {
          const carpetaHija = subcarpetas.next();
          conReintentos_(function () { carpetaHija.setTrashed(true); });
        }

        const archivosSueltos = carpetaHotel.getFiles();
        while (archivosSueltos.hasNext()) {
          const archivoSuelto = archivosSueltos.next();
          conReintentos_(function () { archivoSuelto.setTrashed(true); });
        }

        Logger.log('🗑️ Vaciada la carpeta de Drive del hotel en la fila ' + (i + 1));
      } catch (error) {
        Logger.log('⚠️ No se pudo vaciar la carpeta del hotel en la fila ' + (i + 1) + ': ' + error);
      }
    }
  }

  ['Carpetas', 'Archivos', 'Favoritos', 'Actividad_Reciente', 'Plantilla_Carpetas'].forEach(function (nombreHoja) {
    const hoja = ss.getSheetByName(nombreHoja);
    if (hoja && hoja.getLastRow() > 1) {
      hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
      Logger.log('🧹 Hoja "' + nombreHoja + '" vaciada (encabezados intactos).');
    }
  });

  // Resiembra "Plantilla_Carpetas" de una vez con las áreas nuevas (si existe la hoja).
  const hojaPlantilla = ss.getSheetByName('Plantilla_Carpetas');
  if (hojaPlantilla) crearPlantillaCarpetas_(ss);

  reiniciarProgresoCreacionDrive();
  Logger.log('✅ Listo. Ahora ejecuta crearEstructuraDriveCompleta() para crear las áreas nuevas en cada hotel.');
}

// ==================== Selector de archivos de Google Drive ====================

function obtenerArchivosDriveJson() {
  try {
    const archivos = obtenerArchivosRecientesDrive();
    return { success: true, archivos: archivos };
  } catch (error) {
    Logger.log('Error obtenerArchivosDriveJson: ' + error);
    return { success: false, message: error.toString() };
  }
}

function obtenerArchivoPorId(fileId) {
  try {
    const archivo = DriveApp.getFileById(fileId);

    return {
      success: true,
      archivo: {
        id: archivo.getId(),
        name: archivo.getName(),
        mimeType: archivo.getMimeType()
      }
    };
  } catch (error) {
    Logger.log('Error obtenerArchivoPorId: ' + error);
    return {
      success: false,
      message: 'No se encontró el archivo. Verifica que el ID sea correcto y que tengas acceso.'
    };
  }
}

function obtenerArchivosRecientesDrive() {
  try {
    const archivos = [];

    // Intentar primero con DriveApp (método simple)
    try {
      const rootFolder = DriveApp.getRootFolder();
      const allFiles = rootFolder.getFiles();

      while (allFiles.hasNext() && archivos.length < 50) {
        const file = allFiles.next();
        archivos.push({
          id: file.getId(),
          name: file.getName(),
          mimeType: file.getMimeType()
        });
      }
    } catch (e) {
      Logger.log('Error con DriveApp: ' + e);
    }

    // Si no encontró muchos archivos, intentar con búsqueda recursiva
    if (archivos.length < 10) {
      try {
        const rootFolder = DriveApp.getRootFolder();
        function buscarRecursivo(carpeta, profundidad = 0) {
          if (profundidad > 2 || archivos.length >= 100) return;

          try {
            const archivosEnCarpeta = carpeta.getFiles();
            while (archivosEnCarpeta.hasNext() && archivos.length < 100) {
              const archivo = archivosEnCarpeta.next();
              const id = archivo.getId();
              if (!archivos.find(a => a.id === id)) {
                archivos.push({
                  id: id,
                  name: archivo.getName(),
                  mimeType: archivo.getMimeType()
                });
              }
            }

            const subcarpetas = carpeta.getFolders();
            while (subcarpetas.hasNext() && archivos.length < 100) {
              const subcarpeta = subcarpetas.next();
              buscarRecursivo(subcarpeta, profundidad + 1);
            }
          } catch (e) {
            Logger.log('Error en carpeta: ' + e);
          }
        }

        buscarRecursivo(rootFolder);
      } catch (e) {
        Logger.log('Error en búsqueda recursiva: ' + e);
      }
    }

    // Ordenar por nombre
    archivos.sort((a, b) => a.name.localeCompare(b.name));

    Logger.log('✅ Se encontraron ' + archivos.length + ' archivos en Google Drive');

    return archivos;
  } catch (error) {
    Logger.log('❌ Error en obtenerArchivosRecientesDrive: ' + error);
    return [];
  }
}

// ==============================================================================
// GOOGLE DRIVE PICKER INTEGRATION & ALMACENAMIENTO CENTRAL
// ==============================================================================

// Reemplaza con el ID de una carpeta específica de Drive si no se desea usar la carpeta raíz del repositorio:
const ID_CARPETA_REPOSITORIO = '1witDS7Rl9So3knwTRXkAZ4_P2DgyS4DL';

/**
 * Retorna el token de OAuth interno del script para inicializar Google Picker.
 * Esto evita el uso de Google Identity Services en el cliente y previene
 * el error "origin_mismatch / usa un dominio prohibido" en iframes.
 */
function obtenerOAuthTokenPicker() {
  DriveApp.getRootFolder(); // Garantiza el scope de Drive activo
  return ScriptApp.getOAuthToken();
}

/**
 * Recibe un archivo seleccionado en Google Picker (por fileId o Base64)
 * y lo guarda o copia de forma segura en la carpeta del repositorio central.
 *
 * @param {string} base64DataOFileId - File ID de Drive o contenido codificado en Base64.
 * @param {string} fileName - Nombre del archivo con su extensión.
 * @param {string} mimeType - Tipo MIME del archivo.
 * @param {string} [idCarpetaDestino] - (Opcional) ID de la carpeta destino.
 * @param {string} [idUsuarioOToken] - (Opcional) ID del usuario o token de sesión.
 * @return {Object} Resultado de la operación { success, fileId, url, fileName, size, message }.
 */
function guardarDocumentoDrive(base64DataOFileId, fileName, mimeType, idCarpetaDestino, idUsuarioOToken, userOAuthToken) {
  try {
    Logger.log('=== GUARDAR DOCUMENTO DRIVE (PICKER) INICIO ===');
    Logger.log('Archivo: ' + fileName + ' | MIME: ' + mimeType + ' | Carpeta Destino: ' + idCarpetaDestino);

    if (!base64DataOFileId) {
      return { success: false, message: 'No se recibieron datos o ID del archivo.' };
    }

    const nombreFinal = String(fileName || ('Documento_' + Date.now())).trim();
    const mimeFinal = String(mimeType || 'application/octet-stream').trim();

    // 1. Determinar la carpeta de destino en Google Drive
    let carpetaDestino = null;

    if (idCarpetaDestino && typeof obtenerCarpetaDrive === 'function') {
      try {
        carpetaDestino = obtenerCarpetaDrive(idCarpetaDestino);
      } catch (e) {
        Logger.log('No se pudo resolver carpeta por ID interno: ' + e);
      }
    }

    if (!carpetaDestino && idCarpetaDestino) {
      try {
        carpetaDestino = DriveApp.getFolderById(idCarpetaDestino);
      } catch (e) {
        Logger.log('idCarpetaDestino no es un ID de carpeta de Drive directo: ' + e);
      }
    }

    if (!carpetaDestino && ID_CARPETA_REPOSITORIO && ID_CARPETA_REPOSITORIO !== 'TU_ID_CARPETA_REPOSITORIO') {
      try {
        carpetaDestino = DriveApp.getFolderById(ID_CARPETA_REPOSITORIO);
      } catch (e) {
        Logger.log('Error accediendo a ID_CARPETA_REPOSITORIO: ' + e);
      }
    }

    if (!carpetaDestino) {
      if (typeof DRIVE_CONFIG !== 'undefined' && DRIVE_CONFIG.ROOT_FOLDER_ID) {
        try {
          carpetaDestino = DriveApp.getFolderById(DRIVE_CONFIG.ROOT_FOLDER_ID);
        } catch (e) {
          Logger.log('Error accediendo a ROOT_FOLDER_ID: ' + e);
        }
      }
    }

    if (!carpetaDestino) {
      carpetaDestino = DriveApp.getRootFolder();
    }

    // 2. Crear o copiar el archivo en la carpeta de Drive
    let archivoCreado = null;
    let driveFileId = null;
    let driveUrl = null;
    let tamanoBytes = 0;

    // Intentar copiar directamente si es un File ID de Google Drive
    const strData = String(base64DataOFileId).trim();
    let copiadoPorId = false;

    if (strData.length >= 20 && strData.length <= 100 && /^[-\w]+$/.test(strData)) {
      try {
        const fileOriginal = DriveApp.getFileById(strData);
        if (fileOriginal) {
          archivoCreado = fileOriginal.makeCopy(nombreFinal, carpetaDestino);
          driveFileId = archivoCreado.getId();
          driveUrl = archivoCreado.getUrl();
          tamanoBytes = archivoCreado.getSize();
          copiadoPorId = true;
          Logger.log('✅ Archivo copiado nativamente en Drive por ID: ' + driveFileId);
        }
      } catch (errCopy) {
        Logger.log('No se pudo copiar directamente por ID, intentando creación alternativa: ' + errCopy);
      }

      // Si no pudo copiarse directamente, intentar descargar con UrlFetchApp usando el token
      if (!copiadoPorId) {
        try {
          const tokenUsar = userOAuthToken || ScriptApp.getOAuthToken();
          let fetchUrl = 'https://www.googleapis.com/drive/v3/files/' + strData + '?alt=media';
          if (mimeFinal.includes('google-apps.document')) {
            fetchUrl = 'https://www.googleapis.com/drive/v3/files/' + strData + '/export?mimeType=application/pdf';
            if (!nombreFinal.toLowerCase().endsWith('.pdf')) nombreFinal += '.pdf';
          } else if (mimeFinal.includes('google-apps.spreadsheet')) {
            fetchUrl = 'https://www.googleapis.com/drive/v3/files/' + strData + '/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            if (!nombreFinal.toLowerCase().endsWith('.xlsx')) nombreFinal += '.xlsx';
          } else if (mimeFinal.includes('google-apps.presentation')) {
            fetchUrl = 'https://www.googleapis.com/drive/v3/files/' + strData + '/export?mimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation';
            if (!nombreFinal.toLowerCase().endsWith('.pptx')) nombreFinal += '.pptx';
          }

          const resp = UrlFetchApp.fetch(fetchUrl, {
            headers: { Authorization: 'Bearer ' + tokenUsar },
            muteHttpExceptions: true
          });
          if (resp.getResponseCode() === 200) {
            const blob = resp.getBlob().setName(nombreFinal);
            archivoCreado = carpetaDestino.createFile(blob);
            driveFileId = archivoCreado.getId();
            driveUrl = archivoCreado.getUrl();
            tamanoBytes = archivoCreado.getSize();
            copiadoPorId = true;
            Logger.log('✅ Archivo descargado con UrlFetchApp por ID: ' + driveFileId);
          } else {
            Logger.log('UrlFetchApp retornó HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText());
          }
        } catch (eUrl) {
          Logger.log('Error en UrlFetchApp: ' + eUrl);
        }
      }
    }

    // Si no fue copiado por File ID, procesarlo como Base64
    if (!copiadoPorId) {
      try {
        const bytes = Utilities.base64Decode(strData);
        const blob = Utilities.newBlob(bytes, mimeFinal, nombreFinal);
        archivoCreado = carpetaDestino.createFile(blob);
        driveFileId = archivoCreado.getId();
        driveUrl = archivoCreado.getUrl();
        tamanoBytes = archivoCreado.getSize();
        Logger.log('✅ Archivo creado desde Base64 en Drive: ' + driveFileId);
      } catch (errB64) {
        Logger.log('Error decodificando Base64: ' + errB64);
        return {
          success: false,
          message: 'No se pudo transferir el archivo. Verifica los permisos de acceso en tu Drive.'
        };
      }
    }

    Logger.log('✅ Archivo creado en Drive con éxito. ID: ' + driveFileId);

    // 4. Registrar en la base de datos (Hoja "Archivos" de Google Sheets) si existe
    let idArchivoBD = 'DOC_' + Date.now();
    try {
      if (typeof DRIVE_CONFIG !== 'undefined' && DRIVE_CONFIG.SPREADSHEET_ID) {
        const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
        const hojaArchivos = ss.getSheetByName('Archivos');
        if (hojaArchivos) {
          idArchivoBD = (typeof generarIdArchivo === 'function') ? generarIdArchivo() : ('ARC_' + Date.now());
          const extension = nombreFinal.includes('.') ? nombreFinal.split('.').pop().toLowerCase() : '';
          const tipoDoc = (typeof obtenerTipoDocPorExtension_ === 'function') ? obtenerTipoDocPorExtension_(nombreFinal) : 'Documento';
          const fechaActual = new Date();

          let responsableNombre = 'Google Drive Picker';
          if (idUsuarioOToken && typeof resolverUsuarioSolicitante_ === 'function') {
            const sol = resolverUsuarioSolicitante_(idUsuarioOToken);
            if (sol && sol.nombre) responsableNombre = sol.nombre;
          }

          hojaArchivos.appendRow([
            idArchivoBD,
            idCarpetaDestino || '',
            driveFileId,
            nombreFinal,
            extension,
            tipoDoc,
            'Activo',
            responsableNombre,
            mimeFinal,
            driveUrl,
            fechaActual,
            fechaActual
          ]);
          Logger.log('✅ Registro añadido a la hoja Archivos. ID_Archivo: ' + idArchivoBD);
        }
      }
    } catch (errDb) {
      Logger.log('Nota: Archivo creado en Drive, pero no se pudo registrar en la hoja Archivos: ' + errDb);
    }

    return {
      success: true,
      fileId: driveFileId,
      idArchivoBD: idArchivoBD,
      url: driveUrl,
      fileName: nombreFinal,
      size: tamanoBytes,
      message: 'Documento "' + nombreFinal + '" guardado exitosamente en el repositorio.'
    };
  } catch (error) {
    Logger.log('❌ Error en guardarDocumentoDrive: ' + error);
    return {
      success: false,
      message: 'Error al guardar el documento en Google Drive: ' + error.message
    };
  }
}

