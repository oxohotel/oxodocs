/**
 * Autorización por propiedad (hotel): QUÉ puede tocar una persona autenticada.
 *
 * Quién es la persona lo decide el despachador (Code.js: validarSesionDePeticion_). Aquí se decide a qué propiedades llega:
 *   - Superadministrador (rol 3) y quien tiene "TODOS" o "*": todas.
 *   - Cualquier otra cuenta: solo las de su lista de Hoteles_Permitidos (vacía = ninguna).
 *   - Si la hoja de usuarios no tiene columna de hoteles (instalación antigua) no hay restricción, como siempre.
 *
 * El despachador comprueba el OBJETIVO de cada acción (qué propiedad, carpeta o archivo toca) con OBJETIVOS_DE_ACCESO_; así una
 * acción nueva que toque una carpeta o archivo no queda sin proteger por olvido de quien la escribe: basta declararla aquí
 * (herramientas/verificar-acciones.js avisa si falta).
 */

/** accion → { tipo: 'hotel' | 'carpeta' | 'archivo' | 'archivoDrive', posicion: lugar del argumento que identifica el objetivo }. */
const OBJETIVOS_DE_ACCESO_ = {
  crearArea: { tipo: 'hotel', posicion: 0 },
  editarHotel: { tipo: 'hotel', posicion: 0 },
  eliminarHotel: { tipo: 'hotel', posicion: 0 },
  obtenerContenidoCarpeta: { tipo: 'carpeta', posicion: 0 },
  obtenerRutaCarpeta: { tipo: 'carpeta', posicion: 0 },
  crearSubcarpeta: { tipo: 'carpeta', posicion: 0 },
  renombrarCarpeta: { tipo: 'carpeta', posicion: 0 },
  eliminarCarpeta: { tipo: 'carpeta', posicion: 0 },
  guardarArchivoEnDrive: { tipo: 'carpeta', posicion: 0 },
  guardarArchivosMultiplesDesdeDrive: { tipo: 'carpeta', posicion: 0 },
  renombrarArchivo: { tipo: 'archivo', posicion: 0 },
  actualizarPermisosExistentes: { tipo: 'archivo', posicion: 0 },
  obtenerPermisosDeArchivo: { tipo: 'archivo', posicion: 0 },
  eliminarArchivo: { tipo: 'archivoDrive', posicion: 0 }
};

const MENSAJE_SIN_ACCESO_PROPIEDAD_ = 'No tienes acceso a esa propiedad';

/** { todos: boolean, hoteles: Set de ids } de las propiedades a las que llega una persona, a partir de su fila de obtenerUsuariosLite_. */
function alcanceDeFilaLite_(fila, hayHoteles) {
  const infoRol = obtenerInfoRol_(fila.rol);
  if (infoRol && String(infoRol.id) === '3') return { todos: true, hoteles: new Set() };
  if (!hayHoteles) return { todos: true, hoteles: new Set() };
  const valor = String(fila.hoteles || '').trim();
  if (valor === '*' || valor.toUpperCase() === 'TODOS') return { todos: true, hoteles: new Set() };
  return { todos: false, hoteles: new Set(valor.split(',').map(function (s) { return s.trim(); }).filter(Boolean)) };
}

/** { todos: boolean, hoteles: Set de ids } de las propiedades a las que llega una persona. */
function alcanceDeHoteles_(idUsuario) {
  const id = String(idUsuario == null ? '' : idUsuario).trim();
  const ninguno = { todos: false, hoteles: new Set() };
  if (!id) return ninguno;

  const infoRol = obtenerInfoRol_(obtenerRolDeUsuario_(id));
  if (infoRol && String(infoRol.id) === '3') return { todos: true, hoteles: new Set() };

  const lite = obtenerUsuariosLite_();
  if (!lite.hayHoteles) return { todos: true, hoteles: new Set() };
  const yo = lite.usuarios.filter(function (u) { return u.id === id; })[0];
  if (!yo) return ninguno;
  return alcanceDeFilaLite_(yo, true);
}

function alcancePermiteHotel_(alcance, idHotel) {
  return alcance.todos || alcance.hoteles.has(String(idHotel == null ? '' : idHotel).trim());
}

function usuarioPuedeAccederHotel_(idUsuario, idHotel) {
  return alcancePermiteHotel_(alcanceDeHoteles_(idUsuario), idHotel);
}

