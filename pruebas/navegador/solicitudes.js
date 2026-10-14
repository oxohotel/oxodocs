const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

const USUARIOS = [
  { id: '101', nombre: 'Ana Pérez', email: 'ana@oxohotel.com', rol: 'Usuario', rol_id: 1, estado: 'Pendiente_Aprobacion', hoteles_permitidos: '', hoteles_lista: [], solo_solicitud: true,
    solicitudes: [{ idHotel: 'H1', nombre: 'Distrito', puedeResolver: true }, { idHotel: 'H2', nombre: '84DC', puedeResolver: false }] },
  { id: '102', nombre: 'Carl Soto', email: 'carl@oxohotel.com', rol: 'Usuario', rol_id: 1, estado: 'Activo', hoteles_permitidos: 'H1', hoteles_lista: ['Distrito'], solo_solicitud: false,
    solicitudes: [{ idHotel: 'H2', nombre: '84DC', puedeResolver: true }] },
  { id: '103', nombre: 'Legacy Sin Hotel', email: 'legacy@oxohotel.com', rol: 'Usuario', rol_id: 1, estado: 'Pendiente_Aprobacion', hoteles_permitidos: '', hoteles_lista: [], solo_solicitud: false, solicitudes: [] },
  { id: '105', nombre: 'Multi Prop', email: 'multi@oxohotel.com', rol: 'Usuario', rol_id: 1, estado: 'Pendiente_Aprobacion', hoteles_permitidos: '', hoteles_lista: [], solo_solicitud: false,
    solicitudes: [{ idHotel: 'H1', nombre: 'Distrito', puedeResolver: true }, { idHotel: 'H2', nombre: '84DC', puedeResolver: true }] },
  { id: '104', nombre: 'Zed Cerrado', email: 'zed@oxohotel.com', rol: 'Usuario', rol_id: 1, estado: 'Solicitud_Cerrada', hoteles_permitidos: '', hoteles_lista: [], solo_solicitud: false, solicitudes: [] }
];

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errores = []; let llamadas = []; let propiedadesFallan = false; let pendientesInicio = 2;

  async function nuevaPagina() {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 950 });
    await page.setRequestInterception(true);
    page.on('pageerror', e => errores.push(e.message));
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
      if (/script\.google\.com\/macros/.test(u)) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        const b = JSON.parse(req.postData() || '{}'); llamadas.push({ a: b.action, args: b.args });
        const resp = o => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(o) });
        let data;
        if (b.action === 'obtenerHotelesParaRegistro') {
          if (propiedadesFallan) return resp({ success: false, message: 'caído' });
          data = { success: true, hoteles: [{ idHotel: 'H1', nombre: 'Distrito', modulo: 'Hoteles en operación' }, { idHotel: 'H2', nombre: '84DC', modulo: 'Hoteles en operación' }, { idHotel: 'H4', nombre: 'Pop Art Tocancipá', modulo: 'Hoteles en pre-apertura' }, { idHotel: 'H5', nombre: 'Hotel Futuro', modulo: 'Hoteles en desarrollo' }, { idHotel: 'HC', nombre: 'Corporativo', modulo: 'Corporativo' }] };
        }
        else if (b.action === 'registrarUsuario') data = { success: true, message: 'Te enviamos un código', userId: 9, requiereVerificacion: true };
        else if (b.action === 'obtenerDatosInicio') { const a = b.args || []; data = { modulos: responder('obtenerModulosConHoteles', a), idsFavoritos: responder('obtenerIdsFavoritosUsuario', [a[1]]), actividad: responder('obtenerActividadReciente', [a[1], 4]), favoritos: responder('obtenerFavoritosDetallados', [a[1]]), pendientes: pendientesInicio }; }
        else if (b.action === 'obtenerUsuariosParaGestion') data = { success: true, usuarios: USUARIOS };
        else if (b.action === 'resolverSolicitudesUsuario') data = { success: true, message: 'Aprobado: Distrito. Quedan pendientes 1 propiedad(es) de otros administradores' };
        else if (b.action === 'cerrarSolicitudUsuario') data = { success: true, message: 'La solicitud quedó cerrada' };
        else if (b.action === 'aprobarUsuario') data = { success: true, message: 'Aprobado: Distrito' };
        else data = b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []);
        return resp({ success: true, data });
      }
      if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
    return page;
  }
  const cuenta = a => llamadas.filter(l => l.a === a).length;

  // ================= A. Registro con varias propiedades
  let page = await nuevaPagina();
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  ok(cuenta('obtenerHotelesParaRegistro') === 0, 'A. al abrir la página NO se pide la lista de propiedades (solo cuando se abre el registro)');
  await page.evaluate(() => switchForm('register')); await dormir(900);
  const items = await page.evaluate(() => [...document.querySelectorAll('#registerHoteles .propiedad-item')].map(e => e.innerText.trim()));
  ok(items.join() === 'Distrito,84DC,Pop Art Tocancipá,Hotel Futuro,Corporativo', 'A1. se muestran las propiedades como casillas → ' + items.join(', '));
  // ---- Agrupación por tipo
  const grupos = await page.evaluate(() => [...document.querySelectorAll('#registerHoteles .propiedades-grupo')].map(e => e.textContent));
  ok(grupos.join() === 'Hoteles en operación,Hoteles en pre-apertura,Hoteles en desarrollo,Corporativo', 'A1a. la lista se agrupa por tipo con su encabezado → ' + grupos.join(' / '));
  // ---- Buscador de propiedades
  const visiblesLista = () => page.evaluate(() => [...document.querySelectorAll('#registerHoteles .propiedad-item')].filter(e => !e.hidden).map(e => e.innerText.trim()));
  ok(await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); return !b.hidden && b.offsetParent !== null; }), 'A1b. aparece un buscador sobre la lista de propiedades');
  await page.type('#registerHotelesBuscar', 'dist'); await dormir(150);
  ok((await visiblesLista()).join() === 'Distrito', 'A1c. escribir "dist" deja solo Distrito → ' + (await visiblesLista()).join());
  await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); b.value = 'TOCANCIPA'; b.dispatchEvent(new Event('input')); }); await dormir(150);
  ok((await visiblesLista()).join() === 'Pop Art Tocancipá', 'A1d. la búsqueda ignora mayúsculas y tildes ("TOCANCIPA" encuentra "Tocancipá")');
  ok(await page.evaluate(() => [...document.querySelectorAll('#registerHoteles .propiedades-grupo')].filter(e => !e.hidden).map(e => e.textContent).join() === 'Hoteles en pre-apertura'), 'A1d-b. al buscar solo queda visible el encabezado del grupo que tiene resultados');
  await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); b.value = 'zzz'; b.dispatchEvent(new Event('input')); }); await dormir(150);
  ok((await visiblesLista()).length === 0 && await page.evaluate(() => /Ninguna propiedad coincide/.test(document.getElementById('registerHoteles').innerText)), 'A1e. sin coincidencias se avisa');
  await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); b.value = ''; b.dispatchEvent(new Event('input')); }); await dormir(150);
  ok((await visiblesLista()).length === 5 && !(await page.evaluate(() => !!document.querySelector('.propiedades-sin-resultados'))) && await page.evaluate(() => [...document.querySelectorAll('#registerHoteles .propiedades-grupo')].every(e => !e.hidden)), 'A1f. al borrar la búsqueda vuelven todas y todos los encabezados');
  await page.evaluate(() => document.querySelector('#registerHoteles input[value="H4"]').click()); await dormir(100);
  await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); b.value = 'dist'; b.dispatchEvent(new Event('input')); }); await dormir(150);
  ok(await page.evaluate(() => /1 seleccionada/.test(document.getElementById('registerHotelesContador').textContent)) && await page.evaluate(() => document.querySelector('#registerHoteles input[value="H4"]').checked), 'A1g. una propiedad marcada sigue marcada (y contada) aunque la búsqueda la oculte');
  await page.evaluate(() => document.querySelector('#registerHoteles input[value="H4"]').click());
  await page.evaluate(() => { const b = document.getElementById('registerHotelesBuscar'); b.value = ''; b.dispatchEvent(new Event('input')); }); await dormir(100);
  ok(await page.evaluate(() => document.getElementById('registerHotelesContador').textContent === ''), 'A1h. sin selección el contador desaparece');
  await page.type('#registerName', 'Persona Prueba'); await page.type('#registerEmail', 'prueba@oxohotel.com');
  await page.type('#registerPassword', 'Clave1234!'); await page.type('#registerPasswordConfirm', 'Clave1234!');
  await page.evaluate(() => document.querySelector('#registerHoteles input[value="H1"]').click()); await page.evaluate(() => document.querySelector('#registerHoteles input[value="H2"]').click());
  await page.screenshot({ path: CAPTURAS + '/registro-propiedades.png' });
  await page.evaluate(() => document.querySelectorAll('#registerHoteles input:checked').forEach(c => c.click()));
  llamadas = [];
  await page.evaluate(() => document.getElementById('registerForm').requestSubmit()); await dormir(600);
  ok(cuenta('registrarUsuario') === 0 && await page.evaluate(() => /Elige al menos una propiedad/.test(document.getElementById('registerHotelesError').textContent)), 'A2. sin elegir ninguna propiedad no se envía y se pide elegir al menos una');
  await page.evaluate(() => { document.querySelector('#registerHoteles input[value="H1"]').click(); document.querySelector('#registerHoteles input[value="H2"]').click(); }); await dormir(100);
  await page.evaluate(() => document.getElementById('registerForm').requestSubmit()); await dormir(1200);
  const reg = llamadas.find(l => l.a === 'registrarUsuario');
  ok(reg && Array.isArray(reg.args[3]) && reg.args[3].join() === 'H1,H2', 'A3. con Distrito y 84DC marcadas se envían las dos al servidor → ' + (reg ? JSON.stringify(reg.args[3]) : '(no se envió)'));
  ok(await page.evaluate(() => !!document.getElementById('inputCodigoVerificacion')), 'A4. después del registro se abre el panel del código de verificación');
  ok(await page.evaluate(() => document.querySelectorAll('#registerHoteles input:checked').length === 0), 'A5. el formulario queda limpio (sin casillas marcadas)');
  await page.close();

  // Si la lista no carga, no se bloquea el registro
  propiedadesFallan = true; llamadas = [];
  page = await nuevaPagina(); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.evaluate(() => switchForm('register')); await dormir(900);
  ok(await page.evaluate(() => /No se pudo cargar la lista/.test(document.getElementById('registerHoteles').innerText) && !!document.getElementById('reintentarPropiedades')), 'A6. si la lista no carga se avisa y se ofrece reintentar');
  await page.type('#registerName', 'Persona Prueba'); await page.type('#registerEmail', 'prueba2@oxohotel.com');
  await page.type('#registerPassword', 'Clave1234!'); await page.type('#registerPasswordConfirm', 'Clave1234!');
  await page.evaluate(() => document.getElementById('registerForm').requestSubmit()); await dormir(1200);
  ok(cuenta('registrarUsuario') === 1, 'A7. aun así se puede registrar (sin propiedades; un administrador la resuelve)');
  propiedadesFallan = false;
  await page.evaluate(() => document.getElementById('reintentarPropiedades') && document.getElementById('reintentarPropiedades').click()); await dormir(800);
  ok(await page.evaluate(() => document.querySelectorAll('#registerHoteles .propiedad-item').length === 5), 'A8. al reintentar, la lista aparece');
  await page.close();

  // ================= B. Pantalla de Usuarios con solicitudes por propiedad
  llamadas = [];
  page = await nuevaPagina();
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
  await page.reload({ waitUntil: 'networkidle2' }); await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1200);
  const insignia = () => page.evaluate(() => { const b = document.querySelector('#navUsuarios .sidebar-badge-pendientes'); return b ? b.textContent : null; });
  ok(await insignia() === '2', 'B1. el menú muestra la insignia con las solicitudes pendientes que trae el servidor → ' + await insignia());

  await page.evaluate(() => document.getElementById('navUsuarios').click());
  await page.waitForSelector('.usuario-fila', { visible: true }); await dormir(600);
  const fila = id => `.usuario-fila[data-id-usuario="${id}"]`;
  const tiene = (id, sel) => page.evaluate((f, s) => !!document.querySelector(f + ' ' + s), fila(id), sel);
  ok(await insignia() === '4', 'B2. al abrir Usuarios la insignia se ajusta a lo que hay en la lista (4)');

  // Ana: la ves solo por la solicitud de TU propiedad
  ok(!(await tiene('101', '.btn-reset-pass')) && !(await tiene('101', '.usuario-rol-select')) && !(await tiene('101', '.btn-toggle-estado')), 'B3. una persona visible solo por su solicitud NO muestra restablecer contraseña, cambio de rol ni desactivar');
  const anaChips = await page.evaluate(f => [...document.querySelectorAll(f + ' .solicitud-item')].map(e => ({ texto: e.innerText.replace(/\s+/g, ' ').trim(), botones: e.querySelectorAll('button').length, ajena: e.classList.contains('ajena'), icono: !!e.querySelector('svg') })), fila('101'));
  ok(anaChips.length === 2 && anaChips[0].texto === 'Distrito' && !anaChips[0].ajena && anaChips[1].texto === '84DC' && anaChips[1].ajena && anaChips.every(c => c.botones === 0 && c.icono), 'B4. lo que solicita se ve como etiquetas con icono de propiedad, sin botones (la tuya resaltada, la de otro administrador atenuada) → ' + JSON.stringify(anaChips.map(c => c.texto)));
  ok(await tiene('101', '.usuario-acciones-celda .btn-solicitud-aprobar svg') && await tiene('101', '.usuario-acciones-celda .btn-solicitud-denegar svg'), 'B5. aprobar y denegar son botones de icono en la columna de acciones');
  ok(await page.evaluate(f => { const c = document.querySelector(f); return !/✓|✕/.test(c.innerText) && !document.querySelector(f + ' .btn-aprobar-usuario'); }, fila('101')), 'B5b. ya no hay ✓/✕ ni un segundo botón "Aprobar": un solo camino para aprobar');
  ok(await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-denegar').title, fila('101')) === 'Cerrar solicitud (la persona podrá volver a registrarse)', 'B5c. en una cuenta pendiente el icono de denegar es "Cerrar solicitud"');

  // Carl: ya activo, con una propiedad pendiente que te toca
  ok(await tiene('102', '.btn-reset-pass') && await tiene('102', '.btn-solicitud-aprobar') && await tiene('102', '.btn-solicitud-denegar'), 'B6. una cuenta activa con una solicitud tuya pendiente conserva sus acciones normales y suma aprobar/denegar');
  ok(await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-denegar').title, fila('102')) === 'Denegar solicitudes pendientes', 'B7. en una cuenta activa el icono dice "Denegar solicitudes pendientes"');
  // Registro antiguo y cuenta cerrada
  ok(await tiene('103', '.btn-solicitud-aprobar') && await tiene('103', '.btn-solicitud-denegar'), 'B8. un registro sin propiedades pedidas se puede aprobar o cerrar');
  ok(await page.evaluate(f => /Solicitud cerrada/.test(document.querySelector(f).innerText) && !document.querySelector(f + ' .btn-solicitud-aprobar') && !document.querySelector(f + ' .btn-solicitud-denegar'), fila('104')), 'B9. una solicitud ya cerrada se muestra como "Solicitud cerrada", sin botones de aprobar ni cerrar');
  await page.screenshot({ path: CAPTURAS + '/usuarios-solicitudes-limpia.png' });

  // Aprobar con UNA propiedad tuya -> confirmación simple
  llamadas = [];
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-aprobar').click(), fila('101')); await dormir(300);
  const textoConfirmacion = await page.evaluate(() => document.getElementById('confirmacionGenericaMensaje').textContent);
  ok(/Distrito/.test(textoConfirmacion) && /Ana/.test(textoConfirmacion) && !(await page.evaluate(() => document.getElementById('panelLateralOverlay') && document.getElementById('panelLateralOverlay').classList.contains('active'))), 'B10. con una sola propiedad tuya se pide confirmación diciendo cuál → "' + textoConfirmacion + '"');
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(900);
  const llamadaAprobar = llamadas.find(l => l.a === 'resolverSolicitudesUsuario');
  ok(llamadaAprobar && llamadaAprobar.args[0] === '101' && JSON.stringify(llamadaAprobar.args[1]) === '["H1"]' && JSON.stringify(llamadaAprobar.args[2]) === '[]', 'B11. se envía aprobar solo H1 (84DC es de otro administrador y no se toca) → ' + JSON.stringify(llamadaAprobar && llamadaAprobar.args.slice(0, 3)));
  ok(await page.evaluate(() => /Quedan pendientes/.test(document.body.innerText)) && cuenta('obtenerUsuariosParaGestion') >= 1, 'B12. se muestra el resultado del servidor y la lista se vuelve a cargar');

  // Denegar una cuenta activa con una propiedad pendiente
  llamadas = [];
  await page.waitForSelector('.usuario-fila', { visible: true });
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-denegar').click(), fila('102')); await dormir(300);
  ok(await page.evaluate(() => /Denegar el acceso a 84DC a Carl/.test(document.getElementById('confirmacionGenericaMensaje').textContent)), 'B13. denegar pide confirmación con el texto correcto');
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(700);
  const llamadaDenegar = llamadas.find(l => l.a === 'resolverSolicitudesUsuario');
  ok(llamadaDenegar && JSON.stringify(llamadaDenegar.args[1]) === '[]' && JSON.stringify(llamadaDenegar.args[2]) === '["H2"]', 'B14. se envía denegar H2 → ' + JSON.stringify(llamadaDenegar && llamadaDenegar.args.slice(1, 3)));

  // Registro antiguo: cerrar solicitud
  llamadas = [];
  await page.waitForSelector('.usuario-fila', { visible: true });
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-denegar').click(), fila('103')); await dormir(300);
  ok(await page.evaluate(() => /volver a registrarse/.test(document.getElementById('confirmacionGenericaMensaje').textContent)), 'B15. cerrar una solicitud avisa que la persona podrá volver a registrarse');
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(700);
  ok(llamadas.find(l => l.a === 'cerrarSolicitudUsuario') && llamadas.find(l => l.a === 'cerrarSolicitudUsuario').args[0] === '103', 'B16. se envía el cierre de esa solicitud');

  // Registro antiguo: aprobar
  llamadas = [];
  await page.waitForSelector('.usuario-fila', { visible: true });
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-aprobar').click(), fila('103')); await dormir(300);
  ok(await page.evaluate(() => /sin hoteles asignados/.test(document.getElementById('confirmacionGenericaMensaje').textContent)), 'B17. aprobar un registro antiguo avisa que queda sin hoteles');
  await page.evaluate(() => document.getElementById('confirmacionGenericaCancelar').click()); await dormir(200);

  // Dos propiedades tuyas -> panel lateral con casillas
  llamadas = [];
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-aprobar').click(), fila('105')); await dormir(400);
  const panel = await page.evaluate(() => ({
    abierto: document.getElementById('panelLateralOverlay').classList.contains('active'),
    titulo: document.getElementById('panelLateralTitulo').textContent,
    casillas: [...document.querySelectorAll('#panelSolicitudLista input')].map(c => c.nextElementSibling.textContent + ':' + c.checked)
  }));
  ok(panel.abierto && panel.titulo === 'Aprobar acceso' && panel.casillas.join() === 'Distrito:true,84DC:true', 'B18. con dos propiedades tuyas se abre un panel con una casilla por propiedad, todas marcadas → ' + panel.casillas.join(', '));
  await page.evaluate(() => document.querySelector('#panelSolicitudLista input[value="H2"]').click());
  await page.evaluate(() => document.getElementById('btnPanelSolicitudConfirmar').click()); await dormir(900);
  const llamadaPanel = llamadas.find(l => l.a === 'resolverSolicitudesUsuario');
  ok(llamadaPanel && JSON.stringify(llamadaPanel.args[1]) === '["H1"]' && JSON.stringify(llamadaPanel.args[2]) === '[]', 'B19. desmarcando 84DC solo se aprueba Distrito → ' + JSON.stringify(llamadaPanel && llamadaPanel.args.slice(1, 3)));
  ok(await page.evaluate(() => !document.getElementById('panelLateralOverlay').classList.contains('active')), 'B19b. al terminar el panel se cierra');

  // Panel de denegar: sin ninguna marcada no se envía
  llamadas = [];
  await page.waitForSelector('.usuario-fila', { visible: true });
  await page.evaluate(f => document.querySelector(f + ' .btn-solicitud-denegar').click(), fila('105')); await dormir(400);
  ok(await page.evaluate(() => document.getElementById('panelLateralTitulo').textContent === 'Denegar solicitud'), 'B20. el icono de denegar abre el panel de denegar');
  await page.evaluate(() => document.querySelectorAll('#panelSolicitudLista input').forEach(c => c.click()));
  await page.evaluate(() => document.getElementById('btnPanelSolicitudConfirmar').click()); await dormir(400);
  ok(cuenta('resolverSolicitudesUsuario') === 0 && await page.evaluate(() => /al menos una propiedad/.test(document.body.innerText)), 'B21. sin ninguna propiedad marcada no se envía nada y se pide elegir');
  await page.evaluate(() => document.querySelector('#panelSolicitudLista input[value="H1"]').click());
  await page.evaluate(() => document.getElementById('btnPanelSolicitudConfirmar').click()); await dormir(900);
  const llamadaPanel2 = llamadas.find(l => l.a === 'resolverSolicitudesUsuario');
  ok(llamadaPanel2 && JSON.stringify(llamadaPanel2.args[1]) === '[]' && JSON.stringify(llamadaPanel2.args[2]) === '["H1"]', 'B22. marcando Distrito y confirmando se deniega solo Distrito');

  await page.screenshot({ path: CAPTURAS + '/usuarios-solicitudes.png' });
  await page.evaluate(() => document.getElementById('navInicio').click()); await dormir(300);
  pendientesInicio = null; llamadas = [];
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(2200);
  ok(await insignia() === null, 'B18. si el servidor dice que no gestionas usuarios (null), la insignia desaparece');
  pendientesInicio = 4;
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(2200);
  ok(await insignia() === '4', 'B19. al recargar el sistema la insignia se actualiza con el nuevo número (4)');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
