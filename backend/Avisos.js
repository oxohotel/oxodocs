/**
 * Avisos: comunicados que un Superadministrador escribe y que le llegan a quien corresponda por la campana del sistema.
 *
 * Datos (dos pestañas nuevas, se crean solas al guardar el primer aviso):
 *   - "Avisos": una fila por aviso, con su AUDIENCIA dentro (no se copia una fila por persona: con cientos de personas, cada envío
 *     escribiría cientos de filas). Estado: "Programado" (se muestra desde su fecha, que para "enviar ahora" es la de creación) o "Cancelado".
 *   - "Avisos_Vistos": una fila por persona con "Vistos_Hasta": todo aviso con fecha posterior cuenta como no leído. Es mucho más barato que
 *     marcar cada aviso por separado y alcanza para una campana.
 *
 * Programar no necesita ningún proceso en segundo plano: un aviso programado simplemente aparece cuando llega su hora, porque la fecha
 * se compara al leer. La lista de avisos se guarda en caché (backend/CacheArchivos.js) y se invalida al crear o cancelar.
 *
 * Audiencias: { tipo: 'todos' } | { tipo: 'roles', roles: [1,2,3] } | { tipo: 'propiedades', propiedades: ['H1',...] } |
 *             { tipo: 'personas', personas: ['5','8'] }. Quien tiene acceso a todas las propiedades (rol 3 o "TODOS") recibe también
 *             los avisos dirigidos a cualquier propiedad.
 * Enlaces: [{ texto, tipo: 'url'|'hotel'|'carpeta'|'archivo', url | id, idHotel?, idCarpeta?, nombre? }]. Solo https para los externos.
 */
var AVISOS_MAX_VISIBLES_ = 30;
var AVISOS_ENCABEZADOS_ = ['ID_Aviso', 'Titulo', 'Mensaje', 'Enlaces', 'Audiencia', 'Estado', 'Programado_Para', 'Caduca_En', 'Creado_Por', 'Creado_Por_Nombre', 'Creado_En'];
var AVISOS_VISTOS_ENCABEZADOS_ = ['ID_Usuario', 'Vistos_Hasta'];
var AVISOS_LIMITES_ = { titulo: 120, mensaje: 2000, textoEnlace: 60, urlEnlace: 500, enlaces: 5, personas: 500 };

function jsonSeguro_(texto, porDefecto) {
  try { return texto ? JSON.parse(texto) : porDefecto; } catch (e) { return porDefecto; }
}

/** Milisegundos de una fecha de la hoja, o null si no hay fecha válida (NO NaN: al guardarse en el caché como JSON, NaN se vuelve null y cambiaba el resultado de las comparaciones). */
function aMsSeguro_(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
  return isNaN(ms) ? null : ms;
}

/** Todos los avisos de la hoja como objetos listos para evaluar (con caché; las fechas como milisegundos). */
function leerAvisosConCache_() {
  return conCacheArchivos_('avisos', function () {
    const hoja = obtenerSpreadsheet_().getSheetByName('Avisos');
    if (!hoja || hoja.getLastRow() < 2) return { avisos: [] };
    const datos = hoja.getDataRange().getValues();
    const idx = indiceDeEncabezados_(datos[0]);
    const avisos = [];
    for (let i = 1; i < datos.length; i++) {
      const f = datos[i];
      if (!f[idx['ID_Aviso']]) continue;
      avisos.push({
        id: String(f[idx['ID_Aviso']]),
        titulo: String(f[idx['Titulo']] || ''),
        mensaje: String(f[idx['Mensaje']] || ''),
        enlaces: jsonSeguro_(f[idx['Enlaces']], []),
        audiencia: jsonSeguro_(f[idx['Audiencia']], { tipo: 'todos' }),
        estado: String(f[idx['Estado']] || ''),
        programadoPara: aMsSeguro_(f[idx['Programado_Para']]),
        caducaEn: aMsSeguro_(f[idx['Caduca_En']]),
        creadoPor: String(f[idx['Creado_Por']] || ''),
        creadoPorNombre: String(f[idx['Creado_Por_Nombre']] || ''),
        creadoEn: aMsSeguro_(f[idx['Creado_En']])
      });
    }
    return { avisos: avisos };
  });
}

