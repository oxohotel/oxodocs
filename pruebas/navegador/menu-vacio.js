// Verifica que el menú lateral no dibuje los módulos en los que el usuario no tiene hoteles.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
let escenario = 'todo';
function modulosPara(esc) {
  const base = responder('obtenerModulosConHoteles', []); // MODULOS completos
  const copia = JSON.parse(JSON.stringify(base));
  const quedan = { todo: ['M1', 'M2', 'M3', 'M4'], soloOperacion: ['M1'], sinCorporativo: ['M1', 'M2', 'M3'], soloCorporativo: ['M4'], ninguno: [], operacionYdesarrollo: ['M1', 'M3'] }[esc];
  copia.forEach(m => { if (!quedan.includes(m.idModulo)) m.hoteles = []; });
  return copia;
}
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
  const errores = [];
  for (const esc of ['todo', 'soloOperacion', 'sinCorporativo', 'soloCorporativo', 'operacionYdesarrollo', 'ninguno']) {
    escenario = esc;
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on('pageerror', e => errores.push(e.message));
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
      if (/script\.google\.com\/macros/.test(u)) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        const b = JSON.parse(req.postData() || '{}');
        const data = b.action === 'obtenerModulosConHoteles' ? modulosPara(escenario) : responder(b.action, b.args || []);
        return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
      }
      if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#vistaHome:not(.oculto)');
    await new Promise(r => setTimeout(r, 2500));
    const visibles = await page.evaluate(() => [...document.querySelectorAll('.sidebar-group[data-orden]')].filter(g => !g.classList.contains('oculto') && g.offsetParent !== null).map(g => g.querySelector('.sidebar-label').textContent.trim()));
    const esperado = { todo: 'Hoteles en operación|Hoteles en pre-apertura|Hoteles en desarrollo|Corporativo', soloOperacion: 'Hoteles en operación', sinCorporativo: 'Hoteles en operación|Hoteles en pre-apertura|Hoteles en desarrollo', soloCorporativo: 'Corporativo', operacionYdesarrollo: 'Hoteles en operación|Hoteles en desarrollo', ninguno: '' }[esc];
    ok(visibles.join('|') === esperado, esc.padEnd(22) + '→ menú: [' + visibles.join(', ') + ']');
    if (esc === 'soloCorporativo') {
      const unico = await page.evaluate(() => { const g = document.querySelector('.sidebar-group[data-orden="4"]'); return g.classList.contains('sidebar-group-unico') && !!g.dataset.hotelUnicoId; });
      ok(unico, 'Corporativo (módulo de un solo hotel) sigue funcionando como acceso directo');
    }
    if (esc === 'todo') await page.screenshot({ path: CAPTURAS + '/menu-todo.png', clip: { x: 0, y: 0, width: 330, height: 700 } });
    if (esc === 'operacionYdesarrollo') {
      await page.hover('#homeSidebar'); await new Promise(r => setTimeout(r, 500));
      await page.screenshot({ path: CAPTURAS + '/menu-parcial.png', clip: { x: 0, y: 0, width: 330, height: 500 } });
    }
    await page.close();
  }
  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' || ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? fallos + ' FALLA(S)' : 'TODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
