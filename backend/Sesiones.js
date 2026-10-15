/**
 * Limpieza de la hoja "Sesiones". Cada inicio de sesión agrega una fila y nada las quitaba: la hoja solo crecía (y cada consulta de
 * un token tenía más que buscar). Una sesión dura 24 horas; una fila cuya fecha de vencimiento pasó hace más de
 * SESIONES_RETENCION_DIAS_ días ya no sirve para nada (ni para validar ni para investigar) y se elimina.
 *
 * - Automática: al crear una sesión, si la hoja pasa de SESIONES_LIMITE_FILAS_ filas se limpia sola (con candado, sin esperar).
 * - Manual desde el editor de Apps Script: simularLimpiezaDeSesiones() solo cuenta; limpiarSesionesViejas() elimina.
 * Nunca se tocan las sesiones vigentes ni las que vencieron hace poco.
 */
var SESIONES_LIMITE_FILAS_ = 3000;
var SESIONES_RETENCION_DIAS_ = 7;

/** Separa las filas (sin encabezado) en las que se conservan y cuántas se eliminan. Una fecha ilegible nunca se elimina. */
function planDeLimpiezaDeSesiones_(filas, ahoraMs, diasRetencion) {
  const corte = ahoraMs - diasRetencion * 24 * 60 * 60 * 1000;
  const conservar = [];
  let eliminar = 0;
  for (let i = 0; i < filas.length; i++) {
    const vencimiento = filas[i][4] ? new Date(filas[i][4]).getTime() : NaN;
    if (!isNaN(vencimiento) && vencimiento < corte) eliminar++;
    else conservar.push(filas[i]);
  }
  return { conservar: conservar, eliminar: eliminar };
}

/** Elimina las filas viejas de la hoja de sesiones (bajo candado). Devuelve { eliminadas, conservadas }. */
function limpiarSesionesEnHoja_(hoja, diasRetencion) {
  const lock = LockService.getScriptLock();
  try {
    tomarCandado_(lock, 15000);
    const ultima = hoja.getLastRow();
    if (ultima < 2) return { eliminadas: 0, conservadas: 0 };
    const ancho = hoja.getLastColumn();
    const filas = hoja.getRange(2, 1, ultima - 1, ancho).getValues();
    const plan = planDeLimpiezaDeSesiones_(filas, Date.now(), diasRetencion || SESIONES_RETENCION_DIAS_);
    if (plan.eliminar === 0) return { eliminadas: 0, conservadas: filas.length };
    // Se reescriben las que se conservan al principio y se borran las filas sobrantes del final (una sola operación de borrado)
    if (plan.conservar.length) hoja.getRange(2, 1, plan.conservar.length, ancho).setValues(plan.conservar);
    hoja.deleteRows(2 + plan.conservar.length, plan.eliminar);
    return { eliminadas: plan.eliminar, conservadas: plan.conservar.length };
  } finally {
    liberarCandado_(lock);
  }
}

/** La llama crearSesionUsuario_: solo trabaja si la hoja pasó el límite; jamás debe estorbar un inicio de sesión. */
function limpiarSesionesSiHaceFalta_(hoja) {
  try {
    if (hoja.getLastRow() <= SESIONES_LIMITE_FILAS_ + 1) return null;
    return limpiarSesionesEnHoja_(hoja);
  } catch (e) {
    Logger.log('Aviso limpiarSesionesSiHaceFalta_: ' + e);
    return null;
  }
}

/** EDITOR: cuenta cuántas filas se eliminarían, sin tocar nada. */
function simularLimpiezaDeSesiones() {
  const hoja = obtenerSpreadsheet_().getSheetByName('Sesiones');
  if (!hoja || hoja.getLastRow() < 2) { Logger.log('La hoja Sesiones está vacía o no existe.'); return; }
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).getValues();
  const plan = planDeLimpiezaDeSesiones_(filas, Date.now(), SESIONES_RETENCION_DIAS_);
  Logger.log('Sesiones: ' + filas.length + ' filas. Se eliminarían ' + plan.eliminar + ' (vencidas hace más de ' + SESIONES_RETENCION_DIAS_ + ' días) y se conservarían ' + plan.conservar.length + '.');
}

/** EDITOR: elimina las sesiones vencidas hace más de SESIONES_RETENCION_DIAS_ días. */
function limpiarSesionesViejas() {
  const hoja = obtenerSpreadsheet_().getSheetByName('Sesiones');
  if (!hoja) { Logger.log('La hoja Sesiones no existe.'); return; }
  const r = limpiarSesionesEnHoja_(hoja);
  Logger.log('Sesiones: se eliminaron ' + r.eliminadas + ' filas viejas; quedan ' + r.conservadas + '.');
}
