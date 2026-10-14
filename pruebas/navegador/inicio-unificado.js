const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };
const INDIVIDUALES = ['obtenerModulosConHoteles', 'obtenerIdsFavoritosUsuario', 'obtenerActividadReciente', 'obtenerFavoritosDetallados'];

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let modo = 'nuevo'; let llamadas = [];
  const errores = [];

  async function escenario(nombre, m) {
    modo = m; llamadas = [];
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on('pageerror', e => errores.push(nombre + ': ' + e.message));
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
      if (/script\.google\.com\/macros/.test(u)) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        const b = JSON.parse(req.postData() || '{}'); llamadas.push(b.action);
        const resp = (o) => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(o) });
        if (b.action === 'obtenerDatosInicio') {
          if (modo === 'viejo') return resp({ success: false, message: 'La función "obtenerDatosInicio" no existe en el backend de Apps Script.' });
          const a = b.args || [];
          const datos = { modulos: responder('obtenerModulosConHoteles', a), idsFavoritos: responder('obtenerIdsFavoritosUsuario', [a[1]]), actividad: responder('obtenerActividadReciente', [a[1], 4]), favoritos: responder('obtenerFavoritosDetallados', [a[1]]) };
          if (modo === 'parcial') datos.favoritos = null;
          return resp({ success: true, data: datos });
        }
        return resp({ success: true, data: b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []) });
      }
      if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, SESION);
    llamadas = [];
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.btn-hotel-carpetas', { timeout: 8000 }); await dormir(1500);
    const ui = await page.evaluate(() => ({
      hoteles: document.querySelectorAll('.btn-hotel-carpetas').length,
      recientes: document.querySelectorAll('#seccionRecientes [data-widget-contenido] > *').length,
      recientesVisible: !document.querySelector('#seccionRecientes [data-widget-contenido]').classList.contains('oculto'),
      favoritosVisible: !document.querySelector('#seccionFavoritos [data-widget-contenido]').classList.contains('oculto'),
      skeletons: document.querySelectorAll('[data-widget-skeleton]:not(.oculto)').length,
      estrellas: typeof _favoritosCache !== 'undefined' ? _favoritosCache.size : -1
    }));
    await page.close();
    return { ui, llamadas: llamadas.slice() };
  }

  const nuevo = await escenario('nuevo', 'nuevo');
  const sueltasNuevo = nuevo.llamadas.filter(a => INDIVIDUALES.includes(a));
  ok(nuevo.llamadas.includes('obtenerDatosInicio') && sueltasNuevo.length === 0, 'backend nuevo: el Inicio se pide con UNA llamada y ninguna de las 4 sueltas → ' + nuevo.llamadas.filter(a => a.startsWith('obtener')).join(', '));
  ok(nuevo.ui.hoteles > 0 && nuevo.ui.recientesVisible && nuevo.ui.favoritosVisible && nuevo.ui.skeletons === 0 && nuevo.ui.estrellas >= 0, 'backend nuevo: sidebar, widgets y estrellas se pintan → ' + JSON.stringify(nuevo.ui));

  const viejo = await escenario('viejo', 'viejo');
  ok(INDIVIDUALES.every(a => viejo.llamadas.includes(a)), 'backend viejo (sin el endpoint): cae a las 4 llamadas de siempre');
  ok(viejo.ui.hoteles > 0 && viejo.ui.recientesVisible && viejo.ui.favoritosVisible && viejo.ui.skeletons === 0, 'backend viejo: todo se pinta igual → ' + JSON.stringify(viejo.ui));

  const parcial = await escenario('parcial', 'parcial');
  ok(parcial.llamadas.includes('obtenerFavoritosDetallados') && !parcial.llamadas.includes('obtenerModulosConHoteles') && !parcial.llamadas.includes('obtenerActividadReciente'), 'respuesta parcial: solo se reintenta la parte que falló (favoritos) → ' + parcial.llamadas.filter(a => a.startsWith('obtener')).join(', '));
  ok(parcial.ui.favoritosVisible && parcial.ui.skeletons === 0, 'respuesta parcial: el widget de favoritos igual se completa');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
