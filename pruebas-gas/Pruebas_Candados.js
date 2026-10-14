/**
 * Pruebas de LockService REAL. Dentro de una sola ejecución solo se puede comprobar el comportamiento básico y las "reglas de
 * uso" de nuestro código (¿se libera siempre?, ¿qué pasa si se anida?). La exclusión entre ejecuciones simultáneas se prueba con
 * herramientas/prueba-concurrencia.js, que lanza muchas llamadas en paralelo contra la web de este proyecto de pruebas.
 */
function registrarPruebasCandados_() {
  suite_('Candados reales', function () {

    prueba_('tomar, comprobar y soltar el candado de script', function () {
      const lock = LockService.getScriptLock();
      afirmar_(lock.tryLock(2000) === true, 'debe poder tomarse un candado libre');
      afirmar_(lock.hasLock() === true, 'hasLock debe ser true mientras se tiene');
      lock.releaseLock();
      afirmar_(lock.hasLock() === false, 'hasLock debe ser false tras soltarlo');
    }, { soloReal: true });

    prueba_('caracterización: segundo objeto de candado en la MISMA ejecución con el primero tomado', function () {
      const l1 = LockService.getScriptLock();
      const l2 = LockService.getScriptLock();
      l1.waitLock(2000);
      let resultado;
      try {
        if (l2.tryLock(500)) { resultado = 'lo obtiene (se comporta como reentrante)'; l2.releaseLock(); }
        else resultado = 'NO lo obtiene (no es reentrante)';
      } catch (e) {
        resultado = 'lanza: ' + e.message;
      } finally {
        l1.releaseLock();
      }
      nota_('tryLock del 2º objeto con el 1º tomado: ' + resultado);
    }, { soloReal: true });

    prueba_('caracterización: nuestras funciones con candado mientras la ejecución YA tiene el candado (anidado)', function () {
      // Si el candado no fuera reentrante, registrarUsuario (waitLock de 10 s) fallaría o esperaría: así se sabría que anidar es peligroso
      const lock = LockService.getScriptLock();
      lock.waitLock(2000);
      let r, ms;
      try {
        const t = medir_(function () { return registrarUsuario('Anidada', correoPrueba_('nid'), 'Clave1234!', ['H1']); });
        r = t.resultado; ms = t.ms;
      } finally {
        lock.releaseLock();
      }
      nota_('registrarUsuario con el candado ya tomado por la misma ejecución: ' + (r.success ? 'funcionó' : 'falló (' + r.message + ')') + ' en ' + ms + ' ms');
    }, { soloReal: true });

    prueba_('si una operación termina con error dentro del candado, el candado queda libre', function () {
      const f = registrarYVerificarPrueba_(['H1']);
      // Se desactiva la cuenta a mano: resolver ahora devuelve error DENTRO del candado
      hojaDePrueba_('Usuarios').getRange(f.fila, 6).setValue('Inactivo');
      invalidarCacheUsuarios_();
      const r = resolverSolicitudesUsuario(f.ID_Usuario, ['H1'], [], tokenDePrueba_(2), '2');
      afirmar_(r.success === false, 'resolver una cuenta inactiva debe fallar');
      const lock = LockService.getScriptLock();
      afirmar_(lock.tryLock(1000) === true, 'el candado debe haber quedado libre tras el error');
      lock.releaseLock();
    }, { soloReal: true });

    prueba_('registrarActividad no toma el candado en cada registro (solo al recortar)', function () {
      const lock = LockService.getScriptLock();
      lock.waitLock(2000);
      try {
        // Con el candado tomado por esta ejecución, registrar (sin recortar) debe responder al instante: no espera candado
        const t = medir_(function () { return registrarActividad('1', 'Hotel', 'H1', 'Abrir'); });
        afirmar_(t.resultado.success === true, 'debe funcionar');
        nota_('registrarActividad con el candado tomado: ' + t.ms + ' ms');
        afirmar_(t.ms < 5000, 'no debe quedarse esperando el candado (' + t.ms + ' ms)');
      } finally {
        lock.releaseLock();
      }
    }, { soloReal: true });
  });
}
