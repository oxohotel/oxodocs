// Prueba de la UI "Gestionar hoteles" con el bundle real (dist/index.html) y backend simulado con estado.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const OUT = CAPTURAS;
fs.mkdirSync(OUT, { recursive: true });

const MODULOS = responder('obtenerModulosConHoteles', []);
const llamadas = [];
let nuevoId = 100;

function clave(s) { return String(s).trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function buscar(id) { for (const m of MODULOS) for (const h of m.hoteles) if (String(h.idHotel) === String(id)) return { m, h }; return null; }
const ordenar = () => MODULOS.forEach(m => m.hoteles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
const todosLosNombres = () => MODULOS.flatMap(m => m.hoteles.map(h => clave(h.nombre)));

function backend(action, args, rolSesion) {
  const esSuper = rolSesion === 3;
  if (['crearHotel', 'editarHotel', 'eliminarHotel'].includes(action)) {
    llamadas.push({ action, args });
    if (!esSuper) return { success: false, message: 'Solo un Superadministrador puede gestionar hoteles' };
    if (action === 'crearHotel') {
      const [nombre, idModulo] = args;
      if (todosLosNombres().includes(clave(nombre))) return { success: false, message: 'Ya existe un hotel con ese nombre' };
      MODULOS.find(m => m.idModulo === idModulo).hoteles.push({ idHotel: 'H' + (nuevoId++), nombre: nombre.trim(), driveFolderId: 'x', driveUrl: '' });
      ordenar(); return { success: true };
    }
    if (action === 'editarHotel') {
      const [id, nombre, idModulo] = args; const f = buscar(id);
      f.m.hoteles.splice(f.m.hoteles.indexOf(f.h), 1); f.h.nombre = nombre;
      MODULOS.find(m => m.idModulo === idModulo).hoteles.push(f.h); ordenar(); return { success: true };
    }
    if (action === 'eliminarHotel') {
      const [id, conf] = args; const f = buscar(id);
      if (clave(conf) !== clave(f.h.nombre)) return { success: false, message: 'El nombre escrito no coincide con el del hotel. No se eliminó nada.' };
      f.m.hoteles.splice(f.m.hoteles.indexOf(f.h), 1); return { success: true };
    }
  }
  return responder(action, args);
}

let fallos = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_APP = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  async function nuevaPagina(sesion) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const errores = [];
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('http://127.0.0.1') || url.startsWith('data:')) return req.continue();
      if (/script\.google\.com\/macros/.test(url)) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        const body = JSON.parse(req.postData() || '{}');
        return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data: backend(body.action, body.args || [], sesion.ID_Rol) }) });
      }
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com|acabrales-oxohotel\.github\.io/.test(url)) return req.continue();
      return req.abort();
    });
    page.on('pageerror', e => errores.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errores.push(m.text()); });
    await page.goto(URL_APP, { waitUntil: 'networkidle2' });
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); localStorage.setItem('temaHome', JSON.stringify('light')); }, sesion);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#vistaHome:not(.oculto)');
    await page.waitForSelector('.btn-hotel-carpetas');
    await dormir(1200);
    return { page, errores };
  }

  const nombresSidebar = page => page.evaluate(() => [...document.querySelectorAll('.sidebar-group')].map(g => ({
    grupo: g.querySelector('.sidebar-label').textContent.trim(),
    hoteles: [...g.querySelectorAll('.btn-hotel-carpetas')].map(b => b.textContent.trim()),
    unico: g.classList.contains('sidebar-group-unico')
  })));
  const botonVisible = page => page.evaluate(() => { const b = document.getElementById('btnGestionHoteles'); return !!b && !b.classList.contains('oculto'); });

  // ---------- Usuario normal: no ve el botón ----------
  {
    const { page } = await nuevaPagina({ ...SESION, ID_Rol: 1, Rol_ID: 1, Rol: 'Usuario' });
    ok(!(await botonVisible(page)), 'rol 1: el botón (+) está oculto');
    await page.close();
  }
  // ---------- Administrador (rol 2): tampoco ----------
  {
    const { page } = await nuevaPagina({ ...SESION, ID_Rol: 2, Rol_ID: 2, Rol: 'Administrador' });
    ok(!(await botonVisible(page)), 'rol 2: el botón (+) está oculto');
    await page.close();
  }

  // ---------- Superadmin ----------
  const { page, errores } = await nuevaPagina(SESION);
  ok(await botonVisible(page), 'rol 3: el botón (+) está visible');
  await page.hover('#homeSidebar'); await dormir(500);
  await page.screenshot({ path: path.join(OUT, '1-sidebar-boton.png'), clip: { x: 0, y: 0, width: 330, height: 330 } });

  await page.evaluate(() => document.getElementById('btnGestionHoteles').click());
  await page.waitForSelector('#panelLateral .gh-panel', { visible: true });
  await dormir(500);
  ok((await page.$$eval('#ghLista .gh-modulo', e => e.length)) === 3, 'el panel lista los 3 módulos de hoteles (sin Corporativo)');
  ok((await page.$$eval('#ghModuloNuevo option', e => e.map(o => o.textContent)).then(x => x.join('|'))) === 'Hoteles en operación|Hoteles en pre-apertura|Hoteles en desarrollo', 'el selector de módulo ofrece solo los 3 grupos');
  await page.screenshot({ path: path.join(OUT, '2-panel.png') });

  // Agregar
  await page.type('#ghNombreNuevo', 'Hotel Pop Art Tocancipá');
  await page.click('#ghBtnAgregar');
  await page.waitForFunction(() => [...document.querySelectorAll('#ghLista .gh-hotel-nombre')].some(e => e.textContent === 'Hotel Pop Art Tocancipá'), { timeout: 8000 });
  let sb = await nombresSidebar(page);
  ok(sb[0].hoteles.includes('Hotel Pop Art Tocancipá'), 'agregar: el hotel aparece en "Hoteles en operación" de la barra lateral');
  ok(await page.$eval('#ghNombreNuevo', e => e.value) === '', 'agregar: el campo de nombre se limpia');
  ok(await page.evaluate(() => document.getElementById('panelLateralOverlay').classList.contains('bloqueado')) === false, 'agregar: el panel se desbloquea al terminar');
  // Duplicado
  await page.type('#ghNombreNuevo', 'hotel pop art tocancipa');
  await page.click('#ghBtnAgregar'); await dormir(300);
  ok((await page.$eval('#ghEstado', e => e.textContent)).includes('Ya existe'), 'agregar duplicado: muestra "Ya existe un hotel con ese nombre"');
  await page.$eval('#ghNombreNuevo', e => e.value = '');
  // Segundo hotel pedido
  await page.type('#ghNombreNuevo', 'Holiday Inn Express Barranquilla Buenavista');
  await page.click('#ghBtnAgregar');
  await page.waitForFunction(() => [...document.querySelectorAll('#ghLista .gh-hotel-nombre')].some(e => e.textContent.startsWith('Holiday Inn Express Barranquilla')), { timeout: 8000 });
  ok(true, 'agregar: Holiday Inn Express Barranquilla Buenavista');

  // Editar / mover
  await page.evaluate(() => document.querySelector('.gh-hotel[data-id-hotel="H1"] [data-accion="editar"]').click());
  await dormir(200);
  await page.screenshot({ path: path.join(OUT, '3-editar.png') });
  await page.select('.gh-hotel[data-id-hotel="H1"] .gh-in-modulo', 'M3');
  await page.evaluate(() => document.querySelector('.gh-hotel[data-id-hotel="H1"] [data-accion="guardar"]').click());
  await page.waitForFunction(() => !document.querySelector('#ghEstado').textContent.includes('Guardando'), { timeout: 8000 });
  await dormir(500);
  sb = await nombresSidebar(page);
  ok(!sb[0].hoteles.includes('Hotel Bari') && sb[2].hoteles.includes('Hotel Bari'), 'mover: Hotel Bari pasó de operación a desarrollo en la barra lateral');
  ok(sb[2].unico === false, 'mover: desarrollo (ahora con varios hoteles) no queda marcado como módulo único');

  // Módulo que queda con un solo hotel y vuelve a tener varios (caso de la clase "único")
  // Eliminar
  await page.evaluate(() => document.querySelector('.gh-hotel[data-id-hotel="H1"] [data-accion="eliminar"]').click());
  await dormir(200);
  ok(await page.$eval('.gh-hotel[data-id-hotel="H1"] [data-accion="confirmar-eliminar"]', e => e.disabled), 'eliminar: el botón nace deshabilitado');
  await page.type('.gh-hotel[data-id-hotel="H1"] .gh-in-confirmacion', 'otro nombre');
  ok(await page.$eval('.gh-hotel[data-id-hotel="H1"] [data-accion="confirmar-eliminar"]', e => e.disabled), 'eliminar: sigue deshabilitado con un nombre distinto');
  await page.$eval('.gh-hotel[data-id-hotel="H1"] .gh-in-confirmacion', e => e.value = '');
  await page.type('.gh-hotel[data-id-hotel="H1"] .gh-in-confirmacion', 'hotel BARI');
  ok(!(await page.$eval('.gh-hotel[data-id-hotel="H1"] [data-accion="confirmar-eliminar"]', e => e.disabled)), 'eliminar: se habilita al escribir el nombre (sin importar mayúsculas)');
  await page.screenshot({ path: path.join(OUT, '4-eliminar.png') });
  await page.evaluate(() => document.querySelector('.gh-hotel[data-id-hotel="H1"] [data-accion="confirmar-eliminar"]').click());
  await page.waitForFunction(() => ![...document.querySelectorAll('#ghLista .gh-hotel-nombre')].some(e => e.textContent === 'Hotel Bari'), { timeout: 8000 });
  await dormir(400);
  sb = await nombresSidebar(page);
  ok(!sb.some(g => g.hoteles.includes('Hotel Bari')), 'eliminar: el hotel desaparece de la barra lateral');

  ok(llamadas.map(l => l.action).join() === 'crearHotel,crearHotel,editarHotel,eliminarHotel', 'se llamó al backend solo las veces esperadas (el duplicado se frenó en el cliente): ' + llamadas.map(l => l.action).join());
  ok(llamadas.every(l => l.args[l.args.length - 2] === SESION.token && String(l.args[l.args.length - 1]) === String(SESION.ID_Usuario)), 'cada llamada envía token + ID de usuario de respaldo');
  ok(errores.length === 0, 'sin errores de JS en consola' + (errores.length ? ': ' + errores.join(' || ') : ''));

  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS DE UI PASARON');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
