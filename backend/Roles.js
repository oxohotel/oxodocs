/**
 * Catálogo de roles y verificación de permisos basados en ID_Rol (con soporte por ID y nombre).
 * 
 * Estructura de la hoja "Roles":
 * ID_Rol | Nombre_Rol | Ver_Documento | Subir_Documento | Editar_Documento | Eliminar_Documento | Gestionar_Hoteles_Carpetas | Gestionar_Usuarios | Gestionar_Roles
 *   1    | Usuario    |     SI        |      SI         |       NO         |        NO          |            NO              |         NO          |       NO
 *   2    | Administrador|   SI        |      SI         |       SI         |        SI          |            SI              |         SI          |       NO
 *   3    | Superadmin |     SI        |      SI         |       SI         |        SI          |            SI              |         SI          |       SI
 * 
 * Estructura de la hoja "Usuarios":
 * ID_Usuario | Nombre_Completo | Email | Contraseña_Hash | Rol (ID_Rol: 1, 2, 3) | Estado | Fecha_Registro
 */

/**
 * Lee el catálogo de roles y devuelve un mapa indexado por ID y por Nombre.
 */
/**
 * Catálogo de roles y verificación de permisos basados en ID_Rol (con soporte por ID y nombre).
 * 
 * Estructura de la hoja "Roles":
 * ID_Rol | Nombre_Rol | Ver_Documento | Subir_Documento | Editar_Documento | Eliminar_Documento | Gestionar_Hoteles_Carpetas | Gestionar_Usuarios | Gestionar_Roles
 *   1    | Usuario    |     SI        |      SI         |       NO         |        NO          |            NO              |         NO          |       NO
 *   2    | Administrador|   SI        |      SI         |       SI         |        SI          |            SI              |         SI          |       NO
 *   3    | Superadmin |     SI        |      SI         |       SI         |        SI          |            SI              |         SI          |       SI
 */

var PERMISOS_DEFAULT_POR_ROL = {
  '1': {
    id: 1,
    nombre: 'Usuario',
    permisos: {
      Ver_Documento: true, Ver_Documentos: true,
      Subir_Documento: true, Subir_Documentos: true,
      Editar_Documento: false, Editar_Documentos: false,
      Eliminar_Documento: false, Eliminar_Documentos: false,
      Gestionar_Hoteles_Carpetas: false,
      Gestionar_Usuarios: false, Gestionar_Usuario: false,
      Gestionar_Roles: false, Gestionar_Rol: false
    }
  },
  '2': {
    id: 2,
    nombre: 'Administrador',
    permisos: {
      Ver_Documento: true, Ver_Documentos: true,
      Subir_Documento: true, Subir_Documentos: true,
      Editar_Documento: true, Editar_Documentos: true,
      Eliminar_Documento: true, Eliminar_Documentos: true,
      Gestionar_Hoteles_Carpetas: true,
      Gestionar_Usuarios: true, Gestionar_Usuario: true,
      Gestionar_Roles: false, Gestionar_Rol: false
    }
  },
  '3': {
    id: 3,
    nombre: 'Superadministrador',
    permisos: {
      Ver_Documento: true, Ver_Documentos: true,
      Subir_Documento: true, Subir_Documentos: true,
      Editar_Documento: true, Editar_Documentos: true,
      Eliminar_Documento: true, Eliminar_Documentos: true,
      Gestionar_Hoteles_Carpetas: true,
      Gestionar_Usuarios: true, Gestionar_Usuario: true,
      Gestionar_Roles: true, Gestionar_Rol: true
    }
  }
};

/**
 * Lee el catálogo de roles y devuelve un mapa indexado por ID y por Nombre.
 */
