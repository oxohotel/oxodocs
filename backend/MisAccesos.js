/**
 * Accesos propios: una persona ya registrada puede pedir acceso a más propiedades (y cancelar lo que pidió).
 *
 * Reutiliza el mismo circuito del registro: lo pedido queda en "Hoteles_Solicitados" y cada administrador resuelve las
 * propiedades de su alcance (backend/Solicitudes.js). La cuenta sigue activa todo el tiempo.
 *
 * Todas las funciones exigen una sesión VÁLIDA (token) y solo actúan sobre la cuenta dueña del token: no reciben el id de la
 * persona, así que nadie puede pedir ni cancelar en nombre de otra.
 */

var MAX_PENDIENTES_USUARIO_ = 20;

/** { idUsuario } de la sesión o null. Solo se acepta un token vigente; el id suelto no sirve. */
function sesionPropia_(token) {
  const t = String(token == null ? '' : token).trim();
  if (!t) return null;
  const info = obtenerUsuarioPorToken(t);
  return info && info.idUsuario ? info : null;
}

/** Contexto de la cuenta que llama: { yo, catalogo, todos } o { error }. Parte de lecturas frescas (se decide sobre la propia cuenta). */
function contextoMisAccesos_(token) {
  const sesion = sesionPropia_(token);
  if (!sesion) return { error: 'Tu sesión no es válida. Vuelve a iniciar sesión.' };

  invalidarCacheUsuarios_();
  const usuarios = leerUsuariosParaAlcance_(null);
  const yo = usuarios.filter(function (u) { return u.id === String(sesion.idUsuario).trim(); })[0];
  if (!yo || yo.estado !== 'Activo') return { error: 'Tu cuenta no está activa' };

  const catalogo = obtenerHotelesParaRegistro().hoteles || []; // TODAS las propiedades, con su módulo
  const todos = yo.rolId === '3' || esAccesoTotalHoteles_(yo.hoteles);
  return { yo: yo, catalogo: catalogo, todos: todos };
}

/** Fila de la hoja Usuarios de esa persona y las columnas que se tocan. */
function filaDeMiCuenta_(idUsuario) {
  const hoja = obtenerSpreadsheet_().getSheetByName('Usuarios');
  if (!hoja) return null;
  const datos = hoja.getDataRange().getValues();
  const enc = datos[0].map(normalizarColumna_);
  const colId = enc.findIndex(function (n) { return n === 'idusuario' || n === 'id'; });
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][colId !== -1 ? colId : 0]).trim() === String(idUsuario).trim()) {
      return {
        hoja: hoja, fila: i + 1,
        colPermitidos: obtenerOAgregarColumna_(hoja, 'Hoteles_Permitidos'),
        colSolicitados: obtenerOAgregarColumna_(hoja, 'Hoteles_Solicitados'),
        nombre: datos[i][1]
      };
    }
  }
  return null;
}

function porIds_(catalogo, ids) {
  return ids.map(function (id) { return catalogo.filter(function (h) { return h.idHotel === id; })[0]; }).filter(Boolean);
}

/**
 * Para la pantalla: a qué propiedades tiene acceso, cuáles pidió y siguen pendientes, y cuáles puede pedir todavía.
 * Quien tiene acceso a TODAS (superadmin o "Todos") no tiene nada que pedir.
 */
function obtenerMisAccesos(idUsuarioOToken) {
  const ctx = contextoMisAccesos_(idUsuarioOToken);
  if (ctx.error) return { success: false, message: ctx.error };

  if (ctx.todos) return { success: true, tieneTodos: true, permitidos: [], pendientes: [], disponibles: [] };

  const permitidos = listaDeIds_(ctx.yo.hoteles);
  const pendientes = listaDeIds_(ctx.yo.solicitados);
  return {
    success: true,
    tieneTodos: false,
    permitidos: porIds_(ctx.catalogo, permitidos),
    pendientes: porIds_(ctx.catalogo, pendientes),
    disponibles: ctx.catalogo.filter(function (h) { return permitidos.indexOf(h.idHotel) === -1 && pendientes.indexOf(h.idHotel) === -1; })
  };
}