/** ¿Este aviso le corresponde a esta persona? (rolId como texto; alcance de propiedades de Acceso.js) */
function audienciaIncluye_(audiencia, idUsuario, rolId, alcance) {
  const a = audiencia || { tipo: 'todos' };
  if (a.tipo === 'todos') return true;
  if (a.tipo === 'roles') return (a.roles || []).map(String).indexOf(String(rolId)) !== -1;
  if (a.tipo === 'personas') return (a.personas || []).map(String).indexOf(String(idUsuario)) !== -1;
  if (a.tipo === 'propiedades') {
    if (alcance.todos) return true;
    return (a.propiedades || []).some(function (p) { return alcance.hoteles.has(String(p).trim()); });
  }
  return false;
}

/** Los avisos que esta persona puede ver ahora: de su audiencia, ya programados y sin caducar, sin cancelar; el más reciente primero. */
function avisosVisiblesPara_(idUsuario, ahoraMs) {
  const id = String(idUsuario).trim();
  const rolId = String(obtenerInfoRol_(obtenerRolDeUsuario_(id)).id);
  const alcance = alcanceDeHoteles_(id);
  return leerAvisosConCache_().avisos
    .filter(function (a) {
      if (a.estado !== 'Programado') return false;
      if (a.programadoPara === null || a.programadoPara > ahoraMs) return false;
      if (a.caducaEn !== null && a.caducaEn <= ahoraMs) return false;
      return audienciaIncluye_(a.audiencia, id, rolId, alcance);
    })
    .sort(function (x, y) { return y.programadoPara - x.programadoPara; })
    .slice(0, AVISOS_MAX_VISIBLES_);
}

function leerVistosHasta_(idUsuario) {
  const clave = 'oxo:avv:' + String(idUsuario).trim();
  try {
    const guardado = CacheService.getScriptCache().get(clave);
    if (guardado !== null && guardado !== undefined) return Number(guardado) || 0;
  } catch (e) {}
  let ms = 0;
  const hoja = obtenerSpreadsheet_().getSheetByName('Avisos_Vistos');
  if (hoja && hoja.getLastRow() >= 2) {
    const fila = buscarFilaEnColumna_(hoja, 1, String(idUsuario).trim());
    if (fila !== -1) ms = aMsSeguro_(hoja.getRange(fila, 2).getValue()) || 0;
  }
  try { CacheService.getScriptCache().put(clave, String(ms), 21600); } catch (e) {}
  return ms;
}

/** Avisos de la campana de la persona: { success, avisos: [{ id, titulo, mensaje, enlaces, fecha, nuevo }], noLeidos }. */
function obtenerAvisos(idUsuarioOToken) {
  try {
    const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (!solicitante || !solicitante.idUsuario) return { success: false, message: 'Tu sesión no es válida. Vuelve a iniciar sesión.', avisos: [], noLeidos: 0 };
    const ahora = Date.now();
    const vistosHasta = leerVistosHasta_(solicitante.idUsuario);
    const avisos = avisosVisiblesPara_(solicitante.idUsuario, ahora).map(function (a) {
      return { id: a.id, titulo: a.titulo, mensaje: a.mensaje, enlaces: a.enlaces, fecha: new Date(a.programadoPara).toISOString(), nuevo: a.programadoPara > vistosHasta };
    });
    return { success: true, avisos: avisos, noLeidos: avisos.filter(function (a) { return a.nuevo; }).length };
  } catch (error) {
    Logger.log('Error obtenerAvisos: ' + error);
    return { success: false, message: 'No se pudieron leer los avisos', avisos: [], noLeidos: 0 };
  }
}

