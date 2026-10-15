/**
 * Copia de seguridad diaria de la base de datos (el Google Sheet).
 *
 * Todo el orden del sistema (usuarios, propiedades, carpetas, archivos, permisos, auditoría) vive en ese Sheet: si alguien borra o
 * pisa filas por error, o un fallo las corrompe, sin una copia no hay vuelta atrás (el historial de versiones de Google Sheets existe
 * pero es incómodo y no siempre alcanza). Este módulo hace una copia completa cada noche en una carpeta de Drive aparte.
 *
 * - respaldarHojas(): la ejecuta un disparador diario (~3 a.m.). Copia el Sheet, VERIFICA la copia (misma cantidad de pestañas y de
 *   filas en las hojas clave) y aplica la retención. Si algo falla, avisa por correo y no borra ninguna copia anterior.
 * - Retención: las copias de los últimos 30 días, más la más antigua de cada mes de los últimos 6 meses, y siempre al menos las 3
 *   más recientes. Lo demás va a la papelera de Drive (recuperable ~30 días), nunca se borra de forma definitiva, y solo se tocan
 *   archivos de ESTA carpeta cuyo nombre empieza con el prefijo de las copias.
 * - Vigilancia: el disparador de 10 minutos del caché (calentarCaches) avisa por correo, como máximo una vez al día, si pasaron más
 *   de 36 horas sin una copia buena (por ejemplo, si alguien borró el disparador).
 *
 * Desde el editor de Apps Script: instalarRespaldoDiario() (una vez), respaldarHojas() (copia ahora), estadoDeRespaldos() (ver el estado),
 * desinstalarRespaldoDiario().
 */
var RESPALDO_CARPETA_NOMBRE_ = 'OXO Docs - Respaldos';
var RESPALDO_PREFIJO_ = 'OXO Docs - Respaldo ';
var RESPALDO_DIAS_DIARIOS_ = 30;
var RESPALDO_MESES_MENSUALES_ = 6;
var RESPALDO_MINIMO_A_CONSERVAR_ = 3;
var RESPALDO_HORAS_SIN_COPIA_PARA_ALERTA_ = 36;
var RESPALDO_HOJAS_CLAVE_ = ['Usuarios', 'Carpetas', 'Archivos'];
var RESPALDO_TOLERANCIA_FILAS_ = 5; // el Sheet puede cambiar mientras se copia (alguien borra una carpeta justo entonces)

var RESPALDO_PROP_ESTADO_ = 'RESPALDO_ESTADO';
var RESPALDO_PROP_CARPETA_ = 'RESPALDO_CARPETA_ID';
var RESPALDO_PROP_INSTALADO_ = 'RESPALDO_INSTALADO';
var RESPALDO_PROP_ALERTA_DIA_ = 'RESPALDO_ALERTA_DIA';

/**
 * Decide qué copias se conservan y cuáles se eliminan. "copias": [{ id, creado (ms) }] (solo copias, ya filtradas por prefijo).
 * Devuelve { conservar: [ids], eliminar: [ids] }.
 */
function planDeRetencionDeRespaldos_(copias, ahoraMs, opciones) {
  const o = opciones || {};
  const dias = o.dias || RESPALDO_DIAS_DIARIOS_;
  const meses = o.meses || RESPALDO_MESES_MENSUALES_;
  const minimo = o.minimo || RESPALDO_MINIMO_A_CONSERVAR_;
  const DIA = 24 * 60 * 60 * 1000;

  const ordenadas = copias.slice().sort(function (a, b) { return b.creado - a.creado; }); // más recientes primero
  const conservar = {};

  ordenadas.slice(0, minimo).forEach(function (c) { conservar[c.id] = true; });
  ordenadas.forEach(function (c) { if (ahoraMs - c.creado <= dias * DIA) conservar[c.id] = true; });

  // La más antigua de cada mes, mientras el mes no sea más viejo que "meses" meses
  const primeraDelMes = {};
  ordenadas.forEach(function (c) {
    const d = new Date(c.creado);
    const clave = d.getFullYear() + '-' + d.getMonth();
    if (!primeraDelMes[clave] || c.creado < primeraDelMes[clave].creado) primeraDelMes[clave] = c;
  });
  Object.keys(primeraDelMes).forEach(function (k) {
    const c = primeraDelMes[k];
    if (ahoraMs - c.creado <= meses * 31 * DIA) conservar[c.id] = true;
  });

  return {
    conservar: ordenadas.filter(function (c) { return conservar[c.id]; }).map(function (c) { return c.id; }),
    eliminar: ordenadas.filter(function (c) { return !conservar[c.id]; }).map(function (c) { return c.id; })
  };
}

