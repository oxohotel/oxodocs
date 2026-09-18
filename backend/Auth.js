/**
 * Autenticación: registro, login, verificación de email y tokens de recuperación de contraseña.
 * Usa DRIVE_CONFIG.SPREADSHEET_ID (definido en backend/Drive.js) como fuente única del ID del Sheet.
 */

// Dominio corporativo obligatorio para poder registrarse — cualquier otro correo se rechaza
// antes de tocar la hoja "Usuarios".
const DOMINIO_CORREO_PERMITIDO = '@oxohotel.com';

// ==================== Funciones Criptográficas y de Salting ====================

function generarSalt_() {
  const bytes = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  return Utilities.base64Encode(bytes);
}

function calcularHashContrasenaConSalt_(password, salt) {
  const saltUtilizado = salt || generarSalt_();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + saltUtilizado);
  const hashHex = Utilities.base64Encode(digest);
  return saltUtilizado + '$' + hashHex;
}

function verificarPassword_(passwordIngresado, passwordEnBD) {
  if (!passwordIngresado || !passwordEnBD) {
    return { valido: false, requiereMigracion: false };
  }

  const strBD = String(passwordEnBD).trim();
  const partes = strBD.split('$');

  if (partes.length === 2) {
    const salt = partes[0];
    const hashEsperado = partes[1];
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(passwordIngresado) + salt);
    const hashCalculado = Utilities.base64Encode(digest);
    return { valido: (hashCalculado === hashEsperado), requiereMigracion: false };
  }

  // Soporte retrocompatible para contraseñas legadas (SHA-256 plano sin salt)
  const digestLegado = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(passwordIngresado));
  const hashLegado = Utilities.base64Encode(digestLegado);
  const esValido = (hashLegado === strBD);

  return { valido: esValido, requiereMigracion: esValido };
}

// ==================== Gestión de Tokens de Sesión ====================

function crearSesionUsuario_(usuario) {
  const token = Utilities.getUuid() + '-' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(Math.random()) + Date.now())).substring(0, 16).replace(/[+/=]/g, 'x');
  const ahora = new Date();
  const expiracion = new Date(ahora.getTime() + 24 * 60 * 60 * 1000); // 24 horas

  const infoSesion = {
    idUsuario: String(usuario.ID_Usuario),
    nombre: usuario.Nombre_Completo,
    email: usuario.Email,
    idRol: usuario.ID_Rol,
    rol: usuario.Rol,
    exp: expiracion.getTime()
  };

  // Guardar en Script Cache (rápido para validaciones consecutivas, TTL 6 horas máx de Apps Script)
  try {
    const cache = CacheService.getScriptCache();
    cache.put('session_' + token, JSON.stringify(infoSesion), 21600);
  } catch (e) {
    Logger.log('Aviso CacheService en crearSesion: ' + e);
  }

  // Persistir en la hoja Sesiones para durabilidad
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    let hojaSesiones = ss.getSheetByName('Sesiones');
    if (!hojaSesiones) {
      hojaSesiones = ss.insertSheet('Sesiones');
      hojaSesiones.appendRow(['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado']);
    }
    const nuevoId = 'SES-' + Date.now();
    hojaSesiones.appendRow([nuevoId, usuario.ID_Usuario, token, ahora, expiracion, 'Activa']);
  } catch (e) {
    Logger.log('Aviso persistir Sesiones en Sheet: ' + e);
  }

  return token;
}

/**
 * Valida un token de sesión y devuelve los datos del usuario autenticado o null si es inválido/expirado.
 */