/** Marca como vistos todos los avisos que hay ahora (guarda "Vistos_Hasta" de la persona). */
function marcarAvisosVistos(idUsuarioOToken) {
  try {
    const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (!solicitante || !solicitante.idUsuario) return { success: false, message: 'Tu sesión no es válida. Vuelve a iniciar sesión.' };
    const id = String(solicitante.idUsuario).trim();
    const ahora = Date.now();

    const ss = obtenerSpreadsheet_();
    let hoja = ss.getSheetByName('Avisos_Vistos');
    if (!hoja) hoja = obtenerOCrearHoja_(ss, 'Avisos_Vistos', AVISOS_VISTOS_ENCABEZADOS_);

    const lock = LockService.getScriptLock();
    try {
      tomarCandado_(lock, 10000);
      const fila = hoja.getLastRow() >= 2 ? buscarFilaEnColumna_(hoja, 1, id) : -1;
      if (fila !== -1) hoja.getRange(fila, 2).setValue(new Date(ahora));
      else hoja.appendRow([id, new Date(ahora)]);
    } finally {
      liberarCandado_(lock);
    }
    try { CacheService.getScriptCache().put('oxo:avv:' + id, String(ahora), 21600); } catch (e) {}
    return { success: true };
  } catch (error) {
    Logger.log('Error marcarAvisosVistos: ' + error);
    return { success: false, message: 'No se pudo marcar como visto' };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Creación (la usa la acción de los superadministradores y las funciones del editor)
// ---------------------------------------------------------------------------------------------------------------------

function textoLimpio_(valor, max) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** Valida y normaliza los datos de un aviso. Devuelve { error } o { aviso } (con enlaces internos resueltos). Nada de HTML: el texto se muestra escapado. */
function validarDatosDeAviso_(datos, ahoraMs) {
  if (!datos || typeof datos !== 'object') return { error: 'Faltan los datos del aviso' };
  const titulo = textoLimpio_(datos.titulo, AVISOS_LIMITES_.titulo);
  const mensaje = textoLimpio_(datos.mensaje, AVISOS_LIMITES_.mensaje);
  if (!titulo) return { error: 'Escribe un título' };
  if (!mensaje) return { error: 'Escribe el mensaje' };

  // Enlaces
  const enlacesEntrada = Array.isArray(datos.enlaces) ? datos.enlaces : [];
  if (enlacesEntrada.length > AVISOS_LIMITES_.enlaces) return { error: 'Máximo ' + AVISOS_LIMITES_.enlaces + ' enlaces por aviso' };
  const enlaces = [];
  for (let i = 0; i < enlacesEntrada.length; i++) {
    const e = enlacesEntrada[i] || {};
    const texto = textoLimpio_(e.texto, AVISOS_LIMITES_.textoEnlace);
    if (!texto) return { error: 'Cada enlace necesita un texto' };
    if (e.tipo === 'url') {
      const url = textoLimpio_(e.url, AVISOS_LIMITES_.urlEnlace);
      if (!/^https:\/\/[^\s<>"']+$/i.test(url)) return { error: 'El enlace «' + texto + '» debe empezar por https:// y no llevar espacios' };
      enlaces.push({ texto: texto, tipo: 'url', url: url });
    } else if (e.tipo === 'hotel') {
      const hotel = leerFilaDeHotelPorId_(e.id);
      if (!hotel) return { error: 'La propiedad del enlace «' + texto + '» no existe' };
      enlaces.push({ texto: texto, tipo: 'hotel', id: String(hotel.ID_Hotel), idHotel: String(hotel.ID_Hotel), nombre: String(hotel.Nombre_Hotel || '') });
    } else if (e.tipo === 'carpeta') {
      const c = filaPorColumna_('Carpetas', 'ID_Carpeta', String(e.id == null ? '' : e.id).trim());
      if (!c) return { error: 'La carpeta del enlace «' + texto + '» no existe' };
      const hc = leerFilaDeHotelPorId_(c.ID_Hotel);
      enlaces.push({ texto: texto, tipo: 'carpeta', id: String(c.ID_Carpeta), idHotel: String(c.ID_Hotel), nombreHotel: hc ? String(hc.Nombre_Hotel || '') : '', nombre: String(c.Nombre_Carpeta || '') });
    } else if (e.tipo === 'archivo') {
      const a = filaPorColumna_('Archivos', 'ID_Archivo', String(e.id == null ? '' : e.id).trim());
      if (!a) return { error: 'El archivo del enlace «' + texto + '» no existe' };
      const c = filaPorColumna_('Carpetas', 'ID_Carpeta', String(a.ID_Carpeta));
      const ha = c ? leerFilaDeHotelPorId_(c.ID_Hotel) : null;
      enlaces.push({ texto: texto, tipo: 'archivo', id: String(a.ID_Archivo), idCarpeta: String(a.ID_Carpeta), idHotel: c ? String(c.ID_Hotel) : '', nombreHotel: ha ? String(ha.Nombre_Hotel || '') : '', nombre: String(a.Nombre_Archivo || '') });
    } else {
      return { error: 'Tipo de enlace no válido en «' + texto + '»' };
    }
  }

  // Audiencia
  const aud = datos.audiencia || { tipo: 'todos' };
  let audiencia;
  if (aud.tipo === 'todos') audiencia = { tipo: 'todos' };
  else if (aud.tipo === 'roles') {
    const roles = (aud.roles || []).map(function (r) { return Number(r); }).filter(function (r) { return r === 1 || r === 2 || r === 3; });
    if (!roles.length) return { error: 'Elige al menos un rol' };
    audiencia = { tipo: 'roles', roles: roles.filter(function (r, i) { return roles.indexOf(r) === i; }) };
  } else if (aud.tipo === 'propiedades') {
    const existentes = (leerHojaConCache_('Hoteles') || []).slice(1).map(function (f) { return String(f[0]).trim(); });
    const props = (aud.propiedades || []).map(function (p) { return String(p).trim(); }).filter(Boolean);
    if (!props.length) return { error: 'Elige al menos una propiedad' };
    if (props.some(function (p) { return existentes.indexOf(p) === -1; })) return { error: 'Alguna propiedad elegida no existe' };
    audiencia = { tipo: 'propiedades', propiedades: props.filter(function (p, i) { return props.indexOf(p) === i; }) };
  } else if (aud.tipo === 'personas') {
    const personas = (aud.personas || []).map(function (p) { return String(p).trim(); }).filter(Boolean);
    if (!personas.length) return { error: 'Elige al menos una persona' };
    if (personas.length > AVISOS_LIMITES_.personas) return { error: 'Demasiadas personas elegidas' };
    const usuarios = obtenerUsuariosLite_().usuarios.map(function (u) { return u.id; });
    if (personas.some(function (p) { return usuarios.indexOf(p) === -1; })) return { error: 'Alguna persona elegida no existe' };
    audiencia = { tipo: 'personas', personas: personas.filter(function (p, i) { return personas.indexOf(p) === i; }) };
  } else {
    return { error: 'Audiencia no válida' };
  }

  // Fechas: sin fecha = enviar ahora; la caducidad, si se indica, debe ser posterior al envío
  let programado = aMsSeguro_(datos.programadoPara);
  if (programado === null) programado = ahoraMs;
  const caduca = aMsSeguro_(datos.caducaEn);
  if (caduca !== null && caduca <= programado) return { error: 'La fecha de caducidad debe ser posterior a la del envío' };

  return { aviso: { titulo: titulo, mensaje: mensaje, enlaces: enlaces, audiencia: audiencia, programadoPara: programado, caducaEn: caduca } };
}

function leerFilaDeHotelPorId_(idHotel) {
  const valores = leerHojaConCache_('Hoteles');
  if (!valores || valores.length < 2) return null;
  const idx = indiceDeEncabezados_(valores[0]);
  const fila = valores.slice(1).filter(function (f) { return String(f[idx['ID_Hotel']]).trim() === String(idHotel == null ? '' : idHotel).trim(); })[0];
  if (!fila) return null;
  const o = {};
  Object.keys(idx).forEach(function (n) { o[n] = fila[idx[n]]; });
  return o;
}

/** Guarda un aviso ya validado. Devuelve { success, id }. "creador": { id, nombre }. */
function guardarAviso_(aviso, creador) {
  const ss = obtenerSpreadsheet_();
  let hoja = ss.getSheetByName('Avisos');
  if (!hoja) hoja = obtenerOCrearHoja_(ss, 'Avisos', AVISOS_ENCABEZADOS_);
  const id = 'AVI-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  agregarFilaSegura_(hoja, function () {
    return [id, aviso.titulo, aviso.mensaje, JSON.stringify(aviso.enlaces), JSON.stringify(aviso.audiencia), 'Programado',
      new Date(aviso.programadoPara), aviso.caducaEn === null ? '' : new Date(aviso.caducaEn), String(creador.id), String(creador.nombre || ''), new Date()];
  });
  try { SpreadsheetApp.flush(); } catch (e) {}
  invalidarCacheArchivos_();
  registrarAuditoriaSimple_(creador.id, 'AVISO_CREADO', 'Creó el aviso «' + aviso.titulo + '» para ' + descripcionDeAudiencia_(aviso.audiencia), 'Aviso');
  return { success: true, id: id };
}

function descripcionDeAudiencia_(a) {
  if (a.tipo === 'todos') return 'todas las personas';
  if (a.tipo === 'roles') return 'los roles ' + a.roles.join(', ');
  if (a.tipo === 'propiedades') return a.propiedades.length + ' propiedad(es)';
  return a.personas.length + ' persona(s)';
}

// ---------------------------------------------------------------------------------------------------------------------
// Gestión (solo Superadministradores)
// ---------------------------------------------------------------------------------------------------------------------

/** { idUsuario, nombre } si quien llama es Superadministrador (rol 3); si no, null. */
function superadminDeAvisos_(idUsuarioOToken) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken);
  if (!solicitante || !solicitante.idUsuario) return null;
  const info = obtenerInfoRol_(obtenerRolDeUsuario_(solicitante.idUsuario));
  if (!info || String(info.id) !== '3') return null;
  const yo = obtenerUsuariosLite_().usuarios.filter(function (u) { return u.id === String(solicitante.idUsuario).trim(); })[0];
  return { idUsuario: String(solicitante.idUsuario).trim(), nombre: yo ? yo.nombre : '' };
}