function leerEstadoRespaldo_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RESPALDO_PROP_ESTADO_) || '{}'); } catch (e) { return {}; }
}

function guardarEstadoRespaldo_(cambios, entradaDeHistorial) {
  const estado = Object.assign(leerEstadoRespaldo_(), cambios);
  if (entradaDeHistorial) estado.historial = [entradaDeHistorial].concat(estado.historial || []).slice(0, 10);
  PropertiesService.getScriptProperties().setProperty(RESPALDO_PROP_ESTADO_, JSON.stringify(estado));
  return estado;
}

/** La carpeta de las copias: la recuerda por su id; si no existe, la busca por nombre en la raíz del Drive de la cuenta o la crea. */
function carpetaDeRespaldos_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(RESPALDO_PROP_CARPETA_);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* se vuelve a buscar o crear */ }
  }
  const existentes = DriveApp.getRootFolder().getFoldersByName(RESPALDO_CARPETA_NOMBRE_);
  const carpeta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(RESPALDO_CARPETA_NOMBRE_);
  props.setProperty(RESPALDO_PROP_CARPETA_, carpeta.getId());
  return carpeta;
}

function filasDeHojasClave_(spreadsheet) {
  const r = {};
  RESPALDO_HOJAS_CLAVE_.forEach(function (n) {
    const h = spreadsheet.getSheetByName(n);
    r[n] = h ? h.getLastRow() : 0;
  });
  return r;
}

/** Correo de aviso a quien administra el sistema: la cuenta dueña del script y los superadministradores activos. */
function destinatariosDeAlertaDeRespaldo_() {
  const correos = {};
  try { const yo = Session.getEffectiveUser().getEmail(); if (yo) correos[yo.toLowerCase()] = true; } catch (e) {}
  try {
    obtenerUsuariosLite_().usuarios.forEach(function (u) {
      const info = obtenerInfoRol_(u.rol);
      if (info && String(info.id) === '3' && (!u.estado || u.estado === 'Activo') && u.email) correos[u.email.toLowerCase()] = true;
    });
  } catch (e) {}
  return Object.keys(correos);
}

function enviarAlertaDeRespaldo_(asunto, detalle) {
  try {
    const para = destinatariosDeAlertaDeRespaldo_();
    if (!para.length) return;
    MailApp.sendEmail({
      to: para.join(','),
      name: CORREO_NOMBRE_REMITENTE_,
      subject: asunto,
      htmlBody: plantillaCorreo_('Atención con la copia de seguridad',
        parrafoCorreo_(detalle) +
        parrafoCorreo_('Para revisarlo, abre el editor de Apps Script del proyecto y ejecuta <strong>estadoDeRespaldos</strong>; para hacer una copia ahora, ejecuta <strong>respaldarHojas</strong>.'),
        'Este aviso se envía automáticamente al responsable del sistema y a los superadministradores.')
    });
  } catch (e) {
    Logger.log('Aviso enviarAlertaDeRespaldo_: ' + e);
  }
}

/**
 * Hace la copia, la verifica y aplica la retención. Devuelve { success, nombre, id } o { success:false, message }.
 * Solo la ejecuta el disparador o el editor (no está en la lista de acciones web).
 */
