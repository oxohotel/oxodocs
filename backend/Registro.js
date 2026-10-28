/**
 * Solicitud de propiedades al registrarse y avisos del flujo de aprobación.
 *
 * Al registrarse la persona elige UNA O VARIAS propiedades (hotel o Corporativo). Eso NO le da acceso: queda guardado en la
 * columna "Hoteles_Solicitados" (ids separados por coma). Cada propiedad la resuelve su propio administrador
 * (backend/Solicitudes.js): al aprobarla pasa a "Hoteles_Permitidos" y sale de "Hoteles_Solicitados"; si la deniega, solo sale
 * de "Hoteles_Solicitados". La persona solo accede a las propiedades que le aprobaron.
 */

var URL_APLICACION_ = 'https://oxohotel.github.io/oxodocs/';
var MAX_DESTINATARIOS_AVISO_ = 15;
var MAX_PROPIEDADES_SOLICITADAS_ = 20;

function claveTexto_(t) {
  return String(t == null ? '' : t).trim().toLowerCase();
}

/** Lista única de ids a partir de un arreglo o de un texto "3,5,9". */
function listaDeIds_(valor) {
  const crudo = Array.isArray(valor) ? valor : String(valor == null ? '' : valor).split(',');
  const vistos = {};
  const lista = [];
  crudo.forEach(function (v) {
    const id = String(v == null ? '' : v).trim();
    if (id && !vistos[id]) { vistos[id] = true; lista.push(id); }
  });
  return lista;
}

/**
 * Propiedades que se ofrecen en el formulario de registro, que es PÚBLICO (se llama sin sesión): TODAS las de los
 * módulos (operación, pre-apertura, desarrollo y Corporativo), solo con id, nombre y el nombre del módulo al que pertenecen
 * (para agruparlas en la lista). Nunca se expone nada de Drive. Ordenadas por módulo y luego por nombre.
 */
function obtenerHotelesParaRegistro() {
  try {
    const modulos = leerHojaConCache_('Modulos');
    const hoteles = leerHojaConCache_('Hoteles');
    if (!modulos || !hoteles) return { success: true, hoteles: [] };

    const infoModulo = {};
    modulos.slice(1).filter(function (f) { return f[0]; }).forEach(function (f) {
      infoModulo[String(f[0])] = { nombre: String(f[1] == null ? '' : f[1]), orden: Number(f[2]) || 0 };
    });

    const lista = hoteles.slice(1)
      .filter(function (f) { return f[0] && infoModulo[String(f[2])]; })
      .map(function (f) {
        const m = infoModulo[String(f[2])];
        return { idHotel: String(f[0]).trim(), nombre: String(f[1] == null ? '' : f[1]), modulo: m.nombre, _orden: m.orden };
      })
      .sort(function (a, b) { return (a._orden - b._orden) || a.nombre.localeCompare(b.nombre, 'es'); })
      .map(function (h) { return { idHotel: h.idHotel, nombre: h.nombre, modulo: h.modulo }; });

    return { success: true, hoteles: lista };
  } catch (error) {
    Logger.log('Error obtenerHotelesParaRegistro: ' + error);
    return { success: false, message: 'No se pudo cargar la lista de propiedades', hoteles: [] };
  }
}

function nombreDeHotel_(idHotel) {
  const hoteles = leerHojaConCache_('Hoteles');
  if (!hoteles) return '';
  const fila = hoteles.slice(1).filter(function (f) { return String(f[0]).trim() === String(idHotel).trim(); })[0];
  return fila ? String(fila[1]) : '';
}

function nombresDeHoteles_(ids) {
  return ids.map(function (id) { return nombreDeHotel_(id) || ('hotel ' + id); });
}

/** Quiénes deben enterarse de una solicitud: administradores (rol 2) con TODOS y administradores de esas propiedades. Nunca los superadmins. */
function destinatariosDeAprobacion_(usuarios, idsHotelesSolicitados) {
  const pedidos = listaDeIds_(idsHotelesSolicitados);
  const vistos = {};
  const lista = [];
  usuarios.forEach(function (u) {
    if (u.estado !== 'Activo' || !u.email) return;
    const rolId = String(obtenerInfoRol_(u.rol).id);
    const propios = listaHotelesDeValor_(u.hoteles);
    // Los superadministradores (rol 3) NO reciben estos correos: solo los administradores (rol 2) de las propiedades pedidas
    const aplica = rolId === '2' && (esAccesoTotalHoteles_(u.hoteles) || pedidos.some(function (id) { return propios.indexOf(id) !== -1; }));
    const correo = u.email.toLowerCase();
    if (aplica && !vistos[correo]) { vistos[correo] = true; lista.push(correo); }
  });
  return lista.slice(0, MAX_DESTINATARIOS_AVISO_);
}

