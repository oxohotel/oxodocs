/**
 * Lectura de hoteles agrupados por módulo, para poblar la sidebar del Home con datos reales.
 * Si el usuario es estándar (roles 1 y 2) y tiene hoteles asignados, filtra para mostrar solo aquellos a los que tiene acceso.
 * Solo Superadministradores (rol 3) siempre tienen acceso a todos los hoteles.
 */
function obtenerModulosConHoteles(idUsuarioOToken, idUsuarioFallback) {
  // Hoteles y módulos cambian poco: se leen con caché (backend/Cache.js) y se invalidan al crear/editar/eliminar hoteles.
  const valoresModulos = leerHojaConCache_('Modulos');
  const valoresHoteles = leerHojaConCache_('Hoteles');
  if (!valoresModulos || !valoresHoteles) return [];

  // 1. Resolver usuario solicitante (token, idUsuario directo o fallback)
  let solicitante = null;
  if (typeof resolverUsuarioSolicitante_ === 'function') {
    if (idUsuarioOToken) solicitante = resolverUsuarioSolicitante_(idUsuarioOToken);
    if (!solicitante && idUsuarioFallback) solicitante = resolverUsuarioSolicitante_(idUsuarioFallback);
  } else {
    const id = idUsuarioFallback || idUsuarioOToken;
    if (id) solicitante = { idUsuario: String(id).trim() };
  }

  // 2. Determinar si el usuario tiene restricción de hoteles
  let tieneRestriccion = false;
  let hotelesPermitidosSet = null;

  if (solicitante && solicitante.idUsuario) {
    const rolValor = typeof obtenerRolDeUsuario_ === 'function' ? obtenerRolDeUsuario_(solicitante.idUsuario) : null;
    const infoRol = typeof obtenerInfoRol_ === 'function' ? obtenerInfoRol_(rolValor) : null;

    // Solo Superadmin (Rol 3) tiene acceso global a todos los hoteles sin restricción
    const esSuperadmin = (infoRol && String(infoRol.id) === '3');
    if (!esSuperadmin) {
      tieneRestriccion = true;
      const lite = obtenerUsuariosLite_();
      if (lite.hayHoteles) {
        const idBuscado = String(solicitante.idUsuario).trim();
        const yo = lite.usuarios.filter(function (u) { return u.id === idBuscado; })[0];
        if (yo) {
          const val = yo.hoteles;
          if (val === '*' || val.toUpperCase() === 'TODOS') {
            tieneRestriccion = false; // Acceso explícito a todos
          } else if (val) {
            hotelesPermitidosSet = new Set(
              val.split(',')
                .map(function (s) { return String(s).trim(); })
                .filter(function (s) { return s.length > 0; })
            );
          } else {
            // Usuario o Administrador sin hoteles asignados -> lista vacía
            hotelesPermitidosSet = new Set();
          }
        }
      }
    }
  }

  const filasModulos = valoresModulos.slice(1).filter(function (f) { return f[0]; });
  const filasHoteles = valoresHoteles.slice(1).filter(function (f) { return f[0]; });

  const modulos = filasModulos
    .map(function (f) {
      return { idModulo: f[0], nombre: f[1], orden: Number(f[2]) || 0, hoteles: [] };
    })
    .sort(function (a, b) { return a.orden - b.orden; });

  const indicePorId = {};
  modulos.forEach(function (m) { indicePorId[m.idModulo] = m; });

  filasHoteles.forEach(function (f) {
    const modulo = indicePorId[f[2]];
    if (!modulo) return;

    const idHotelStr = String(f[0]).trim();
    if (tieneRestriccion) {
      if (!hotelesPermitidosSet || !hotelesPermitidosSet.has(idHotelStr)) {
        return; // Omitir hotel si el usuario no tiene acceso asignado
      }
    }

    const driveFolderId = f[3];
    modulo.hoteles.push({
      idHotel: f[0],
      nombre: f[1],
      driveFolderId: driveFolderId,
      driveUrl: driveFolderId ? ('https://drive.google.com/drive/folders/' + driveFolderId) : ''
    });
  });

  // Ordenar hoteles alfabéticamente dentro de cada módulo
  modulos.forEach(function (m) {
    m.hoteles.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
  });

  return modulos;
}