function obtenerMapaRoles_() {
  const porId = {};
  const porNombre = {};
  const catalogo = [];

  // Inicializar con valores garantizados por defecto
  [1, 2, 3].forEach(function (id) {
    const def = PERMISOS_DEFAULT_POR_ROL[String(id)];
    porId[String(id)] = { id: def.id, nombre: def.nombre, permisos: Object.assign({}, def.permisos) };
    porNombre[def.nombre.toLowerCase()] = porId[String(id)];
    catalogo.push({ id: def.id, nombre: def.nombre });
  });

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Roles');
    if (!hoja) return { porId: porId, porNombre: porNombre, catalogo: catalogo };

    const datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return { porId: porId, porNombre: porNombre, catalogo: catalogo };

    const encabezados = datos[0];
    const indexId = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idrol' || n === 'id';
    });
    const indexNombre = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'nombrerol' || n === 'nombre' || n === 'rol';
    });

    if (indexId === -1 || indexNombre === -1) {
      return { porId: porId, porNombre: porNombre, catalogo: catalogo };
    }

    for (let i = 1; i < datos.length; i++) {
      const rawId = datos[i][indexId];
      const rawNombre = datos[i][indexNombre];
      if (rawId === '' || rawNombre === '') continue;

      const idNum = parseInt(rawId, 10);
      const nombreStr = String(rawNombre).trim();
      const idKey = String(isNaN(idNum) ? rawId : idNum);

      const permisos = porId[idKey] ? Object.assign({}, porId[idKey].permisos) : {};
      encabezados.forEach(function (columna, j) {
        if (j !== indexId && j !== indexNombre) {
          const colNorm = String(columna || '').trim().replace(/[\s]+/g, '_');
          const val = String(datos[i][j]).trim().toUpperCase();
          if (val === 'SI' || val === 'TRUE' || val === '1') {
            permisos[colNorm] = true;
          } else if (val === 'NO' || val === 'FALSE' || val === '0') {
            permisos[colNorm] = false;
          }
        }
      });

      const info = {
        id: isNaN(idNum) ? rawId : idNum,
        nombre: nombreStr,
        permisos: permisos
      };

      porId[idKey] = info;
      porNombre[nombreStr.toLowerCase()] = info;

      const idxCat = catalogo.findIndex(function (c) { return String(c.id) === idKey; });
      if (idxCat !== -1) {
        catalogo[idxCat] = { id: info.id, nombre: info.nombre };
      } else {
        catalogo.push({ id: info.id, nombre: info.nombre });
      }
    }
  } catch (e) {
    Logger.log('Aviso en obtenerMapaRoles_: ' + e);
  }

  return { porId: porId, porNombre: porNombre, catalogo: catalogo };
}

/**
 * Obtiene la información completa de un rol dado su ID (1, 2, 3) o su Nombre ("Usuario", etc.).
 */
function obtenerInfoRol_(rolIdONombre) {
  if (rolIdONombre === null || rolIdONombre === undefined || rolIdONombre === '') {
    return PERMISOS_DEFAULT_POR_ROL['1'];
  }

  const claveStr = String(rolIdONombre).trim();
  const claveLower = claveStr.toLowerCase();

  // Mapeos rápidos directos garantizados
  if (claveStr === '3' || claveLower.includes('superadmin')) {
    return PERMISOS_DEFAULT_POR_ROL['3'];
  }
  if (claveStr === '2' || claveLower === 'administrador' || claveLower === 'admin') {
    return PERMISOS_DEFAULT_POR_ROL['2'];
  }
  if (claveStr === '1' || claveLower === 'usuario' || claveLower === 'user') {
    return PERMISOS_DEFAULT_POR_ROL['1'];
  }

  const mapa = obtenerMapaRoles_();
  if (mapa.porId[claveStr]) {
    return mapa.porId[claveStr];
  }
  if (mapa.porNombre[claveLower]) {
    return mapa.porNombre[claveLower];
  }

  return PERMISOS_DEFAULT_POR_ROL['1'];
}

/**
 * Obtiene los permisos booleanos de un rol por su ID o Nombre.
 */
function obtenerPermisosPorRol_(rolIdONombre) {
  const info = obtenerInfoRol_(rolIdONombre);
  return info ? info.permisos : null;
}

/**
 * Obtiene el ID_Rol asignado a un usuario en la hoja "Usuarios".
 */
function obtenerRolDeUsuario_(idUsuario) {
  if (idUsuario === null || idUsuario === undefined || idUsuario === '') return null;

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return null;

    const datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return null;

    const encabezados = datos[0];
    let indexId = encabezados.findIndex(function (h) {
      const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return norm === 'idusuario' || norm === 'id' || norm === 'usuarioid';
    });
    if (indexId === -1) indexId = 0;

    let indexRol = encabezados.findIndex(function (h) {
      const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return norm === 'rol' || norm === 'idrol' || norm === 'rolid';
    });
    if (indexRol === -1) indexRol = 4;

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][indexId]).trim() === String(idUsuario).trim()) {
        const val = datos[i][indexRol];
        return (val !== null && val !== undefined && val !== '') ? val : 1;
      }
    }
  } catch (e) {
    Logger.log('Error en obtenerRolDeUsuario_: ' + e);
  }

  return null;
}

/**
 * Resuelve el ID del usuario solicitante a partir de un token de sesión o fallback si es ID numérico.
 */
