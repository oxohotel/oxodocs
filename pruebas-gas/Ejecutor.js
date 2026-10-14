/**
 * EJECUTOR DE PRUEBAS EN APPS SCRIPT REAL (solo para el proyecto de PRUEBAS; nunca se sube a producción).
 *
 * Corre dentro del entorno real de Apps Script (CacheService, LockService, SpreadsheetApp, Utilities reales) sobre una hoja
 * de cálculo de PRUEBAS con datos ficticios. Complementa las pruebas de Node (tests con simuladores), que son rápidas pero no
 * detectan diferencias con el entorno real: límites del caché, comportamiento de los candados, tipos que devuelve Sheets, etc.
 *
 * Es mínimo a propósito (sin librerías externas): suite_ / prueba_ / afirmar_*.
 *
 * Cómo se usa: ver pruebas-gas/README.md. Desde el editor: ejecutar "ejecutarPruebas". Resultados: Registro de ejecución y la
 * hoja "Resultados_Pruebas" de la hoja de cálculo de pruebas.
 */

var PRUEBAS_REGISTRADAS_ = [];
var SUITE_ACTUAL_ = '';
var NOTAS_PRUEBA_ACTUAL_ = [];

function suite_(nombre, definicion) {
  SUITE_ACTUAL_ = nombre;
  try { definicion(); } finally { SUITE_ACTUAL_ = ''; }
}

/** opciones: { soloReal: true } → se omite cuando se ejecuta en el simulador de Node (necesita servicios reales). */
function prueba_(nombre, fn, opciones) {
  PRUEBAS_REGISTRADAS_.push({ suite: SUITE_ACTUAL_, nombre: nombre, fn: fn, opciones: opciones || {} });
}

function afirmar_(condicion, mensaje) {
  if (!condicion) throw new Error('Falló: ' + mensaje);
}

function afirmarIgual_(real, esperado, mensaje) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) throw new Error('Falló: ' + mensaje + ' → esperado ' + b + ' pero fue ' + a);
}

function afirmarLanza_(fn, mensaje) {
  let lanzo = false;
  try { fn(); } catch (e) { lanzo = true; }
  if (!lanzo) throw new Error('Falló: ' + mensaje + ' (se esperaba una excepción y no hubo)');
}

/** Observación que se guarda con el resultado (para pruebas de "caracterización": registrar cómo se comporta el entorno real). */
function nota_(texto) {
  NOTAS_PRUEBA_ACTUAL_.push(String(texto));
}

function medir_(fn) {
  const t0 = Date.now();
  const resultado = fn();
  return { ms: Date.now() - t0, resultado: resultado };
}

/** Reinicia el estado "por ejecución" de nuestro código (en producción cada llamada del cliente arranca con esto limpio). */
function nuevaEjecucion_() {
  _memoCache_ = {};
  _spreadsheetEjecucion_ = null;
  _cacheIndiceHojas_ = {};
  _lecturasDeHoja_ = 0;
  _metricaDetalladaRegistrada_ = false;
}

function recopilarPruebas_() {
  PRUEBAS_REGISTRADAS_ = [];
  // Cada archivo de pruebas expone una función registradora (no se registra al cargar: el orden de carga de archivos no está garantizado)
  [registrarPruebasCache_, registrarPruebasHojas_, registrarPruebasCandados_, registrarPruebasFlujos_, registrarPruebasRendimiento_]
    .forEach(function (registrar) { registrar(); });
  return PRUEBAS_REGISTRADAS_;
}

/**
 * Ejecuta todas las pruebas (o solo las de las suites/pruebas cuyo nombre contenga "filtro").
 * Devuelve { total, ok, fallas, omitidas, ms, resultados }.
 */
