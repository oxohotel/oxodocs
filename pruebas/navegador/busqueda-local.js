// El buscador filtra en el navegador con un índice que pide una sola vez: respuesta inmediata, sin una llamada al servidor por tecla.
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
  let llamadas = []; let indiceFalla = false; const demoraServidor = 1500;
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}'); llamadas.push(b);
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: SESION };
      else if (['registrarAuditoria', 'cerrarSesionUsuario'].includes(b.action)) data = { success: true };
      else if (b.action === 'obtenerIndiceDeBusqueda' && indiceFalla) data = { success: false };
      else data = responder(b.action, b.args || []);
      const demora = b.action === 'buscarGlobal' ? demoraServidor : 0; // el servidor tarda: lo que se vea al instante NO viene de él
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1'); await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(2500);

  ok(llamadas.filter(l => l.action === 'obtenerIndiceDeBusqueda').length === 1, '1. al entrar se pide el índice del buscador UNA vez, por detrás');
  ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.indexOf('oxoCache:indiceBusqueda') === 0)), '1b. se guarda una copia para tenerlo listo en la siguiente visita');

  const textos = () => page.evaluate(() => Array.from(document.querySelectorAll('#navbarSearchResultados .busqueda-resultado-nombre')).map(e => e.textContent));
  const escribir = async (t) => { await page.$eval('#navbarSearchInput', el => { el.value = ''; }); await page.focus('#navbarSearchInput'); await page.type('#navbarSearchInput', t); };
  llamadas = [];
  let t0 = Date.now(); await escribir('bari'); await page.waitForFunction(() => document.querySelectorAll('#navbarSearchResultados .busqueda-resultado').length > 0, { timeout: 1200 });
  const ms = Date.now() - t0; let r = await textos();
  ok(r.length > 0 && /Bari/i.test(r.join(' ')), '2. escribir "bari" muestra resultados: ' + r.slice(0, 3).join(', '));
  ok(ms < demoraServidor, '3. salen al instante (' + ms + ' ms, con el servidor tardando ' + demoraServidor + ' ms)');
  ok(!llamadas.some(l => l.action === 'buscarGlobal'), '3b. sin llamar al servidor al escribir');

  await escribir('BARÍ'); await dormir(400); r = await textos();
  ok(r.length > 0 && /Bari/i.test(r.join(' ')), '4. no distingue mayúsculas ni tildes ("BARÍ" encuentra "Bari")');

  await escribir('it'); await dormir(400);
  const carp = await page.evaluate(() => Array.from(document.querySelectorAll('#navbarSearchResultados .busqueda-resultado')).map(b => ({ n: b.querySelector('.busqueda-resultado-nombre').textContent, hotel: (b.querySelector('.busqueda-resultado-meta') || {}).textContent || null })));
  const carpetas = carp.filter(c => c.hotel);
  ok(carpetas.length > 0 && carpetas.length <= 8 && carpetas[0].n === 'IT', '5. las carpetas cuyo nombre EMPIEZA por lo escrito van primero ("IT"): ' + carpetas.slice(0, 3).map(c => c.n + ' (' + c.hotel + ')').join(', '));

  await escribir('zzzxx'); await dormir(300);
  ok(await page.evaluate(() => /Sin resultados/.test(document.getElementById('navbarSearchResultados').innerText)), '6. sin coincidencias avisa «Sin resultados»');

  await escribir('bari'); await dormir(300);
  await page.evaluate(() => document.querySelector('#navbarSearchResultados .busqueda-resultado').click()); await page.waitForSelector('.carpeta-card', { visible: true, timeout: 8000 });
  ok(await page.evaluate(() => /Bari/.test(document.getElementById('hotelCarpetasTitulo').innerText)), '7. elegir un resultado abre esa propiedad');

  // Renovación al enfocar si el índice tiene más de 2 minutos
  llamadas = [];
  await page.evaluate(() => { indiceBusqueda_.cargadoEn = Date.now() - 3 * 60 * 1000; document.activeElement.blur(); });
  await page.focus('#navbarSearchInput'); await dormir(600);
  ok(llamadas.filter(l => l.action === 'obtenerIndiceDeBusqueda').length === 1, '8. al enfocar el buscador con el índice viejo se renueva por detrás (1 llamada)');
  llamadas = []; await page.evaluate(() => document.activeElement.blur()); await page.focus('#navbarSearchInput'); await dormir(400);
  ok(!llamadas.some(l => l.action === 'obtenerIndiceDeBusqueda'), '8b. enfocar de nuevo enseguida no vuelve a pedirlo');

  // Si el índice no llega, el servidor responde (respaldo)
  await page.evaluate(() => { indiceBusqueda_.datos = null; indiceBusqueda_.cargadoEn = 0; });
  indiceFalla = true; llamadas = [];
  await escribir('bari'); for (let i = 0; i < 40 && !llamadas.some(l => l.action === 'buscarGlobal'); i++) await dormir(150); await dormir(1800); // espera la llamada al servidor y su respuesta
  ok(llamadas.some(l => l.action === 'buscarGlobal') && (await textos()).length > 0, '9. mientras no hay índice, la búsqueda se resuelve en el servidor (respaldo)');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
