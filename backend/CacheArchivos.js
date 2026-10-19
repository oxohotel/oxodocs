/**
 * Caché de lectura de carpetas y archivos.
 *
 * Abrir una carpeta releía varias veces las hojas "Carpetas", "Archivos", "Permisos_Archivos" y "Hoteles" completas (el resumen por
 * carpeta, la lista de archivos, las subcarpetas, los permisos, el nombre de la propiedad...). Aquí esas lecturas se guardan en
 * CacheService con el mismo cuidado que el caché de usuarios (backend/Cache.js):
 *
 *   - Una "generación" propia (oxo:genArch) forma parte de la clave: invalidar es subir la generación; lo guardado con la anterior
 *     queda huérfano y vence solo. No hace falta borrar nada ni listar claves.
 *   - Carrera lectura/escritura: quien lee anota la generación ANTES de leer la hoja y solo guarda si sigue siendo la misma.
 *   - INVALIDACIÓN CENTRALIZADA en el despachador (Code.js): después de cualquier acción que no sea una lectura ni esté en la lista de
 *     las que sabemos que no tocan carpetas ni archivos, se fuerza la escritura pendiente (flush) y se sube la generación. Así una
 *     acción nueva que escriba en estas hojas invalida por defecto, sin que nadie tenga que acordarse.
 *   - Las ediciones MANUALES en la hoja se ven al vencer el TTL (CACHE_TTL_ARCHIVOS_) o al pulsar "Recargar sistema".
 *   - Se guardan listas ya construidas (sin datos sensibles) y las filas de Carpetas con las fechas convertidas a texto ISO.
 *   - Si CacheService falla, todo cae a leer la hoja (más lento, igual de correcto).
 */
var CACHE_TTL_ARCHIVOS_ = 300;
var _genArchivos_ = null; // generación vista en esta ejecución

function generacionArchivosFresca_() {
  try { return CacheService.getScriptCache().get('oxo:genArch') || '0'; } catch (e) { return '0'; }
}

function generacionArchivos_() {
  if (_genArchivos_ === null) _genArchivos_ = generacionArchivosFresca_();
  return _genArchivos_;
}

/** Llamar después de CUALQUIER cambio en las hojas Carpetas, Archivos o Permisos_Archivos (el despachador ya lo hace por todas las acciones). */
function invalidarCacheArchivos_() {
  try { CacheService.getScriptCache().put('oxo:genArch', String(Date.now()) + '-' + Math.floor(Math.random() * 1e9), 21600); } catch (e) {}
  _genArchivos_ = null;
}

/** Devuelve lo guardado para "nombre" en la generación actual o, si no hay, lo calcula con "calcular" y lo guarda (si nadie invalidó mientras tanto). */
function conCacheArchivos_(nombre, calcular, esValido, generacionExtra) {
  // "generacionExtra" (opcional): función que devuelve una generación propia de ese dato (por ejemplo, la de la actividad de una persona)
  const extra = function () { return generacionExtra ? '|' + generacionExtra() : ''; };
  const gen = generacionArchivos_() + extra();
  const clave = 'arch:' + nombre + ':' + gen;
  const guardado = cacheObtener_(clave);
  if (guardado !== undefined) return guardado;

  _lecturasDeHoja_++;
  const valor = calcular();
  if ((!esValido || esValido(valor)) && generacionArchivosFresca_() + extra() === gen) cacheGuardar_(clave, valor, ttlDeArchivos_());
  return valor;
}

/** Con el calentamiento activo (backend/Cache.js: calentarCaches renueva lo importante cada 10 minutos) el caché dura más. */
function ttlDeArchivos_() {
  try { if (CacheService.getScriptCache().get('oxo:calentado')) return CACHE_TTL_CALENTADO_; } catch (e) {}
  return CACHE_TTL_ARCHIVOS_;
}

/** Valores de una hoja con las fechas convertidas a texto ISO (para poder guardarlos como JSON). */
function valoresSerializables_(valores) {
  return valores.map(function (fila) {
    return fila.map(function (v) { return v instanceof Date ? v.toISOString() : v; });
  });
}

/** { encabezados: [...], filas: [[...]] } de la hoja Carpetas, con caché. */
function leerCarpetasConCache_(ss) {
  return conCacheArchivos_('carpetas', function () {
    const hoja = (ss || obtenerSpreadsheet_()).getSheetByName('Carpetas');
    if (!hoja) return { existe: false, encabezados: [], filas: [] };
    const datos = valoresSerializables_(hoja.getDataRange().getValues());
    return { existe: true, encabezados: datos.length ? datos[0] : [], filas: datos.slice(1) };
  });
}

