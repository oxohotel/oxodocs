/**
 * Punto de entrada de la Web App y API Backend Headless.
 *
 * - doGet(e): Sirve la plantilla HTML si se accede directo, o responde a consultas GET.
 * - doPost(e): Despacha peticiones API JSON desde el frontend externo (GitHub Pages, etc.)
 *   hacia las funciones de backend (Auth, Carpetas, Archivos, Drive, etc.).
 */

/**
 * LISTA DE ACCIONES PERMITIDAS. doPost/doGet solo ejecutan las funciones de esta lista, que son las que usa el frontend.
 * Todo lo demás (auxiliares internas, utilidades del editor, funciones de mantenimiento, tokens de OAuth...) queda fuera de
 * alcance de quien llame desde internet, aunque exista como función global.
 *
 * Al agregar una función nueva que el frontend deba llamar, hay que añadirla aquí. Para comprobar que la lista y el
 * frontend coinciden: node herramientas/verificar-acciones.js
 */
const ACCIONES_PERMITIDAS_ = [
  'actualizarNombreUsuario',
  'actualizarPermisosExistentes',
  'alternarFavorito',
  'aprobarUsuario',
  'asignarHotelesAUsuario',
  'buscarGlobal',
  'cambiarContrasenaUsuario',
  'cambiarEstadoUsuario',
  'cambiarRolUsuario',
  'cancelarSolicitudesPropias',
  'cerrarSolicitudUsuario',
  'cerrarSesionUsuario',
  'crearArea',
  'crearGrupoUsuario',
  'crearHotel',
  'crearSubcarpeta',
  'crearUsuarioPorAdmin',
  'editarHotel',
  'eliminarArchivo',
  'eliminarCarpeta',
  'eliminarGrupoUsuario',
  'eliminarHotel',
  'enviarCodigoVerificacion',
  'guardarArchivoEnDrive',
  'guardarArchivosMultiplesDesdeDrive',
  'guardarPreferenciasNotificaciones',
  'obtenerActividadReciente',
  'obtenerArchivoPorIdOUrl',
  'obtenerCarpetasDelHotel',
  'obtenerCatalogoRoles',
  'obtenerContenidoCarpeta',
  'obtenerDatosInicio',
  'obtenerDatosUsuarioActual',
  'obtenerFavoritosDetallados',
  'obtenerHotelesParaRegistro',
  'obtenerGruposUsuario',
  'obtenerIdsFavoritosUsuario',
  'obtenerListaUsuariosParaPermisos',
  'obtenerMisAccesos',
  'obtenerModulosConHoteles',
  'obtenerPreferenciasNotificaciones',
  'obtenerRegistrosAuditoria',
  'obtenerRutaCarpeta',
  'obtenerUsuariosParaGestion',
  'obtenerVersionCacheGlobal',
  'registrarActividad',
  'registrarAuditoria',
  'registrarUsuario',
  'renombrarArchivo',
  'renombrarCarpeta',
  'restablecerContrasenaUsuarioPorAdmin',
  'resolverSolicitudesUsuario',
  'solicitarAccesoPropiedades',
  'restablecerPasswordConCodigo',
  'solicitarCodigoRecuperacion',
  'validarCodigoRecuperacion',
  'validarCredenciales',
  'verificarCodigoRegistro',
  'verificarEmailExistente'
];

function accionPermitida_(nombre) {
  return typeof nombre === 'string' && ACCIONES_PERMITIDAS_.indexOf(nombre) !== -1;
}

/**
 * ACCIONES PÚBLICAS: las únicas que se pueden llamar SIN sesión (registro, inicio de sesión, recuperar contraseña, ping...).
 * Cualquier otra acción de la lista exige un token de sesión válido, enviado en el campo "token" de la petición.
 */
const ACCIONES_PUBLICAS_ = [
  'validarCredenciales',
  'registrarUsuario',
  'verificarEmailExistente',
  'enviarCodigoVerificacion',
  'verificarCodigoRegistro',
  'solicitarCodigoRecuperacion',
  'validarCodigoRecuperacion',
  'restablecerPasswordConCodigo',
  'obtenerHotelesParaRegistro',
  'obtenerVersionCacheGlobal',
  'cerrarSesionUsuario'
];

