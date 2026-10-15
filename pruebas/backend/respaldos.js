// Copia de seguridad diaria (backend/Respaldos.js): retención, verificación de la copia, avisos y vigilancia, con Drive y Sheets simulados.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';
const DIA = 24 * 60 * 60 * 1000;
let AHORA = new Date(2026, 9, 16, 3, 0, 0).getTime();

// ---------- Drive simulado
let seq = 0;
class Archivo {
  constructor(nombre, creado) { this.id = 'f' + (++seq); this.nombre = nombre; this.creado = creado; this.papelera = false; }
  getId() { return this.id; } getName() { return this.nombre; } isTrashed() { return this.papelera; } setTrashed(v) { this.papelera = v; return this; }
  getDateCreated() { return new Date(this.creado); }
}
class Carpeta {
  constructor(nombre) { this.id = 'carpeta' + (++seq); this.nombre = nombre; this.archivos = []; this.papelera = false; }
  getId() { return this.id; } isTrashed() { return this.papelera; } getUrl() { return 'https://drive/' + this.id; }
  getFiles() { const l = this.archivos.filter(a => !a.papelera); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }
}
const drive = { carpetas: [], raiz: [], archivos: {}, hojasOrigen: null };
const crearCarpeta = n => { const c = new Carpeta(n); drive.carpetas.push(c); drive.raiz.push(c); return c; };
const archivoOrigen = { getId: () => 'SHEET', makeCopy(nombre, carpeta) {
  if (drive.fallaCopia) throw new Error(drive.fallaCopia);
  const a = new Archivo(nombre, AHORA); carpeta.archivos.push(a); drive.archivos[a.id] = a; drive.ultimaCopia = a; return a;
} };

// ---------- Sheets simulados: { nombre: filas }
const hojaSim = (filas) => ({ getLastRow: () => filas });
const libro = (hojas, id) => ({ getId: () => id, getSheets: () => Object.keys(hojas).map(n => ({})), getSheetByName: n => (hojas[n] !== undefined ? hojaSim(hojas[n]) : null) });
const original = { Usuarios: 600, Carpetas: 900, Archivos: 5000, Auditoria: 20000, Otra: 10 };
let copiaSim = () => Object.assign({}, original);

const props = {}; const correos = []; const disparadores = []; let candadoOcupado = false;
const sandbox = {
  console, Date, Math, JSON, Object, Array, String, Number,
  Logger: { log: m => { sandbox.__logs.push(String(m)); } }, __logs: [],
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => !candadoOcupado, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'America/Bogota', getEffectiveUser: () => ({ getEmail: () => 'dueno@oxohotel.com' }) },
  Utilities: { formatDate: (d, z, f) => { const x = new Date(d.getTime ? d.getTime() : d); const p = n => String(n).padStart(2, '0'); const s = x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()); return f === 'yyyy-MM-dd' ? s : s + ' ' + p(x.getHours()) + p(x.getMinutes()); } },
  MailApp: { sendEmail: o => correos.push(o) },
  ScriptApp: {
    getProjectTriggers: () => disparadores.map(d => ({ getHandlerFunction: () => d.fn, id: d })),
    deleteTrigger: t => { const i = disparadores.indexOf(t.id); if (i !== -1) disparadores.splice(i, 1); },
    newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => disparadores.push({ fn, tipo: 'diario' }) }) }) }) })
  },
  DriveApp: {
    getFileById: id => (id === 'SHEET' ? archivoOrigen : drive.archivos[id]),
    getFolderById: id => { const c = drive.carpetas.find(x => x.id === id); if (!c) throw new Error('no existe'); return c; },
    getRootFolder: () => ({ getFoldersByName: n => { const l = drive.raiz.filter(c => c.nombre === n && !c.papelera); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; } }),
    createFolder: n => crearCarpeta(n)
  },
  SpreadsheetApp: { openById: id => (id === 'SHEET' ? libro(original, 'SHEET') : libro(copiaSim(), id)) },
  obtenerSpreadsheet_: () => libro(original, 'SHEET'),
  obtenerUsuariosLite_: () => ({ usuarios: [{ id: '1', email: 'sa@oxohotel.com', rol: 3, estado: 'Activo' }, { id: '2', email: 'admin@oxohotel.com', rol: 2, estado: 'Activo' }, { id: '3', email: 'sa.inactivo@oxohotel.com', rol: 3, estado: 'Inactivo' }] }),
  obtenerInfoRol_: r => ({ id: Number(r) })
};
vm.createContext(sandbox);
['Correos.js', 'Respaldos.js'].forEach(n => vm.runInContext(fs.readFileSync(REPO + 'backend/' + n, 'utf8'), sandbox, { filename: n }));
// Date.now controlable
vm.runInContext('var __ahora = 0; Date.now = function () { return __ahora; };', sandbox);
const fijarAhora = ms => { AHORA = ms; vm.runInContext('__ahora = ' + ms, sandbox); };
fijarAhora(AHORA);
vm.runInContext('this.F = { planDeRetencionDeRespaldos_, respaldarHojas, vigilarRespaldos_, instalarRespaldoDiario, desinstalarRespaldoDiario, estadoDeRespaldos, leerEstadoRespaldo_, carpetaDeRespaldos_ }', sandbox);
const F = sandbox.F;

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const reiniciar = () => { drive.ultimaCopia = null; Object.keys(props).forEach(k => delete props[k]); correos.length = 0; disparadores.length = 0; drive.carpetas.length = 0; drive.raiz.length = 0; drive.fallaCopia = null; candadoOcupado = false; copiaSim = () => Object.assign({}, original); fijarAhora(new Date(2026, 9, 16, 3, 0, 0).getTime()); };

