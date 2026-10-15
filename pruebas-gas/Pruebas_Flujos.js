/**
 * Flujos de punta a punta con servicios REALES (hojas, caché, candados, hash de contraseñas, ContentService) y los correos capturados.
 */
function registrarPruebasFlujos_() {
  suite_('Flujos reales', function () {

    prueba_('registro → verificación → aprobación por propiedad → inicio de sesión (con hash real)', function () {
      const email = correoPrueba_('flujo');
      afirmar_(registrarUsuario('Persona Flujo', email, 'Clave1234!', ['H1', 'H2']).success === true, 'registro');
      const codigo = hojaDePrueba_('Verificacion_Email').getDataRange().getValues().filter(function (f) { return String(f[2]) === email; }).pop()[3];
      afirmar_(verificarCodigoRegistro(email, codigo).success === true, 'verificación');
      afirmar_(CORREOS_CAPTURADOS_.some(function (c) { return /Nueva solicitud/.test(c.asunto); }), 'debe haberse capturado el aviso a los aprobadores');

      let f = filaDeUsuarioPrueba_(email);
      afirmarIgual_(f.Estado, 'Pendiente_Aprobacion', 'estado tras verificar');
      afirmar_(validarCredenciales(email, 'Clave1234!').success === false, 'sin aprobar no puede iniciar sesión');

      // El administrador de Distrito (token real) aprueba solo lo suyo; el de 84DC deniega lo suyo
      const r1 = resolverSolicitudesUsuario(f.ID_Usuario, ['H1'], [], tokenDePrueba_(2), '2');
      afirmar_(r1.success === true, 'Distrito aprueba: ' + (r1.message || ''));
      nuevaEjecucion_();
      const r2 = resolverSolicitudesUsuario(f.ID_Usuario, [], ['H2'], tokenDePrueba_(3), '3');
      afirmar_(r2.success === true, '84DC deniega: ' + (r2.message || ''));

      f = filaDeUsuarioPrueba_(email);
      afirmarIgual_([f.Estado, String(f.Hoteles_Permitidos), String(f.Hoteles_Solicitados)], ['Activo', 'H1', ''], 'estado final: activo, solo Distrito, nada pendiente');
      afirmar_(CORREOS_CAPTURADOS_.some(function (c) { return c.para === email; }), 'la persona debe haber recibido (capturado) su correo');

      nuevaEjecucion_();
      const login = validarCredenciales(email, 'Clave1234!');
      afirmar_(login.success === true && login.user && login.user.token, 'ya activa, el inicio de sesión funciona: ' + (login.message || ''));
      afirmar_(validarCredenciales(email, 'otra-clave').success === false, 'una contraseña incorrecta se rechaza');

      nuevaEjecucion_();
      const vista = obtenerModulosConHoteles(login.user.token, String(f.ID_Usuario)).map(function (m) { return m.hoteles.map(function (h) { return h.nombre; }); }).reduce(function (a, b) { return a.concat(b); }, []);
      afirmarIgual_(vista, ['Distrito'], 'lo que ve en el sistema: solo Distrito');
    }, { soloReal: true });

    prueba_('el token de sesión sigue valiendo cuando el caché lo pierde (se recupera de la hoja Sesiones)', function () {
      const token = tokenDePrueba_(5);
      afirmar_(obtenerUsuarioPorToken(token) !== null, 'con caché');
      CacheService.getScriptCache().remove('session_' + token);
      const info = obtenerUsuarioPorToken(token);
      afirmar_(info && String(info.idUsuario) === '5', 'sin caché debe recuperarse desde la hoja Sesiones');
      afirmar_(CacheService.getScriptCache().get('session_' + token) !== null, 'y debe volver a quedar en el caché');
      afirmar_(obtenerUsuarioPorToken('token-inventado') === null, 'un token inventado no vale');
    }, { soloReal: true });

    prueba_('pedir acceso adicional con token real: queda pendiente, el administrador la ve y la aprueba', function () {
      const token = tokenDePrueba_(5); // Usuario Normal, con Distrito
      const r = solicitarAccesoPropiedades(token, ['H2', 'H3']);
      afirmar_(r.success === true, 'la solicitud debe aceptarse: ' + (r.message || ''));
      afirmar_(CORREOS_CAPTURADOS_.some(function (c) { return /adicional/i.test(c.asunto); }), 'debe avisar a los administradores');
      afirmarIgual_(String(filaDeUsuarioPrueba_('normal@pruebas.oxo').Hoteles_Solicitados), 'H2,H3', 'solicitadas');

      nuevaEjecucion_();
      const lista = obtenerUsuariosParaGestion(tokenDePrueba_(3), '3').usuarios;
      const normal = lista.filter(function (u) { return u.email === 'normal@pruebas.oxo'; })[0];
      afirmar_(normal && normal.solo_solicitud === true, 'el administrador de 84DC la ve (solo por la solicitud)');
      nuevaEjecucion_();
      afirmar_(resolverSolicitudesUsuario('5', ['H2'], [], tokenDePrueba_(3), '3').success === true, '84DC aprueba');
      afirmarIgual_(String(filaDeUsuarioPrueba_('normal@pruebas.oxo').Hoteles_Permitidos), 'H1,H2', 'accesos tras aprobar');
      nuevaEjecucion_();
      afirmar_(cancelarSolicitudesPropias(token, ['H3']).success === true, 'cancelar lo pendiente');
      afirmarIgual_(String(filaDeUsuarioPrueba_('normal@pruebas.oxo').Hoteles_Solicitados), '', 'nada pendiente');
    }, { soloReal: true });

    prueba_('doPost real: respeta la lista de acciones permitidas y serializa fechas', function () {
      const llamar = function (accion, args) {
        const salida = doPost({ postData: { contents: JSON.stringify({ action: accion, args: args || [] }) } });
        return JSON.parse(salida.getContent());
      };
      const ok = llamar('obtenerHotelesParaRegistro');
      afirmar_(ok.success === true && ok.data.hoteles.length === 5, 'una acción permitida responde (hoteles: ' + (ok.data && ok.data.hoteles.length) + ')');
      afirmar_(ok.data.hoteles.every(function (h) { return Object.keys(h).sort().join() === 'idHotel,modulo,nombre'; }), 'solo id, nombre y módulo (nada de Drive)');
      afirmar_(llamar('crearSesionUsuario_', [{ ID_Usuario: '1' }]).success === false, 'una función interna se rechaza');
      afirmar_(llamar('vaciarYRegenerarEstructura').success === false, 'una función destructiva no listada se rechaza');
      afirmar_(llamar('obtenerOAuthTokenPicker').success === false, 'el token de OAuth no se entrega');
      afirmar_(llamar('funcionQueNoExiste').success === false, 'una inexistente se rechaza igual');
    }, { soloReal: true });

    prueba_('un cambio hecho desde la app se ve al instante a través del caché real', function () {
      nuevaEjecucion_();
      afirmar_(obtenerRolDeUsuario_('5') === 1, 'rol inicial 1');
      cambiarRolUsuario('5', 2, tokenDePrueba_(1), '1');
      nuevaEjecucion_();
      afirmar_(obtenerRolDeUsuario_('5') === 2, 'tras cambiar el rol se ve de inmediato (fue ' + obtenerRolDeUsuario_('5') + ')');
      cambiarEstadoUsuario('5', 'Inactivo', tokenDePrueba_(1), '1');
      nuevaEjecucion_();
      afirmarIgual_(obtenerUsuariosLite_().usuarios.filter(function (u) { return u.id === '5'; })[0].estado, 'Inactivo', 'el estado nuevo se ve de inmediato');
    }, { soloReal: true });

    prueba_('obtenerDatosInicio con datos reales: igual que las funciones sueltas, con caché frío y caliente', function () {
      const token = tokenDePrueba_(5);
      nuevaEjecucion_();
      const frio = obtenerDatosInicio(token, '5');
      nuevaEjecucion_();
      const caliente = obtenerDatosInicio(token, '5');
      afirmarIgual_(caliente, frio, 'frío y caliente deben ser idénticos');
      nuevaEjecucion_();
      afirmarIgual_(caliente.modulos, obtenerModulosConHoteles(token, '5'), 'el módulo de hoteles coincide con la función suelta');
      afirmarIgual_(caliente.pendientes, contarPendientesAprobacion_(token, '5'), 'el contador coincide');
    }, { soloReal: true });

    prueba_('alcance por propiedad con hojas reales: cada administrador ve solo lo suyo', function () {
      registrarYVerificarPrueba_(['H1'], 'a');
      registrarYVerificarPrueba_(['H2'], 'b');
      nuevaEjecucion_();
      const vistoPor = function (idAdmin) {
        nuevaEjecucion_();
        return obtenerUsuariosParaGestion(tokenDePrueba_(idAdmin), String(idAdmin)).usuarios.filter(function (u) { return /^(a|b)\d+@/.test(u.email); }).map(function (u) { return u.email.charAt(0); }).sort().join();
      };
      afirmarIgual_(vistoPor(2), 'a', 'el administrador de Distrito ve la solicitud de Distrito');
      afirmarIgual_(vistoPor(3), 'b', 'el de 84DC ve la de 84DC');
      afirmarIgual_(vistoPor(4), 'a,b', 'el de TODOS ve las dos');
      afirmarIgual_(vistoPor(1), 'a,b', 'el superadmin ve las dos');
    }, { soloReal: true });

    prueba_('autorización por propiedad con hojas reales (búsqueda con TextFinder): carpetas, archivos y propiedades ajenas se rechazan', function () {
      const carpetas = hojaDePrueba_('Carpetas'), archivos = hojaDePrueba_('Archivos');
      vaciarHoja_(carpetas); vaciarHoja_(archivos);
      carpetas.getRange(2, 1, 3, 7).setValues([['C-1', 'H1', '', 'IT Distrito', 'd1', new Date(), ''], ['C-2', 'H2', '', 'IT 84DC', 'd2', new Date(), ''], ['C-3', 'H2', '', 'Sub 84DC', 'd3', new Date(), 'C-2']]);
      archivos.getRange(2, 1, 2, 13).setValues([['ARC-001', 'C-1', 'drive-1', 'a.pdf', 'pdf', 'PDF', 'Activo', 'x', 'application/pdf', 'u', new Date(), new Date(), new Date()], ['ARC-002', 'C-2', 'drive-2', 'b.pdf', 'pdf', 'PDF', 'Activo', 'x', 'application/pdf', 'u', new Date(), new Date(), new Date()]]);
      const filaNormal = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaNormal, 5).setValue(1);
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 8).setValue('H1');
      invalidarCacheUsuarios_();
      nuevaEjecucion_();

      const normal = '5', admin1 = '2', todos = '4', sa = '1';
      afirmarIgual_(verificarAccesoAObjetivo_('obtenerContenidoCarpeta', ['C-1'], normal), null, 'carpeta de su propiedad');
      afirmarIgual_(verificarAccesoAObjetivo_('obtenerContenidoCarpeta', ['C-2'], normal), 'No tienes acceso a esa propiedad', 'carpeta de otra propiedad');
      afirmarIgual_(verificarAccesoAObjetivo_('obtenerRutaCarpeta', ['C-3'], normal), 'No tienes acceso a esa propiedad', 'subcarpeta de otra propiedad');
      afirmarIgual_(verificarAccesoAObjetivo_('crearSubcarpeta', ['C-3', 'x'], todos), null, 'un administrador con TODOS entra a todas');
      afirmarIgual_(verificarAccesoAObjetivo_('renombrarArchivo', ['ARC-002', 'x'], normal), 'No tienes acceso a esa propiedad', 'archivo de otra propiedad');
      afirmarIgual_(verificarAccesoAObjetivo_('renombrarArchivo', ['ARC-001', 'x'], normal), null, 'archivo propio');
      afirmarIgual_(verificarAccesoAObjetivo_('eliminarArchivo', ['drive-2'], admin1), 'No tienes acceso a esa propiedad', 'por id de Drive, de otra propiedad');
      afirmarIgual_(verificarAccesoAObjetivo_('eliminarArchivo', ['drive-que-no-es-del-repositorio'], sa), 'Ese archivo no pertenece al repositorio', 'ni el superadmin manda a la papelera un archivo ajeno al repositorio');
      afirmarIgual_(verificarAccesoAObjetivo_('editarHotel', ['H2', 'x'], admin1), 'No tienes acceso a esa propiedad', 'editar una propiedad ajena');
      afirmarIgual_(verificarAccesoAObjetivo_('obtenerContenidoCarpeta', ['C-NO-EXISTE'], normal), null, 'una carpeta inexistente la resuelve la propia función');

      // Por la vía web real: la función no llega a ejecutarse
      const llamar = function (p) { return JSON.parse(doPost({ postData: { contents: JSON.stringify(p) } }).getContent()); };
      const ajena = llamar({ action: 'obtenerContenidoCarpeta', args: ['C-2', '1'], token: tokenDePrueba_(5) });
      afirmar_(ajena.success === true && ajena.data.success === false && /No tienes acceso/.test(ajena.data.message), 'doPost rechaza la carpeta ajena: ' + JSON.stringify(ajena).slice(0, 120));

      // Búsqueda filtrada
      nuevaEjecucion_();
      const b = buscarGlobal('a', '5');
      afirmar_(b.hoteles.every(function (h) { return h.idHotel === 'H1'; }) && b.carpetas.every(function (c) { return c.idHotel === 'H1'; }), 'buscarGlobal solo devuelve su propiedad: ' + JSON.stringify(b).slice(0, 140));
      nuevaEjecucion_();
      afirmar_(buscarGlobal('a', '1').hoteles.length >= 1, 'el superadministrador encuentra de todas');
    }, { soloReal: true });

    prueba_('doPost real: sin sesión no se ejecuta nada, la identidad la pone el servidor y una cuenta desactivada pierde el acceso', function () {
      const llamar = function (p) { return JSON.parse(doPost({ postData: { contents: JSON.stringify(p) } }).getContent()); };
      const token = tokenDePrueba_(5); // usuario normal
      // Parte de un estado conocido: otras pruebas pudieron dejar esta cuenta desactivada
      const filaNormal = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaNormal, 5).setValue(1);
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 8).setValue('H1');
      invalidarCacheUsuarios_();
      nuevaEjecucion_();

      const sinToken = llamar({ action: 'obtenerMisAccesos', args: ['5'] });
      afirmarIgual_(sinToken.codigo, 'SESION_INVALIDA', 'sin token se rechaza aunque se mande el id');
      afirmarIgual_(llamar({ action: 'obtenerDatosInicio', args: [null, '1', false], token: 'inventado' }).codigo, 'SESION_INVALIDA', 'con un token inventado se rechaza');

      const propio = llamar({ action: 'obtenerMisAccesos', args: [], token: token });
      afirmar_(propio.success === true && propio.data.success === true, 'con su token ve sus accesos: ' + JSON.stringify(propio).slice(0, 120));

      // Se hace pasar por el superadministrador (id 1) en los argumentos: el servidor lo ignora
      const falso = llamar({ action: 'obtenerUsuariosParaGestion', args: ['1', '1'], token: token });
      afirmar_(falso.success === true && falso.data.success === false, 'mandar el id del superadministrador no da sus permisos: ' + JSON.stringify(falso).slice(0, 120));

      // La bitácora queda a nombre de la sesión
      llamar({ action: 'registrarAuditoria', args: [{ usuarioId: '1', emailUsuario: 'sa@pruebas.oxo', tipo: 'Login', descripcion: 'firmada por otro', entidadAfectada: 'Usuarios' }], token: token });
      const ultima = hojaDePrueba_('Auditoria').getDataRange().getValues().pop();
      afirmarIgual_(String(ultima[1]), '5', 'la auditoría se registra con el usuario de la sesión (no con el id que mandó el navegador)');

      // Desactivar la cuenta le quita el acceso de inmediato aunque conserve su token
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Inactivo');
      invalidarCacheUsuarios_();
      nuevaEjecucion_();
      afirmarIgual_(llamar({ action: 'obtenerMisAccesos', args: [], token: token }).codigo, 'SESION_INVALIDA', 'cuenta desactivada: el mismo token deja de funcionar');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      invalidarCacheUsuarios_();

      // Las acciones públicas siguen sin sesión
      afirmar_(llamar({ action: 'obtenerVersionCacheGlobal', args: [] }).success === true, 'el ping sigue siendo público');
    }, { soloReal: true });
  });
}
