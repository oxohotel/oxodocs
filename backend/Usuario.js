/**
 * Funciones para gestionar el perfil y preferencias del usuario.
 *
 * Importante: esta app tiene su propio login (email+contraseña contra la hoja "Usuarios"),
 * INDEPENDIENTE de qué cuenta de Google esté abierta en el navegador. Por eso estas funciones
 * reciben "idUsuario" explícito desde el cliente (getCurrentUserSession().ID_Usuario) en vez de
 * usar Session.getActiveUser() — esa API identifica la cuenta de Google, no al usuario real
 * logueado en la app, y llevaría a leer/editar la fila equivocada (o ninguna).
 */

function obtenerDatosUsuarioActual(idUsuario) {
  // Delega en obtenerPerfilUsuario (backend/Auth.js) para no duplicar la búsqueda en "Usuarios".
  Logger.log('obtenerDatosUsuarioActual llamada con ID: ' + idUsuario);
  const resultado = obtenerPerfilUsuario(idUsuario);
  Logger.log('obtenerPerfilUsuario resultado: ' + JSON.stringify(resultado));

  if (!resultado.success) {
    Logger.log('❌ Error en obtenerPerfilUsuario: ' + resultado.message);
    return null;
  }

  // Convertir la fecha de Google Sheets a string ISO para evitar problemas de serialización
  let fechaStr = '—';
  if (resultado.usuario.Fecha_Registro) {
    const fecha = resultado.usuario.Fecha_Registro;
    if (typeof fecha === 'object' && fecha.toString) {
      fechaStr = fecha.toString();
    } else if (typeof fecha === 'string') {
      fechaStr = fecha;
    } else {
      fechaStr = String(fecha);
    }
  }

  const datos = {
    nombre: String(resultado.usuario.Nombre_Completo || ''),
    email: String(resultado.usuario.Email || ''),
    rol: String(resultado.usuario.Rol || ''),
    estado: String(resultado.usuario.Estado || ''),
    fechaRegistro: fechaStr
  };

  Logger.log('✅ Datos devueltos: ' + JSON.stringify(datos));
  return datos;
}

