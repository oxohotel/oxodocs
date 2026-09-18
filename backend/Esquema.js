/**
 * Crea/actualiza TODAS las hojas del sistema que no dependen de Drive (Modulos/Hoteles/Carpetas
 * las gestiona backend/Drive.gs, porque van de la mano con la creación real de carpetas en Drive):
 * Usuarios, Recuperacion_Contraseña, Auditoria, Roles, catálogos, favoritos, actividad,
 * notificaciones e índice de búsqueda.
 *
 * No destructivo, salvo "Roles": las hojas con datos reales (Usuarios, Auditoria, etc.) nunca se
 * tocan ni se borran si ya existen. Solo "Roles" se reescribe por completo en cada corrida, porque
 * es un catálogo de permisos de 2 filas, no datos de usuarios. Seguro de re-ejecutar siempre.
 */
function crearHojasRestantes() {
  const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);

  obtenerOCrearHoja_(ss, 'Usuarios', [
    'ID_Usuario', 'Nombre_Completo', 'Email', 'Contraseña_Hash', 'Rol', 'Estado', 'Fecha_Registro'
  ]);
  obtenerOCrearHoja_(ss, 'Recuperacion_Contraseña', [
    'ID_Recuperacion', 'Email_Usuario', 'Token_Unico', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado', 'Nueva_Contraseña_Hash'
  ]);
  obtenerOCrearHoja_(ss, 'Verificacion_Email', [
    'ID_Verificacion', 'ID_Usuario', 'Email', 'Codigo', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado'
  ]);
  obtenerOCrearHoja_(ss, 'Auditoria', [
    'ID_Auditoria', 'ID_Usuario', 'Email_Usuario', 'Tipo_Accion', 'Descripcion', 'Entidad_Afectada', 'Fecha_Hora', 'Estado'
  ]);
  obtenerOCrearHoja_(ss, 'Sesiones', [
    'ID_Sesion', 'ID_Usuario', 'Token', 'Fecha_Creacion', 'Fecha_Expiracion', 'Estado'
  ]);

  actualizarRoles_(ss);
  crearPlantillaCarpetas_(ss);
  crearTiposDocumento_(ss);
  crearEstadosDocumento_(ss);

  obtenerOCrearHoja_(ss, 'Archivos', [
    'ID_Archivo', 'ID_Carpeta', 'DriveFileId', 'Nombre_Archivo', 'Extension',
    'Tipo_Documento', 'Estado_Documento', 'Responsable', 'MimeType', 'DriveUrl',
    'Fecha_Creacion', 'Fecha_Modificacion', 'Fecha_Sincronizacion'
  ]);

  obtenerOCrearHoja_(ss, 'Favoritos', [
    'ID_Favorito', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Fecha_Marcado'
  ]);

  obtenerOCrearHoja_(ss, 'Actividad_Reciente', [
    'ID_Actividad', 'ID_Usuario', 'Tipo_Recurso', 'ID_Recurso', 'Tipo_Interaccion', 'Fecha_Hora'
  ]);

  obtenerOCrearHoja_(ss, 'Notificaciones', [
    'ID_Notificacion', 'ID_Usuario_Destino', 'Tipo_Notificacion', 'Tipo_Recurso', 'ID_Recurso',
    'Mensaje', 'Estado_Notificacion', 'Fecha_Creacion'
  ]);

  obtenerOCrearHoja_(ss, 'Indice_Busqueda', [
    'ID_Indice', 'Tipo_Entidad', 'ID_Entidad', 'Nombre', 'Ruta', 'ID_Hotel', 'Responsable',
    'Tipo_Documento', 'Estado_Documento', 'Palabras_Clave', 'Fecha_Modificacion', 'DriveId'
  ]);

  obtenerOCrearHoja_(ss, 'Permisos_Archivos', [
    'ID_Permiso', 'ID_Archivo', 'ID_Usuario_RESTRINGIDO', 'Nombre_Usuario_RESTRINGIDO', 'Fecha_Restriccion', 'Razon'
  ]);

  obtenerOCrearHoja_(ss, 'Grupos_Usuarios', [
    'ID_Grupo', 'ID_Usuario_Creador', 'Nombre_Grupo', 'Integrantes'
  ]);

  Logger.log('✅ Esquema completo: todas las hojas verificadas/creadas.');
}

