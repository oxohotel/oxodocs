const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  let llamadas = []; let lentoMs = 0; let limitarRefresco = false;
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}'); llamadas.push({ a: b.action, args: b.args, r: b.refrescar });
      let data;
      if (b.action === 'obtenerDatosInicio') { const a = b.args || []; data = { modulos: responder('obtenerModulosConHoteles', a), idsFavoritos: responder('obtenerIdsFavoritosUsuario', [a[1]]), actividad: responder('obtenerActividadReciente', [a[1], 4]), favoritos: responder('obtenerFavoritosDetallados', [a[1]]) }; if (a[2] === true) data.refrescoForzado = !limitarRefresco; }
      else if (b.action === 'crearArea') data = { success: true };
      else data = b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []);
      const demora = b.action === 'crearArea' ? 3000 : (/^obtener/.test(b.action) ? lentoMs : 0);
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1500);
  const cuenta = a => llamadas.filter(l => l.a === a).length;
  const estado = () => page.evaluate(() => ({
    girando: document.getElementById('btnRecargar').classList.contains('girando'),
    deshabilitado: document.getElementById('btnRecargar').disabled,
    sidebarPulsa: document.getElementById('homeSidebar').classList.contains('recargando'),
    skeletonsWidgets: document.querySelectorAll('[data-widget-skeleton]:not(.oculto)').length
  }));
  const volverAInicio = async () => { await page.evaluate(() => document.getElementById('navInicio').click()); await dormir(300); };

  // ---- 1. El botón existe en la navbar, junto al buscador y las notificaciones
  ok(await page.evaluate(() => { const b = document.getElementById('btnRecargar'); return !!b && !!b.closest('.home-navbar .navbar-actions') && b.getAttribute('aria-label') === 'Recargar sistema' && b.offsetParent !== null; }), '1. el botón "Recargar sistema" está en la navbar, visible, junto al resto de acciones globales');

  // ---- 2. En Inicio: esqueletos + datos frescos
  lentoMs = 1500; llamadas = [];
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(300);
  const durante = await estado();
  ok(durante.girando && durante.deshabilitado && durante.sidebarPulsa && durante.skeletonsWidgets > 0, '2. al pulsar: el icono gira, el botón se bloquea, el menú late y los widgets muestran su esqueleto → ' + JSON.stringify(durante));
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await page.evaluate(() => document.getElementById('btnRecargar').click());
  await dormir(2600);
  const despues = await estado();
  ok(cuenta('obtenerDatosInicio') === 1, '2b. pulsar varias veces seguidas solo dispara UNA recarga (obtenerDatosInicio × ' + cuenta('obtenerDatosInicio') + ')');
  const llamadaInicio = llamadas.find(l => l.a === 'obtenerDatosInicio');
  ok(llamadaInicio && llamadaInicio.args[2] === true, '2c. le pide al servidor el refresco forzado (tercer argumento = true)');
  ok(!despues.girando && !despues.deshabilitado && !despues.sidebarPulsa && despues.skeletonsWidgets === 0, '2d. al llegar los datos todo vuelve a la normalidad (sin esqueletos) → ' + JSON.stringify(despues));
  ok(await page.evaluate(() => document.querySelectorAll('.btn-hotel-carpetas').length > 0 && document.querySelector('#seccionRecientes [data-widget-contenido] > *') !== null), '2e. menú de hoteles y widgets repintados con datos');
  ok(await page.evaluate(() => /Datos actualizados/.test(document.body.innerText)), '2f. aparece el aviso "Datos actualizados"');
  lentoMs = 0;

  // ---- 3. Vista de áreas de un hotel
  await page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click());
  await page.waitForSelector('.carpeta-card', { visible: true }); await dormir(500);
  lentoMs = 1500; llamadas = [];
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(400);
  const esq = await page.evaluate(() => document.querySelectorAll('.home-content .hotel-carpetas-container #carpetasGrid .carpeta-skeleton').length);
  ok(esq > 0 && cuenta('obtenerCarpetasDelHotel') === 1, '3. en las áreas de un hotel se ve el esqueleto y se vuelven a pedir las áreas (esqueletos: ' + esq + ')');
  ok(llamadas.filter(l => ['obtenerCarpetasDelHotel', 'obtenerDatosInicio'].includes(l.a)).every(l => l.r === true), '3a. las peticiones de la recarga piden al servidor vaciar su caché de carpetas y archivos (refrescar: true)');
  await dormir(2500);
  ok(await page.evaluate(() => document.querySelectorAll('#carpetasGrid .carpeta-card').length > 0 && !!document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"].active')), '3b. las áreas vuelven y el hotel sigue marcado en el menú');
  lentoMs = 0;
  llamadas = [];
  await page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click()); await dormir(700);
  ok(cuenta('obtenerCarpetasDelHotel') >= 1 && llamadas.every(l => l.r === undefined), '3c. fuera de la recarga, la navegación normal NO pide vaciar el caché (se aprovecha)');

  // ---- 4. Dentro de una carpeta
  await page.evaluate(() => document.querySelector('.carpeta-card').click());
  await page.waitForSelector('.archivos-carpeta-container', { visible: true }); await dormir(800);
  lentoMs = 1500; llamadas = [];
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(400);
  ok(await page.evaluate(() => estadoArchivosCarpeta.cargando === true) && cuenta('obtenerContenidoCarpeta') === 1, '4. dentro de una carpeta se muestra la carga y se vuelve a pedir su contenido');
  await dormir(900);
  ok(await page.evaluate(() => estadoArchivosCarpeta.cargando === true && !/Datos actualizados/.test(document.body.innerText) && document.getElementById('btnRecargar').disabled), '4a. mientras el contenido de la carpeta sigue cargando, el botón NO da la recarga por terminada ni muestra el aviso');
  await dormir(1000);
  ok(await page.evaluate(() => /Datos actualizados/.test(document.body.innerText) && !document.getElementById('btnRecargar').disabled), '4a-b. cuando el contenido llega, recién entonces se da por terminada');
  ok(await page.evaluate(() => estadoArchivosCarpeta.cargando === false && estadoArchivosCarpeta.archivos.length + estadoArchivosCarpeta.subcarpetas.length > 0), '4b. el contenido regresa');
  lentoMs = 0;

  // ---- 5. Usuarios
  await page.evaluate(() => document.getElementById('navUsuarios').click());
  await page.waitForSelector('.usuario-fila', { visible: true }); await dormir(500);
  lentoMs = 1500; llamadas = [];
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(400);
  ok(cuenta('obtenerUsuariosParaGestion') === 1 && await page.evaluate(() => document.querySelectorAll('#usuariosGrid .apartado-skeleton, #usuariosGrid .usuario-skeleton, #usuariosGrid [class*=skeleton]').length > 0), '5. en Usuarios se muestra el esqueleto y se vuelve a pedir la lista');
  await dormir(2500);
  ok(await page.evaluate(() => document.querySelectorAll('.usuario-fila').length > 0), '5b. la lista de usuarios regresa');
  lentoMs = 0;

  // ---- 6. No recarga mientras hay una operación en curso
  await volverAInicio();
  llamadas = [];
  await page.evaluate(() => { google.script.run.withSuccessHandler(() => {}).crearArea('H1', 'X', 'tok', '1'); });
  await dormir(200);
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(300);
  ok(cuenta('obtenerDatosInicio') === 0 && await page.evaluate(() => /operaci.n en curso/.test(document.body.innerText)), '6. con una operación en curso NO recarga y avisa que espere');
  await dormir(3200);
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(1200);
  ok(cuenta('obtenerDatosInicio') === 1, '6b. al terminar la operación, el botón vuelve a funcionar');

  // ---- 7. Las copias guardadas se rehacen con datos frescos
  ok(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('oxoCache:')).length) >= 2, '7. tras recargar se vuelven a guardar las copias con los datos nuevos');

  // ---- 7b. Si el servidor omitió el refresco profundo (límite por minuto), el aviso lo dice
  await page.evaluate(() => { document.querySelectorAll('.notification').forEach(n => n.remove()); });
  limitarRefresco = true;
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(1800);
  ok(await page.evaluate(() => /puede tardar unos minutos/.test(document.body.innerText)), '7b. si el servidor omitió el refresco profundo, el aviso lo aclara en vez de afirmar que todo está al día');
  limitarRefresco = false;

  // ---- 8. Si una carga falla, el botón NO se queda bloqueado
  await page.evaluate(() => { window.__orig = window.cargarDatosInicio_; window.cargarDatosInicio_ = () => Promise.reject(new Error('fallo simulado')); });
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(1500);
  const trasFallo = await estado();
  ok(!trasFallo.girando && !trasFallo.deshabilitado && !trasFallo.sidebarPulsa, '8. aunque una carga falle (promesa rechazada) el botón y el menú vuelven a la normalidad → ' + JSON.stringify(trasFallo));
  await page.evaluate(() => { window.cargarDatosInicio_ = () => { throw new Error('fallo síncrono'); }; });
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(1500);
  const trasFallo2 = await estado();
  ok(!trasFallo2.girando && !trasFallo2.deshabilitado && !trasFallo2.sidebarPulsa, '8b. tampoco si la carga lanza un error inmediato → ' + JSON.stringify(trasFallo2));
  await page.evaluate(() => { window.cargarDatosInicio_ = window.__orig; });

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
