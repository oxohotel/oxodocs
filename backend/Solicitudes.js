/**
 * Resolución de solicitudes de acceso, propiedad por propiedad.
 *
 * Reglas:
 *   - Quien se registra pide una o varias propiedades (Hoteles_Solicitados). Cada una la resuelve el administrador DE ESA
 *     propiedad (o un superadministrador, o un administrador con TODOS). Un administrador nunca resuelve propiedades ajenas.
 *   - Aprobar una propiedad la suma a Hoteles_Permitidos y la saca de Hoteles_Solicitados. Denegarla solo la saca de
 *     Hoteles_Solicitados. La persona accede únicamente a lo aprobado.
 *   - La cuenta pasa de "Pendiente_Aprobacion" a "Activo" cuando se aprueba la primera propiedad.
 *   - Si se resuelven (deniegan) todas las propiedades de una cuenta que nunca se activó, la solicitud queda "Solicitud_Cerrada"
 *     y la persona puede volver a registrarse con el mismo correo (backend/Auth.js: registrarUsuario).
 */

var ESTADO_SOLICITUD_CERRADA_ = 'Solicitud_Cerrada';

function puedeResolverHotel_(alcance, idHotel) {
  return !!(alcance.esSuperadmin || alcance.global || alcance.hoteles.has(String(idHotel)));
}

/** Prepara el contexto común. Devuelve { error } o { ss, hoja, solicitante, alcance, objetivo, fila, col }. */
function prepararResolucion_(idObjetivo, idUsuarioOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante || !solicitante.idUsuario || !usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback)) {
    return { error: 'No tienes permiso para gestionar usuarios' };
  }

  // Decisión de seguridad: se parte de lecturas frescas, no de un caché de hasta 30 minutos
  invalidarCacheUsuarios_();
  const ss = obtenerSpreadsheet_();
  const hoja = ss.getSheetByName('Usuarios');
  if (!hoja) return { error: 'Hoja Usuarios no encontrada' };

  const usuarios = leerUsuariosParaAlcance_(ss);
  const alcance = calcularAlcanceGestion_(usuarios, solicitante.idUsuario);
  // Una cuenta desactivada no puede resolver solicitudes aunque conserve una sesión abierta
  const yo = usuarios.filter(function (u) { return u.id === alcance.idSolicitante; })[0];
  if (!yo || yo.estado !== 'Activo') return { error: 'Tu cuenta no está activa' };
  const objetivo = usuarios.filter(function (u) { return u.id === String(idObjetivo).trim(); })[0];
  if (!objetivo) return { error: 'Usuario no encontrado' };
  if (objetivo.id === alcance.idSolicitante) return { error: 'No puedes resolver tu propia solicitud' };
  if (objetivo.rolId === '3') return { error: 'No se puede gestionar a un superadministrador' };

  const datos = hoja.getDataRange().getValues();
  const enc = datos[0].map(normalizarColumna_);
  const colId = enc.findIndex(function (n) { return n === 'idusuario' || n === 'id'; });
  let fila = -1;
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][colId !== -1 ? colId : 0]).trim() === objetivo.id) { fila = i + 1; break; }
  }
  if (fila === -1) return { error: 'Usuario no encontrado' };

  const colEstadoBuscada = enc.findIndex(function (n) { return n === 'estado'; });
  return {
    ss: ss, hoja: hoja, solicitante: solicitante, alcance: alcance, objetivo: objetivo, fila: fila,
    col: {
      estado: colEstadoBuscada !== -1 ? colEstadoBuscada : 5,
      permitidos: obtenerOAgregarColumna_(hoja, 'Hoteles_Permitidos'),
      solicitados: obtenerOAgregarColumna_(hoja, 'Hoteles_Solicitados')
    }
  };
}

/**
 * decisiones: { idHotel: 'aprobar' | 'denegar' }. Solo se aplican las de propiedades que el solicitante puede resolver y que la
 * persona realmente pidió; las demás se ignoran. Devuelve el resultado o { success:false, message }.
 */