var MENSAJE_SOLO_SUPERADMIN_AVISOS_ = 'Solo un Superadministrador puede crear y gestionar avisos';

/** Crea un aviso (envío inmediato o programado). */
function crearAviso(datos, idUsuarioOToken) {
  try {
    const sa = superadminDeAvisos_(idUsuarioOToken);
    if (!sa) return { success: false, message: MENSAJE_SOLO_SUPERADMIN_AVISOS_ };
    const v = validarDatosDeAviso_(datos, Date.now());
    if (v.error) return { success: false, message: v.error };
    const r = guardarAviso_(v.aviso, { id: sa.idUsuario, nombre: sa.nombre });
    const programado = v.aviso.programadoPara > Date.now() + 1000;
    return { success: true, id: r.id, message: programado ? 'Aviso programado' : 'Aviso enviado' };
  } catch (error) {
    Logger.log('Error crearAviso: ' + error);
    return { success: false, message: 'No se pudo crear el aviso' };
  }
}

/** Busca la fila de un aviso: { hoja, fila, valores, idx } o null. */
function filaDeAviso_(idAviso) {
  const hoja = obtenerSpreadsheet_().getSheetByName('Avisos');
  if (!hoja || hoja.getLastRow() < 2) return null;
  const fila = buscarFilaEnColumna_(hoja, 1, String(idAviso).trim());
  if (fila === -1) return null;
  const idx = indiceDeEncabezados_(hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]);
  return { hoja: hoja, fila: fila, idx: idx, valores: hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0] };
}

