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
        invalidarCacheUsuarios_();
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
/**
 * Toma el candado y refresca. Sin el flush posterior, una hoja leída ANTES de tomarlo sigue mostrando los datos de ese momento y se
 * pisa lo que otra ejecución escribió mientras esperábamos (comprobado en Apps Script real: 8 ejecuciones simultáneas dejaron el
 * contador en 2; con el flush, en 8). Lanza error si no lo obtiene a tiempo, como waitLock.
 */
function tomarCandado_(lock, ms) {
  lock.waitLock(ms);
  try { SpreadsheetApp.flush(); } catch (e) {}
}

/**
 * Suelta el candado DESPUÉS de forzar la escritura pendiente. Sin el flush, Sheets guarda en lote y otra ejecución que estaba esperando el
 * candado lo toma y lee datos viejos (la prueba real lo mostró: dos administradores resolviendo la misma cuenta se pisaban).
 */
function liberarCandado_(lock) {
  try { SpreadsheetApp.flush(); } catch (e) {}
  try { lock.releaseLock(); } catch (e) {}
}

/**
 * Agrega una fila sin que dos ejecuciones simultáneas se pisen. appendRow NO es seguro entre ejecuciones concurrentes: en la prueba
 * real, 30 llamadas simultáneas dejaron solo 9 filas (todas respondieron éxito). Por eso se serializa con el candado del script.
 *  - "construirFila" se evalúa ya dentro del candado (para IDs consecutivos).
 *  - Con { soloEscribir: true } (la fila no depende de leer la hoja) no se refresca al tomar el candado: se retiene menos tiempo y
 *    caben más escrituras por segundo.
 *  - Si ya se tiene el candado (llamada anidada) se reutiliza sin soltarlo.
 *  - Si no se consigue tras dos esperas de 30 s se lanza un error: antes se agregaba igualmente sin candado y, con muchas
 *    escrituras a la vez, esa fila podía perderse sin avisar. Los llamadores ya tratan el error (el registro es de mejor esfuerzo).
 */
function agregarFilaSegura_(hoja, construirFila, opciones) {
  const lock = LockService.getScriptLock();
  const yaLoTenia = lock.hasLock();
  const soloEscribir = !!(opciones && opciones.soloEscribir);
  let lopropio = false;
  if (!yaLoTenia) {
    for (let intento = 1; intento <= 2 && !lopropio; intento++) {
      try {
        if (soloEscribir) lock.waitLock(30000); else tomarCandado_(lock, 30000);
        lopropio = true;
      } catch (e) {
        if (intento === 2) throw new Error('No se pudo obtener el candado para escribir en ' + hoja.getName() + ' (demasiadas escrituras a la vez)');
      }
    }
  }
  try {
    hoja.appendRow(construirFila());
  } finally {
    if (lopropio) liberarCandado_(lock);
  }
}

/**
 * Las listas de propiedades ("26,24") deben guardarse como TEXTO. Con la configuración regional de Colombia (coma decimal) Sheets convierte
 * "26,24" en el NÚMERO 26,24: al leerla llega 26.24 y el sistema ve UNA propiedad llamada «Hotel 26.24» (y al dar dos permisos solo queda uno).
 * Se formatea la columna como texto (una vez por hora por ejecución de caché; es barato). No corrige celdas ya convertidas: ver repararListasDeHoteles.
 */
function asegurarListasDeHotelesComoTexto_(hoja) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('oxo:fmtListasHoteles')) return;
    ['Hoteles_Permitidos', 'Hoteles_Solicitados'].forEach(function (nombre) {
      const col = obtenerOAgregarColumna_(hoja, nombre);
      hoja.getRange(1, col + 1, hoja.getMaxRows(), 1).setNumberFormat('@');
    });
    cache.put('oxo:fmtListasHoteles', '1', 3600);
  } catch (error) {
    Logger.log('asegurarListasDeHotelesComoTexto_: ' + error);
  }
}

/**
 * Función del EDITOR (una sola vez): devuelve a texto las listas que Sheets ya convirtió en número ("26,24" → 26.24) y deja las dos columnas
 * como texto. Usa lo que SE VE en la celda. Ojo: una lista que acababa en 0 (p. ej. "7,10") perdió ese cero al convertirse ("7,1"); el
 * registro lista cada celda corregida con el correo de la persona para que las revises.
 */
