// Caché de carpetas y archivos (backend/CacheArchivos.js): menos lecturas de hoja, resultados idénticos y, sobre todo, nunca datos viejos
// después de un cambio hecho desde la aplicación.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..') + '/';

const lecturas = { Carpetas: 0, Archivos: 0, Permisos_Archivos: 0, Hoteles: 0, Modulos: 0, Favoritos: 0, Actividad_Reciente: 0 };
let alLeerArchivos = null; // gancho: se ejecuta en medio de una lectura de la hoja Archivos (para simular una carrera)
class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); }
  ancho() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); }
  pad(f) { const o = f.slice(); while (o.length < this.ancho()) o.push(''); return o; }
  getDataRange() { const s = this; return { getValues: () => { if (s.nombre in lecturas) lecturas[s.nombre]++; if (s.nombre === 'Archivos' && alLeerArchivos) { const g = alLeerArchivos; alLeerArchivos = null; g(); } return s.filas.map(f => s.pad(f)); } }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.ancho(); }
  appendRow(f) { this.filas.push(f.slice()); }
  deleteRow(n) { this.filas.splice(n - 1, 1); }
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

const U = (id, nombre, email, rol, hoteles) => [id, nombre, email, 'h', rol, 'Activo', '2026-01-01', hoteles];
const FECHA = new Date(2026, 5, 1, 10, 0, 0);
const hojas = {
  Usuarios: new Hoja('Usuarios', [['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'],
    U(1, 'SA', 'sa@x.com', 3, ''), U(5, 'Normal', 'n@x.com', 1, 'H1'), U(6, 'Otro', 'o@x.com', 1, 'H1')]),
  Roles: new Hoja('Roles', [['ID_Rol', 'Nombre_Rol']]),
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre_Modulo', 'Orden'], ['M1', 'Operación', 1]]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'DriveFolderId'], ['H1', 'Distrito', 'M1', 'fa'], ['H2', '84DC', 'M1', 'fb']]),
  Carpetas: new Hoja('Carpetas', [['ID_Carpeta', 'ID_Hotel', 'ID_Plantilla', 'Nombre_Carpeta', 'DriveFolderId', 'Fecha_Creacion', 'ID_Padre'],
    ['C1', 'H1', '', 'IT', 'd1', FECHA, ''], ['C2', 'H1', '', 'CAF', 'd2', FECHA, ''], ['C3', 'H1', '', 'Presupuestos', 'd3', FECHA, 'C1'], ['C4', 'H1', '', 'Borradores', 'd4', FECHA, 'C3'], ['C9', 'H2', '', 'IT 84DC', 'd9', FECHA, '']]),
  Archivos: new Hoja('Archivos', [['ID_Archivo', 'ID_Carpeta', 'DriveFileId', 'Nombre_Archivo', 'Extension', 'Tipo_Documento', 'Estado_Documento', 'Responsable', 'MimeType', 'DriveUrl', 'Fecha_Creacion', 'Fecha_Modificacion', 'Fecha_Sincronizacion', 'Tamaño_Bytes'],
    ['A1', 'C1', 'df1', 'contrato.pdf', 'pdf', 'PDF', 'Activo', 'Ana', 'application/pdf', 'u1', FECHA, FECHA, FECHA, 1000],
    ['A2', 'C1', 'df2', 'secreto.pdf', 'pdf', 'PDF', 'Activo', 'Ana', 'application/pdf', 'u2', FECHA, new Date(2026, 6, 1), FECHA, 2000],
    ['A3', 'C3', 'df3', 'presupuesto.xlsx', 'xlsx', 'Excel', 'Activo', 'Ana', 'x', 'u3', FECHA, FECHA, FECHA, 500]]),
  Permisos_Archivos: new Hoja('Permisos_Archivos', [['ID', 'ID_Archivo', 'ID_Usuario'], [1, 'A2', 5]]),
  Favoritos: new Hoja('Favoritos', [['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado'],
    ['F1', 6, 'Hotel', 'H1', new Date(2026, 6, 1)], ['F2', 6, 'Carpeta', 'C1', new Date(2026, 6, 2)], ['F3', 5, 'Archivo', 'A1', new Date(2026, 6, 3)], ['F4', 6, 'Archivo', 'A1', new Date(2026, 6, 4)]]),
  Actividad_Reciente: new Hoja('Actividad_Reciente', [['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora']]),
  Sesiones: new Hoja('Sesiones', [['ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado']]),
  Auditoria: new Hoja('Auditoria', [['ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado']])
};

