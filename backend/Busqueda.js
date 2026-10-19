/**
 * Buscador global de la navbar. Busca sobre propiedades (hoja "Hoteles") y carpetas (hoja "Carpetas"), solo de las propiedades a las que la
 * persona tiene acceso (backend/Acceso.js). Documentos/personas se agregarán cuando existan hojas que los respalden.
 *
 * Dos formas de usarlo:
 *   - obtenerIndiceDeBusqueda: devuelve TODO lo que esa persona puede encontrar, en formato compacto. El navegador lo guarda y filtra
 *     por su cuenta al escribir: la búsqueda es instantánea y no hace una llamada al servidor por cada tecla (cada llamada cuesta 2-3 s).
 *   - buscarGlobal: la búsqueda en el servidor, que queda de respaldo mientras el índice aún no llegó.
 * Ambas leen de los cachés de propiedades y carpetas (backend/Cache.js y backend/CacheArchivos.js), sin tocar las hojas.
 */

/** Propiedades y carpetas que la persona puede ver: { hoteles: [{ idHotel, nombre }], carpetas: [{ idCarpeta, idHotel, nombre, nombreHotel }] }. */
function datosParaBusqueda_(idUsuario) {
  const alcance = alcanceDeHoteles_(idUsuario);
  const visibles = function (idHotel) { return alcancePermiteHotel_(alcance, idHotel); };

  const mapaHoteles = {};
  const hoteles = [];
  const valoresHoteles = leerHojaConCache_('Hoteles') || [];
  for (let i = 1; i < valoresHoteles.length; i++) {
    const idHotel = valoresHoteles[i][0];
    const nombre = valoresHoteles[i][1];
    if (!idHotel) continue;
    mapaHoteles[idHotel] = nombre;
    if (nombre && visibles(idHotel)) hoteles.push({ idHotel: idHotel, nombre: nombre });
  }

  const carpetas = [];
  const c = leerCarpetasConCache_(obtenerSpreadsheet_());
  if (c.existe) {
    const idx = indiceDeEncabezados_(c.encabezados);
    c.filas.forEach(function (f) {
      const idCarpeta = f[idx['ID_Carpeta']];
      const idHotel = f[idx['ID_Hotel']];
      const nombre = f[idx['Nombre_Carpeta']];
      if (!idCarpeta || !nombre || !visibles(idHotel)) return;
      carpetas.push({ idCarpeta: idCarpeta, idHotel: idHotel, nombre: nombre, nombreHotel: mapaHoteles[idHotel] || '' });
    });
  }
  return { hoteles: hoteles, carpetas: carpetas };
}

function buscarGlobal(termino, idUsuario) {
  const resultadoVacio = { hoteles: [], carpetas: [] };
  const t = String(termino || '').trim().toLowerCase();
  if (!t) return resultadoVacio;

  try {
    const d = datosParaBusqueda_(idUsuario);
    const coincide = function (nombre) { return String(nombre).toLowerCase().indexOf(t) !== -1; };
    return {
      hoteles: d.hoteles.filter(function (h) { return coincide(h.nombre); }).slice(0, 8),
      carpetas: d.carpetas.filter(function (c) { return coincide(c.nombre); }).slice(0, 8)
    };
  } catch (error) {
    Logger.log('Error en buscarGlobal: ' + error.toString());
    return resultadoVacio;
  }
}

/** Índice compacto para filtrar en el navegador: hoteles [[id, nombre]] y carpetas [[id, idHotel, nombre]] (el nombre de la propiedad se deduce de su id). */
function obtenerIndiceDeBusqueda(idUsuario) {
  try {
    const d = datosParaBusqueda_(idUsuario);
    return {
      success: true,
      hoteles: d.hoteles.map(function (h) { return [h.idHotel, h.nombre]; }),
      carpetas: d.carpetas.map(function (c) { return [c.idCarpeta, c.idHotel, c.nombre]; })
    };
  } catch (error) {
    Logger.log('Error en obtenerIndiceDeBusqueda: ' + error.toString());
    return { success: false, message: 'No se pudo preparar la búsqueda', hoteles: [], carpetas: [] };
  }
}
