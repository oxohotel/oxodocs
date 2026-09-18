/**
 * Gestión de grupos de usuarios personalizados.
 * Permite a cada usuario guardar sus propias listas de usuarios (grupos) para usarlos en restricciones de permisos.
 */

/**
 * Obtiene los grupos creados por un usuario específico
 * @param {string} idUsuario - El ID del usuario creador
 */
function obtenerGruposUsuario(idUsuario) {
  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaGrupos = ss.getSheetByName('Grupos_Usuarios');
    
    if (!hojaGrupos) {
      return { success: true, grupos: [] }; // Hoja no existe aún, retornar vacío
    }

    const datos = hojaGrupos.getDataRange().getValues();
    const grupos = [];
    const idUsuarioStr = String(idUsuario);

    // Comenzar desde la fila 1 para saltar encabezados
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][1]) === idUsuarioStr) {
        let integrantes = [];
        try {
          // Intentar parsear como JSON, si falla, intentar como lista separada por comas
          integrantes = JSON.parse(datos[i][3]);
        } catch (e) {
          integrantes = String(datos[i][3]).split(',').map(s => s.trim()).filter(Boolean);
        }

        grupos.push({
          id: String(datos[i][0]),
          nombre: String(datos[i][2]),
          integrantes: integrantes
        });
      }
    }

    return { success: true, grupos: grupos };
  } catch (error) {
    Logger.log('Error en obtenerGruposUsuario: ' + error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Crea un nuevo grupo de usuarios
 * @param {string} idUsuario - ID del usuario que crea el grupo
 * @param {string} nombreGrupo - Nombre del grupo
 * @param {Array<string>} arrayIntegrantes - Array de IDs de usuarios que conforman el grupo
 */
function crearGrupoUsuario(idUsuario, nombreGrupo, arrayIntegrantes) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    
    let hojaGrupos = ss.getSheetByName('Grupos_Usuarios');
    if (!hojaGrupos) {
      hojaGrupos = obtenerOCrearHoja_(ss, 'Grupos_Usuarios', [
        'ID_Grupo', 'ID_Usuario_Creador', 'Nombre_Grupo', 'Integrantes'
      ]);
    }

    // Generar nuevo ID
    const ultimaFila = hojaGrupos.getLastRow();
    let nuevoId = 1;
    if (ultimaFila > 1) {
      const ids = hojaGrupos.getRange(2, 1, ultimaFila - 1, 1).getValues().map(r => Number(r[0]));
      nuevoId = Math.max(...ids) + 1;
    }

    const integrantesStr = JSON.stringify(arrayIntegrantes);

    hojaGrupos.appendRow([
      nuevoId,
      String(idUsuario),
      String(nombreGrupo),
      integrantesStr
    ]);

    Logger.log(`✅ Grupo creado por usuario ${idUsuario}: ${nombreGrupo} (ID: ${nuevoId})`);
    
    return { 
      success: true, 
      grupo: {
        id: String(nuevoId),
        nombre: nombreGrupo,
        integrantes: arrayIntegrantes
      }
    };
  } catch (error) {
    Logger.log('Error en crearGrupoUsuario: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Elimina un grupo de usuarios existente
 * @param {string} idUsuario - ID del usuario que solicita la eliminación (para validación)
 * @param {string} idGrupo - ID del grupo a eliminar
 */
function eliminarGrupoUsuario(idUsuario, idGrupo) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaGrupos = ss.getSheetByName('Grupos_Usuarios');
    
    if (!hojaGrupos) {
      return { success: false, message: 'La hoja de grupos no existe.' };
    }

    const datos = hojaGrupos.getDataRange().getValues();
    const idGrupoStr = String(idGrupo);
    const idUsuarioStr = String(idUsuario);

    for (let i = datos.length - 1; i >= 1; i--) {
      if (String(datos[i][0]) === idGrupoStr) {
        // Verificar propiedad
        if (String(datos[i][1]) !== idUsuarioStr) {
          return { success: false, message: 'No tienes permiso para eliminar este grupo.' };
        }
        
        hojaGrupos.deleteRow(i + 1);
        Logger.log(`🗑️ Grupo eliminado: ID ${idGrupoStr}`);
        return { success: true, message: 'Grupo eliminado correctamente' };
      }
    }

    return { success: false, message: 'Grupo no encontrado.' };
  } catch (error) {
    Logger.log('Error en eliminarGrupoUsuario: ' + error);
    return { success: false, message: error.toString() };
  } finally {
    lock.releaseLock();
  }
}
