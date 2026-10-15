/**
 * Entradas web del proyecto de PRUEBAS (se agregan a la lista de acciones permitidas SOLO en este proyecto; ver
 * herramientas/sincronizar-pruebas.js). Todas exigen la clave de la propiedad de script CLAVE_PRUEBAS y el entorno de pruebas.
 *
 * Sirven para ejecutar las pruebas y la prueba de concurrencia desde la computadora sin abrir el editor.
 */

function validarClavePruebas_(clave) {
  exigirEntornoDePruebas_();
  const esperada = PropertiesService.getScriptProperties().getProperty('CLAVE_PRUEBAS');
  if (!esperada || String(clave) !== esperada) throw new Error('Clave de pruebas incorrecta');
}

/** Ejecuta las pruebas y devuelve el resumen. */
function ejecutarPruebasWeb(clave, filtro) {
  validarClavePruebas_(clave);
  const r = ejecutarPruebas(filtro || undefined);
  return { total: r.total, ok: r.ok, fallas: r.fallas, omitidas: r.omitidas, ms: r.ms, resultados: r.resultados };
}

/** Deja los datos ficticios de partida y devuelve un token de sesión por usuario ficticio (para la prueba de concurrencia). */
function sembrarDatosPruebasWeb(clave) {
  validarClavePruebas_(clave);
  reiniciarEntornoDePruebas_();

  // Cuentas pendientes de aprobación (ids 7 a 10) que piden Distrito y 84DC: material para la prueba de dos administradores a la vez
  const hoja = hojaDePrueba_('Usuarios');
  const idxSol = obtenerOAgregarColumna_(hoja, 'Hoteles_Solicitados');
  const pendientes = [];
  for (let i = 7; i <= 10; i++) {
    const fila = []; for (let c = 0; c <= idxSol; c++) fila.push('');
    fila[0] = i; fila[1] = 'Pendiente ' + i; fila[2] = 'pendiente' + i + '@pruebas.oxo'; fila[3] = HASH_FICTICIO_; fila[4] = 1; fila[5] = 'Pendiente_Aprobacion'; fila[6] = '2026-01-01'; fila[idxSol] = 'H1,H2';
    pendientes.push(fila);
  }
  hoja.getRange(2 + usuariosFicticios_().length, 1, pendientes.length, idxSol + 1).setValues(pendientes);
  limpiarCachesDePrueba_();

  const tokens = {};
  usuariosFicticios_().forEach(function (u) { tokens[u[0]] = tokenDePrueba_(u[0]); });
  return { success: true, tokens: tokens };
}

/** Foto del estado de las hojas de prueba, para comprobar invariantes tras la prueba de concurrencia. */
function inspeccionarEstadoPruebasWeb(clave) {
  validarClavePruebas_(clave);
  const usuarios = hojaDePrueba_('Usuarios').getDataRange().getValues();
  const enc = usuarios[0];
  const idx = function (n) { return enc.indexOf(n); };
  return {
    usuarios: usuarios.slice(1).filter(function (f) { return f[0] !== ''; }).map(function (f) {
      return { id: f[idx('ID_Usuario')], email: f[idx('Email')], estado: f[idx('Estado')], hoteles: f[idx('Hoteles_Permitidos')], solicitados: idx('Hoteles_Solicitados') !== -1 ? f[idx('Hoteles_Solicitados')] : '' };
    }),
    auditoriaIds: hojaDePrueba_('Auditoria').getDataRange().getValues().slice(1).filter(function (f) { return f[0] !== ''; }).map(function (f) { return f[0]; }),
    actividadFilas: Math.max(0, hojaDePrueba_('Actividad_Reciente').getLastRow() - 1),
    favoritos: hojaDePrueba_('Favoritos').getDataRange().getValues().slice(1).filter(function (f) { return f[0] !== ''; }).map(function (f) { return { usuario: f[1], tipo: f[2], recurso: f[3] }; })
  };
}

/** Para ejecutar desde el editor la primera vez: marca el proyecto como de pruebas y crea las hojas. */
function prepararEntornoDePruebas() {
  PropertiesService.getScriptProperties().setProperty('ENTORNO', 'PRUEBAS');
  // La clave viene de la herramienta de sincronización (CLAVE_PRUEBAS_INICIAL_, igual a la de .pruebas-gas.config.json); si no, se genera una
  PropertiesService.getScriptProperties().setProperty('CLAVE_PRUEBAS', typeof CLAVE_PRUEBAS_INICIAL_ !== 'undefined' ? CLAVE_PRUEBAS_INICIAL_ : Utilities.getUuid());
  reiniciarEntornoDePruebas_();
  Logger.log('Entorno de pruebas listo. Hoja: ' + DRIVE_CONFIG.SPREADSHEET_ID);
  Logger.log('Listo: ya se pueden hacer ejecuciones web (la clave está en .pruebas-gas.config.json).');
}

/**
 * Incrementa un contador en una hoja bajo el candado del script (leer, esperar, escribir). Si el candado serializa de verdad entre
 * ejecuciones web simultáneas, N llamadas dejan el contador en N. "modo": 'flush' (suelta tras SpreadsheetApp.flush) o 'sinflush'.
 */
function probarCandadoWeb(clave, modo, reinicio) {
  validarClavePruebas_(clave);
  const hoja = hojaDePrueba_('Favoritos');
  const lock = LockService.getScriptLock();
  if (reinicio) { hoja.getRange('Z1').setValue(0); SpreadsheetApp.flush(); return { reiniciado: true }; }
  // modos: 'flush' | 'sinflush' | 'leerantes' (lee la hoja ANTES del candado) | 'leerantes+flush' (además refresca tras tomarlo)
  if (modo.indexOf('leerantes') === 0) hoja.getRange('Z1').getValue();
  lock.waitLock(30000);
  let n = 0;
  try {
    if (modo === 'leerantes+flush') SpreadsheetApp.flush();
    n = Number(hoja.getRange('Z1').getValue()) || 0;
    Utilities.sleep(200);
    hoja.getRange('Z1').setValue(n + 1);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  return { leido: n };
}

function leerContadorPruebaWeb(clave) {
  validarClavePruebas_(clave);
  return { valor: Number(hojaDePrueba_('Favoritos').getRange('Z1').getValue()) || 0 };
}
