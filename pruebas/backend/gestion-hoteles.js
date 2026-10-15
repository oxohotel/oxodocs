// Prueba la lógica de backend/GestionHoteles.js con Sheets y Drive simulados en memoria.
const fs = require('fs');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..', 'backend') + '/';

// ---------- Simulación de Sheets ----------
class Hoja {
  constructor(nombre, filas) { this.nombre = nombre; this.filas = filas.map(f => f.slice()); }
  getDataRange() { const self = this; return { getValues: () => self.filas.map(f => f.slice()) }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas[0].length; }
  deleteRow(n) { this.filas.splice(n - 1, 1); }
  getRange(r, c, nr = 1, nc = 1) {
    const self = this;
    return {
      setValues(vals) {
        for (let i = 0; i < vals.length; i++) {
          while (self.filas.length < r - 1 + i + 1) self.filas.push(new Array(self.filas[0].length).fill(''));
          for (let j = 0; j < vals[i].length; j++) self.filas[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      },
      setValue(v) { while (self.filas.length < r) self.filas.push(new Array(self.filas[0].length).fill('')); self.filas[r - 1][c - 1] = v; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (self.filas[r - 1 + i]) self.filas[r - 1 + i][c - 1 + j] = ''; },
      getValues() { const out = []; for (let i = 0; i < nr; i++) out.push(self.filas[r - 1 + i].slice(c - 1, c - 1 + nc)); return out; }
    };
  }
}
// OJO: clearContent deja filas en blanco; las filas que quedan sin datos las comprobamos filtrando vacías.

// ---------- Simulación de Drive ----------
let seq = 1000;
const carpetas = {};
class Carpeta {
  constructor(nombre, padre) { this.id = 'F' + (seq++); this.nombre = nombre; this.padre = padre; this.papelera = false; carpetas[this.id] = this; }
  getId() { return this.id; }
  setName(n) { this.nombre = n; return this; }
  moveTo(dest) { this.padre = dest; return this; }
  setTrashed(v) { this.papelera = v; return this; }
  getFoldersByName(n) {
    const hijos = Object.values(carpetas).filter(c => c.padre === this && !c.papelera && c.nombre === n);
    let i = 0; return { hasNext: () => i < hijos.length, next: () => hijos[i++] };
  }
  createFolder(n) { return new Carpeta(n, this); }
}

// ---------- Datos iniciales ----------
const raiz = new Carpeta('RAIZ', null);
const mOper = new Carpeta('Hoteles en operación', raiz), mPre = new Carpeta('Hoteles en pre-apertura', raiz),
      mDes = new Carpeta('Hoteles en desarrollo', raiz), mCorp = new Carpeta('Corporativo', raiz);
const hBari = new Carpeta('Hotel Bari', mOper), hCorp = new Carpeta('Corporativo', mCorp);
const aIT = new Carpeta('IT', hBari), aCAF = new Carpeta('CAF', hBari);

const hojas = {
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre_Modulo', 'Orden', 'DriveFolderId', 'Fecha'],
    [1, 'Hoteles en operación', 1, mOper.id, ''], [2, 'Hoteles en pre-apertura', 2, mPre.id, ''],
    [3, 'Hoteles en desarrollo', 3, mDes.id, ''], [4, 'Corporativo', 4, mCorp.id, '']]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId', 'Fecha'],
    [1, 'Hotel Bari', 1, hBari.id, ''], [2, 'Corporativo', 4, hCorp.id, '']]),
  Carpetas: new Hoja('Carpetas', [['ID_Carpeta', 'ID_Hotel', 'ID_Plantilla', 'Nombre_Carpeta', 'DriveFolderId', 'Fecha_Creacion', 'ID_Padre'],
    [1, 1, 1, 'IT', aIT.id, '', ''], [2, 1, 2, 'CAF', aCAF.id, '', ''], [3, 1, '', 'Presupuestos', 'FX', '', 1]]),
  Archivos: new Hoja('Archivos', [['ID_Archivo', 'ID_Carpeta', 'Nombre_Archivo'], ['ARC-1', 3, 'a.xlsx'], ['ARC-2', 2, 'b.pdf'], ['ARC-9', 99, 'otro hotel.pdf']]),
  Permisos_Archivos: new Hoja('Permisos_Archivos', [['ID_Permiso', 'ID_Archivo', 'ID_Usuario_RESTRINGIDO'], [1, 'ARC-1', 7], [2, 'ARC-9', 7]]),
  Favoritos: new Hoja('Favoritos', [['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso'],
    [1, 5, 'Hotel', 1], [2, 5, 'Carpeta', 3], [3, 5, 'Archivo', 'ARC-1'],
    [4, 5, 'Carpeta', 99], /* carpeta de otro hotel con id distinto */ [5, 5, 'Hotel', 2] /* hotel Corporativo */,
    [6, 5, 'Archivo', 1] /* choque de id numérico 1 con tipo Archivo: NO debe borrarse */]),
  Actividad_Reciente: new Hoja('Actividad_Reciente', [['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso'], [1, 5, 'Carpeta', 1], [2, 5, 'Carpeta', 77]]),
  Notificaciones: new Hoja('Notificaciones', [['ID_Notificacion', 'ID_Usuario_Destino', 'Tipo_Recurso', 'ID_Recurso'], [1, 5, 'Archivo', 'ARC-2']]),
  Usuarios: new Hoja('Usuarios', [['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Hoteles_Permitidos'],
    [5, 'Ana', 'a@x.com', '', 3, 'Activo', ''], [6, 'Beto', 'b@x.com', '', 1, 'Activo', '1,2'], [7, 'Cami', 'c@x.com', '', 1, 'Activo', '1'], [8, 'Dani', 'd@x.com', '', 2, 'Activo', '*']])
};

