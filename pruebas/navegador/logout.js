// Prueba de extremo a extremo: dejar la app en una vista profunda, cerrar sesión, volver a entrar → siempre Inicio.
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

  const acciones = []; let recargas = 0; let accionesAntesDeRecargar = null;
  let esperandoLogout = false;
  page.on('framenavigated', f => { if (f === page.mainFrame()) { recargas++; if (esperandoLogout && !accionesAntesDeRecargar) accionesAntesDeRecargar = acciones.slice(); } });
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}'); acciones.push(b.action);
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: SESION };
      else if (b.action === 'cerrarSesionUsuario') data = { success: true };
      else if (b.action === 'registrarAuditoria') data = { success: true };
      else data = responder(b.action, b.args || []);
      // Las respuestas de cierre tardan un poco, como en la vida real
      const demora = (b.action === 'cerrarSesionUsuario' || b.action === 'registrarAuditoria') ? 400 : 0;
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });

  // ---- Entrar con sesión y dejar la app "lejos" del Inicio
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1500);
  await page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click());
  await page.waitForSelector('.carpeta-card', { visible: true }); await dormir(800);
  await page.evaluate(() => document.querySelector('.carpeta-card').click());
  await page.waitForSelector('.archivos-carpeta-container', { visible: true }); await dormir(800);
  await page.evaluate(() => document.getElementById('navUsuarios').click());
  await page.waitForSelector('.usuario-fila', { visible: true }); await dormir(500);
  const antes = await page.evaluate(() => ({ welcome: getComputedStyle(document.querySelector('.home-welcome')).display, usuarios: !!document.getElementById('usuariosContainer'), navActivo: (document.querySelector('.sidebar-item.active, .sidebar-subitem.active') || {}).id }));
  ok(antes.welcome === 'none' && antes.usuarios, 'preparación: la app quedó en la vista de Usuarios (Inicio oculto) → ' + JSON.stringify(antes));

  // ---- Cerrar sesión (la función que dispara el menú de usuario tras confirmar)
  const recargasAntes = recargas;
  esperandoLogout = true;
  await page.evaluate(() => document.getElementById('btnPerfil').click()); await dormir(300);
  await page.evaluate(() => document.getElementById('btnAbrirLogout').click()); await dormir(300);
  ok(await page.evaluate(() => document.getElementById('confirmacionGenericaModal').classList.contains('active')), 'el menú de usuario abre la confirmación "¿Cerrar sesión?"');
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click());
  await page.waitForSelector('#loginForm', { visible: true, timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.notification'), { timeout: 8000 }).catch(() => {});
  await dormir(500);
  ok(recargas === recargasAntes + 1, 'al cerrar sesión la página se recargó una vez');
  ok(accionesAntesDeRecargar && accionesAntesDeRecargar.includes('cerrarSesionUsuario') && accionesAntesDeRecargar.includes('registrarAuditoria'),
    'antes de recargar el servidor recibió el cierre de sesión y la auditoría → ' + (accionesAntesDeRecargar || []).filter(a => /cerrar|Auditoria/.test(a)).join(', '));
  ok(await page.evaluate(() => localStorage.getItem('currentUser')) === null, 'la sesión local se borró');
  ok(await page.evaluate(() => !!document.querySelector('.notification') && /cerrada/i.test(document.querySelector('.notification').textContent)), 'se muestra el aviso "Sesión cerrada correctamente" tras la recarga');
  ok(await page.evaluate(() => document.getElementById('vistaHome').classList.contains('oculto')), 'se ve el login (Home oculto)');
  ok(await page.evaluate(() => !document.getElementById('usuariosSection') && !document.getElementById('archivosCarpetaSection') && !document.getElementById('hotelCarpetasSection')), 'no queda en memoria nada de la vista anterior (Usuarios / explorador)');

  // ---- Volver a entrar por el formulario
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  await page.click('#loginBtn');
  await page.waitForSelector('#vistaHome:not(.oculto)', { timeout: 30000 });
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1500);
  const despues = await page.evaluate(() => ({
    welcome: getComputedStyle(document.querySelector('.home-welcome')).display,
    widgets: getComputedStyle(document.querySelector('.home-widgets-grid')).display,
    navInicioActivo: document.getElementById('navInicio').classList.contains('active'),
    otrosActivos: [...document.querySelectorAll('.sidebar-item.active, .sidebar-subitem.active')].filter(e => e.id !== 'navInicio').length,
    carpetasVisibles: [...document.querySelectorAll('.hotel-carpetas-container, .archivos-carpeta-container, #usuariosContainer, #logsContainer, #favoritosContainer, #recientesContainer')].filter(e => e.offsetParent !== null).length,
    panelAbierto: !!document.querySelector('#panelLateralOverlay.active')
  }));
  ok(despues.welcome !== 'none' && despues.widgets !== 'none', 'tras volver a entrar se ve el Inicio (bienvenida y widgets) → ' + JSON.stringify(despues));
  ok(despues.navInicioActivo && despues.otrosActivos === 0, 'el menú marca "Inicio" y nada más');
  ok(despues.carpetasVisibles === 0 && !despues.panelAbierto, 'ninguna otra vista ni panel lateral abierto');
  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));

  await page.screenshot({ path: CAPTURAS + '/tras-logout-login.png' });
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
