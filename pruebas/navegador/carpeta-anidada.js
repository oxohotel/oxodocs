// Abrir directo una subcarpeta anidada (desde Recientes, Favoritos o la búsqueda): su ruta se pide EN PARALELO con la lista de áreas,
// no después. Cada llamada al servidor cuesta 2-3 s, así que encadenarlas tres veces eran ~8 s de espera.
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
  const llamadas = []; const t0 = Date.now(); let demoraCarpetas = 0;
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}');
      llamadas.push({ a: b.action, args: b.args || [], t: Date.now() - t0 });
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: SESION };
      else if (b.action === 'registrarAuditoria' || b.action === 'cerrarSesionUsuario') data = { success: true };
      else data = responder(b.action, b.args || []);
      const demora = b.action === 'obtenerCarpetasDelHotel' ? demoraCarpetas : 0;
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1200);

  // 1) Subcarpeta anidada con la lista de áreas lenta (1,5 s): la ruta no espera a la lista
  demoraCarpetas = 1500; llamadas.length = 0;
  await page.evaluate(() => cargarCarpetasDelHotel('H1', 'Hotel Bari', 'S-H1-1a', null, false));
  await dormir(2600);
  const iAreas = llamadas.find(l => l.a === 'obtenerCarpetasDelHotel'), iRuta = llamadas.find(l => l.a === 'obtenerRutaCarpeta' && l.args[0] === 'S-H1-1a');
  const iCont = llamadas.find(l => l.a === 'obtenerContenidoCarpeta' && l.args[0] === 'S-H1-1a');
  ok(iAreas && iRuta && iRuta.t - iAreas.t < 400, 'la ruta se pide junto con la lista de áreas (separadas ' + (iRuta && iAreas ? iRuta.t - iAreas.t : '?') + ' ms, no 1500)');
  ok(!!iCont, 'se abre la subcarpeta pedida (contenido de S-H1-1a): ' + llamadas.map(l => l.a).join(' > '));
  const miga = await page.evaluate(() => Array.from(document.querySelectorAll('#rutaCarpetasBreadcrumb .breadcrumb-item')).map(e => e.textContent.trim()).join('/'));
  ok(/Borradores/.test(miga) && /Presupuestos/.test(miga) && /IT/.test(miga), 'la miga de pan conserva los niveles intermedios: ' + miga);

  // 2) Un área de primer nivel no necesita pedir la ruta
  await page.evaluate(() => { if (typeof volverAHotelCarpetas === 'function') volverAHotelCarpetas(); });
  demoraCarpetas = 0; llamadas.length = 0;
  await page.evaluate(() => cargarCarpetasDelHotel('H1', 'Hotel Bari', 'C-H1-3', null, false));
  await dormir(1500);
  ok(!llamadas.some(l => l.a === 'obtenerRutaCarpeta'), 'abrir un área de primer nivel no pide la ruta (llamadas: ' + llamadas.map(l => l.a).join(' > ') + ')');
  ok(llamadas.some(l => l.a === 'obtenerContenidoCarpeta' && l.args[0] === 'C-H1-3'), 'y abre ese área');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