function obtenerUsuarioPorToken(token) {
  if (!token) return null;
  const tokenStr = String(token).trim();
  if (!tokenStr) return null;

  // 1. Verificar Cache
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get('session_' + tokenStr);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.exp && Date.now() < data.exp) {
        data.cacheVersion = PropertiesService.getScriptProperties().getProperty('APP_CACHE_VERSION') || '1';
        return data;
      }
    }
  } catch (e) {
    Logger.log('Aviso CacheService en obtenerUsuarioPorToken: ' + e);
  }

  // 2. Si expiró de la caché o no está, consultar la hoja Sesiones
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaSesiones = ss.getSheetByName('Sesiones');
    if (!hojaSesiones) return null;

    const datos = hojaSesiones.getDataRange().getValues();
    for (let i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][2]) === tokenStr && datos[i][5] === 'Activa') {
        const fechaExp = datos[i][4];
        if (fechaExp && new Date() > new Date(fechaExp)) {
          hojaSesiones.getRange(i + 1, 6).setValue('Expirada');
          return null;
        }

        const idUsuario = String(datos[i][1]);
        const perfil = obtenerPerfilUsuario(idUsuario);
        if (perfil && perfil.success && perfil.usuario) {
          const info = {
            idUsuario: idUsuario,
            nombre: perfil.usuario.Nombre_Completo,
            email: perfil.usuario.Email,
            idRol: perfil.usuario.ID_Rol,
            rol: perfil.usuario.Rol,
            exp: new Date(fechaExp).getTime()
          };

          // Re-poblar caché
          try {
            CacheService.getScriptCache().put('session_' + tokenStr, JSON.stringify(info), 21600);
          } catch (err) {}

          const cacheVersion = PropertiesService.getScriptProperties().getProperty('APP_CACHE_VERSION') || '1';
          info.cacheVersion = cacheVersion;

          return info;
        }
      }
    }
  } catch (e) {
    Logger.log('Error en obtenerUsuarioPorToken: ' + e);
  }

  return null;
}

