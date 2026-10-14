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
  let lentoMs = 0; let archivoExtra = false; let accesoDenegado = false;
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
    if (/script\.google\.com\/macros/.test(u)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
      const b = JSON.parse(req.postData() || '{}');
      let data = b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []);
      if (b.action === 'obtenerDatosInicio') return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: false, message: 'no existe' }) });
      if (b.action === 'obtenerContenidoCarpeta' && data && archivoExtra) data = Object.assign({}, data, { archivos: (data.archivos || []).concat([Object.assign({}, (data.archivos || [{}])[0], { id: 'NUEVO', nombre: 'archivo-nuevo.pdf', extension: 'pdf' })]) });
      if (b.action === 'obtenerCarpetasDelHotel' && accesoDenegado) data = { success: false, message: 'No tienes acceso a los proyectos de este hotel', carpetas: [] };
      const demora = /^obtener(CarpetasDelHotel|ContenidoCarpeta)$/.test(b.action) ? lentoMs : 0;
      return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(1200);
  const abrirHotel = () => page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click());
  const tarjetas = () => page.evaluate(() => document.querySelectorAll('#carpetasGrid .carpeta-card').length);
  const skeletons = () => page.evaluate(() => document.querySelectorAll('.home-content .hotel-carpetas-container #carpetasGrid .carpeta-skeleton').length);

  // 1ª visita: sin copia → esqueleto y luego tarjetas
  await abrirHotel(); await page.waitForSelector('.carpeta-card', { visible: true }); await dormir(400);
  const n1 = await tarjetas(); ok(n1 > 0, '1ª visita al hotel: se cargan ' + n1 + ' áreas');
  // 2ª visita con servidor lento (3 s): se ven al instante gracias a la copia
  lentoMs = 3000;
  await page.evaluate(() => document.getElementById('navInicio').click()); await dormir(300);
  const t0 = Date.now(); await abrirHotel();
  await page.waitForFunction(() => document.querySelectorAll('#carpetasGrid .carpeta-card').length > 0, { timeout: 2500 });
  ok(Date.now() - t0 < 1500 && await skeletons() === 0, '2ª visita con servidor lento (3 s): las áreas aparecen en ' + (Date.now() - t0) + ' ms, sin esqueleto');
  await dormir(3300);
  ok(await tarjetas() === n1, 'al llegar la respuesta del servidor las áreas siguen correctas');

  // Acceso revocado: la copia no puede ocultar el rechazo del servidor
  accesoDenegado = true; lentoMs = 500;
  await page.evaluate(() => document.getElementById('navInicio').click()); await dormir(300);
  await abrirHotel(); await dormir(1500);
  ok(await tarjetas() === 0 && await page.evaluate(() => /acceso|error|No/i.test(document.getElementById('carpetasGrid').innerText)), 'si el servidor niega el acceso, desaparece la copia y se muestra el rechazo');
  accesoDenegado = false; lentoMs = 0;

  // Carpeta → archivos
  await page.evaluate(() => document.getElementById('navInicio').click()); await dormir(300);
  await abrirHotel(); await page.waitForSelector('.carpeta-card', { visible: true });
  await page.evaluate(() => document.querySelector('.carpeta-card').click());
  await page.waitForSelector('.archivos-carpeta-container', { visible: true }); await dormir(800);
  const idCarpeta = await page.evaluate(() => estadoArchivosCarpeta.carpetaActual.id);
  const cant1 = await page.evaluate(() => estadoArchivosCarpeta.archivos.length + estadoArchivosCarpeta.subcarpetas.length);
  ok(cant1 > 0, 'carpeta abierta con ' + cant1 + ' elementos');
  // Volver a entrar con servidor lento: instantáneo
  lentoMs = 3000;
  await page.evaluate(id => { cargarContenidoCarpeta(id, undefined, true); }, idCarpeta);
  await dormir(300);
  ok(await page.evaluate(() => estadoArchivosCarpeta.archivos.length + estadoArchivosCarpeta.subcarpetas.length) === cant1, 'volver a una carpeta ya vista la muestra al instante con servidor lento');
  // Tras modificar (sin copia): NO muestra lo viejo, muestra carga y luego lo nuevo
  archivoExtra = true;
  await page.evaluate(id => { cargarContenidoCarpeta(id); }, idCarpeta); await dormir(300);
  ok(await page.evaluate(() => estadoArchivosCarpeta.cargando === true && estadoArchivosCarpeta.archivos.length === 0), 'tras subir/crear/borrar se pide el dato fresco y no se enseña la copia vieja');
  await dormir(3300);
  ok(await page.evaluate(() => estadoArchivosCarpeta.archivos.some(a => a.id === 'NUEVO')), 'llega el contenido nuevo con el archivo agregado');
  // Y la copia se actualizó con lo nuevo
  lentoMs = 3000; await page.evaluate(id => { cargarContenidoCarpeta(id, undefined, true); }, idCarpeta); await dormir(300);
  ok(await page.evaluate(() => estadoArchivosCarpeta.archivos.some(a => a.id === 'NUEVO')), 'la copia guardada ya incluye el cambio');
  lentoMs = 0; archivoExtra = false; await dormir(3300);

  // Topes del almacenamiento
  const topes = await page.evaluate(() => {
    for (let i = 0; i < 70; i++) guardarCacheVista_('prueba_' + i, { x: i });
    const claves = Object.keys(localStorage).filter(k => k.indexOf('oxoCache:') === 0 && k.indexOf(':idx:') === -1);
    guardarCacheVista_('enorme', { x: 'a'.repeat(200000) });
    return { entradas: claves.length, enorme: localStorage.getItem(claveCacheVista_('enorme')), sesion: !!localStorage.getItem('currentUser') };
  });
  ok(topes.entradas <= 40 && topes.enorme === null && topes.sesion, 'tope de copias: ' + topes.entradas + ' (máx. 40), no guarda entradas enormes y la sesión sigue intacta');
  const cuota = await page.evaluate(() => {
    const original = Storage.prototype.setItem; let primera = true;
    Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('oxoCache:') === 0 && primera) { primera = false; throw new DOMException('lleno', 'QuotaExceededError'); } return original.call(this, k, v); };
    let lanzo = false; try { guardarCacheVista_('cuota', { a: 1 }); } catch (e) { lanzo = true; }
    Storage.prototype.setItem = original;
    return { lanzo, quedan: Object.keys(localStorage).filter(k => k.indexOf('oxoCache:') === 0).length, sesion: !!localStorage.getItem('currentUser') };
  });
  ok(!cuota.lanzo && cuota.quedan === 0 && cuota.sesion, 'si el navegador se queda sin espacio, se borran las copias, no falla nada y la sesión se conserva');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