/** Reescribe "Roles" con tres escalones: Usuario (ver/subir), Administrador (gestión total de
 *  hoteles/carpetas/usuarios) y Superadministrador (todo lo de Administrador, más el único que
 *  puede cambiarle el rol a otra persona — columna "Gestionar_Roles", ver backend/Roles.js). */
function actualizarRoles_(ss) {
  let hoja = ss.getSheetByName('Roles');
  if (!hoja) hoja = ss.insertSheet('Roles');
  hoja.clearContents();
  hoja.clearFormats();

  const encabezados = [
    'ID_Rol', 'Nombre_Rol', 'Ver_Documentos', 'Subir_Documentos',
    'Editar_Documentos', 'Eliminar_Documentos', 'Gestionar_Hoteles_Carpetas', 'Gestionar_Usuarios',
    'Gestionar_Roles'
  ];
  hoja.appendRow(encabezados);
  hoja.appendRow([1, 'Usuario', 'SI', 'SI', 'NO', 'NO', 'NO', 'NO', 'NO']);
  hoja.appendRow([2, 'Administrador', 'SI', 'SI', 'SI', 'SI', 'SI', 'SI', 'NO']);
  hoja.appendRow([3, 'Superadministrador', 'SI', 'SI', 'SI', 'SI', 'SI', 'SI', 'SI']);

  hoja.setFrozenRows(1);
  const r = hoja.getRange(1, 1, 1, encabezados.length);
  r.setBackground('#4285F4');
  r.setFontColor('#FFFFFF');
  r.setFontWeight('bold');
  hoja.autoResizeColumns(1, encabezados.length);

  Logger.log('🔄 "Roles" actualizada: Usuario = ver/subir, Administrador = gestión total, Superadministrador = gestión total + cambiar roles.');
}

/** Catálogo maestro de las áreas fijas — fuente única de verdad para backend/Drive.js. */
function crearPlantillaCarpetas_(ss) {
  const hoja = obtenerOCrearHoja_(ss, 'Plantilla_Carpetas', ['ID_Plantilla', 'Nombre_Carpeta', 'Orden', 'Activo']);
  if (hoja.getLastRow() <= 1) {
    DRIVE_CONFIG.AREAS_FIJAS.forEach(function (nombre, i) {
      hoja.appendRow([i + 1, nombre, i + 1, 'SI']);
    });
    Logger.log('📄 "Plantilla_Carpetas" sembrada con las áreas fijas.');
  }
}

function crearTiposDocumento_(ss) {
  const hoja = obtenerOCrearHoja_(ss, 'Tipos_Documento', ['ID_Tipo', 'Nombre_Tipo', 'Icono']);
  if (hoja.getLastRow() <= 1) {
    const tipos = [
      ['Contrato', 'description'],
      ['Presupuesto', 'attach_money'],
      ['Informe', 'summarize'],
      ['Acta', 'gavel'],
      ['Factura', 'receipt'],
      ['Imagen', 'image'],
      ['Video', 'movie'],
      ['Otro', 'insert_drive_file']
    ];
    tipos.forEach(function (t, i) { hoja.appendRow([i + 1, t[0], t[1]]); });
    Logger.log('📄 "Tipos_Documento" sembrada con catálogo inicial.');
  }
}

function crearEstadosDocumento_(ss) {
  const hoja = obtenerOCrearHoja_(ss, 'Estados_Documento', ['ID_Estado', 'Nombre_Estado', 'Color_Badge', 'Orden']);
  if (hoja.getLastRow() <= 1) {
    hoja.appendRow([1, 'En revisión', '#F4B400', 1]);
    hoja.appendRow([2, 'Aprobado', '#0F9D58', 2]);
    hoja.appendRow([3, 'Archivado', '#9E9E9E', 3]);
    Logger.log('📄 "Estados_Documento" sembrada con catálogo inicial.');
  }
}