function resolverUsuarioSolicitante_(idUsuarioOToken, idUsuarioFallback) {
  if (!idUsuarioOToken && !idUsuarioFallback) return null;

  // Si se envió un objeto de sesión { token, idUsuario } o similar
  if (typeof idUsuarioOToken === 'object' && idUsuarioOToken !== null) {
    if (idUsuarioOToken.token) {
      const sesionToken = resolverUsuarioSolicitante_(idUsuarioOToken.token);
      if (sesionToken && sesionToken.idUsuario) return sesionToken;
    }
    const idObj = idUsuarioOToken.idUsuario || idUsuarioOToken.ID_Usuario || idUsuarioOToken.id;
    if (idObj) {
      return resolverUsuarioSolicitante_(idObj);
    }
    return null;
  }

  const str = idUsuarioOToken ? String(idUsuarioOToken).trim() : '';

  // 1. Si se pasó un token de sesión
  if (str && typeof obtenerUsuarioPorToken === 'function') {
    const sesion = obtenerUsuarioPorToken(str);
    if (sesion && sesion.idUsuario) {
      return sesion;
    }
  }

  // 2. Si es un ID numérico/texto conocido, se valida contra la base de datos
  if (str) {
    const rolValor = obtenerRolDeUsuario_(str);
    if (rolValor !== null && rolValor !== undefined && rolValor !== '') {
      return { idUsuario: str, rol: rolValor, idRol: rolValor };
    }
  }

  // 3. Si el token falló o expiró pero se envió idUsuarioFallback, resolver por ID
  if (idUsuarioFallback) {
    const strFallback = String(idUsuarioFallback).trim();
    if (strFallback) {
      const rolFallback = obtenerRolDeUsuario_(strFallback);
      if (rolFallback !== null && rolFallback !== undefined && rolFallback !== '') {
        return { idUsuario: strFallback, rol: rolFallback, idRol: rolFallback };
      }
    }
  }

  return null;
}

/**
 * Verifica si un usuario tiene un permiso específico, evaluando su ID_Rol en la base de datos.
 * Acepta tanto un ID de usuario como un token de sesión emitido por el servidor y un fallback.
 */
function usuarioTienePermiso(idUsuarioOToken, nombrePermiso, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioOToken, idUsuarioFallback);
  if (!solicitante || !solicitante.idUsuario) return false;

  let rolValor = solicitante.idRol || solicitante.rol;
  if (!rolValor) {
    rolValor = obtenerRolDeUsuario_(solicitante.idUsuario);
  }
  if (rolValor === null || rolValor === undefined || rolValor === '') return false;

  const infoRol = obtenerInfoRol_(rolValor);
  if (!infoRol || !infoRol.permisos) return false;

  // Superadministrador (Rol 3) tiene acceso total e incondicional
  if (String(infoRol.id) === '3' || String(infoRol.nombre).toLowerCase().includes('superadmin')) {
    return true;
  }

  // Administrador (Rol 2) tiene permisos de gestión operativa
  if (String(infoRol.id) === '2' || String(infoRol.nombre).toLowerCase() === 'administrador') {
    if (nombrePermiso === 'Gestionar_Roles' || nombrePermiso === 'Gestionar_Rol') {
      return false; // Solo Superadmin puede gestionar roles globales
    }
    return true;
  }

  const permisos = infoRol.permisos;

  // Verificación directa
  if (permisos[nombrePermiso] === true) return true;

  // Normalización singular <-> plural
  const mapaVariaciones = {
    'Ver_Documentos': 'Ver_Documento',
    'Ver_Documento': 'Ver_Documentos',
    'Subir_Documentos': 'Subir_Documento',
    'Subir_Documento': 'Subir_Documentos',
    'Editar_Documentos': 'Editar_Documento',
    'Editar_Documento': 'Editar_Documentos',
    'Eliminar_Documentos': 'Eliminar_Documento',
    'Eliminar_Documento': 'Eliminar_Documentos',
    'Gestionar_Usuarios': 'Gestionar_Usuario',
    'Gestionar_Usuario': 'Gestionar_Usuarios',
    'Gestionar_Roles': 'Gestionar_Rol',
    'Gestionar_Rol': 'Gestionar_Roles'
  };

  const variacion = mapaVariaciones[nombrePermiso];
  if (variacion && permisos[variacion] === true) {
    return true;
  }

  return false;
}

/**
 * Catálogo de roles disponibles con sus IDs y Nombres para alimentar selectores y UI.
 */