function cerrarSesionUsuario(token) {
  if (!token) return { success: true };
  const tokenStr = String(token).trim();

  try {
    CacheService.getScriptCache().remove('session_' + tokenStr);
  } catch (e) {}

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaSesiones = ss.getSheetByName('Sesiones');
    if (hojaSesiones) {
      const datos = hojaSesiones.getDataRange().getValues();
      for (let i = datos.length - 1; i >= 1; i--) {
        if (String(datos[i][2]) === tokenStr) {
          hojaSesiones.getRange(i + 1, 6).setValue('Cerrada');
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('Aviso cerrarSesionUsuario: ' + e);
  }

  return { success: true };
}

function registrarUsuario(nombre, email, password) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const emailNormalizado = String(email || '').trim().toLowerCase();
    if (!emailNormalizado.endsWith(DOMINIO_CORREO_PERMITIDO)) {
      return { success: false, message: 'Solo se permiten correos ' + DOMINIO_CORREO_PERMITIDO, userId: null };
    }

    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");

    if (!hojaUsuarios) {
      return { success: false, message: "Error en la base de datos", userId: null };
    }

    const datos = hojaUsuarios.getDataRange().getValues();

    // Verificar email duplicado
    for (let i = 1; i < datos.length; i++) {
      if (datos[i][2] && datos[i][2].toLowerCase() === emailNormalizado) {
        return { success: false, message: "Este email ya está registrado", userId: null };
      }
    }

    // Calcular siguiente ID basado en IDs existentes
    let nuevoId = 1;
    if (datos.length > 1) {
      for (let i = 1; i < datos.length; i++) {
        const idActual = parseInt(datos[i][0]);
        if (idActual >= nuevoId) {
          nuevoId = idActual + 1;
        }
      }
    }

    const passwordHashConSalt = calcularHashContrasenaConSalt_(password);

    const hoy = new Date();
    const fechaRegistro = Utilities.formatDate(hoy, "GMT-5", "yyyy-MM-dd");

    hojaUsuarios.appendRow([nuevoId, nombre, emailNormalizado, passwordHashConSalt, "Usuario", "Pendiente_Verificacion", fechaRegistro]);

    const envio = enviarCodigoVerificacion(emailNormalizado, nuevoId);
    if (!envio.success) {
      Logger.log('⚠️ Usuario ' + nuevoId + ' creado pero falló el envío del código: ' + envio.message);
    }

    return {
      success: true,
      message: "Te enviamos un código de verificación a tu correo. Ingrésalo para confirmar tu cuenta.",
      userId: nuevoId,
      requiereVerificacion: true
    };
  } catch (error) {
    Logger.log("Error en registrarUsuario: " + error.toString());
    return { success: false, message: "Error al registrar el usuario: " + error.toString(), userId: null };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Genera un código de 6 dígitos, lo guarda en "Verificacion_Email" (vence en 15 minutos) y lo
 * envía por correo. Se usa tanto al registrarse como para "reenviar código" desde el panel de
 * verificación (ver scripts/AuthVerificacion.html).
 */
function enviarCodigoVerificacion(email, idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Verificacion_Email');
    if (!hoja) return { success: false, message: 'Hoja Verificacion_Email no encontrada' };

    let idUsuarioResuelto = idUsuario;
    if (!idUsuarioResuelto) {
      const hojaUsuarios = ss.getSheetByName('Usuarios');
      const datosUsuarios = hojaUsuarios ? hojaUsuarios.getDataRange().getValues() : [];
      for (let i = 1; i < datosUsuarios.length; i++) {
        if (String(datosUsuarios[i][2]).toLowerCase() === String(email).toLowerCase()) {
          idUsuarioResuelto = datosUsuarios[i][0];
          break;
        }
      }
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const ahora = new Date();
    const expiracion = new Date(ahora.getTime() + 15 * 60 * 1000);

    const datos = hoja.getDataRange().getValues();
    let nuevoId = 1;
    for (let i = 1; i < datos.length; i++) {
      const idActual = parseInt(datos[i][0]);
      if (idActual >= nuevoId) nuevoId = idActual + 1;
    }

    hoja.appendRow([nuevoId, idUsuarioResuelto || '', email, codigo, ahora, expiracion, 'Activo']);

    MailApp.sendEmail({
      to: email,
      subject: 'Tu código de verificación - Repositorio de Proyectos',
      htmlBody:
        '<p>Hola,</p>' +
        '<p>Este es tu código para confirmar tu cuenta en el Repositorio de Proyectos de OxoHotel:</p>' +
        '<p style="font-size:28px;font-weight:bold;letter-spacing:6px;">' + codigo + '</p>' +
        '<p>Vence en 15 minutos. Si tú no solicitaste esto, puedes ignorar este correo.</p>'
    });

    return { success: true, message: 'Código enviado' };
  } catch (error) {
    Logger.log('Error enviarCodigoVerificacion: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Confirma el código enviado a "email". Si es válido y no venció, marca la cuenta como
 * "Pendiente_Aprobacion" — el correo ya quedó confirmado, pero aún falta que un administrador
 * le dé acceso (ver backend/Roles.js: aprobarUsuario) antes de poder iniciar sesión.
 */
function verificarCodigoRegistro(email, codigo) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Verificacion_Email');
    if (!hoja) return { success: false, message: 'Hoja Verificacion_Email no encontrada' };

    const datos = hoja.getDataRange().getValues();
    let filaValida = -1;
    for (let i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][2]).toLowerCase() === String(email).toLowerCase() &&
          String(datos[i][3]) === String(codigo) &&
          datos[i][6] === 'Activo') {
        filaValida = i;
        break;
      }
    }
    if (filaValida === -1) return { success: false, message: 'Código incorrecto' };

    const fechaExpiracion = datos[filaValida][5];
    if (fechaExpiracion && new Date() > new Date(fechaExpiracion)) {
      return { success: false, message: 'El código venció. Solicita uno nuevo.' };
    }

    hoja.getRange(filaValida + 1, 7).setValue('Usado');

    const hojaUsuarios = ss.getSheetByName('Usuarios');
    if (!hojaUsuarios) return { success: false, message: 'Hoja Usuarios no encontrada' };

    const datosUsuarios = hojaUsuarios.getDataRange().getValues();
    let filaUsuario = -1;
    for (let i = 1; i < datosUsuarios.length; i++) {
      if (String(datosUsuarios[i][2]).toLowerCase() === String(email).toLowerCase()) {
        filaUsuario = i + 1;
        break;
      }
    }
    if (filaUsuario === -1) return { success: false, message: 'Usuario no encontrado' };

    hojaUsuarios.getRange(filaUsuario, 6).setValue('Pendiente_Aprobacion'); // columna F = Estado

    return {
      success: true,
      message: 'Correo verificado. Un administrador debe darte acceso antes de que puedas iniciar sesión.'
    };
  } catch (error) {
    Logger.log('Error verificarCodigoRegistro: ' + error);
    return { success: false, message: error.toString() };
  }
}

