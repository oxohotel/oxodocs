/**
 * Métricas de rendimiento del backend: qué llamadas se ponen lentas o fallan, para verlo ANTES de que los usuarios
 * lo sufran. Solo se registran las llamadas lentas (más de METRICA_UMBRAL_MS_) y los errores, no todas, para que
 * medir no sea otra fuente de carga. Nunca se guardan los argumentos de la llamada (podrían traer contraseñas).
 */

var METRICA_UMBRAL_MS_ = 5000;
var METRICA_LIMITE_FILAS_ = 2000;
var METRICA_HOLGURA_FILAS_ = 200;
var _metricaDetalladaRegistrada_ = false; // ya se guardó el desglose de esta ejecución: doPost no repite la fila
var METRICA_ENCABEZADOS_ = ['Fecha_Hora', 'Accion', 'Duracion_ms', 'Tipo', 'Detalle'];

function esErrorDeCuota_(mensaje) {
  return /too many times|quota|cuota|rate limit|service invoked|limit exceeded|exceeded maximum/i.test(String(mensaje || ''));
}

/** Cronómetro para medir las partes de una llamada: marca('nombre') anota cuánto tardó desde la marca anterior. */
function cronometro_() {
  const t0 = Date.now();
  let ultimo = t0;
  const partes = [];
  return {
    marca: function (nombre) { const ahora = Date.now(); partes.push(nombre + '=' + (ahora - ultimo)); ultimo = ahora; },
    total: function () { return Date.now() - t0; },
    detalle: function () { return partes.join(' '); }
  };
}

/** Se llama desde doPost; jamás debe afectar la respuesta, por eso se traga cualquier error propio.
 *  "detalle" y "umbralMs" son opcionales: permiten registrar el desglose de una llamada lenta con un umbral más bajo. */
function registrarMetrica_(accion, duracionMs, error, detalle, umbralMs) {
  try {
    const hayError = !!error;
    if (!hayError && duracionMs < (umbralMs || METRICA_UMBRAL_MS_)) return;
    if (!hayError && !detalle && _metricaDetalladaRegistrada_) return;

    const tipo = hayError ? (esErrorDeCuota_(error) ? 'CUOTA' : 'ERROR') : 'LENTA';
    const ss = obtenerSpreadsheet_();
    let hoja = ss.getSheetByName('Metricas');
    if (!hoja) {
      hoja = ss.insertSheet('Metricas');
      hoja.appendRow(METRICA_ENCABEZADOS_);
    }
    if (detalle) _metricaDetalladaRegistrada_ = true;
    hoja.appendRow([new Date(), String(accion || '').slice(0, 80), Math.round(duracionMs), tipo, hayError ? String(error).slice(0, 200) : String(detalle || '').slice(0, 200)]);

    if (hoja.getLastRow() > METRICA_LIMITE_FILAS_ + 1) {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(2000)) {
        try {
          const exceso = hoja.getLastRow() - 1 - (METRICA_LIMITE_FILAS_ - METRICA_HOLGURA_FILAS_);
          if (exceso > 0) hoja.deleteRows(2, exceso);
        } finally { lock.releaseLock(); }
      }
    }
  } catch (e) {
    Logger.log('Aviso registrarMetrica_: ' + e);
  }
}

/**
 * Resumen por acción de las llamadas lentas y los errores registrados (solo Superadministrador).
 * Devuelve { success, resumen: [{accion, lentas, errores, cuota, maxMs, promedioMs, ultima}], total }.
 */
function obtenerResumenMetricas(idUsuarioOToken, idUsuarioFallback) {
  if (typeof exigirSuperadmin_ !== 'function' || !exigirSuperadmin_(idUsuarioOToken, idUsuarioFallback)) {
    return { success: false, message: 'Solo el Superadministrador puede ver las métricas', resumen: [] };
  }
  try {
    const hoja = obtenerSpreadsheet_().getSheetByName('Metricas');
    if (!hoja || hoja.getLastRow() < 2) return { success: true, resumen: [], total: 0 };

    const filas = hoja.getDataRange().getValues().slice(1);
    const porAccion = {};
    filas.forEach(function (f) {
      const accion = String(f[1]);
      const r = porAccion[accion] || (porAccion[accion] = { accion: accion, lentas: 0, errores: 0, cuota: 0, maxMs: 0, sumaMs: 0, n: 0, ultima: '' });
      const tipo = String(f[3]);
      if (tipo === 'LENTA') r.lentas++; else if (tipo === 'CUOTA') r.cuota++; else r.errores++;
      const ms = Number(f[2]) || 0;
      r.maxMs = Math.max(r.maxMs, ms); r.sumaMs += ms; r.n++;
      r.ultima = f[0] ? f[0].toString() : r.ultima;
    });

    const resumen = Object.keys(porAccion).map(function (k) {
      const r = porAccion[k];
      return { accion: r.accion, lentas: r.lentas, errores: r.errores, cuota: r.cuota, maxMs: r.maxMs, promedioMs: Math.round(r.sumaMs / r.n), ultima: r.ultima };
    }).sort(function (a, b) { return (b.lentas + b.errores + b.cuota) - (a.lentas + a.errores + a.cuota); });

    return { success: true, resumen: resumen, total: filas.length };
  } catch (error) {
    Logger.log('Error obtenerResumenMetricas: ' + error);
    return { success: false, message: error.toString(), resumen: [] };
  }
}
