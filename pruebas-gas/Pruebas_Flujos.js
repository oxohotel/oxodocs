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

    prueba_('copia de seguridad real: copia la hoja de pruebas en Drive, la verifica y se puede borrar', function () {
      const r = respaldarHojas();
      afirmar_(r.success === true, 'la copia debía hacerse: ' + (r.message || ''));
      const copia = DriveApp.getFileById(r.id);
      try {
        afirmar_(copia.getName().indexOf('OXO Docs - Respaldo ') === 0, 'nombre con el prefijo de las copias: ' + copia.getName());
        const carpeta = carpetaDeRespaldos_();
        afirmar_(/PRUEBAS/.test(carpeta.getName()), 'la carpeta de las copias de PRUEBAS está separada de la de producción: ' + carpeta.getName());
        const ssCopia = SpreadsheetApp.openById(r.id);
        const ssOrigen = obtenerSpreadsheet_();
        afirmarIgual_(ssCopia.getSheets().length, ssOrigen.getSheets().length, 'misma cantidad de pestañas');
        afirmarIgual_(ssCopia.getSheetByName('Usuarios').getLastRow(), ssOrigen.getSheetByName('Usuarios').getLastRow(), 'mismas filas en Usuarios');
        const estado = leerEstadoRespaldo_();
        afirmarIgual_(estado.ultimoId, r.id, 'el estado recuerda la última copia');
        nota_('copia de la hoja de pruebas: ' + r.ms + ' ms (' + ssCopia.getSheets().length + ' pestañas); copias guardadas: ' + r.conservadas);
      } finally {
        copia.setTrashed(true); // la prueba deja la carpeta limpia
      }
    }, { soloReal: true });

    prueba_('privacidad de un archivo ya publicado (real): quien lo subió y un administrador pueden cambiarla; otra persona, no', function () {
      const carpetas = hojaDePrueba_('Carpetas'), archivos = hojaDePrueba_('Archivos'), permisos = hojaDePrueba_('Permisos_Archivos');
      vaciarHoja_(carpetas); vaciarHoja_(archivos); vaciarHoja_(permisos);
      permisos.getRange(1, 1, 1, 6).setValues([ENCABEZADOS_PRUEBA_.Permisos_Archivos]); // la pestaña pudo crearse sin encabezado en una corrida anterior
      carpetas.getRange(2, 1, 1, 7).setValues([['C-P1', 'H1', '', 'IT Distrito', 'd1', new Date(), '']]);
      archivos.getRange(2, 1, 2, 13).setValues([
        ['ARC-P1', 'C-P1', 'drive-p1', 'a.pdf', 'pdf', 'PDF', 'Activo', 'Usuario Normal', 'application/pdf', 'u', new Date(), new Date(), new Date()],
        ['ARC-P2', 'C-P1', 'drive-p2', 'b.pdf', 'pdf', 'PDF', 'Activo', 'Sistema', 'application/pdf', 'u', new Date(), new Date(), new Date()]]);
      const filaNormal = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaNormal, 5).setValue(1);
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 8).setValue('H1');
      const filaSin = filaDeUsuarioPrueba_('sinhoteles@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaSin, 8).setValue('H1');
      invalidarCacheUsuarios_(); invalidarCacheArchivos_(); nuevaEjecucion_();

      const llamar = function (p) { nuevaEjecucion_(); return JSON.parse(doPost({ postData: { contents: JSON.stringify(p) } }).getContent()); };
      const t5 = tokenDePrueba_(5), t6 = tokenDePrueba_(6), t2 = tokenDePrueba_(2);

      afirmarIgual_(llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: t5 }).data.restringidos.length, 0, 'sin restricciones al principio');
      const guardar = llamar({ action: 'actualizarPermisosExistentes', args: ['ARC-P1', null, ['2', '6']], token: t5 });
      afirmar_(guardar.success === true && guardar.data.success === true, 'quien lo subió (usuario normal) puede cambiar la privacidad de su archivo: ' + JSON.stringify(guardar).slice(0, 160));
      afirmarIgual_(llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: t5 }).data.restringidos.sort().join(), '2,6', 'queda guardado y se lee de vuelta');
      afirmarIgual_(permisos.getDataRange().getValues().length - 1, 2, 'dos filas de restricción en la hoja');

      const ajena = llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: t6 });
      afirmar_(ajena.data && ajena.data.success === false, 'otra persona que no lo subió ni es administradora no puede ni consultarlo: ' + JSON.stringify(ajena).slice(0, 140));
      const intento = llamar({ action: 'actualizarPermisosExistentes', args: ['ARC-P1', null, []], token: t6 });
      afirmar_(intento.data && intento.data.success === false, 'ni cambiarlo');
      afirmarIgual_(llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: t5 }).data.restringidos.length, 2, 'el intento ajeno no cambió nada');

      const admin = llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: t2 });
      afirmar_(admin.data && admin.data.success === false, 'un administrador (rol 2) que no lo subió NO puede: la privacidad es de quien lo subió o de un Superadministrador');
      const adminCambia = llamar({ action: 'actualizarPermisosExistentes', args: ['ARC-P1', null, []], token: t2 });
      afirmar_(adminCambia.data && adminCambia.data.success === false, 'ni cambiarla');
      const superadmin = llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P1'], token: tokenDePrueba_(1) });
      afirmar_(superadmin.data.success === true && superadmin.data.restringidos.length === 2, 'un Superadministrador sí');
      const sistema = llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P2'], token: t5 });
      afirmar_(sistema.data && sistema.data.success === false, '"Sistema" no es comodín: un usuario normal no gestiona un archivo sin responsable real');
      afirmar_(llamar({ action: 'obtenerPermisosDeArchivo', args: ['ARC-P2'], token: tokenDePrueba_(1) }).data.success === true, 'un Superadministrador sí gestiona un archivo sin responsable real');

      const quitar = llamar({ action: 'actualizarPermisosExistentes', args: ['ARC-P1', null, []], token: t5 });
      afirmar_(quitar.data.success === true, 'volver a "Todos" levanta las restricciones');
      afirmarIgual_(permisos.getDataRange().getValues().length - 1, 0, 'no quedan filas de restricción');
    }, { soloReal: true });

    prueba_('avisos de la campana (real): audiencias, programación, vistos y caché con hojas y caché reales', function () {
      const avisos = hojaDePrueba_('Avisos'), vistos = hojaDePrueba_('Avisos_Vistos');
      [avisos, vistos].forEach(vaciarHoja_);
      [avisos, vistos].forEach(function (h, i) { const enc = ENCABEZADOS_PRUEBA_[i === 0 ? 'Avisos' : 'Avisos_Vistos']; h.getRange(1, 1, 1, enc.length).setValues([enc]); });
      const filaNormal = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaNormal, 5).setValue(1);
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 8).setValue('H1');
      invalidarCacheUsuarios_(); invalidarCacheArchivos_(); nuevaEjecucion_();

      const ahora = Date.now(), HORA = 3600000;
      const crear = function (extra) {
        nuevaEjecucion_();
        const v = validarDatosDeAviso_(Object.assign({ titulo: 'T', mensaje: 'M', audiencia: { tipo: 'todos' } }, extra), Date.now());
        afirmar_(!v.error, 'datos de prueba válidos: ' + v.error);
        return guardarAviso_(v.aviso, { id: '1', nombre: 'Superadmin Prueba' });
      };
      const de = function (id) { nuevaEjecucion_(); return obtenerAvisos(String(id)); };
      const titulos = function (r) { return r.avisos.map(function (a) { return a.titulo; }).sort().join('|'); };

      crear({ titulo: 'Para todos' });
      crear({ titulo: 'Solo roles 2 y 3', audiencia: { tipo: 'roles', roles: [2, 3] } });
      crear({ titulo: 'Solo H2', audiencia: { tipo: 'propiedades', propiedades: ['H2'] } });
      crear({ titulo: 'Solo la 5', audiencia: { tipo: 'personas', personas: ['5'] } });
      crear({ titulo: 'Futuro', programadoPara: new Date(ahora + 2 * HORA).toISOString() });
      crear({ titulo: 'Caduca mañana', caducaEn: new Date(ahora + 24 * HORA).toISOString() });
      crear({ titulo: 'Ya caducó', programadoPara: new Date(ahora - 3 * HORA).toISOString(), caducaEn: new Date(ahora - 2 * HORA).toISOString() });

      afirmarIgual_(titulos(de(5)), 'Caduca mañana|Para todos|Solo la 5', 'persona 5 (Distrito): lo de todos, lo suyo y lo que caduca mañana; no lo futuro ni lo caducado');
      afirmarIgual_(titulos(de(5)), 'Caduca mañana|Para todos|Solo la 5', 'y lo mismo en una segunda lectura, ya desde el caché real (las fechas ausentes no se vuelven 0)');
      afirmarIgual_(titulos(de(6)), 'Caduca mañana|Para todos', 'persona sin propiedades');
      afirmarIgual_(titulos(de(3)), 'Caduca mañana|Para todos|Solo H2|Solo roles 2 y 3', 'administrador de 84DC: roles 2/3 y su propiedad');
      afirmarIgual_(titulos(de(1)), 'Caduca mañana|Para todos|Solo H2|Solo roles 2 y 3', 'superadministrador: todas las propiedades, no lo dirigido a la persona 5');

      afirmarIgual_(de(5).noLeidos, 3, 'tres no leídos');
      nuevaEjecucion_(); afirmarIgual_(marcarAvisosVistos('5').success, true, 'marcar como vistos');
      afirmarIgual_(de(5).noLeidos, 0, 'ya no hay no leídos');
      afirmarIgual_(de(6).noLeidos, 2, 'para otra persona siguen siendo no leídos');
      CacheService.getScriptCache().remove('oxo:avv:5');
      afirmarIgual_(de(5).noLeidos, 0, 'lo visto se recuerda desde la hoja aunque se pierda el caché');
      nuevaEjecucion_(); marcarAvisosVistos('5'); nuevaEjecucion_(); marcarAvisosVistos('5');
      afirmarIgual_(vistos.getDataRange().getValues().filter(function (f) { return String(f[0]) === '5'; }).length, 1, 'una sola fila por persona');

      // Por la vía web real
      const llamar = function (p) { nuevaEjecucion_(); return JSON.parse(doPost({ postData: { contents: JSON.stringify(p) } }).getContent()); };
      const web = llamar({ action: 'obtenerAvisos', args: ['1'], token: tokenDePrueba_(5) });
      afirmar_(web.success === true && web.data.avisos.length === 3, 'doPost con el token de la persona 5 trae sus 3 avisos aunque el navegador pida el id del superadministrador: ' + JSON.stringify(web).slice(0, 120));
      afirmarIgual_(llamar({ action: 'obtenerAvisos', args: ['5'] }).codigo, 'SESION_INVALIDA', 'sin sesión se rechaza');
    }, { soloReal: true });

    prueba_('gestión de avisos (real): solo el superadministrador crea, edita y cancela; la lista cuenta destinatarios y vistos', function () {
      const avisos = hojaDePrueba_('Avisos'), vistos = hojaDePrueba_('Avisos_Vistos');
      [avisos, vistos].forEach(vaciarHoja_);
      [avisos, vistos].forEach(function (h, i) { const enc = ENCABEZADOS_PRUEBA_[i === 0 ? 'Avisos' : 'Avisos_Vistos']; h.getRange(1, 1, 1, enc.length).setValues([enc]); });
      const filaNormal = filaDeUsuarioPrueba_('normal@pruebas.oxo').fila;
      hojaDePrueba_('Usuarios').getRange(filaNormal, 5).setValue(1);
      hojaDePrueba_('Usuarios').getRange(filaNormal, 6).setValue('Activo');
      hojaDePrueba_('Usuarios').getRange(filaNormal, 8).setValue('H1');
      invalidarCacheUsuarios_(); invalidarCacheArchivos_(); nuevaEjecucion_();
      const llamar = function (p) { nuevaEjecucion_(); return JSON.parse(doPost({ postData: { contents: JSON.stringify(p) } }).getContent()); };
      const t1 = tokenDePrueba_(1), t2 = tokenDePrueba_(2), t5 = tokenDePrueba_(5);
      const datos = { titulo: 'Comunicado real', mensaje: 'Texto', enlaces: [{ texto: 'Sitio', tipo: 'url', url: 'https://example.com' }], audiencia: { tipo: 'todos' } };

      afirmar_(llamar({ action: 'crearAviso', args: [datos], token: t2 }).data.success === false, 'un administrador (rol 2) no puede crear avisos');
      afirmar_(llamar({ action: 'crearAviso', args: [datos], token: t5 }).data.success === false, 'ni un usuario normal');
      afirmarIgual_(avisos.getLastRow(), 1, 'los intentos no autorizados no escribieron nada');

      const creado = llamar({ action: 'crearAviso', args: [datos], token: t1 });
      afirmar_(creado.data.success === true && creado.data.message === 'Aviso enviado', 'el superadministrador crea y envía: ' + JSON.stringify(creado.data));
      const prog = llamar({ action: 'crearAviso', args: [Object.assign({}, datos, { titulo: 'Programado real', programadoPara: new Date(Date.now() + 3600000).toISOString(), audiencia: { tipo: 'personas', personas: ['5'] } })], token: t1 });
      afirmar_(prog.data.success === true && prog.data.message === 'Aviso programado', 'uno programado para dentro de una hora');
      afirmarIgual_(llamar({ action: 'obtenerAvisos', args: [], token: t5 }).data.avisos.map(function (x) { return x.titulo; }).join(), 'Comunicado real', 'la persona 5 solo ve el ya enviado');

      llamar({ action: 'marcarAvisosVistos', args: [], token: t5 });
      const gestion = llamar({ action: 'obtenerAvisosGestion', args: [], token: t1 });
      afirmar_(gestion.data.success === true && gestion.data.avisos.length === 2, 'la lista de gestión trae los 2 avisos');
      const real = gestion.data.avisos.filter(function (x) { return x.titulo === 'Comunicado real'; })[0];
      const progr = gestion.data.avisos.filter(function (x) { return x.titulo === 'Programado real'; })[0];
      afirmarIgual_(real.estado, 'Enviado', 'estado enviado');
      afirmarIgual_(progr.estado, 'Programado', 'estado programado');
      afirmar_(real.destinatarios >= 6 && real.vistos === 1, 'a cuántas personas llegó (' + real.destinatarios + ') y cuántas lo vieron (' + real.vistos + ')');
      afirmarIgual_(progr.destinatarios, 1, 'el dirigido a la persona 5 llega a 1');
      afirmar_(llamar({ action: 'obtenerAvisosGestion', args: [], token: t2 }).data.success === false, 'un administrador no ve la lista de gestión');

      const edit = llamar({ action: 'editarAviso', args: [progr.id, Object.assign({}, datos, { titulo: 'Programado editado', programadoPara: new Date(Date.now() + 7200000).toISOString() })], token: t1 });
      afirmar_(edit.data.success === true, 'se edita el programado: ' + JSON.stringify(edit.data));
      afirmar_(llamar({ action: 'editarAviso', args: [real.id, datos], token: t1 }).data.message.indexOf('ya fue enviado') !== -1, 'uno ya enviado no se edita');
      afirmar_(llamar({ action: 'cancelarAviso', args: [real.id], token: t2 }).data.success === false, 'un administrador no puede cancelar');
      afirmar_(llamar({ action: 'cancelarAviso', args: [real.id], token: t1 }).data.success === true, 'el superadministrador cancela');
      afirmarIgual_(llamar({ action: 'obtenerAvisos', args: [], token: t5 }).data.avisos.length, 0, 'tras cancelarlo ya no se ve');
      const auditoria = hojaDePrueba_('Auditoria').getDataRange().getValues().map(function (f) { return f[3]; });
      afirmar_(auditoria.indexOf('AVISO_CREADO') !== -1 && auditoria.indexOf('AVISO_EDITADO') !== -1 && auditoria.indexOf('AVISO_CANCELADO') !== -1, 'crear, editar y cancelar quedan en la auditoría');
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