function indiceDeEncabezados_(encabezados) {
  const mapa = {};
  encabezados.forEach(function (nombre, i) { mapa[nombre] = i; });
  return mapa;
}

/** Resumen por carpeta (cantidad, tamaño, última actividad), con caché. */
function resumenArchivosPorCarpetaConCache_(ss) {
  return conCacheArchivos_('resumen', function () {
    const resumen = calcularResumenArchivosPorCarpeta_(ss || obtenerSpreadsheet_());
    Object.keys(resumen).forEach(function (id) {
      if (resumen[id].fechaUltima instanceof Date) resumen[id].fechaUltima = resumen[id].fechaUltima.toISOString();
    });
    return resumen;
  });
}

/** Archivos directos de una carpeta, con caché por carpeta. Misma forma que obtenerArchivosDeUnaCarpeta. */
function archivosDeUnaCarpetaConCache_(idCarpeta) {
  return conCacheArchivos_('archivos:' + String(idCarpeta).trim(), function () { return obtenerArchivosDeUnaCarpeta(idCarpeta); },
    function (r) { return !!(r && r.success); }); // un error de lectura no se guarda
}

/** Ids de los archivos restringidos para una persona (hoja Permisos_Archivos), con caché de la tabla. */
function tablaDePermisosDeArchivosConCache_(ss) {
  return conCacheArchivos_('permisos', function () {
    const hoja = (ss || obtenerSpreadsheet_()).getSheetByName('Permisos_Archivos');
    if (!hoja) return { existe: false, filas: [] };
    return { existe: true, filas: valoresSerializables_(hoja.getDataRange().getValues()).slice(1) };
  });
}

/**
 * Botón "Recargar sistema": las peticiones que manda mientras recarga llevan "refrescar: true". El servidor vacía el caché de carpetas y
 * archivos ANTES de ejecutar cada una; así la recarga de la carpeta que se está viendo ya no puede servirse con datos guardados (si
 * dependiera de otra petición, por ejemplo la del menú, podría adelantarse a ella). Se limita a una vez cada 15 s para que nadie
 * pueda anular el caché a base de repetirlo. Primero se invalida y después se marca: dos peticiones simultáneas pueden invalidar las
 * dos (inofensivo), pero ninguna puede saltarse la invalidación antes de que exista.
 */
function refrescarCacheDeArchivosSiToca_() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('oxo:forzadoArch')) return false;
    invalidarCacheArchivos_();
    cache.put('oxo:forzadoArch', '1', 15);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Acciones que, aunque no sean lecturas, SABEMOS que no tocan carpetas, archivos ni permisos de archivos: no invalidan (así las más
 * frecuentes, como registrar actividad, no pagan el flush). Toda acción que no sea "obtenerX" y no esté aquí invalida por defecto.
 */
var ACCIONES_QUE_NO_TOCAN_ARCHIVOS_ = [
  'validarCredenciales', 'registrarUsuario', 'verificarEmailExistente', 'enviarCodigoVerificacion', 'verificarCodigoRegistro',
  'solicitarCodigoRecuperacion', 'validarCodigoRecuperacion', 'restablecerPasswordConCodigo', 'cerrarSesionUsuario',
  'buscarGlobal', 'registrarActividad', 'registrarAuditoria', 'marcarAvisosVistos',
  'actualizarNombreUsuario', 'cambiarContrasenaUsuario', 'guardarPreferenciasNotificaciones', 'crearGrupoUsuario', 'eliminarGrupoUsuario',
  'aprobarUsuario', 'asignarHotelesAUsuario', 'cambiarEstadoUsuario', 'cambiarRolUsuario', 'cerrarSolicitudUsuario', 'crearUsuarioPorAdmin',
  'restablecerContrasenaUsuarioPorAdmin', 'resolverSolicitudesUsuario', 'solicitarAccesoPropiedades', 'cancelarSolicitudesPropias'
];

function accionInvalidaCacheDeArchivos_(accion) {
  return !/^obtener/.test(String(accion)) && ACCIONES_QUE_NO_TOCAN_ARCHIVOS_.indexOf(accion) === -1;
}