function obtenerCatalogoRoles() {
  try {
    const mapa = obtenerMapaRoles_();
    if (mapa && mapa.catalogo && mapa.catalogo.length > 0) {
      return { success: true, roles: mapa.catalogo };
    }
    return {
      success: true,
      roles: [
        { id: 1, nombre: 'Usuario' },
        { id: 2, nombre: 'Administrador' },
        { id: 3, nombre: 'Superadministrador' }
      ]
    };
  } catch (error) {
    Logger.log('Error obtenerCatalogoRoles: ' + error);
    return {
      success: true,
      roles: [
        { id: 1, nombre: 'Usuario' },
        { id: 2, nombre: 'Administrador' },
        { id: 3, nombre: 'Superadministrador' }
      ]
    };
  }
}

/**
 * Lista de usuarios para el panel de gestión con sus IDs de Rol y nombres legibles.
 * Si el solicitante es Administrador (rol 2), solo ve usuarios que comparten hoteles con él.
 * Si es Superadministrador (rol 3), ve todos los usuarios.
 */
function obtenerUsuariosParaGestion(idUsuarioSolicitanteOToken, idUsuarioFallback) {
  if (!usuarioTienePermiso(idUsuarioSolicitanteOToken, 'Gestionar_Usuarios', idUsuarioFallback) &&
      !usuarioTienePermiso(idUsuarioSolicitanteOToken, 'Gestionar_Roles', idUsuarioFallback)) {
    return { success: false, message: 'No tienes permiso para ver esta sección', usuarios: [] };
  }

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return { success: false, message: 'Hoja Usuarios no encontrada', usuarios: [] };

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const idx = {};
    encabezados.forEach(function (columna, i) { idx[columna] = i; });

    const idxHoteles = encabezados.findIndex(function (h) {
      const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return norm === 'hotelespermitidos' || norm === 'hoteles';
    });
    const idxIdU = encabezados.findIndex(function (h) {
      const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return norm === 'idusuario' || norm === 'id';
    });
    const idxRol = encabezados.findIndex(function (h) {
      const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return norm === 'rol' || norm === 'idrol';
    });

    // Obtener hoteles del usuario solicitante si es Administrador
    let hotelesDelSolicitante = null;
    let esAdminConFiltro = false;
    const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);

    if (solicitante && solicitante.idUsuario) {
      const rolSolicitante = obtenerRolDeUsuario_(solicitante.idUsuario);
      const infoRolSolicitante = obtenerInfoRol_(rolSolicitante);
      const esSuperadmin = (infoRolSolicitante && String(infoRolSolicitante.id) === '3');

      // Si es Administrador (rol 2), solo ve usuarios de las propiedades que administra
      if (!esSuperadmin && infoRolSolicitante && String(infoRolSolicitante.id) === '2') {
        esAdminConFiltro = true;
        if (idxHoteles !== -1 && idxIdU !== -1) {
          for (let i = 1; i < datos.length; i++) {
            if (String(datos[i][idxIdU]).trim() === String(solicitante.idUsuario).trim()) {
              const val = String(datos[i][idxHoteles] || '').trim();
              if (val === '*' || val.toUpperCase() === 'TODOS') {
                esAdminConFiltro = false; // Administra todas las propiedades
              } else if (val) {
                hotelesDelSolicitante = new Set(
                  val.split(',')
                    .map(function (s) { return String(s).trim(); })
                    .filter(function (s) { return s.length > 0; })
                );
              } else {
                hotelesDelSolicitante = new Set();
              }
              break;
            }
          }
        }
      }
    }

    const usuarios = [];
    for (let i = 1; i < datos.length; i++) {
      const idFila = String(datos[i][idxIdU !== -1 ? idxIdU : 0]).trim();
      if (!idFila) continue;

      const rawRol = datos[i][idxRol !== -1 ? idxRol : idx['Rol']];
      const infoRol = obtenerInfoRol_(rawRol);
      const hotelesUsuario = idxHoteles !== -1 ? String(datos[i][idxHoteles] || '').trim() : '';

      // Si el solicitante es Administrador con hoteles asignados, filtrar usuarios:
      if (esAdminConFiltro) {
        // Siempre se ve a sí mismo
        if (idFila !== String(solicitante.idUsuario).trim()) {
          if (!hotelesDelSolicitante || hotelesDelSolicitante.size === 0) {
            continue; // Si el administrador no tiene hoteles asignados, no ve otros usuarios
          }
          const usuarioHoteles = hotelesUsuario.split(',').map(function (s) { return String(s).trim(); }).filter(Boolean);
          const tieneHotelesComunes = usuarioHoteles.includes('*') ||
            usuarioHoteles.some(function (h) { return h.toUpperCase() === 'TODOS'; }) ||
            usuarioHoteles.some(function (h) { return hotelesDelSolicitante.has(h); });

          if (!tieneHotelesComunes) {
            continue; // Omitir usuario si no comparte propiedades con este administrador
          }
        }
      }

      // Resolver nombres de hoteles a partir de los IDs
      let hotelesLista = [];
      if (hotelesUsuario && hotelesUsuario !== '*' && hotelesUsuario.toUpperCase() !== 'TODOS') {
        try {
          const hojaHoteles = ss.getSheetByName('Hoteles');
          if (hojaHoteles) {
            const datosHoteles = hojaHoteles.getDataRange().getValues();
            const encabHoteles = datosHoteles[0];
            const idxIdHotel = encabHoteles.findIndex(function (h) {
              const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
              return norm === 'idhotel' || norm === 'id';
            });
            const idxNombreHotel = encabHoteles.findIndex(function (h) {
              const norm = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
              return norm === 'nombrehotel' || norm === 'nombre';
            });

            if (idxIdHotel !== -1 && idxNombreHotel !== -1) {
              const idsRequeridos = hotelesUsuario.split(',').map(function (s) { return String(s).trim(); }).filter(Boolean);
              for (let h = 1; h < datosHoteles.length; h++) {
                const idHotel = String(datosHoteles[h][idxIdHotel]).trim();
                if (idsRequeridos.includes(idHotel)) {
                  hotelesLista.push(datosHoteles[h][idxNombreHotel]);
                }
              }
            }
          }
        } catch (errNombres) {
          Logger.log('Aviso resolviendo nombres de hoteles: ' + errNombres);
        }
      }

      usuarios.push({
        id: idFila,
        nombre: datos[i][idx['Nombre_Completo'] || 1],
        email: datos[i][idx['Email'] || 2],
        rol: infoRol.nombre,
        rol_id: infoRol.id,
        id_rol: infoRol.id,
        estado: datos[i][idx['Estado'] || 5],
        hoteles_permitidos: hotelesUsuario,
        hoteles_lista: hotelesLista
      });
    }
    return { success: true, usuarios: usuarios };
  } catch (error) {
    Logger.log('Error obtenerUsuariosParaGestion: ' + error);
    return { success: false, message: error.toString(), usuarios: [] };
  }
}

