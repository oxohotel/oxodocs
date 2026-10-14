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
