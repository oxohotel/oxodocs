/**
 * Gestión de hoteles desde la app: crear, renombrar, mover entre módulos y eliminar.
 * Solo Superadministrador (rol 3), verificado en cada llamada contra la hoja "Usuarios".
 *
 * Un hotel se identifica por su ID_Hotel (hoja "Hoteles"); sus áreas, carpetas, archivos, permisos y
 * los accesos de usuarios apuntan a ese ID, nunca al módulo. Por eso mover un hotel solo cambia
 * "Hoteles.ID_Modulo" y la ubicación de su carpeta en Drive: el ID de la carpeta de Drive no cambia
 * al moverla, así que todo lo que cuelga del hotel sigue funcionando.
 *
 * Se leen las lecturas de la sidebar con obtenerModulosConHoteles (backend/Hoteles.js).
 */

const MODULOS_GESTIONABLES_ = ['Hoteles en operación', 'Hoteles en pre-apertura', 'Hoteles en desarrollo'];
const MODULO_PROTEGIDO_ = 'Corporativo'; // sede única: no se renombra, mueve ni elimina desde la app

function normalizarNombreHotel_(texto) {
  return String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
}

/** Clave para comparar nombres ignorando mayúsculas, tildes y espacios repetidos. */
function claveNombreHotel_(texto) {
  return normalizarNombreHotel_(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve al solicitante solo si es Superadministrador (rol leído en vivo de la hoja Usuarios). */
function exigirSuperadmin_(idUsuarioOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante || !solicitante.idUsuario) return null;
  const info = obtenerInfoRol_(obtenerRolDeUsuario_(solicitante.idUsuario));
  return (info && String(info.id) === '3') ? solicitante : null;
}

function contextoGestionHoteles_() {
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  const hojaModulos = ss.getSheetByName('Modulos');
  const hojaHoteles = ss.getSheetByName('Hoteles');
  const hojaCarpetas = ss.getSheetByName('Carpetas');
  if (!hojaModulos || !hojaHoteles || !hojaCarpetas) {
    throw new Error('Faltan las hojas Modulos, Hoteles o Carpetas');
  }
  return { ss: ss, hojaModulos: hojaModulos, hojaHoteles: hojaHoteles, hojaCarpetas: hojaCarpetas };
}

/** Módulos: [ID_Modulo, Nombre_Modulo, Orden, DriveFolderId, ...] */
function buscarModulo_(ctx, idModulo) {
  const filas = ctx.hojaModulos.getDataRange().getValues();
  for (let i = 1; i < filas.length; i++) {
    if (String(filas[i][0]) === String(idModulo)) {
      return { id: filas[i][0], nombre: String(filas[i][1]), driveFolderId: filas[i][3] };
    }
  }
  return null;
}

/** Hoteles: [ID_Hotel, Nombre_Hotel, ID_Modulo, DriveFolderId, Fecha_Creacion] */
function buscarHotel_(ctx, idHotel) {
  const filas = ctx.hojaHoteles.getDataRange().getValues();
  for (let i = 1; i < filas.length; i++) {
    if (String(filas[i][0]) === String(idHotel)) {
      return { fila: i + 1, id: filas[i][0], nombre: String(filas[i][1]), idModulo: filas[i][2], driveFolderId: filas[i][3] };
    }
  }
  return null;
}

function existeNombreDeHotel_(ctx, nombre, idHotelExcluido) {
  const clave = claveNombreHotel_(nombre);
  const filas = ctx.hojaHoteles.getDataRange().getValues();
  for (let i = 1; i < filas.length; i++) {
    if (idHotelExcluido != null && String(filas[i][0]) === String(idHotelExcluido)) continue;
    if (claveNombreHotel_(filas[i][1]) === clave) return true;
  }
  return false;
}

function maximoIdNumerico_(filas) {
  let max = 0;
  for (let i = 1; i < filas.length; i++) {
    const n = Number(filas[i][0]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

/**
 * Crea un hotel dentro de un módulo: su carpeta en Drive, las áreas fijas (AREAS_FIJAS) y las filas
 * en "Hoteles" y "Carpetas". Primero se crea todo en Drive y solo al final se escribe en las hojas,
 * para que un fallo a mitad de camino no deje un hotel a medias en el sistema.
 */
function crearHotelImpl_(nombreHotel, idModulo, idUsuarioOToken, idUsuarioFallback) {
  const solicitante = exigirSuperadmin_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante) return { success: false, message: 'Solo un Superadministrador puede gestionar hoteles' };

  const nombre = normalizarNombreHotel_(nombreHotel);
  if (!nombre) return { success: false, message: 'El nombre del hotel no puede estar vacío' };
  if (nombre.length > 120) return { success: false, message: 'El nombre del hotel es demasiado largo (máximo 120 caracteres)' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ctx = contextoGestionHoteles_();

    const modulo = buscarModulo_(ctx, idModulo);
    if (!modulo || MODULOS_GESTIONABLES_.indexOf(modulo.nombre) === -1) {
      return { success: false, message: 'Módulo no válido para agregar hoteles' };
    }
    if (existeNombreDeHotel_(ctx, nombre, null)) {
      return { success: false, message: 'Ya existe un hotel con ese nombre' };
    }

    // 1. Drive (si una carpeta ya existía de un intento anterior, se reutiliza)
    const carpetaModulo = conReintentos_(function () { return DriveApp.getFolderById(modulo.driveFolderId); });
    const hotelDrive = obtenerOCrearSubcarpeta_(carpetaModulo, nombre).carpeta;
    const areasDrive = DRIVE_CONFIG.AREAS_FIJAS.map(function (nombreArea) {
      return { nombre: nombreArea, id: obtenerOCrearSubcarpeta_(hotelDrive, nombreArea).carpeta.getId() };
    });

    // 2. Hojas
    const filasHoteles = ctx.hojaHoteles.getDataRange().getValues();
    const filasCarpetas = ctx.hojaCarpetas.getDataRange().getValues();
    const nuevoIdHotel = maximoIdNumerico_(filasHoteles) + 1;
    const ahora = new Date();

    const filaHotel = filasHoteles.length + 1;
    conReintentos_(function () {
      ctx.hojaHoteles.getRange(filaHotel, 1, 1, 5).setValues([[nuevoIdHotel, nombre, modulo.id, hotelDrive.getId(), ahora]]);
    });

    try {
      const idx = indiceEncabezados_(ctx.hojaCarpetas);
      const ancho = ctx.hojaCarpetas.getLastColumn();
      let siguienteIdCarpeta = maximoIdNumerico_(filasCarpetas) + 1;
      const filasNuevas = areasDrive.map(function (area, j) {
        const fila = new Array(ancho).fill('');
        fila[idx['ID_Carpeta']] = siguienteIdCarpeta++;
        fila[idx['ID_Hotel']] = nuevoIdHotel;
        fila[idx['ID_Plantilla']] = j + 1;
        fila[idx['Nombre_Carpeta']] = area.nombre;
        fila[idx['DriveFolderId']] = area.id;
        fila[idx['Fecha_Creacion']] = ahora;
        return fila; // ID_Padre queda en blanco: son áreas, no subcarpetas
      });
      conReintentos_(function () {
        ctx.hojaCarpetas.getRange(filasCarpetas.length + 1, 1, filasNuevas.length, ancho).setValues(filasNuevas);
      });
    } catch (errCarpetas) {
      try { ctx.hojaHoteles.deleteRow(filaHotel); } catch (e) { Logger.log('No se pudo deshacer la fila del hotel: ' + e); }
      throw errCarpetas;
    }

    registrarAuditoriaSimple_(solicitante.idUsuario, 'CREAR_HOTEL', 'Creó el hotel "' + nombre + '" en "' + modulo.nombre + '"', 'Hotel');
    return { success: true, hotel: { idHotel: nuevoIdHotel, nombre: nombre, idModulo: modulo.id } };
  } catch (error) {
    Logger.log('Error crearHotel: ' + error);
    return { success: false, message: 'No se pudo crear el hotel: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Renombra un hotel y/o lo mueve a otro módulo (de los tres módulos de hoteles). Primero se cambia
 * Drive y luego la hoja; si la hoja falla, se deshace lo hecho en Drive.
 */
function editarHotelImpl_(idHotel, nuevoNombre, idModuloDestino, idUsuarioOToken, idUsuarioFallback) {
  const solicitante = exigirSuperadmin_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante) return { success: false, message: 'Solo un Superadministrador puede gestionar hoteles' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ctx = contextoGestionHoteles_();

    const hotel = buscarHotel_(ctx, idHotel);
    if (!hotel) return { success: false, message: 'Hotel no encontrado' };

    const moduloActual = buscarModulo_(ctx, hotel.idModulo);
    if (!moduloActual || moduloActual.nombre === MODULO_PROTEGIDO_) {
      return { success: false, message: 'Este hotel no se puede modificar desde aquí' };
    }

    const nombreFinal = normalizarNombreHotel_(nuevoNombre) || hotel.nombre;
    if (nombreFinal.length > 120) return { success: false, message: 'El nombre del hotel es demasiado largo (máximo 120 caracteres)' };
    const renombrar = nombreFinal !== hotel.nombre;
    if (renombrar && existeNombreDeHotel_(ctx, nombreFinal, hotel.id)) {
      return { success: false, message: 'Ya existe un hotel con ese nombre' };
    }

    const moduloFinal = idModuloDestino ? buscarModulo_(ctx, idModuloDestino) : moduloActual;
    if (!moduloFinal || MODULOS_GESTIONABLES_.indexOf(moduloFinal.nombre) === -1) {
      return { success: false, message: 'Módulo de destino no válido' };
    }
    const mover = String(moduloFinal.id) !== String(moduloActual.id);

    if (!renombrar && !mover) return { success: true, sinCambios: true };

    // 1. Drive
    const carpetaHotel = conReintentos_(function () { return DriveApp.getFolderById(hotel.driveFolderId); });
    const carpetaModuloOrigen = DriveApp.getFolderById(moduloActual.driveFolderId);
    if (mover) {
      const carpetaModuloDestino = conReintentos_(function () { return DriveApp.getFolderById(moduloFinal.driveFolderId); });
      carpetaHotel.moveTo(carpetaModuloDestino);
    }
    if (renombrar) carpetaHotel.setName(nombreFinal);

    // 2. Hoja (Nombre_Hotel e ID_Modulo son columnas contiguas: B y C)
    try {
      conReintentos_(function () {
        ctx.hojaHoteles.getRange(hotel.fila, 2, 1, 2).setValues([[nombreFinal, moduloFinal.id]]);
      });
    } catch (errHoja) {
      try { if (renombrar) carpetaHotel.setName(hotel.nombre); } catch (e) { Logger.log('No se pudo deshacer el nombre en Drive: ' + e); }
      try { if (mover) carpetaHotel.moveTo(carpetaModuloOrigen); } catch (e) { Logger.log('No se pudo deshacer el movimiento en Drive: ' + e); }
      throw errHoja;
    }

    const detalle = (renombrar ? 'Renombró "' + hotel.nombre + '" a "' + nombreFinal + '". ' : '') +
      (mover ? 'Movió "' + nombreFinal + '" de "' + moduloActual.nombre + '" a "' + moduloFinal.nombre + '".' : '');
    registrarAuditoriaSimple_(solicitante.idUsuario, 'EDITAR_HOTEL', detalle.trim(), 'Hotel');
    return { success: true, hotel: { idHotel: hotel.id, nombre: nombreFinal, idModulo: moduloFinal.id } };
  } catch (error) {
    Logger.log('Error editarHotel: ' + error);
    return { success: false, message: 'No se pudo editar el hotel: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Reescribe las filas de datos de "hoja" conservando solo las que NO cumplen debeEliminar(fila, idx). */
function eliminarFilasSi_(hoja, debeEliminar) {
  if (!hoja) return 0;
  const datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return 0;
  const idx = {};
  datos[0].forEach(function (h, i) { idx[String(h).trim()] = i; });

  const conservar = [];
  let eliminadas = 0;
  for (let i = 1; i < datos.length; i++) {
    if (debeEliminar(datos[i], idx)) eliminadas++;
    else conservar.push(datos[i]);
  }
  if (!eliminadas) return 0;

  const ancho = datos[0].length;
  hoja.getRange(2, 1, datos.length - 1, ancho).clearContent();
  if (conservar.length) hoja.getRange(2, 1, conservar.length, ancho).setValues(conservar);
  return eliminadas;
}

/**
 * Elimina un hotel y todo lo que cuelga de él (áreas, carpetas, archivos, permisos, favoritos,
 * actividad, notificaciones y su acceso en los usuarios). La carpeta de Drive va a la PAPELERA
 * (recuperable 30 días). Exige escribir el nombre exacto del hotel como confirmación.
 */
function eliminarHotelImpl_(idHotel, nombreConfirmacion, idUsuarioOToken, idUsuarioFallback) {
  const solicitante = exigirSuperadmin_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante) return { success: false, message: 'Solo un Superadministrador puede gestionar hoteles' };

  const lock = LockService.getScriptLock();
  let carpetaHotel = null;
  let enPapelera = false;
  try {
    lock.waitLock(20000);
    const ctx = contextoGestionHoteles_();

    const hotel = buscarHotel_(ctx, idHotel);
    if (!hotel) return { success: false, message: 'Hotel no encontrado' };

    const modulo = buscarModulo_(ctx, hotel.idModulo);
    if (!modulo || modulo.nombre === MODULO_PROTEGIDO_) {
      return { success: false, message: 'Este hotel no se puede eliminar desde aquí' };
    }
    if (claveNombreHotel_(nombreConfirmacion) !== claveNombreHotel_(hotel.nombre)) {
      return { success: false, message: 'El nombre escrito no coincide con el del hotel. No se eliminó nada.' };
    }

    // Qué cuelga del hotel
    const idHotelStr = String(hotel.id);
    const datosCarpetas = ctx.hojaCarpetas.getDataRange().getValues();
    const idxC = {};
    datosCarpetas[0].forEach(function (h, i) { idxC[String(h).trim()] = i; });
    const idsCarpetas = new Set();
    for (let i = 1; i < datosCarpetas.length; i++) {
      if (String(datosCarpetas[i][idxC['ID_Hotel']]) === idHotelStr) idsCarpetas.add(String(datosCarpetas[i][idxC['ID_Carpeta']]));
    }

    const hojaArchivos = ctx.ss.getSheetByName('Archivos');
    const idsArchivos = new Set();
    if (hojaArchivos) {
      const datosA = hojaArchivos.getDataRange().getValues();
      const iCarp = datosA[0].indexOf('ID_Carpeta');
      const iArch = datosA[0].indexOf('ID_Archivo');
      for (let i = 1; i < datosA.length; i++) {
        if (idsCarpetas.has(String(datosA[i][iCarp]))) idsArchivos.add(String(datosA[i][iArch]));
      }
    }

    const apuntaAlHotel = function (fila, idx) {
      const tipo = String(fila[idx['Tipo_Recurso']]);
      const id = String(fila[idx['ID_Recurso']]);
      return (tipo === 'Hotel' && id === idHotelStr) ||
             (tipo === 'Carpeta' && idsCarpetas.has(id)) ||
             (tipo === 'Archivo' && idsArchivos.has(id));
    };

    // 1. Drive: a la papelera (si ya no existe, se sigue con la limpieza de hojas)
    try {
      carpetaHotel = DriveApp.getFolderById(hotel.driveFolderId);
      carpetaHotel.setTrashed(true);
      enPapelera = true;
    } catch (errDrive) {
      Logger.log('Carpeta de Drive del hotel no disponible, se continúa con las hojas: ' + errDrive);
    }

    // 2. Hojas (primero lo que cuelga del hotel, al final el hotel)
    let resumen;
    try {
      resumen = {
        archivos: eliminarFilasSi_(hojaArchivos, function (f, idx) { return idsCarpetas.has(String(f[idx['ID_Carpeta']])); }),
        permisos: eliminarFilasSi_(ctx.ss.getSheetByName('Permisos_Archivos'), function (f, idx) { return idsArchivos.has(String(f[idx['ID_Archivo']])); }),
        favoritos: eliminarFilasSi_(ctx.ss.getSheetByName('Favoritos'), apuntaAlHotel),
        actividad: eliminarFilasSi_(ctx.ss.getSheetByName('Actividad_Reciente'), apuntaAlHotel),
        notificaciones: eliminarFilasSi_(ctx.ss.getSheetByName('Notificaciones'), apuntaAlHotel),
        indiceBusqueda: eliminarFilasSi_(ctx.ss.getSheetByName('Indice_Busqueda'), function (f, idx) {
          return idx['ID_Hotel'] !== undefined && String(f[idx['ID_Hotel']]) === idHotelStr;
        }),
        carpetas: eliminarFilasSi_(ctx.hojaCarpetas, function (f, idx) { return String(f[idx['ID_Hotel']]) === idHotelStr; })
      };
      quitarHotelDeAccesosDeUsuarios_(ctx.ss, idHotelStr);
      ctx.hojaHoteles.deleteRow(buscarHotel_(ctx, hotel.id).fila);
    } catch (errHojas) {
      if (enPapelera) { try { carpetaHotel.setTrashed(false); } catch (e) { Logger.log('No se pudo sacar de la papelera: ' + e); } }
      throw errHojas;
    }

    registrarAuditoriaSimple_(solicitante.idUsuario, 'ELIMINAR_HOTEL',
      'Eliminó el hotel "' + hotel.nombre + '" (' + resumen.carpetas + ' carpetas, ' + resumen.archivos + ' archivos)', 'Hotel');
    return { success: true, resumen: resumen };
  } catch (error) {
    Logger.log('Error eliminarHotel: ' + error);
    return { success: false, message: 'No se pudo eliminar el hotel: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Quita el ID del hotel de la lista "Hoteles_Permitidos" ("3,5,9") de cada usuario. */
function quitarHotelDeAccesosDeUsuarios_(ss, idHotelStr) {
  const hoja = ss.getSheetByName('Usuarios');
  if (!hoja) return;
  const datos = hoja.getDataRange().getValues();
  const col = datos[0].findIndex(function (h) {
    const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
    return n === 'hotelespermitidos' || n === 'hoteles';
  });
  if (col === -1) return;
  for (let i = 1; i < datos.length; i++) {
    const valor = String(datos[i][col] == null ? '' : datos[i][col]).trim();
    if (!valor || valor === '*' || valor.toUpperCase() === 'TODOS') continue;
    const partes = valor.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const nuevas = partes.filter(function (p) { return p !== idHotelStr; });
    if (nuevas.length !== partes.length) hoja.getRange(i + 1, col + 1).setValue(nuevas.join(','));
  }
  invalidarCacheUsuarios_();
}

// ---- Envolturas: pase lo que pase (éxito, error o salida temprana) se invalida el caché de lectura (backend/Cache.js)

function crearHotel(nombreHotel, idModulo, idUsuarioOToken, idUsuarioFallback) {
  try {
    return crearHotelImpl_(nombreHotel, idModulo, idUsuarioOToken, idUsuarioFallback);
  } finally {
    invalidarCacheHoteles_();
    invalidarCacheUsuarios_();
  }
}

function editarHotel(idHotel, nuevoNombre, idModuloDestino, idUsuarioOToken, idUsuarioFallback) {
  try {
    return editarHotelImpl_(idHotel, nuevoNombre, idModuloDestino, idUsuarioOToken, idUsuarioFallback);
  } finally {
    invalidarCacheHoteles_();
    invalidarCacheUsuarios_();
  }
}

function eliminarHotel(idHotel, nombreConfirmacion, idUsuarioOToken, idUsuarioFallback) {
  try {
    return eliminarHotelImpl_(idHotel, nombreConfirmacion, idUsuarioOToken, idUsuarioFallback);
  } finally {
    invalidarCacheHoteles_();
    invalidarCacheUsuarios_();
  }
}