function ejecutarPruebas(filtro) {
  const inicio = Date.now();
  exigirEntornoDePruebas_();
  const simulado = esEntornoSimulado_();
  const pruebas = recopilarPruebas_();
  const resultados = [];
  let suiteVigente = null;

  pruebas.forEach(function (p) {
    if (filtro && p.suite.indexOf(filtro) === -1 && p.nombre.indexOf(filtro) === -1) return;

    // En el simulador de Node se pueden forzar también las pruebas "solo real" (FORZAR_SOLO_REAL_EN_SIMULADOR_) para revisar su lógica; algunas fallarán porque los simuladores no son el entorno real
    if (p.opciones.soloReal && simulado && !(typeof FORZAR_SOLO_REAL_EN_SIMULADOR_ !== 'undefined' && FORZAR_SOLO_REAL_EN_SIMULADOR_ === true)) {
      resultados.push({ suite: p.suite, nombre: p.nombre, estado: 'OMITIDA', ms: 0, detalle: 'Solo se ejecuta en Apps Script real', notas: '' });
      return;
    }

    // Cada suite parte de datos ficticios limpios (las pruebas de una suite no dependen unas de otras: crean sus propios usuarios)
    if (p.suite !== suiteVigente) {
      suiteVigente = p.suite;
      reiniciarEntornoDePruebas_();
    }
    limpiarCachesDePrueba_();
    nuevaEjecucion_();
    NOTAS_PRUEBA_ACTUAL_ = [];
    CORREOS_CAPTURADOS_ = [];

    const t0 = Date.now();
    let estado = 'OK', detalle = '';
    try {
      p.fn();
    } catch (e) {
      estado = 'FALLA';
      detalle = String(e && e.message ? e.message : e);
    }
    resultados.push({ suite: p.suite, nombre: p.nombre, estado: estado, ms: Date.now() - t0, detalle: detalle, notas: NOTAS_PRUEBA_ACTUAL_.join(' | ') });
  });

  const resumen = {
    total: resultados.length,
    ok: resultados.filter(function (r) { return r.estado === 'OK'; }).length,
    fallas: resultados.filter(function (r) { return r.estado === 'FALLA'; }).length,
    omitidas: resultados.filter(function (r) { return r.estado === 'OMITIDA'; }).length,
    ms: Date.now() - inicio,
    simulado: simulado,
    resultados: resultados
  };
  guardarResultadosPruebas_(resumen);
  resultados.forEach(function (r) {
    Logger.log((r.estado === 'OK' ? 'OK    ' : (r.estado === 'FALLA' ? 'FALLA ' : 'omit  ')) + '[' + r.suite + '] ' + r.nombre + ' (' + r.ms + ' ms)' + (r.detalle ? ' → ' + r.detalle : '') + (r.notas ? ' · ' + r.notas : ''));
  });
  Logger.log('RESUMEN: ' + resumen.ok + ' OK, ' + resumen.fallas + ' fallas, ' + resumen.omitidas + ' omitidas, de ' + resumen.total + ' (' + Math.round(resumen.ms / 1000) + ' s)');
  return resumen;
}

/** Escribe los resultados en la hoja "Resultados_Pruebas" de la hoja de PRUEBAS (se reemplaza en cada corrida). */
function guardarResultadosPruebas_(resumen) {
  try {
    const hoja = hojaDePrueba_('Resultados_Pruebas', ['Fecha_Hora', 'Suite', 'Prueba', 'Estado', 'Duracion_ms', 'Detalle', 'Notas']);
    vaciarHoja_(hoja);
    const ahora = new Date();
    const filas = resumen.resultados.map(function (r) { return [ahora, r.suite, r.nombre, r.estado, r.ms, r.detalle, r.notas]; });
    filas.push([ahora, 'RESUMEN', resumen.ok + ' OK / ' + resumen.fallas + ' fallas / ' + resumen.omitidas + ' omitidas', resumen.fallas ? 'FALLA' : 'OK', resumen.ms, '', '']);
    if (filas.length) hoja.getRange(2, 1, filas.length, 7).setValues(filas);
  } catch (e) {
    Logger.log('Aviso: no se pudieron guardar los resultados en la hoja: ' + e);
  }
}
