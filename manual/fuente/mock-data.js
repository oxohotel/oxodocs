/**
 * mock-data.js - Datos FICTICIOS y respuestas simuladas del backend de OXO Docs.
 * Exporta:
 *   responder(action, args) -> valor que devolveria la funcion de Apps Script (va en {success:true,data})
 *   SESION   -> objeto que se guarda en localStorage["currentUser"]
 *   sinMapear -> Set con las acciones recibidas que no tienen respuesta (devuelven data:null)
 */

const sinMapear = new Set();

// ---------- Fechas relativas (para que "Recientes" y "Logs" se vean actuales) ----------
function hace(dias, hora = 9, min = 30) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, min, 0, 0);
  return d.toString();
}

// ---------- Usuarios ----------
const U = (id, nombre, email, rol_id, estado, hoteles) => ({
  id: String(id), nombre, email, rol_id, id_rol: rol_id,
  rol: ['', 'Usuario', 'Administrador', 'Superadministrador'][rol_id],
  estado, hoteles_permitidos: hoteles, hoteles_lista: [],
});
const USUARIOS = [
  U(1, 'Carolina Ruiz', 'cruiz@oxohotel.com', 3, 'Activo', '*'),
  U(2, 'Luis Gómez', 'lgomez@oxohotel.com', 2, 'Activo', 'H1,H2,H3'),
  U(3, 'María Fernanda Torres', 'mtorres@oxohotel.com', 1, 'Activo', 'H1,H9'),
  U(4, 'Andrés Salcedo', 'asalcedo@oxohotel.com', 1, 'Activo', 'H1'),
  U(5, 'Diana Herrera', 'dherrera@oxohotel.com', 2, 'Activo', '*'),
  U(6, 'Jorge Valencia', 'jvalencia@oxohotel.com', 1, 'Activo', 'H2,H4'),
  U(7, 'Paula Mejía', 'pmejia@oxohotel.com', 1, 'Pendiente_Aprobacion', ''),
  U(8, 'Camilo Restrepo', 'crestrepo@oxohotel.com', 1, 'Activo', 'H5,H6,H7,H8'),
  U(9, 'Natalia Ortiz', 'nortiz@oxohotel.com', 1, 'Inactivo', 'H3'),
  U(10, 'Sebastián Cárdenas', 'scardenas@oxohotel.com', 2, 'Activo', 'H1,H2,H3,H4'),
  U(11, 'Valentina Rojas', 'vrojas@oxohotel.com', 1, 'Activo', '*'),
  U(12, 'Ricardo Peña', 'rpena@oxohotel.com', 1, 'Pendiente_Verificacion', ''),
];

const SESION = {
  ID_Usuario: '1', Nombre_Completo: 'Carolina Ruiz', Email: 'cruiz@oxohotel.com',
  ID_Rol: 3, Rol_ID: 3, Rol: 'Superadministrador', Estado: 'Activo',
  token: 'token-demo-manual', cacheVersion: '1',
};

const GRUPOS = [
  { id: 'G1', nombre: 'Dirección IT', integrantes: ['2', '3', '4'] },
];

