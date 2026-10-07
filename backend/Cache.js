/**
 * Caché de lectura para lo que casi no cambia (usuarios, hoteles y módulos).
 *
 * Cada llamada al Web App relee hojas completas de Google Sheets solo para saber el rol o los hoteles de quien
 * pregunta; con cientos de personas eso se vuelve el cuello de botella. Aquí esas lecturas se guardan:
 *   1. en memoria durante la ejecución (el estado global de Apps Script se reinicia en cada llamada), y
 *   2. en CacheService (compartido entre ejecuciones) por pocos segundos.
 *
 * Calentamiento: un disparador (ver instalarCalentamientoCaches) rellena el caché cada 10 minutos con un TTL largo, de modo que
 * casi nadie pague la lectura completa de las hojas.
 *
 * Carrera lectura/escritura: cada invalidación sube un "contador de generación". Quien lee la hoja anota la generación ANTES de
 * leer y solo guarda en el caché si sigue siendo la misma; así una lectura vieja nunca pisa un cambio recién hecho.
 *
 * Reglas de seguridad:
 *   - Nunca se cachean contraseñas, hashes ni códigos: solo id, nombre, correo, rol, estado y hoteles permitidos.
 *   - Cada escritura sobre Usuarios / Hoteles / Módulos llama a invalidarCacheUsuarios_() o invalidarCacheHoteles_(),
 *     así que los cambios hechos desde la app se ven al instante. Las ediciones manuales en la hoja se ven al
 *     vencer el TTL (90 s para usuarios, 120 s para hoteles).
 *   - Si CacheService falla o no existe, todo cae a leer la hoja directamente (más lento, igual de correcto).
 */

var _memoCache_ = {};

var CACHE_TTL_USUARIOS_ = 90;
var CACHE_TTL_HOTELES_ = 120;
// TTL con el que guarda el disparador de calentamiento (que lo renueva cada 10 min): las ediciones MANUALES en la hoja se
// ven en cuanto corre el siguiente calentamiento o alguien pulsa "Recargar sistema".
var CACHE_TTL_CALENTADO_ = 1800;
var _lecturasDeHoja_ = 0; // cuántas veces esta ejecución tuvo que leer una hoja (0 = todo salió del caché)
// CacheService admite ~100 KB por valor (en bytes); con tildes un carácter puede ocupar 3, por eso trozos cortos.
var CACHE_TROZO_ = 30000;

function cacheObtener_(nombre) {
  if (Object.prototype.hasOwnProperty.call(_memoCache_, nombre)) return _memoCache_[nombre];
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get('oxo:' + nombre);
    if (!meta) return undefined;
    const info = JSON.parse(meta);
    const claves = [];
    for (let i = 0; i < info.n; i++) claves.push('oxo:' + nombre + ':' + info.sello + ':' + i);
    const partes = cache.getAll(claves);
    let texto = '';
    for (let i = 0; i < claves.length; i++) {
      const parte = partes[claves[i]];
      if (parte === null || parte === undefined) return undefined; // trozo expulsado: se trata como fallo de caché
      texto += parte;
    }
    const valor = JSON.parse(texto);
    _memoCache_[nombre] = valor;
    return valor;
  } catch (e) {
    return undefined;
  }
}

function cacheGeneracion_() {
  try { return CacheService.getScriptCache().get('oxo:gen') || '0'; } catch (e) { return '0'; }
}

function cacheNuevaGeneracion_() {
  try { CacheService.getScriptCache().put('oxo:gen', String(Date.now()) + String(Math.floor(Math.random() * 1000)), 21600); } catch (e) {}
}

/** "generacionEsperada": si se indica y ya cambió (alguien invalidó mientras se leía la hoja), NO se guarda. */
function cacheGuardar_(nombre, valor, ttlSegundos, generacionEsperada) {
  // Una lectura que ya quedó vieja no se guarda ni en el caché compartido ni en la memoria de esta ejecución
  if (generacionEsperada !== undefined && cacheGeneracion_() !== generacionEsperada) return;
  _memoCache_[nombre] = valor;
  try {
    const cache = CacheService.getScriptCache();
    const texto = JSON.stringify(valor);
    const n = Math.max(1, Math.ceil(texto.length / CACHE_TROZO_));
    const sello = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    const lote = {};
    for (let i = 0; i < n; i++) lote['oxo:' + nombre + ':' + sello + ':' + i] = texto.substr(i * CACHE_TROZO_, CACHE_TROZO_);
    cache.putAll(lote, ttlSegundos);
    cache.put('oxo:' + nombre, JSON.stringify({ sello: sello, n: n }), ttlSegundos);
  } catch (e) {
    Logger.log('Aviso cacheGuardar_(' + nombre + '): ' + e);
  }
}

function cacheBorrar_(nombre) {
  delete _memoCache_[nombre];
  try { CacheService.getScriptCache().remove('oxo:' + nombre); } catch (e) {}
}

