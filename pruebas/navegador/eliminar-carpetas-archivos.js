// Eliminar carpetas y archivos: solo Administrador (rol 2) y Superadministrador (rol 3). Los botones aparecen también en la vista de
// tarjetas (antes solo existían en la vista de filas) y el servidor es quien decide de verdad.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

async function probarConRol(browser, server, rol) {
  console.log('\n--- Rol ' + rol + ' ---');
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  const llamadas = [];
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}'); llamadas.push(b);
      let data;
      if (b.action === 'validarCredenciales') data = { success: true, user: Object.assign({}, SESION, { ID_Rol: rol, Rol_ID: rol, Rol: rol === 3 ? 'Superadministrador' : (rol === 2 ? 'Administrador' : 'Usuario') }) };
      else if (['registrarAuditoria', 'cerrarSesionUsuario'].includes(b.action)) data = { success: true };
      else if (['eliminarCarpeta', 'eliminarArchivo'].includes(b.action)) data = { success: true };
      else data = responder(b.action, b.args || []);
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(800);
  await page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click()); await page.waitForSelector('.carpeta-card', { visible: true, timeout: 8000 }); await dormir(500);

  const esAdmin = rol >= 2;
  // 1) Tarjetas de áreas del hotel
  const area = await page.evaluate(() => {
    const c = document.querySelector('.carpeta-card'); const g = c.querySelector('.gestion-grupo');
    return { hayGrupo: !!g, eliminar: !!c.querySelector('[data-accion="eliminar"]'), renombrar: !!c.querySelector('[data-accion="renombrar"]'), opacidad: g ? getComputedStyle(g).opacity : null, id: c.dataset.idCarpeta || (c.querySelector('[data-id-carpeta]') || {}).dataset?.idCarpeta };
  });
  ok(area.eliminar === esAdmin && area.renombrar === esAdmin, 'tarjeta de área: ' + (esAdmin ? 'tiene' : 'NO tiene') + ' eliminar y renombrar');
  if (esAdmin) {
    ok(area.opacidad === '0', 'en la vista de tarjetas los botones están ocultos hasta pasar el cursor (opacidad ' + area.opacidad + ')');
    const tarjeta = await page.$('.carpeta-card'); await tarjeta.hover(); await dormir(300);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.carpeta-card .gestion-grupo')).opacity) === '1', 'al pasar el cursor aparecen');
    const box = await page.evaluate(() => { const b = document.querySelector('.carpeta-card [data-accion="eliminar"]').getBoundingClientRect(); const c = document.querySelector('.carpeta-card').getBoundingClientRect(); return { dentro: b.left >= c.left && b.right <= c.right && b.top >= c.top && b.bottom <= c.bottom, ancho: b.width, alto: b.height }; });
    ok(box.dentro && box.ancho > 20 && box.alto > 20, 'el botón de eliminar cabe dentro de la tarjeta y se puede pulsar (' + Math.round(box.ancho) + 'x' + Math.round(box.alto) + ')');
    await page.evaluate(() => document.querySelector('.carpeta-card [data-accion="eliminar"]').click()); await dormir(400);
    ok(await page.evaluate(() => !!document.getElementById('confirmacionGenericaConfirmar')), 'pide confirmación antes de eliminar');
    await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(800);
    const eliminada = llamadas.find(l => l.action === 'eliminarCarpeta');
    ok(!!eliminada && eliminada.token === 'token-demo-manual' || !!eliminada && !!eliminada.token, 'al confirmar se llama a eliminarCarpeta con la sesión: ' + JSON.stringify(eliminada && eliminada.args));
  }

  // 2) Dentro de una carpeta: subcarpetas y archivos
  await page.evaluate(() => document.querySelectorAll('.carpeta-card')[0].click()); await dormir(1500);
  const dentro = await page.evaluate(() => {
    const archivos = Array.from(document.querySelectorAll('.archivo-card[data-archivo-id]'));
    const subs = Array.from(document.querySelectorAll('.carpeta-en-explorador'));
    return { archivos: archivos.length, subs: subs.length,
      eliminarArchivo: archivos.filter(a => a.querySelector('[data-accion="eliminar-archivo"]')).length,
      eliminarSub: subs.filter(a => a.querySelector('[data-accion="eliminar"]')).length };
  });
  ok(dentro.archivos + dentro.subs > 0, 'la carpeta abierta muestra contenido (' + dentro.archivos + ' archivos, ' + dentro.subs + ' subcarpetas)');
  ok(dentro.eliminarArchivo === (esAdmin ? dentro.archivos : 0), 'eliminar archivo: ' + (esAdmin ? 'en todos' : 'en ninguno') + ' (' + dentro.eliminarArchivo + ' de ' + dentro.archivos + ')');
  ok(dentro.eliminarSub === (esAdmin ? dentro.subs : 0), 'eliminar subcarpeta: ' + (esAdmin ? 'en todas' : 'en ninguna') + ' (' + dentro.eliminarSub + ' de ' + dentro.subs + ')');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await page.close();
}

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  for (const rol of [3, 2, 1]) await probarConRol(browser, server, rol);
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