function escaparHtmlCorreo_(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Aviso (en copia oculta) a quienes pueden aprobar, tras verificar el correo del registro. De mejor esfuerzo. */
function notificarAprobadoresDeRegistro_(emailNuevo) {
  try {
    const usuarios = obtenerUsuariosLite_().usuarios;
    const correo = claveTexto_(emailNuevo);
    const nuevo = usuarios.filter(function (u) { return claveTexto_(u.email) === correo; })[0];
    if (!nuevo) return;
    enviarAvisoAprobadores_(usuarios, nuevo, listaDeIds_(nuevo.solicitados), false);
  } catch (error) {
    Logger.log('Aviso notificarAprobadoresDeRegistro_: ' + error);
  }
}

/** Aviso cuando una cuenta YA activa pide acceso a más propiedades (solo las nuevas). De mejor esfuerzo. */
function notificarAprobadoresDeSolicitudAdicional_(emailPersona, idsNuevos) {
  try {
    const usuarios = obtenerUsuariosLite_().usuarios;
    const correo = claveTexto_(emailPersona);
    const persona = usuarios.filter(function (u) { return claveTexto_(u.email) === correo; })[0];
    if (!persona) return;
    enviarAvisoAprobadores_(usuarios, persona, listaDeIds_(idsNuevos), true);
  } catch (error) {
    Logger.log('Aviso notificarAprobadoresDeSolicitudAdicional_: ' + error);
  }
}

function enviarAvisoAprobadores_(usuarios, persona, pedidos, adicional) {
  const destinatarios = destinatariosDeAprobacion_(usuarios, pedidos).filter(function (c) { return c !== claveTexto_(persona.email); });
  if (!destinatarios.length) return;

  const propiedades = pedidos.length
    ? nombresDeHoteles_(pedidos).map(function (n) { return pildoraCorreo_(escaparHtmlCorreo_(n), 'propiedad'); }).join('')
    : '<span style="color: #66706B;">No indicó ninguna</span>';
  const titulo = adicional ? 'Solicitud de acceso adicional' : 'Nueva solicitud de acceso';

  MailApp.sendEmail({
    to: destinatarios[0],
    bcc: destinatarios.slice(1).join(','),
    name: CORREO_NOMBRE_REMITENTE_,
    subject: titulo + ' - Repositorio de Documentos',
    htmlBody: plantillaCorreo_(titulo,
      parrafoCorreo_('Hola,') +
      parrafoCorreo_(adicional
        ? '<strong>' + escaparHtmlCorreo_(persona.nombre) + '</strong> ya tiene cuenta y pide acceso a más propiedades.'
        : '<strong>' + escaparHtmlCorreo_(persona.nombre) + '</strong> verificó su correo y está esperando aprobación.') +
      cajaDatosCorreo_([
        { etiqueta: 'Persona', html: '<strong>' + escaparHtmlCorreo_(persona.nombre) + '</strong><br><span style="color: #66706B;">' + escaparHtmlCorreo_(persona.email) + '</span>' },
        { etiqueta: 'Propiedades que solicita', html: propiedades }
      ]) +
      parrafoCorreo_('Cada administrador resuelve las propiedades de su alcance. Entra al sistema, abre <strong>Usuarios</strong> y usa los iconos de la columna de acciones para aprobar o denegar.') +
      botonCorreo_('Revisar la solicitud', URL_APLICACION_),
      'Recibes este aviso porque puedes resolver solicitudes de alguna de esas propiedades.')
  });
}

/** Le avisa a la persona qué pasó con su solicitud. De mejor esfuerzo. */
function notificarSolicitante_(email, nombre, aprobados, denegados, cerrada) {
  try {
    if (!email) return;
    const primerNombre = String(nombre || '').trim().split(' ')[0];
    const pildoras = function (ids, tipo) {
      return nombresDeHoteles_(ids).map(function (n) { return pildoraCorreo_(escaparHtmlCorreo_(n), tipo); }).join('');
    };

    let cuerpo = parrafoCorreo_('Hola' + (primerNombre ? ' <strong>' + escaparHtmlCorreo_(primerNombre) + '</strong>' : '') + ',');
    if (aprobados.length) {
      cuerpo += parrafoCorreo_('Te dieron acceso a:') + '<div style="margin: 0 0 16px;">' + pildoras(aprobados, 'aprobada') + '</div>';
    }
    if (denegados.length) {
      cuerpo += parrafoCorreo_('No se aprobó el acceso a:') + '<div style="margin: 0 0 16px;">' + pildoras(denegados, 'denegada') + '</div>';
    }
    if (cerrada) {
      cuerpo += parrafoCorreo_('Tu solicitud fue <strong>cerrada</strong>. Si lo necesitas, puedes volver a registrarte con este mismo correo.');
    }
    if (aprobados.length) cuerpo += botonCorreo_('Entrar al sistema', URL_APLICACION_);
    else if (cerrada) cuerpo += botonCorreo_('Volver a registrarme', URL_APLICACION_);

    MailApp.sendEmail({
      to: email,
      name: CORREO_NOMBRE_REMITENTE_,
      subject: 'Tu solicitud de acceso - Repositorio de Documentos',
      htmlBody: plantillaCorreo_(aprobados.length ? 'Tu acceso fue aprobado' : 'Tu solicitud de acceso', cuerpo,
        'Si tienes dudas, consúltalas con tu administrador de propiedad o con el equipo de Tecnología.')
    });
  } catch (error) {
    Logger.log('Aviso notificarSolicitante_: ' + error);
  }
}
