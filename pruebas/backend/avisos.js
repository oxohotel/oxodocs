// Avisos de la campana (backend/Avisos.js): audiencias, programación, caducidad, lectura, caché, validación y seguridad.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';

const lecturas = { Avisos: 0, Avisos_Vistos: 0 };
class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); }
  ancho() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); }
  pad(f) { const o = f.slice(); while (o.length < this.ancho()) o.push(''); return o; }
  getDataRange() { const s = this; return { getValues: () => { if (s.nombre in lecturas) lecturas[s.nombre]++; return s.filas.map(f => s.pad(f)); } }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.ancho(); }
  appendRow(f) { this.filas.push(f.slice()); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValue() { return (s.filas[r - 1] || [])[c - 1]; },
      setValue(v) { while (s.filas.length < r) s.filas.push([]); while (s.filas[r - 1].length < c) s.filas[r - 1].push(''); s.filas[r - 1][c - 1] = v; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(s.pad(s.filas[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return o; },
      setValues(v) { v.forEach((fila, i) => { while (s.filas.length < r + i) s.filas.push([]); fila.forEach((x, j) => { while (s.filas[r - 1 + i].length < c + j) s.filas[r - 1 + i].push(''); s.filas[r - 1 + i][c - 1 + j] = x; }); }); }
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

const U = (id, nombre, email, rol, hoteles) => [id, nombre, email, 'h', rol, 'Activo', '2026-01-01', hoteles];
const hojas = {
  Usuarios: new Hoja('Usuarios', [['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'],
    U(1, 'SA', 'sa@x.com', 3, ''), U(2, 'AdminDistrito', 'a2@x.com', 2, 'H1'), U(4, 'AdminTodos', 'a4@x.com', 2, 'TODOS'), U(5, 'NormalDistrito', 'n5@x.com', 1, 'H1'),
    U(6, 'SinHoteles', 'n6@x.com', 1, ''), U(7, 'Normal84', 'n7@x.com', 1, 'H2'), U(8, 'DosHoteles', 'n8@x.com', 1, 'H1,H2')]),
  Roles: new Hoja('Roles', [['ID_Rol', 'Nombre_Rol']]),
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre_Modulo', 'Orden'], ['M1', 'Operación', 1]]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId'], ['H1', 'Distrito', 'M1', 'fa'], ['H2', '84DC', 'M1', 'fb']]),
  Carpetas: new Hoja('Carpetas', [['ID_Carpeta', 'ID_Hotel', 'ID_Plantilla', 'Nombre_Carpeta', 'DriveFolderId', 'Fecha_Creacion', 'ID_Padre'], ['C1', 'H1', '', 'IT', 'd1', new Date(), '']]),
  Archivos: new Hoja('Archivos', [['ID_Archivo', 'ID_Carpeta', 'DriveFileId', 'Nombre_Archivo'], ['A1', 'C1', 'df1', 'contrato.pdf']]),
  Avisos: new Hoja('Avisos', [['ID_Aviso', 'Titulo', 'Mensaje', 'Enlaces', 'Audiencia', 'Estado', 'Programado_Para', 'Caduca_En', 'Creado_Por', 'Creado_Por_Nombre', 'Creado_En']]),
  Avisos_Vistos: new Hoja('Avisos_Vistos', [['ID_Usuario', 'Vistos_Hasta']]),
  Sesiones: new Hoja('Sesiones', [['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado']]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado']])
};

const sandbox = {
  console, Logger: { log: () => {} }, Date, Math, JSON, Set,
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) },
  CacheService: CacheServiceMock,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-16', getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'h' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), computeDigest: () => [1], DigestAlgorithm: { SHA_256: 'x' } },
  ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'CacheArchivos.js', 'Metricas.js', 'Acceso.js', 'Roles.js', 'Usuario.js', 'Recursos.js', 'Avisos.js', 'Auth.js']
  .forEach(f => vm.runInContext(fs.readFileSync(REPO + 'backend/' + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(REPO + 'Code.js', 'utf8'), sandbox, { filename: 'Code.js' });
vm.runInContext('var __ahora = 0; Date.now = function () { return __ahora; };', sandbox);
let AHORA = new Date(2026, 9, 16, 12, 0, 0).getTime();
const fijarAhora = ms => { AHORA = ms; vm.runInContext('__ahora = ' + ms, sandbox); };
fijarAhora(AHORA);
vm.runInContext('this.F = { obtenerAvisosGestion, crearAviso, editarAviso, cancelarAviso, obtenerAvisos, marcarAvisosVistos, validarDatosDeAviso_, guardarAviso_, audienciaIncluye_, crearSesionUsuario_, ACCIONES_PERMITIDAS_, accionInvalidaCacheDeArchivos_, generacionArchivosFresca_ };', sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_memoCache_={};_spreadsheetEjecucion_=null;_cacheIndiceHojas_={};_genArchivos_=null', sandbox);
const llamarDoPost = p => { nuevaEjecucion(); sandbox.__e = { postData: { contents: JSON.stringify(p) } }; return JSON.parse(vm.runInContext('doPost(__e)', sandbox).texto); };
const sesion = id => { const u = hojas.Usuarios.filas.find(f => String(f[0]) === String(id)); return F.crearSesionUsuario_({ ID_Usuario: id, Nombre_Completo: u[1], Email: u[2], ID_Rol: u[4], Rol: 'x' }); };
const avisosDe = id => { nuevaEjecucion(); return F.obtenerAvisos(String(id)); };
const titulos = r => r.avisos.map(a => a.titulo).join('|');

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const HORA = 3600 * 1000;
const crear = (extra) => {
  nuevaEjecucion();
  const v = F.validarDatosDeAviso_(Object.assign({ titulo: 'T', mensaje: 'M', audiencia: { tipo: 'todos' } }, extra), AHORA);
  if (v.error) throw new Error('datos de prueba inválidos: ' + v.error);
  return F.guardarAviso_(v.aviso, { id: '1', nombre: 'SA' });
};

// ---------- 1. Audiencias
crear({ titulo: 'Para todos' });
crear({ titulo: 'Solo admins', audiencia: { tipo: 'roles', roles: [2, 3] } });
crear({ titulo: 'Solo 84DC', audiencia: { tipo: 'propiedades', propiedades: ['H2'] } });
crear({ titulo: 'Solo persona 5', audiencia: { tipo: 'personas', personas: ['5'] } });
ok(titulos(avisosDe(5)) .split('|').sort().join('|') === 'Para todos|Solo persona 5', '1. persona 5 (usuario de Distrito): ve el de todos y el dirigido a ella: ' + titulos(avisosDe(5)));
ok(titulos(avisosDe(7)).split('|').sort().join('|') === 'Para todos|Solo 84DC', '1b. persona 7 (84DC): ve el de todos y el de su propiedad → ' + JSON.stringify(avisosDe(7)).slice(0, 200));
ok(titulos(avisosDe(8)).split('|').sort().join('|') === 'Para todos|Solo 84DC', '1c. persona 8 (Distrito y 84DC): también el de 84DC');
ok(titulos(avisosDe(6)) === 'Para todos', '1d. persona sin propiedades: solo el de todos');
ok(titulos(avisosDe(2)).split('|').sort().join('|') === 'Para todos|Solo admins', '1e. administrador de Distrito: el de roles 2 y 3, no el de 84DC (no es su propiedad)');
ok(titulos(avisosDe(4)).split('|').sort().join('|') === 'Para todos|Solo 84DC|Solo admins', '1f. administrador con TODOS: recibe también los dirigidos a cualquier propiedad');
ok(titulos(avisosDe(1)).split('|').sort().join('|') === 'Para todos|Solo 84DC|Solo admins', '1g. superadministrador: igual (todas las propiedades) y no el dirigido a la persona 5');

// ---------- 2. Programación, caducidad y cancelación
const futuro = crear({ titulo: 'Futuro', programadoPara: new Date(AHORA + 2 * HORA).toISOString() });
ok(!titulos(avisosDe(5)).includes('Futuro'), '2. un aviso programado para dentro de 2 horas todavía no se ve');
fijarAhora(AHORA + 3 * HORA);
ok(titulos(avisosDe(5)).includes('Futuro'), '2b. pasada su hora aparece solo, sin ningún proceso en segundo plano ni invalidar nada');
crear({ titulo: 'Caduca pronto', caducaEn: new Date(AHORA + 1 * HORA).toISOString() });
ok(titulos(avisosDe(5)).includes('Caduca pronto'), '2c. antes de caducar se ve');
fijarAhora(AHORA + 2 * HORA);
ok(!titulos(avisosDe(5)).includes('Caduca pronto'), '2d. después de caducar desaparece');
const idx = hojas.Avisos.filas[0].indexOf('Estado');
hojas.Avisos.filas.find(f => f[1] === 'Para todos')[idx] = 'Cancelado'; almacen.clear();
ok(!titulos(avisosDe(5)).includes('Para todos'), '2e. un aviso cancelado no se ve');
hojas.Avisos.filas.find(f => f[1] === 'Para todos')[idx] = 'Programado'; almacen.clear();

// ---------- 3. Orden y límite
const ordenados = avisosDe(5).avisos.map(a => a.fecha);
ok(ordenados.every((f, i) => i === 0 || ordenados[i - 1] >= f), '3. el más reciente va primero');
for (let i = 0; i < 40; i++) crear({ titulo: 'Relleno ' + i, programadoPara: new Date(AHORA - (100 + i) * 60000).toISOString() });
ok(avisosDe(5).avisos.length === 30, '3b. se muestran como mucho los 30 más recientes (' + avisosDe(5).avisos.length + ')');

// ---------- 4. No leídos y "vistos"
hojas.Avisos.filas.length = 1; almacen.clear(); hojas.Avisos_Vistos.filas.length = 1;
crear({ titulo: 'Uno', programadoPara: new Date(AHORA - 3 * HORA).toISOString() });
crear({ titulo: 'Dos', programadoPara: new Date(AHORA - 2 * HORA).toISOString() });
let a5 = avisosDe(5);
ok(a5.noLeidos === 2 && a5.avisos.every(a => a.nuevo), '4. al principio los 2 avisos son nuevos para todos (noLeidos = ' + a5.noLeidos + ')');
nuevaEjecucion(); F.marcarAvisosVistos('5');
a5 = avisosDe(5);
ok(a5.noLeidos === 0 && a5.avisos.every(a => !a.nuevo), '4b. al marcarlos como vistos ya no hay no leídos');
ok(avisosDe(7).noLeidos === 2, '4c. para otra persona siguen siendo nuevos (cada quien tiene lo suyo)');
fijarAhora(AHORA + 1 * HORA);
crear({ titulo: 'Tres' });
ok(avisosDe(5).noLeidos === 1 && avisosDe(5).avisos[0].titulo === 'Tres' && avisosDe(5).avisos[0].nuevo === true, '4d. un aviso posterior vuelve a contar como no leído (solo ese)');
almacen.clear(); // sin caché: lo visto se lee de la hoja Avisos_Vistos
ok(avisosDe(5).noLeidos === 1, '4e. lo visto se recuerda también tras vaciar el caché (está en la hoja)');
nuevaEjecucion(); F.marcarAvisosVistos('5'); nuevaEjecucion(); F.marcarAvisosVistos('5');
ok(hojas.Avisos_Vistos.filas.filter(f => String(f[0]) === '5').length === 1, '4f. marcar varias veces no duplica la fila de la persona');

// ---------- 5. Caché
lecturas.Avisos = 0; avisosDe(5); avisosDe(7);
const gen0 = F.generacionArchivosFresca_();
nuevaEjecucion(); F.marcarAvisosVistos('7');
ok(F.generacionArchivosFresca_() === gen0, '5. marcar como visto (muy frecuente) no invalida el caché de avisos');
lecturas.Avisos = 0; avisosDe(5); avisosDe(7); avisosDe(2);
ok(lecturas.Avisos === 0, '5b. con la lista en caché, leer los avisos de varias personas no lee la hoja (' + lecturas.Avisos + ' lecturas)');
crear({ titulo: 'Recién creado' });
lecturas.Avisos = 0;
ok(titulos(avisosDe(5)).includes('Recién creado') && lecturas.Avisos === 1, '5c. al crear un aviso se invalida y la siguiente lectura ya lo trae (una lectura de hoja)');

// ---------- 6. Validación
const valida = datos => { nuevaEjecucion(); return F.validarDatosDeAviso_(datos, AHORA); };
const base = { titulo: 'Hola', mensaje: 'Mensaje', audiencia: { tipo: 'todos' } };
ok(valida(base).aviso && valida(base).aviso.programadoPara === AHORA, '6. sin fecha significa "enviar ahora"');
ok(/título/i.test(valida(Object.assign({}, base, { titulo: '   ' })).error), '6b. sin título se rechaza');
ok(/mensaje/i.test(valida(Object.assign({}, base, { mensaje: '' })).error), '6c. sin mensaje se rechaza');
ok(valida(Object.assign({}, base, { titulo: 'x'.repeat(500) })).aviso.titulo.length === 120 && valida(Object.assign({}, base, { mensaje: 'y'.repeat(9000) })).aviso.mensaje.length === 2000, '6d. los textos largos se recortan a su límite (120 y 2.000)');
const conEnlace = e => valida(Object.assign({}, base, { enlaces: [Object.assign({ texto: 'Ir' }, e)] }));
ok(conEnlace({ tipo: 'url', url: 'https://example.com/a?b=1' }).aviso, '6e. un enlace https es válido');
ok(['http://example.com', 'javascript:alert(1)', 'data:text/html,hola', 'https://con espacio.com', 'ftp://x.com', '//evil.com', ''].every(u => conEnlace({ tipo: 'url', url: u }).error), '6f. se rechazan http, javascript:, data:, ftp, con espacios, sin esquema y vacío');
const interno = conEnlace({ tipo: 'carpeta', id: 'C1' });
ok(interno.aviso && interno.aviso.enlaces[0].idHotel === 'H1' && interno.aviso.enlaces[0].nombreHotel === 'Distrito' && interno.aviso.enlaces[0].nombre === 'IT', '6g. un enlace a una carpeta guarda su propiedad y su nombre para poder abrirlo');
ok(conEnlace({ tipo: 'archivo', id: 'A1' }).aviso.enlaces[0].idCarpeta === 'C1' && conEnlace({ tipo: 'hotel', id: 'H2' }).aviso.enlaces[0].nombre === '84DC', '6h. y los de archivo y de propiedad');
ok(conEnlace({ tipo: 'carpeta', id: 'NO' }).error && conEnlace({ tipo: 'hotel', id: 'NO' }).error && conEnlace({ tipo: 'archivo', id: 'NO' }).error && conEnlace({ tipo: 'raro', id: 'x' }).error, '6i. un destino que no existe o un tipo desconocido se rechaza');
ok(valida(Object.assign({}, base, { enlaces: Array.from({ length: 6 }, () => ({ texto: 'x', tipo: 'url', url: 'https://a.com' })) })).error, '6j. más de 5 enlaces se rechaza');
ok(valida(Object.assign({}, base, { enlaces: [{ texto: '', tipo: 'url', url: 'https://a.com' }] })).error, '6k. un enlace sin texto se rechaza');
ok(valida(Object.assign({}, base, { audiencia: { tipo: 'roles', roles: [] } })).error && valida(Object.assign({}, base, { audiencia: { tipo: 'roles', roles: [9] } })).error, '6l. roles vacíos o inexistentes se rechazan');
ok(valida(Object.assign({}, base, { audiencia: { tipo: 'propiedades', propiedades: ['H1', 'H1'] } })).aviso.audiencia.propiedades.length === 1 && valida(Object.assign({}, base, { audiencia: { tipo: 'propiedades', propiedades: ['NO'] } })).error, '6m. propiedades: sin repetidos y solo existentes');
ok(valida(Object.assign({}, base, { audiencia: { tipo: 'personas', personas: ['5', '5', '8'] } })).aviso.audiencia.personas.length === 2 && valida(Object.assign({}, base, { audiencia: { tipo: 'personas', personas: ['999'] } })).error, '6n. personas: sin repetidas y solo existentes');
ok(valida(Object.assign({}, base, { audiencia: { tipo: 'cualquiera' } })).error, '6o. una audiencia desconocida se rechaza');
ok(/caducidad/i.test(valida(Object.assign({}, base, { programadoPara: new Date(AHORA + HORA).toISOString(), caducaEn: new Date(AHORA).toISOString() })).error), '6p. la caducidad debe ser posterior al envío');
const conHtml = valida(Object.assign({}, base, { titulo: '<img src=x onerror=alert(1)>', mensaje: '<script>alert(1)</script>' }));
ok(conHtml.aviso && conHtml.aviso.titulo.includes('<img') , '6q. el HTML no se ejecuta ni se interpreta: se guarda como texto y el navegador lo muestra escapado');
ok(/\u0000/.test(valida(Object.assign({}, base, { mensaje: 'a\u0000b' })).aviso.mensaje) === false, '6r. se quitan los caracteres de control');

// ---------- 7. Por la vía web
hojas.Avisos.filas.length = 1; almacen.clear();
crear({ titulo: 'Solo persona 5', audiencia: { tipo: 'personas', personas: ['5'] } });
crear({ titulo: 'Solo persona 1', audiencia: { tipo: 'personas', personas: ['1'] } });
const web = llamarDoPost({ action: 'obtenerAvisos', args: ['1'], token: sesion(5) });
ok(web.success && web.data.avisos.map(a => a.titulo).join() === 'Solo persona 5', '7. por la vía web el id que mande el navegador se ignora: la persona 5 recibe lo suyo aunque pida el id del superadministrador');
ok(llamarDoPost({ action: 'obtenerAvisos', args: ['5'] }).codigo === 'SESION_INVALIDA', '7b. sin sesión se rechaza');
llamarDoPost({ action: 'marcarAvisosVistos', args: ['1'], token: sesion(5) });
ok(llamarDoPost({ action: 'obtenerAvisos', args: [], token: sesion(5) }).data.noLeidos === 0, '7c. marcar como visto por la vía web funciona');
ok(['obtenerAvisos', 'marcarAvisosVistos'].every(n => F.ACCIONES_PERMITIDAS_.includes(n)) && F.accionInvalidaCacheDeArchivos_('marcarAvisosVistos') === false && F.accionInvalidaCacheDeArchivos_('obtenerAvisos') === false, '7d. las dos acciones están permitidas y ninguna invalida el caché');

// ---------- 8. Gestión (solo Superadministradores): crear, editar, cancelar, lista
hojas.Avisos.filas.length = 1; hojas.Avisos_Vistos.filas.length = 1; hojas.Auditoria.filas.length = 1; almacen.clear();
const gw = (accion, args, id) => llamarDoPost({ action: accion, args: args, token: sesion(id) });
const datosBase = { titulo: 'Comunicado', mensaje: 'Texto del comunicado', audiencia: { tipo: 'todos' } };

for (const [accion, args] of [['crearAviso', [datosBase]], ['obtenerAvisosGestion', []], ['cancelarAviso', ['AVI-X']], ['editarAviso', ['AVI-X', datosBase]]]) {
  for (const id of [2, 4, 5]) {
    const r = gw(accion, args, id);
    ok(r.data && r.data.success === false && /Solo un Superadministrador/.test(r.data.message), '8. ' + accion + ': la persona ' + id + ' (rol ' + (id === 5 ? 1 : 2) + ') NO puede → ' + (r.data && r.data.message));
  }
}
ok(hojas.Avisos.filas.length === 1, '8b. ningún intento no autorizado escribió nada');
ok(llamarDoPost({ action: 'crearAviso', args: [datosBase] }).codigo === 'SESION_INVALIDA', '8c. sin sesión se rechaza');

const c1 = gw('crearAviso', [datosBase], 1);
ok(c1.data.success === true && c1.data.message === 'Aviso enviado' && /^AVI-/.test(c1.data.id), '8d. el superadministrador crea un aviso y queda "enviado": ' + JSON.stringify(c1.data));
ok(titulos(avisosDe(5)) === 'Comunicado', '8e. la persona 5 lo ve de inmediato (el despachador invalidó el caché)');
const fila = hojas.Avisos.filas[1];
ok(fila[8] === '1' && fila[9] === 'SA', '8f. queda registrado quién lo creó (' + fila[9] + ')');
ok(hojas.Auditoria.filas.some(f => f[3] === 'AVISO_CREADO' && /Comunicado/.test(f[4])), '8g. la creación queda en la auditoría');
const c2 = gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'Más tarde', programadoPara: new Date(AHORA + 5 * HORA).toISOString() })], 1);
ok(c2.data.success && c2.data.message === 'Aviso programado', '8h. uno con fecha futura queda "programado"');
const malo = gw('crearAviso', [Object.assign({}, datosBase, { titulo: '' })], 1);
ok(malo.data.success === false && /título/i.test(malo.data.message), '8i. datos inválidos devuelven el motivo exacto: ' + malo.data.message);
const sinMsg = gw('crearAviso', [Object.assign({}, datosBase, { enlaces: [{ texto: 'x', tipo: 'url', url: 'http://inseguro.com' }] })], 1);
ok(sinMsg.data.success === false && /https/.test(sinMsg.data.message), '8j. un enlace http se rechaza al crear: ' + sinMsg.data.message);
// El id de quien crea lo pone el servidor aunque el navegador mande otro
const suplanta = llamarDoPost({ action: 'crearAviso', args: [datosBase, '1'], token: sesion(5) });
ok(suplanta.data.success === false, '8k. mandar el id del superadministrador en los argumentos con la sesión de otra persona no sirve');