function normalizarColumna_(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

/**
 * Usuarios sin datos sensibles: { existe, hayHoteles, usuarios: [{id, nombre, email, rol, estado, hoteles}] }.
 * "rol" es el valor crudo de la celda (número o texto); "hoteles" el texto de Hoteles_Permitidos ya recortado.
 */
function obtenerUsuariosLite_(opciones) {
  opciones = opciones || {};
  if (!opciones.forzar) {
    const guardado = cacheObtener_('usuarios_lite');
    if (guardado) return guardado;
  }

  const generacion = cacheGeneracion_();
  _lecturasDeHoja_++;
  const resultado = { existe: false, hayHoteles: false, usuarios: [] };
  const hoja = obtenerSpreadsheet_().getSheetByName('Usuarios');
  if (hoja) {
    resultado.existe = true;
    const datos = hoja.getDataRange().getValues();
    if (datos.length) {
      const enc = datos[0].map(normalizarColumna_);
      const buscar = function (nombres, porDefecto) {
        const i = enc.findIndex(function (n) { return nombres.indexOf(n) !== -1; });
        return i !== -1 ? i : porDefecto;
      };
      const cId = buscar(['idusuario', 'id', 'usuarioid'], 0);
      const cNombre = buscar(['nombrecompleto', 'nombre'], 1);
      const cEmail = buscar(['email', 'correo'], 2);
      const cRol = buscar(['rol', 'idrol', 'rolid'], 4);
      const cEstado = buscar(['estado'], 5);
      const cHot = buscar(['hotelespermitidos', 'hoteles'], -1);
      resultado.hayHoteles = cHot !== -1;

      for (let i = 1; i < datos.length; i++) {
        const fila = datos[i];
        const rol = fila[cRol];
        resultado.usuarios.push({
          id: String(fila[cId]).trim(),
          nombre: String(fila[cNombre] == null ? '' : fila[cNombre]),
          email: String(fila[cEmail] || '').trim(),
          rol: (rol === null || rol === undefined || rol === '') ? '' : rol,
          estado: String(fila[cEstado] == null ? '' : fila[cEstado]).trim(),
          hoteles: cHot !== -1 ? String(fila[cHot] == null ? '' : fila[cHot]).trim() : ''
        });
      }
    }
  }
  cacheGuardar_('usuarios_lite', resultado, opciones.ttl || CACHE_TTL_USUARIOS_, generacion);
  return resultado;
}

/** Llamar después de CUALQUIER escritura que cambie nombre, correo, rol, estado u hoteles de un usuario. */
function invalidarCacheUsuarios_() {
  // Primero se sube la generación y DESPUÉS se borra: así, un lector que venía con datos viejos ya no puede guardarlos
  cacheNuevaGeneracion_();
  cacheBorrar_('usuarios_lite');
}

/** Valores (con encabezado) de una hoja de catálogo poco cambiante: 'Hoteles' o 'Modulos'. null si no existe. */
function leerHojaConCache_(nombreHoja, opciones) {
  opciones = opciones || {};
  const clave = 'hoja_' + nombreHoja;
  if (!opciones.forzar) {
    const guardado = cacheObtener_(clave);
    if (guardado) return guardado;
  }

  const generacion = cacheGeneracion_();
  const hoja = obtenerSpreadsheet_().getSheetByName(nombreHoja);
  if (!hoja) return null;
  _lecturasDeHoja_++;
  const valores = hoja.getDataRange().getValues();
  cacheGuardar_(clave, valores, opciones.ttl || CACHE_TTL_HOTELES_, generacion);
  return valores;
}

/** Llamar después de crear, renombrar, mover o eliminar un hotel o un módulo. */
function invalidarCacheHoteles_() {
  cacheNuevaGeneracion_();
  cacheBorrar_('hoja_Hoteles');
  cacheBorrar_('hoja_Modulos');
}

/**
 * Refresco forzado (botón "Recargar sistema"): descarta lo guardado para que se lea de las hojas. Para que nadie pueda
 * usarlo para castigar al servidor, solo actúa una vez por minuto en TODO el sistema; las demás veces se ignora.
 */
function refrescarCachesForzado_() {
  let calentamientoActivo = false;
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('oxo:forzado')) return false;
    cache.put('oxo:forzado', '1', 60);
    calentamientoActivo = !!cache.get('oxo:calentado');
  } catch (e) {}
  invalidarCacheUsuarios_();
  invalidarCacheHoteles_();
  // Si hay disparador de calentamiento, se vuelve a llenar YA con el TTL largo (si no, quedaría con TTL corto hasta el próximo ciclo)
  if (calentamientoActivo) calentarCaches();
  return true;
}

// ==================== Calentamiento con disparador ====================

/** La ejecuta el disparador cada 10 minutos: lee las hojas y deja el caché lleno con TTL largo. NO se puede llamar desde la web
 *  (no está en la lista de acciones permitidas de Code.js). */
function calentarCaches() {
  const inicio = Date.now();
  try {
    _memoCache_ = {};
    obtenerUsuariosLite_({ forzar: true, ttl: CACHE_TTL_CALENTADO_ });
    leerHojaConCache_('Modulos', { forzar: true, ttl: CACHE_TTL_CALENTADO_ });
    leerHojaConCache_('Hoteles', { forzar: true, ttl: CACHE_TTL_CALENTADO_ });
    try { CacheService.getScriptCache().put('oxo:calentado', '1', 1500); } catch (e) {} // marca: el calentamiento está activo
    return { success: true, ms: Date.now() - inicio };
  } catch (error) {
    Logger.log('Error calentarCaches: ' + error);
    return { success: false, message: String(error) };
  }
}

/** EJECUTAR UNA VEZ desde el editor de Apps Script (Ejecutar → instalarCalentamientoCaches). Crea el disparador de cada 10 min. */
function instalarCalentamientoCaches() {
  desinstalarCalentamientoCaches();
  ScriptApp.newTrigger('calentarCaches').timeBased().everyMinutes(10).create();
  const r = calentarCaches();
  Logger.log('Calentamiento instalado (cada 10 minutos). Primera pasada: ' + JSON.stringify(r));
}

/** Quita el disparador (vuelve al comportamiento anterior: el caché lo llena quien pregunta, con TTL corto). */
function desinstalarCalentamientoCaches() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'calentarCaches') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Calentamiento desinstalado');
}
