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
  const orden = []; let lentoMs = 0; const t0 = Date.now();
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}');
      orden.push({ a: b.action, t: Date.now() - t0 });
      if (b.action === 'obtenerDatosInicio') return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: false, message: 'no existe' }) });
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: SESION };
      else if (b.action === 'registrarAuditoria' || b.action === 'cerrarSesionUsuario') data = { success: true };
      else data = responder(b.action, b.args || []);
      const demora = /^obtener(ModulosConHoteles|ActividadReciente|FavoritosDetallados)$/.test(b.action) ? lentoMs : 0;
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });

  // 1) Login por formulario: la transición ya no espera 2.5 s y la auditoría va DESPUÉS de cargar hoteles
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  const tIni = Date.now(); await page.click('#loginBtn');
  await page.waitForSelector('#vistaHome:not(.oculto)', { timeout: 10000 });
  const tHome = Date.now() - tIni;
  ok(tHome < 1800, 'el Inicio aparece tras el login en ' + tHome + ' ms (antes >2500)');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1500);
  const iMod = orden.findIndex(o => o.a === 'obtenerModulosConHoteles'), iAud = orden.findIndex(o => o.a === 'registrarAuditoria');
  ok(iAud > iMod && iMod >= 0, 'la auditoría del login se envía después de pedir hoteles (orden: ' + orden.map(o => o.a).join(' > ') + ')');
  ok(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('oxoCache:')).length) >= 2, 'se guardó la copia de sidebar/widgets para esta persona');

  // 2) Recarga con servidor lento (4 s): la sidebar y los widgets ya se ven con la copia guardada
  lentoMs = 4000; orden.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tVer = Date.now();
  await page.waitForSelector('.btn-hotel-carpetas', { timeout: 3500 });
  ok(Date.now() - tVer < 3000, 'con servidor lento (4 s) la sidebar ya se ve al instante: ' + (Date.now() - tVer) + ' ms');
  await dormir(700);
  const widgets = await page.evaluate(() => ({ rec: document.querySelectorAll('#seccionRecientes [data-widget-contenido] > *').length, vis: !document.querySelector('#seccionRecientes [data-widget-contenido]').classList.contains('oculto') }));
  ok(widgets.vis && widgets.rec > 0, 'el widget de recientes se ve de inmediato con la copia → ' + JSON.stringify(widgets));
  await dormir(4500);
  ok(await page.evaluate(() => document.querySelectorAll('.btn-hotel-carpetas').length) > 0, 'tras llegar la respuesta del servidor la sidebar sigue correcta');
  lentoMs = 0;

  // 3) Cerrar sesión borra la copia
  await page.evaluate(() => document.getElementById('btnPerfil').click()); await dormir(300);
  await page.evaluate(() => document.getElementById('btnAbrirLogout').click()); await dormir(300);
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click());
  await page.waitForSelector('#loginForm', { visible: true, timeout: 15000 }).catch(() => {}); await dormir(1000);
  ok(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('oxoCache:')).length) === 0, 'al cerrar sesión se borra la copia guardada');
  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
