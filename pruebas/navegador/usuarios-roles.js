// Los selectores de rol de la pantalla Usuarios nunca deben quedar sin opciones, llegue primero la lista o el catálogo de roles.
// (Variable DIST_PATH: permite probar otra versión compilada, p. ej. para comprobar que la prueba detecta el error en la anterior.)
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const DIST = process.env.DIST_PATH || REPO + 'dist/index.html';

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(DIST)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errores = [];
  let demoraRoles = 0, modoRoles = 'normal';

  async function abrirUsuarios() {
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
        let cuerpo, demora = 0;
        if (b.action === 'obtenerCatalogoRoles') {
          demora = demoraRoles;
          cuerpo = modoRoles === 'falla' ? { success: false, message: 'caído' }
            : { success: true, data: { success: true, roles: modoRoles === 'vacio' ? [] : [{ id: 1, nombre: 'Usuario' }, { id: 2, nombre: 'Administrador' }, { id: 3, nombre: 'Superadministrador' }] } };
        } else {
          cuerpo = { success: true, data: b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []) };
        }
        return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(cuerpo) }), demora);
      }
      if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#navUsuarios'); await dormir(1200);
    await page.evaluate(() => document.getElementById('navUsuarios').click());
    await page.waitForSelector('.usuario-fila', { visible: true, timeout: 15000 }).catch(() => {});
    await dormir(400);
    return page;
  }
  const leerSelectores = page => page.evaluate(() => [...document.querySelectorAll('.usuario-rol-select')].map(s => ({ opciones: s.options.length, seleccionado: s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : '' })));

  // 1) La lista llega mucho antes que el catálogo de roles (el caso de la captura)
  demoraRoles = 2500; modoRoles = 'normal';
  let page = await abrirUsuarios();
  await dormir(3200);
  let sel = await leerSelectores(page);
  ok(sel.length > 0 && sel.every(s => s.opciones === 3 && s.seleccionado), '1. con el catálogo de roles MUY lento, todos los selectores tienen sus 3 roles y uno elegido (' + sel.length + ' selectores) → ' + JSON.stringify(sel.slice(0, 2)));
  await page.close();

  // 2) El catálogo falla
  demoraRoles = 0; modoRoles = 'falla';
  page = await abrirUsuarios(); sel = await leerSelectores(page);
  ok(sel.length > 0 && sel.every(s => s.opciones === 3 && s.seleccionado), '2. si el catálogo de roles falla, se usan los roles por defecto y los selectores no quedan vacíos');
  await page.close();

  // 3) El catálogo llega vacío
  modoRoles = 'vacio';
  page = await abrirUsuarios(); sel = await leerSelectores(page);
  ok(sel.length > 0 && sel.every(s => s.opciones === 3 && s.seleccionado), '3. si el catálogo llega vacío, también se usan los roles por defecto');
  await page.close();

  // 4) Orden normal
  modoRoles = 'normal'; demoraRoles = 0;
  page = await abrirUsuarios(); sel = await leerSelectores(page);
  ok(sel.length > 0 && sel.every(s => s.opciones === 3 && s.seleccionado), '4. con el orden normal todo sigue funcionando');
  ok(await page.evaluate(() => { const s = document.querySelector('.usuario-rol-select'); s.focus(); return s.options.length === 3; }), '4b. el desplegable de un selector muestra las 3 opciones');
  await page.screenshot({ path: CAPTURAS + '/usuarios-roles.png' });
  await page.close();

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
