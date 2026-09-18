/**
 * Buscador global de la navbar. Busca sobre datos reales que ya existen: hoteles
 * (hoja "Hoteles") y carpetas (hoja "Carpetas"). Documentos/personas se agregarán
 * cuando existan hojas "Archivos"/asignaciones reales que respaldar.
 */
function buscarGlobal(termino) {
  const resultadoVacio = { hoteles: [], carpetas: [] };
  const t = String(termino || '').trim().toLowerCase();
  if (!t) return resultadoVacio;

  try {
    const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
    const hojaHoteles = ss.getSheetByName('Hoteles');
    const hojaCarpetas = ss.getSheetByName('Carpetas');

    const mapaHoteles = {};
    const hoteles = [];
    if (hojaHoteles) {
      const filas = hojaHoteles.getDataRange().getValues();
      for (let i = 1; i < filas.length; i++) {
        const idHotel = filas[i][0];
        const nombre = filas[i][1];
        if (!idHotel) continue;
        mapaHoteles[idHotel] = nombre;
        if (nombre && String(nombre).toLowerCase().indexOf(t) !== -1) {
          hoteles.push({ idHotel: idHotel, nombre: nombre });
        }
      }
    }

    const carpetas = [];
    if (hojaCarpetas) {
      const filas = hojaCarpetas.getDataRange().getValues();
      for (let i = 1; i < filas.length; i++) {
        const idCarpeta = filas[i][0];
        const idHotel = filas[i][1];
        const nombre = filas[i][3];
        if (!idCarpeta || !nombre) continue;
        if (String(nombre).toLowerCase().indexOf(t) !== -1) {
          carpetas.push({
            idCarpeta: idCarpeta,
            idHotel: idHotel,
            nombre: nombre,
            nombreHotel: mapaHoteles[idHotel] || ''
          });
        }
      }
    }

    return {
      hoteles: hoteles.slice(0, 8),
      carpetas: carpetas.slice(0, 8)
    };
  } catch (error) {
    Logger.log('Error en buscarGlobal: ' + error.toString());
    return resultadoVacio;
  }
}