/**
 * Posiciones de los argumentos que identifican a QUIEN hace la llamada (id de usuario, token o "fallback"). El servidor las
 * reemplaza SIEMPRE por la identidad de la sesión validada: lo que mande el navegador en esas posiciones se ignora, así nadie puede
 * hacerse pasar por otra persona enviando su ID. Los objetivos de una acción (a quién se cambia el rol, qué carpeta se abre...)
 * NO están aquí: esos sí los elige quien llama, y cada función comprueba que tenga permiso sobre ellos.
 * La clave "T" marca un argumento que debe recibir el token de la sesión en vez del id (el refresco forzado lo exige).
 */
const ARGUMENTOS_DE_IDENTIDAD_ = {
  actualizarNombreUsuario: [0],
  actualizarPermisosExistentes: [1],
  alternarFavorito: [0],
  aprobarUsuario: [1, 2],
  asignarHotelesAUsuario: [2, 3],
  cambiarContrasenaUsuario: [0],
  cambiarEstadoUsuario: [2, 3],
  cambiarRolUsuario: [2, 3],
  cancelarSolicitudesPropias: ['T'],
  cerrarSolicitudUsuario: [1, 2],
  crearArea: [2],
  crearGrupoUsuario: [0],
  crearHotel: [2, 3],
  crearSubcarpeta: [2, 3],
  crearUsuarioPorAdmin: [1, 2],
  editarHotel: [3, 4],
  eliminarArchivo: [1, 2],
  eliminarCarpeta: [1, 2],
  eliminarGrupoUsuario: [0],
  eliminarHotel: [2, 3],
  guardarArchivoEnDrive: [7, 9],
  guardarArchivosMultiplesDesdeDrive: [2, 4],
  guardarPreferenciasNotificaciones: [0],
  obtenerActividadReciente: [0],
  obtenerCarpetasDelHotel: [1, 2],
  obtenerContenidoCarpeta: [1],
  obtenerDatosInicio: ['T', 1],
  obtenerDatosUsuarioActual: [0],
  obtenerFavoritosDetallados: [0],
  obtenerGruposUsuario: [0],
  obtenerIdsFavoritosUsuario: [0],
  obtenerMisAccesos: ['T'],
  obtenerModulosConHoteles: [0, 1],
  obtenerPreferenciasNotificaciones: [0],
  obtenerRegistrosAuditoria: [0, 2],
  obtenerUsuariosParaGestion: [0, 1],
  registrarActividad: [0],
  renombrarArchivo: [2, 3],
  renombrarCarpeta: [2, 3],
  restablecerContrasenaUsuarioPorAdmin: [2, 3],
  resolverSolicitudesUsuario: [3, 4],
  solicitarAccesoPropiedades: ['T']
};

/** Mensaje y código que el navegador reconoce para cerrar la sesión local y pedir iniciar sesión de nuevo. */
const RESPUESTA_SESION_INVALIDA_ = { success: false, codigo: 'SESION_INVALIDA', message: 'Tu sesión no es válida o venció. Vuelve a iniciar sesión.' };

/**
 * Valida la sesión de una petición: el token debe existir y no haber vencido, y la cuenta debe seguir activa (así, desactivar a
 * alguien le quita el acceso de inmediato, aunque conserve un token). Devuelve { idUsuario, email, nombre } o null.
 */
function validarSesionDePeticion_(token) {
  try {
    if (!token) return null;
    const sesion = obtenerUsuarioPorToken(String(token));
    if (!sesion || !sesion.idUsuario) return null;
    const lite = obtenerUsuariosLite_();
    const yo = lite.usuarios.filter(function (u) { return String(u.id) === String(sesion.idUsuario); })[0];
    if (!yo) return null;
    if (yo.estado && yo.estado !== 'Activo') return null;
    return { idUsuario: String(sesion.idUsuario), email: yo.email, nombre: yo.nombre };
  } catch (e) {
    Logger.log('Error validarSesionDePeticion_: ' + e);
    return null;
  }
}

