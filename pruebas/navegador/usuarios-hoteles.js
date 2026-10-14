// Verifica en el bundle real cómo se muestra el acceso a hoteles según el valor guardado.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const VALORES = { '2': '', '3': 'TODOS', '4': 'H1,H2', '6': '' };
function parchear(data) {
  const lista = data && (data.usuarios || data);
  if (!Array.isArray(lista)) return data;
  lista.forEach(u => { if (u.id === '6') { u.rol_id = 3; u.id_rol = 3; u.rol = 'Superadministrador'; } if (u.id in VALORES) { u.hoteles_permitidos = VALORES[u.id]; u.hoteles_lista = VALORES[u.id] && VALORES[u.id] !== 'TODOS' ? ['Hotel X', 'Hotel Y'] : []; } });
  return data;
}
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}');
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data: b.action === 'obtenerUsuariosParaGestion' ? parchear(responder(b.action, b.args || [])) : responder(b.action, b.args || []) }) });
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#navUsuarios:not(.oculto)'); await page.click('#navUsuarios');
  await page.waitForSelector('.usuario-fila'); await new Promise(r => setTimeout(r, 800));
  const celdas = await page.evaluate(() => [...document.querySelectorAll('.usuario-fila')].map(f => ({ n: f.querySelector('.usuario-nombre').textContent.trim(), h: (f.querySelector('.btn-config-hoteles, .badge-hoteles-info, .badge-hoteles-yo') || {}).textContent?.replace(/\s+/g, ' ').trim() })));
  const de = n => celdas.find(c => c.n.startsWith(n)).h;
  let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
  ok(/Sin acceso/.test(de('Luis')), 'valor vacío → "Sin acceso" (antes decía "Todos los hoteles"): ' + de('Luis'));
  ok(/Todos los hoteles/.test(de('María')), 'valor TODOS → "Todos los hoteles": ' + de('María'));
  ok(/2/.test(de('Andrés')) && /hoteles/.test(de('Andrés')), 'lista H1,H2 → "2 hoteles": ' + de('Andrés'));
  const jorge = await page.evaluate(() => { const f = [...document.querySelectorAll('.usuario-fila')].find(x => x.textContent.includes('Jorge Valencia')); const c = f.querySelector('.btn-config-hoteles, .badge-hoteles-info'); return { txt: c.textContent.replace(/\s+/g, ' ').trim(), esBoton: c.tagName === 'BUTTON' }; });
  ok(/Todos los hoteles/.test(jorge.txt) && !jorge.esBoton, 'rol 3 con campo vacío → "Todos los hoteles" informativo, sin botón para configurar: ' + jorge.txt);
  // Modal del usuario con valor vacío: el interruptor debe nacer apagado
  await page.evaluate(() => [...document.querySelectorAll('.usuario-fila')].find(f => f.textContent.includes('Luis')).querySelector('.btn-config-hoteles').click());
  await page.waitForSelector('#chkToggleTodosLosHoteles'); await new Promise(r => setTimeout(r, 500));
  ok(await page.$eval('#chkToggleTodosLosHoteles', e => !e.checked), 'modal con valor vacío: el interruptor "Acceso a Todos los Hoteles" nace APAGADO');
  await page.screenshot({ path: CAPTURAS + '/usuarios-modal-vacio.png' });
  await browser.close(); server.close();
  console.log(fallos ? fallos + ' FALLA(S)' : 'TODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
