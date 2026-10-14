/**
 * Entorno de pruebas: protecciones, datos ficticios y ayudas. Solo vive en el proyecto de PRUEBAS.
 *
 * Protecciones (cualquiera que falle detiene todo antes de tocar nada):
 *   1. La propiedad de script ENTORNO debe valer "PRUEBAS" (solo se pone a mano en el proyecto de pruebas).
 *   2. La hoja de cálculo configurada no puede ser la de producción (ID_PRODUCCION_PROHIBIDO_, que genera herramientas/sincronizar-pruebas.js).
 *   3. La carpeta raíz de Drive debe ser un valor de prueba (la herramienta de sincronización reemplaza la real): así cualquier
 *      llamada a Drive falla de inmediato en vez de tocar carpetas reales.
 * Además, al preparar el código para este proyecto TODAS las llamadas a MailApp.sendEmail se reemplazan por capturarCorreo_:
 * ninguna prueba puede enviar un correo de verdad.
 */

var CORREOS_CAPTURADOS_ = [];

function esEntornoSimulado_() {
  return typeof SIMULADO_NODE_ !== 'undefined' && SIMULADO_NODE_ === true;
}

function exigirEntornoDePruebas_() {
  if (!esEntornoSimulado_() && PropertiesService.getScriptProperties().getProperty('ENTORNO') !== 'PRUEBAS') {
    throw new Error('Este proyecto no está marcado como de PRUEBAS (falta la propiedad de script ENTORNO=PRUEBAS). No se ejecuta nada.');
  }
  if (typeof ID_PRODUCCION_PROHIBIDO_ !== 'undefined' && DRIVE_CONFIG.SPREADSHEET_ID === ID_PRODUCCION_PROHIBIDO_) {
    throw new Error('La hoja de cálculo configurada es la de PRODUCCIÓN. No se ejecuta nada.');
  }
  if (!/^PRUEBAS/.test(String(DRIVE_CONFIG.ROOT_FOLDER_ID))) {
    throw new Error('La carpeta raíz de Drive no es un valor de pruebas (debe empezar por PRUEBAS). No se ejecuta nada.');
  }
}

/** Sustituye a MailApp.sendEmail en el código preparado para pruebas: guarda el correo en memoria en vez de enviarlo. */
function capturarCorreo_(opciones) {
  CORREOS_CAPTURADOS_.push({
    para: opciones.to, bcc: opciones.bcc || '', asunto: opciones.subject, nombre: opciones.name || '', html: opciones.htmlBody || ''
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Hojas y datos ficticios
// ---------------------------------------------------------------------------------------------------------------------

var ENCABEZADOS_PRUEBA_ = {
  Usuarios: ['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'],
  Modulos: ['ID_Modulo', 'Nombre_Modulo', 'Orden', 'DriveFolderId', 'Fecha_Creacion'],
  Hoteles: ['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId', 'Fecha_Creacion'],
  Carpetas: ['ID_Carpeta', 'ID_Hotel', 'ID_Plantilla', 'Nombre_Carpeta', 'DriveFolderId', 'Fecha_Creacion', 'ID_Padre'],
  Archivos: ['ID_Archivo', 'ID_Carpeta', 'DriveFileId', 'Nombre_Archivo', 'Extension', 'Tipo_Documento', 'Estado_Documento', 'Responsable', 'MimeType', 'DriveUrl', 'Fecha_Creacion', 'Fecha_Modificacion', 'Fecha_Sincronizacion'],
  Verificacion_Email: ['ID_Verificacion', 'ID_Usuario', 'Email', 'Codigo', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado'],
  Auditoria: ['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado'],
  Sesiones: ['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado'],
  Actividad_Reciente: ['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora'],
  Favoritos: ['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado']
};

var HASH_FICTICIO_ = 'hash-ficticio-no-sirve-para-iniciar-sesion';

/** Usuarios ficticios de partida: [id, nombre, email, hash, rol, estado, fecha, hotelesPermitidos]. */
function usuariosFicticios_() {
  const f = '2026-01-01';
  return [
    [1, 'Superadmin Prueba', 'sa@pruebas.oxo', HASH_FICTICIO_, 3, 'Activo', f, ''],
    [2, 'Admin Distrito', 'admin.distrito@pruebas.oxo', HASH_FICTICIO_, 2, 'Activo', f, 'H1'],
    [3, 'Admin 84DC', 'admin.84dc@pruebas.oxo', HASH_FICTICIO_, 2, 'Activo', f, 'H2'],
    [4, 'Admin Todos', 'admin.todos@pruebas.oxo', HASH_FICTICIO_, 2, 'Activo', f, 'TODOS'],
    [5, 'Usuario Normal', 'normal@pruebas.oxo', HASH_FICTICIO_, 1, 'Activo', f, 'H1'],
    [6, 'Usuario Sin Hoteles', 'sinhoteles@pruebas.oxo', HASH_FICTICIO_, 1, 'Activo', f, '']
  ];
}

function modulosFicticios_() {
  return [['M1', 'Hoteles en operación', 1, 'carpeta-m1', new Date()], ['M2', 'Hoteles en pre-apertura', 2, 'carpeta-m2', new Date()],
    ['M3', 'Hoteles en desarrollo', 3, 'carpeta-m3', new Date()], ['M4', 'Corporativo', 4, 'carpeta-m4', new Date()]];
}

function hotelesFicticios_() {
  return [['H1', 'Distrito', 'M1', 'carpeta-h1', new Date()], ['H2', '84DC', 'M1', 'carpeta-h2', new Date()],
    ['H3', 'Hotel Secreto', 'M2', 'carpeta-h3', new Date()], ['H4', 'Hotel Futuro', 'M3', 'carpeta-h4', new Date()], ['HC', 'Corporativo', 'M4', 'carpeta-hc', new Date()]];
}

function hojaDePrueba_(nombre, encabezados) {
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  return obtenerOCrearHoja_(ss, nombre, encabezados || ENCABEZADOS_PRUEBA_[nombre]);
}

/** Borra el contenido (no las filas ni el encabezado: Sheets no permite borrar todas las filas no congeladas). */
function vaciarHoja_(hoja) {
  const filas = hoja.getMaxRows();
  if (filas > 1) hoja.getRange(2, 1, filas - 1, hoja.getMaxColumns()).clearContent();
}

function escribirFilas_(hoja, filas) {
  if (filas.length) hoja.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
}

/** Deja todas las hojas con su encabezado de producción y solo los datos ficticios de partida. */
function reiniciarEntornoDePruebas_() {
  exigirEntornoDePruebas_();
  Object.keys(ENCABEZADOS_PRUEBA_).forEach(function (nombre) {
    const hoja = hojaDePrueba_(nombre);
    vaciarHoja_(hoja);
    // Las columnas que el código agrega solas (Hoteles_Solicitados, Tamaño_Bytes...) se quitan del encabezado para volver al estado inicial
    const base = ENCABEZADOS_PRUEBA_[nombre].length;
    if (hoja.getMaxColumns() > base) hoja.getRange(1, base + 1, 1, hoja.getMaxColumns() - base).clearContent();
  });
  escribirFilas_(hojaDePrueba_('Usuarios'), usuariosFicticios_());
  escribirFilas_(hojaDePrueba_('Modulos'), modulosFicticios_());
  escribirFilas_(hojaDePrueba_('Hoteles'), hotelesFicticios_());
  limpiarCachesDePrueba_();
  nuevaEjecucion_();
  CORREOS_CAPTURADOS_ = [];
}

function limpiarCachesDePrueba_() {
  try {
    CacheService.getScriptCache().removeAll(['oxo:gen', 'oxo:usuarios_lite', 'oxo:hoja_Hoteles', 'oxo:hoja_Modulos', 'oxo:forzado', 'oxo:calentado']);
  } catch (e) {}
}

// ---------------------------------------------------------------------------------------------------------------------
// Ayudas para las pruebas
// ---------------------------------------------------------------------------------------------------------------------

var _contadorUnico_ = 0;
function sufijoUnico_() {
  _contadorUnico_++;
  return String(Date.now()).slice(-6) + '' + _contadorUnico_;
}

function correoPrueba_(prefijo) {
  return (prefijo || 'p') + sufijoUnico_() + '@oxohotel.com';
}

function filaDeUsuarioPrueba_(email) {
  const datos = hojaDePrueba_('Usuarios').getDataRange().getValues();
  const enc = datos[0];
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][2]).toLowerCase() === String(email).toLowerCase()) {
      const obj = { fila: i + 1 };
      enc.forEach(function (n, j) { obj[n] = datos[i][j]; });
      return obj;
    }
  }
  return null;
}