// ---------- 1. Retención
const mk = (id, diasAtras) => ({ id, creado: AHORA - diasAtras * DIA });
const cien = Array.from({ length: 100 }, (_, i) => mk('c' + i, i));            // una por día durante 100 días
const plan = F.planDeRetencionDeRespaldos_(cien, AHORA);
ok(plan.conservar.length + plan.eliminar.length === 100, '1. el plan reparte todas las copias (' + plan.conservar.length + ' conservadas, ' + plan.eliminar.length + ' a eliminar)');
ok(Array.from({ length: 31 }, (_, i) => 'c' + i).every(id => plan.conservar.includes(id)), '1b. se conservan las de los últimos 30 días');
const mensuales = plan.conservar.filter(id => Number(id.slice(1)) > 30);
ok(mensuales.length >= 3 && mensuales.length <= 6, '1c. de lo más viejo solo queda la más antigua de cada mes reciente (' + mensuales.length + ' mensuales)');
ok(plan.eliminar.length > 40 && plan.eliminar.includes('c60'), '1d. el resto se elimina (c60 es una copia diaria vieja → a la papelera)');
const viejas = [mk('v1', 300), mk('v2', 250), mk('v3', 220), mk('v4', 400), mk('v5', 500)];
const pv = F.planDeRetencionDeRespaldos_(viejas, AHORA);
ok(pv.conservar.length === 3 && pv.conservar.join() === 'v3,v2,v1', '1e. aunque todas sean viejas se conservan siempre las 3 más recientes (' + pv.conservar.join() + ')');
ok(F.planDeRetencionDeRespaldos_([], AHORA).conservar.length === 0, '1f. sin copias no hay nada que decidir');

// ---------- 2. Copia buena
reiniciar();
const ajena = new Archivo('Notas personales.xlsx', AHORA - 400 * DIA);
const carpeta0 = crearCarpeta('OXO Docs - Respaldos'); carpeta0.archivos.push(ajena);
const viejaCopia = new Archivo('OXO Docs - Respaldo 2026-05-01 0300', AHORA - 168 * DIA); carpeta0.archivos.push(viejaCopia);
const medioMes = new Archivo('OXO Docs - Respaldo 2026-09-20 0300', AHORA - 26 * DIA); carpeta0.archivos.push(medioMes);
['a', 'b', 'c'].forEach((x, i) => carpeta0.archivos.push(new Archivo('OXO Docs - Respaldo 2026-10-' + (13 + i) + ' 0300', AHORA - (3 - i) * DIA)));
const r = F.respaldarHojas();
ok(r.success === true && /^OXO Docs - Respaldo 2026-10-16 0300$/.test(r.nombre), '2. la copia se hace con el nombre esperado: ' + r.nombre);
ok(drive.ultimaCopia && carpeta0.archivos.includes(drive.ultimaCopia), '2b. queda dentro de la carpeta de respaldos');
ok(!ajena.papelera, '2c. un archivo ajeno que esté en esa carpeta NO se toca jamás');
ok(!medioMes.papelera, '2d. una copia de hace 26 días se conserva');
ok(viejaCopia.papelera === false, '2e. la copia de hace 168 días es la más antigua de su mes (mayo) y ese mes aún está dentro de los 6 meses: se conserva como mensual');

const e = F.leerEstadoRespaldo_();
ok(e.ultimoOk === AHORA && e.ultimoId === r.id && e.ultimoError === null && e.historial.length === 1 && e.historial[0].ok, '2f. queda anotado el estado: última copia buena, sin error y una entrada en el historial');
ok(correos.length === 0, '2g. una copia buena no envía correos');
// Otra noche: dos copias de junio; solo la más antigua del mes queda como mensual, la otra va a la papelera (no se borra de forma definitiva)
const junioViejo = new Archivo('OXO Docs - Respaldo 2026-06-02 0300', AHORA - 136 * DIA); carpeta0.archivos.push(junioViejo);
const sobrante = new Archivo('OXO Docs - Respaldo 2026-06-10 0300', AHORA - 128 * DIA); carpeta0.archivos.push(sobrante);
fijarAhora(AHORA + DIA); const rr = F.respaldarHojas();
ok(rr.success && sobrante.papelera === true && junioViejo.papelera === false, '2h. de dos copias del mismo mes viejo se queda la más antigua y la otra va a la papelera de Drive (recuperable ~30 días)');