/** Edita un aviso que TODAVÍA no se envió (programado para más adelante). Uno ya enviado solo se puede cancelar. */
function editarAviso(idAviso, datos, idUsuarioOToken) {
  const lock = LockService.getScriptLock();
  try {
    const sa = superadminDeAvisos_(idUsuarioOToken);
    if (!sa) return { success: false, message: MENSAJE_SOLO_SUPERADMIN_AVISOS_ };
    const v = validarDatosDeAviso_(datos, Date.now());
    if (v.error) return { success: false, message: v.error };

    tomarCandado_(lock, 10000);
    const f = filaDeAviso_(idAviso);
    if (!f) return { success: false, message: 'Aviso no encontrado' };
    const estado = String(f.valores[f.idx['Estado']] || '');
    const programado = aMsSeguro_(f.valores[f.idx['Programado_Para']]);
    if (estado !== 'Programado') return { success: false, message: 'Un aviso cancelado no se puede editar' };
    if (programado === null || programado <= Date.now()) return { success: false, message: 'Este aviso ya fue enviado: solo se puede cancelar' };

    const nuevos = f.valores.slice();
    nuevos[f.idx['Titulo']] = v.aviso.titulo;
    nuevos[f.idx['Mensaje']] = v.aviso.mensaje;
    nuevos[f.idx['Enlaces']] = JSON.stringify(v.aviso.enlaces);
    nuevos[f.idx['Audiencia']] = JSON.stringify(v.aviso.audiencia);
    nuevos[f.idx['Programado_Para']] = new Date(v.aviso.programadoPara);
    nuevos[f.idx['Caduca_En']] = v.aviso.caducaEn === null ? '' : new Date(v.aviso.caducaEn);
    f.hoja.getRange(f.fila, 1, 1, nuevos.length).setValues([nuevos]);
    registrarAuditoriaSimple_(sa.idUsuario, 'AVISO_EDITADO', 'Editó el aviso «' + v.aviso.titulo + '»', 'Aviso');
    return { success: true, message: 'Aviso actualizado' };
  } catch (error) {
    Logger.log('Error editarAviso: ' + error);
    return { success: false, message: 'No se pudo editar el aviso' };
  } finally {
    liberarCandado_(lock);
  }
}

