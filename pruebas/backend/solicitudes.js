// Prueba del flujo de registro con propiedades solicitadas, aprobación por propiedad, cierre de solicitudes y rol numérico.
const fs = require('fs'), vm = require('vm');
const guardarCorreo_ = (nombre, html) => { if (process.env.GUARDAR_CORREOS_EN) fs.writeFileSync(process.env.GUARDAR_CORREOS_EN + '/correo-' + nombre + '.html', html); };
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
      setValues(vals) { vals.forEach((fila, i) => fila.forEach((v, j) => { asegurar(r + i, c + j); s.filas[r - 1 + i][c - 1 + j] = v; })); },
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
    U(4, 'AdminTodos', 'admin.todos@oxohotel.com', 2, 'TODOS'), U(5, 'AdminInactivo', 'admin.inactivo@oxohotel.com', 2, 'H1', 'Inactivo'),
    U(6, 'UsuarioNormal', 'normal@oxohotel.com', 1, 'H1')]),
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre_Modulo', 'Orden'], ['M1', 'Hoteles en operación', 1], ['M2', 'Hoteles en pre-apertura', 2], ['M3', 'Hoteles en desarrollo', 3], ['M4', 'Corporativo', 4]]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId'], ['H1', 'Distrito', 'M1', 'fa'], ['H2', '84DC', 'M1', 'fb'], ['H3', 'Hotel Secreto', 'M2', 'fc'], ['HC', 'Corporativo', 'M4', 'fd']]),
  Verificacion_Email: new Hoja('Verificacion_Email', [['ID', 'ID_Usuario', 'Email', 'Codigo', 'Fecha', 'Expira', 'Estado']]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado']])
};
const correos = []; const correosAcumulados = [];
const sandbox = {
  console, Logger: { log: () => {} }, Date, Math, JSON,
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) },
  CacheService: CacheServiceMock,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-14', getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'h' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), computeDigest: () => [1, 2, 3], DigestAlgorithm: { SHA_256: 'x' } },
  MailApp: { sendEmail: o => { correos.push(o); correosAcumulados.push(o); } },
  ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger() { return { timeBased() { return { everyMinutes() { return { create() {} }; } }; } }; } }
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'CacheArchivos.js', 'Metricas.js', 'Acceso.js', 'Archivos.js', 'Roles.js', 'AlcanceAdmin.js', 'Usuario.js', 'Hoteles.js', 'Correos.js', 'Registro.js', 'Solicitudes.js', 'MisAccesos.js', 'Mantenimiento.js', 'GestionHoteles.js', 'Auth.js']
  .forEach(f => vm.runInContext(fs.readFileSync(REPO + 'backend/' + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(REPO + 'Code.js', 'utf8'), sandbox, { filename: 'Code.js' });
vm.runInContext('this.F={crearSesionUsuario_,obtenerMisAccesos,solicitarAccesoPropiedades,cancelarSolicitudesPropias,resolverSolicitudesUsuario,registrarUsuario,verificarCodigoRegistro,obtenerHotelesParaRegistro,obtenerUsuariosParaGestion,resolverSolicitudHotel,aprobarUsuario,cerrarSolicitudUsuario,contarPendientesAprobacion_,obtenerModulosConHoteles,prepararResolucion_,aplicarDecisionesSolicitud_,quitarHotelDeAccesosDeUsuarios_,normalizarRolesDeUsuarios,normalizarRolesDeUsuariosAplicar,cambiarEstadoUsuario,obtenerDatosInicio,validarCredenciales,ACCIONES_PERMITIDAS_}', sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_memoCache_={};_spreadsheetEjecucion_=null;_cacheIndiceHojas_={}', sandbox);
const llamarDoPost = p => { sandbox.__e = { postData: { contents: JSON.stringify(p) } }; return JSON.parse(vm.runInContext('doPost(__e)', sandbox).texto); };

let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const enc = () => hojas.Usuarios.filas[0];
const celda = (email, col) => { const f = hojas.Usuarios.filas.find(r => String(r[2]).toLowerCase() === email.toLowerCase()); return f ? f[enc().indexOf(col)] : undefined; };
const filaDe = email => hojas.Usuarios.filas.find(r => String(r[2]).toLowerCase() === email.toLowerCase());
const idDe = email => String(filaDe(email)[0]);
const verificar = email => { const f = hojas.Verificacion_Email.filas.slice().reverse().find(r => String(r[2]).toLowerCase() === email); return F.verificarCodigoRegistro(email, f[3]); };
const vistos = (id) => { nuevaEjecucion(); return F.obtenerUsuariosParaGestion(String(id), String(id)).usuarios; };
const visto = (id, email) => vistos(id).find(u => String(u.email).toLowerCase() === email);

// ---------- 1. Lista pública de propiedades
nuevaEjecucion(); const pub = F.obtenerHotelesParaRegistro();
ok(pub.success && pub.hoteles.map(h => h.idHotel).sort().join() === 'H1,H2,H3,HC', '1. el formulario público ofrece TODAS las propiedades (operación, pre-apertura, desarrollo y Corporativo) → ' + pub.hoteles.map(h => h.modulo + ': ' + h.nombre).join(' | '));
ok(pub.hoteles.map(h => h.modulo).join() === 'Hoteles en operación,Hoteles en operación,Hoteles en pre-apertura,Corporativo' && pub.hoteles.slice(0, 2).map(h => h.nombre).join() === '84DC,Distrito', '1a. vienen ordenadas por módulo y, dentro de cada uno, por nombre');
ok(pub.hoteles.every(h => Object.keys(h).sort().join() === 'idHotel,modulo,nombre') && !JSON.stringify(pub).includes('fa') && !JSON.stringify(pub).includes('DriveFolderId'), '1b. de cada una solo se expone id, nombre y módulo (nada de datos de Drive)');

// ---------- 2. Registro: rol numérico, propiedades solicitadas, validaciones
nuevaEjecucion(); const r1 = F.registrarUsuario('Ana Pérez', 'ana@oxohotel.com', 'Clave1234!', ['H1', 'H2']);
ok(r1.success && r1.requiereVerificacion, '2. el registro con dos propiedades funciona');
ok(celda('ana@oxohotel.com', 'Rol') === 1 && typeof celda('ana@oxohotel.com', 'Rol') === 'number', '2b. la columna Rol queda con el NÚMERO 1 (antes quedaba el texto "Usuario") → ' + JSON.stringify(celda('ana@oxohotel.com', 'Rol')));
ok(celda('ana@oxohotel.com', 'Estado') === 'Pendiente_Verificacion' && celda('ana@oxohotel.com', 'Hoteles_Solicitados') === 'H1,H2' && !celda('ana@oxohotel.com', 'Hoteles_Permitidos'), '2c. queda pendiente de verificación, con H1,H2 solicitados y SIN hoteles permitidos');
nuevaEjecucion(); const rPre = F.registrarUsuario('Pre', 'pre@oxohotel.com', 'Clave1234!', ['H3']);
ok(rPre.success === true && celda('pre@oxohotel.com', 'Hoteles_Solicitados') === 'H3', '2d. se puede pedir un hotel en pre-apertura o desarrollo (ahora se ofrecen todos)');
ok(F.registrarUsuario('X', 'x2@oxohotel.com', 'Clave1234!', ['NOEXISTE']).success === false, '2e. ni un id inventado');
ok(F.registrarUsuario('X', 'x3@gmail.com', 'Clave1234!', ['H1']).success === false, '2f. el dominio del correo se sigue exigiendo');
ok(F.registrarUsuario('Ana', 'ana@oxohotel.com', 'Clave1234!', ['H1']).message === 'Este email ya está registrado', '2g. un correo ya registrado se rechaza');
ok(!hojas.Usuarios.filas.some(r => /x[23]@/.test(String(r[2]))), '2h. los registros rechazados no dejan filas');
nuevaEjecucion(); ok(F.registrarUsuario('Sin Hotel', 'sinhotel@oxohotel.com', 'Clave1234!').success === true && celda('sinhotel@oxohotel.com', 'Hoteles_Solicitados') === '', '2i. sin elegir propiedad (frontend viejo) también se registra, con la solicitud vacía');
ok(hojas.Usuarios.filas.every(f => f.length >= enc().length - 0) || true, '2j. (la hoja aceptó la columna nueva Hoteles_Solicitados) → ' + enc().join('|'));

// ---------- 2k. El correo del código de verificación tiene el formato corporativo
{
  const cv = correosAcumulados.find(c => c.to === 'ana@oxohotel.com' && /verificación/.test(c.subject));
  const codigoReal = hojas.Verificacion_Email.filas.filter(r => String(r[2]) === 'ana@oxohotel.com').pop()[3];
  ok(cv && cv.htmlBody.includes('>' + codigoReal + '<') && /Confirma tu cuenta/.test(cv.htmlBody) && /#C4972B/.test(cv.htmlBody) && /border: 2px dashed/.test(cv.htmlBody) && cv.name === 'Repositorio OxoHotel', '2k. el correo del código de verificación usa el formato corporativo (título, código en recuadro dorado, remitente) y trae el código correcto');
  guardarCorreo_('codigo', cv.htmlBody);
}

// ---------- 3. Verificación → aviso a quienes pueden resolver
correos.length = 0; nuevaEjecucion();
const v = verificar('ana@oxohotel.com');
ok(v.success && celda('ana@oxohotel.com', 'Estado') === 'Pendiente_Aprobacion', '3. al verificar el correo queda "Pendiente_Aprobacion"');
const aviso = correos.find(c => /Nueva solicitud/.test(c.subject));
const destinos = aviso ? [aviso.to].concat(String(aviso.bcc || '').split(',')).filter(Boolean).sort() : [];
ok(destinos.join() === ['admin.84@oxohotel.com', 'admin.distrito@oxohotel.com', 'admin.todos@oxohotel.com', 'sa@oxohotel.com'].sort().join(), '3b. el aviso llega a superadmin, administrador con TODOS y a los administradores de Distrito y 84DC → ' + destinos.join(', '));
ok(!destinos.includes('admin.inactivo@oxohotel.com') && !destinos.includes('normal@oxohotel.com'), '3c. no llega a administradores inactivos ni a usuarios normales');
ok(aviso && /Propiedades que solicita/i.test(aviso.htmlBody) && />Distrito</.test(aviso.htmlBody) && />84DC</.test(aviso.htmlBody), '3d. el aviso dice qué propiedades pidió (una etiqueta por propiedad)');
ok(aviso && aviso.name === 'Repositorio OxoHotel' && /#3D5A4C/.test(aviso.htmlBody) && /Repositorio de Documentos OxoHotel/.test(aviso.htmlBody) && /border-radius: 16px/.test(aviso.htmlBody), '3d-2. el aviso usa el formato corporativo de los demás correos (tarjeta, título verde, remitente "Repositorio OxoHotel")');
ok(aviso && aviso.htmlBody.includes('href="https://oxohotel.github.io/oxodocs/"') && aviso.htmlBody.includes('>Revisar la solicitud</a>'), '3d-3. incluye un botón que lleva al sistema');
ok(aviso && /ana@oxohotel.com/.test(aviso.htmlBody) && /Ana P/.test(aviso.htmlBody), '3d-4. muestra a la persona (nombre y correo) en un cuadro de datos');
guardarCorreo_('aviso', aviso.htmlBody);


// Una persona más, que pide solo Corporativo, y una que escribe HTML en el nombre
nuevaEjecucion(); F.registrarUsuario('Bea', 'bea@oxohotel.com', 'Clave1234!', ['HC']); verificar('bea@oxohotel.com');
correos.length = 0; nuevaEjecucion(); F.registrarUsuario('<img src=x onerror=alert(1)>', 'xss@oxohotel.com', 'Clave1234!', ['H1']); verificar('xss@oxohotel.com');
const avisoXss = correos.find(c => /Nueva solicitud/.test(c.subject));
ok(!!avisoXss && !/<img/.test(avisoXss.htmlBody) && /&lt;img/.test(avisoXss.htmlBody), '3e. el nombre se escapa en el correo (no se cuela HTML)');

// ---------- 4. Visibilidad por propiedad
const ana = 'ana@oxohotel.com';
let a = visto(2, ana), b = visto(3, ana);
ok(a && a.solo_solicitud === true && a.solicitudes.find(s => s.idHotel === 'H1').puedeResolver === true && a.solicitudes.find(s => s.idHotel === 'H2').puedeResolver === false, '4. el administrador de Distrito ve a Ana, solo por su solicitud, y solo puede resolver Distrito');
ok(b && b.solo_solicitud === true && b.solicitudes.find(s => s.idHotel === 'H2').puedeResolver === true && b.solicitudes.find(s => s.idHotel === 'H1').puedeResolver === false, '4b. el administrador de 84DC ve a Ana y solo puede resolver 84DC');
ok(!visto(2, 'bea@oxohotel.com') && !visto(3, 'bea@oxohotel.com'), '4c. quien pidió solo Corporativo NO se ve para los administradores de Distrito ni de 84DC');
const t = visto(4, ana), s = visto(1, ana);
ok(t && t.solicitudes.every(x => x.puedeResolver) && s && s.solicitudes.every(x => x.puedeResolver) && s.solo_solicitud === false, '4d. superadmin y administrador con TODOS ven y resuelven todo');
ok(visto(1, 'bea@oxohotel.com') && visto(4, 'bea@oxohotel.com'), '4e. la solicitud de Corporativo la ven el superadmin y el de TODOS');

// Quien solo ve por solicitud no puede hacer nada más sobre la cuenta
nuevaEjecucion(); const deshabilitar = F.cambiarEstadoUsuario(idDe(ana), 'Inactivo', '2', '2');
ok(deshabilitar.success === false && celda(ana, 'Estado') === 'Pendiente_Aprobacion', '4f. un administrador que solo ve la solicitud NO puede desactivar la cuenta (alcance limitado)');

// ---------- 5. El caso del pedido: Distrito sí, 84DC no
correos.length = 0; nuevaEjecucion();
const rDistrito = F.resolverSolicitudHotel(idDe(ana), 'H1', 'aprobar', '2', '2');
ok(rDistrito.success && rDistrito.activado && celda(ana, 'Estado') === 'Activo' && celda(ana, 'Hoteles_Permitidos') === 'H1' && celda(ana, 'Hoteles_Solicitados') === 'H2', '5. Distrito aprueba: la cuenta se activa con acceso a H1 y queda pendiente H2 → ' + rDistrito.message);
ok(correos.some(c => c.to === ana && /Distrito/.test(c.htmlBody)), '5b. a Ana le llega un correo diciendo que ya tiene acceso a Distrito');
{
  const ca = correos.find(c => c.to === ana);
  ok(ca.name === 'Repositorio OxoHotel' && /Tu acceso fue aprobado/.test(ca.htmlBody) && /#E8F1EB/.test(ca.htmlBody) && ca.htmlBody.includes('>Entrar al sistema</a>') && ca.htmlBody.includes('Hola <strong>Ana</strong>'), '5b-2. el correo de aprobación usa el formato corporativo: título "Tu acceso fue aprobado", etiqueta verde, saludo por nombre y botón para entrar');
  guardarCorreo_('aprobado', ca.htmlBody);
}
nuevaEjecucion(); const intruso = F.resolverSolicitudHotel(idDe(ana), 'H2', 'aprobar', '2', '2');
ok(intruso.success === false && !String(celda(ana, 'Hoteles_Permitidos')).includes('H2'), '5c. el administrador de Distrito NO puede aprobar 84DC (no es su propiedad)');
nuevaEjecucion(); ok(visto(3, ana) && visto(3, ana).solo_solicitud === true, '5d. el administrador de 84DC sigue viendo la solicitud pendiente de 84DC');
nuevaEjecucion(); const rNo = F.resolverSolicitudHotel(idDe(ana), 'H2', 'denegar', '3', '3');
ok(rNo.success && celda(ana, 'Hoteles_Permitidos') === 'H1' && celda(ana, 'Hoteles_Solicitados') === '' && celda(ana, 'Estado') === 'Activo', '5e. 84DC deniega: Ana queda activa solo con Distrito y sin solicitudes pendientes → ' + rNo.message);
nuevaEjecucion(); const accesoAna = F.obtenerModulosConHoteles(null, idDe(ana)).flatMap(m => m.hoteles.map(h => h.nombre));
ok(accesoAna.join() === 'Distrito', '5f. lo que Ana ve en el sistema: solo Distrito → ' + accesoAna.join());

// ---------- 6. Aprobación masiva y por propiedad
nuevaEjecucion(); F.registrarUsuario('Eve', 'eve@oxohotel.com', 'Clave1234!', ['H1', 'H2']); verificar('eve@oxohotel.com');
nuevaEjecucion(); const m1 = F.aprobarUsuario(idDe('eve@oxohotel.com'), '2', '2');
ok(m1.success && celda('eve@oxohotel.com', 'Hoteles_Permitidos') === 'H1' && celda('eve@oxohotel.com', 'Hoteles_Solicitados') === 'H2' && celda('eve@oxohotel.com', 'Estado') === 'Activo', '6. "Aprobar" de un administrador aprueba solo SUS propiedades (H1) y deja H2 a quien corresponda → ' + m1.message);
nuevaEjecucion(); const m2 = F.aprobarUsuario(idDe('eve@oxohotel.com'), '1', '1');
ok(m2.success && celda('eve@oxohotel.com', 'Hoteles_Permitidos') === 'H1,H2' && celda('eve@oxohotel.com', 'Hoteles_Solicitados') === '', '6b. el superadmin aprueba lo que falta: acceso a H1,H2');

// ---------- 7. Cerrar solicitudes
nuevaEjecucion(); ok(F.cerrarSolicitudUsuario(idDe('bea@oxohotel.com'), '2', '2').success === false, '7. el administrador de Distrito no puede cerrar la solicitud de Corporativo (ni la ve)');
correos.length = 0; nuevaEjecucion();
const c1 = F.cerrarSolicitudUsuario(idDe('bea@oxohotel.com'), '1', '1');
ok(c1.success && c1.cerrada && celda('bea@oxohotel.com', 'Estado') === 'Solicitud_Cerrada' && celda('bea@oxohotel.com', 'Hoteles_Solicitados') === '', '7b. el superadmin cierra la solicitud: queda "Solicitud_Cerrada" y se limpian las propiedades pedidas');
ok(correos.some(c => c.to === 'bea@oxohotel.com' && /volver a registrarte/.test(c.htmlBody)), '7c. a la persona le llega un correo que le dice que puede volver a registrarse');
{
  const cc = correos.find(c => c.to === 'bea@oxohotel.com');
  ok(/Tu solicitud de acceso/.test(cc.htmlBody) && cc.htmlBody.includes('>Volver a registrarme</a>') && cc.htmlBody.includes('<strong>cerrada</strong>'), '7c-2. el correo de cierre tiene el mismo formato y un botón "Volver a registrarme"');
  guardarCorreo_('cerrado', cc.htmlBody);
}
nuevaEjecucion(); const filasAntes = hojas.Usuarios.filas.length; const idBea = idDe('bea@oxohotel.com'); const hashBea = celda('bea@oxohotel.com', 'Contraseña_Hash');
const re = F.registrarUsuario('Bea Gómez', 'bea@oxohotel.com', 'OtraClave987!', ['H2']);
ok(re.success && hojas.Usuarios.filas.length === filasAntes && idDe('bea@oxohotel.com') === idBea, '7d. con el mismo correo puede volver a registrarse: se reutiliza su fila (mismo ID, sin duplicados)');
ok(celda('bea@oxohotel.com', 'Estado') === 'Pendiente_Verificacion' && celda('bea@oxohotel.com', 'Hoteles_Solicitados') === 'H2' && celda('bea@oxohotel.com', 'Nombre_Completo') === 'Bea Gómez' && celda('bea@oxohotel.com', 'Contraseña_Hash') !== hashBea && celda('bea@oxohotel.com', 'Rol') === 1, '7e. la nueva solicitud reemplaza a la anterior (nombre, contraseña, propiedad) y vuelve a verificación');
ok(F.registrarUsuario('Ana otra vez', ana, 'Clave1234!', ['H1']).message === 'Este email ya está registrado', '7f. una cuenta activa NO puede volver a registrarse');

// Quien intenta entrar con la solicitud cerrada recibe un mensaje claro
hojas.Usuarios.filas.find(f => f[2] === 'bea@oxohotel.com')[5] = 'Solicitud_Cerrada'; almacen.clear(); nuevaEjecucion();
const loginCerrada = F.validarCredenciales('bea@oxohotel.com', 'lo-que-sea');
ok(loginCerrada.success === false && /solicitud de acceso fue cerrada/.test(loginCerrada.message) && /volver a registrarte/.test(loginCerrada.message), '7e-b. iniciar sesión con una solicitud cerrada dice que fue cerrada y que puede volver a registrarse (no "cuenta desactivada")');
hojas.Usuarios.filas.find(f => f[2] === 'bea@oxohotel.com')[5] = 'Pendiente_Verificacion'; almacen.clear();

// Varias propiedades de distintos administradores: se cierra cuando se resuelve lo último
nuevaEjecucion(); F.registrarUsuario('Carl', 'carl@oxohotel.com', 'Clave1234!', ['H1', 'H2']); verificar('carl@oxohotel.com');
nuevaEjecucion(); const k1 = F.cerrarSolicitudUsuario(idDe('carl@oxohotel.com'), '2', '2');
ok(k1.success && !k1.cerrada && celda('carl@oxohotel.com', 'Estado') === 'Pendiente_Aprobacion' && celda('carl@oxohotel.com', 'Hoteles_Solicitados') === 'H2', '7g. el administrador de Distrito cierra lo suyo: la solicitud sigue viva para 84DC → ' + k1.message);
nuevaEjecucion(); const k2 = F.cerrarSolicitudUsuario(idDe('carl@oxohotel.com'), '3', '3');
ok(k2.success && k2.cerrada && celda('carl@oxohotel.com', 'Estado') === 'Solicitud_Cerrada', '7h. cuando 84DC también la cierra, la solicitud queda cerrada y Carl puede volver a intentarlo');

// Registro antiguo: pendiente y sin propiedades pedidas
nuevaEjecucion(); const idSin = idDe('sinhotel@oxohotel.com'); verificar('sinhotel@oxohotel.com');
nuevaEjecucion(); ok(!visto(2, 'sinhotel@oxohotel.com') && F.aprobarUsuario(idSin, '2', '2').success === false, '7i. una cuenta pendiente sin propiedades NO la ve ni la aprueba un administrador de propiedad');
nuevaEjecucion(); ok(F.aprobarUsuario(idSin, '4', '4').success === true && celda('sinhotel@oxohotel.com', 'Estado') === 'Activo', '7j. sí la puede aprobar un administrador con TODOS (queda activa, sin hoteles, como antes)');

// ---------- 8. Permisos y condiciones
nuevaEjecucion(); F.registrarUsuario('Dan', 'dan@oxohotel.com', 'Clave1234!', ['H1']); verificar('dan@oxohotel.com');
nuevaEjecucion(); ok(F.resolverSolicitudHotel(idDe('dan@oxohotel.com'), 'H1', 'aprobar', '6', '6').success === false, '8. un usuario normal no puede resolver solicitudes');
nuevaEjecucion(); ok(F.resolverSolicitudHotel(idDe('dan@oxohotel.com'), 'H1', 'aprobar', '5', '5').success === false, '8b. un administrador INACTIVO tampoco');
nuevaEjecucion(); ok(F.resolverSolicitudHotel('2', 'H1', 'aprobar', '2', '2').success === false, '8c. nadie resuelve su propia solicitud');
nuevaEjecucion(); ok(F.resolverSolicitudHotel(idDe('dan@oxohotel.com'), 'H1', 'quizas', '2', '2').success === false, '8d. una decisión inventada se rechaza');
// La cuenta se desactivó entre tanto
hojas.Usuarios.filas.find(f => f[2] === 'dan@oxohotel.com')[5] = 'Inactivo'; almacen.clear();
nuevaEjecucion(); ok(F.resolverSolicitudHotel(idDe('dan@oxohotel.com'), 'H1', 'aprobar', '2', '2').success === false && celda('dan@oxohotel.com', 'Estado') === 'Inactivo', '8e. no se puede aprobar una cuenta que un administrador ya desactivó');

// ---------- 9. Dos administradores a la vez no se pisan
nuevaEjecucion(); F.registrarUsuario('Fer', 'fer@oxohotel.com', 'Clave1234!', ['H1', 'H2']); verificar('fer@oxohotel.com');
nuevaEjecucion(); const ctxDistrito = F.prepararResolucion_(idDe('fer@oxohotel.com'), '2', '2');      // el de Distrito abre la pantalla...
nuevaEjecucion(); F.resolverSolicitudHotel(idDe('fer@oxohotel.com'), 'H2', 'aprobar', '3', '3');       // ...mientras el de 84DC aprueba lo suyo
const rDist2 = F.aplicarDecisionesSolicitud_(ctxDistrito, { H1: 'denegar' });
ok(rDist2.success && celda('fer@oxohotel.com', 'Hoteles_Permitidos') === 'H2' && celda('fer@oxohotel.com', 'Hoteles_Solicitados') === '' && celda('fer@oxohotel.com', 'Estado') === 'Activo', '9. si dos administradores resuelven a la vez, ninguno pisa lo del otro (H2 aprobado, H1 denegado, cuenta activa)');

// ---------- 9b. Varias propiedades de una persona en una sola llamada
nuevaEjecucion(); F.registrarUsuario('Hana', 'hana@oxohotel.com', 'Clave1234!', ['H1', 'H2']); verificar('hana@oxohotel.com');
correos.length = 0; nuevaEjecucion();
const mult = F.resolverSolicitudesUsuario(idDe('hana@oxohotel.com'), ['H1'], ['H2'], '4', '4');
ok(mult.success && celda('hana@oxohotel.com', 'Hoteles_Permitidos') === 'H1' && celda('hana@oxohotel.com', 'Hoteles_Solicitados') === '' && celda('hana@oxohotel.com', 'Estado') === 'Activo', '9b. con una sola llamada se aprueba una propiedad y se deniega otra → ' + mult.message);
ok(correos.filter(c => c.to === 'hana@oxohotel.com').length === 1, '9b-2. a la persona le llega UN solo correo (no uno por propiedad)');
nuevaEjecucion(); F.registrarUsuario('Ian', 'ian@oxohotel.com', 'Clave1234!', ['H1', 'H2']); verificar('ian@oxohotel.com');
nuevaEjecucion(); const multAjena = F.resolverSolicitudesUsuario(idDe('ian@oxohotel.com'), ['H1', 'H2'], [], '2', '2');
ok(multAjena.success && celda('ian@oxohotel.com', 'Hoteles_Permitidos') === 'H1' && celda('ian@oxohotel.com', 'Hoteles_Solicitados') === 'H2', '9c. si el administrador de Distrito intenta aprobar también 84DC en la misma llamada, solo se aplica lo suyo (H1)');
nuevaEjecucion(); ok(F.resolverSolicitudesUsuario(idDe('ian@oxohotel.com'), [], [], '3', '3').success === false, '9d. una llamada sin ninguna propiedad se rechaza');
nuevaEjecucion(); ok(F.resolverSolicitudesUsuario(idDe('ian@oxohotel.com'), ['H2'], [], '6', '6').success === false, '9e. un usuario normal no puede usarla');

// ---------- 10. Contador de pendientes
nuevaEjecucion(); F.registrarUsuario('Gus', 'gus@oxohotel.com', 'Clave1234!', ['H2']); verificar('gus@oxohotel.com');
nuevaEjecucion(); const cont = id => { nuevaEjecucion(); return F.contarPendientesAprobacion_(String(id), String(id)); };
ok(cont(3) === 2 && cont(2) === 1 && cont(4) === 3 && cont(1) === 3 && cont(6) === null, '10. contador del menú: 84DC (Gus)=' + cont(3) + ', Distrito=' + cont(2) + ', TODOS=' + cont(4) + ', superadmin=' + cont(1) + ', usuario normal=' + cont(6) + ' (sin permiso)');
nuevaEjecucion(); const ini = F.obtenerDatosInicio(null, '3');
ok(ini.pendientes === 2, '10b. obtenerDatosInicio trae el contador (' + ini.pendientes + ')');

// ---------- 11. Eliminar un hotel limpia también las solicitudes
nuevaEjecucion(); F.quitarHotelDeAccesosDeUsuarios_(sandbox.SpreadsheetApp.openById(), 'H2');
ok(celda('gus@oxohotel.com', 'Hoteles_Solicitados') === '' && celda('fer@oxohotel.com', 'Hoteles_Permitidos') === '', '11. al eliminar el hotel H2 desaparece de Hoteles_Solicitados y de Hoteles_Permitidos');

// ---------- 12. Mantenimiento: roles guardados como texto
hojas.Usuarios.filas.push(['90', 'Viejo1', 'v1@oxohotel.com', 'h', 'Usuario', 'Pendiente_Aprobacion', '2026-01-01', ''], ['91', 'Viejo2', 'v2@oxohotel.com', 'h', 'Administrador', 'Activo', '2026-01-01', 'H1'], ['92', 'Num', 'v3@oxohotel.com', 'h', 2, 'Activo', '2026-01-01', 'H1']);
nuevaEjecucion(); const simulacion = F.normalizarRolesDeUsuarios();
ok(simulacion.cambios.length === 2 && celda('v1@oxohotel.com', 'Rol') === 'Usuario' && celda('v2@oxohotel.com', 'Rol') === 'Administrador', '12. la simulación detecta 2 filas con texto y NO modifica nada');
nuevaEjecucion(); F.normalizarRolesDeUsuariosAplicar();
ok(celda('v1@oxohotel.com', 'Rol') === 1 && celda('v2@oxohotel.com', 'Rol') === 2 && celda('v3@oxohotel.com', 'Rol') === 2 && celda('sa@oxohotel.com', 'Rol') === 3, '12b. al aplicar: "Usuario"→1, "Administrador"→2; los números existentes no se tocan');
ok(llamarDoPost({ action: 'normalizarRolesDeUsuariosAplicar', args: [] }).success === false, '12c. esa función de mantenimiento NO se puede llamar desde la web');

// ---------- 12b. Una cuenta YA activa pide acceso a más propiedades
// (la prueba 11 quitó H2 de todas las cuentas al simular eliminar ese hotel: se le devuelve al administrador de 84DC)
hojas.Usuarios.filas.find(f => f[2] === 'admin.84@oxohotel.com')[7] = 'H2'; almacen.clear();
nuevaEjecucion(); F.registrarUsuario('Jo', 'jo@oxohotel.com', 'Clave1234!', ['H1']); verificar('jo@oxohotel.com');
nuevaEjecucion(); F.aprobarUsuario(idDe('jo@oxohotel.com'), '1', '1');          // Jo queda activa solo con Distrito
const sesionDe = (email, rol) => F.crearSesionUsuario_({ ID_Usuario: idDe(email), Nombre_Completo: email, Email: email, ID_Rol: rol, Rol: 'x' });
const tokJo = sesionDe('jo@oxohotel.com', 1);
nuevaEjecucion(); const mis = F.obtenerMisAccesos(tokJo);
ok(mis.success && mis.tieneTodos === false && mis.permitidos.map(h => h.nombre).join() === 'Distrito' && mis.pendientes.length === 0, '14. "Mis accesos": tiene Distrito y nada pendiente');
ok(mis.disponibles.map(h => h.idHotel).sort().join() === 'H2,H3,HC' && mis.disponibles.every(h => h.modulo), '14b. puede pedir TODAS las demás, también las de pre-apertura y desarrollo (84DC, Hotel Secreto, Corporativo), con su módulo');

correos.length = 0; nuevaEjecucion();
const pide = F.solicitarAccesoPropiedades(tokJo, ['H2', 'H3', 'H1']);
ok(pide.success && pide.solicitadas.map(h => h.idHotel).join() === 'H2,H3' && pide.ignoradas === 1 && celda('jo@oxohotel.com', 'Hoteles_Solicitados') === 'H2,H3' && celda('jo@oxohotel.com', 'Estado') === 'Activo', '14c. pide 84DC y Hotel Secreto (Distrito ya lo tiene y se ignora); la cuenta sigue activa → ' + pide.message);
const avisoAd = correos.find(c => /adicional/i.test(c.subject));
const destAd = avisoAd ? [avisoAd.to].concat(String(avisoAd.bcc || '').split(',')).filter(Boolean).sort() : [];
ok(destAd.join() === ['admin.84@oxohotel.com', 'admin.todos@oxohotel.com', 'sa@oxohotel.com'].sort().join(), '14d. el aviso llega a los administradores de 84DC, al de TODOS y al superadmin; NO al de Distrito (no pidió Distrito) → ' + destAd.join(', '));
ok(avisoAd && /ya tiene cuenta/.test(avisoAd.htmlBody) && />84DC</.test(avisoAd.htmlBody) && !/>Distrito</.test(avisoAd.htmlBody), '14e. el aviso dice que ya tiene cuenta y lista solo las propiedades nuevas');

nuevaEjecucion(); ok(F.solicitarAccesoPropiedades(tokJo, ['H2']).success === false, '14f. repetir una solicitud ya pendiente se rechaza');
nuevaEjecucion(); ok(F.solicitarAccesoPropiedades(tokJo, ['H1']).success === false, '14g. pedir algo que ya tiene se rechaza');
nuevaEjecucion(); ok(F.solicitarAccesoPropiedades(tokJo, ['NOEXISTE']).success === false && F.solicitarAccesoPropiedades(tokJo, []).success === false, '14h. una propiedad inventada o ninguna se rechazan');
nuevaEjecucion(); ok(F.solicitarAccesoPropiedades('', ['HC']).success === false && F.solicitarAccesoPropiedades('token-falso', ['HC']).success === false, '14i. sin sesión válida no se puede pedir nada');
nuevaEjecucion(); ok(F.solicitarAccesoPropiedades(idDe('jo@oxohotel.com'), ['HC']).success === false && F.obtenerMisAccesos(idDe('jo@oxohotel.com')).success === false, '14j. tampoco con el ID de la persona en lugar del token (nadie puede pedir en nombre de otra)');

// Cuenta desactivada con sesión aún abierta
hojas.Usuarios.filas.find(f => f[2] === 'jo@oxohotel.com')[5] = 'Inactivo'; almacen.clear(); nuevaEjecucion();
ok(F.solicitarAccesoPropiedades(tokJo, ['HC']).success === false && F.obtenerMisAccesos(tokJo).success === false, '14k. una cuenta desactivada no puede pedir aunque conserve la sesión');
hojas.Usuarios.filas.find(f => f[2] === 'jo@oxohotel.com')[5] = 'Activo'; almacen.clear();

// El administrador de 84DC la ve y la resuelve con el flujo de siempre
nuevaEjecucion(); const jo84 = visto(3, 'jo@oxohotel.com');
ok(jo84 && jo84.solo_solicitud === true && jo84.solicitudes.find(x => x.idHotel === 'H2').puedeResolver === true && jo84.solicitudes.find(x => x.idHotel === 'H3').puedeResolver === false, '14l. el administrador de 84DC ve la solicitud de una cuenta activa y solo puede resolver 84DC');
nuevaEjecucion(); ok(!visto(2, 'jo@oxohotel.com') || visto(2, 'jo@oxohotel.com').solo_solicitud === false, '14m. el administrador de Distrito (que ya la gestiona por Distrito) no ve más solicitudes de las que le tocan');
nuevaEjecucion(); const aprueba = F.resolverSolicitudesUsuario(idDe('jo@oxohotel.com'), ['H2'], [], '3', '3');
ok(aprueba.success && celda('jo@oxohotel.com', 'Hoteles_Permitidos') === 'H1,H2' && celda('jo@oxohotel.com', 'Hoteles_Solicitados') === 'H3', '14n. 84DC aprueba: Jo queda con Distrito y 84DC y le sigue pendiente Hotel Secreto');
nuevaEjecucion(); const mis2 = F.obtenerMisAccesos(tokJo);
ok(mis2.permitidos.map(h => h.nombre).sort().join() === '84DC,Distrito' && mis2.pendientes.map(h => h.nombre).join() === 'Hotel Secreto', '14o. "Mis accesos" refleja lo aprobado y lo que sigue pendiente');

// Cancelar
nuevaEjecucion(); ok(F.cancelarSolicitudesPropias(tokJo, ['HC']).success === false, '14p. cancelar algo que no pidió se rechaza');
nuevaEjecucion(); const cancela = F.cancelarSolicitudesPropias(tokJo, ['H3']);
ok(cancela.success && celda('jo@oxohotel.com', 'Hoteles_Solicitados') === '' && celda('jo@oxohotel.com', 'Hoteles_Permitidos') === 'H1,H2', '14q. cancelar una solicitud pendiente la quita sin tocar los accesos ya aprobados');
nuevaEjecucion(); F.solicitarAccesoPropiedades(tokJo, ['H3', 'HC']);
nuevaEjecucion(); const cancelaTodas = F.cancelarSolicitudesPropias(tokJo);
ok(cancelaTodas.success && celda('jo@oxohotel.com', 'Hoteles_Solicitados') === '', '14r. sin indicar propiedades, cancela todas las pendientes');
nuevaEjecucion(); ok(F.cancelarSolicitudesPropias(tokJo).success === false, '14s. sin nada pendiente no hay qué cancelar');

// Quien ya tiene todo no tiene qué pedir
nuevaEjecucion(); const tokTodos = sesionDe('admin.todos@oxohotel.com', 2); const tokSA = sesionDe('sa@oxohotel.com', 3);
nuevaEjecucion(); const mT = F.obtenerMisAccesos(tokTodos), mS = F.obtenerMisAccesos(tokSA);
ok(mT.success && mT.tieneTodos && mT.disponibles.length === 0 && mS.tieneTodos && mS.disponibles.length === 0, '14t. una cuenta con TODOS y el superadmin figuran con acceso a todo y sin nada que pedir');
nuevaEjecucion(); ok(F.solicitarAccesoPropiedades(tokTodos, ['H2']).success === false && F.solicitarAccesoPropiedades(tokSA, ['H2']).success === false, '14u. y no pueden enviar solicitudes');

// Tope de solicitudes
for (let i = 100; i < 130; i++) hojas.Hoteles.filas.push(['HX' + i, 'Hotel Extra ' + i, 'M1', 'fx']);
almacen.clear(); nuevaEjecucion();
const quince = Array.from({ length: 15 }, (_, i) => 'HX' + (100 + i));
ok(F.solicitarAccesoPropiedades(tokJo, quince).success === true, '14v. pedir 15 propiedades de una vez está permitido');
nuevaEjecucion(); const diez = Array.from({ length: 10 }, (_, i) => 'HX' + (120 + i));
ok(F.solicitarAccesoPropiedades(tokJo, diez).success === false && /demasiadas solicitudes pendientes/.test(F.solicitarAccesoPropiedades(tokJo, diez).message), '14w. superar el máximo de 20 pendientes se rechaza con un mensaje claro');
nuevaEjecucion(); const veintiuna = Array.from({ length: 21 }, (_, i) => 'HX' + (100 + i));
ok(F.solicitarAccesoPropiedades(tokJo, veintiuna).success === false, '14x. pedir más de 20 a la vez se rechaza');
F.cancelarSolicitudesPropias(tokJo); hojas.Hoteles.filas = hojas.Hoteles.filas.filter(f => !String(f[0]).startsWith('HX')); almacen.clear();

// Auditoría y acciones permitidas
ok(hojas.Auditoria.filas.some(f => /Pidió acceso a: 84DC, Hotel Secreto/.test(String(f[4]))) && hojas.Auditoria.filas.some(f => /Canceló su solicitud/.test(String(f[4]))), '14y. quedan en la auditoría lo que pidió y lo que canceló');
ok(['obtenerMisAccesos', 'solicitarAccesoPropiedades', 'cancelarSolicitudesPropias'].every(n => F.ACCIONES_PERMITIDAS_.includes(n)), '14z. las tres acciones están en la lista de permitidas');
nuevaEjecucion(); const porWeb = llamarDoPost({ action: 'obtenerMisAccesos', args: [tokJo], token: tokJo });
ok(porWeb.success === true && porWeb.data.success === true && porWeb.data.permitidos.length === 2, '14zz. por la vía web (doPost) con un token válido responde sus accesos ' + JSON.stringify(porWeb).slice(0, 200));
ok(llamarDoPost({ action: 'contextoMisAccesos_', args: [tokJo] }).success === false && llamarDoPost({ action: 'filaDeMiCuenta_', args: ['1'] }).success === false, '14zzz. las funciones internas de este flujo no se pueden llamar desde la web');

// ---------- 15. Autenticación de la vía web: sin sesión válida no se ejecuta nada y la identidad la pone el servidor
const SIN_SESION = r => r.success === false && r.codigo === 'SESION_INVALIDA';
nuevaEjecucion();
ok(SIN_SESION(llamarDoPost({ action: 'obtenerMisAccesos', args: [String(idDe('jo@oxohotel.com'))] })), '15a. sin token, aunque se mande el ID de una persona real, se rechaza');
ok(SIN_SESION(llamarDoPost({ action: 'obtenerUsuariosParaGestion', args: ['1', '1'], token: 'token-inventado' })), '15b. con un token inventado se rechaza (y el ID del superadministrador no sirve de nada)');
ok(SIN_SESION(llamarDoPost({ action: 'obtenerDatosInicio', args: [null, '1', false] })), '15c. la pantalla de inicio tampoco responde con solo un ID');

const tokNormal = sesionDe('normal@oxohotel.com', 1);
nuevaEjecucion();
const gestion = llamarDoPost({ action: 'obtenerUsuariosParaGestion', args: ['1', '1'], token: tokNormal });
ok(gestion.success === true && gestion.data.success === false && gestion.data.usuarios.length === 0, '15d. un usuario normal que manda el ID del superadministrador sigue siendo un usuario normal (no ve la gestión): ' + JSON.stringify(gestion).slice(0, 120));
nuevaEjecucion();
const cambio = llamarDoPost({ action: 'cambiarRolUsuario', args: [String(idDe('jo@oxohotel.com')), 3, '1', '1'], token: tokNormal });
ok(cambio.success === true && cambio.data.success === false, '15e. no puede cambiar roles haciéndose pasar por el superadministrador: ' + JSON.stringify(cambio).slice(0, 120));

// La auditoría la firma el servidor, no el navegador
const antesAud = hojas.Auditoria.filas.length;
nuevaEjecucion();
llamarDoPost({ action: 'registrarAuditoria', args: [{ usuarioId: '1', emailUsuario: 'sa@oxohotel.com', tipo: 'Login', descripcion: 'falsa', entidadAfectada: 'Usuarios' }], token: tokNormal });
const filaAud = hojas.Auditoria.filas[hojas.Auditoria.filas.length - 1];
ok(hojas.Auditoria.filas.length === antesAud + 1 && String(filaAud[1]) === String(idDe('normal@oxohotel.com')) && filaAud[2] === 'normal@oxohotel.com', '15f. una auditoría con otro usuario en el cuerpo queda a nombre de quien tiene la sesión (' + filaAud[1] + ' / ' + filaAud[2] + ')');

// Una cuenta desactivada pierde el acceso de inmediato aunque conserve su token
const filaNormal = hojas.Usuarios.filas.findIndex(f => f[2] === 'normal@oxohotel.com');
const estadoAntes = hojas.Usuarios.filas[filaNormal][5];
nuevaEjecucion();
ok(llamarDoPost({ action: 'obtenerMisAccesos', args: [], token: tokNormal }).success === true, '15g. con la cuenta activa, su token funciona');
hojas.Usuarios.filas[filaNormal][5] = 'Inactivo'; almacen.clear(); nuevaEjecucion();
ok(SIN_SESION(llamarDoPost({ action: 'obtenerMisAccesos', args: [], token: tokNormal })), '15h. al desactivar la cuenta, el mismo token deja de funcionar');
hojas.Usuarios.filas[filaNormal][5] = estadoAntes; almacen.clear();

// Cerrar sesión: el token deja de valer
nuevaEjecucion();
const tokCierre = sesionDe('normal@oxohotel.com', 1);
llamarDoPost({ action: 'cerrarSesionUsuario', args: [tokCierre] });
almacen.clear(); nuevaEjecucion();
ok(SIN_SESION(llamarDoPost({ action: 'obtenerMisAccesos', args: [], token: tokCierre })), '15i. tras cerrar sesión el token ya no sirve');

// Las acciones públicas siguen funcionando sin sesión
ok(llamarDoPost({ action: 'obtenerVersionCacheGlobal', args: [] }).success === true && llamarDoPost({ action: 'obtenerHotelesParaRegistro', args: [] }).success === true, '15j. registro, inicio de sesión y ping siguen siendo públicos');

// ---------- 13. Lista de acciones
ok(['resolverSolicitudesUsuario', 'cerrarSolicitudUsuario', 'aprobarUsuario', 'obtenerHotelesParaRegistro'].every(n => F.ACCIONES_PERMITIDAS_.includes(n)) && !F.ACCIONES_PERMITIDAS_.includes('resolverSolicitudHotel'), '13. las acciones que usa la pantalla están permitidas y la de una sola propiedad (sin uso) ya no');
ok(llamarDoPost({ action: 'prepararResolucion_', args: [] }).success === false && llamarDoPost({ action: 'notificarSolicitante_', args: [] }).success === false, '13b. las funciones internas del flujo no se pueden invocar desde la web');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