function respaldarHojas() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { success: false, message: 'Ya hay una copia en curso' };
  const inicio = Date.now();
  let copia = null;
  try {
    const ss = obtenerSpreadsheet_();
    const antes = filasDeHojasClave_(ss);
    const hojasAntes = ss.getSheets().length;

    const carpeta = carpetaDeRespaldos_();
    const nombre = RESPALDO_PREFIJO_ + Utilities.formatDate(new Date(Date.now()), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
    copia = DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);

    // Verificación: una copia que no se puede abrir o que quedó incompleta no cuenta como copia
    const ssCopia = SpreadsheetApp.openById(copia.getId());
    const hojasCopia = ssCopia.getSheets().length;
    if (hojasCopia < hojasAntes) throw new Error('La copia tiene ' + hojasCopia + ' pestañas y el original ' + hojasAntes);
    const despues = filasDeHojasClave_(ssCopia);
    RESPALDO_HOJAS_CLAVE_.forEach(function (n) {
      if (despues[n] < antes[n] - RESPALDO_TOLERANCIA_FILAS_) throw new Error('En la copia la hoja ' + n + ' tiene ' + despues[n] + ' filas y el original ' + antes[n]);
    });

    // Retención (solo archivos de esta carpeta con el prefijo de las copias)
    const todas = [];
    const it = carpeta.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.getName().indexOf(RESPALDO_PREFIJO_) === 0 && !f.isTrashed()) todas.push({ id: f.getId(), creado: f.getDateCreated().getTime(), archivo: f });
    }
    const plan = planDeRetencionDeRespaldos_(todas, Date.now());
    const porId = {};
    todas.forEach(function (c) { porId[c.id] = c.archivo; });
    plan.eliminar.forEach(function (id) { if (id !== copia.getId()) porId[id].setTrashed(true); });

    const ms = Date.now() - inicio;
    guardarEstadoRespaldo_({ ultimoOk: Date.now(), ultimoId: copia.getId(), ultimoNombre: nombre, ultimoError: null, conservadas: plan.conservar.length, filas: despues, hojas: hojasCopia },
      { en: Date.now(), ok: true, ms: ms, detalle: nombre + ' (' + plan.conservar.length + ' copias guardadas, ' + plan.eliminar.length + ' a la papelera)' });
    Logger.log('Respaldo listo: ' + nombre + ' en ' + ms + ' ms. Copias guardadas: ' + plan.conservar.length + '; enviadas a la papelera: ' + plan.eliminar.length);
    return { success: true, nombre: nombre, id: copia.getId(), conservadas: plan.conservar.length, eliminadas: plan.eliminar.length, ms: ms };
  } catch (error) {
    const mensaje = String(error && error.message ? error.message : error);
    Logger.log('Error respaldarHojas: ' + mensaje);
    // Una copia a medias o inservible se descarta: es preferible que no exista a que alguien confíe en ella
    try { if (copia) copia.setTrashed(true); } catch (e) {}
    guardarEstadoRespaldo_({ ultimoError: mensaje, ultimoErrorEn: Date.now() }, { en: Date.now(), ok: false, ms: Date.now() - inicio, detalle: mensaje });
    enviarAlertaDeRespaldo_('⚠️ Falló la copia de seguridad de OXO Docs', 'La copia de seguridad automática no se pudo completar: ' + mensaje + '. No se eliminó ninguna copia anterior.');
    return { success: false, message: mensaje };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * La llama el disparador de 10 minutos del caché: si hace más de 36 horas que no hay una copia buena, avisa (una vez al día como
 * máximo). Solo actúa si el respaldo diario fue instalado. Nunca debe estorbar a quien la llama.
 */
function vigilarRespaldos_() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty(RESPALDO_PROP_INSTALADO_)) return false;
    const estado = leerEstadoRespaldo_();
    const ahora = Date.now();
    const ultimo = estado.ultimoOk || Number(props.getProperty(RESPALDO_PROP_INSTALADO_)) || 0;
    if (ahora - ultimo < RESPALDO_HORAS_SIN_COPIA_PARA_ALERTA_ * 60 * 60 * 1000) return false;

    const hoy = Utilities.formatDate(new Date(ahora), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (props.getProperty(RESPALDO_PROP_ALERTA_DIA_) === hoy) return false;
    props.setProperty(RESPALDO_PROP_ALERTA_DIA_, hoy);

    const horas = Math.floor((ahora - ultimo) / (60 * 60 * 1000));
    enviarAlertaDeRespaldo_('⚠️ Hace más de ' + RESPALDO_HORAS_SIN_COPIA_PARA_ALERTA_ + ' horas que no hay copia de seguridad de OXO Docs',
      'La última copia buena de la base de datos es de hace ' + horas + ' horas' + (estado.ultimoError ? ' y el último intento falló: ' + estado.ultimoError : '') + '. Es posible que el disparador diario se haya borrado o que el servicio de Google esté fallando.');
    return true;
  } catch (e) {
    Logger.log('Aviso vigilarRespaldos_: ' + e);
    return false;
  }
}

