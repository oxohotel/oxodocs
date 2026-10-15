// Limpieza de la hoja Sesiones (backend/Sesiones.js): solo se eliminan las sesiones vencidas hace más de 7 días.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';

class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); this.borrados = 0; }
  ancho() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.ancho(); }
  appendRow(f) { this.filas.push(f.slice()); }
  deleteRows(desde, cantidad) { this.filas.splice(desde - 1, cantidad); this.borrados += cantidad; }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push((s.filas[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      setValues(v) { v.forEach((fila, i) => { while (s.filas.length < r + i) s.filas.push([]); fila.forEach((x, j) => { s.filas[r - 1 + i][c - 1 + j] = x; }); }); },
      setValue(x) { while (s.filas.length < r) s.filas.push([]); s.filas[r - 1][c - 1] = x; }
    };
  }
}

const DIA = 24 * 60 * 60 * 1000, AHORA = Date.now();
const f = (id, estado, diasHastaVencer) => ['SES-' + id, 1, 'tok-' + id, new Date(AHORA - 30 * DIA), new Date(AHORA + diasHastaVencer * DIA), estado];
const ENC = ['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado'];

const hojas = { Sesiones: new Hoja('Sesiones', [ENC]) };
let cierres = 0;
const sandbox = {
  console, Logger: { log: m => { sandbox.__logs.push(String(m)); } }, Date, Math, JSON, __logs: [],
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, tryLock() { return true; }, releaseLock() { cierres++; } }) },
  CacheService: { getScriptCache: () => ({ put() {}, get: () => null, remove() {} }) },
  Utilities: { getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'abcdefghijklmnopqrstuvwxyz', computeDigest: () => [1], DigestAlgorithm: { SHA_256: 'x' } }
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Usuario.js', 'Sesiones.js', 'Auth.js'].forEach(n => vm.runInContext(fs.readFileSync(REPO + 'backend/' + n, 'utf8'), sandbox, { filename: n }));
vm.runInContext('this.F={planDeLimpiezaDeSesiones_,limpiarSesionesEnHoja_,limpiarSesionesSiHaceFalta_,crearSesionUsuario_,simularLimpiezaDeSesiones,limpiarSesionesViejas,SESIONES_LIMITE_FILAS_}', sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_spreadsheetEjecucion_=null', sandbox);

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

// Mezcla: 5000 viejas (vencidas hace ~30 días), 3 vencidas ayer, 2 vigentes, 1 con fecha ilegible, 1 cerrada pero que vence mañana
const viejas = Array.from({ length: 5000 }, (_, i) => f('v' + i, i % 2 ? 'Cerrada' : 'Expirada', -30));
const recientes = [f('r1', 'Expirada', -1), f('r2', 'Cerrada', -1), f('r3', 'Activa', -2)];
const vigentes = [f('a1', 'Activa', 1), f('a2', 'Activa', 0.5)];
const rara = ['SES-x', 1, 'tok-x', new Date(), 'no-es-fecha', 'Activa'];
const cerradaHoy = f('c1', 'Cerrada', 1);
const mezcla = [].concat(viejas.slice(0, 2500), recientes, vigentes, viejas.slice(2500), [rara, cerradaHoy]);

const plan = F.planDeLimpiezaDeSesiones_(mezcla, AHORA, 7);
ok(plan.eliminar === 5000 && plan.conservar.length === 7, '1. el plan elimina las 5.000 vencidas hace 30 días y conserva las 7 recientes, vigentes o dudosas (elimina ' + plan.eliminar + ', conserva ' + plan.conservar.length + ')');
ok(['r1', 'r2', 'r3', 'a1', 'a2', 'x', 'c1'].every(id => plan.conservar.some(r => r[0] === 'SES-' + id)), '1b. ninguna sesión vigente, reciente, con fecha ilegible o cerrada hoy se elimina');

hojas.Sesiones = new Hoja('Sesiones', [ENC].concat(mezcla));
nuevaEjecucion();
const r = F.limpiarSesionesEnHoja_(hojas.Sesiones);
ok(r.eliminadas === 5000 && r.conservadas === 7 && hojas.Sesiones.filas.length === 8, '2. la hoja queda con el encabezado y 7 filas (queda con ' + hojas.Sesiones.filas.length + ' filas)');
ok(hojas.Sesiones.filas[0].join() === ENC.join(), '2b. el encabezado queda intacto');
ok(hojas.Sesiones.filas.slice(1).map(x => x[0]).join() === 'SES-r1,SES-r2,SES-r3,SES-a1,SES-a2,SES-x,SES-c1', '2c. se conserva el orden de las que quedan: ' + hojas.Sesiones.filas.slice(1).map(x => x[0]).join());
ok(hojas.Sesiones.borrados === 5000 && cierres >= 1, '2d. el borrado es una sola operación de bloque y el candado se suelta');

const antes = JSON.stringify(hojas.Sesiones.filas);
const r2 = F.limpiarSesionesEnHoja_(hojas.Sesiones);
ok(r2.eliminadas === 0 && JSON.stringify(hojas.Sesiones.filas) === antes, '3. si no hay nada viejo, no cambia nada');

// Solo se limpia sola cuando se pasa del límite
hojas.Sesiones = new Hoja('Sesiones', [ENC].concat(viejas.slice(0, 100)));
ok(F.limpiarSesionesSiHaceFalta_(hojas.Sesiones) === null && hojas.Sesiones.filas.length === 101, '4. con 100 filas (bajo el límite) no hace nada, aunque sean viejas');
hojas.Sesiones = new Hoja('Sesiones', [ENC].concat(viejas.slice(0, 3200), vigentes));
const sola = F.limpiarSesionesSiHaceFalta_(hojas.Sesiones);
ok(sola && sola.eliminadas === 3200 && hojas.Sesiones.filas.length === 3, '4b. pasado el límite (3.000) limpia sola y deja las vigentes');

// Al crear una sesión con la hoja pasada del límite, se limpia sin impedir el inicio de sesión
hojas.Sesiones = new Hoja('Sesiones', [ENC].concat(viejas.slice(0, 3100)));
nuevaEjecucion();
const token = F.crearSesionUsuario_({ ID_Usuario: 9, Nombre_Completo: 'N', Email: 'n@x.com', ID_Rol: 1, Rol: 'Usuario' });
ok(!!token && hojas.Sesiones.filas.length === 2 && hojas.Sesiones.filas[1][1] === 9, '5. crear una sesión con la hoja pasada del límite la limpia y la sesión nueva queda registrada (filas: ' + hojas.Sesiones.filas.length + ')');

// Las funciones del editor
hojas.Sesiones = new Hoja('Sesiones', [ENC].concat(mezcla)); nuevaEjecucion(); sandbox.__logs.length = 0;
F.simularLimpiezaDeSesiones();
ok(hojas.Sesiones.filas.length === mezcla.length + 1 && /Se eliminarían 5000/.test(sandbox.__logs.join(' ')), '6. simularLimpiezaDeSesiones solo cuenta y no borra nada → ' + sandbox.__logs.join(' ').slice(0, 100));
nuevaEjecucion(); F.limpiarSesionesViejas();
ok(hojas.Sesiones.filas.length === 8, '6b. limpiarSesionesViejas elimina de verdad');
console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