function repararListasDeHoteles() {
  const hoja = obtenerSpreadsheet_().getSheetByName('Usuarios');
  const filas = hoja.getLastRow();
  const idxEmail = 2; // la tercera columna de Usuarios es el correo
  const revisar = [];
  ['Hoteles_Permitidos', 'Hoteles_Solicitados'].forEach(function (nombre) {
    const col = obtenerOAgregarColumna_(hoja, nombre) + 1;
    if (filas < 2) return;
    const rango = hoja.getRange(2, col, filas - 1, 1);
    const crudos = rango.getValues(), vistos = rango.getDisplayValues(), correos = hoja.getRange(2, idxEmail + 1, filas - 1, 1).getValues();
    hoja.getRange(1, col, hoja.getMaxRows(), 1).setNumberFormat('@');
    const nuevos = crudos.map(function (f, i) {
      if (typeof f[0] !== 'number') return [f[0]];
      revisar.push(nombre + ' · ' + correos[i][0] + ': ' + f[0] + ' → "' + vistos[i][0] + '"');
      return [String(vistos[i][0])];
    });
    rango.setValues(nuevos);
  });
  SpreadsheetApp.flush();
  try { CacheService.getScriptCache().put('oxo:fmtListasHoteles', '1', 3600); } catch (e) { /* sin caché */ }
  try { if (typeof invalidarCacheUsuarios_ === 'function') invalidarCacheUsuarios_(); } catch (e) { /* ya se renovará */ }
  Logger.log(revisar.length ? 'Celdas corregidas (revisa que cada lista sea la correcta):\n' + revisar.join('\n') : 'No había listas convertidas en número.');
}

/**
 * Número de fila (1-indexado) de la primera celda de la columna "columna" (1-indexada) que sea igual a "valor" (sin distinguir mayúsculas,
 * celda completa), o -1. Usa la búsqueda de Sheets (TextFinder), que no descarga la hoja entera: con miles de filas es mucho más rápido
 * que leerla completa y recorrerla. Si TextFinder no está disponible o falla, recorre la columna.
 */
function buscarFilaEnColumna_(hoja, columna, valor) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return -1;
  const buscado = String(valor).trim();
  if (!buscado) return -1;
  try {
    const rango = hoja.getRange(2, columna, ultima - 1, 1);
    if (typeof rango.createTextFinder === 'function') {
      const celda = rango.createTextFinder(buscado).matchEntireCell(true).matchCase(false).findNext();
      if (celda) return celda.getRow();
      // La búsqueda de Sheets puede tardar unos segundos en ver una fila recién escrita (se vio una vez en las pruebas reales: un alta
      // aprobada y de inmediato 'Email o contraseña incorrectos'). Antes de dar algo por inexistente se revisa la columna directamente;
      // solo cuesta en las búsquedas que no encuentran nada (credenciales o tokens inválidos).
    }
  } catch (e) {
    Logger.log('Aviso buscarFilaEnColumna_ (se recorre la columna): ' + e);
  }
  const col = hoja.getRange(2, columna, ultima - 1, 1).getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toLowerCase() === buscado.toLowerCase()) return i + 2;
  }
  return -1;
}

function siguienteIdAuditoria_(hoja) {
  const ultima = hoja.getLastRow();
  if (ultima <= 1) return 1;
  const n = parseInt(hoja.getRange(ultima, 1).getValue(), 10);
  return isNaN(n) ? ultima : n + 1;
}

function registrarAuditoriaSimple_(idUsuario, tipoAccion, descripcion, entidadAfectada) {
  try {
    const ss = obtenerSpreadsheet_();
    const hojaAuditoria = ss.getSheetByName('Auditoria');
    if (!hojaAuditoria) return;

    agregarFilaSegura_(hojaAuditoria, function () {
      return [
        siguienteIdAuditoria_(hojaAuditoria), // el ID se calcula DENTRO del candado, si no dos ejecuciones simultáneas obtienen el mismo
        idUsuario,
        '',
        tipoAccion,
        descripcion,
        entidadAfectada,
        new Date(),
        'Exitosa'
      ];
    });
  } catch (error) {
    Logger.log('Error registrarAuditoriaSimple_: ' + error);
  }
}
