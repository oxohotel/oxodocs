/**
 * Lectura del registro de auditoría (hoja "Auditoria") para el apartado "Logs" — quién hizo
 * qué y cuándo: inicios/cierres de sesión, cambios de contraseña, cambios de rol, y
 * creación/renombrado/eliminación de áreas, carpetas y archivos. Quien escribe esos registros
 * es registrarAuditoria (backend/Auth.js) y registrarAuditoriaSimple_ (backend/Usuario.js) —
 * este archivo solo los lee.
 */
function obtenerRegistrosAuditoria(idUsuarioSolicitante, limite, idUsuarioFallback) {
  if (!usuarioTienePermiso(idUsuarioSolicitante, 'Gestionar_Usuarios', idUsuarioFallback)) {
    return { success: false, message: 'No tienes permiso para ver esta sección', registros: [] };
  }

  try {
    limite = limite || 200;
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName('Auditoria');
    if (!hoja) return { success: false, message: 'Hoja Auditoria no encontrada', registros: [] };

    const datos = hoja.getDataRange().getValues();
    if (datos.length <= 1) return { success: true, registros: [] };

    const idx = {};
    datos[0].forEach(function (columna, i) { idx[columna] = i; });

    // registrarAuditoriaSimple_ (renombrar/eliminar carpetas y archivos, cambios de rol, etc.)
    // no guarda el email en la fila, solo el ID_Usuario — se resuelve aquí cruzando con
    // "Usuarios" para poder mostrar quién fue, no solo un número.
    const mapaUsuarios = {};
    const hojaUsuarios = ss.getSheetByName('Usuarios');
    if (hojaUsuarios) {
      const datosUsuarios = hojaUsuarios.getDataRange().getValues();
      const idxUsuarios = {};
      datosUsuarios[0].forEach(function (columna, i) { idxUsuarios[columna] = i; });
      for (let i = 1; i < datosUsuarios.length; i++) {
        mapaUsuarios[String(datosUsuarios[i][idxUsuarios['ID_Usuario']])] = {
          nombre: datosUsuarios[i][idxUsuarios['Nombre_Completo']],
          email: datosUsuarios[i][idxUsuarios['Email']]
        };
      }
    }

    // Un Administrador (rol 2) solo ve la actividad de su alcance (backend/AlcanceAdmin.js): lo que hicieron él
    // y los usuarios que puede ver, y también lo que otros (p. ej. un superadmin) hicieron sobre ellos, que se
    // detecta por el correo del usuario en la descripción. El Superadministrador ve todo.
    let filtroAlcance = null;
    const solicitante = resolverUsuarioSolicitante_(idUsuarioSolicitante, idUsuarioFallback);
    if (solicitante && solicitante.idUsuario) {
      const usuariosAlcance = leerUsuariosParaAlcance_(ss);
      const alcance = calcularAlcanceGestion_(usuariosAlcance, solicitante.idUsuario);
      if (!alcance.esSuperadmin) {
        const visibles = usuariosAlcance.filter(function (u) { return usuarioEnAlcance_(alcance, u); });
        filtroAlcance = {
          ids: new Set(visibles.map(function (u) { return u.id; })),
          emails: visibles.map(function (u) { return u.email; }).filter(Boolean)
        };
      }
    }

    const registros = [];
    for (let i = 1; i < datos.length; i++) {
      const idUsuarioFila = String(datos[i][idx['ID_Usuario']] || '');
      const usuarioInfo = mapaUsuarios[idUsuarioFila];
      const emailFila = datos[i][idx['Email_Usuario']];
      const fechaHora = datos[i][idx['Fecha_Hora']];

      if (filtroAlcance) {
        const emailActor = String(emailFila || (usuarioInfo && usuarioInfo.email) || '').trim().toLowerCase();
        const descripcion = String(datos[i][idx['Descripcion']] || '').toLowerCase();
        const esDelAlcance = filtroAlcance.ids.has(idUsuarioFila) ||
          (emailActor && filtroAlcance.emails.indexOf(emailActor) !== -1) ||
          filtroAlcance.emails.some(function (e) { return textoMencionaCorreo_(descripcion, e); });
        if (!esDelAlcance) continue;
      }

      registros.push({
        id: datos[i][idx['ID_Auditoria']],
        usuarioNombre: (usuarioInfo && usuarioInfo.nombre) || '',
        usuarioEmail: emailFila || (usuarioInfo && usuarioInfo.email) || '',
        tipo: datos[i][idx['Tipo_Accion']],
        descripcion: datos[i][idx['Descripcion']],
        entidad: datos[i][idx['Entidad_Afectada']],
        fecha: fechaHora ? fechaHora.toString() : '',
        estado: datos[i][idx['Estado']]
      });
    }

    registros.sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });

    return { success: true, registros: registros.slice(0, limite) };
  } catch (error) {
    Logger.log('Error obtenerRegistrosAuditoria: ' + error);
    return { success: false, message: error.toString(), registros: [] };
  }
}