/** Cancela un aviso (deja de verse para todos, enviado o no). */
function cancelarAviso(idAviso, idUsuarioOToken) {
  const lock = LockService.getScriptLock();
  try {
    const sa = superadminDeAvisos_(idUsuarioOToken);
    if (!sa) return { success: false, message: MENSAJE_SOLO_SUPERADMIN_AVISOS_ };
    tomarCandado_(lock, 10000);
    const f = filaDeAviso_(idAviso);
    if (!f) return { success: false, message: 'Aviso no encontrado' };
    f.hoja.getRange(f.fila, f.idx['Estado'] + 1).setValue('Cancelado');
    registrarAuditoriaSimple_(sa.idUsuario, 'AVISO_CANCELADO', 'Canceló el aviso «' + f.valores[f.idx['Titulo']] + '»', 'Aviso');
    return { success: true, message: 'Aviso cancelado' };
  } catch (error) {
    Logger.log('Error cancelarAviso: ' + error);
    return { success: false, message: 'No se pudo cancelar el aviso' };
  } finally {
    liberarCandado_(lock);
  }
}

var NOMBRES_DE_ROL_AVISO_ = { 1: 'Usuarios', 2: 'Administradores', 3: 'Superadministradores' };

/** Texto legible de a quién va dirigido un aviso. */
function describirAudiencia_(a, nombresDePropiedades, nombresDePersonas) {
  if (a.tipo === 'todos') return 'Todas las personas';
  if (a.tipo === 'roles') return 'Roles: ' + a.roles.map(function (r) { return NOMBRES_DE_ROL_AVISO_[r] || r; }).join(', ');
  if (a.tipo === 'propiedades') return 'Propiedades: ' + a.propiedades.map(function (p) { return nombresDePropiedades[p] || p; }).join(', ');
  const nombres = a.personas.map(function (p) { return nombresDePersonas[p] || p; });
  return 'Personas: ' + nombres.slice(0, 3).join(', ') + (nombres.length > 3 ? ' y ' + (nombres.length - 3) + ' más' : '');
}

