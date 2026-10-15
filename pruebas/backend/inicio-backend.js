// Compara obtenerDatosInicio contra las 4 funciones sueltas, con hojas simuladas.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..', 'backend') + '/';
class Hoja {
  constructor(n, filas) { this.nombre = n; this.filas = filas.map(f => f.slice()); }
  getDataRange() { const s = this; return { getValues: () => s.filas.map(f => f.slice()) }; }
  getLastRow() { return this.filas.length; }
  getLastColumn() { return this.filas[0].length; }
  getRange(r, c, nr = 1, nc = 1) { const s = this; return { getValues() { const o = []; for (let i = 0; i < nr; i++) o.push(s.filas[r - 1 + i].slice(c - 1, c - 1 + nc)); return o; } }; }
}
const hojas = {
  Usuarios: new Hoja('Usuarios', [['ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro', 'Hoteles_Permitidos'],
    [1, 'SA', 'sa@x.com', 'h', 3, 'Activo', '', ''], [2, 'Ad', 'ad@x.com', 'h', 2, 'Activo', '', 'H1'], [3, 'Us', 'us@x.com', 'h', 1, 'Activo', '', 'TODOS']]),
  Modulos: new Hoja('Modulos', [['ID_Modulo', 'Nombre', 'Orden'], ['M1', 'Operación', 1], ['M2', 'Corporativo', 2]]),
  Hoteles: new Hoja('Hoteles', [['ID_Hotel', 'Nombre_Hotel', 'ID_Modulo', 'Drive_Folder_ID'], ['H1', 'Hotel Uno', 'M1', 'f1'], ['H2', 'Hotel Dos', 'M1', 'f2'], ['H3', 'Corp', 'M2', 'f3']]),
  Carpetas: new Hoja('Carpetas', [['ID_Carpeta', 'ID_Hotel', 'Nombre_Carpeta'], ['C1', 'H1', 'Contratos']]),
  Archivos: new Hoja('Archivos', [['ID_Archivo', 'ID_Carpeta', 'Nombre_Archivo']]),
  Favoritos: new Hoja('Favoritos', [['ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado'],
    ['F1', 3, 'Hotel', 'H2', new Date('2026-10-01')], ['F2', 3, 'Carpeta', 'C1', new Date('2026-10-02')], ['F3', 2, 'Hotel', 'H1', new Date('2026-10-01')]]),
  Actividad_Reciente: new Hoja('Actividad_Reciente', [['ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora'],
    ['A1', 3, 'Hotel', 'H1', 'Abrir', new Date('2026-10-01')], ['A2', 3, 'Carpeta', 'C1', 'Abrir', new Date('2026-10-02')]])
};
let aperturas = 0, fallar = null;
const sandbox = {
  console, Logger: { log: () => {} },
  SpreadsheetApp: { flush() {}, openById: () => { aperturas++; return { getSheetByName: n => hojas[n] || null }; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '1' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  obtenerUsuarioPorToken: t => (t === 'tokU' ? { idUsuario: '3', rol: 1, idRol: 1 } : null)
};
vm.createContext(sandbox);
['Drive.js', 'Inicio.js', 'Cache.js', 'Metricas.js', 'Roles.js', 'AlcanceAdmin.js', 'Registro.js', 'Solicitudes.js', 'Hoteles.js', 'Actividad.js', 'Favoritos.js', 'Recursos.js'].forEach(f => vm.runInContext(fs.readFileSync(REPO + f, 'utf8'), sandbox, { filename: f }));
vm.runInContext('this.F={obtenerDatosInicio,obtenerModulosConHoteles,obtenerIdsFavoritosUsuario,obtenerActividadReciente,obtenerFavoritosDetallados,contarPendientesAprobacion_}', sandbox);
const F = sandbox.F;
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const J = x => JSON.stringify(x);

for (const [token, id, etiqueta] of [['tokU', '3', 'usuario con TODOS'], [null, '2', 'admin con H1'], [null, '1', 'superadmin']]) {
  const nuevaEjecucion = () => vm.runInContext('_spreadsheetEjecucion_=null;_cacheIndiceHojas_={}', sandbox);
  nuevaEjecucion(); aperturas = 0;
  const suelto = { modulos: F.obtenerModulosConHoteles(token, id), idsFavoritos: F.obtenerIdsFavoritosUsuario(id), actividad: F.obtenerActividadReciente(id, 4), favoritos: F.obtenerFavoritosDetallados(id), pendientes: F.contarPendientesAprobacion_(token || id, id) };
  const aperturasSueltas = aperturas; nuevaEjecucion(); aperturas = 0;
  const unido = F.obtenerDatosInicio(token, id);
  ok(J(unido) === J(suelto), etiqueta + ': obtenerDatosInicio devuelve exactamente lo mismo que las 4 funciones sueltas');
  ok(aperturas === 1, etiqueta + ': la hoja de cálculo se abre ' + aperturas + ' vez en una sola llamada (4 llamadas sueltas: ' + aperturasSueltas + ' aperturas, ya con el handle compartido por llamada)');
}
// Una parte que falla no tumba las demás
hojas.Favoritos.getDataRange = () => { throw new Error('boom'); };
const parcial = F.obtenerDatosInicio('tokU', '3');
ok(parcial.idsFavoritos && parcial.idsFavoritos.success === false && Array.isArray(parcial.modulos) && parcial.actividad.success === true, 'si falla la hoja de favoritos, hoteles y actividad igual se devuelven');
console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