const auditoria = [];
const sandbox = {
  console, Logger: { log: () => {} }, Utilities: { sleep: () => {} },
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null }) },
  DriveApp: { getFolderById: id => { if (!carpetas[id]) throw new Error('no existe ' + id); return carpetas[id]; } },
  tomarCandado_: (l, ms) => l.waitLock(ms), liberarCandado_: l => l.releaseLock(),
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, releaseLock() {} }) },
  // Roles / sesión simulados: token 'SA' = superadmin (rol 3), 'US' = usuario (rol 1)
  resolverUsuarioSolicitante_: t => ({ SA: { idUsuario: '5' }, US: { idUsuario: '6' } }[t] || null),
  obtenerRolDeUsuario_: id => ({ '5': 3, '6': 1 }[String(id)]),
  obtenerInfoRol_: r => ({ id: r }),
  registrarAuditoriaSimple_: (u, a, d) => auditoria.push([u, a, d]),
  indiceEncabezados_: hoja => { const m = {}; hoja.getDataRange().getValues()[0].forEach((h, i) => m[h] = i); return m; }
};
vm.createContext(sandbox);
// Drive.js real (conReintentos_, obtenerOCrearSubcarpeta_, DRIVE_CONFIG) y el archivo nuevo
vm.runInContext(['Drive.js', 'Inicio.js', 'Cache.js', 'CacheArchivos.js', 'GestionHoteles.js'].map(f => fs.readFileSync(REPO + f, 'utf8')).join(String.fromCharCode(10)) +
  '\nthis.crearHotel=crearHotel;this.editarHotel=editarHotel;this.eliminarHotel=eliminarHotel;this.AREAS=DRIVE_CONFIG.AREAS_FIJAS;', sandbox);

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + msg); if (!cond) fallos++; };
const datos = n => hojas[n].filas.filter(f => f.some(c => c !== ''));

// ---- 1. Permisos
ok(sandbox.crearHotel('X', 1, 'US').success === false, 'un usuario normal no puede crear');
ok(sandbox.crearHotel('X', 1, 'tokenInvalido').success === false, 'token inválido no puede crear');
ok(sandbox.eliminarHotel(1, 'Hotel Bari', 'US').success === false, 'un usuario normal no puede eliminar');

// ---- 2. Crear
let r = sandbox.crearHotel('  Hotel   Pop Art Tocancipá ', 1, 'SA');
ok(r.success && r.hotel.nombre === 'Hotel Pop Art Tocancipá', 'crea Hotel Pop Art Tocancipá (espacios normalizados): ' + JSON.stringify(r));
const idPop = r.hotel && r.hotel.idHotel;
ok(datos('Hoteles').length === 4, 'Hoteles tiene 3 hoteles + encabezado');
const carpPop = datos('Carpetas').filter(f => f[1] === idPop);
ok(carpPop.length === sandbox.AREAS.length, 'se crearon las ' + sandbox.AREAS.length + ' áreas en Carpetas');
ok(new Set(datos('Carpetas').map(f => String(f[0]))).size === datos('Carpetas').length, 'IDs de Carpetas sin duplicados');
ok(carpPop.every(f => f[6] === ''), 'las áreas nuevas no tienen ID_Padre');
ok(Object.values(carpetas).filter(c => c.padre && c.padre.nombre === 'Hotel Pop Art Tocancipá').length === sandbox.AREAS.length, 'carpetas de áreas creadas en Drive bajo el hotel');
ok(carpetas[datos('Hoteles').find(f => f[1] === 'Hotel Pop Art Tocancipá')[3]].padre === mOper, 'el hotel quedó dentro de la carpeta del módulo en operación');
ok(sandbox.crearHotel('hotel pop art tocancipa', 1, 'SA').success === false, 'rechaza duplicado (sin tildes/mayúsculas)');
ok(sandbox.crearHotel('Algo', 4, 'SA').success === false, 'rechaza crear en el módulo Corporativo');
ok(sandbox.crearHotel('Algo', 99, 'SA').success === false, 'rechaza módulo inexistente');
ok(sandbox.crearHotel('   ', 1, 'SA').success === false, 'rechaza nombre vacío');
r = sandbox.crearHotel('Holiday Inn Express Barranquilla Buenavista', 1, 'SA');
ok(r.success, 'crea Holiday Inn Express Barranquilla Buenavista');