/** Lista de gestión: todos los avisos con su estado, destinatarios y cuántas personas ya los vieron. */
function obtenerAvisosGestion(idUsuarioOToken) {
  try {
    const sa = superadminDeAvisos_(idUsuarioOToken);
    if (!sa) return { success: false, message: MENSAJE_SOLO_SUPERADMIN_AVISOS_, avisos: [] };
    const ahora = Date.now();

    const lite = obtenerUsuariosLite_();
    const activos = lite.usuarios.filter(function (u) { return u.id && (!u.estado || u.estado === 'Activo'); });
    const nombresDePersonas = {}; lite.usuarios.forEach(function (u) { nombresDePersonas[u.id] = u.nombre; });
    const nombresDePropiedades = {};
    (leerHojaConCache_('Hoteles') || []).slice(1).forEach(function (f) { nombresDePropiedades[String(f[0]).trim()] = String(f[1] || ''); });
    const personas = activos.map(function (u) { return { id: u.id, rolId: String(obtenerInfoRol_(u.rol).id), alcance: alcanceDeFilaLite_(u, lite.hayHoteles) }; });

    const vistos = {};
    const hojaVistos = obtenerSpreadsheet_().getSheetByName('Avisos_Vistos');
    if (hojaVistos && hojaVistos.getLastRow() >= 2) {
      hojaVistos.getDataRange().getValues().slice(1).forEach(function (f) { vistos[String(f[0]).trim()] = aMsSeguro_(f[1]) || 0; });
    }

    const avisos = leerAvisosConCache_().avisos.slice()
      .sort(function (x, y) { return (y.creadoEn || 0) - (x.creadoEn || 0); })
      .slice(0, 100)
      .map(function (a) {
        let estado = 'Enviado';
        if (a.estado === 'Cancelado') estado = 'Cancelado';
        else if (a.caducaEn !== null && a.caducaEn <= ahora) estado = 'Caducado';
        else if (a.programadoPara === null || a.programadoPara > ahora) estado = 'Programado';
        const destinatarios = personas.filter(function (p) { return audienciaIncluye_(a.audiencia, p.id, p.rolId, p.alcance); });
        const quienesVieron = estado === 'Programado' ? 0 : destinatarios.filter(function (p) { return (vistos[p.id] || 0) >= (a.programadoPara || 0); }).length;
        return {
          id: a.id, titulo: a.titulo, mensaje: a.mensaje, enlaces: a.enlaces, audiencia: a.audiencia,
          audienciaTexto: describirAudiencia_(a.audiencia, nombresDePropiedades, nombresDePersonas),
          estado: estado, programadoPara: a.programadoPara === null ? null : new Date(a.programadoPara).toISOString(),
          caducaEn: a.caducaEn === null ? null : new Date(a.caducaEn).toISOString(),
          creadoPor: a.creadoPorNombre, creadoEn: a.creadoEn === null ? null : new Date(a.creadoEn).toISOString(),
          destinatarios: destinatarios.length, vistos: quienesVieron, editable: estado === 'Programado'
        };
      });
    return { success: true, avisos: avisos };
  } catch (error) {
    Logger.log('Error obtenerAvisosGestion: ' + error);
    return { success: false, message: 'No se pudo leer la lista de avisos', avisos: [] };
  }
}

/**
 * EDITOR: crea un aviso de ejemplo para todas las personas, para ver cómo se muestra la campana antes de que exista la pantalla para
 * crearlos. No está en la lista de acciones web. Borra el aviso desde la hoja "Avisos" (o cámbiale el Estado a "Cancelado").
 */
function crearAvisoDePrueba() {
  const v = validarDatosDeAviso_({
    titulo: 'Avisos del sistema',
    mensaje: 'Este es un aviso de prueba. Desde aquí los superadministradores podrán comunicar novedades a todas las personas o a un grupo.',
    enlaces: [{ texto: 'Ir a la documentación de Google', tipo: 'url', url: 'https://support.google.com/' }],
    audiencia: { tipo: 'todos' }
  }, Date.now());
  if (v.error) { Logger.log('No se pudo crear el aviso: ' + v.error); return; }
  const r = guardarAviso_(v.aviso, { id: 'editor', nombre: 'Editor de Apps Script' });
  Logger.log('Aviso de prueba creado: ' + r.id);
}
