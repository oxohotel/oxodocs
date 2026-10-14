/**
 * Pruebas del caché y del calentamiento contra CacheService REAL.
 * Lo que un simulador no puede comprobar: el límite real de tamaño, cómo cuenta los bytes, la expiración real, getAll con claves
 * ausentes y el efecto de los disparadores reales.
 */
function registrarPruebasCache_() {
  suite_('Caché real', function () {

    prueba_('un valor de más de 100 KB se rechaza (límite real de CacheService)', function () {
      const cache = CacheService.getScriptCache();
      afirmarLanza_(function () { cache.put('oxo-prueba:grande', new Array(100 * 1024 + 50).join('a'), 30); }, 'un valor de más de 100 KB debe rechazarse');
    }, { soloReal: true });

    prueba_('un trozo de CACHE_TROZO_ caracteres de 3 bytes (peor caso con símbolos) cabe y vuelve idéntico', function () {
      const cache = CacheService.getScriptCache();
      const texto = new Array(CACHE_TROZO_ + 1).join('€'); // 3 bytes por carácter en UTF-8
      cache.put('oxo-prueba:trozo', texto, 30);
      afirmar_(cache.get('oxo-prueba:trozo') === texto, 'el trozo debe volver idéntico');

      // Caracterización: ¿el límite de 100 KB cuenta bytes o caracteres?
      let cuenta = 'caracteres';
      try { cache.put('oxo-prueba:trozo2', new Array(40001).join('€'), 30); } catch (e) { cuenta = 'bytes'; }
      nota_('el límite de 100 KB cuenta ' + cuenta + ' (40.000 "€" = 120.000 bytes); trozo actual = ' + CACHE_TROZO_ + ' caracteres');
      cache.removeAll(['oxo-prueba:trozo', 'oxo-prueba:trozo2']);
    }, { soloReal: true });

    prueba_('getAll devuelve solo las claves presentes (las ausentes no aparecen)', function () {
      const cache = CacheService.getScriptCache();
      cache.put('oxo-prueba:a', '1', 30);
      const r = cache.getAll(['oxo-prueba:a', 'oxo-prueba:no-existe']);
      afirmarIgual_(Object.keys(r), ['oxo-prueba:a'], 'getAll solo debe traer la clave que existe');
      cache.remove('oxo-prueba:a');
    }, { soloReal: true });

    prueba_('un valor con TTL de 1 segundo expira de verdad', function () {
      const cache = CacheService.getScriptCache();
      cache.put('oxo-prueba:ttl', 'x', 1);
      Utilities.sleep(2500);
      afirmar_(cache.get('oxo-prueba:ttl') === null, 'debía haber expirado tras 2,5 s');
    }, { soloReal: true });

    prueba_('800 usuarios con tildes: ida y vuelta por el caché real, idénticos y sin releer la hoja', function () {
      sembrarUsuariosMasivos_(800);
      nuevaEjecucion_();
      const frio = obtenerUsuariosLite_();
      afirmar_(_lecturasDeHoja_ === 1, 'la primera lectura va a la hoja una vez (lecturas: ' + _lecturasDeHoja_ + ')');
      afirmar_(frio.usuarios.length === 806, 'se esperaban 806 usuarios y hay ' + frio.usuarios.length);

      const meta = JSON.parse(CacheService.getScriptCache().get('oxo:usuarios_lite'));
      nota_('800 usuarios ocupan ' + meta.n + ' trozos de ' + CACHE_TROZO_ + ' caracteres');
      afirmar_(meta.n >= 2, 'con 800 usuarios debe haber varios trozos');

      nuevaEjecucion_();
      const caliente = obtenerUsuariosLite_();
      afirmar_(_lecturasDeHoja_ === 0, 'la segunda lectura sale del caché (lecturas: ' + _lecturasDeHoja_ + ')');
      afirmarIgual_(caliente, frio, 'lo del caché debe ser idéntico a lo leído de la hoja');
    }, { soloReal: true });

    prueba_('si se pierde un trozo, se vuelve a leer la hoja y se rehace el caché', function () {
      sembrarUsuariosMasivos_(800);
      nuevaEjecucion_(); obtenerUsuariosLite_();
      const cache = CacheService.getScriptCache();
      const meta = JSON.parse(cache.get('oxo:usuarios_lite'));
      cache.remove('oxo:usuarios_lite:' + meta.sello + ':1');
      nuevaEjecucion_();
      const r = obtenerUsuariosLite_();
      afirmar_(_lecturasDeHoja_ === 1 && r.usuarios.length === 806, 'con un trozo perdido debe releer la hoja (lecturas: ' + _lecturasDeHoja_ + ')');
    }, { soloReal: true });

    prueba_('una lectura vieja no se guarda si hubo una invalidación en medio (contador de generación)', function () {
      const gen = cacheGeneracion_();
      invalidarCacheUsuarios_();
      cacheGuardar_('prueba_gen', { x: 1 }, 30, gen);
      nuevaEjecucion_();
      afirmar_(cacheObtener_('prueba_gen') === undefined, 'la lectura vieja no debe haberse guardado');
      afirmar_(cacheGeneracion_() !== gen, 'la invalidación debió cambiar la generación');
    }, { soloReal: true });

    prueba_('invalidar borra el caché y la siguiente lectura va a la hoja (con cambios hechos desde otra "ejecución")', function () {
      nuevaEjecucion_(); obtenerUsuariosLite_();
      const hoja = hojaDePrueba_('Usuarios');
      hoja.getRange(7, 6).setValue('Inactivo');          // cambio directo en la hoja: el caché aún no lo sabe
      nuevaEjecucion_();
      afirmar_(obtenerUsuariosLite_().usuarios[5].estado === 'Activo', 'mientras no se invalide, el caché sigue con lo anterior');
      invalidarCacheUsuarios_();
      nuevaEjecucion_();
      afirmar_(obtenerUsuariosLite_().usuarios[5].estado === 'Inactivo', 'tras invalidar se ve el cambio');
    }, { soloReal: true });

    prueba_('refrescarCachesForzado_ solo actúa una vez por minuto', function () {
      afirmar_(refrescarCachesForzado_() === true, 'la primera vez actúa');
      afirmar_(refrescarCachesForzado_() === false, 'la segunda, dentro del minuto, se ignora');
    }, { soloReal: true });

    prueba_('hojas con fechas: mismos resultados con el caché frío y caliente (Date → texto al guardar)', function () {
      nuevaEjecucion_();
      const frio = obtenerModulosConHoteles(null, '5');
      nuevaEjecucion_();
      const caliente = obtenerModulosConHoteles(null, '5');
      afirmarIgual_(caliente, frio, 'el resultado debe ser idéntico con caché frío y caliente');
      afirmar_(_lecturasDeHoja_ === 0, 'en caliente no se lee ninguna hoja');
    }, { soloReal: true });

    prueba_('instalar y desinstalar el calentamiento deja UN solo disparador real y luego ninguno', function () {
      const contar = function () { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'calentarCaches'; }).length; };
      try {
        desinstalarCalentamientoCaches();
        instalarCalentamientoCaches();
        instalarCalentamientoCaches();
        afirmar_(contar() === 1, 'instalar dos veces debe dejar un solo disparador (hay ' + contar() + ')');
      } finally {
        desinstalarCalentamientoCaches();
      }
      afirmar_(contar() === 0, 'desinstalar debe quitarlo');
    }, { soloReal: true });

    prueba_('calentarCaches llena usuarios, hoteles y módulos y deja la marca de calentamiento activo', function () {
      const r = calentarCaches();
      afirmar_(r.success === true, 'calentarCaches debe terminar bien');
      const cache = CacheService.getScriptCache();
      afirmar_(cache.get('oxo:usuarios_lite') !== null && cache.get('oxo:hoja_Hoteles') !== null && cache.get('oxo:hoja_Modulos') !== null, 'las tres entradas deben estar en el caché');
      afirmar_(cache.get('oxo:calentado') === '1', 'debe quedar la marca de calentamiento');
    }, { soloReal: true });
  });
}
