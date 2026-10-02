/**
 * Caché de lectura para lo que casi no cambia (usuarios, hoteles y módulos).
 *
 * Cada llamada al Web App relee hojas completas de Google Sheets solo para saber el rol o los hoteles de quien
 * pregunta; con cientos de personas eso se vuelve el cuello de botella. Aquí esas lecturas se guardan:
 *   1. en memoria durante la ejecución (el estado global de Apps Script se reinicia en cada llamada), y
 *   2. en CacheService (compartido entre ejecuciones) por pocos segundos.
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

function cacheGuardar_(nombre, valor, ttlSegundos) {
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
function obtenerUsuariosLite_() {
  const guardado = cacheObtener_('usuarios_lite');
  if (guardado) return guardado;

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
  cacheGuardar_('usuarios_lite', resultado, CACHE_TTL_USUARIOS_);
  return resultado;
}

/** Llamar después de CUALQUIER escritura que cambie nombre, correo, rol, estado u hoteles de un usuario. */
function invalidarCacheUsuarios_() {
  cacheBorrar_('usuarios_lite');
}

/** Valores (con encabezado) de una hoja de catálogo poco cambiante: 'Hoteles' o 'Modulos'. null si no existe. */
function leerHojaConCache_(nombreHoja) {
  const clave = 'hoja_' + nombreHoja;
  const guardado = cacheObtener_(clave);
  if (guardado) return guardado;

  const hoja = obtenerSpreadsheet_().getSheetByName(nombreHoja);
  if (!hoja) return null;
  const valores = hoja.getDataRange().getValues();
  cacheGuardar_(clave, valores, CACHE_TTL_HOTELES_);
  return valores;
}

/** Llamar después de crear, renombrar, mover o eliminar un hotel o un módulo. */
function invalidarCacheHoteles_() {
  cacheBorrar_('hoja_Hoteles');
  cacheBorrar_('hoja_Modulos');
}