/** Token de sesión real (CacheService + hoja Sesiones) de un usuario ficticio, por su id. */
function tokenDePrueba_(idUsuario) {
  const u = usuariosFicticios_().filter(function (x) { return String(x[0]) === String(idUsuario); })[0];
  return crearSesionUsuario_({ ID_Usuario: u[0], Nombre_Completo: u[1], Email: u[2], ID_Rol: u[4], Rol: 'x' });
}

/** Registra y verifica a alguien (como lo haría una persona) y devuelve su fila. Los correos quedan capturados, no se envían. */
function registrarYVerificarPrueba_(propiedades, prefijo) {
  const email = correoPrueba_(prefijo || 'reg');
  const r = registrarUsuario('Persona de Prueba', email, 'Clave1234!', propiedades || []);
  afirmar_(r.success === true, 'el registro de prueba debía funcionar: ' + (r.message || ''));
  const codigos = hojaDePrueba_('Verificacion_Email').getDataRange().getValues().filter(function (f) { return String(f[2]).toLowerCase() === email; });
  const v = verificarCodigoRegistro(email, codigos[codigos.length - 1][3]);
  afirmar_(v.success === true, 'la verificación de prueba debía funcionar: ' + (v.message || ''));
  return filaDeUsuarioPrueba_(email);
}

/** Amplía la hoja si no tiene filas suficientes (Sheets no siempre las crea solo al escribir). */
function asegurarFilas_(hoja, filasNecesarias) {
  const faltan = filasNecesarias + 1 - hoja.getMaxRows();
  if (faltan > 0) hoja.insertRowsAfter(hoja.getMaxRows(), faltan);
}

/** Agrega "cantidad" usuarios ficticios (con tildes y ñ) detrás de los de partida. Ids desde 100. */
function sembrarUsuariosMasivos_(cantidad) {
  const hoja = hojaDePrueba_('Usuarios');
  const base = usuariosFicticios_().length;
  asegurarFilas_(hoja, base + cantidad + 1);
  const filas = [];
  for (let i = 0; i < cantidad; i++) {
    filas.push([100 + i, 'Persona Ñandú Gómez ' + (100 + i), 'persona.nombre.largo.' + (100 + i) + '@pruebas.oxo', HASH_FICTICIO_, 1, 'Activo', '2026-01-01', 'H1,H2,H3']);
  }
  hoja.getRange(2 + base, 1, cantidad, 8).setValues(filas);
  limpiarCachesDePrueba_();
  nuevaEjecucion_();
}
