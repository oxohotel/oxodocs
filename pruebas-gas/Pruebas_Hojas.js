/**
 * Pruebas contra SpreadsheetApp REAL: tipos que devuelve Sheets, límites de la cuadrícula, borrado en bloque y escritura de filas.
 */
function registrarPruebasHojas_() {
  suite_('Hojas reales', function () {

    prueba_('Sheets devuelve un nombre numérico (2026) como número y nuestro código lo entrega como texto', function () {
      const hoja = hojaDePrueba_('Carpetas');
      escribirFilas_(hoja, [
        ['C-AREA', 'H1', 1, 'Área de prueba', 'carpeta-x', new Date(), ''],
        ['C-2026', 'H1', 2, 2026, 'carpeta-y', new Date(), 'C-AREA']
      ]);
      nuevaEjecucion_();
      const crudo = hoja.getRange(3, 4).getValue();
      afirmar_(typeof crudo === 'number', 'Sheets debe entregar 2026 como número (fue ' + typeof crudo + ')');

      nuevaEjecucion_();
      const r = obtenerContenidoCarpeta('C-AREA', '5');
      afirmar_(r.success === true, 'obtenerContenidoCarpeta debe funcionar: ' + (r.message || ''));
      afirmar_(r.subcarpetas.length === 1, 'debe haber una subcarpeta');
      afirmar_(typeof r.subcarpetas[0].nombre === 'string' && r.subcarpetas[0].nombre === '2026', 'el nombre debe llegar como texto "2026" (llegó ' + JSON.stringify(r.subcarpetas[0].nombre) + ')');
    }, { soloReal: true });

    prueba_('agregar una columna cuando la hoja NO tiene columnas libres (obtenerOAgregarColumna_)', function () {
      const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
      const hoja = ss.insertSheet('Temp_Columnas_' + sufijoUnico_());
      try {
        hoja.appendRow(['A', 'B', 'C']);
        if (hoja.getMaxColumns() > 3) hoja.deleteColumns(4, hoja.getMaxColumns() - 3);
        afirmar_(hoja.getMaxColumns() === 3, 'la hoja debe quedar con exactamente 3 columnas');
        let idx;
        try { idx = obtenerOAgregarColumna_(hoja, 'Nueva'); }
        catch (e) { throw new Error('obtenerOAgregarColumna_ falla cuando no hay columnas libres: ' + e.message); }
        afirmar_(idx === 3, 'la columna nueva debe ser la índice 3 (fue ' + idx + ')');
        afirmar_(hoja.getRange(1, 4).getValue() === 'Nueva', 'el encabezado debe quedar escrito');
      } finally {
        ss.deleteSheet(hoja);
      }
    }, { soloReal: true });

    prueba_('appendRow con una fila más ancha que la hoja: la hoja se amplía (caracterización)', function () {
      const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
      const hoja = ss.insertSheet('Temp_Ancho_' + sufijoUnico_());
      try {
        hoja.appendRow(['A', 'B', 'C']);
        if (hoja.getMaxColumns() > 3) hoja.deleteColumns(4, hoja.getMaxColumns() - 3);
        let resultado = 'se amplió sola';
        try { hoja.appendRow(['1', '2', '3', '4', '5']); } catch (e) { resultado = 'lanzó: ' + e.message; }
        nota_('appendRow de 5 valores en una hoja de 3 columnas: ' + resultado + ' (columnas ahora: ' + hoja.getMaxColumns() + ')');
        afirmar_(resultado === 'se amplió sola', 'appendRow debería ampliar la hoja; ' + resultado);
      } finally {
        ss.deleteSheet(hoja);
      }
    }, { soloReal: true });

    prueba_('escribir con setValues más allá de las filas de la hoja (caracterización)', function () {
      const ss = SpreadsheetApp.openById(DRIVE_CONFIG.SPREADSHEET_ID);
      const hoja = ss.insertSheet('Temp_Filas_' + sufijoUnico_());
      try {
        hoja.appendRow(['A']);
        const filas = hoja.getMaxRows() + 50;
        const valores = []; for (let i = 0; i < filas; i++) valores.push([i]);
        let resultado = 'se amplió sola';
        try { hoja.getRange(1, 1, filas, 1).setValues(valores); } catch (e) { resultado = 'lanzó: ' + e.message; }
        nota_('setValues de ' + filas + ' filas sobre ' + (filas - 50) + ' disponibles: ' + resultado);
        // Lo que importa para nosotros: sembrar y recortar con muchas filas funciona con asegurarFilas_ (ver el siguiente test)
      } finally {
        ss.deleteSheet(hoja);
      }
    }, { soloReal: true });

    prueba_('getLastRow tras vaciar: queda solo el encabezado', function () {
      const hoja = hojaDePrueba_('Auditoria');
      registrarAuditoriaSimple_('1', 'PRUEBA', 'x', 'Usuario');
      afirmar_(hoja.getLastRow() === 2, 'tras una auditoría debe haber 2 filas (hay ' + hoja.getLastRow() + ')');
      vaciarHoja_(hoja);
      afirmar_(hoja.getLastRow() === 1, 'tras vaciar debe quedar 1 fila (hay ' + hoja.getLastRow() + ')');
    }, { soloReal: true });

    prueba_('IDs de auditoría consecutivos con la hoja real, sin releerla entera', function () {
      registrarAuditoriaSimple_('1', 'PRUEBA', 'uno', 'Usuario');
      registrarAuditoriaSimple_('1', 'PRUEBA', 'dos', 'Usuario');
      registrarAuditoria({ usuarioId: 1, emailUsuario: 'sa@pruebas.oxo', tipo: 'Login', descripcion: 'tres', entidadAfectada: 'Usuario' });
      const ids = hojaDePrueba_('Auditoria').getDataRange().getValues().slice(1).map(function (f) { return f[0]; });
      afirmarIgual_(ids, [1, 2, 3], 'los IDs deben ser 1, 2 y 3');
    }, { soloReal: true });

    prueba_('recorte de Actividad_Reciente con miles de filas: deleteRows en bloque, encabezado intacto', function () {
      const hoja = hojaDePrueba_('Actividad_Reciente');
      const n = ACTIVIDAD_LIMITE_FILAS + 5;
      asegurarFilas_(hoja, n + 5);
      const filas = [];
      for (let i = 0; i < n; i++) filas.push(['ACT-' + i, '1', 'Hotel', 'H' + (i % 5), 'Abrir', new Date()]);
      hoja.getRange(2, 1, n, 6).setValues(filas);

      const t = medir_(function () { return registrarActividad('1', 'Hotel', 'H1', 'Abrir'); });
      afirmar_(t.resultado.success === true, 'registrarActividad debe funcionar');
      const quedan = hoja.getLastRow() - 1;
      nota_('recorte con ' + n + ' filas: ' + t.ms + ' ms; quedaron ' + quedan);
      afirmar_(quedan <= ACTIVIDAD_LIMITE_FILAS - ACTIVIDAD_HOLGURA_FILAS + 2, 'debe haber recortado hasta cerca de ' + (ACTIVIDAD_LIMITE_FILAS - ACTIVIDAD_HOLGURA_FILAS) + ' (quedaron ' + quedan + ')');
      afirmar_(hoja.getRange(1, 1).getValue() === 'ID_Actividad', 'el encabezado debe seguir intacto');
      afirmar_(String(hoja.getRange(hoja.getLastRow(), 4).getValue()) === 'H1', 'la última fila debe ser la más reciente');
    }, { soloReal: true });

    prueba_('registrarUsuario sobre la hoja real: fila completa, rol numérico y columna Hoteles_Solicitados creada', function () {
      const email = correoPrueba_('reg');
      const r = registrarUsuario('Ñandú Pérez', email, 'Clave1234!', ['H1', 'H4']);
      afirmar_(r.success === true, 'el registro debe funcionar: ' + (r.message || ''));
      const f = filaDeUsuarioPrueba_(email);
      afirmar_(f.Rol === 1 && typeof f.Rol === 'number', 'el rol debe guardarse como número 1 (es ' + JSON.stringify(f.Rol) + ')');
      afirmar_(f.Estado === 'Pendiente_Verificacion', 'estado inicial incorrecto: ' + f.Estado);
      afirmar_(f.Nombre_Completo === 'Ñandú Pérez', 'la ñ y las tildes deben viajar intactas');
      afirmarIgual_(String(f.Hoteles_Solicitados), 'H1,H4', 'propiedades solicitadas');
      afirmar_(CORREOS_CAPTURADOS_.length === 1 && /verificación/.test(CORREOS_CAPTURADOS_[0].asunto), 'debe haberse "enviado" (capturado) el correo del código, y no más');
    }, { soloReal: true });

    prueba_('un correo ya registrado se rechaza y no deja filas de más', function () {
      const email = correoPrueba_('dup');
      afirmar_(registrarUsuario('Una', email, 'Clave1234!', ['H1']).success === true, 'el primero funciona');
      const antes = hojaDePrueba_('Usuarios').getLastRow();
      const r2 = registrarUsuario('Otra', email, 'Clave1234!', ['H1']);
      afirmar_(r2.success === false && /ya está registrado/.test(r2.message), 'el duplicado debe rechazarse');
      afirmar_(hojaDePrueba_('Usuarios').getLastRow() === antes, 'no debe quedar una fila de más');
    }, { soloReal: true });
  });
}
