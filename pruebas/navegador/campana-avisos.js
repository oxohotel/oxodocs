// La campana de avisos: contador de nuevos, lista, marcar como vistos al abrirla, enlaces (externos e internos) y texto escapado.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, REPO } = require('./_comun');
const { responder, SESION, AVISOS_EJEMPLO } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

(async () => {
  // Un aviso con HTML malicioso: debe verse como texto
  AVISOS_EJEMPLO.lista.push({ id: 'AVI-X', titulo: '<img src=x onerror="window.__xss=1">Título', mensaje: '<b>negrita</b> <script>window.__xss=2</script>', enlaces: [], horas: 200, nuevo: false });
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
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
      if (b.action === 'validarCredenciales') data = { success: true, user: SESION };
      else if (['registrarAuditoria', 'cerrarSesionUsuario'].includes(b.action)) data = { success: true };
      else data = responder(b.action, b.args || []);
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(2500);

  const punto = () => page.evaluate(() => { const d = document.querySelector('#btnNotificaciones .icon-btn-dot'); return !!d && getComputedStyle(d).display !== 'none'; });
  ok(llamadas.some(l => l.action === 'obtenerAvisos' && l.token), '1. al entrar se piden los avisos de la persona (con su sesión)');
  ok(await punto(), '1b. hay avisos nuevos: la campana muestra el punto');
  ok(!(await page.evaluate(() => /Políticas Corporativas 2026|Informe Trimestral de Gestión Q2/.test(document.body.innerText))), '1c. ya no están los datos de ejemplo inventados que había antes');

  // Abrir la campana
  llamadas.length = 0;
  await page.click('#btnNotificaciones'); await dormir(500);
  const lista = await page.evaluate(() => Array.from(document.querySelectorAll('#notifLista .aviso')).map(a => ({ titulo: a.querySelector('.aviso-titulo').innerText.trim(), nuevo: a.classList.contains('aviso-nuevo'), enlaces: a.querySelectorAll('.aviso-enlace').length, tiempo: a.querySelector('.notif-time').innerText })));
  ok(lista.length === 4 && lista[0].titulo === 'Mantenimiento programado' && lista[0].tiempo === 'Hace 1 hora', '2. la lista muestra los avisos, el más reciente primero, con su antigüedad (' + lista.map(a => a.titulo.slice(0, 18) + ' [' + a.tiempo + ']').join(' · ') + ')');
  ok(lista[0].nuevo && lista[1].nuevo && !lista[2].nuevo, '2b. los nuevos van resaltados y los ya vistos no');
  ok(lista[0].enlaces === 1 && lista[1].enlaces === 2 && lista[2].enlaces === 0, '2c. cada aviso muestra sus enlaces como botones');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.aviso-mensaje')).whiteSpace === 'pre-line'), '2d. los saltos de línea del mensaje se respetan');
  ok(!(await page.evaluate(() => ('__xss' in window))), '2e. el HTML de un aviso NO se ejecuta');
  ok(await page.evaluate(() => document.querySelector('#notifLista').innerText.includes('<b>negrita</b>') && !document.querySelector('#notifLista b')), '2f. se muestra tal cual como texto (escapado), sin interpretarlo');

  // Se marcan como vistos
  await dormir(1800);
  ok(llamadas.filter(l => l.action === 'marcarAvisosVistos').length === 1 && llamadas.find(l => l.action === 'marcarAvisosVistos').token, '3. al abrir la campana se marcan como vistos (una sola llamada, con su sesión)');
  ok(!(await punto()), '3b. el punto desaparece');
  ok(await page.evaluate(() => document.querySelector('#notifLista .aviso-nuevo') !== null), '3c. pero la lista conserva la marca de "nuevo" mientras sigue abierta');

  // Cerrar y volver a abrir: no vuelve a pedir ni a marcar
  await page.evaluate(() => document.body.click()); await dormir(300);
  llamadas.length = 0;
  await page.click('#btnNotificaciones'); await dormir(1800);
  ok(!llamadas.some(l => l.action === 'obtenerAvisos' || l.action === 'marcarAvisosVistos'), '4. abrirla otra vez en menos de 2 minutos no vuelve a pedir ni a marcar nada');

  // Enlaces
  await page.evaluate(() => { window.__abiertos = []; window.open = (u, t, f) => { window.__abiertos.push([u, t, f]); return null; }; });
  await page.evaluate(() => document.querySelector('.aviso-enlace[data-aviso="0"][data-enlace="0"]').click()); await dormir(300);
  const ab = await page.evaluate(() => window.__abiertos);
  ok(ab.length === 1 && ab[0][0] === 'https://example.com/mantenimiento' && ab[0][1] === '_blank' && /noopener/.test(ab[0][2]), '5. un enlace externo se abre en otra pestaña con noopener');
  await page.evaluate(() => { const a = estadoAvisos_.avisos[0]; a.enlaces[0].url = 'javascript:alert(1)'; abrirEnlaceDeAviso_(a.enlaces[0]); });
  ok((await page.evaluate(() => window.__abiertos.length)) === 1, '5b. un enlace que no sea https nunca se abre, aunque llegara a la lista');

  await page.click('#btnNotificaciones'); await dormir(300);
  await page.evaluate(() => document.querySelector('.aviso-enlace[data-aviso="1"][data-enlace="0"]').click());
  await page.waitForSelector('.carpeta-card', { visible: true, timeout: 8000 }); await dormir(500);
  ok(await page.evaluate(() => /Hotel Bari/.test(document.getElementById('hotelCarpetasTitulo').innerText) && !document.getElementById('notifDropdown').classList.contains('abierto')), '6. un enlace a una propiedad abre sus carpetas y cierra la campana');

  await page.click('#btnNotificaciones'); await dormir(300);
  llamadas.length = 0;
  await page.evaluate(() => document.querySelector('.aviso-enlace[data-aviso="1"][data-enlace="1"]').click()); await dormir(1500);
  ok(llamadas.some(l => l.action === 'obtenerContenidoCarpeta' && l.args[0] === 'C-H1-3'), '7. un enlace a una carpeta la abre directamente (pide su contenido)');

  // Recargar con la lista vacía
  AVISOS_EJEMPLO.lista.length = 0;
  await page.evaluate(() => document.getElementById('btnRecargar').click()); await dormir(4000);
  await page.evaluate(() => document.body.click()); await dormir(300); // se cierra lo que haya abierto para que el clic siguiente la abra
  await page.click('#btnNotificaciones'); await dormir(500);
  ok(await page.evaluate(() => /No tienes avisos por ahora/.test(document.getElementById('notifLista').innerText)), '8. sin avisos se ve un mensaje claro, sin punto');
  ok(!(await punto()), '8b. y sin punto');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