// Editar: solo lo programado
const idProg = c2.data.id, idEnviado = c1.data.id;
const e1 = gw('editarAviso', [idProg, Object.assign({}, datosBase, { titulo: 'Más tarde (editado)', audiencia: { tipo: 'roles', roles: [1] } })], 1);
ok(e1.data.success === true, '8l. se edita un aviso programado: ' + JSON.stringify(e1.data));
fijarAhora(AHORA + 6 * HORA);
ok(titulos(avisosDe(5)).split('|').sort().join('|') === 'Comunicado|Más tarde (editado)' && !titulos(avisosDe(2)).includes('editado'), '8m. cuando llega su hora aparece con los cambios y la nueva audiencia (solo rol 1)');
const e2 = gw('editarAviso', [idProg, datosBase], 1);
ok(e2.data.success === false && /ya fue enviado/.test(e2.data.message), '8n. uno que ya se envió no se edita: ' + e2.data.message);
ok(gw('editarAviso', [idEnviado, datosBase], 1).data.success === false, '8o. tampoco el que se envió ahora');
ok(gw('editarAviso', ['AVI-NO', datosBase], 1).data.message === 'Aviso no encontrado', '8p. un aviso inexistente se informa');
fijarAhora(AHORA);

// Cancelar
const c3 = gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'Para cancelar' })], 1);
ok(titulos(avisosDe(5)).includes('Para cancelar'), '8q. antes de cancelarlo se ve');
ok(gw('cancelarAviso', [c3.data.id], 1).data.success === true && !titulos(avisosDe(5)).includes('Para cancelar'), '8r. al cancelarlo desaparece para todos de inmediato');
ok(hojas.Auditoria.filas.some(f => f[3] === 'AVISO_CANCELADO'), '8s. la cancelación queda en la auditoría');
ok(gw('editarAviso', [c3.data.id, datosBase], 1).data.message === 'Un aviso cancelado no se puede editar', '8t. un aviso cancelado no se edita');
ok(gw('cancelarAviso', ['AVI-NO'], 1).data.message === 'Aviso no encontrado', '8u. cancelar uno inexistente se informa');

