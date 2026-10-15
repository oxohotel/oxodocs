// Prueba la regla de alcance de administradores (usuarios, acciones y logs) con hojas simuladas.
const fs = require('fs');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..', 'backend') + '/';

class Hoja {
  constructor(nombre, filas) { this.nombre = nombre; this.filas = filas.map(f => f.slice()); }
  getDataRange() { const s = this; return { getValues: () => s.filas.map(f => f.slice()) }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas[0].length; }
  appendRow(fila) { this.filas.push(fila.slice()); }
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      setValue(v) { s.filas[r - 1][c - 1] = v; },
      setValues(vals) { vals.forEach((fila, i) => fila.forEach((v, j) => { s.filas[r - 1 + i][c - 1 + j] = v; })); },
      getValues() { const out = []; for (let i = 0; i < nr; i++) out.push(s.filas[r - 1 + i].slice(c - 1, c - 1 + nc)); return out; }
    };
  }
}

const COLS = ['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'];
const U = (id, nombre, email, rol, hoteles) => [id, nombre, email, 'hash0', rol, 'Activo', '2026-01-01', hoteles];
const hojas = {
  Usuarios: new Hoja('Usuarios', [COLS,
    U(1, 'SA', 'sa@x.com', 3, ''), U(2, 'AdminA', 'admina@x.com', 2, '1,2'), U(3, 'AdminB', 'adminb@x.com', 2, '3'),
    U(4, 'AdminG', 'adming@x.com', 2, 'TODOS'), U(5, 'U1', 'u1@x.com', 1, '1'), U(6, 'U2', 'u2@x.com', 1, '2,3'),
    U(7, 'U3', 'u3@x.com', 1, '3'), U(8, 'U4', 'u4@x.com', 1, 'TODOS'), U(9, 'U5', 'u5@x.com', 1, ''),
    U(10, 'SA2', 'sa2@x.com', 3, '1,2'), U(11, 'AdminC', 'adminc@x.com', 2, ''), U(12, 'Mariana', 'mariana@x.com', 1, '3'),
    U(13, 'Ana', 'ana@x.com', 1, '1')]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado'],
    [1, 2, 'admina@x.com', 'Login', 'Inicio de sesión exitoso', 'Usuario', new Date('2026-10-01T10:00:00'), 'Exitosa'],        // AdminA
    [2, 5, '', 'SUBIR', 'Subió un archivo', 'Archivo', new Date('2026-10-01T11:00:00'), 'Exitosa'],                          // U1 (por id)
    [3, 7, 'u3@x.com', 'Login', 'Inicio de sesión exitoso', 'Usuario', new Date('2026-10-01T12:00:00'), 'Exitosa'],          // U3 (de B)
    [4, 1, 'sa@x.com', 'GESTION_ACCESOS', 'Asignó accesos de hoteles a u1@x.com: 1', 'Usuario', new Date('2026-10-01T13:00:00'), 'Exitosa'], // SA sobre U1
    [5, 1, 'sa@x.com', 'GESTION_ACCESOS', 'Asignó accesos de hoteles a u3@x.com: 3', 'Usuario', new Date('2026-10-01T14:00:00'), 'Exitosa'], // SA sobre U3
    [6, 1, 'sa@x.com', 'RESET', 'Restableció la contraseña del usuario mariana@x.com', 'Usuario', new Date('2026-10-01T15:00:00'), 'Exitosa'], // sobre Mariana (de B)
    [7, 1, 'sa@x.com', 'CREAR_HOTEL', 'Creó el hotel "X"', 'Hotel', new Date('2026-10-01T16:00:00'), 'Exitosa'],              // SA a solas
    [8, '', 'ana@x.com', 'Login', 'Inicio de sesión fallido', 'Usuario', new Date('2026-10-01T17:00:00'), 'Fallida'],        // actor por email (Ana, de A)
    [9, 12, 'mariana@x.com', 'Login', 'Inicio de sesión exitoso', 'Usuario', new Date('2026-10-01T18:00:00'), 'Exitosa'],    // Mariana (de B)
    [10, 4, 'adming@x.com', 'Login', 'Inicio de sesión exitoso', 'Usuario', new Date('2026-10-01T19:00:00'), 'Exitosa']])    // AdminG
};
const auditoria = [];
const sandbox = {
  console, Logger: { log: () => {} },
  SpreadsheetApp: { flush() {}, openById: () => ({ getSheetByName: n => hojas[n] || null }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-02' },
  registrarAuditoriaSimple_: (u, a, d) => auditoria.push([String(u), a, d]),
  calcularHashContrasenaConSalt_: p => 'HASH(' + p + ')',
  obtenerOAgregarColumna_: (hoja, nombre) => hoja.filas[0].indexOf(nombre)
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'Usuario.js', 'Roles.js', 'AlcanceAdmin.js', 'Logs.js'].forEach(f => vm.runInContext(fs.readFileSync(REPO + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext('this.F={obtenerUsuariosParaGestion,cambiarEstadoUsuario,restablecerContrasenaUsuarioPorAdmin,asignarHotelesAUsuario,crearUsuarioPorAdmin,obtenerRegistrosAuditoria}', sandbox);
const F = sandbox.F;

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const celda = (id, col) => { const h = hojas.Usuarios.filas; const f = h.find(r => String(r[0]) === String(id)); return f[h[0].indexOf(col)]; };
const ids = r => r.usuarios.map(u => Number(u.id)).sort((a, b) => a - b).join(',');

// ---------- 1. Lista de usuarios ----------
ok(ids(F.obtenerUsuariosParaGestion('1')) === '1,2,3,4,5,6,7,8,9,10,11,12,13', 'superadmin ve a los 13');
ok(ids(F.obtenerUsuariosParaGestion('2')) === '2,5,6,13', 'AdminA (hoteles 1,2) ve: él, U1, U2 y Ana → ' + ids(F.obtenerUsuariosParaGestion('2')));
ok(ids(F.obtenerUsuariosParaGestion('3')) === '3,6,7,12', 'AdminB (hotel 3) ve: él, U2, U3 y Mariana → ' + ids(F.obtenerUsuariosParaGestion('3')));
ok(ids(F.obtenerUsuariosParaGestion('4')) === '2,3,4,5,6,7,8,9,11,12,13', 'AdminG (TODOS) ve a todos MENOS a los superadmins → ' + ids(F.obtenerUsuariosParaGestion('4')));
ok(ids(F.obtenerUsuariosParaGestion('11')) === '11', 'AdminC (sin hoteles) solo se ve a sí mismo');
ok(!ids(F.obtenerUsuariosParaGestion('2')).split(',').includes('8') && !ids(F.obtenerUsuariosParaGestion('2')).split(',').includes('10'), 'AdminA no ve cuentas con TODOS ni al superadmin que comparte hotel');
ok(F.obtenerUsuariosParaGestion('5').success === false, 'un usuario normal no puede listar usuarios');

// ---------- 2. Acciones ----------
const pass = (id, obj) => F.restablecerContrasenaUsuarioPorAdmin(obj, 'nuevaclave1', id);
ok(pass('2', 10).success === false, 'AdminA NO puede restablecer la contraseña de un superadmin: ' + pass('2', 10).message);
ok(pass('2', 1).success === false, 'AdminA NO puede restablecer la del superadmin principal');
ok(pass('2', 7).success === false, 'AdminA NO puede restablecer la de un usuario de otra propiedad');
ok(pass('2', 8).success === false, 'AdminA NO puede restablecer la de una cuenta con TODOS');
ok(pass('2', 5).success === true && celda(5, 'Contraseña_Hash') === 'HASH(nuevaclave1)', 'AdminA SÍ puede restablecer la de U1 (su propiedad)');
ok(pass('2', 2).success === true, 'AdminA puede restablecer la propia');
ok(pass('4', 1).success === false && pass('4', 10).success === false, 'AdminG (TODOS) tampoco puede tocar a un superadmin');
ok(pass('4', 7).success === true, 'AdminG (TODOS) sí puede con cualquier usuario no-superadmin');
ok(pass('1', 7).success === true && pass('1', 10).success === true, 'superadmin puede con todos');

ok(F.cambiarEstadoUsuario(1, 'Inactivo', '2').success === false && celda(1, 'Estado') === 'Activo', 'AdminA NO puede desactivar a un superadmin');
ok(F.cambiarEstadoUsuario(7, 'Inactivo', '2').success === false, 'AdminA NO puede desactivar a un usuario de otra propiedad');
ok(F.cambiarEstadoUsuario(5, 'Inactivo', '2').success === true && celda(5, 'Estado') === 'Inactivo', 'AdminA sí puede desactivar a U1');
F.cambiarEstadoUsuario(5, 'Activo', '2');

ok(F.asignarHotelesAUsuario(5, 'TODOS', '2').success === true && celda(5, 'Hoteles_Permitidos') === '1,2', 'AdminA asigna "TODOS" a U1 → se limita a SUS hoteles (1,2): ' + celda(5, 'Hoteles_Permitidos'));
ok(F.asignarHotelesAUsuario(5, ['1'], '2').success === true && celda(5, 'Hoteles_Permitidos') === '1', 'AdminA asigna solo el hotel 1');
ok(F.asignarHotelesAUsuario(5, '1,3', '2').success === false && celda(5, 'Hoteles_Permitidos') === '1', 'AdminA NO puede asignar un hotel que no es suyo (3)');
ok(F.asignarHotelesAUsuario(2, 'TODOS', '2').success === true && celda(2, 'Hoteles_Permitidos') === '1,2', 'AdminA no puede darse TODOS a sí mismo (queda 1,2)');
ok(F.asignarHotelesAUsuario(7, '3', '2').success === false, 'AdminA NO puede asignar hoteles a un usuario ajeno');
ok(F.asignarHotelesAUsuario(10, '1', '2').success === false, 'AdminA NO puede tocar los hoteles de un superadmin');
ok(F.asignarHotelesAUsuario(5, 'TODOS', '4').success === true && celda(5, 'Hoteles_Permitidos') === 'TODOS', 'AdminG (TODOS) sí puede asignar TODOS');
F.asignarHotelesAUsuario(5, '1', '1');
ok(F.asignarHotelesAUsuario(9, '1,2,3,4,5', '1').success === true, 'superadmin asigna cualquier lista');

let r = F.crearUsuarioPorAdmin({ nombre: 'Nuevo', email: 'nuevo1@x.com', password: 'abcdef', hoteles: 'TODOS' }, '2');
const filaN1 = hojas.Usuarios.filas[hojas.Usuarios.filas.length - 1];
ok(r.success && filaN1[7] === '1,2', 'AdminA crea usuario con "TODOS" → se guarda con SUS hoteles (1,2): ' + filaN1[7]);
r = F.crearUsuarioPorAdmin({ nombre: 'Nuevo', email: 'nuevo2@x.com', password: 'abcdef', hoteles: '1,4' }, '2');
ok(r.success === false, 'AdminA no puede crear un usuario con un hotel ajeno: ' + r.message);
r = F.crearUsuarioPorAdmin({ nombre: 'Nuevo', email: 'nuevo3@x.com', password: 'abcdef', hoteles: '1', rolId: 2 }, '2');
ok(r.success === false, 'AdminA sigue sin poder crear administradores');
r = F.crearUsuarioPorAdmin({ nombre: 'Nuevo', email: 'nuevo4@x.com', password: 'abcdef', hoteles: 'TODOS', rolId: 2 }, '1');
ok(r.success === true && hojas.Usuarios.filas[hojas.Usuarios.filas.length - 1][7] === 'TODOS', 'superadmin crea administrador con TODOS');

// ---------- 3. Logs ----------
const idsLog = res => res.registros.map(x => x.id).sort((a, b) => a - b).join(',');
ok(idsLog(F.obtenerRegistrosAuditoria('1', 200)) === '1,2,3,4,5,6,7,8,9,10', 'superadmin ve los 10 registros');
ok(idsLog(F.obtenerRegistrosAuditoria('2', 200)) === '1,2,4,8', 'AdminA ve: login propio(1), U1(2), lo que el SA hizo sobre U1(4) y a Ana por correo(8) → ' + idsLog(F.obtenerRegistrosAuditoria('2', 200)));
ok(idsLog(F.obtenerRegistrosAuditoria('3', 200)) === '3,5,6,9', 'AdminB ve: U3(3), SA→U3(5), SA→Mariana(6) y Mariana(9) → ' + idsLog(F.obtenerRegistrosAuditoria('3', 200)));
ok(!idsLog(F.obtenerRegistrosAuditoria('2', 200)).split(',').includes('6'), '"ana@x.com" NO coincide dentro de "mariana@x.com" (AdminA no ve el registro 6)');
ok(!idsLog(F.obtenerRegistrosAuditoria('2', 200)).split(',').includes('7'), 'las acciones del superadmin sin relación con sus usuarios no aparecen');
ok(idsLog(F.obtenerRegistrosAuditoria('11', 200)) === '', 'AdminC (sin hoteles) no ve registros ajenos');
ok(idsLog(F.obtenerRegistrosAuditoria('4', 200)) === '1,2,3,4,5,6,8,9,10', 'AdminG (TODOS) ve todo lo de usuarios no-superadmin y lo hecho sobre ellos (no la acción 7 del SA a solas)');
ok(F.obtenerRegistrosAuditoria('5', 200).success === false, 'un usuario normal no puede ver logs');
ok(F.obtenerRegistrosAuditoria('2', 2).registros.length === 2, 'el límite se aplica después de filtrar');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fallos ? 1 : 0);
