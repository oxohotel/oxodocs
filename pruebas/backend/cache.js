// Prueba del caché del servidor, la auditoría O(1), la actividad sin candado y las métricas, con hojas y CacheService simulados.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';

class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); this.lecturas = 0; this.appends = 0; }
  getDataRange() { const s = this; return { getValues: () => { s.lecturas++; return s.filas.map(f => f.slice()); } }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas[0].length; }
  appendRow(f) { this.appends++; this.filas.push(f.slice()); }
  deleteRows(desde, n) { this.filas.splice(desde - 1, n); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValue() { return s.filas[r - 1][c - 1]; },
      setValue(v) { s.filas[r - 1][c - 1] = v; },
      setValues(vals) { vals.forEach((fila, i) => fila.forEach((v, j) => { s.filas[r - 1 + i][c - 1 + j] = v; })); },
      getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(s.filas[r - 1 + i].slice(c - 1, c - 1 + nc)); return o; }
    };
  }
}

let reloj = 1000000;                       // ms simulados
const almacen = new Map();                 // clave -> {v, exp}
let cacheRoto = false, bloqueos = 0, intentosBloqueo = 0;
const CacheServiceMock = {
  getScriptCache: () => {
    if (cacheRoto) throw new Error('CacheService caído');
    return {
      get: k => { const e = almacen.get(k); return e && e.exp > reloj ? e.v : null; },
      getAll: ks => { const o = {}; ks.forEach(k => { const e = almacen.get(k); if (e && e.exp > reloj) o[k] = e.v; }); return o; },
      put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('valor > 100KB'); almacen.set(k, { v, exp: reloj + ttl * 1000 }); },
      putAll: (o, ttl) => Object.keys(o).forEach(k => { if (String(o[k]).length > 100000) throw new Error('valor > 100KB'); almacen.set(k, { v: o[k], exp: reloj + ttl * 1000 }); }),
      remove: k => almacen.delete(k)
    };
  }
};