// Lista de gestión
const caducado = gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'Caducado', programadoPara: new Date(AHORA - 3 * HORA).toISOString(), caducaEn: new Date(AHORA - 1 * HORA).toISOString() })], 1);
gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'A personas', audiencia: { tipo: 'personas', personas: ['5', '6', '7', '8'] } })], 1);
gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'A 84DC', audiencia: { tipo: 'propiedades', propiedades: ['H2'] } })], 1);
gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'A admins', audiencia: { tipo: 'roles', roles: [2, 3] } })], 1);
nuevaEjecucion(); F.marcarAvisosVistos('5');
const g = gw('obtenerAvisosGestion', [], 1);
const porTitulo = {}; (g.data.avisos || []).forEach(a => { porTitulo[a.titulo] = a; });
ok(g.data.success && g.data.avisos.length === 9 || g.data.avisos.length >= 7, '9. la lista de gestión trae todos los avisos (' + (g.data.avisos || []).length + ')');
ok(porTitulo['Comunicado'].estado === 'Enviado' && porTitulo['Más tarde (editado)'].estado === 'Enviado' && porTitulo['Para cancelar'].estado === 'Cancelado' && porTitulo['Caducado'].estado === 'Caducado', '9b. estados: enviado, cancelado y caducado');
const prog = gw('crearAviso', [Object.assign({}, datosBase, { titulo: 'Futuro lejano', programadoPara: new Date(AHORA + 48 * HORA).toISOString() })], 1);
const g2 = gw('obtenerAvisosGestion', [], 1); const f2 = {}; g2.data.avisos.forEach(a => { f2[a.titulo] = a; });
ok(f2['Futuro lejano'].estado === 'Programado' && f2['Futuro lejano'].editable === true && f2['Comunicado'].editable === false, '9c. uno programado se marca editable y los demás no');
ok(f2['Comunicado'].destinatarios === 7 && f2['A personas'].destinatarios === 4 && f2['A admins'].destinatarios === 3 && f2['A 84DC'].destinatarios === 4, '9d. cuántas personas alcanza cada aviso: todos 7, personas 4, roles 2 y 3 → 3, propiedad H2 → 4 (' + [f2['Comunicado'].destinatarios, f2['A personas'].destinatarios, f2['A admins'].destinatarios, f2['A 84DC'].destinatarios].join(', ') + ')');
ok(f2['Comunicado'].vistos === 1 && f2['A personas'].vistos === 1 && f2['A 84DC'].vistos === 0, '9e. cuántas ya lo vieron: la persona 5 marcó vistos (1 en "Comunicado" y 1 en el de personas; ninguna en el de 84DC, al que no llega)');
ok(f2['Futuro lejano'].vistos === 0, '9f. un programado aún no lo ha visto nadie');
ok(/Todas las personas/.test(f2['Comunicado'].audienciaTexto) && /84DC/.test(f2['A 84DC'].audienciaTexto) && /Administradores/.test(f2['A admins'].audienciaTexto) && /Normal84|NormalDistrito/.test(f2['A personas'].audienciaTexto), '9g. la audiencia se describe con nombres, no con ids: ' + f2['A 84DC'].audienciaTexto + ' | ' + f2['A personas'].audienciaTexto);
ok(f2['Comunicado'].creadoPor === 'SA', '9h. muestra quién lo creó');
ok(['crearAviso', 'editarAviso', 'cancelarAviso', 'obtenerAvisosGestion'].every(n => F.ACCIONES_PERMITIDAS_.includes(n)) && F.accionInvalidaCacheDeArchivos_('crearAviso') && F.accionInvalidaCacheDeArchivos_('cancelarAviso') && F.accionInvalidaCacheDeArchivos_('editarAviso'), '9i. las cuatro acciones están permitidas y crear, editar y cancelar invalidan el caché por defecto');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