/**
 * Le da acceso a un usuario ("Pendiente_Aprobacion" -> "Activo").
 */
function aprobarUsuario(idUsuarioObjetivo, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  return cambiarEstadoUsuario(idUsuarioObjetivo, 'Activo', idUsuarioSolicitanteOToken, idUsuarioFallback);
}

/**
 * Cambia el estado de un usuario (Activo, Inactivo, Pendiente_Aprobacion).
 */
function cambiarEstadoUsuario(idUsuarioObjetivo, nuevoEstado, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (!solicitante || !usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback)) {
    return { success: false, message: 'No tienes permiso para gestionar usuarios' };
  }

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return { success: false, message: 'Hoja Usuarios no encontrada' };

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idusuario' || n === 'id';
    });
    const indexEstado = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'estado';
    });
    const indexEmail = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'email' || n === 'correo';
    });

    const colId = indexId !== -1 ? indexId : 0;
    const colEstado = indexEstado !== -1 ? indexEstado : 5;
    const colEmail = indexEmail !== -1 ? indexEmail : 2;

    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][colId]).trim() === String(idUsuarioObjetivo).trim()) {
        const estadoAnterior = datos[i][colEstado];
        hoja.getRange(i + 1, colEstado + 1).setValue(nuevoEstado);

        registrarAuditoriaSimple_(solicitante.idUsuario, 'CAMBIO_ESTADO_USUARIO',
          'Cambió el estado de ' + datos[i][colEmail] + ' de "' + estadoAnterior + '" a "' + nuevoEstado + '"', 'Usuario');

        return { success: true, nuevoEstado: nuevoEstado };
      }
    }
    return { success: false, message: 'Usuario no encontrado' };
  } catch (error) {
    Logger.log('Error cambiarEstadoUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Cambia el rol de un usuario usando su ID_Rol numérico.
 * Exclusivo para Superadministrador (ID 3) y previene dejar a 0 superadministradores en el sistema.
 */
function cambiarRolUsuario(idUsuarioObjetivo, nuevoRolIdONombre, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (!solicitante || !solicitante.idUsuario) {
    return { success: false, message: 'No autenticado' };
  }

  const rolSolicitante = obtenerRolDeUsuario_(solicitante.idUsuario);
  const infoRolSolicitante = obtenerInfoRol_(rolSolicitante);
  if (String(infoRolSolicitante.id) !== '3' && String(infoRolSolicitante.nombre).toLowerCase() !== 'superadministrador') {
    return { success: false, message: 'Solo un Superadministrador tiene autorización para cambiar roles' };
  }

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return { success: false, message: 'Hoja Usuarios no encontrada' };

    const nuevoInfoRol = obtenerInfoRol_(nuevoRolIdONombre);
    if (!nuevoInfoRol || !nuevoInfoRol.id) {
      return { success: false, message: 'Rol especificado no válido' };
    }

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idusuario' || n === 'id';
    });
    const indexRol = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'rol' || n === 'idrol';
    });
    const indexEmail = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'email' || n === 'correo';
    });

    const colId = indexId !== -1 ? indexId : 0;
    const colRol = indexRol !== -1 ? indexRol : 4;
    const colEmail = indexEmail !== -1 ? indexEmail : 2;

    let filaObjetivo = -1;
    let rolActualValor = null;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][colId]).trim() === String(idUsuarioObjetivo).trim()) {
        filaObjetivo = i + 1;
        rolActualValor = datos[i][colRol];
        break;
      }
    }
    if (filaObjetivo === -1) return { success: false, message: 'Usuario no encontrado' };

    const actualInfoRol = obtenerInfoRol_(rolActualValor);

    // Si el usuario es Superadmin (ID 3) y se le va a quitar ese rol, validar que quede al menos otro
    if (String(actualInfoRol.id) === '3' && String(nuevoInfoRol.id) !== '3') {
      let totalSuperadmins = 0;
      for (let i = 1; i < datos.length; i++) {
        const info = obtenerInfoRol_(datos[i][colRol]);
        if (String(info.id) === '3') totalSuperadmins++;
      }
      if (totalSuperadmins <= 1) {
        return { success: false, message: 'No puedes quitarle el rol al último Superadministrador' };
      }
    }

    // Guardar el ID_Rol numérico en la columna Rol de la hoja Usuarios
    hoja.getRange(filaObjetivo, colRol + 1).setValue(nuevoInfoRol.id);

    const emailObjetivo = datos[filaObjetivo - 1][colEmail];
    registrarAuditoriaSimple_(solicitante.idUsuario, 'CAMBIO_ROL',
      'Cambió el rol de ' + emailObjetivo + ' de "' + actualInfoRol.nombre + ' (' + actualInfoRol.id + ')" a "' + nuevoInfoRol.nombre + ' (' + nuevoInfoRol.id + ')"', 'Usuario');

    return {
      success: true,
      message: 'Rol actualizado a ' + nuevoInfoRol.nombre,
      rol_id: nuevoInfoRol.id,
      rol_nombre: nuevoInfoRol.nombre
    };
  } catch (error) {
    Logger.log('Error cambiarRolUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Asigna la lista de hoteles permitidos a un usuario.
 * Requiere permiso de gestión de usuarios o superadministrador.
 */
function asignarHotelesAUsuario(idUsuarioObjetivo, arrayHotelesIds, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (!solicitante || (!usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback) && !usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Roles', idUsuarioFallback))) {
    return { success: false, message: 'No tienes permiso para gestionar accesos de hoteles' };
  }

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return { success: false, message: 'Hoja Usuarios no encontrada' };

    let idxHoteles = obtenerOAgregarColumna_(hoja, 'Hoteles_Permitidos');
    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idusuario' || n === 'id';
    });
    const indexEmail = encabezados.findIndex(function (h) {
      const n = String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
      return n === 'email' || n === 'correo';
    });

    const colId = indexId !== -1 ? indexId : 0;
    const colEmail = indexEmail !== -1 ? indexEmail : 2;

    let filaObjetivo = -1;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][colId]).trim() === String(idUsuarioObjetivo).trim()) {
        filaObjetivo = i + 1;
        break;
      }
    }

    if (filaObjetivo === -1) return { success: false, message: 'Usuario no encontrado' };

    const valorHoteles = Array.isArray(arrayHotelesIds) ? arrayHotelesIds.join(',') : String(arrayHotelesIds || '');
    hoja.getRange(filaObjetivo, idxHoteles + 1).setValue(valorHoteles);

    const emailObjetivo = datos[filaObjetivo - 1][colEmail];
    registrarAuditoriaSimple_(solicitante.idUsuario, 'GESTION_ACCESOS',
      'Asignó accesos de hoteles a ' + emailObjetivo + ': ' + (valorHoteles || 'Todos'), 'Usuario');

    return { success: true, hoteles_permitidos: valorHoteles };
  } catch (error) {
    Logger.log('Error asignarHotelesAUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Crea un usuario nuevo directamente desde el panel de administración.
 * Accesible por Superadmin (Rol 3) y Administrador (Rol 2).
 */
function crearUsuarioPorAdmin(datos, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (!solicitante || (!usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback) && !usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Roles', idUsuarioFallback))) {
    return { success: false, message: 'No tienes permiso para crear usuarios' };
  }

  if (!datos || !datos.nombre || !datos.email || !datos.password) {
    return { success: false, message: 'Todos los campos obligatorios deben ser diligenciados' };
  }

  const nombre = String(datos.nombre).trim();
  const emailNormalizado = String(datos.email).trim().toLowerCase();
  const password = String(datos.password).trim();
  let rolId = parseInt(datos.rolId || datos.rol || 1, 10);
  if (isNaN(rolId) || rolId < 1) rolId = 1;
  const estado = datos.estado ? String(datos.estado).trim() : 'Activo';
  const hotelesPermitidos = datos.hoteles ? String(datos.hoteles).trim() : 'TODOS';

  const rolSolicitante = obtenerRolDeUsuario_(solicitante.idUsuario);
  const infoRolSolicitante = obtenerInfoRol_(rolSolicitante);
  const esSuperadmin = (infoRolSolicitante && String(infoRolSolicitante.id) === '3');

  // Administrador común solo puede crear usuarios con Rol 1
  if (!esSuperadmin && rolId > 1) {
    return { success: false, message: 'Solo un Superadministrador puede crear usuarios con roles administrativos' };
  }

  if (password.length < 6) {
    return { success: false, message: 'La contraseña debe tener al menos 6 caracteres' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaUsuarios = ss.getSheetByName('Usuarios');
    if (!hojaUsuarios) return { success: false, message: 'Hoja Usuarios no encontrada' };

    const datosUsuarios = hojaUsuarios.getDataRange().getValues();
    const encabezados = datosUsuarios[0];
    const idxEmail = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '') === 'email';
    });
    const idxId = encabezados.findIndex(function (h) {
      const n = String(h || '').toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idusuario' || n === 'id';
    });
    const colEmail = idxEmail !== -1 ? idxEmail : 2;
    const colId = idxId !== -1 ? idxId : 0;

    // Verificar email duplicado
    for (let i = 1; i < datosUsuarios.length; i++) {
      if (String(datosUsuarios[i][colEmail]).trim().toLowerCase() === emailNormalizado) {
        return { success: false, message: 'Ya existe un usuario registrado con el correo ' + emailNormalizado };
      }
    }

    // Calcular siguiente ID
    let nuevoId = 1;
    for (let i = 1; i < datosUsuarios.length; i++) {
      const idActual = parseInt(datosUsuarios[i][colId], 10);
      if (!isNaN(idActual) && idActual >= nuevoId) {
        nuevoId = idActual + 1;
      }
    }

    const passwordHashConSalt = typeof calcularHashContrasenaConSalt_ === 'function'
      ? calcularHashContrasenaConSalt_(password)
      : password;

    const fechaRegistro = Utilities.formatDate(new Date(), 'GMT-5', 'yyyy-MM-dd');

    // Asegurar columna Hoteles_Permitidos
    const idxHoteles = obtenerOAgregarColumna_(hojaUsuarios, 'Hoteles_Permitidos');

    const infoNuevoRol = obtenerInfoRol_(rolId);

    // Preparar fila
    const nuevaFila = new Array(encabezados.length).fill('');
    nuevaFila[colId] = nuevoId;

    const idxNombre = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '').includes('nombre');
    });
    nuevaFila[idxNombre !== -1 ? idxNombre : 1] = nombre;
    nuevaFila[colEmail] = emailNormalizado;

    const idxHash = encabezados.findIndex(function (h) {
      const n = String(h || '').toLowerCase().replace(/[\s_]+/g, '');
      return n.includes('contra') || n.includes('hash');
    });
    nuevaFila[idxHash !== -1 ? idxHash : 3] = passwordHashConSalt;

    const idxRol = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '').includes('rol');
    });
    nuevaFila[idxRol !== -1 ? idxRol : 4] = infoNuevoRol.id;

    const idxEstado = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '') === 'estado';
    });
    nuevaFila[idxEstado !== -1 ? idxEstado : 5] = estado;

    const idxFecha = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '').includes('fecha');
    });
    nuevaFila[idxFecha !== -1 ? idxFecha : 6] = fechaRegistro;

    if (idxHoteles !== -1) {
      nuevaFila[idxHoteles] = hotelesPermitidos;
    }

    hojaUsuarios.appendRow(nuevaFila);

    registrarAuditoriaSimple_(solicitante.idUsuario, 'CREACION_USUARIO_ADMIN',
      'Creó el usuario ' + emailNormalizado + ' (' + nombre + ') con rol ' + infoNuevoRol.nombre + ' y estado ' + estado, 'Usuario');

    return {
      success: true,
      message: 'Usuario ' + nombre + ' creado con éxito',
      idUsuario: nuevoId
    };
  } catch (error) {
    Logger.log('Error en crearUsuarioPorAdmin: ' + error);
    return { success: false, message: 'Error al crear el usuario: ' + error.toString() };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Restablece directamente la contraseña de un usuario por parte de un Administrador / Superadministrador.
 */
function restablecerContrasenaUsuarioPorAdmin(idUsuarioObjetivo, nuevaPassword, idUsuarioSolicitanteOToken, idUsuarioFallback) {
  const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitanteOToken, idUsuarioFallback);
  if (!solicitante || (!usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Usuarios', idUsuarioFallback) && !usuarioTienePermiso(solicitante.idUsuario, 'Gestionar_Roles', idUsuarioFallback))) {
    return { success: false, message: 'No tienes permiso para restablecer contraseñas' };
  }

  if (!nuevaPassword || String(nuevaPassword).trim().length < 6) {
    return { success: false, message: 'La nueva contraseña debe tener al menos 6 caracteres' };
  }

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Usuarios');
    if (!hoja) return { success: false, message: 'Hoja Usuarios no encontrada' };

    const datos = hoja.getDataRange().getValues();
    const encabezados = datos[0];
    const indexId = encabezados.findIndex(function (h) {
      const n = String(h || '').toLowerCase().replace(/[\s_]+/g, '');
      return n === 'idusuario' || n === 'id';
    });
    const indexHash = encabezados.findIndex(function (h) {
      const n = String(h || '').toLowerCase().replace(/[\s_]+/g, '');
      return n.includes('contra') || n.includes('hash');
    });
    const indexEmail = encabezados.findIndex(function (h) {
      return String(h || '').toLowerCase().replace(/[\s_]+/g, '') === 'email';
    });

    const colId = indexId !== -1 ? indexId : 0;
    const colHash = indexHash !== -1 ? indexHash : 3;
    const colEmail = indexEmail !== -1 ? indexEmail : 2;

    let filaObjetivo = -1;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][colId]).trim() === String(idUsuarioObjetivo).trim()) {
        filaObjetivo = i + 1;
        break;
      }
    }

    if (filaObjetivo === -1) {
      return { success: false, message: 'Usuario no encontrado' };
    }

    const nuevoHashConSalt = typeof calcularHashContrasenaConSalt_ === 'function'
      ? calcularHashContrasenaConSalt_(nuevaPassword)
      : nuevaPassword;

    hoja.getRange(filaObjetivo, colHash + 1).setValue(nuevoHashConSalt);

    const emailObjetivo = datos[filaObjetivo - 1][colEmail];
    registrarAuditoriaSimple_(solicitante.idUsuario, 'RESTABLECER_PASSWORD_ADMIN',
      'Restableció la contraseña del usuario ' + emailObjetivo, 'Usuario');

    return { success: true, message: 'Contraseña restablecida exitosamente para ' + emailObjetivo };
  } catch (error) {
    Logger.log('Error en restablecerContrasenaUsuarioPorAdmin: ' + error);
    return { success: false, message: 'Error al restablecer contraseña: ' + error.toString() };
  }
}

/**
 * Asigna Superadministrador (ID_Rol: 3) a los correos iniciales de tecnología.
 */
function asignarSuperadminsIniciales() {
  const correos = ['acabrales@oxohotel.com', 'ptecnologia@oxohotel.com'];

  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
  const hoja = ss.getSheetByName('Usuarios');
  if (!hoja) { Logger.log('❌ Hoja Usuarios no encontrada'); return; }

  const datos = hoja.getDataRange().getValues();
  const encabezados = datos[0];
  const indexEmail = encabezados.indexOf('Email');
  const indexRol = encabezados.indexOf('Rol');

  correos.forEach(function (correo) {
    let encontrado = false;
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][indexEmail]).toLowerCase() === correo.toLowerCase()) {
        hoja.getRange(i + 1, indexRol + 1).setValue(3);
        Logger.log('✅ ' + correo + ' ahora tiene ID_Rol = 3 (Superadministrador)');
        encontrado = true;
        break;
      }
    }
    if (!encontrado) Logger.log('⚠️ No hay ningún usuario registrado con el correo ' + correo);
  });
}