/** Devuelve una copia de los argumentos con la identidad de la sesión en las posiciones de ARGUMENTOS_DE_IDENTIDAD_. */
function aplicarIdentidadDeSesion_(accion, args, sesion, token) {
  const posiciones = ARGUMENTOS_DE_IDENTIDAD_[accion];
  const copia = args.slice();
  if (posiciones) {
    posiciones.forEach(function (p, k) {
      const indice = p === 'T' ? k : p;
      while (copia.length < indice) copia.push(null);
      copia[indice] = p === 'T' ? String(token) : sesion.idUsuario;
    });
  }
  if (accion === 'registrarAuditoria' && copia[0] && typeof copia[0] === 'object') {
    // La bitácora de seguridad no puede decir que lo hizo otra persona: quién actúa lo pone el servidor
    copia[0] = Object.assign({}, copia[0], { usuarioId: sesion.idUsuario, emailUsuario: sesion.email });
  }
  return copia;
}

function doPost(e) {
  const inicioMs = Date.now();
  let accionMedida = '';
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (errParse) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;
    accionMedida = action;
    let args = Array.isArray(payload.args) ? payload.args : [];

    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'No se especificó ninguna acción en el payload.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const globalScope = this;
    if (accionPermitida_(action) && typeof globalScope[action] === 'function') {
      if (ACCIONES_PUBLICAS_.indexOf(action) === -1) {
        const sesion = validarSesionDePeticion_(payload.token);
        if (!sesion) {
          return ContentService.createTextOutput(JSON.stringify(RESPUESTA_SESION_INVALIDA_)).setMimeType(ContentService.MimeType.JSON);
        }
        args = aplicarIdentidadDeSesion_(action, args, sesion, payload.token);
      }
      const result = globalScope[action].apply(null, args);
      const salida = ContentService.createTextOutput(JSON.stringify({
        success: true,
        data: result
      })).setMimeType(ContentService.MimeType.JSON);
      registrarMetrica_(action, Date.now() - inicioMs, null); // solo guarda si fue lenta (backend/Metricas.js)
      return salida;
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: 'La función "' + action + '" no existe en el backend de Apps Script.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    Logger.log('Error en doPost API: ' + error);
    registrarMetrica_(accionMedida, Date.now() - inicioMs, (error && error.message) || String(error));
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Error interno en el servidor: ' + (error.message || error.toString())
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Si la petición GET incluye el parámetro 'action', responder como API JSON (ej. ping / healthcheck)
  if (e && e.parameter && e.parameter.action) {
    try {
      const action = e.parameter.action;
      const globalScope = this;
      if (accionPermitida_(action) && ACCIONES_PUBLICAS_.indexOf(action) !== -1 && typeof globalScope[action] === 'function') {
        const result = globalScope[action].apply(null);
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          data: result
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Repositorio de Documentos')
    .setFaviconUrl('https://acabrales-oxohotel.github.io/repo-imagenes/logo-oxodocs.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nombreArchivo) {
  return HtmlService.createTemplateFromFile(nombreArchivo).evaluate().getContent();
}

/**
 * Función global para forzar la limpieza del caché del navegador (localStorage)
 * de todos los usuarios de la aplicación.
 * Al ejecutar esta función desde el editor de Apps Script, se incrementa
 * la versión global del caché, lo que hace que los clientes borren su estado local.
 */
function resetearCacheGlobalAplicativo() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty('APP_CACHE_VERSION');
  if (!version) { version = '1'; }
  const nuevaVersion = String(parseInt(version, 10) + 1);
  props.setProperty('APP_CACHE_VERSION', nuevaVersion);
  Logger.log('✅ Caché global reseteado. Nueva versión: ' + nuevaVersion);
  return 'Caché global reseteado a versión ' + nuevaVersion;
}

/**
 * Función expuesta al Frontend para verificar la versión del caché
 */
function obtenerVersionCacheGlobal() {
  return PropertiesService.getScriptProperties().getProperty('APP_CACHE_VERSION') || '1';
}
