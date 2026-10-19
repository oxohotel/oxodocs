const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}'); let data, demora = 0;
      if (b.action === 'registrarUsuario') data = { success: true, message: 'Cuenta creada', userId: 'U9', requiereVerificacion: true };
      else if (b.action === 'validarCredenciales') data = { success: false, message: 'Debes verificar tu correo', requiereVerificacion: true };
      else if (b.action === 'verificarCodigoRegistro') { data = { success: true, message: 'Correo verificado' }; demora = 1500; }
      else if (b.action === 'enviarCodigoVerificacion') { data = { success: true }; demora = 1000; }
      else data = responder(b.action, b.args || []);
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  const abierto = () => page.evaluate(() => !!document.querySelector('#panelLateralOverlay.active'));
  const confAbierta = () => page.evaluate(() => { const m = document.getElementById('confirmacionGenericaModal'); return !!m && m.classList.contains('active'); });

  await page.evaluate(() => switchForm('register')); await dormir(900);
  await page.type('#registerName', 'Persona Prueba'); await page.type('#registerEmail', 'prueba@oxohotel.com');
  await page.type('#registerPassword', 'Clave1234!'); await page.type('#registerPasswordConfirm', 'Clave1234!');
  await page.evaluate(() => { const c = document.querySelector('#registerHoteles input[type=checkbox]'); if (c) c.click(); }); // ahora el mock trae la lista de propiedades y hay que elegir al menos una
  await page.evaluate(() => document.getElementById('registerForm').requestSubmit()); await dormir(2500); console.log(await page.evaluate(() => JSON.stringify({err:[...document.querySelectorAll('.error-message,.field-error,[id$=Error]')].map(e=>e.id+':'+e.textContent).filter(t=>t.split(':')[1]), notif:[...document.querySelectorAll('.notification')].map(n=>n.textContent), btn:document.getElementById('registerBtn').textContent}))); await page.waitForSelector('#panelLateralOverlay.active', {timeout:5000}); await dormir(300);
  ok(await abierto(), 'tras registrarse se abre el panel de verificacion');

  await page.keyboard.press('Escape'); await dormir(200);
  await page.mouse.click(20, 400); await dormir(200);
  ok(await abierto() && !(await confAbierta()), 'Escape: el panel sigue abierto y NO abre nada');
  ok(await abierto() && !(await confAbierta()), 'clic fuera: sigue abierto y no hace nada');
  await page.click('#btnCerrarPanelLateral'); await dormir(200);
  ok(await abierto() && await confAbierta(), 'boton X: sigue abierto y pide confirmacion');
  ok(await page.evaluate(() => { const c = document.getElementById('confirmacionGenericaModal'), p = document.getElementById('panelLateralOverlay'); return +getComputedStyle(c).zIndex > +getComputedStyle(p).zIndex; }), 'la confirmacion queda por encima del panel (z-index)');
  await page.evaluate(() => document.getElementById('confirmacionGenericaCancelar').click());

  await page.click('#btnReenviarCodigo'); await dormir(150);
  ok(await page.evaluate(() => oxoEscrituraEnCurso()), 'mientras se reenvia el codigo hay una operacion en curso');
  await page.click('#btnCerrarPanelLateral'); await dormir(150);
  ok(await abierto() && !(await confAbierta()), 'X durante el reenvio: no cierra ni abre confirmacion (solo avisa)');
  ok(await page.evaluate(() => /operaci.n en curso/.test(document.body.innerText)), 'se muestra el aviso de operacion en curso');
  await dormir(1200);
  ok(!(await page.evaluate(() => oxoEscrituraEnCurso())), 'al terminar el reenvio se libera el bloqueo');

  await page.type('#inputCodigoVerificacion', '123456'); await page.click('#btnConfirmarCodigo'); await dormir(200);
  await page.keyboard.press('Escape'); await dormir(150);
  ok(await abierto() && !(await confAbierta()), 'Escape durante la verificacion: el panel no se cierra');
  await page.waitForFunction(() => !document.querySelector('#panelLateralOverlay.active'), { timeout: 5000 }).catch(() => {});
  ok(!(await abierto()), 'al verificarse el codigo el panel se cierra solo (sin pedir confirmacion)');

  await page.evaluate(() => { abrirPanelVerificacion('prueba@oxohotel.com'); }); await dormir(200);
  await page.click('#btnCerrarPanelLateral'); await dormir(150);
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(300);
  ok(!(await abierto()), 'confirmando "Cerrar sin terminar" el panel se cierra');
  await page.evaluate(() => { setInputValue('loginEmail', 'prueba@oxohotel.com'); setInputValue('loginPassword', 'Clave1234!'); });
  await page.click('#loginBtn'); await page.waitForSelector('#panelLateralOverlay.active', { timeout: 8000 }).catch(() => {});
  ok(await abierto() && await page.evaluate(() => !!document.getElementById('inputCodigoVerificacion')), 'al iniciar sesion sin verificar, el panel de codigo se reabre');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