/** EDITOR: crea el disparador diario (~3 a.m.), hace una primera copia y deja activa la vigilancia. Ejecutar UNA vez. */
function instalarRespaldoDiario() {
  desinstalarRespaldoDiario();
  ScriptApp.newTrigger('respaldarHojas').timeBased().everyDays(1).atHour(3).create();
  PropertiesService.getScriptProperties().setProperty(RESPALDO_PROP_INSTALADO_, String(Date.now()));
  const r = respaldarHojas();
  Logger.log('Respaldo diario instalado (cada noche ~3 a.m.). Primera copia: ' + JSON.stringify(r));
}

/** EDITOR: quita el disparador y la vigilancia (las copias ya hechas se quedan en Drive). */
function desinstalarRespaldoDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'respaldarHojas') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty(RESPALDO_PROP_INSTALADO_);
  Logger.log('Respaldo diario desinstalado');
}

/** EDITOR: muestra el estado: última copia buena, último error, cuántas copias hay y dónde están. */
function estadoDeRespaldos() {
  const estado = leerEstadoRespaldo_();
  const zona = Session.getScriptTimeZone();
  const fmt = function (ms) { return ms ? Utilities.formatDate(new Date(ms), zona, 'yyyy-MM-dd HH:mm') : 'nunca'; };
  const instalado = !!PropertiesService.getScriptProperties().getProperty(RESPALDO_PROP_INSTALADO_);
  const hayDisparador = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'respaldarHojas'; });
  Logger.log('Respaldo diario: ' + (instalado && hayDisparador ? 'ACTIVO' : 'NO instalado (ejecuta instalarRespaldoDiario)'));
  Logger.log('Última copia buena: ' + fmt(estado.ultimoOk) + (estado.ultimoNombre ? ' (' + estado.ultimoNombre + ')' : ''));
  Logger.log('Último error: ' + (estado.ultimoError ? fmt(estado.ultimoErrorEn) + ' — ' + estado.ultimoError : 'ninguno'));
  try {
    const carpeta = carpetaDeRespaldos_();
    let n = 0;
    const it = carpeta.getFiles();
    while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(RESPALDO_PREFIJO_) === 0 && !f.isTrashed()) n++; }
    Logger.log('Copias guardadas: ' + n + ' · Carpeta: ' + carpeta.getUrl());
  } catch (e) { Logger.log('No se pudo leer la carpeta de copias: ' + e); }
  (estado.historial || []).slice(0, 5).forEach(function (h) { Logger.log('  ' + fmt(h.en) + ' ' + (h.ok ? 'OK ' : 'FALLÓ ') + h.detalle); });
  return estado;
}