// ---------- Hoteles y módulos ----------
const MODULOS = [
  { idModulo: 'M1', nombre: 'Hoteles en operación', orden: 1, hoteles: ['H1:Hotel Bari', 'H2:AC Hotel by Marriott Bogotá', 'H3:Hotel Costa Azul', 'H4:Hotel Andino Plaza'] },
  { idModulo: 'M2', nombre: 'Hoteles en pre-apertura', orden: 2, hoteles: ['H5:Hotel Sierra Nevada', 'H6:Hotel Playa Dorada'] },
  { idModulo: 'M3', nombre: 'Hoteles en desarrollo', orden: 3, hoteles: ['H7:Hotel Altiplano', 'H8:Hotel Río Claro'] },
  { idModulo: 'M4', nombre: 'Corporativo', orden: 4, hoteles: ['H9:Corporativo'] },
].map(m => ({
  idModulo: m.idModulo, nombre: m.nombre, orden: m.orden,
  hoteles: m.hoteles.map(s => {
    const [idHotel, nombre] = s.split(':');
    return { idHotel, nombre, driveFolderId: 'drv-' + idHotel, driveUrl: '' };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
}));
const HOTELES = {};
MODULOS.forEach(m => m.hoteles.forEach(h => { HOTELES[h.idHotel] = h.nombre; }));

// ---------- Carpetas (áreas + subcarpetas) ----------
const AREAS = ['Alimentos y Bebidas', 'CAF', 'IT', 'Jurídico', 'Recursos Humanos', 'Comercial', 'Mantenimiento', 'Revenue'];
const CARPETAS = []; // {id,idHotel,idPadre,nombre}
Object.keys(HOTELES).forEach((h, hi) => {
  AREAS.forEach((a, ai) => {
    CARPETAS.push({ id: `C-${h}-${ai + 1}`, idHotel: h, idPadre: null, nombre: a });
  });
});
const idArea = (h, nombre) => CARPETAS.find(c => c.idHotel === h && !c.idPadre && c.nombre === nombre).id;
// Subcarpetas de IT (y Jurídico) en algunos hoteles
['H1', 'H2', 'H3'].forEach(h => {
  const it = idArea(h, 'IT');
  CARPETAS.push({ id: `S-${h}-1`, idHotel: h, idPadre: it, nombre: 'Presupuestos 2027' });
  CARPETAS.push({ id: `S-${h}-2`, idHotel: h, idPadre: it, nombre: 'Contratos de proveedores' });
  CARPETAS.push({ id: `S-${h}-3`, idHotel: h, idPadre: it, nombre: 'Inventario de equipos' });
});
// Dentro de "Presupuestos 2027" de Hotel Bari
CARPETAS.push({ id: 'S-H1-1a', idHotel: 'H1', idPadre: 'S-H1-1', nombre: 'Borradores' });
CARPETAS.push({ id: 'S-H1-1b', idHotel: 'H1', idPadre: 'S-H1-1', nombre: 'Versión aprobada' });
CARPETAS.push({ id: 'S-H1-1c', idHotel: 'H1', idPadre: 'S-H1-1', nombre: 'Soportes y cotizaciones' });

// ---------- Archivos ----------
const KB = 1024, MB = 1024 * 1024;
let _a = 0;
const A = (idCarpeta, nombre, tamano, dias, responsable) => {
  const ext = nombre.split('.').pop().toLowerCase();
  const tipo = { xlsx: 'Excel', pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint' }[ext] || 'Otro';
  return {
    id: 'A' + (++_a), idCarpeta, nombre, extension: ext, tipo, estado: 'Vigente',
    responsable, driveUrl: 'https://drive.google.com/file/d/demo' + _a, driveFileId: 'demo' + _a,
    fecha: hace(dias), fechaModificacion: hace(dias), tamano,
  };
};
const ARCHIVOS = [
  A('S-H1-1', 'Presupuesto_2027.xlsx', 482 * KB, 2, 'Carolina Ruiz'),
  A('S-H1-1', 'Resumen_Ejecutivo_Presupuesto.pdf', 1.4 * MB, 3, 'Luis Gómez'),
  A('S-H1-1', 'Presentacion_Comite_Presupuesto.pptx', 3.2 * MB, 5, 'Carolina Ruiz'),
  A('S-H1-1', 'Acta_Revision_Presupuesto.docx', 96 * KB, 6, 'María Fernanda Torres'),
  A('S-H1-1', 'Proyeccion_Gastos_Tecnologia.xlsx', 318 * KB, 9, 'Andrés Salcedo'),
  A('S-H1-1', 'Politica_Compras_IT.pdf', 760 * KB, 14, 'Luis Gómez'),
  A(idArea('H1', 'IT'), 'Manual_Procedimientos_IT.docx', 210 * KB, 20, 'Luis Gómez'),
  A('S-H1-2', 'Contrato_Proveedor_Lavandería.pdf', 1.1 * MB, 12, 'Diana Herrera'),
  A('S-H1-2', 'Contrato_Internet_Corporativo.pdf', 890 * KB, 18, 'Carolina Ruiz'),
  A(idArea('H1', 'CAF'), 'Cierre_Contable_Septiembre.xlsx', 1.9 * MB, 4, 'Diana Herrera'),
  A(idArea('H1', 'Jurídico'), 'Contrato_Arrendamiento_Local.pdf', 2.3 * MB, 7, 'Jorge Valencia'),
  A(idArea('H1', 'Recursos Humanos'), 'Manual_Bienvenida_Colaboradores.docx', 540 * KB, 11, 'Valentina Rojas'),
  A(idArea('H1', 'Alimentos y Bebidas'), 'Carta_Restaurante_Temporada.pdf', 4.8 * MB, 1, 'Camilo Restrepo'),
  A(idArea('H1', 'Comercial'), 'Plan_Comercial_2027.pptx', 5.6 * MB, 8, 'Sebastián Cárdenas'),
  A('S-H2-1', 'Presupuesto_2027_Bogota.xlsx', 455 * KB, 3, 'Luis Gómez'),
  A('S-H3-1', 'Presupuesto_2027_CostaAzul.xlsx', 430 * KB, 10, 'Sebastián Cárdenas'),
];

// ---------- Resolución de recursos (como backend/Recursos.js) ----------
const carpetaPorId = id => CARPETAS.find(c => c.id === id);
const archivoPorId = id => ARCHIVOS.find(a => a.id === id);

function resolver(tipo, id) {
  if (tipo === 'Hotel') {
    return { existe: true, tipoRecurso: 'Hotel', idRecurso: id, nombre: HOTELES[id], contexto: 'Hotel', idHotel: id, nombreHotel: HOTELES[id] };
  }
  if (tipo === 'Carpeta') {
    const c = carpetaPorId(id);
    return { existe: true, tipoRecurso: 'Carpeta', idRecurso: id, nombre: c.nombre, contexto: HOTELES[c.idHotel], idHotel: c.idHotel, nombreHotel: HOTELES[c.idHotel] };
  }
  const a = archivoPorId(id), c = carpetaPorId(a.idCarpeta);
  return {
    existe: true, tipoRecurso: 'Archivo', idRecurso: id, nombre: a.nombre,
    contexto: HOTELES[c.idHotel] + ' / ' + c.nombre, idHotel: c.idHotel, nombreHotel: HOTELES[c.idHotel],
    idCarpeta: c.id, nombreCarpeta: c.nombre, driveFileId: a.driveFileId, driveUrl: a.driveUrl, extension: a.extension,
  };
}

const FAVORITOS = [['Carpeta', 'S-H1-1'], ['Archivo', 'A1'], ['Carpeta', idArea('H1', 'IT')], ['Archivo', 'A8'],
  ['Archivo', 'A10'], ['Carpeta', idArea('H2', 'CAF')], ['Archivo', 'A14'], ['Hotel', 'H1']];
const RECIENTES = [['Archivo', 'A1', 'Subió'], ['Carpeta', 'S-H1-1', 'Abrió'], ['Archivo', 'A8', 'Abrió'],
  ['Carpeta', idArea('H1', 'CAF'), 'Abrió'], ['Archivo', 'A11', 'Abrió'], ['Hotel', 'H2', 'Abrió'],
  ['Archivo', 'A14', 'Subió'], ['Carpeta', idArea('H1', 'Jurídico'), 'Abrió']];

// ---------- Resumen de carpetas ----------
function resumen(id) {
  // Cuenta archivos directos (cantidad, tamaño total, fecha de última actividad)
  const arch = ARCHIVOS.filter(a => a.idCarpeta === id);
  const sub = CARPETAS.filter(c => c.idPadre === id).length;
  return {
    cantidad: arch.length + sub,
    tamanoTotal: arch.reduce((s, a) => s + a.tamano, 0),
    fechaUltimaActividad: arch.length ? arch.map(a => new Date(a.fecha)).sort((x, y) => y - x)[0].toString() : null,
  };
}
const objCarpeta = c => ({
  id: c.id, idHotel: c.idHotel, idPadre: c.idPadre, nombre: c.nombre, ...resumen(c.id),
  driveFolderId: 'drv-' + c.id, fechaCreacion: hace(120),
});

// ---------- Logs ----------
const LOGS = [
  [0, 8, 5, 'Carolina Ruiz', 'cruiz@oxohotel.com', 'Login', 'Inicio de sesión exitoso', 'Exitosa'],
  [0, 9, 12, 'Carolina Ruiz', 'cruiz@oxohotel.com', 'Subida de archivo', 'Subió "Presupuesto_2027.xlsx" en Hotel Bari / IT / Presupuestos 2027', 'Exitosa'],
  [0, 10, 40, 'Luis Gómez', 'lgomez@oxohotel.com', 'Login', 'Inicio de sesión exitoso', 'Exitosa'],
  [1, 15, 3, 'Luis Gómez', 'lgomez@oxohotel.com', 'Crear carpeta', 'Creó la carpeta "Contratos de proveedores" en Hotel Bari / IT', 'Exitosa'],
  [1, 16, 22, 'Diana Herrera', 'dherrera@oxohotel.com', 'Login', 'Intento de inicio de sesión con contraseña incorrecta', 'Fallida'],
  [1, 16, 25, 'Diana Herrera', 'dherrera@oxohotel.com', 'Login', 'Inicio de sesión exitoso', 'Exitosa'],
  [2, 11, 0, 'Carolina Ruiz', 'cruiz@oxohotel.com', 'Cambio de rol', 'Cambió el rol de Luis Gómez a Administrador', 'Exitosa'],
  [2, 13, 45, 'Jorge Valencia', 'jvalencia@oxohotel.com', 'Subida de archivo', 'Subió "Contrato_Arrendamiento_Local.pdf" en Hotel Bari / Jurídico', 'Exitosa'],
  [3, 9, 15, 'Sebastián Cárdenas', 'scardenas@oxohotel.com', 'Renombrar archivo', 'Renombró "Plan_Comercial.pptx" a "Plan_Comercial_2027.pptx"', 'Exitosa'],
  [3, 14, 30, 'Carolina Ruiz', 'cruiz@oxohotel.com', 'Asignar hoteles', 'Asignó 3 hoteles a Luis Gómez', 'Exitosa'],
  [4, 8, 50, 'Valentina Rojas', 'vrojas@oxohotel.com', 'Cambio de contraseña', 'Cambió su contraseña', 'Exitosa'],
  [5, 17, 10, 'Camilo Restrepo', 'crestrepo@oxohotel.com', 'Eliminar archivo', 'Eliminó "Carta_Restaurante_Borrador.pdf" en Hotel Bari / Alimentos y Bebidas', 'Exitosa'],
  [6, 10, 5, 'Carolina Ruiz', 'cruiz@oxohotel.com', 'Crear área', 'Creó el área "Revenue" en Hotel Costa Azul', 'Exitosa'],
  [7, 9, 0, 'Paula Mejía', 'pmejia@oxohotel.com', 'Registro', 'Nuevo usuario registrado', 'Exitosa'],
].map((r, i) => ({
  id: i + 1, usuarioNombre: r[3], usuarioEmail: r[4], tipo: r[5], descripcion: r[6],
  entidad: 'Auditoria', fecha: hace(r[0], r[1], r[2]), estado: r[7],
}));

// ---------- Despachador de acciones ----------
function responder(action, args) {
  switch (action) {
    case 'obtenerVersionCacheGlobal': return '1';
    case 'obtenerModulosConHoteles': return MODULOS;
    case 'obtenerIdsFavoritosUsuario': return { success: true, favoritos: FAVORITOS.map(f => f[0] + '|' + f[1]) };
    case 'obtenerFavoritosDetallados':
      return { success: true, favoritos: FAVORITOS.map(f => ({ ...resolver(f[0], f[1]), fechaMarcado: hace(1) })) };
    case 'obtenerActividadReciente': {
      const lim = args[1] || 15;
      return { success: true, actividad: RECIENTES.slice(0, lim).map((r, i) => ({ ...resolver(r[0], r[1]), tipoInteraccion: r[2], fechaHora: hace(0, 11 - i) })) };
    }
    case 'registrarActividad': return { success: true };
    case 'alternarFavorito': return { success: true, esFavorito: true };
    case 'obtenerCarpetasDelHotel':
      return { success: true, carpetas: CARPETAS.filter(c => c.idHotel === args[0] && !c.idPadre).map(objCarpeta) };
    case 'obtenerContenidoCarpeta': {
      const id = args[0], c = carpetaPorId(id);
      return {
        success: true,
        carpetaActual: c ? resolver('Carpeta', id) : null,
        subcarpetas: CARPETAS.filter(x => x.idPadre === id).map(objCarpeta),
        archivos: ARCHIVOS.filter(a => a.idCarpeta === id),
      };
    }
    case 'obtenerRutaCarpeta': {
      const ruta = []; let c = carpetaPorId(args[0]);
      while (c) { ruta.unshift({ id: c.id, nombre: c.nombre }); c = c.idPadre ? carpetaPorId(c.idPadre) : null; }
      return { success: true, ruta };
    }
    case 'buscarGlobal': {
      const t = String(args[0] || '').toLowerCase();
      return {
        hoteles: Object.keys(HOTELES).filter(h => HOTELES[h].toLowerCase().includes(t)).map(h => ({ idHotel: h, nombre: HOTELES[h] })).slice(0, 8),
        carpetas: CARPETAS.filter(c => c.nombre.toLowerCase().includes(t))
          .map(c => ({ idCarpeta: c.id, idHotel: c.idHotel, nombre: c.nombre, nombreHotel: HOTELES[c.idHotel] })).slice(0, 8),
      };
    }
    case 'obtenerListaUsuariosParaPermisos':
      return { success: true, usuarios: USUARIOS.filter(u => u.estado === 'Activo').map(u => ({ id: u.id, nombre: u.nombre, email: u.email, restringido: false })).sort((a, b) => a.nombre.localeCompare(b.nombre)) };
    case 'obtenerGruposUsuario': return { success: true, grupos: GRUPOS };
    case 'crearGrupoUsuario': case 'eliminarGrupoUsuario': return { success: true, message: 'ok' };
    case 'obtenerDatosUsuarioActual':
      return { nombre: SESION.Nombre_Completo, email: SESION.Email, rol: SESION.Rol, estado: 'Activo', fechaRegistro: '2025-03-14T10:00:00' };
    case 'obtenerPreferenciasNotificaciones': return { actividad: true, recordatorios: false, seguridad: true };
    case 'obtenerCatalogoRoles': return { success: true, roles: [{ id: 1, nombre: 'Usuario' }, { id: 2, nombre: 'Administrador' }, { id: 3, nombre: 'Superadministrador' }] };
    case 'obtenerUsuariosParaGestion': {
      return {
        success: true,
        usuarios: USUARIOS.map(u => {
          const lista = (u.hoteles_permitidos && u.hoteles_permitidos !== '*')
            ? u.hoteles_permitidos.split(',').map(h => HOTELES[h]).filter(Boolean) : [];
          return { ...u, hoteles_lista: lista };
        }),
      };
    }
    case 'obtenerRegistrosAuditoria': return { success: true, registros: LOGS };
    case 'registrarAuditoria': return { success: true };
    // Escrituras: basta con simular éxito
    case 'crearSubcarpeta': case 'crearArea': case 'renombrarCarpeta': case 'eliminarCarpeta':
    case 'guardarArchivoEnDrive': case 'guardarArchivosMultiplesDesdeDrive': case 'eliminarArchivo':
    case 'renombrarArchivo': case 'guardarPermisosArchivo': case 'actualizarPermisosExistentes':
      return { success: true, message: 'Operación simulada' };
    case 'cerrarSesionUsuario': return null;
    default:
      sinMapear.add(action);
      return null;
  }
}

module.exports = { responder, SESION, sinMapear };
