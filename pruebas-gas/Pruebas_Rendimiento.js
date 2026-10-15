/**
 * Línea base de rendimiento con servicios reales y volumen parecido al esperado (600 usuarios, decenas de hoteles).
 * Los tiempos se guardan como notas para compararlos entre corridas; las afirmaciones son holgadas (solo cazan regresiones grandes).
 */
function registrarPruebasRendimiento_() {
  suite_('Rendimiento real', function () {

    prueba_('obtenerDatosInicio con 600 usuarios: el caché caliente no lee ninguna hoja y no es más lento', function () {
      sembrarUsuariosMasivos_(600);
      const token = tokenDePrueba_(5);
      nuevaEjecucion_();
      const frio = medir_(function () { return obtenerDatosInicio(token, '5'); });
      nuevaEjecucion_();
      const lecturasAntes = _lecturasDeHoja_;
      const caliente = medir_(function () { return obtenerDatosInicio(token, '5'); });
      nota_('obtenerDatosInicio: frío ' + frio.ms + ' ms, caliente ' + caliente.ms + ' ms (lecturas de hoja en caliente: ' + (_lecturasDeHoja_ - lecturasAntes) + ')');
      afirmar_(_lecturasDeHoja_ - lecturasAntes === 0, 'en caliente no debe leerse ninguna hoja de usuarios/hoteles');
      afirmar_(caliente.ms <= frio.ms + 1500, 'caliente (' + caliente.ms + ' ms) no debe ser notablemente más lento que frío (' + frio.ms + ' ms)');
    }, { soloReal: true });

    prueba_('obtenerUsuariosParaGestion (superadmin) con 600 usuarios responde en tiempo razonable', function () {
      sembrarUsuariosMasivos_(600);
      const t = medir_(function () { return obtenerUsuariosParaGestion(tokenDePrueba_(1), '1'); });
      afirmar_(t.resultado.success === true && t.resultado.usuarios.length === 606, 'debe devolver los 606 usuarios (devolvió ' + (t.resultado.usuarios && t.resultado.usuarios.length) + ')');
      nota_('obtenerUsuariosParaGestion con 606 usuarios: ' + t.ms + ' ms');
      afirmar_(t.ms < 20000, 'no debe tardar más de 20 s (' + t.ms + ' ms)');
    }, { soloReal: true });

    prueba_('la escritura de auditoría cuesta lo mismo con 5 filas que con 3.000 (ya no relee la hoja)', function () {
      const hoja = hojaDePrueba_('Auditoria');
      const pequena = medir_(function () { registrarAuditoriaSimple_('1', 'PRUEBA', 'pocas filas', 'Usuario'); });
      asegurarFilas_(hoja, 3100);
      const filas = [];
      for (let i = 0; i < 3000; i++) filas.push([i + 10, 1, '', 'X', 'relleno', 'Usuario', new Date(), 'Exitosa']);
      hoja.getRange(3, 1, 3000, 8).setValues(filas);
      const grande = medir_(function () { registrarAuditoriaSimple_('1', 'PRUEBA', 'muchas filas', 'Usuario'); });
      nota_('auditoría: con pocas filas ' + pequena.ms + ' ms, con 3.000 filas ' + grande.ms + ' ms');
      afirmar_(grande.ms < pequena.ms * 6 + 1500, 'con 3.000 filas no debe costar mucho más (' + grande.ms + ' ms frente a ' + pequena.ms + ' ms)');
      const ultima = hoja.getRange(hoja.getLastRow(), 1).getValue();
      afirmar_(ultima === 3010, 'el ID siguiente debe continuar la numeración (fue ' + ultima + ')');
    }, { soloReal: true });

    prueba_('iniciar y cerrar sesión no dependen del tamaño de las hojas Usuarios (600) y Sesiones (4.000 filas)', function () {
      sembrarUsuariosMasivos_(600);
      const usuarios = hojaDePrueba_('Usuarios');
      const fila5 = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      usuarios.getRange(fila5, 4).setValue(calcularHashContrasenaConSalt_('Clave1234!'));
      const sesiones = hojaDePrueba_('Sesiones');
      asegurarFilas_(sesiones, 4100);
      const relleno = [];
      for (let i = 0; i < 4000; i++) relleno.push(['SES-' + i, 9, 'tokenviejo-' + i, new Date(), new Date(), 'Expirada']);
      sesiones.getRange(sesiones.getLastRow() + 1, 1, 4000, 6).setValues(relleno);
      nuevaEjecucion_();

      const entrada = medir_(function () { return validarCredenciales('normal@pruebas.oxo', 'Clave1234!'); });
      afirmar_(entrada.resultado.success === true && !!entrada.resultado.token, 'el inicio de sesión debía funcionar: ' + entrada.resultado.message);
      const token = entrada.resultado.token;
      const mala = validarCredenciales('normal@pruebas.oxo', 'otra');
      afirmar_(mala.success === false, 'una contraseña incorrecta debe rechazarse');
      afirmar_(validarCredenciales('NoExiste@pruebas.oxo', 'x').success === false, 'un correo inexistente debe rechazarse');

      CacheService.getScriptCache().remove('session_' + token);
      nuevaEjecucion_();
      const validar = medir_(function () { return obtenerUsuarioPorToken(token); });
      afirmar_(validar.resultado && String(validar.resultado.idUsuario) === '5', 'sin caché, el token debe validarse contra la hoja Sesiones');

      const cierre = medir_(function () { return cerrarSesionUsuario(token); });
      nuevaEjecucion_();
      CacheService.getScriptCache().remove('session_' + token);
      afirmar_(obtenerUsuarioPorToken(token) === null, 'tras cerrar sesión el token ya no debe valer');
      nota_('con 600 usuarios y 4.000 sesiones: iniciar sesión ' + entrada.ms + ' ms, validar token en hoja ' + validar.ms + ' ms, cerrar sesión ' + cierre.ms + ' ms');
      afirmar_(cierre.ms < 8000 && validar.ms < 8000, 'cerrar/validar no deben depender del tamaño de la hoja (' + cierre.ms + ' / ' + validar.ms + ' ms)');
    }, { soloReal: true });

    prueba_('limpiar sesiones: con 5.000 filas viejas y unas pocas vigentes se queda solo con lo útil, en bloque y rápido', function () {
      const sesiones = hojaDePrueba_('Sesiones');
      vaciarHoja_(sesiones);
      asegurarFilas_(sesiones, 5100);
      const dia = 24 * 60 * 60 * 1000, ahora = Date.now();
      const filas = [];
      for (let i = 0; i < 5000; i++) filas.push(['SES-V' + i, 9, 'viejo-' + i, new Date(ahora - 30 * dia), new Date(ahora - 29 * dia), i % 2 ? 'Cerrada' : 'Expirada']);
      filas.push(['SES-R1', 5, 'reciente-1', new Date(ahora - 2 * dia), new Date(ahora - 1 * dia), 'Expirada']);
      filas.push(['SES-A1', 5, 'vigente-1', new Date(ahora), new Date(ahora + dia), 'Activa']);
      filas.push(['SES-A2', 6, 'vigente-2', new Date(ahora), new Date(ahora + dia), 'Activa']);
      sesiones.getRange(2, 1, filas.length, 6).setValues(filas);
      nuevaEjecucion_();

      const t = medir_(function () { return limpiarSesionesEnHoja_(sesiones, 7); });
      afirmarIgual_(t.resultado.eliminadas, 5000, 'filas eliminadas');
      afirmarIgual_(t.resultado.conservadas, 3, 'filas conservadas');
      const quedan = sesiones.getDataRange().getValues();
      afirmarIgual_(quedan.length, 4, 'encabezado + 3 sesiones');
      afirmarIgual_(quedan.slice(1).map(function (f) { return f[0]; }).join(), 'SES-R1,SES-A1,SES-A2', 'quedan las recientes y vigentes, en orden');
      afirmar_(quedan[0][0] === 'ID_Sesion', 'el encabezado sigue intacto');
      nota_('limpiar 5.003 sesiones (eliminar 5.000): ' + t.ms + ' ms');
      afirmar_(t.ms < 30000, 'no debe tardar más de 30 s (' + t.ms + ' ms)');

      // Una sesión vigente sigue validándose tras la limpieza (token real, sin caché)
      const token = tokenDePrueba_(5);
      limpiarSesionesEnHoja_(sesiones, 7);
      CacheService.getScriptCache().remove('session_' + token);
      nuevaEjecucion_();
      afirmar_(obtenerUsuarioPorToken(token) !== null, 'una sesión recién creada sigue valiendo después de limpiar');
    }, { soloReal: true });

    prueba_('abrir una carpeta con 500 carpetas y 5.000 archivos: con caché no lee ninguna hoja y responde mucho más rápido', function () {
      const carpetas = hojaDePrueba_('Carpetas'), archivos = hojaDePrueba_('Archivos');
      vaciarHoja_(carpetas); vaciarHoja_(archivos);
      asegurarFilas_(carpetas, 600); asegurarFilas_(archivos, 5100);
      const colTamano = obtenerOAgregarColumna_(archivos, 'Tamaño_Bytes');
      const ahora = new Date();
      const filasCarpetas = [];
      for (let n = 1; n <= 500; n++) filasCarpetas.push(['C-' + n, 'H1', '', 'Carpeta ' + n, 'd-' + n, ahora, n > 20 ? 'C-' + (1 + (n % 20)) : '']);
      carpetas.getRange(2, 1, filasCarpetas.length, 7).setValues(filasCarpetas);
      const filasArchivos = [];
      for (let n = 1; n <= 5000; n++) {
        const f = ['ARC-' + n, 'C-' + (1 + (n % 500)), 'df-' + n, 'archivo ' + n + '.pdf', 'pdf', 'PDF', 'Activo', 'Persona', 'application/pdf', 'https://x/' + n, ahora, ahora, ahora];
        while (f.length < colTamano) f.push('');
        f[colTamano] = 1000 + n;
        filasArchivos.push(f);
      }
      archivos.getRange(2, 1, filasArchivos.length, colTamano + 1).setValues(filasArchivos);

      invalidarCacheArchivos_();
      nuevaEjecucion_();
      const frio = medir_(function () { return obtenerContenidoCarpeta('C-1', '1'); });
      afirmar_(frio.resultado.success === true && frio.resultado.archivos.length === 10, 'debe devolver los 10 archivos de la carpeta (devolvió ' + (frio.resultado.archivos && frio.resultado.archivos.length) + ')');
      nuevaEjecucion_();
      const lecturasAntes = _lecturasDeHoja_;
      const caliente = medir_(function () { return obtenerContenidoCarpeta('C-1', '1'); });
      afirmarIgual_(_lecturasDeHoja_ - lecturasAntes, 0, 'en caliente no debe leerse ninguna hoja');
      afirmarIgual_(JSON.stringify(caliente.resultado), JSON.stringify(frio.resultado), 'el resultado desde el caché es idéntico al de la lectura directa');
      nuevaEjecucion_();
      const otra = medir_(function () { return obtenerContenidoCarpeta('C-2', '1'); });
      nuevaEjecucion_();
      const areas = medir_(function () { return obtenerCarpetasDelHotel('H1', null, '1'); });
      nuevaEjecucion_();
      const areasCal = medir_(function () { return obtenerCarpetasDelHotel('H1', null, '1'); });
      nota_('abrir carpeta (500 carpetas, 5.000 archivos): sin caché ' + frio.ms + ' ms, con caché ' + caliente.ms + ' ms; otra carpeta (primera vez) ' + otra.ms + ' ms; áreas del hotel ' + areas.ms + ' → ' + areasCal.ms + ' ms');
      afirmar_(caliente.ms < frio.ms, 'con caché (' + caliente.ms + ' ms) debe ser más rápido que sin caché (' + frio.ms + ' ms)');
      afirmarIgual_(areasCal.resultado.carpetas.length, 20, 'las 20 áreas de primer nivel del hotel');

      // Invalidar de verdad: la siguiente apertura vuelve a leer las hojas (con el caché real de Google, no el simulado)
      invalidarCacheArchivos_();
      nuevaEjecucion_();
      const lecturasInv = _lecturasDeHoja_;
      obtenerContenidoCarpeta('C-1', '1');
      afirmar_(_lecturasDeHoja_ - lecturasInv > 0, 'tras invalidar se vuelven a leer las hojas (no se sirven datos viejos)');
    }, { soloReal: true });

    prueba_('tamaño real del caché de usuarios con 600 personas', function () {
      sembrarUsuariosMasivos_(600);
      nuevaEjecucion_();
      obtenerUsuariosLite_();
      const meta = JSON.parse(CacheService.getScriptCache().get('oxo:usuarios_lite'));
      nota_('600 usuarios → ' + meta.n + ' trozos de hasta ' + CACHE_TROZO_ + ' caracteres');
      afirmar_(meta.n <= 20, 'no debería necesitar más de 20 trozos (usa ' + meta.n + ')');
    }, { soloReal: true });
  });
}
