/**
 * Funciones de mantenimiento: se ejecutan A MANO desde el editor de Apps Script y NO están en la lista de acciones
 * permitidas de Code.js, así que no se pueden llamar desde la web.
 */

/**
 * La columna "Rol" de Usuarios debe guardar el NÚMERO del rol (1 usuario, 2 administrador, 3 superadministrador). Los registros
 * hechos antes del arreglo quedaron con el texto "Usuario". Esta función los convierte al número.
 *
 * Por seguridad NO modifica nada por defecto: normalizarRolesDeUsuarios() solo informa en el registro qué cambiaría.
 * Para aplicar los cambios: normalizarRolesDeUsuarios(true) (en el editor, escribe la llamada en una función auxiliar o usa
 * normalizarRolesDeUsuariosAplicar). Solo toca celdas de rol con texto que corresponda a un rol conocido; los números no se tocan.
 */
function normalizarRolesDeUsuarios(aplicar) {
  const hoja = obtenerSpreadsheet_().getSheetByName('Usuarios');
  if (!hoja) { Logger.log('No se encontró la hoja Usuarios'); return { success: false }; }

  const datos = hoja.getDataRange().getValues();
  const enc = datos[0].map(normalizarColumna_);
  let colRol = enc.findIndex(function (n) { return n === 'rol' || n === 'idrol' || n === 'rolid'; });
  if (colRol === -1) colRol = 4;

  const cambios = [];
  for (let i = 1; i < datos.length; i++) {
    const valor = datos[i][colRol];
    if (typeof valor === 'number' || valor === '' || valor === null || valor === undefined) continue;
    const texto = String(valor).trim();
    if (/^\d+$/.test(texto)) continue; // un número guardado como texto "2": también se normaliza abajo si hace falta
    const info = obtenerInfoRol_(texto);
    cambios.push({ fila: i + 1, de: texto, a: info.id });
  }

  cambios.forEach(function (c) {
    Logger.log((aplicar === true ? 'CAMBIADO ' : 'cambiaría ') + 'fila ' + c.fila + ': "' + c.de + '" → ' + c.a);
    if (aplicar === true) hoja.getRange(c.fila, colRol + 1).setValue(c.a);
  });
  if (aplicar === true && cambios.length) invalidarCacheUsuarios_();

  Logger.log((aplicar === true ? 'Listo: ' : 'Simulación: ') + cambios.length + ' fila(s) ' + (aplicar === true ? 'cambiadas.' : 'cambiarían. Ejecuta normalizarRolesDeUsuariosAplicar para aplicarlas.'));
  return { success: true, aplicado: aplicar === true, cambios: cambios };
}

/** Atajo para el editor (el menú "Ejecutar" no permite pasar argumentos): aplica la normalización. */
function normalizarRolesDeUsuariosAplicar() {
  return normalizarRolesDeUsuarios(true);
}