function aplicarDecisionesSolicitud_(ctx, decisiones) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    // Se relee la fila bajo el candado: otro administrador pudo resolver otra propiedad hace un instante
    const hoja = ctx.hoja;
    const fila = hoja.getRange(ctx.fila, 1, 1, hoja.getLastColumn()).getValues()[0];
    const estadoActual = String(fila[ctx.col.estado] == null ? '' : fila[ctx.col.estado]).trim();
    if (estadoActual !== 'Pendiente_Aprobacion' && estadoActual !== 'Activo') {
      return { success: false, message: 'Esta solicitud ya no está pendiente' };
    }

    const permitidosTexto = String(fila[ctx.col.permitidos] == null ? '' : fila[ctx.col.permitidos]).trim();
    const todos = esAccesoTotalHoteles_(permitidosTexto);
    let permitidos = todos ? [] : listaDeIds_(permitidosTexto);
    let solicitados = listaDeIds_(fila[ctx.col.solicitados]);

    const aprobados = [];
    const denegados = [];
    Object.keys(decisiones).forEach(function (idHotel) {
      if (solicitados.indexOf(idHotel) === -1) return;              // no la pidió
      if (!puedeResolverHotel_(ctx.alcance, idHotel)) return;       // no es una propiedad de este administrador
      if (decisiones[idHotel] === 'aprobar') {
        if (!todos && permitidos.indexOf(idHotel) === -1) permitidos.push(idHotel);
        aprobados.push(idHotel);
      } else {
        denegados.push(idHotel);
      }
    });

    if (!aprobados.length && !denegados.length) {
      return { success: false, message: 'No hay solicitudes de tus propiedades para resolver en esta cuenta' };
    }

    solicitados = solicitados.filter(function (id) { return aprobados.indexOf(id) === -1 && denegados.indexOf(id) === -1; });

    let estadoNuevo = estadoActual;
    if (aprobados.length && estadoActual === 'Pendiente_Aprobacion') estadoNuevo = 'Activo';
    const cerrada = estadoNuevo === 'Pendiente_Aprobacion' && !solicitados.length && !permitidos.length && !todos;
    if (cerrada) estadoNuevo = ESTADO_SOLICITUD_CERRADA_;

    if (aprobados.length) hoja.getRange(ctx.fila, ctx.col.permitidos + 1).setValue(todos ? permitidosTexto : permitidos.join(','));
    hoja.getRange(ctx.fila, ctx.col.solicitados + 1).setValue(solicitados.join(','));
    if (estadoNuevo !== estadoActual) hoja.getRange(ctx.fila, ctx.col.estado + 1).setValue(estadoNuevo);
    invalidarCacheUsuarios_();

    const partes = [];
    if (aprobados.length) partes.push('aprobó ' + nombresDeHoteles_(aprobados).join(', '));
    if (denegados.length) partes.push('denegó ' + nombresDeHoteles_(denegados).join(', '));
    registrarAuditoriaSimple_(ctx.solicitante.idUsuario, 'SOLICITUD_ACCESO',
      'Resolvió la solicitud de ' + ctx.objetivo.email + ': ' + partes.join(' y ') + (cerrada ? ' (solicitud cerrada)' : ''), 'Usuario');

    // El aviso a la persona va fuera del candado lógico: es de mejor esfuerzo
    const nombrePersona = String(fila[1] == null ? '' : fila[1]);
    notificarSolicitante_(ctx.objetivo.email, nombrePersona, aprobados, denegados, cerrada);

    return {
      success: true,
      aprobados: aprobados.map(function (id) { return { idHotel: id, nombre: nombreDeHotel_(id) }; }),
      denegados: denegados.map(function (id) { return { idHotel: id, nombre: nombreDeHotel_(id) }; }),
      restantes: solicitados,
      activado: estadoNuevo === 'Activo' && estadoActual === 'Pendiente_Aprobacion',
      cerrada: cerrada
    };
  } catch (error) {
    Logger.log('Error aplicarDecisionesSolicitud_: ' + error);
    return { success: false, message: 'No se pudo resolver la solicitud: ' + (error.message || error) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function textoResultadoSolicitud_(r) {
  const partes = [];
  if (r.aprobados.length) partes.push('Aprobado: ' + r.aprobados.map(function (h) { return h.nombre; }).join(', '));
  if (r.denegados.length) partes.push('Denegado: ' + r.denegados.map(function (h) { return h.nombre; }).join(', '));
  if (r.cerrada) partes.push('La solicitud quedó cerrada');
  else if (r.restantes.length) partes.push('Quedan pendientes ' + r.restantes.length + ' propiedad(es) de otros administradores');
  return partes.join('. ');
}

/** Aprueba o deniega UNA propiedad solicitada. decision: 'aprobar' | 'denegar'. */
function resolverSolicitudHotel(idUsuarioObjetivo, idHotel, decision, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  if (decision !== 'aprobar' && decision !== 'denegar') return { success: false, message: 'Decisión no válida' };
  const ctx = prepararResolucion_(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (ctx.error) return { success: false, message: ctx.error };
  const decisiones = {};
  decisiones[String(idHotel).trim()] = decision;
  const r = aplicarDecisionesSolicitud_(ctx, decisiones);
  if (r.success) r.message = textoResultadoSolicitud_(r);
  return r;
}

/**
 * Aprueba TODAS las propiedades pendientes que el solicitante puede resolver. Para una cuenta sin propiedades solicitadas
 * (registros anteriores a este flujo) solo un superadministrador o un administrador con TODOS puede activarla.
 */
function aprobarUsuario(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const ctx = prepararResolucion_(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (ctx.error) return { success: false, message: ctx.error };

  const pedidas = listaDeIds_(ctx.objetivo.solicitados);
  if (!pedidas.length) {
    if (ctx.objetivo.estado === 'Pendiente_Aprobacion' && (ctx.alcance.esSuperadmin || ctx.alcance.global)) {
      return cambiarEstadoUsuario(idUsuarioObjetivo, 'Activo', idUsuarioSolicitanteOToken, idUsuarioFallback);
    }
    return { success: false, message: 'Esta cuenta no tiene propiedades solicitadas que puedas aprobar' };
  }

  const decisiones = {};
  pedidas.forEach(function (id) { decisiones[id] = 'aprobar'; });
  const r = aplicarDecisionesSolicitud_(ctx, decisiones);
  if (r.success) r.message = textoResultadoSolicitud_(r);
  return r;
}

/**
 * Cierra la solicitud: deniega todas las propiedades pendientes que el solicitante puede resolver. Si la cuenta nunca se
 * activó y no queda nada pendiente, queda "Solicitud_Cerrada" y la persona puede volver a registrarse con el mismo correo.
 * Una cuenta pendiente SIN propiedades solicitadas (registro antiguo, o con un fallo) la cierra un superadministrador o un
 * administrador con TODOS.
 */
function cerrarSolicitudUsuario(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const ctx = prepararResolucion_(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (ctx.error) return { success: false, message: ctx.error };

  const pedidas = listaDeIds_(ctx.objetivo.solicitados);
  if (!pedidas.length) {
    if (ctx.objetivo.estado === 'Pendiente_Aprobacion' && (ctx.alcance.esSuperadmin || ctx.alcance.global)) {
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(10000);
        ctx.hoja.getRange(ctx.fila, ctx.col.estado + 1).setValue(ESTADO_SOLICITUD_CERRADA_);
        invalidarCacheUsuarios_();
      } finally { try { lock.releaseLock(); } catch (e) {} }
      registrarAuditoriaSimple_(ctx.solicitante.idUsuario, 'SOLICITUD_ACCESO', 'Cerró la solicitud de ' + ctx.objetivo.email, 'Usuario');
      notificarSolicitante_(ctx.objetivo.email, String(ctx.hoja.getRange(ctx.fila, 2).getValue() || ''), [], [], true);
      return { success: true, aprobados: [], denegados: [], restantes: [], activado: false, cerrada: true, message: 'La solicitud quedó cerrada' };
    }
    return { success: false, message: 'No hay solicitudes pendientes que puedas cerrar en esta cuenta' };
  }

  const decisiones = {};
  pedidas.forEach(function (id) { decisiones[id] = 'denegar'; });
  const r = aplicarDecisionesSolicitud_(ctx, decisiones);
  if (r.success) r.message = textoResultadoSolicitud_(r);
  return r;
}

/** Cuántas solicitudes puede resolver el solicitante (para la insignia del menú); null si no gestiona usuarios. */
function contarPendientesAprobacion_(idUsuarioOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante || !solicitante.idUsuario) return null;
  if (!usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback)) return null;

  const usuarios = leerUsuariosParaAlcance_(null);
  const alcance = calcularAlcanceGestion_(usuarios, solicitante.idUsuario);
  return usuarios.filter(function (u) {
    if (u.id === alcance.idSolicitante) return false;
    if (solicitudesResolubles_(alcance, u).length) return true;
    return u.estado === 'Pendiente_Aprobacion' && !listaDeIds_(u.solicitados).length && u.rolId !== '3' && (alcance.esSuperadmin || alcance.global);
  }).length;
}