function actualizarNombreUsuario(idOUsuarioOToken, nuevoNombre) {
  try {
    let idUsuario = idOUsuarioOToken;
    if (typeof obtenerUsuarioPorToken === 'function') {
      const userSesion = obtenerUsuarioPorToken(idOUsuarioOToken);
      if (userSesion) idUsuario = userSesion.idUsuario;
    }

    const nombreLimpio = String(nuevoNombre || '').trim();
    if (!nombreLimpio) return { success: false, message: 'El nombre no puede estar vacío' };

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');

    if (!hoja) {
      return { success: false, message: 'Hoja de Usuarios no encontrada' };
    }

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.indexOf('ID_Usuario');
    const indexNombre = encabezados.indexOf('Nombre_Completo');

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][indexId]) === String(idUsuario)) {
        hoja.getRange(i + 1, indexNombre + 1).setValue(nombreLimpio);
        registrarAuditoriaSimple_(idUsuario, 'ACTUALIZAR_PERFIL', 'Usuario actualizó su nombre a "' + nombreLimpio + '"', 'Usuario');
        Logger.log('✅ Nombre actualizado para usuario ' + idUsuario);
        return { success: true, message: 'Nombre actualizado correctamente' };
      }
    }

    return { success: false, message: 'Usuario no encontrado' };
  } catch (error) {
    Logger.log('Error actualizarNombreUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

function cambiarContrasenaUsuario(idOUsuarioOToken, contrasenaActual, contrasenaNueva) {
  try {
    let idUsuario = idOUsuarioOToken;
    if (typeof obtenerUsuarioPorToken === 'function') {
      const userSesion = obtenerUsuarioPorToken(idOUsuarioOToken);
      if (userSesion) idUsuario = userSesion.idUsuario;
    }

    if (!contrasenaNueva || String(contrasenaNueva).length < 8) {
      return { success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres' };
    }

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');

    if (!hoja) {
      return { success: false, message: 'Hoja de Usuarios no encontrada' };
    }

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.indexOf('ID_Usuario');
    const indexContrasena = encabezados.indexOf('Contraseña_Hash');

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][indexId]) === String(idUsuario)) {
        const hashActual = datos[i][indexContrasena];
        const verificacion = typeof verificarPassword_ === 'function'
          ? verificarPassword_(contrasenaActual, hashActual)
          : { valido: (calcularHashContrasena_(contrasenaActual) === hashActual) };

        if (!verificacion.valido) {
          Logger.log('❌ Contraseña actual incorrecta para usuario ' + idUsuario);
          return { success: false, message: 'Contraseña actual incorrecta' };
        }

        const hashNuevo = typeof calcularHashContrasenaConSalt_ === 'function'
          ? calcularHashContrasenaConSalt_(contrasenaNueva)
          : calcularHashContrasena_(contrasenaNueva);

        hoja.getRange(i + 1, indexContrasena + 1).setValue(hashNuevo);

        registrarAuditoriaSimple_(idUsuario, 'CAMBIO_CONTRASEÑA', 'Usuario cambió su contraseña', 'Usuario');

        Logger.log('✅ Contraseña actualizada para usuario ' + idUsuario);
        return { success: true, message: 'Contraseña cambiada correctamente' };
      }
    }

    return { success: false, message: 'Usuario no encontrado' };
  } catch (error) {
    Logger.log('Error cambiarContrasenaUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

function calcularHashContrasena_(password) {
  if (typeof calcularHashContrasenaConSalt_ === 'function') {
    return calcularHashContrasenaConSalt_(password);
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return Utilities.base64Encode(digest);
}

function obtenerPreferenciasNotificaciones(idUsuario) {
  try {
    const propiedades = PropertiesService.getUserProperties();
    const prefsJson = propiedades.getProperty('notificaciones_' + idUsuario);

    if (!prefsJson) {
      return { actividad: false, recordatorios: false, seguridad: true };
    }

    return JSON.parse(prefsJson);
  } catch (error) {
    Logger.log('Error obtenerPreferenciasNotificaciones: ' + error);
    return { actividad: false, recordatorios: false, seguridad: true };
  }
}

function guardarPreferenciasNotificaciones(idUsuario, prefs) {
  try {
    const propiedades = PropertiesService.getUserProperties();
    propiedades.setProperty('notificaciones_' + idUsuario, JSON.stringify(prefs));

    Logger.log('✅ Preferencias de notificaciones guardadas para usuario ' + idUsuario);
    return { success: true, message: 'Preferencias guardadas correctamente' };
  } catch (error) {
    Logger.log('Error guardarPreferenciasNotificaciones: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Registro de auditoría simple con firma propia (idUsuario, tipo, descripcion, entidad).
 * Renombrada para no chocar con registrarAuditoria(actionData) de backend/Auth.js — Apps Script
 * junta todos los .js en un solo scope global, así que dos funciones con el mismo nombre pero
 * distinta firma se pisan entre sí y la que sobrevive rompe silenciosamente a la otra.
 */
function registrarAuditoriaSimple_(idUsuario, tipoAccion, descripcion, entidadAfectada) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaAuditoria = ss.getSheetByName('Auditoria');
    if (!hojaAuditoria) return;

    const datos = hojaAuditoria.getDataRange().getValues();
    let nuevoId = 1;
    for (let i = 1; i < datos.length; i++) {
      const idActual = parseInt(datos[i][0]);
      if (idActual >= nuevoId) nuevoId = idActual + 1;
    }

    hojaAuditoria.appendRow([
      nuevoId,
      idUsuario,
      '',
      tipoAccion,
      descripcion,
      entidadAfectada,
      new Date(),
      'Exitosa'
    ]);
  } catch (error) {
    Logger.log('Error registrarAuditoriaSimple_: ' + error);
  }
}