/** Lee una sola fila de una hoja buscando "valor" en la columna "nombreColumna" (sin descargar la hoja entera). null si no está. */
function filaPorColumna_(nombreHoja, nombreColumna, valor) {
  const hoja = obtenerSpreadsheet_().getSheetByName(nombreHoja);
  if (!hoja || hoja.getLastRow() < 2) return null;
  const idx = indiceEncabezados_(hoja);
  if (idx[nombreColumna] === undefined) return null;
  const fila = buscarFilaEnColumna_(hoja, idx[nombreColumna] + 1, valor);
  if (fila === -1) return null;
  const valores = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0];
  const resultado = {};
  Object.keys(idx).forEach(function (n) { resultado[n] = valores[idx[n]]; });
  return resultado;
}

/** Id de la propiedad de una carpeta; undefined si la carpeta no existe. */
function hotelDeCarpeta_(idCarpeta) {
  const fila = filaPorColumna_('Carpetas', 'ID_Carpeta', String(idCarpeta).trim());
  return fila ? String(fila.ID_Hotel == null ? '' : fila.ID_Hotel).trim() : undefined;
}

/** Id de la propiedad de un archivo registrado (por su id del sistema o por su id de Drive); undefined si no está registrado. */
function hotelDeArchivo_(idArchivo, esIdDeDrive) {
  const fila = filaPorColumna_('Archivos', esIdDeDrive ? 'DriveFileId' : 'ID_Archivo', String(idArchivo).trim());
  return fila ? hotelDeCarpeta_(fila.ID_Carpeta) || '' : undefined;
}

/**
 * Comprueba el objetivo de una acción. Devuelve null si puede seguir o el texto de rechazo. Un objetivo que no existe no se
 * rechaza aquí (la propia función responde "no encontrado"), salvo eliminarArchivo, que solo actúa sobre archivos registrados.
 */
function verificarAccesoAObjetivo_(accion, args, idUsuario) {
  const objetivo = OBJETIVOS_DE_ACCESO_[accion];
  if (!objetivo) return null;
  const valor = args[objetivo.posicion];
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;

  let idHotel;
  if (objetivo.tipo === 'hotel') idHotel = String(valor).trim();
  else if (objetivo.tipo === 'carpeta') idHotel = hotelDeCarpeta_(valor);
  else idHotel = hotelDeArchivo_(valor, objetivo.tipo === 'archivoDrive');

  if (idHotel === undefined) {
    return objetivo.tipo === 'archivoDrive' ? 'Ese archivo no pertenece al repositorio' : null;
  }
  return usuarioPuedeAccederHotel_(idUsuario, idHotel) ? null : MENSAJE_SIN_ACCESO_PROPIEDAD_;
}

/**
 * ¿Puede esta persona usar (ver, importar) un archivo de Drive? El script corre con la cuenta del dueño y ve TODO su Drive, así que
 * un archivo se admite solo si: ya es del repositorio y la persona tiene acceso a su propiedad, o (archivo externo) la persona ya
 * tiene acceso por Drive: es su dueña/editora/lectora, o está compartido con cualquiera/el dominio.
 */
function usuarioPuedeUsarArchivoDrive_(archivo, idUsuario) {
  const hotel = hotelDeArchivo_(archivo.getId(), true);
  if (hotel !== undefined) return usuarioPuedeAccederHotel_(idUsuario, hotel);

  try {
    const acceso = archivo.getSharingAccess();
    const abiertos = [DriveApp.Access.ANYONE, DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Access.DOMAIN, DriveApp.Access.DOMAIN_WITH_LINK];
    if (abiertos.indexOf(acceso) !== -1) return true;
  } catch (e) { /* sin dato de uso compartido: se decide por correo */ }

  const yo = obtenerUsuariosLite_().usuarios.filter(function (u) { return u.id === String(idUsuario).trim(); })[0];
  const correo = yo ? String(yo.email || '').trim().toLowerCase() : '';
  if (!correo) return false;
  const esElCorreo = function (persona) { return !!persona && String(persona.getEmail() || '').trim().toLowerCase() === correo; };
  try {
    if (esElCorreo(archivo.getOwner())) return true;
    return archivo.getViewers().concat(archivo.getEditors()).some(esElCorreo);
  } catch (e) {
    return false;
  }
}

/** Personas que comparten alguna propiedad con quien consulta (o todas, si ve todas): lo mínimo para elegir a quién restringir un archivo. */
function usuarioComparteAlcance_(alcanceConsultante, usuarioLite) {
  if (alcanceConsultante.todos) return true;
  const valor = String(usuarioLite.hoteles || '').trim();
  if (valor === '*' || valor.toUpperCase() === 'TODOS') return true;
  if (String(usuarioLite.rol) === '3') return true;
  return valor.split(',').some(function (h) { return alcanceConsultante.hoteles.has(h.trim()); });
}
