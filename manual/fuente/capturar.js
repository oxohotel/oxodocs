/**
 * capturar.js - Arnés Puppeteer para las capturas del manual de usuario de OXO Docs.
 * Uso:  node capturar.js            (genera todas)  |  node capturar.js 05 06   (solo algunas)
 * - Sirve dist/index.html (solo lectura) desde un servidor HTTP local efímero.
 * - Intercepta TODA petición a script.google.com y responde con datos ficticios (mock-data.js).
 * - Escribe los PNG en ./out
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { responder, SESION, sinMapear } = require('./mock-data');

const DIST = path.resolve(__dirname, '../../dist/index.html');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, 'capturas');
const ARCHIVO_TMP = path.join(__dirname, 'Presupuesto_2027.xlsx');
const SOLO = process.argv.slice(2); // prefijos a regenerar, ej. "05" "12"

const dormir = ms => new Promise(r => setTimeout(r, ms));
const erroresConsola = [];
const accionesVistas = new Set();
const bloqueadas = new Set();

(async () => {
  // Archivo temporal para simular la selección (contenido aleatorio, ~482 KB)
  fs.writeFileSync(ARCHIVO_TMP, require('crypto').randomBytes(482 * 1024));
  fs.mkdirSync(OUT, { recursive: true });

  // Servidor estático mínimo
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(DIST));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_APP = `http://127.0.0.1:${server.address().port}/`;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-features=Translate', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });

  // ---- Intercepción de red ----
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.startsWith('http://127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
    if (/script\.google\.com\/macros/.test(url)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      accionesVistas.add(body.action);
      const data = responder(body.action, body.args || []);
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
    }
    // Estáticos permitidos: fuentes e imágenes/íconos del repo de imágenes
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com|acabrales-oxohotel\.github\.io/.test(url)) return req.continue();
    bloqueadas.add(url.slice(0, 80));
    return req.abort();
  });
  page.on('console', m => { if (m.type() === 'error') erroresConsola.push(m.text()); });
  page.on('pageerror', e => erroresConsola.push('PAGEERROR: ' + e.message));

  // ---- Utilidades ----
  const quiere = n => SOLO.length === 0 || SOLO.some(s => n.startsWith(s));
  async function limpiarToasts() {
    await page.evaluate(() => document.querySelectorAll('.notification').forEach(n => n.remove()));
  }
  async function estable(ms = 700) {
    // espera a que no haya skeletons visibles y a que terminen animaciones
    await page.waitForFunction(() =>
      ![...document.querySelectorAll('[class*="skeleton"]')].some(e => e.offsetParent !== null), { timeout: 15000 });
    await dormir(ms);
  }
  async function alejarMouse() { await page.mouse.move(1000, 8); await dormir(250); }
  async function foto(nombre, opts = {}) {
    if (!quiere(nombre)) return;
    await limpiarToasts();
    if (!opts.mantenerMouse) await alejarMouse();
    await dormir(opts.espera ?? 300);
    await page.screenshot({ path: path.join(OUT, nombre + '.png'), ...opts.shot });
    console.log('OK', nombre);
  }
  const clic2 = sel => page.evaluate(s => document.querySelector(s).click(), sel);
  const clic = id => page.evaluate(i => document.getElementById(i).click(), id);
  const clicTexto = (sel, texto) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim() === t || e.textContent.trim().startsWith(t));
    if (!el) throw new Error('No se halló ' + s + ' = ' + t);
    el.click();
  }, sel, texto);
  async function irHotel(idHotel) {
    await page.evaluate(id => {
      const b = document.querySelector('.btn-hotel-carpetas[data-hotel-id="' + id + '"]');
      b.click();
    }, idHotel);
    await page.waitForSelector('.carpeta-card', { visible: true });
    await estable();
  }
  async function abrirPanelArchivo() {
    await clic('btnSubirArchivos');
    await page.waitForSelector('#panelLateral #inputArchivoModal');
    await dormir(700);
  }

  // =============== 01 / 02: Login y registro (sin sesión) ===============
  await page.goto(URL_APP, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginForm', { visible: true });
  await dormir(1200);
  await foto('01-login');
  await page.evaluate(() => document.querySelector('.link-switch[data-form="register"]').click());
  await dormir(1200);
  await foto('02-registro');

  // =============== Sesión simulada ===============
  await page.evaluate(s => {
    localStorage.clear();
    localStorage.setItem('currentUser', JSON.stringify(s));
    localStorage.setItem('appCacheVersion', JSON.stringify('1'));
    localStorage.setItem('temaHome', JSON.stringify('light'));
  }, SESION);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#vistaHome:not(.oculto)');
  await page.waitForSelector('.btn-hotel-carpetas');
  await dormir(1500);
  await page.waitForFunction(() => document.querySelectorAll('#seccionRecientes .apartado-item').length > 0
    && document.querySelectorAll('#seccionFavoritos .apartado-item').length > 0);
  await estable(900);

  // =============== 03 Inicio ===============
  await foto('03-inicio');

  // =============== 04 Menú lateral expandido ===============
  await page.setViewport({ width: 1440, height: 1250, deviceScaleFactor: 1.5 }); // alto extra para que quepan Favoritos/Recientes/Usuarios/Logs
  await dormir(500);
  await page.hover('#homeSidebar');
  await dormir(500);
  await page.click('#btnExpandirColapsarTodo');
  await dormir(900);
  if (quiere('04')) {
    const box = await page.evaluate(() => { const r = document.getElementById('homeSidebar').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
    await foto('04-menu-lateral', { mantenerMouse: true, shot: { clip: box, captureBeyondViewport: false } });
  }
  // =============== 21 Botón manual (recorte) ===============
  if (quiere('21')) {
    const b = await page.evaluate(() => { const r = document.getElementById('btnManualUsuario').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 26), width: Math.ceil(r.right + 10), height: Math.ceil(r.height + 52) }; });
    await foto('21-boton-manual', { mantenerMouse: true, shot: { clip: b, captureBeyondViewport: false } });
  }
  await alejarMouse();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  await page.evaluate(() => document.getElementById('btnExpandirColapsarTodo').click()); // colapsar submenús otra vez
  await dormir(400);

  // =============== 05 Áreas del hotel ===============
  await irHotel('H1');
  await foto('05-areas-hotel', { espera: 600 });

  // =============== 06 Explorador de carpeta (Hotel / IT / Presupuestos 2027) ===============
  await page.evaluate(() => [...document.querySelectorAll('.carpeta-card')].find(c => c.querySelector('.carpeta-nombre').textContent.trim() === 'IT').click());
  await page.waitForSelector('.carpeta-en-explorador', { visible: true });
  await estable();
  await page.evaluate(() => [...document.querySelectorAll('.carpeta-en-explorador')].find(c => c.textContent.includes('Presupuestos 2027')).click());
  await page.waitForSelector('.archivo-card[data-archivo-id]', { visible: true });
  await estable(900);
  await foto('06-explorador-carpeta');

  // =============== 07 Nueva carpeta ===============
  await clic('btnNuevaCarpeta');
  await page.waitForSelector('#inputNombreNuevaCarpeta', { visible: true });
  await page.type('#inputNombreNuevaCarpeta', 'Cotizaciones de proveedores');
  await dormir(700);
  await foto('07-nueva-carpeta');
  await page.evaluate(() => document.getElementById('btnCancelarNuevaCarpeta').click());
  await dormir(700);

  // =============== 08 Nuevo archivo (archivo seleccionado) ===============
  await abrirPanelArchivo();
  const input = await page.$('#panelLateral #inputArchivoModal');
  await input.uploadFile(ARCHIVO_TMP);
  await page.waitForFunction(() => document.querySelector('#panelLateral #listaArchivosSeleccionados')?.children.length > 0);
  await dormir(600);
  await foto('08-nuevo-archivo');

  // =============== 09 Privacidad (4 opciones) ===============
  await clic2('#panelLateral #btnAbrirSelectorPermisos');
  await page.waitForSelector('#modalPermisosContent input[name="privacidad"]');
  await dormir(2200); // deja pasar el toast "Cargando..." (se elimina igualmente)
  await foto('09-permisos-opciones');

  // =============== 10 Mis Grupos con "Dirección IT" seleccionado ===============
  await page.evaluate(() => {
    estadoPermisos_.grupoSeleccionado = 'G1';
    estadoPermisos_.opcionSeleccionada = 'grupo';
    estadoPermisos_.vistaActual = 'grupos';
    renderizarModalPermisos_();
  });
  await dormir(600);
  await foto('10-permisos-grupos');

  // =============== 11 Excluir usuarios ===============
  await page.evaluate(() => {
    estadoPermisos_.opcionSeleccionada = 'excepto';
    estadoPermisos_.vistaActual = 'excluidos';
    estadoPermisos_.filtroActual = '';
    renderizarModalPermisos_();
  });
  await page.waitForSelector('.check-excluir');
  for (const id of ['5', '6', '11']) await page.evaluate(i => document.querySelector('.check-excluir[value="' + i + '"]').click(), id);
  await dormir(500);
  await foto('11-permisos-excluir');

  // =============== 12 Restricción aplicada (grupo) ===============
  await page.evaluate(() => {
    estadoPermisos_.usuariosExcluidos = [];
    estadoPermisos_.opcionSeleccionada = 'grupo';
    estadoPermisos_.grupoSeleccionado = 'G1';
    estadoPermisos_.vistaActual = 'principal';
    renderizarModalPermisos_();
  });
  await dormir(400);
  await page.evaluate(() => document.querySelector('.btn-guardar-principal').click());
  await page.waitForFunction(() => !document.getElementById('overlayPermisosArchivo'));
  await dormir(600);
  // Desplazar el panel hasta que se vea la sección "Restringir Acceso"
  await page.evaluate(() => {
    const c = document.querySelector('#listaBloqueadosContainer');
    if (c) c.scrollIntoView({ block: 'end' });
  });
  await dormir(500);
  await foto('12-restriccion-aplicada');

  // =============== 13 Traer desde Google Drive ===============
  await page.evaluate(() => document.getElementById('btnCancelarModalSubir').click());
  await dormir(800);
  await abrirPanelArchivo();
  await page.evaluate(() => document.querySelector('#panelLateral #tabDrive').click());
  await dormir(800);
  await foto('13-traer-drive');
  await page.evaluate(() => document.getElementById('btnCancelarModalSubir').click());
  await dormir(800);

  // =============== 14 Favoritos / 15 Recientes ===============
  await clic('navFavoritos');
  await page.waitForSelector('#favoritosGrid .apartado-item', { visible: true });
  await estable(900);
  await foto('14-favoritos');

  await clic('navRecientes');
  await page.waitForSelector('#recientesGrid .apartado-item', { visible: true });
  await estable(900);
  await foto('15-recientes');

  // =============== 16 Usuarios / 17 Logs ===============
  await clic('navUsuarios');
  await page.waitForSelector('#usuariosGrid .usuario-fila', { visible: true });
  await estable(1000);
  await foto('16-usuarios');

  await clic('navLogs');
  await page.waitForSelector('#logsGrid .log-fila', { visible: true });
  await estable(900);
  await foto('17-logs');

  // =============== 18 Perfil ===============
  await page.click('#btnPerfil');
  await dormir(500);
  await page.click('#btnVerPerfil');
  await page.waitForSelector('.perfil-container', { visible: true });
  await page.waitForFunction(() => (document.getElementById('perfilEmail')?.textContent || '').includes('@'));
  await dormir(1200);
  await page.evaluate(() => { document.querySelector('.home-content').scrollTop = 0; });
  await dormir(500);
  await foto('18-perfil');

  // =============== 19 Búsqueda global ===============
  await clic('navInicio');
  await dormir(800);
  await page.click('#navbarSearchInput');
  await page.keyboard.type('presupuesto', { delay: 60 });
  await page.waitForSelector('#navbarSearchResultados .busqueda-resultado', { visible: true });
  await dormir(700);
  await foto('19-busqueda', { mantenerMouse: true });
  await page.evaluate(() => { document.getElementById('navbarSearchInput').value = ''; document.getElementById('navbarSearchResultados').classList.remove('abierto'); });
  await page.mouse.click(1150, 30); // cerrar desplegable (zona vacía de la barra superior)

  // =============== 20 Modo oscuro ===============
  await page.click('#btnTema');
  await dormir(1200);
  await foto('20-modo-oscuro');
  await page.click('#btnTema'); // restaurar tema claro

  // ---- Informe ----
  console.log('\nACCIONES VISTAS:', [...accionesVistas].join(', '));
  console.log('SIN MAPEAR:', [...sinMapear].join(', ') || '(ninguna)');
  console.log('PETICIONES EXTERNAS BLOQUEADAS:', [...bloqueadas].join(' | ') || '(ninguna)');
  console.log('ERRORES CONSOLA:\n' + ([...new Set(erroresConsola)].join('\n') || '(ninguno)'));

  await browser.close();
  server.close();
  fs.rmSync(ARCHIVO_TMP, { force: true });

})().catch(e => { console.error('FALLO', e); process.exit(1); });

