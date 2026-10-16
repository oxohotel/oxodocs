// Privacidad de un archivo YA publicado: el candado de la tarjeta abre las opciones con el estado actual y "Aplicar" lo guarda.
// (Antes el botón no hacía nada: la función que lo abría no existía.)
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, REPO } = require('./_comun');
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
  const llamadas = []; let restringidosActuales = []; let permisosFalla = null;
  const usuarios = responder('obtenerListaUsuariosParaPermisos', []).usuarios;
  const idActual = String(SESION.ID_Usuario);
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
      else if (b.action === 'obtenerPermisosDeArchivo') data = permisosFalla ? { success: false, message: permisosFalla } : { success: true, restringidos: restringidosActuales };
      else if (b.action === 'actualizarPermisosExistentes') { restringidosActuales = (b.args[2] || []).map(String); data = { success: true, message: 'Permisos actualizados correctamente' }; }
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
  await page.evaluate(() => document.querySelector('.btn-hotel-carpetas[data-hotel-id="H1"]').click());
  await page.waitForSelector('.carpeta-card', { visible: true }); await dormir(400);
  await page.evaluate(() => document.querySelector('.carpeta-card').click()); await dormir(1500);

  const abrirCandado = async () => { await page.evaluate(() => document.querySelector('[data-accion="privacidad-archivo"]').click()); await dormir(900); };
  const estadoModal = () => page.evaluate(() => {
    const o = document.getElementById('overlayPermisosArchivo');
    if (!o) return null;
    const r = o.querySelector('input[name="privacidad"]:checked');
    return { opcion: r ? r.value : null, texto: o.innerText.replace(/\s+/g, ' ') };
  });

  // 1) Archivo sin restricciones: abre con "Todos"
  restringidosActuales = []; llamadas.length = 0;
  ok(await page.evaluate(() => !!document.querySelector('[data-accion="privacidad-archivo"]')), '1. la tarjeta del archivo tiene el candado de privacidad');
  await abrirCandado();
  let m = await estadoModal();
  ok(m && m.opcion === 'todos', '1b. el candado abre la privacidad del archivo publicado, hoy con "Todos" (opción: ' + (m && m.opcion) + ')');
  ok(llamadas.some(l => l.action === 'obtenerPermisosDeArchivo'), '1c. se consultó al servidor cómo está hoy ese archivo');
  ok(m && /Archivo|\.pdf|\.docx|\.xlsx|\.pptx/i.test(m.texto), '1d. el panel muestra de qué archivo se trata');

  // 2) Cambiar a "Solo yo" y aplicar: se restringe a todos los demás
  await page.evaluate(() => document.querySelector('input[name="privacidad"][value="nadie"]').click()); await dormir(300);
  llamadas.length = 0;
  await page.evaluate(() => document.querySelector('#overlayPermisosArchivo .btn-guardar-principal').click()); await dormir(900);
  const guardado = llamadas.find(l => l.action === 'actualizarPermisosExistentes');
  const otros = usuarios.map(u => String(u.id)).filter(id => id !== idActual).sort().join();
  ok(!!guardado && guardado.args[0] && (guardado.args[2] || []).map(String).sort().join() === otros, '2. "Solo yo" → se guarda en el archivo ya publicado la lista de todos los demás (' + (guardado ? (guardado.args[2] || []).length : 0) + ' personas)');
  ok(await page.evaluate(() => !document.getElementById('overlayPermisosArchivo')), '2b. el panel se cierra al aplicar');
  ok(await page.evaluate(() => /Privacidad actualizada/.test(document.body.innerText)), '2c. avisa "Privacidad actualizada correctamente"');
  ok(!llamadas.some(l => l.action === 'guardarArchivoEnDrive'), '2d. NO sube ni duplica el archivo: solo cambia su privacidad');

  // 3) Volver a abrirlo: ahora aparece como "Solo yo"
  await abrirCandado(); m = await estadoModal();
  ok(m && m.opcion === 'nadie', '3. al volver a abrir el candado el archivo aparece como "Solo yo" (opción: ' + (m && m.opcion) + ')');

  // 4) Cambiar a "Todos" y aplicar
  await page.evaluate(() => document.querySelector('input[name="privacidad"][value="todos"]').click()); await dormir(300);
  llamadas.length = 0;
  await page.evaluate(() => document.querySelector('#overlayPermisosArchivo .btn-guardar-principal').click()); await dormir(900);
  const todos = llamadas.find(l => l.action === 'actualizarPermisosExistentes');
  ok(!!todos && (todos.args[2] || []).length === 0, '4. volver a "Todos" guarda una lista vacía: se levantan las restricciones');

  // 5) Con unas pocas personas restringidas: "Todos, excepto…" con la cuenta correcta
  restringidosActuales = [String(usuarios.filter(u => String(u.id) !== idActual)[0].id), String(usuarios.filter(u => String(u.id) !== idActual)[1].id)];
  await abrirCandado(); m = await estadoModal();
  ok(m && m.opcion === 'excepto' && /2 excluido/.test(m.texto), '5. con 2 personas restringidas abre como "Todos, excepto…" mostrando 2 excluidos (opción ' + (m && m.opcion) + ')');
  await page.evaluate(() => document.querySelector('#overlayPermisosArchivo .btn-cerrar-modal').click()); await dormir(400);
  llamadas.length = 0;
  ok(await page.evaluate(() => !document.getElementById('overlayPermisosArchivo')) && !llamadas.some(l => l.action === 'actualizarPermisosExistentes'), '5b. cerrar sin aplicar no cambia nada');

  // 6) Sin permiso: el servidor lo rechaza y se avisa, sin abrir un panel vacío
  permisosFalla = 'Solo el creador (Ana) o un Administrador puede hacer esto.';
  await abrirCandado();
  ok(await page.evaluate(() => !document.getElementById('overlayPermisosArchivo') && /Solo el creador/.test(document.body.innerText)), '6. si no tiene permiso se muestra el motivo y no se abre el panel');
  permisosFalla = null;

  // 7) El selector de la SUBIDA no queda pegado al de un archivo publicado
  await page.evaluate(() => { estadoPermisos_.modoEdicion = true; estadoPermisos_.archivoEdicion = 'X'; abrirSelectorPermisosArchivo(); }); await dormir(900);
  ok(await page.evaluate(() => estadoPermisos_.modoEdicion === false && estadoPermisos_.archivoEdicion === null), '7. abrir el selector de una subida nueva sale del modo de edición (no cambia por error la privacidad de otro archivo)');
  await page.evaluate(() => cerrarModalPermisos_());

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