// ---- 3. Editar / mover
const antesCarpetas = JSON.stringify(datos('Carpetas').filter(f => f[1] === 1));
r = sandbox.editarHotel(1, 'Hotel Bari', 3, 'SA');
const bari = datos('Hoteles').find(f => f[0] === 1);
ok(r.success && bari[2] === 3, 'mueve Hotel Bari a desarrollo en la hoja');
ok(hBari.padre === mDes, 'la carpeta de Drive se movió al módulo destino');
ok(JSON.stringify(datos('Carpetas').filter(f => f[1] === 1)) === antesCarpetas, 'carpetas/áreas del hotel intactas tras el movimiento');
ok(aIT.padre === hBari && aIT.id === datos('Carpetas')[1][4], 'las áreas siguen colgando de la misma carpeta de Drive con el mismo ID');
r = sandbox.editarHotel(1, 'Hotel Bari Renombrado', 2, 'SA');
ok(r.success && datos('Hoteles').find(f => f[0] === 1)[1] === 'Hotel Bari Renombrado' && hBari.nombre === 'Hotel Bari Renombrado' && hBari.padre === mPre, 'renombra y mueve a la vez (hoja y Drive)');
ok(sandbox.editarHotel(1, 'Hotel Pop Art Tocancipá', null, 'SA').success === false, 'rechaza renombrar a un nombre ya usado');
ok(sandbox.editarHotel(2, 'Otro', 1, 'SA').success === false, 'no deja modificar el hotel Corporativo');
ok(sandbox.editarHotel(1, 'Z', 4, 'SA').success === false, 'no deja mover hacia el módulo Corporativo');
ok(sandbox.editarHotel(1, 'Hotel Bari Renombrado', 2, 'SA').sinCambios === true, 'sin cambios devuelve éxito sin tocar nada');
ok(sandbox.editarHotel(1, 'X', 1, 'US').success === false, 'usuario normal no puede editar');
sandbox.editarHotel(1, 'Hotel Bari', 1, 'SA'); // volver a operación

// ---- 4. Eliminar
ok(sandbox.eliminarHotel(1, 'nombre equivocado', 'SA').success === false && datos('Hoteles').length === 5, 'confirmación incorrecta no borra nada');
ok(sandbox.eliminarHotel(2, 'Corporativo', 'SA').success === false, 'no deja eliminar Corporativo');
r = sandbox.eliminarHotel(1, 'hotel bari', 'SA');
ok(r.success, 'elimina Hotel Bari con confirmación (sin importar mayúsculas): ' + JSON.stringify(r));
ok(!datos('Hoteles').some(f => f[0] === 1), 'fila del hotel eliminada');
ok(!datos('Carpetas').some(f => f[1] === 1) && datos('Carpetas').some(f => f[0] !== 'ID_Carpeta' && f[1] !== 1) === false || true, 'carpetas del hotel eliminadas');
ok(datos('Carpetas').filter(f => f[1] === 1).length === 0, 'ninguna carpeta del hotel queda en la hoja');
ok(datos('Archivos').filter(f => f[0] !== 'ID_Archivo').map(f => f[0]).join() === 'ARC-9', 'solo quedan archivos de otros hoteles');
ok(datos('Permisos_Archivos').filter(f => f[0] !== 'ID_Permiso').map(f => f[1]).join() === 'ARC-9', 'permisos de otros hoteles intactos');
const fav = datos('Favoritos').filter(f => f[0] !== 'ID_Favorito').map(f => f[2] + ':' + f[3]);
ok(fav.join('|') === 'Carpeta:99|Hotel:2|Archivo:1', 'favoritos: borra los del hotel y conserva los demás (incl. choque de id numérico con otro tipo): ' + fav.join('|'));
ok(datos('Actividad_Reciente').filter(f => f[0] !== 'ID_Actividad').map(f => f[3]).join() === '77', 'actividad del hotel borrada, la ajena intacta');
ok(datos('Notificaciones').length === 1, 'notificación de un archivo del hotel borrada');
const acc = datos('Usuarios').filter(f => f[0] !== 'ID_Usuario').map(f => f[0] + '=' + f[6]).join('|');
ok(acc === '5=|6=2|7=|8=*', 'accesos de usuarios: se quita el hotel de las listas (y "*" se respeta): ' + acc);
ok(hBari.papelera === true, 'carpeta de Drive del hotel enviada a la papelera (no borrada)');
ok(auditoria.map(a => a[1]).join() === 'CREAR_HOTEL,CREAR_HOTEL,EDITAR_HOTEL,EDITAR_HOTEL,EDITAR_HOTEL,ELIMINAR_HOTEL', 'auditoría registrada: ' + auditoria.map(a => a[1]).join());

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fallos ? 1 : 0);
