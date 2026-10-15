// El navegador manda el token de la sesión en CADA petición, y si el servidor responde SESION_INVALIDA (sesión vencida, cerrada o
// cuenta desactivada) vuelve al inicio de sesión con un aviso, sin dejar datos de la sesión anterior.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, REPO } = require('./_comun');
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
  const peticiones = []; let sesionVale = true;
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}');
      peticiones.push(b);
      const publica = ['validarCredenciales', 'obtenerVersionCacheGlobal', 'obtenerHotelesParaRegistro', 'cerrarSesionUsuario'].includes(b.action);
      if (!sesionVale && !publica) return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: false, codigo: 'SESION_INVALIDA', message: 'Tu sesión no es válida o venció. Vuelve a iniciar sesión.' }) });
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: Object.assign({}, SESION, { token: 'TOKEN-DE-PRUEBA' }), token: 'TOKEN-DE-PRUEBA' };
      else if (b.action === 'registrarAuditoria' || b.action === 'cerrarSesionUsuario') data = { success: true };
      else data = responder(b.action, b.args || []);
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });

  ok(peticiones.length > 0 && peticiones.every(p => !p.token), 'sin sesión las peticiones (ping) no llevan token');
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  peticiones.length = 0; await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1500);
  const privadas = peticiones.filter(p => !['validarCredenciales', 'obtenerVersionCacheGlobal'].includes(p.action));
  ok(privadas.length > 0 && privadas.every(p => p.token === 'TOKEN-DE-PRUEBA'), 'tras iniciar sesión TODAS las peticiones llevan el token (' + privadas.map(p => p.action).join(', ') + ')');

  // El servidor deja de aceptar la sesión: la siguiente petición devuelve a inicio de sesión
  sesionVale = false;
  await page.evaluate(() => google.script.run.obtenerMisAccesos('x'));
  await page.waitForSelector('#loginForm', { visible: true, timeout: 8000 }).catch(() => {}); await dormir(800);
  ok(await page.evaluate(() => !localStorage.getItem('currentUser')), 'se borró la sesión guardada');
  ok(await page.evaluate(() => !document.getElementById('vistaAuth').classList.contains('oculto')), 'se muestra la pantalla de inicio de sesión');
  const aviso = await page.evaluate(() => (document.querySelector('.notification.info') || {}).textContent || '');
  ok(/venci|cerr/i.test(aviso), 'se avisa que la sesión venció: «' + aviso.trim().slice(0, 70) + '»');
  ok(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('oxoCache:')).length) === 0, 'no quedan copias de la sesión anterior');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
