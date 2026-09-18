/**
 * Gestión de permisos de acceso a archivos.
 * Controla quién NO puede ver cada archivo mediante restricciones explícitas.
 */

/**
 * Obtiene lista de todos los usuarios del sistema para mostrar en selector de permisos
 */
function obtenerListaUsuariosParaPermisos() {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = ss.getSheetByName('Usuarios');
    if (!hojaUsuarios) {
      return { success: false, usuarios: [], message: 'Hoja de usuarios no encontrada' };
    }

    const datos = hojaUsuarios.getDataRange().getValues();
    const usuarios = [];

    // Saltar encabezado (fila 0)
    for (let i = 1; i < datos.length; i++) {
      if (datos[i][5] === 'Activo') { // Solo usuarios activos
        usuarios.push({
          id: String(datos[i][0]),
          nombre: datos[i][1],
          email: datos[i][2],
          restringido: false
        });
      }
    }

    return {
      success: true,
      usuarios: usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre))
    };
  } catch (error) {
    Logger.log('Error en obtenerListaUsuariosParaPermisos: ' + error);
    return { success: false, usuarios: [], message: error.toString() };
  }
}

/**
 * Obtiene los usuarios que tienen restricción de acceso a un archivo
 */
function obtenerUsuariosRestringidosArchivo(idArchivo) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return { success: true, usuarios: [] };
    }

    const datos = hojaPermisos.getDataRange().getValues();
    const usuariosRestringidos = [];

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][1]) === String(idArchivo)) {
        usuariosRestringidos.push({
          id: String(datos[i][2]),
          nombre: datos[i][3]
        });
      }
    }

    return {
      success: true,
      usuarios: usuariosRestringidos
    };
  } catch (error) {
    Logger.log('Error en obtenerUsuariosRestringidosArchivo: ' + error);
    return { success: true, usuarios: [] };
  }
}

/**
 * Guarda restricciones de acceso a un archivo
 * @param {string} idArchivo - ID del archivo
 * @param {array} usuariosRestringidos - Array de IDs de usuarios que NO pueden ver el archivo
 */
function guardarPermisosArchivo(idArchivo, usuariosRestringidos) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return { success: false, message: 'Hoja de permisos no encontrada' };
    }

    // Eliminar permisos anteriores para este archivo
    const datos = hojaPermisos.getDataRange().getValues();
    for (let i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][1]) === String(idArchivo)) {
        hojaPermisos.deleteRow(i + 1);
      }
    }

    // Agregar nuevos permisos
    if (usuariosRestringidos && usuariosRestringidos.length > 0) {
      const ahora = new Date();
      const fechaFormato = Utilities.formatDate(ahora, 'GMT-5', 'yyyy-MM-dd HH:mm:ss');

      // Obtener datos de usuarios para obtener nombres
      const hojaUsuarios = ss.getSheetByName('Usuarios');
      const datosUsuarios = hojaUsuarios.getDataRange().getValues();
      const usuariosMap = {};

      for (let i = 1; i < datosUsuarios.length; i++) {
        usuariosMap[String(datosUsuarios[i][0])] = datosUsuarios[i][1];
      }

      // Insertar nuevas restricciones
      for (let i = 0; i < usuariosRestringidos.length; i++) {
        const idUsuario = String(usuariosRestringidos[i]);
        const nuevoId = hojaPermisos.getLastRow();
        const nombreUsuario = usuariosMap[idUsuario] || 'Usuario desconocido';

        hojaPermisos.appendRow([
          nuevoId,
          idArchivo,
          idUsuario,
          nombreUsuario,
          fechaFormato,
          'Restricción manual'
        ]);
      }
    }

    Logger.log('✅ Permisos guardados para archivo: ' + idArchivo);
    return { success: true, message: 'Permisos actualizados correctamente' };
  } catch (error) {
    Logger.log('Error en guardarPermisosArchivo: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Verifica si un usuario puede acceder a un archivo
 * @param {string} idArchivo - ID del archivo
 * @param {string} idUsuario - ID del usuario
 * @returns {object} { puedeAcceder: boolean, razon: string }
 */
function verificarAccesoArchivo(idArchivo, idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return { puedeAcceder: true, razon: '' };
    }

    const datos = hojaPermisos.getDataRange().getValues();
    const idUsuarioStr = String(idUsuario);
    const idArchivoStr = String(idArchivo);

    for (let i = 1; i < datos.length; i++) {
      if (
        String(datos[i][1]) === idArchivoStr &&
        String(datos[i][2]) === idUsuarioStr
      ) {
        return {
          puedeAcceder: false,
          razon: 'No tienes permiso para acceder a este documento. Contacta al administrador.'
        };
      }
    }

    return { puedeAcceder: true, razon: '' };
  } catch (error) {
    Logger.log('Error en verificarAccesoArchivo: ' + error);
    return { puedeAcceder: true, razon: '' };
  }
}

/**
 * Elimina restricción de un usuario para un archivo
 */
function removerRestriccionArchivo(idArchivo, idUsuario) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return { success: false, message: 'Hoja de permisos no encontrada' };
    }

    const datos = hojaPermisos.getDataRange().getValues();
    const idUsuarioStr = String(idUsuario);
    const idArchivoStr = String(idArchivo);

    for (let i = datos.length - 1; i >= 1; i--) {
      if (
        String(datos[i][1]) === idArchivoStr &&
        String(datos[i][2]) === idUsuarioStr
      ) {
        hojaPermisos.deleteRow(i + 1);
        Logger.log('✅ Restricción removida: archivo ' + idArchivo + ', usuario ' + idUsuario);
        return { success: true, message: 'Permiso restaurado' };
      }
    }

    return { success: false, message: 'Restricción no encontrada' };
  } catch (error) {
    Logger.log('Error en removerRestriccionArchivo: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene todas las restricciones de un archivo (para gestión)
 */
function obtenerPermisosCompletos(idArchivo) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaPermisos = ss.getSheetByName('Permisos_Archivos');
    if (!hojaPermisos) {
      return { success: true, permisos: [] };
    }

    const datos = hojaPermisos.getDataRange().getValues();
    const permisos = [];

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][1]) === String(idArchivo)) {
        permisos.push({
          id: String(datos[i][0]),
          idUsuario: String(datos[i][2]),
          nombreUsuario: datos[i][3],
          fechaRestriccion: datos[i][4],
          razon: datos[i][5]
        });
      }
    }

    return {
      success: true,
      permisos: permisos
    };
  } catch (error) {
    Logger.log('Error en obtenerPermisosCompletos: ' + error);
    return { success: true, permisos: [] };
  }
}