const COLS = ['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'];
const U = (id, nombre, email, rol, hoteles, estado = 'Activo') => [id, nombre, email, 'SECRETO_HASH_' + id, rol, estado, '2026-01-01', hoteles];
const usuarios = [COLS, U(1, 'SA', 'sa@x.com', 3, ''), U(2, 'AdminA', 'admina@x.com', 2, 'H1'), U(3, 'Us', 'us@x.com', 1, 'H1,H2'), U(4, 'Todos', 'todos@x.com', 1, 'TODOS'), U(5, 'Vacio', 'vacio@x.com', 1, '')];
const hojas = {
  Usuarios: new Hoja('Usuarios', usuarios),
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre', 'Orden'], ['M1', 'Operación', 1]]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId', 'Fecha'], ['H1', 'Hotel Uno', 'M1', 'f1', new Date()], ['H2', 'Hotel Dos', 'M1', 'f2', new Date()], ['H3', 'Hotel Tres', 'M1', 'f3', new Date()]]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado'], [1, 1, '', 'X', 'a', 'U', 'f', 'Exitosa'], [2, 1, '', 'X', 'b', 'U', 'f', 'Exitosa'], [7, 1, '', 'X', 'c', 'U', 'f', 'Exitosa']]),
  Actividad_Reciente: new Hoja('Actividad_Reciente', [['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora']])
};
const sandbox = {
  console, Logger: { log: () => {} }, Date, Math, JSON,
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) },
  CacheService: CacheServiceMock,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() { bloqueos++; }, tryLock() { intentosBloqueo++; return true; }, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-02 10:00:00', getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'abcdefghijklmnopqrstuvwxyz', computeDigest: () => [], DigestAlgorithm: { SHA_256: 'x' } },
  ScriptApp: { _t: [], getProjectTriggers() { return this._t.slice(); }, deleteTrigger(t) { this._t = this._t.filter(x => x !== t); },
    newTrigger(fn) { const self = this; const t = { fn, getHandlerFunction: () => fn, cada: null }; return { timeBased() { return { everyMinutes(n) { t.cada = n; return { create() { self._t.push(t); return t; } }; } }; } }; } },
  ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  obtenerUsuarioPorToken: t => (t === 'tokSA' ? { idUsuario: '1', rol: 3 } : t === 'tokU' ? { idUsuario: '3', rol: 1 } : null),
  obtenerOAgregarColumna_: (hoja, nombre) => hoja.filas[0].indexOf(nombre),
  calcularHashContrasenaConSalt_: p => 'HASH(' + p + ')'
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'Roles.js', 'AlcanceAdmin.js', 'Usuario.js', 'Hoteles.js', 'Actividad.js', 'Recursos.js', 'Favoritos.js', 'Registro.js', 'Solicitudes.js', 'Metricas.js', 'GestionHoteles.js', 'Auth.js'].forEach(f => vm.runInContext(fs.readFileSync(REPO + 'backend/' + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(REPO + 'Code.js', 'utf8'), sandbox, { filename: 'Code.js' });
vm.runInContext('this.F={crearSesionUsuario_,obtenerDatosInicio,calentarCaches,obtenerRolDeUsuario_,obtenerModulosConHoteles,cambiarEstadoUsuario,asignarHotelesAUsuario,siguienteIdAuditoria_,registrarAuditoriaSimple_,registrarActividad,registrarMetrica_,obtenerResumenMetricas,doPost,obtenerUsuariosLite_,invalidarCacheUsuarios_,leerUsuariosParaAlcance_,registrarAuditoria}', sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_memoCache_={};_spreadsheetEjecucion_=null;_cacheIndiceHojas_={}', sandbox);

let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const llamarDoPost = p => { sandbox.__e = { postData: { contents: JSON.stringify(p) } }; return vm.runInContext('doPost(__e)', sandbox); };
const J = x => JSON.stringify(x);
const lecturasUsuarios = () => hojas.Usuarios.lecturas;

// ---------- 1. Equivalencia con y sin caché
function resultados() {
  nuevaEjecucion();
  return J({ r: ['1', '2', '3', '4', '5', '99'].map(F.obtenerRolDeUsuario_), h: ['tokSA', 'tokU'].map(t => F.obtenerModulosConHoteles(t, null)), h2: ['2', '4', '5'].map(i => F.obtenerModulosConHoteles(null, i)), a: F.leerUsuariosParaAlcance_() });
}
cacheRoto = true; const sinCache = resultados(); cacheRoto = false; almacen.clear();
const conCache1 = resultados(); const conCache2 = resultados();
ok(sinCache === conCache1 && sinCache === conCache2, '1. rol, hoteles visibles y alcance son idénticos sin caché, con caché frío y con caché caliente');
const hotelesDe = id => F.obtenerModulosConHoteles(null, id).flatMap(m => m.hoteles.map(h => h.idHotel)).sort().join(',');
ok(hotelesDe('3') === 'H1,H2' && hotelesDe('4') === 'H1,H2,H3' && hotelesDe('5') === '' && hotelesDe('1') === 'H1,H2,H3', '1b. usuario con lista, TODOS, vacío y superadmin ven lo que corresponde');

// ---------- 2. Lecturas de la hoja Usuarios: 1 en vez de una por llamada
almacen.clear(); hojas.Usuarios.lecturas = 0;
for (let i = 0; i < 20; i++) { nuevaEjecucion(); F.obtenerRolDeUsuario_('3'); F.obtenerModulosConHoteles('tokU', '3'); }
ok(lecturasUsuarios() === 1, '2. 20 llamadas seguidas (ejecuciones separadas) leen la hoja Usuarios ' + lecturasUsuarios() + ' vez (antes: 40+)');
hojas.Usuarios.lecturas = 0; hojas.Hoteles.lecturas = 0; hojas.Modulos.lecturas = 0; almacen.clear();
for (let i = 0; i < 20; i++) { nuevaEjecucion(); F.obtenerModulosConHoteles('tokU', '3'); }
ok(hojas.Hoteles.lecturas === 1 && hojas.Modulos.lecturas === 1, '2b. Hoteles y Módulos también: ' + hojas.Hoteles.lecturas + ' lectura cada una en 20 llamadas');

// ---------- 3. No se guardan contraseñas en el caché
ok(![...almacen.values()].some(e => /SECRETO_HASH|HASH\(/.test(e.v)), '3. ningún hash de contraseña llega a CacheService');

// ---------- 4. Invalidación inmediata al escribir desde la app
nuevaEjecucion(); almacen.clear(); F.obtenerRolDeUsuario_('3');
const r1 = F.cambiarEstadoUsuario('3', 'Inactivo', '1', null);
nuevaEjecucion();
ok(r1.success === true && F.obtenerUsuariosLite_().usuarios.find(u => u.id === '3').estado === 'Inactivo', '4. cambiar el estado se ve de inmediato (sin esperar el TTL)');
F.cambiarEstadoUsuario('3', 'Activo', '1', null);
nuevaEjecucion(); F.obtenerModulosConHoteles(null, '3');
const r2 = F.asignarHotelesAUsuario('3', ['H3'], '1', null);
nuevaEjecucion();
ok(r2.success === true && hotelesDe('3') === 'H3', '4b. asignar hoteles se refleja de inmediato en lo que ve el usuario (' + hotelesDe('3') + ')');
F.asignarHotelesAUsuario('3', ['H1', 'H2'], '1', null);

// ---------- 5. Edición manual en la hoja: se ve al vencer el TTL (90 s)
nuevaEjecucion(); almacen.clear(); F.obtenerRolDeUsuario_('5');
hojas.Usuarios.filas[5][4] = 3; // alguien edita la celda Rol a mano
nuevaEjecucion(); const antes = F.obtenerRolDeUsuario_('5');
reloj += 91 * 1000; nuevaEjecucion(); const despues = F.obtenerRolDeUsuario_('5');
ok(antes === 1 && despues === 3, '5. una edición manual aparece tras 91 s (antes: ' + antes + ', después: ' + despues + ')');
hojas.Usuarios.filas[5][4] = 1; almacen.clear();

// ---------- 6. Caché grande en trozos, trozo perdido y CacheService caído
const original = hojas.Usuarios.filas.map(f => f.slice());
for (let i = 100; i < 900; i++) hojas.Usuarios.filas.push(U(i, 'Persona Ñandú Gómez ' + i, 'persona.largo.numero' + i + '@oxohotel.com', 1, 'H1,H2,H3'));
almacen.clear(); nuevaEjecucion(); const grande = F.obtenerUsuariosLite_();
const trozos = [...almacen.keys()].filter(k => /^oxo:usuarios_lite:/.test(k)).length;
ok(grande.usuarios.length === 805 && trozos > 3, '6. 800 usuarios con tildes se guardan en ' + trozos + ' trozos (ninguno pasa de 100 KB)');
hojas.Usuarios.lecturas = 0; nuevaEjecucion(); const leido = F.obtenerUsuariosLite_();
ok(hojas.Usuarios.lecturas === 0 && J(leido) === J(grande), '6b. se vuelve a leer completo desde el caché, sin tocar la hoja');
const unTrozo = [...almacen.keys()].find(k => /^oxo:usuarios_lite:\d/.test(k)); almacen.delete(unTrozo);
nuevaEjecucion(); const trasPerder = F.obtenerUsuariosLite_();
ok(hojas.Usuarios.lecturas === 1 && trasPerder.usuarios.length === 805, '6c. si se pierde un trozo, se lee la hoja y se rehace el caché');
cacheRoto = true; nuevaEjecucion(); const sinServicio = F.obtenerUsuariosLite_(); cacheRoto = false;
ok(sinServicio.usuarios.length === 805, '6d. con CacheService caído todo sigue funcionando leyendo la hoja');
hojas.Usuarios.filas = original; almacen.clear();

// ---------- 7. Auditoría: el ID sale de la última fila, sin releer la hoja
hojas.Auditoria.lecturas = 0; nuevaEjecucion();
const ultimoId = hojas.Auditoria.filas[hojas.Auditoria.filas.length - 1][0];
ok(F.siguienteIdAuditoria_(hojas.Auditoria) === ultimoId + 1, '7. el siguiente ID de auditoría es el último + 1 (' + ultimoId + ' → ' + (ultimoId + 1) + ')');
F.registrarAuditoriaSimple_('1', 'PRUEBA', 'x', 'Usuario');
F.registrarAuditoria({ usuarioId: 1, emailUsuario: 'sa@x.com', tipo: 'Login', descripcion: 'd', entidadAfectada: 'Usuario' });
const ids = hojas.Auditoria.filas.slice(1).map(f => f[0]);
ok(ids.slice(-2).join() === (ultimoId + 1) + ',' + (ultimoId + 2) && hojas.Auditoria.lecturas === 0, '7b. dos registros nuevos reciben ' + (ultimoId + 1) + ' y ' + (ultimoId + 2) + ' y la hoja de Auditoría no se leyó entera (lecturas: ' + hojas.Auditoria.lecturas + ')');
const vacia = new Hoja('v', [['ID']]); ok(F.siguienteIdAuditoria_(vacia) === 1, '7c. hoja vacía: empieza en 1');

// ---------- 8. Actividad: candado corto al agregar (la prueba real mostró pérdidas sin él), recorte en bloque
bloqueos = 0; intentosBloqueo = 0;
for (let i = 0; i < 50; i++) F.registrarActividad('1', 'Hotel', 'H' + i, 'Abrir');
ok(hojas.Actividad_Reciente.filas.length === 51 && bloqueos === 50 && intentosBloqueo === 0, '8. 50 registros: cada uno con candado corto (appendRow no es seguro entre ejecuciones simultáneas); bloqueos: ' + bloqueos);
vm.runInContext('ACTIVIDAD_LIMITE_FILAS_TEST=1', sandbox);
const A = hojas.Actividad_Reciente; A.filas = [A.filas[0]];
for (let i = 0; i < 2999; i++) A.filas.push(['ACT-' + i, '1', 'Hotel', 'H1', 'Abrir', new Date()]);
F.registrarActividad('1', 'Hotel', 'H1', 'Abrir');      // 3000 filas de datos: justo al límite, no recorta
ok(A.filas.length === 3001 && intentosBloqueo === 0, '8b. en el límite no recorta');
F.registrarActividad('1', 'Hotel', 'H1', 'Abrir');      // pasa del límite: recorta de golpe
ok(A.filas.length - 1 <= 2700 && intentosBloqueo === 1, '8c. al pasar el límite recorta de un golpe hasta ' + (A.filas.length - 1) + ' filas, tomando el candado una sola vez');
ok(A.filas[A.filas.length - 1][0].startsWith('ACT-') && A.filas[0][0] === 'ID_Actividad', '8d. se conserva el encabezado y la entrada más reciente');

// ---------- 9. Métricas
const M = () => hojas.Metricas;
F.registrarMetrica_('obtenerDatosInicio', 800, null);
ok(!M(), '9. una llamada rápida no se registra');
F.registrarMetrica_('obtenerDatosInicio', 7200, null);
F.registrarMetrica_('guardarAlgo', 100, 'Exception: Service invoked too many times for one day: spreadsheet.');
F.registrarMetrica_('otra', 90, 'TypeError: x is undefined');
const tipos = M().filas.slice(1).map(f => f[3]).join(',');
ok(tipos === 'LENTA,CUOTA,ERROR', '9b. se registran lentas, errores de cuota y otros errores → ' + tipos);
// doPost registra pero nunca guarda los argumentos (contraseñas)
vm.runInContext('METRICA_UMBRAL_MS_=-1; function pruebaAccion(a){ return {ok:true}; } ACCIONES_PERMITIDAS_.push("pruebaAccion");', sandbox);
const tokenMetricas = F.crearSesionUsuario_({ ID_Usuario: '3', Nombre_Completo: 'Us', Email: 'us@x.com', ID_Rol: 1, Rol: 'Usuario' });
const salida = llamarDoPost({ action: 'pruebaAccion', args: ['clave-secreta-123'], token: tokenMetricas });
ok(J(JSON.parse(salida.texto)) === J({ success: true, data: { ok: true } }), '9c. doPost responde igual que antes');
ok(!JSON.stringify(M().filas).includes('clave-secreta-123') && M().filas.some(f => f[1] === 'pruebaAccion'), '9d. la métrica guarda la acción pero NUNCA los argumentos');
const salidaErr = llamarDoPost({ action: 'noExiste', args: [] });
ok(JSON.parse(salidaErr.texto).success === false, '9e. una acción inexistente sigue respondiendo error como antes');
// Resumen solo para superadmin
ok(F.obtenerResumenMetricas('3', null).success === false, '9f. un usuario normal NO puede ver las métricas');
const res = F.obtenerResumenMetricas('1', null);
ok(res.success === true && res.resumen.length >= 2, '9g. el superadmin ve el resumen por acción (' + res.resumen.map(r => r.accion).join(', ') + ')');

// ---------- 10. El despachador solo ejecuta las acciones de la lista permitida
vm.runInContext('var __ejecutadas=[]; function internaPeligrosa_(){ __ejecutadas.push("interna"); return {token:"X"}; } function publicaNoListada(){ __ejecutadas.push("noListada"); return 1; } vaciarYRegenerarEstructura=function(){ __ejecutadas.push("vaciar"); return "borrado"; }; obtenerOAuthTokenPicker=function(){ __ejecutadas.push("oauth"); return "TOKEN-OAUTH"; };', sandbox);
const intento = a => JSON.parse(llamarDoPost({ action: a, args: [] }).texto);
const rInt = intento('internaPeligrosa_');
const rSes = JSON.parse(llamarDoPost({ action: 'crearSesionUsuario_', args: [{ ID_Usuario: '1', Nombre_Completo: 'x', Email: 'sa@x.com', ID_Rol: 3, Rol: 'Superadministrador' }] }).texto);
const rNo = intento('publicaNoListada');
const rVaciar = intento('vaciarYRegenerarEstructura');
const rOauth = intento('obtenerOAuthTokenPicker');
const rReset = intento('resetearCacheGlobalAplicativo');
const rSuper = intento('asignarSuperadminsIniciales');
const rWarm = intento('instalarCalentamientoCaches');
const rOk = intento('obtenerVersionCacheGlobal');
const ejecutadas = vm.runInContext('__ejecutadas.length', sandbox);
ok(!rInt.success && !rNo.success && ejecutadas === 0, '10. ni las internas (_) ni las funciones públicas que no están en la lista se ejecutan por doPost');
ok(!rSes.success && !JSON.stringify(rSes).includes('token'), '10b. no se puede pedir una sesión falsa con crearSesionUsuario_');
ok(!rVaciar.success && !rOauth.success && !JSON.stringify(rOauth).includes('TOKEN-OAUTH'), '10c. vaciarYRegenerarEstructura y obtenerOAuthTokenPicker (token de Drive del dueño) quedan inaccesibles');
ok(!rReset.success && !rSuper.success && !rWarm.success, '10d. utilidades del editor (resetear caché, asignar superadmins, instalar disparadores) no se pueden llamar desde fuera');
ok(rOk.success === true && rOk.data === '1', '10e. las acciones de la lista siguen funcionando (obtenerVersionCacheGlobal → ' + rOk.data + ')');
const inexistente = intento('funcionQueNoExisteParaNada');
const sinNombre = m => String(m).replace(/"[^"]*"/, 'X');
ok(sinNombre(rInt.message) === sinNombre(inexistente.message) && sinNombre(rNo.message) === sinNombre(inexistente.message) && /no existe/.test(rNo.message), '10f. el rechazo no revela si la función existe (mismo mensaje que para una inexistente)');
ok(vm.runInContext('accionPermitida_("")', sandbox) === false && vm.runInContext('accionPermitida_(undefined)', sandbox) === false, '10g. acción vacía o ausente se rechaza');

// ---------- 11. Carrera lectura/escritura: una lectura vieja no pisa un cambio reciente
almacen.clear(); nuevaEjecucion();
const filaAdmin = hojas.Usuarios.filas.findIndex(f => String(f[0]) === '2');
const getOriginal = hojas.Usuarios.getDataRange;
let disparado = false;
hojas.Usuarios.getDataRange = function () {
  const valores = getOriginal.call(this).getValues();             // el lector ya leyó (datos viejos)...
  if (!disparado) { disparado = true; hojas.Usuarios.filas[filaAdmin][5] = 'Inactivo'; F.invalidarCacheUsuarios_(); } // ...y justo entonces otra ejecución escribe e invalida
  return { getValues: () => valores };
};
nuevaEjecucion(); F.obtenerUsuariosLite_();
hojas.Usuarios.getDataRange = getOriginal;
nuevaEjecucion();
ok(F.obtenerUsuariosLite_().usuarios.find(u => u.id === '2').estado === 'Inactivo', '11. si alguien escribe mientras otro lee, el caché NO queda con el dato viejo');
hojas.Usuarios.filas[filaAdmin][5] = 'Activo'; almacen.clear();

// ---------- 11b. La memoria de la ejecución tampoco guarda la lectura vieja
almacen.clear(); nuevaEjecucion();
let disparado2 = false; const getOrig2 = hojas.Usuarios.getDataRange;
hojas.Usuarios.getDataRange = function () {
  const valores = getOrig2.call(this).getValues();
  if (!disparado2) { disparado2 = true; hojas.Usuarios.filas[filaAdmin][5] = 'Inactivo'; F.invalidarCacheUsuarios_(); }
  return { getValues: () => valores };
};
nuevaEjecucion(); F.obtenerUsuariosLite_();                 // lectura vieja: debe descartarse
hojas.Usuarios.getDataRange = getOrig2;
const mismaEjecucion = F.obtenerUsuariosLite_();             // MISMA ejecución: no debe devolver lo viejo
ok(mismaEjecucion.usuarios.find(u => u.id === '2').estado === 'Inactivo', '11b. dentro de la misma ejecución tampoco se reutiliza una lectura que ya quedó vieja');
hojas.Usuarios.filas[filaAdmin][5] = 'Activo'; almacen.clear();

// ---------- 12. Calentamiento
vm.runInContext('this.G={calentarCaches,instalarCalentamientoCaches,desinstalarCalentamientoCaches,refrescarCachesForzado_}', sandbox);
const G = sandbox.G;
almacen.clear(); nuevaEjecucion(); hojas.Usuarios.lecturas = 0; hojas.Hoteles.lecturas = 0; hojas.Modulos.lecturas = 0;
const cal = G.calentarCaches();
ok(cal.success === true && hojas.Usuarios.lecturas === 1 && hojas.Hoteles.lecturas === 1 && hojas.Modulos.lecturas === 1, '12. el calentamiento lee las 3 hojas una vez y llena el caché');
reloj += 600 * 1000; nuevaEjecucion(); hojas.Usuarios.lecturas = 0;
F.obtenerRolDeUsuario_('3'); F.obtenerModulosConHoteles(null, '3');
ok(hojas.Usuarios.lecturas === 0, '12b. 10 minutos después el caché calentado sigue vivo: nadie paga la lectura de las hojas');
// Sin calentar, el llenado normal vence a los 90 s
almacen.clear(); nuevaEjecucion(); F.obtenerRolDeUsuario_('3'); reloj += 120 * 1000; nuevaEjecucion(); hojas.Usuarios.lecturas = 0; F.obtenerRolDeUsuario_('3');
ok(hojas.Usuarios.lecturas === 1, '12c. sin calentamiento, el llenado normal sí vence (TTL corto): el comportamiento anterior se conserva');
// Calentar renueva y refleja ediciones manuales
hojas.Usuarios.filas[filaAdmin][4] = 3; nuevaEjecucion(); G.calentarCaches(); nuevaEjecucion();
ok(F.obtenerRolDeUsuario_('2') === 3, '12d. una edición manual en la hoja aparece en cuanto corre el siguiente calentamiento');
hojas.Usuarios.filas[filaAdmin][4] = 2; almacen.clear();
// Disparadores
G.instalarCalentamientoCaches(); G.instalarCalentamientoCaches();
const ts = sandbox.ScriptApp.getProjectTriggers();
ok(ts.length === 1 && ts[0].getHandlerFunction() === 'calentarCaches' && ts[0].cada === 10, '12e. instalar (aunque se ejecute dos veces) deja UN solo disparador cada 10 minutos');
G.desinstalarCalentamientoCaches();
ok(sandbox.ScriptApp.getProjectTriggers().length === 0, '12f. desinstalar quita el disparador');

// ---------- 13. Refresco forzado (botón Recargar sistema)
almacen.clear(); nuevaEjecucion(); F.obtenerRolDeUsuario_('5');
hojas.Usuarios.filas[5][4] = 3;
nuevaEjecucion(); const sinForzar = F.obtenerRolDeUsuario_('5');
const tokenReal = F.crearSesionUsuario_({ ID_Usuario: '3', Nombre_Completo: 'Us', Email: 'us@x.com', ID_Rol: 1, Rol: 'Usuario' });
nuevaEjecucion(); const anonimo = F.obtenerDatosInicio(null, '3', true);
nuevaEjecucion(); const aunSinVer = F.obtenerRolDeUsuario_('5');
ok(anonimo.refrescoForzado === false && aunSinVer === 1, '13-. un llamador SIN sesión válida no puede forzar el refresco (no vacía el caché de nadie)');
reloj += 61 * 1000; nuevaEjecucion();
const conSesion = F.obtenerDatosInicio(tokenReal, '3', true);
nuevaEjecucion(); const conForzar = F.obtenerRolDeUsuario_('5');
ok(conSesion.refrescoForzado === true, '13-b. con sesión válida el refresco forzado se hace y se informa (refrescoForzado = true)');
nuevaEjecucion(); const limitada = F.obtenerDatosInicio(tokenReal, '3', true);
ok(limitada.refrescoForzado === false, '13-c. si se pide otra vez dentro del minuto, se informa que se omitió (refrescoForzado = false)');
ok(F.obtenerDatosInicio(tokenReal, '3').refrescoForzado === undefined, '13-d. sin pedir forzar, la respuesta no trae ese campo (igual que antes)');
ok(sinForzar === 1 && conForzar === 3, '13. "Recargar sistema" (forzar) hace visible una edición manual al instante (antes ' + sinForzar + ', después ' + conForzar + ')');
hojas.Usuarios.filas[5][4] = 1;
reloj += 61 * 1000; nuevaEjecucion();
const f1 = G.refrescarCachesForzado_(), f2 = G.refrescarCachesForzado_(); reloj += 61 * 1000; const f3 = G.refrescarCachesForzado_();
ok(f1 === true && f2 === false && f3 === true, '13b. el refresco forzado solo actúa una vez por minuto en todo el sistema (' + [f1, f2, f3] + ')');

// ---------- 13c. El refresco forzado conserva el calentamiento (TTL largo) si está activo
almacen.clear(); nuevaEjecucion(); reloj += 61 * 1000; G.calentarCaches();
reloj += 61 * 1000; nuevaEjecucion(); G.refrescarCachesForzado_();
reloj += 600 * 1000; nuevaEjecucion(); hojas.Usuarios.lecturas = 0; F.obtenerRolDeUsuario_('3'); F.obtenerModulosConHoteles(null, '3');
ok(hojas.Usuarios.lecturas === 0, '13c. con calentamiento activo, tras un refresco forzado el caché sigue vivo 10 minutos después (TTL largo)');
almacen.clear(); nuevaEjecucion(); reloj += 61 * 1000; G.refrescarCachesForzado_();   // sin calentamiento activo: TTL corto como siempre
reloj += 120 * 1000; nuevaEjecucion(); hojas.Usuarios.lecturas = 0; F.obtenerRolDeUsuario_('3');
ok(hojas.Usuarios.lecturas === 1, '13d. sin calentamiento activo, el refresco forzado deja TTL corto (no se alarga por error)');

// ---------- 14. Desglose de una llamada lenta
const ahoraReal = Date.now; let adelanto = 0; Date.now = () => ahoraReal() + adelanto;
const getFav = hojas.Favoritos ? null : null;
hojas.Actividad_Reciente.getDataRange = function () { adelanto += 4000; return { getValues: () => this.filas.map(f => f.slice()) }; };
if (!hojas.Favoritos) hojas.Favoritos = new Hoja('Favoritos', [['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado']]);
M().filas.length = 1; nuevaEjecucion();
F.obtenerDatosInicio(null, '3');
Date.now = ahoraReal;
const fila = M().filas.find(f => f[1] === 'obtenerDatosInicio.partes');
ok(!!fila && /actividad=4[0-9]{3}/.test(fila[4]) && /lecturasHoja=[0-9]+/.test(fila[4]), '14. una carga lenta del Inicio guarda el desglose por parte → ' + (fila ? fila[4] : '(nada)'));

// ---------- 15. Una llamada lenta con desglose no deja DOS filas en Metricas
M().filas.length = 1; vm.runInContext('_metricaDetalladaRegistrada_=false', sandbox);
F.registrarMetrica_('obtenerDatosInicio.partes', 4200, null, 'hoteles=100 actividad=4000', 3000);
F.registrarMetrica_('obtenerDatosInicio', 4300, null);   // lo que haría doPost (umbral normal): ya no debe repetirse
F.registrarMetrica_('obtenerDatosInicio', 7000, null);   // aunque sea lenta de verdad: el desglose ya la cubre
F.registrarMetrica_('otra', 90, 'Error real');           // los errores SÍ se registran siempre
ok(M().filas.length === 3 && M().filas[1][1] === 'obtenerDatosInicio.partes' && M().filas[2][3] === 'ERROR', '15. con desglose registrado no se duplica la fila, pero los errores siguen registrándose');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
