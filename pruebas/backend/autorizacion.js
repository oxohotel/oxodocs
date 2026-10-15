// Autorización por propiedad: una persona con sesión solo llega a lo de sus propiedades (backend/Acceso.js), tanto al actuar sobre una
// carpeta/archivo/propiedad como al buscar, ver favoritos y actividad, listar personas o importar archivos de Drive.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';

class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); }
  ancho() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); }
  pad(f) { const o = f.slice(); while (o.length < this.ancho()) o.push(''); return o; }
  getDataRange() { const s = this; return { getValues: () => s.filas.map(f => s.pad(f)) }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.ancho(); }
  appendRow(f) { this.filas.push(f.slice()); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    const asegurar = (fila, col) => { while (s.filas.length < fila) s.filas.push([]); while (s.filas[fila - 1].length < col) s.filas[fila - 1].push(''); };
    return {
      getValue() { return (s.filas[r - 1] || [])[c - 1]; },
      setValue(v) { asegurar(r, c); s.filas[r - 1][c - 1] = v; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(s.pad(s.filas[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; }
    };
  }
}

let reloj = 1000000;
const almacen = new Map();
const CacheServiceMock = { getScriptCache: () => ({
  get: k => { const e = almacen.get(k); return e && e.exp > reloj ? e.v : null; },
  getAll: ks => { const o = {}; ks.forEach(k => { const e = almacen.get(k); if (e && e.exp > reloj) o[k] = e.v; }); return o; },
  put: (k, v, ttl) => almacen.set(k, { v, exp: reloj + ttl * 1000 }),
  putAll: (o, ttl) => Object.keys(o).forEach(k => almacen.set(k, { v: o[k], exp: reloj + ttl * 1000 })),
  remove: k => almacen.delete(k)
}) };

const COLS = ['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'];
const U = (id, nombre, email, rol, hoteles, estado = 'Activo') => [id, nombre, email, 'hash' + id, rol, estado, '2026-01-01', hoteles];
const hojas = {
  Usuarios: new Hoja('Usuarios', [COLS,
    U(1, 'SA', 'sa@oxohotel.com', 3, ''), U(2, 'AdminDistrito', 'admin.distrito@oxohotel.com', 2, 'H1'), U(3, 'Admin84', 'admin.84@oxohotel.com', 2, 'H2'),
    U(4, 'AdminTodos', 'admin.todos@oxohotel.com', 2, 'TODOS'), U(5, 'NormalDistrito', 'normal@oxohotel.com', 1, 'H1'),
    U(6, 'SinHoteles', 'sin@oxohotel.com', 1, ''), U(7, 'Normal84', 'normal84@oxohotel.com', 1, 'H2'), U(8, 'DosHoteles', 'dos@oxohotel.com', 1, 'H1,H2')]),
  Roles: new Hoja('Roles', [['ID_Rol', 'Nombre_Rol']]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId'], ['H1', 'Distrito', 'M1', 'fa'], ['H2', '84DC', 'M1', 'fb']]),
  Carpetas: new Hoja('Carpetas', [['ID_Carpeta', 'ID_Hotel', 'x', 'Nombre_Carpeta', 'ID_Padre', 'DriveFolderId'],
    ['C1', 'H1', '', 'IT Distrito', '', 'd1'], ['C2', 'H2', '', 'IT 84DC', '', 'd2'], ['C3', 'H2', '', 'Subcarpeta 84DC', 'C2', 'd3']]),
  Archivos: new Hoja('Archivos', [['ID_Archivo', 'ID_Carpeta', 'DriveFileId', 'Nombre_Archivo', 'Extension', 'DriveUrl'],
    ['A1', 'C1', 'drive-A1', 'contrato-distrito.pdf', 'pdf', 'u1'], ['A2', 'C2', 'drive-A2', 'contrato-84dc.pdf', 'pdf', 'u2']]),
  Favoritos: new Hoja('Favoritos', [['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado'],
    [1, 8, 'Hotel', 'H1', new Date(2026, 0, 1)], [2, 8, 'Hotel', 'H2', new Date(2026, 0, 2)], [3, 5, 'Hotel', 'H2', new Date(2026, 0, 3)]]),
  Actividad_Reciente: new Hoja('Actividad_Reciente', [['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora'],
    ['ACT-1', 5, 'Carpeta', 'C1', 'Abrir', new Date(2026, 0, 1)], ['ACT-2', 5, 'Carpeta', 'C2', 'Abrir', new Date(2026, 0, 2)]]),
  Sesiones: new Hoja('Sesiones', [['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado']]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado']]),
  Permisos_Archivos: new Hoja('Permisos_Archivos', [['ID', 'ID_Archivo', 'ID_Usuario']])
};

// Archivos de Drive de mentira para las pruebas de importación
const persona = correo => ({ getEmail: () => correo });
const archivoDrive = (id, acceso, duenio, lectores) => ({ getId: () => id, getSharingAccess: () => acceso, getOwner: () => persona(duenio), getViewers: () => (lectores || []).map(persona), getEditors: () => [], isTrashed: () => false });
const Access = { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' };

const sandbox = {
  console, Logger: { log: () => {} }, Date, Math, JSON, Set,
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) },
  CacheService: CacheServiceMock,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-14', getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'h' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), computeDigest: () => [1, 2, 3], DigestAlgorithm: { SHA_256: 'x' } },
  ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  DriveApp: { Access, getFileById: id => (sandbox.__archivosDrive[id] || (() => { throw new Error('no existe'); })()) },
  __archivosDrive: {}
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'Metricas.js', 'Acceso.js', 'Roles.js', 'Usuario.js', 'Recursos.js', 'Favoritos.js', 'Actividad.js', 'Busqueda.js', 'Permisos.js', 'Archivos.js', 'Auth.js']
  .forEach(f => vm.runInContext(fs.readFileSync(REPO + 'backend/' + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(REPO + 'Code.js', 'utf8'), sandbox, { filename: 'Code.js' });
vm.runInContext(`
  var __llamadas = [];
  ['obtenerContenidoCarpeta','obtenerRutaCarpeta','crearSubcarpeta','renombrarCarpeta','eliminarCarpeta','guardarArchivoEnDrive','guardarArchivosMultiplesDesdeDrive','renombrarArchivo','actualizarPermisosExistentes','eliminarArchivo','crearArea','editarHotel','eliminarHotel'].forEach(function (n) {
    this[n] = function () { __llamadas.push(n); return { success: true, ejecutada: n }; };
  }, this);
  this.F = { usuarioEsAdministrador_, crearSesionUsuario_, buscarGlobal, obtenerFavoritosDetallados, obtenerActividadReciente, obtenerListaUsuariosParaPermisos, obtenerArchivoPorIdOUrl, usuarioPuedeUsarArchivoDrive_, alcanceDeHoteles_ };
`, sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_memoCache_={};_spreadsheetEjecucion_=null;_cacheIndiceHojas_={}', sandbox);
const llamar = p => { nuevaEjecucion(); vm.runInContext('__llamadas.length = 0', sandbox); sandbox.__e = { postData: { contents: JSON.stringify(p) } }; return JSON.parse(vm.runInContext('doPost(__e)', sandbox).texto); };
const ejecutada = () => vm.runInContext('__llamadas.length', sandbox) > 0;
const sesion = id => { const u = hojas.Usuarios.filas.find(f => String(f[0]) === String(id)); return F.crearSesionUsuario_({ ID_Usuario: id, Nombre_Completo: u[1], Email: u[2], ID_Rol: u[4], Rol: 'x' }); };
const T = {}; [1, 2, 3, 4, 5, 6, 7, 8].forEach(i => { T[i] = sesion(i); });

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const negada = (r) => r.success === true && r.data && r.data.success === false && /No tienes acceso a esa propiedad|no pertenece/.test(r.data.message);

// ---------- 1. Acciones sobre una carpeta, archivo o propiedad
const sobreCarpeta = ['obtenerContenidoCarpeta', 'obtenerRutaCarpeta', 'crearSubcarpeta', 'renombrarCarpeta', 'eliminarCarpeta', 'guardarArchivoEnDrive', 'guardarArchivosMultiplesDesdeDrive'];
sobreCarpeta.forEach(a => {
  const ajena = llamar({ action: a, args: ['C2', 'x'], token: T[5] });          // persona de Distrito (H1) sobre una carpeta de 84DC (H2)
  ok(negada(ajena) && !ejecutada(), '1. ' + a + ': una persona de Distrito NO puede actuar sobre una carpeta de 84DC y la función ni se ejecuta');
  const propia = llamar({ action: a, args: ['C1', 'x'], token: T[5] });
  ok(propia.success === true && propia.data.ejecutada === a, '1. ' + a + ': sobre una carpeta de su propiedad sí se ejecuta');
});
ok(negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C3', '5'], token: T[5] })), '1b. también las subcarpetas anidadas de otra propiedad (C3 hereda de 84DC)');
ok(!negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C3', '5'], token: T[7] })), '1c. y quien sí es de 84DC entra');
ok(negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C1', '5'], token: T[6] })), '1d. una cuenta sin propiedades no entra a ninguna carpeta');
ok(!negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C1'], token: T[1] })) && !negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C2'], token: T[1] })), '1e. el superadministrador entra a todas');
ok(!negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C2'], token: T[4] })), '1f. un administrador con TODOS también');
ok(!negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C1'], token: T[8] })) && !negada(llamar({ action: 'obtenerContenidoCarpeta', args: ['C2'], token: T[8] })), '1g. con dos propiedades entra a las dos');
const noExiste = llamar({ action: 'obtenerContenidoCarpeta', args: ['C99'], token: T[5] });
ok(noExiste.success === true && noExiste.data.ejecutada === 'obtenerContenidoCarpeta', '1h. una carpeta inexistente no se rechaza aquí (la función responde "no encontrada")');

['renombrarArchivo', 'actualizarPermisosExistentes'].forEach(a => {
  ok(negada(llamar({ action: a, args: ['A2', 'x'], token: T[5] })) && !ejecutada(), '2. ' + a + ': no se puede sobre un archivo de otra propiedad');
  ok(llamar({ action: a, args: ['A1', 'x'], token: T[5] }).data.ejecutada === a, '2. ' + a + ': sí sobre uno propio');
});
ok(negada(llamar({ action: 'eliminarArchivo', args: ['drive-A2'], token: T[5] })) && !ejecutada(), '2b. eliminarArchivo: no se borra un archivo de otra propiedad');
ok(llamar({ action: 'eliminarArchivo', args: ['drive-A1'], token: T[5] }).data.ejecutada === 'eliminarArchivo', '2c. eliminarArchivo: sí uno propio');
const huerfano = llamar({ action: 'eliminarArchivo', args: ['id-de-un-archivo-cualquiera-de-drive'], token: T[4] });
ok(negada(huerfano) && !ejecutada(), '2d. eliminarArchivo solo actúa sobre archivos registrados en el repositorio (ni un administrador con TODOS puede mandar a la papelera un archivo cualquiera de Drive)');

['crearArea', 'editarHotel', 'eliminarHotel'].forEach(a => {
  ok(negada(llamar({ action: a, args: ['H2', 'x'], token: T[2] })) && !ejecutada(), '3. ' + a + ': el administrador de Distrito no puede tocar la propiedad 84DC');
  ok(llamar({ action: a, args: ['H1', 'x'], token: T[2] }).data.ejecutada === a, '3. ' + a + ': sí la suya');
});

// ---------- 2. Lecturas filtradas por propiedad
nuevaEjecucion();
const busq = F.buscarGlobal('d', '5');                 // "d" aparece en Distrito, 84DC, IT Distrito, IT 84DC...
ok(busq.hoteles.map(h => h.idHotel).join() === 'H1' && busq.carpetas.every(c => c.idHotel === 'H1') && busq.carpetas.length === 1, '4. buscarGlobal: una persona de Distrito solo encuentra lo de Distrito → ' + JSON.stringify(busq).slice(0, 140));
nuevaEjecucion();
const busqTodo = F.buscarGlobal('d', '1');
ok(busqTodo.hoteles.length === 2 && busqTodo.carpetas.length >= 2, '4b. el superadministrador encuentra todo');
nuevaEjecucion();
ok(F.buscarGlobal('d', '6').hoteles.length === 0 && F.buscarGlobal('d', '6').carpetas.length === 0, '4c. una cuenta sin propiedades no encuentra nada');
const viaWeb = llamar({ action: 'buscarGlobal', args: ['d', '1'], token: T[5] });   // intenta pasar el id del superadmin
ok(viaWeb.data.hoteles.length === 1, '4d. por la vía web el id que mande el navegador se ignora (sigue viendo solo Distrito)');

nuevaEjecucion();
const fav = F.obtenerFavoritosDetallados('8');
ok(fav.favoritos.length === 2, '5. favoritos: con dos propiedades ve los dos');
hojas.Usuarios.filas[8][7] = 'H1'; almacen.clear(); nuevaEjecucion();
const favRestante = F.obtenerFavoritosDetallados('8');
ok(favRestante.favoritos.length === 1 && favRestante.favoritos[0].idHotel === 'H1', '5b. al quitarle una propiedad, su favorito de esa propiedad deja de mostrarse');
hojas.Usuarios.filas[8][7] = 'H1,H2'; almacen.clear();
nuevaEjecucion();
const act = F.obtenerActividadReciente('5', 15);
ok(act.actividad.length === 1 && act.actividad[0].idHotel === 'H1', '5c. la actividad reciente de una propiedad que no es suya no aparece (aunque la haya registrado alguien por error)');

nuevaEjecucion();
const personas = F.obtenerListaUsuariosParaPermisos('5');
const idsP = personas.usuarios.map(u => u.id).sort().join();
ok(idsP === '1,2,4,5,8', '6. lista para restringir archivos: una persona de Distrito ve a quienes comparten Distrito, a los administradores con TODOS y al superadmin, no a los de otras propiedades (' + idsP + ')');
nuevaEjecucion();
ok(F.obtenerListaUsuariosParaPermisos('1').usuarios.length === 8, '6b. el superadministrador ve a todos los activos');

// ---------- 3. Archivos de Drive: solo los que la persona ya puede abrir
const ARCH = (id, acceso, duenio, lectores) => { sandbox.__archivosDrive[id] = archivoDrive(id, acceso, duenio, lectores); return sandbox.__archivosDrive[id]; };
nuevaEjecucion();
ok(F.usuarioPuedeUsarArchivoDrive_(ARCH('x1', 'PRIVATE', 'otro@oxohotel.com', []), '5') === false, '7. un archivo privado de otra persona NO se puede importar ni consultar');
ok(F.usuarioPuedeUsarArchivoDrive_(ARCH('x2', 'PRIVATE', 'normal@oxohotel.com', []), '5') === true, '7b. uno propio, sí');
ok(F.usuarioPuedeUsarArchivoDrive_(ARCH('x3', 'PRIVATE', 'otro@oxohotel.com', ['normal@oxohotel.com']), '5') === true, '7c. uno compartido con ella, sí');
ok(F.usuarioPuedeUsarArchivoDrive_(ARCH('x4', 'DOMAIN_WITH_LINK', 'otro@oxohotel.com', []), '5') === true && F.usuarioPuedeUsarArchivoDrive_(ARCH('x5', 'ANYONE_WITH_LINK', 'otro@oxohotel.com', []), '5') === true, '7d. uno compartido con el dominio o con cualquiera que tenga el enlace, sí');
ok(F.usuarioPuedeUsarArchivoDrive_(ARCH('drive-A2', 'PRIVATE', 'duenio@oxohotel.com', []), '5') === false && F.usuarioPuedeUsarArchivoDrive_(ARCH('drive-A1', 'PRIVATE', 'duenio@oxohotel.com', []), '5') === true, '7e. un archivo ya del repositorio se rige por su propiedad, no por el uso compartido de Drive');
const consulta = F.obtenerArchivoPorIdOUrl('x1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', '5');
ok(consulta.success === false, '7f. obtenerArchivoPorIdOUrl no revela datos de un archivo ajeno (' + consulta.message + ')');
ARCH('y1abcdefghijklmnopqrstuvwxyz1234', 'PRIVATE', 'otro@oxohotel.com', []);
const consultaFalsa = llamar({ action: 'obtenerArchivoPorIdOUrl', args: ['y1abcdefghijklmnopqrstuvwxyz1234', '1'], token: T[5] });
ok(consultaFalsa.data.success === false, '7g. por la vía web, mandar el id del superadmin tampoco abre el archivo ajeno');

// ---------- 4. Eliminar carpetas y archivos: solo rol 2 y 3
nuevaEjecucion();
const esAdm = id => { nuevaEjecucion(); return F.usuarioEsAdministrador_(String(id)); };
ok([1, 2, 3, 4].every(esAdm), '9. superadministrador y administradores (incluido el de una sola propiedad) pueden eliminar carpetas y archivos');
ok([5, 6, 7, 8].every(id => !esAdm(id)), '9b. los usuarios (rol 1) no pueden, tengan las propiedades que tengan');
ok(!F.usuarioEsAdministrador_('999') && !F.usuarioEsAdministrador_(''), '9c. una cuenta inexistente o vacía tampoco');

ok(Object.keys(vm.runInContext('OBJETIVOS_DE_ACCESO_', sandbox)).every(a => vm.runInContext('ACCIONES_PERMITIDAS_', sandbox).includes(a)), '8. todas las acciones declaradas en OBJETIVOS_DE_ACCESO_ existen en la lista de permitidas');
console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