function validarCredenciales(email, password) {
  try {
    const emailBuscado = String(email || '').trim().toLowerCase();
    const passwordStr = String(password || '');

    if (!emailBuscado || !passwordStr) {
      return { success: false, message: "Por favor ingresa tu correo y contraseña", user: null };
    }

    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");

    if (!hojaUsuarios) {
      return { success: false, message: "Error: No se encontró la tabla de Usuarios", user: null };
    }

    const datos = hojaUsuarios.getDataRange().getValues();
    if (!datos || datos.length <= 1) {
      return { success: false, message: "No hay usuarios registrados en el sistema", user: null };
    }

    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      const emailEnBD = String(row[2] || '').trim().toLowerCase();
      const passwordHashEnBD = String(row[3] || '').trim();
      const rol = row[4] || 'Usuario';
      const estado = String(row[5] || '').trim();

      if (emailEnBD && emailEnBD === emailBuscado) {
        if (estado === "Pendiente_Verificacion") {
          return {
            success: false,
            message: "Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.",
            user: null,
            requiereVerificacion: true
          };
        }
        if (estado === "Pendiente_Aprobacion") {
          return {
            success: false,
            message: "Tu cuenta está pendiente de aprobación por un administrador.",
            user: null
          };
        }
        if (estado && estado !== "Activo") {
          return { success: false, message: "Esta cuenta ha sido desactivada", user: null };
        }

        const verificacion = verificarPassword_(passwordStr, passwordHashEnBD);

        if (verificacion.valido) {
          // Si el usuario tenía hash plano legado, auto-migrar al nuevo esquema con salt
          if (verificacion.requiereMigracion) {
            try {
              const nuevoHashConSalt = calcularHashContrasenaConSalt_(passwordStr);
              hojaUsuarios.getRange(i + 1, 4).setValue(nuevoHashConSalt);
              Logger.log('🔒 Contraseña de usuario ' + row[0] + ' migrada transparentemente a hash con salt');
            } catch (errMigracion) {
              Logger.log('Aviso al migrar hash de usuario: ' + errMigracion);
            }
          }

          const infoRol = typeof obtenerInfoRol_ === 'function' ? obtenerInfoRol_(rol) : { id: (parseInt(rol, 10) || 1), nombre: (rol === 3 || rol === '3' ? 'Superadministrador' : (rol === 2 || rol === '2' ? 'Administrador' : 'Usuario')) };
          const usuarioData = {
            ID_Usuario: row[0],
            Nombre_Completo: row[1],
            Email: row[2],
            ID_Rol: infoRol.id,
            Rol_ID: infoRol.id,
            Rol: infoRol.nombre,
            Estado: estado || 'Activo'
          };

          // Generar token criptográfico firmado en el servidor
          const sessionToken = crearSesionUsuario_(usuarioData);
          usuarioData.token = sessionToken;

          return {
            success: true,
            message: "Credenciales válidas",
            user: usuarioData,
            token: sessionToken
          };
        }
        return { success: false, message: "Email o contraseña incorrectos", user: null };
      }
    }

    return { success: false, message: "Email o contraseña incorrectos", user: null };
  } catch (error) {
    Logger.log("Error en validarCredenciales: " + error.toString());
    return { success: false, message: "Error del servidor: " + error.toString(), user: null };
  }
}

function verificarEmailExistente(email) {
  try {
    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");

    if (!hojaUsuarios) {
      return { exists: false };
    }

    const datos = hojaUsuarios.getDataRange().getValues();

    for (let i = 1; i < datos.length; i++) {
      if (datos[i][2].toLowerCase() === email.toLowerCase()) {
        return { exists: true };
      }
    }

    return { exists: false };
  } catch (error) {
    Logger.log("Error en verificarEmailExistente: " + error.toString());
    return { exists: false };
  }
}

function registrarAuditoria(actionData) {
  try {
    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaAuditoria = spreadsheet.getSheetByName("Auditoria");

    if (!hojaAuditoria) {
      Logger.log("Hoja Auditoria no encontrada");
      return { success: false };
    }

    const datos = hojaAuditoria.getDataRange().getValues();
    let nuevoId = 1;

    if (datos.length > 1) {
      for (let i = 1; i < datos.length; i++) {
        const idActual = parseInt(datos[i][0]);
        if (idActual >= nuevoId) {
          nuevoId = idActual + 1;
        }
      }
    }

    const ahora = new Date();
    const fechaHora = Utilities.formatDate(ahora, "GMT-5", "yyyy-MM-dd HH:mm:ss");

    hojaAuditoria.appendRow([
      nuevoId,
      actionData.usuarioId || "",
      actionData.emailUsuario || "",
      actionData.tipo || "Sin especificar",
      actionData.descripcion || "",
      actionData.entidadAfectada || "General",
      fechaHora,
      actionData.estado || "Exitosa"
    ]);

    Logger.log("Auditoría registrada: " + nuevoId);
    return { success: true };
  } catch (error) {
    Logger.log("Error en registrarAuditoria: " + error.toString());
    return { success: false };
  }
}

