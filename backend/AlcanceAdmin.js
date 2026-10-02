/**
 * Alcance de gestión de un Administrador (rol 2): a qué usuarios puede ver y modificar, y qué hoteles
 * puede asignar. Una sola regla, usada por la lista de usuarios, los logs y todas las acciones sobre
 * otros usuarios (backend/Roles.js, backend/Logs.js).
 *
 *  - Superadministrador (rol 3): alcance total.
 *  - Administrador con "TODOS" ("*"): administra todas las propiedades; alcance sobre todos los usuarios
 *    excepto superadministradores.
 *  - Administrador con hoteles asignados: a sí mismo y a los usuarios que tengan al menos uno de sus
 *    hoteles en su lista explícita. No incluye superadmins ni cuentas con "TODOS" (no son "de una propiedad").
 *    Si no tiene hoteles asignados, solo se alcanza a sí mismo.
 *
 * Siempre se evalúa en vivo contra la hoja "Usuarios" (nunca contra datos de la sesión).
 */

function esAccesoTotalHoteles_(valor) {
  const v = String(valor == null ? '' : valor).trim();
  return v === '*' || v.toUpperCase() === 'TODOS';
}

function listaHotelesDeValor_(valor) {
  return String(valor == null ? '' : valor).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function normalizarEncabezado_(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
}

/** Lee la hoja Usuarios una vez: [{id, email, rolId, hoteles}] */
function leerUsuariosParaAlcance_(ss) {
  const hoja = ss.getSheetByName('Usuarios');
  if (!hoja) return [];
  const datos = hoja.getDataRange().getValues();
  const enc = datos[0].map(normalizarEncabezado_);
  const buscar = function (nombres, porDefecto) {
    const i = enc.findIndex(function (n) { return nombres.indexOf(n) !== -1; });
    return i !== -1 ? i : porDefecto;
  };
  const cId = buscar(['idusuario', 'id'], 0);
  const cEmail = buscar(['email', 'correo'], 2);
  const cRol = buscar(['rol', 'idrol'], 4);
  const cHot = buscar(['hotelespermitidos', 'hoteles'], -1);

  const usuarios = [];
  for (let i = 1; i < datos.length; i++) {
    const id = String(datos[i][cId]).trim();
    if (!id) continue;
    usuarios.push({
      id: id,
      email: String(datos[i][cEmail] || '').trim().toLowerCase(),
      rolId: String(obtenerInfoRol_(datos[i][cRol]).id),
      hoteles: cHot !== -1 ? String(datos[i][cHot] == null ? '' : datos[i][cHot]).trim() : ''
    });
  }
  return usuarios;
}

function calcularAlcanceGestion_(usuarios, idSolicitante) {
  const yo = usuarios.filter(function (u) { return u.id === String(idSolicitante).trim(); })[0];
  const alcance = {
    idSolicitante: String(idSolicitante).trim(),
    rolId: yo ? yo.rolId : '1',
    esSuperadmin: !!yo && yo.rolId === '3',
    global: false,
    hoteles: new Set()
  };
  if (alcance.esSuperadmin) { alcance.global = true; return alcance; }
  if (yo && esAccesoTotalHoteles_(yo.hoteles)) alcance.global = true;
  else if (yo) listaHotelesDeValor_(yo.hoteles).forEach(function (h) { alcance.hoteles.add(h); });
  return alcance;
}

/** ¿Puede este solicitante ver/gestionar a "u" (un elemento de leerUsuariosParaAlcance_)? */
function usuarioEnAlcance_(alcance, u) {
  if (u.id === alcance.idSolicitante) return true;
  if (alcance.esSuperadmin) return true;
  if (u.rolId === '3') return false;                       // un administrador nunca alcanza a un superadmin
  if (alcance.global) return true;                         // administrador con TODOS
  if (esAccesoTotalHoteles_(u.hoteles)) return false;      // cuentas con TODOS no son "de una propiedad"
  return listaHotelesDeValor_(u.hoteles).some(function (h) { return alcance.hoteles.has(h); });
}

/** ¿El texto (en minúsculas) menciona el correo completo? Evita que "ana@x.com" coincida dentro de "mariana@x.com". */
function textoMencionaCorreo_(texto, email) {
  let pos = texto.indexOf(email);
  while (pos !== -1) {
    const antes = pos === 0 ? '' : texto.charAt(pos - 1);
    if (!/[a-z0-9._%+\-]/.test(antes)) return true;
    pos = texto.indexOf(email, pos + 1);
  }
  return false;
}

/**
 * Valida el alcance sobre un usuario objetivo antes de modificarlo. Devuelve null si está permitido o
 * un mensaje de error si no.
 */
function verificarAlcanceSobreUsuario_(ss, idSolicitante, idObjetivo) {
  const usuarios = leerUsuariosParaAlcance_(ss);
  const alcance = calcularAlcanceGestion_(usuarios, idSolicitante);
  const objetivo = usuarios.filter(function (u) { return u.id === String(idObjetivo).trim(); })[0];
  if (!objetivo) return 'Usuario no encontrado';
  if (!usuarioEnAlcance_(alcance, objetivo)) return 'No tienes alcance sobre este usuario';
  return null;
}

/**
 * Qué lista de hoteles puede asignar el solicitante. Un administrador con hoteles asignados no puede
 * dar más de lo que tiene: "TODOS" se interpreta como "todos mis hoteles" y una lista con hoteles ajenos
 * se rechaza. Superadmins y administradores con TODOS asignan sin restricción.
 * Devuelve { ok, valor } o { ok:false, message }.
 */
function hotelesAsignablesPorSolicitante_(ss, idSolicitante, valorSolicitado) {
  const texto = Array.isArray(valorSolicitado) ? valorSolicitado.join(',') : String(valorSolicitado == null ? '' : valorSolicitado).trim();
  const alcance = calcularAlcanceGestion_(leerUsuariosParaAlcance_(ss), idSolicitante);
  if (alcance.global) return { ok: true, valor: texto };

  if (esAccesoTotalHoteles_(texto)) {
    return { ok: true, valor: Array.from(alcance.hoteles).join(',') };
  }
  const pedidos = listaHotelesDeValor_(texto);
  const ajenos = pedidos.filter(function (h) { return !alcance.hoteles.has(h); });
  if (ajenos.length) return { ok: false, message: 'Solo puedes asignar hoteles de tu propiedad' };
  return { ok: true, valor: pedidos.join(',') };
}