const sandbox = {
  console, Logger: { log: () => {} }, Date, Math, JSON, Set,
  SpreadsheetApp: { flush() { sandbox.__flushes++; }, openById: () => ({ getSheetByName: n => hojas[n] || null, insertSheet: n => (hojas[n] = new Hoja(n, [])) }) }, __flushes: 0,
  CacheService: CacheServiceMock,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  LockService: { getScriptLock: () => ({ hasLock() { return false; }, waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-10-16', getUuid: () => 'uuid-' + Math.random(), base64Encode: () => 'h' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), computeDigest: () => [1], DigestAlgorithm: { SHA_256: 'x' } },
  ContentService: { createTextOutput: t => ({ texto: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  DriveApp: { getFileById: () => ({ getSize: () => 1 }) }
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'CacheArchivos.js', 'Metricas.js', 'Acceso.js', 'Roles.js', 'Usuario.js', 'Recursos.js', 'Carpetas.js', 'Archivos.js', 'Permisos.js', 'Favoritos.js', 'Actividad.js', 'Auth.js']
  .forEach(f => vm.runInContext(fs.readFileSync(REPO + 'backend/' + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(REPO + 'Code.js', 'utf8'), sandbox, { filename: 'Code.js' });
vm.runInContext(`
  var __ejecutadas = [];
  // Acciones simuladas que escriben en las hojas (el cuerpo real toca Drive); el despachador real decide si invalida el caché
  function renombrarCarpeta(id, nombre) { var h = SpreadsheetApp.openById('x').getSheetByName('Carpetas'); var f = h.filas.find(function (r) { return r[0] === id; }); f[3] = nombre; __ejecutadas.push('renombrarCarpeta'); return { success: true }; }
  function guardarArchivoEnDrive(idCarpeta, nombre) { var h = SpreadsheetApp.openById('x').getSheetByName('Archivos'); h.filas.push(['A' + (h.filas.length + 1), idCarpeta, 'df' + h.filas.length, nombre, 'pdf', 'PDF', 'Activo', 'Ana', 'application/pdf', 'u', new Date(), new Date(), new Date(), 700]); return { success: true }; }
  function actualizarPermisosExistentes(idArchivo, idUsuario, restringidos) { var h = SpreadsheetApp.openById('x').getSheetByName('Permisos_Archivos'); h.filas = [h.filas[0]]; restringidos.forEach(function (u, i) { h.filas.push([i + 2, idArchivo, u]); }); return { success: true }; }
  function accionNuevaQueEscribe(idCarpeta) { var h = SpreadsheetApp.openById('x').getSheetByName('Carpetas'); h.filas.find(function (r) { return r[0] === idCarpeta; })[3] = 'Cambiada por una acción nueva'; return { success: true }; }
  ACCIONES_PERMITIDAS_.push('accionNuevaQueEscribe');
  this.F = { obtenerFavoritosDetallados, obtenerIdsFavoritosUsuario, obtenerActividadReciente, registrarActividad, alternarFavorito, obtenerContenidoCarpeta, obtenerCarpetasDelHotel, obtenerRutaCarpeta, crearSesionUsuario_, refrescarCachesForzado_, generacionArchivosFresca_, accionInvalidaCacheDeArchivos_, ACCIONES_PERMITIDAS_, ACCIONES_QUE_NO_TOCAN_ARCHIVOS_, invalidarCacheArchivos_ };
`, sandbox);
const F = sandbox.F;
const nuevaEjecucion = () => vm.runInContext('_memoCache_={};_spreadsheetEjecucion_=null;_cacheIndiceHojas_={};_genArchivos_=null;_lecturasDeHoja_=0', sandbox);
const llamarDoPost = p => { nuevaEjecucion(); sandbox.__e = { postData: { contents: JSON.stringify(p) } }; return JSON.parse(vm.runInContext('doPost(__e)', sandbox).texto); };
const sesion = id => { const u = hojas.Usuarios.filas.find(f => String(f[0]) === String(id)); return F.crearSesionUsuario_({ ID_Usuario: id, Nombre_Completo: u[1], Email: u[2], ID_Rol: u[4], Rol: 'x' }); };
const reset = () => Object.keys(lecturas).forEach(k => { lecturas[k] = 0; });
const totalLecturas = () => lecturas.Carpetas + lecturas.Archivos + lecturas.Permisos_Archivos + lecturas.Hoteles + lecturas.Favoritos + lecturas.Actividad_Reciente;
const abrir = (idCarpeta, idUsuario) => { nuevaEjecucion(); return F.obtenerContenidoCarpeta(idCarpeta, idUsuario); };
const nombres = r => r.archivos.map(a => a.nombre).join(',');

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

// ---------- 1. Menos lecturas, mismo resultado
reset(); const frio = abrir('C1', '6');
const lecFrio = totalLecturas();
ok(frio.success && nombres(frio) === 'contrato.pdf,secreto.pdf' && frio.subcarpetas.map(s => s.nombre).join() === 'Presupuestos', '1. la primera apertura (sin caché) devuelve archivos y subcarpetas correctos: ' + nombres(frio));
reset(); const tibio = abrir('C1', '6');
ok(totalLecturas() === 0, '1b. la segunda apertura, en otra ejecución, no lee NINGUNA hoja (antes: ' + lecFrio + ' lecturas por apertura; ahora ' + totalLecturas() + ')');
ok(JSON.stringify(tibio) === JSON.stringify(frio), '1c. el resultado desde el caché es idéntico al de la lectura directa');
reset(); abrir('C2', '6'); abrir('C1', '6');
ok(lecturas.Carpetas === 0 && lecturas.Hoteles === 0 && lecturas.Permisos_Archivos === 0, '1d. abrir otra carpeta reutiliza lo ya guardado de Carpetas, Hoteles y permisos (solo lee la lista de archivos de la carpeta nueva: ' + lecturas.Archivos + ' lectura)');
reset(); abrir('C2', '6');
ok(totalLecturas() === 0, '1e. y volver a una carpeta ya vista no lee nada');
ok(frio.carpetaActual && frio.carpetaActual.nombre === 'IT' && frio.carpetaActual.nombreHotel === 'Distrito' && frio.carpetaActual.idHotel === 'H1', '1f. los datos de la carpeta actual (nombre y propiedad) salen sin leer más hojas');
const soloUna = frio.subcarpetas[0];
ok(soloUna.cantidad === 1 && soloUna.tamanoTotal === 500 && typeof soloUna.fechaUltimaActividad === 'string', '1g. el resumen de cada subcarpeta (cantidad, tamaño, última actividad) viene calculado y como texto');

// ---------- 2. Filtro por persona sin contaminar el caché compartido
const paraNormal = abrir('C1', '5');
ok(nombres(paraNormal) === 'contrato.pdf', '2. una persona con un archivo restringido no lo ve: ' + nombres(paraNormal));
const paraOtro = abrir('C1', '6');
ok(nombres(paraOtro) === 'contrato.pdf,secreto.pdf', '2b. otra persona sigue viéndolo (el filtro de la anterior no alteró la lista guardada)');
nuevaEjecucion(); const a = F.obtenerContenidoCarpeta('C1', '5'); const b = F.obtenerContenidoCarpeta('C1', '6');
ok(nombres(a) === 'contrato.pdf' && nombres(b) === 'contrato.pdf,secreto.pdf', '2c. ni siquiera dentro de una misma ejecución (memoria compartida) se contaminan');

// ---------- 3. Los cambios desde la aplicación se ven al instante
abrir('C1', '6'); const gen0 = F.generacionArchivosFresca_();
llamarDoPost({ action: 'renombrarCarpeta', args: ['C3', 'Presupuestos 2027'], token: sesion(1) });
ok(F.generacionArchivosFresca_() !== gen0, '3. una acción que modifica carpetas invalida el caché (sube la generación)');
reset(); const trasRenombrar = abrir('C1', '6');
ok(trasRenombrar.subcarpetas[0].nombre === 'Presupuestos 2027', '3b. la siguiente apertura ya muestra el nombre nuevo');
ok(lecturas.Carpetas === 1, '3c. y esa apertura vuelve a leer la hoja Carpetas una sola vez');

llamarDoPost({ action: 'guardarArchivoEnDrive', args: ['C1', 'nuevo.pdf'], token: sesion(1) });
ok(nombres(abrir('C1', '6')) === 'contrato.pdf,secreto.pdf,nuevo.pdf', '3d. un archivo recién subido aparece de inmediato');
const resumenC1 = abrir('C1', '6'); const carpetasHotel = (nuevaEjecucion(), F.obtenerCarpetasDelHotel('H1', null, '6'));
ok(carpetasHotel.success && carpetasHotel.carpetas.find(c => c.id === 'C1').cantidad === 3, '3e. y el total de archivos de la tarjeta de la carpeta también se actualiza (3)');

llamarDoPost({ action: 'actualizarPermisosExistentes', args: ['A2', '1', ['6']], token: sesion(1) });
ok(nombres(abrir('C1', '6')) === 'contrato.pdf,nuevo.pdf' && nombres(abrir('C1', '5')) === 'contrato.pdf,secreto.pdf,nuevo.pdf', '3f. cambiar las restricciones de un archivo se refleja de inmediato en cada persona');

llamarDoPost({ action: 'accionNuevaQueEscribe', args: ['C2'], token: sesion(1) });
ok(abrir('C1', '6').success && (nuevaEjecucion(), F.obtenerCarpetasDelHotel('H1', null, '6')).carpetas.find(c => c.id === 'C2').nombre === 'Cambiada por una acción nueva', '3g. una acción NUEVA que nadie declaró invalida por defecto (no hay que acordarse de registrarla)');

const antesAct = F.generacionArchivosFresca_();
llamarDoPost({ action: 'registrarActividad', args: ['6', 'Carpeta', 'C1', 'Abrir'], token: sesion(6) });
ok(F.generacionArchivosFresca_() === antesAct, '3h. registrar actividad (la más frecuente) NO invalida ni paga el flush');
ok(F.accionInvalidaCacheDeArchivos_('obtenerContenidoCarpeta') === false && F.accionInvalidaCacheDeArchivos_('crearSubcarpeta') === true && F.accionInvalidaCacheDeArchivos_('eliminarHotel') === true, '3i. las lecturas no invalidan; crear carpeta y eliminar propiedad sí');
ok(F.ACCIONES_QUE_NO_TOCAN_ARCHIVOS_.every(x => F.ACCIONES_PERMITIDAS_.includes(x)), '3j. toda acción de la lista "no toca archivos" existe de verdad (sin nombres con errores de escritura)');
const flushesAntes = sandbox.__flushes; llamarDoPost({ action: 'renombrarCarpeta', args: ['C3', 'X'], token: sesion(1) });
ok(sandbox.__flushes > flushesAntes, '3k. antes de invalidar se fuerza la escritura pendiente (flush), para que nadie guarde la hoja vieja como nueva');

// ---------- 4. Carreras y vencimiento
abrir('C1', '6'); F.invalidarCacheArchivos_();
alLeerArchivos = () => F.invalidarCacheArchivos_(); // alguien cambia algo MIENTRAS esta ejecución lee la hoja
abrir('C1', '6');
reset(); abrir('C1', '6');
ok(lecturas.Archivos >= 1, '4. una lectura que quedó vieja por un cambio en medio NO se guarda (la siguiente apertura vuelve a leer)');
abrir('C1', '6'); reset(); reloj += 301 * 1000; abrir('C1', '6');
ok(lecturas.Carpetas >= 1, '4b. pasados 5 minutos el caché vence solo (cubre las ediciones manuales de la hoja)');

// ---------- 5. Un error de lectura no se guarda
const archivosGuardados = hojas.Archivos; delete hojas.Archivos; F.invalidarCacheArchivos_();
const sinHoja = abrir('C1', '6');
hojas.Archivos = archivosGuardados;
const conHoja = abrir('C1', '6');
ok(conHoja.success && conHoja.archivos.length > 0, '5. si la hoja de archivos falla un momento, el error no se queda guardado: la siguiente apertura ya funciona');

// ---------- 6. Otras lecturas
F.invalidarCacheArchivos_(); abrir('C1', '6'); nuevaEjecucion(); F.obtenerCarpetasDelHotel('H1', null, '6'); reset(); nuevaEjecucion();
const hot = F.obtenerCarpetasDelHotel('H1', null, '6');
ok(totalLecturas() === 0 && hot.success && hot.carpetas.length === 2 && hot.carpetas.every(c => c.idPadre === null), '6. las áreas de una propiedad también salen del caché y solo incluye las de primer nivel (' + hot.carpetas.map(c => c.nombre).join() + ')');
ok(F.obtenerCarpetasDelHotel('H99', null, '1').success === false, '6b. una propiedad que no existe sigue rechazándose');
nuevaEjecucion(); reset(); const ruta = F.obtenerRutaCarpeta('C4');
ok(ruta.success && ruta.ruta.map(r => r.nombre).join('/').endsWith('Borradores') && ruta.ruta.length === 3 && lecturas.Carpetas === 0, '6c. la ruta de una subcarpeta anidada sale del caché: ' + ruta.ruta.map(r => r.nombre).join('/'));
nuevaEjecucion(); ok(F.obtenerRutaCarpeta('NO').success === false, '6d. una carpeta inexistente sigue respondiendo "no encontrada"');

// ---------- 7. "Recargar sistema"
abrir('C1', '6'); const g1 = F.generacionArchivosFresca_(); reloj += 120 * 1000; nuevaEjecucion();
F.refrescarCachesForzado_();
ok(F.generacionArchivosFresca_() !== g1, '7. el botón "Recargar sistema" también limpia el caché de carpetas y archivos');

// ---------- 8. Petición con "refrescar" (botón Recargar sistema)
abrir('C1', '6'); const gR = F.generacionArchivosFresca_();
const tokR = sesion(6);
const vistaNormal = llamarDoPost({ action: 'obtenerCarpetasDelHotel', args: ['H1', null, '6'], token: tokR });
ok(F.generacionArchivosFresca_() === gR && vistaNormal.success, '8. una petición normal no toca el caché');
reloj += 20 * 1000;
const conRefresco = llamarDoPost({ action: 'obtenerCarpetasDelHotel', args: ['H1', null, '6'], token: tokR, refrescar: true });
const gR2 = F.generacionArchivosFresca_();
ok(conRefresco.success && gR2 !== gR, '8b. con refrescar:true se vacía el caché de carpetas y archivos antes de responder');
llamarDoPost({ action: 'obtenerContenidoCarpeta', args: ['C1', '6'], token: tokR, refrescar: true });
ok(F.generacionArchivosFresca_() === gR2, '8c. una segunda petición con refrescar dentro de 15 s no vuelve a vaciar (límite para que nadie anule el caché)');
reloj += 16 * 1000;
llamarDoPost({ action: 'obtenerContenidoCarpeta', args: ['C1', '6'], token: tokR, refrescar: true });
ok(F.generacionArchivosFresca_() !== gR2, '8d. pasados 15 s se puede volver a pedir');
const gR3 = F.generacionArchivosFresca_();
const sinSesion = llamarDoPost({ action: 'obtenerContenidoCarpeta', args: ['C1', '6'], refrescar: true });
ok(sinSesion.codigo === 'SESION_INVALIDA' && F.generacionArchivosFresca_() === gR3, '8e. sin sesión no se puede vaciar el caché de nadie');
// Lo que se ve tras la recarga es lo real de la hoja, aunque alguien la haya editado a mano (esa edición no pasa por la aplicación)
abrir('C1', '6');
hojas.Carpetas.filas.find(r => r[0] === 'C3')[3] = 'Editada a mano en la hoja';
ok(abrir('C1', '6').subcarpetas[0].nombre !== 'Editada a mano en la hoja', '8f. una edición manual en la hoja no se ve mientras el caché esté vigente...');
reloj += 20 * 1000;
llamarDoPost({ action: 'obtenerContenidoCarpeta', args: ['C1', '6'], token: tokR, refrescar: true });
ok(abrir('C1', '6').subcarpetas[0].nombre === 'Editada a mano en la hoja', '8g. ...pero tras pulsar Recargar sistema sí aparece');

// ---------- 9. Favoritos y actividad de la pantalla de inicio
F.invalidarCacheArchivos_(); reset();
const ids1 = (nuevaEjecucion(), F.obtenerIdsFavoritosUsuario('6')), det1 = (nuevaEjecucion(), F.obtenerFavoritosDetallados('6'));
const lecFav = lecturas.Favoritos;
ok(ids1.favoritos.join() === 'Hotel|H1,Carpeta|C1,Archivo|A1' && det1.favoritos.map(f => f.nombre).join() === 'contrato.pdf,IT,Distrito', '9. favoritos de una persona: claves y detalle ordenado del más reciente al más antiguo → ' + det1.favoritos.map(f => f.nombre).join());
ok(lecFav <= 2, '9b. la hoja Favoritos se lee una vez por ejecución como mucho al llenar el caché (lecturas: ' + lecFav + ')');
reset();
const ids2 = (nuevaEjecucion(), F.obtenerIdsFavoritosUsuario('6')), det2 = (nuevaEjecucion(), F.obtenerFavoritosDetallados('6'));
ok(totalLecturas() === 0 && JSON.stringify(ids2) === JSON.stringify(ids1) && JSON.stringify(det2) === JSON.stringify(det1), '9c. desde el caché no se lee ninguna hoja (ni Favoritos, ni Archivos, ni Carpetas, ni Hoteles) y el resultado es idéntico');
llamarDoPost({ action: 'alternarFavorito', args: ['6', 'Carpeta', 'C2'], token: sesion(6) });
const det3 = (nuevaEjecucion(), F.obtenerFavoritosDetallados('6'));
ok(det3.favoritos.map(f => f.nombre).join() === 'Cambiada por una acción nueva,contrato.pdf,IT,Distrito' && (nuevaEjecucion(), F.obtenerIdsFavoritosUsuario('6')).favoritos.includes('Carpeta|C2'), '9d. marcar un favorito nuevo se ve de inmediato (alternarFavorito invalida por defecto) → ' + det3.favoritos.map(f => f.nombre).join());
llamarDoPost({ action: 'alternarFavorito', args: ['6', 'Carpeta', 'C2'], token: sesion(6) });
ok((nuevaEjecucion(), F.obtenerFavoritosDetallados('6')).favoritos.map(f => f.nombre).join() === 'contrato.pdf,IT,Distrito', '9e. y desmarcarlo también');
llamarDoPost({ action: 'renombrarCarpeta', args: ['C1', 'IT renombrada'], token: sesion(1) });
ok((nuevaEjecucion(), F.obtenerFavoritosDetallados('6')).favoritos.some(f => f.nombre === 'IT renombrada'), '9f. al renombrar una carpeta el favorito ya muestra el nombre nuevo (el detalle se resuelve de nuevo)');
llamarDoPost({ action: 'renombrarCarpeta', args: ['C1', 'IT'], token: sesion(1) });

// Actividad: lectura acotada al final de la hoja, caché por persona e invalidación propia
const actividad = hojas.Actividad_Reciente;
actividad.filas.length = 1; // se empieza de cero: lo registrado por pruebas anteriores no cuenta
const base = Date.now() - 2 * 24 * 60 * 60 * 1000; // filas cronológicas, todas anteriores a lo que se registre ahora (así se agregan de verdad)
let n = 0; const recursosVarios = ['Carpeta|C1', 'Carpeta|C2', 'Carpeta|C3', 'Carpeta|C9', 'Hotel|H1', 'Hotel|H2', 'Archivo|A1', 'Archivo|A3'];
const agregar = (usuario, rec) => { const [t, i] = rec.split('|'); actividad.filas.push(['ACT-' + (++n), usuario, t, i, 'Abrir', new Date(base + n * 60000)]); };
for (let i = 0; i < 2000; i++) agregar(i % 7 === 0 ? 6 : 100 + (i % 50), recursosVarios[(i * 3) % recursosVarios.length]); // 2.000 filas (la persona 6 aparece una de cada 7)
agregar(5, 'Hotel|H1'); // una persona con una sola actividad
function esperadaPor(usuario, limite) {
  const porRec = {};
  actividad.filas.slice(1).filter(f => String(f[1]) === String(usuario)).forEach(f => { const k = f[2] + '|' + f[3]; if (!porRec[k] || f[5] > porRec[k].f) porRec[k] = { f: f[5], k }; });
  return Object.values(porRec).sort((a, b) => b.f - a.f).slice(0, limite).map(x => x.k);
}
F.invalidarCacheArchivos_(); reset(); nuevaEjecucion();
const act6 = F.obtenerActividadReciente('6', 4);
const claves = act6.actividad.map(a => a.tipoRecurso + '|' + a.idRecurso);
const esperada = esperadaPor('6', 4).filter(k => !['Hotel|H2', 'Carpeta|C9'].includes(k)); // H2 y C9 son de otra propiedad: no se muestran
ok(claves.join() === esperada.join() && claves.length === 4, '9g. la actividad reciente leyendo solo el final de la hoja da lo mismo que leerla entera → ' + claves.join(', ') + ' | esperada ' + esperada.join(', '));
ok(lecturas.Actividad_Reciente === 0, '9h. con 2.000 filas no se descarga la hoja completa (solo una ventana del final: lecturas completas ' + lecturas.Actividad_Reciente + ')');
nuevaEjecucion(); const act77 = F.obtenerActividadReciente('5', 4);
ok(act77.actividad.length === 1 && act77.actividad[0].idRecurso === 'H1' && lecturas.Actividad_Reciente === 1, '9i. quien tiene poca actividad no alcanza a llenar la ventana y se lee la hoja entera, sin perder nada (lecturas completas ' + lecturas.Actividad_Reciente + ')');
reset(); nuevaEjecucion(); const act6b = F.obtenerActividadReciente('6', 4); nuevaEjecucion(); F.obtenerActividadReciente('5', 4);
ok(lecturas.Actividad_Reciente === 0 && JSON.stringify(act6b) === JSON.stringify(act6), '9j. la segunda vez sale del caché, idéntica y sin leer la hoja');
llamarDoPost({ action: 'registrarActividad', args: ['6', 'Carpeta', 'C4', 'Abrir'], token: sesion(6) });
reset(); nuevaEjecucion(); const act6c = F.obtenerActividadReciente('6', 4);
ok(act6c.actividad[0].idRecurso === 'C4', '9k. lo que la persona acaba de abrir aparece al instante en su actividad reciente');
nuevaEjecucion(); F.obtenerActividadReciente('5', 4);
ok(lecturas.Actividad_Reciente === 0, '9l. y solo se rehízo la lista de ELLA: la de la otra persona siguió en el caché (sin leer la hoja entera, que es lo que le costaría)');

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