/** Pide acceso a una o varias propiedades más. Ignora las que ya tiene o ya pidió. */
function solicitarAccesoPropiedades(idUsuarioOToken, hotelesIds) {
  const ctx = contextoMisAccesos_(idUsuarioOToken);
  if (ctx.error) return { success: false, message: ctx.error };
  if (ctx.todos) return { success: false, message: 'Ya tienes acceso a todas las propiedades' };

  const pedidas = listaDeIds_(hotelesIds);
  if (!pedidas.length) return { success: false, message: 'Elige al menos una propiedad' };
  const validas = ctx.catalogo.map(function (h) { return h.idHotel; });
  if (pedidas.length > MAX_PENDIENTES_USUARIO_) return { success: false, message: 'Pediste demasiadas propiedades a la vez (máximo ' + MAX_PENDIENTES_USUARIO_ + ')' };
  if (pedidas.some(function (id) { return validas.indexOf(id) === -1; })) return { success: false, message: 'Selecciona propiedades válidas de la lista' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const cuenta = filaDeMiCuenta_(ctx.yo.id);
    if (!cuenta) return { success: false, message: 'No se encontró tu cuenta' };

    // Se relee la fila bajo el candado: un administrador pudo resolver algo hace un instante
    const fila = cuenta.hoja.getRange(cuenta.fila, 1, 1, cuenta.hoja.getLastColumn()).getValues()[0];
    const permitidos = listaDeIds_(fila[cuenta.colPermitidos]);
    const actuales = listaDeIds_(fila[cuenta.colSolicitados]);

    const nuevas = pedidas.filter(function (id) { return permitidos.indexOf(id) === -1 && actuales.indexOf(id) === -1; });
    if (!nuevas.length) return { success: false, message: 'Ya tienes acceso a esas propiedades o ya las pediste' };
    if (actuales.length + nuevas.length > MAX_PENDIENTES_USUARIO_) {
      return { success: false, message: 'Tienes demasiadas solicitudes pendientes (máximo ' + MAX_PENDIENTES_USUARIO_ + '). Espera a que se resuelvan algunas.' };
    }

    cuenta.hoja.getRange(cuenta.fila, cuenta.colSolicitados + 1).setValue(actuales.concat(nuevas).join(','));
    invalidarCacheUsuarios_();

    const nombres = nombresDeHoteles_(nuevas);
    registrarAuditoriaSimple_(ctx.yo.id, 'SOLICITUD_ACCESO', 'Pidió acceso a: ' + nombres.join(', '), 'Usuario');
    notificarAprobadoresDeSolicitudAdicional_(ctx.yo.email, nuevas);

    return {
      success: true,
      solicitadas: porIds_(ctx.catalogo, nuevas),
      ignoradas: pedidas.length - nuevas.length,
      message: 'Solicitud enviada: ' + nombres.join(', ') + '. El administrador de cada propiedad la revisará.'
    };
  } catch (error) {
    Logger.log('Error solicitarAccesoPropiedades: ' + error);
    return { success: false, message: 'No se pudo enviar la solicitud: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Cancela solicitudes propias que siguen pendientes. Sin ids, cancela todas. No toca accesos ya aprobados. */
function cancelarSolicitudesPropias(idUsuarioOToken, hotelesIds) {
  const ctx = contextoMisAccesos_(idUsuarioOToken);
  if (ctx.error) return { success: false, message: ctx.error };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const cuenta = filaDeMiCuenta_(ctx.yo.id);
    if (!cuenta) return { success: false, message: 'No se encontró tu cuenta' };

    const fila = cuenta.hoja.getRange(cuenta.fila, 1, 1, cuenta.hoja.getLastColumn()).getValues()[0];
    const actuales = listaDeIds_(fila[cuenta.colSolicitados]);
    const aCancelar = hotelesIds === undefined || hotelesIds === null || (Array.isArray(hotelesIds) && !hotelesIds.length) ? actuales : listaDeIds_(hotelesIds);
    const canceladas = actuales.filter(function (id) { return aCancelar.indexOf(id) !== -1; });
    if (!canceladas.length) return { success: false, message: 'No tienes solicitudes pendientes para cancelar' };

    cuenta.hoja.getRange(cuenta.fila, cuenta.colSolicitados + 1).setValue(actuales.filter(function (id) { return canceladas.indexOf(id) === -1; }).join(','));
    invalidarCacheUsuarios_();
    registrarAuditoriaSimple_(ctx.yo.id, 'SOLICITUD_ACCESO', 'Canceló su solicitud de: ' + nombresDeHoteles_(canceladas).join(', '), 'Usuario');
    return { success: true, message: 'Solicitud cancelada', canceladas: canceladas };
  } catch (error) {
    Logger.log('Error cancelarSolicitudesPropias: ' + error);
    return { success: false, message: 'No se pudo cancelar: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