// ---------- 3. Reutiliza la carpeta; la crea si no existe
reiniciar();
const r1 = F.respaldarHojas();
ok(r1.success && drive.carpetas.length === 1 && props.RESPALDO_CARPETA_ID === drive.carpetas[0].id, '3. si no existe la carpeta se crea y se recuerda su id');
fijarAhora(AHORA + DIA); const r2 = F.respaldarHojas();
ok(r2.success && drive.carpetas.length === 1 && drive.carpetas[0].archivos.length === 2, '3b. la siguiente noche usa la misma carpeta (2 copias)');
drive.carpetas[0].papelera = true; fijarAhora(AHORA + DIA); const r3 = F.respaldarHojas();
ok(r3.success && drive.carpetas.length === 2, '3c. si alguien manda la carpeta a la papelera se crea una nueva en vez de fallar');

// ---------- 4. Fallos: avisan y no borran nada
reiniciar();
const previa = new Archivo('OXO Docs - Respaldo 2026-10-10 0300', AHORA - 6 * DIA); crearCarpeta('OXO Docs - Respaldos').archivos.push(previa);
drive.fallaCopia = 'Service error: Drive';
const rf = F.respaldarHojas();
ok(rf.success === false && /Service error/.test(rf.message), '4. si Drive falla devuelve el error: ' + rf.message);
ok(correos.length === 1 && /Falló la copia/.test(correos[0].subject), '4b. avisa por correo');
const para = correos[0].to.split(',').sort().join();
ok(para === 'dueno@oxohotel.com,sa@oxohotel.com', '4c. el aviso llega al dueño de la cuenta y a los superadministradores ACTIVOS (' + para + ')');
ok(!previa.papelera && F.leerEstadoRespaldo_().ultimoError === 'Service error: Drive', '4d. no se borró ninguna copia anterior y el error queda anotado');

reiniciar(); crearCarpeta('OXO Docs - Respaldos');
copiaSim = () => Object.assign({}, original, { Archivos: 4000 });
const rm = F.respaldarHojas();
ok(rm.success === false && /Archivos/.test(rm.message), '4e. una copia con muchas menos filas en una hoja clave se rechaza: ' + rm.message);
ok(drive.carpetas[0].archivos.every(a => a.papelera), '4f. y la copia mala se descarta (no queda nada en que confiar)');
reiniciar(); crearCarpeta('OXO Docs - Respaldos');
copiaSim = () => Object.assign({}, original, { Usuarios: 598 });
ok(F.respaldarHojas().success === true, '4g. una diferencia mínima (2 filas, por cambios mientras se copia) se tolera');
reiniciar(); crearCarpeta('OXO Docs - Respaldos');
copiaSim = () => { const c = Object.assign({}, original); delete c.Otra; return c; };
const rp = F.respaldarHojas();
ok(rp.success === false && /pestañas/.test(rp.message), '4h. una copia con menos pestañas que el original se rechaza: ' + rp.message);

// ---------- 5. Dos ejecuciones a la vez
reiniciar(); candadoOcupado = true;
const rc = F.respaldarHojas();
ok(rc.success === false && /en curso/.test(rc.message) && !drive.ultimaCopia, '5. si ya hay una copia en curso no hace otra');
candadoOcupado = false;

// ---------- 6. Vigilancia
reiniciar();
ok(F.vigilarRespaldos_() === false && correos.length === 0, '6. sin respaldo instalado no avisa de nada');
F.instalarRespaldoDiario();
ok(disparadores.length === 1 && disparadores[0].fn === 'respaldarHojas' && props.RESPALDO_INSTALADO, '6b. instalar crea un disparador diario y activa la vigilancia');
ok(F.leerEstadoRespaldo_().ultimoOk === AHORA, '6c. instalar hace además una primera copia');
fijarAhora(AHORA + 20 * 60 * 60 * 1000); correos.length = 0;
ok(F.vigilarRespaldos_() === false && correos.length === 0, '6d. a las 20 horas de la última copia no hay alarma');
fijarAhora(AHORA + 40 * 60 * 60 * 1000);
ok(F.vigilarRespaldos_() === true && correos.length === 1 && /Hace más de 36 horas/.test(correos[0].subject), '6e. pasadas 36 horas sin copia avisa');
ok(F.vigilarRespaldos_() === false && correos.length === 1, '6f. ese mismo día no repite el aviso');
fijarAhora(AHORA + 66 * 60 * 60 * 1000);
ok(F.vigilarRespaldos_() === true && correos.length === 2, '6g. al día siguiente, si sigue sin copia, vuelve a avisar');
F.desinstalarRespaldoDiario();
ok(disparadores.length === 0 && !props.RESPALDO_INSTALADO, '6h. desinstalar quita el disparador y la vigilancia');
ok(F.vigilarRespaldos_() === false, '6i. desinstalado, la vigilancia calla');

// ---------- 7. Estado desde el editor
reiniciar(); F.respaldarHojas(); sandbox.__logs.length = 0;
const est = F.estadoDeRespaldos();
ok(sandbox.__logs.some(l => /Copias guardadas: 1/.test(l)) && sandbox.__logs.some(l => /Última copia buena: 2026-10-16/.test(l)), '7. estadoDeRespaldos informa copias guardadas y última copia buena');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