/**
 * Genera un código de seguridad de 6 dígitos para recuperación de contraseña,
 * lo registra en la hoja "Recuperacion_Contraseña" (válido por 15 minutos)
 * y lo envía por correo electrónico con MailApp.
 */
function solicitarCodigoRecuperacion(email) {
  try {
    const emailNormalizado = String(email || '').trim().toLowerCase();
    if (!emailNormalizado) {
      return { success: false, message: 'Por favor ingresa tu correo electrónico' };
    }

    if (!emailNormalizado.endsWith(DOMINIO_CORREO_PERMITIDO)) {
      return { success: false, message: 'El correo debe ser corporativo (' + DOMINIO_CORREO_PERMITIDO + ')' };
    }

    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");
    if (!hojaUsuarios) {
      return { success: false, message: "Error en la base de datos de usuarios" };
    }

    const datosUsuarios = hojaUsuarios.getDataRange().getValues();
    let usuarioEncontrado = null;
    for (let i = 1; i < datosUsuarios.length; i++) {
      if (datosUsuarios[i][2] && String(datosUsuarios[i][2]).trim().toLowerCase() === emailNormalizado) {
        usuarioEncontrado = {
          id: datosUsuarios[i][0],
          nombre: datosUsuarios[i][1],
          email: datosUsuarios[i][2],
          estado: datosUsuarios[i][5]
        };
        break;
      }
    }

    if (!usuarioEncontrado) {
      return { success: false, message: 'No hay ninguna cuenta registrada con el correo ' + emailNormalizado };
    }

    if (usuarioEncontrado.estado === 'Inactivo') {
      return { success: false, message: 'Esta cuenta ha sido desactivada. Contacta al administrador.' };
    }

    let hojaRecuperacion = spreadsheet.getSheetByName("Recuperacion_Contraseña");
    if (!hojaRecuperacion) {
      hojaRecuperacion = spreadsheet.insertSheet("Recuperacion_Contraseña");
      hojaRecuperacion.appendRow([
        'ID_Recuperacion', 'Email_Usuario', 'Token_Unico', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado', 'Nueva_Contraseña_Hash'
      ]);
    }

    const datosRecup = hojaRecuperacion.getDataRange().getValues();
    let nuevoId = 1;
    for (let i = 1; i < datosRecup.length; i++) {
      const idActual = parseInt(datosRecup[i][0]);
      if (idActual >= nuevoId) nuevoId = idActual + 1;
      // Inactivar códigos previos activos para este email
      if (String(datosRecup[i][1]).trim().toLowerCase() === emailNormalizado && datosRecup[i][5] === 'Activo') {
        hojaRecuperacion.getRange(i + 1, 6).setValue('Reemplazado');
      }
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const ahora = new Date();
    const expiracion = new Date(ahora.getTime() + 15 * 60 * 1000); // 15 minutos

    hojaRecuperacion.appendRow([
      nuevoId,
      emailNormalizado,
      codigo,
      Utilities.formatDate(ahora, "GMT-5", "yyyy-MM-dd HH:mm:ss"),
      Utilities.formatDate(expiracion, "GMT-5", "yyyy-MM-dd HH:mm:ss"),
      "Activo",
      ""
    ]);

    // Enviar correo con formato corporativo
    const nombreDestinatario = usuarioEncontrado.nombre ? usuarioEncontrado.nombre.split(' ')[0] : 'Usuario';
    MailApp.sendEmail({
      to: emailNormalizado,
      name: 'Repositorio OxoHotel',
      subject: 'Tu código de recuperación de contraseña - OxoHotel',
      htmlBody:
        '<div style="font-family: \'Segoe UI\', Roboto, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 28px; background-color: #FCFBF9; border: 1px solid #E8E3DA; border-radius: 16px; color: #19211E;">' +
          '<div style="text-align: center; margin-bottom: 24px;">' +
            '<h2 style="color: #3D5A4C; margin: 0 0 6px; font-size: 22px; font-weight: 800;">Restablecer Contraseña</h2>' +
            '<p style="color: #66706B; font-size: 13px; margin: 0;">Repositorio de Proyectos OxoHotel</p>' +
          '</div>' +
          '<p style="font-size: 14px; line-height: 1.6; color: #19211E; margin-bottom: 16px;">Hola <strong>' + nombreDestinatario + '</strong>,</p>' +
          '<p style="font-size: 14px; line-height: 1.6; color: #19211E; margin-bottom: 24px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta. Ingresa el siguiente código de seguridad en la plataforma:</p>' +
          '<div style="text-align: center; margin: 28px 0;">' +
            '<div style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #C4972B; background: #FFFFFF; padding: 14px 28px; border-radius: 12px; border: 2px dashed #C4972B; box-shadow: 0 4px 12px rgba(196,151,43,0.15);">' +
              codigo +
            '</div>' +
          '</div>' +
          '<p style="font-size: 13px; color: #66706B; line-height: 1.6; margin-bottom: 20px;">⏱️ Este código es válido por <strong>15 minutos</strong> y puede ser usado una sola vez.</p>' +
          '<p style="font-size: 12px; color: #9EA6A0; line-height: 1.5; margin: 0; border-top: 1px solid #E8E3DA; padding-top: 16px;">Si no solicitaste este cambio, puedes ignorar este correo sin problema. Tu contraseña actual no sufrirá ningún cambio.</p>' +
        '</div>'
    });

    return {
      success: true,
      message: 'Te enviamos un código de 6 dígitos a ' + emailNormalizado + '. Revisa tu bandeja de entrada.'
    };
  } catch (error) {
    Logger.log("Error en solicitarCodigoRecuperacion: " + error.toString());
    return { success: false, message: "Error al enviar el código de recuperación: " + error.toString() };
  }
}

function generarTokenRecuperacion(email) {
  return solicitarCodigoRecuperacion(email);
}

/**
 * Valida el código de 6 dígitos ingresado por el usuario sin alterar la contraseña todavía.
 * Permite al frontend avanzar a la fase de captura de nueva contraseña.
 */
function validarCodigoRecuperacion(email, codigo) {
  try {
    const emailNormalizado = String(email || '').trim().toLowerCase();
    const codigoStr = String(codigo || '').trim();

    if (!emailNormalizado || !codigoStr) {
      return { success: false, message: "El correo y el código son obligatorios" };
    }

    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaRecuperacion = spreadsheet.getSheetByName("Recuperacion_Contraseña");
    if (!hojaRecuperacion) {
      return { success: false, message: "No se encontró el registro de recuperación" };
    }

    const datosRecup = hojaRecuperacion.getDataRange().getValues();
    let filaValida = -1;

    for (let i = datosRecup.length - 1; i >= 1; i--) {
      const emailFila = String(datosRecup[i][1] || '').trim().toLowerCase();
      const codigoFila = String(datosRecup[i][2] || '').trim();
      const estadoFila = String(datosRecup[i][5] || '').trim();

      if (emailFila === emailNormalizado && codigoFila === codigoStr && estadoFila === 'Activo') {
        filaValida = i;
        break;
      }
    }

    if (filaValida === -1) {
      return { success: false, message: "El código ingresado es incorrecto o no existe." };
    }

    const fechaExp = datosRecup[filaValida][4];
    if (fechaExp) {
      const fechaExpDate = new Date(fechaExp);
      if (new Date() > fechaExpDate) {
        hojaRecuperacion.getRange(filaValida + 1, 6).setValue('Expirado');
        return { success: false, message: "El código ha vencido (validez 15 minutos). Solicita uno nuevo." };
      }
    }

    return { success: true, message: "Código verificado correctamente" };
  } catch (error) {
    Logger.log("Error en validarCodigoRecuperacion: " + error.toString());
    return { success: false, message: "Error al validar el código: " + error.toString() };
  }
}

/**
 * Valida el código de 6 dígitos ingresado por el usuario y actualiza su contraseña
 * en la hoja "Usuarios" directamente sin salir de la plataforma.
 */
function restablecerPasswordConCodigo(email, codigo, nuevaPassword) {
  try {
    const emailNormalizado = String(email || '').trim().toLowerCase();
    const codigoStr = String(codigo || '').trim();
    const passwordStr = String(nuevaPassword || '').trim();

    if (!emailNormalizado || !codigoStr || !passwordStr) {
      return { success: false, message: "Todos los campos son obligatorios" };
    }

    if (passwordStr.length < 8) {
      return { success: false, message: "La nueva contraseña debe tener al menos 8 caracteres" };
    }

    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaRecuperacion = spreadsheet.getSheetByName("Recuperacion_Contraseña");
    if (!hojaRecuperacion) {
      return { success: false, message: "No se encontró el registro de recuperación" };
    }

    const datosRecup = hojaRecuperacion.getDataRange().getValues();
    let filaValida = -1;

    for (let i = datosRecup.length - 1; i >= 1; i--) {
      const emailFila = String(datosRecup[i][1] || '').trim().toLowerCase();
      const codigoFila = String(datosRecup[i][2] || '').trim();
      const estadoFila = String(datosRecup[i][5] || '').trim();

      if (emailFila === emailNormalizado && codigoFila === codigoStr && estadoFila === 'Activo') {
        filaValida = i;
        break;
      }
    }

    if (filaValida === -1) {
      return { success: false, message: "Código incorrecto o no encontrado. Solicita uno nuevo." };
    }

    const fechaExp = datosRecup[filaValida][4];
    if (fechaExp) {
      const fechaExpDate = new Date(fechaExp);
      if (new Date() > fechaExpDate) {
        hojaRecuperacion.getRange(filaValida + 1, 6).setValue('Expirado');
        return { success: false, message: "El código ha vencido. Por favor solicita uno nuevo." };
      }
    }

    // Actualizar contraseña en Usuarios
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");
    if (!hojaUsuarios) {
      return { success: false, message: "Error en la base de datos de usuarios" };
    }

    const datosUsuarios = hojaUsuarios.getDataRange().getValues();
    let filaUsuario = -1;
    let idUsuario = null;

    for (let i = 1; i < datosUsuarios.length; i++) {
      if (String(datosUsuarios[i][2] || '').trim().toLowerCase() === emailNormalizado) {
        filaUsuario = i + 1;
        idUsuario = datosUsuarios[i][0];
        break;
      }
    }

    if (filaUsuario === -1) {
      return { success: false, message: "Usuario no encontrado en la base de datos" };
    }

    const passwordHashConSalt = calcularHashContrasenaConSalt_(passwordStr);

    // Columna D = Contraseña_Hash (columna 4)
    hojaUsuarios.getRange(filaUsuario, 4).setValue(passwordHashConSalt);

    // Marcar recuperación como 'Usado' y guardar hash opcional
    hojaRecuperacion.getRange(filaValida + 1, 6).setValue('Usado');
    hojaRecuperacion.getRange(filaValida + 1, 7).setValue(passwordHashConSalt);

    // Registrar auditoría
    registrarAuditoria({
      usuarioId: idUsuario,
      emailUsuario: emailNormalizado,
      tipo: 'RECUPERACION_PASSWORD',
      descripcion: 'Restablecimiento de contraseña exitoso con código de seguridad',
      entidadAfectada: 'Usuarios',
      estado: 'Exitosa'
    });

    return {
      success: true,
      message: '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
    };
  } catch (error) {
    Logger.log("Error en restablecerPasswordConCodigo: " + error.toString());
    return { success: false, message: "Error al restablecer la contraseña: " + error.toString() };
  }
}

/** Datos completos del usuario para la vista "Ver perfil" (la sesión local solo trae lo básico). */
function obtenerPerfilUsuario(idUsuario) {
  try {
    const spreadsheet = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = spreadsheet.getSheetByName("Usuarios");

    if (!hojaUsuarios) {
      return { success: false, message: "Error en la base de datos", usuario: null };
    }

    const datos = hojaUsuarios.getDataRange().getValues();
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][0]) === String(idUsuario)) {
        const rawRol = datos[i][4];
        const infoRol = typeof obtenerInfoRol_ === 'function' ? obtenerInfoRol_(rawRol) : { id: (parseInt(rawRol, 10) || 1), nombre: (rawRol === 3 || rawRol === '3' ? 'Superadministrador' : (rawRol === 2 || rawRol === '2' ? 'Administrador' : 'Usuario')) };
        return {
          success: true,
          usuario: {
            ID_Usuario: datos[i][0],
            Nombre_Completo: datos[i][1],
            Email: datos[i][2],
            ID_Rol: infoRol.id,
            Rol_ID: infoRol.id,
            Rol: infoRol.nombre,
            Estado: datos[i][5],
            Fecha_Registro: datos[i][6]
          }
        };
      }
    }

    return { success: false, message: "Usuario no encontrado", usuario: null };
  } catch (error) {
    Logger.log("Error en obtenerPerfilUsuario: " + error.toString());
    return { success: false, message: "Error al obtener el perfil", usuario: null };
  }
}
