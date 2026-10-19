// Crear, editar y cancelar avisos desde la campana: solo Superadministradores ven los botones; el editor valida antes de enviar.
const http = require('http'), fs = require('fs'), { puppeteer, CHROME, REPO } = require('./_comun');
const { responder, SESION, AVISOS_EJEMPLO } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

const GESTION = () => ({ success: true, avisos: [
  { id: 'AVI-P', titulo: 'Programado de ejemplo', mensaje: 'Se enviará pronto', enlaces: [{ texto: 'Ir', tipo: 'url', url: 'https://example.com/x' }, { texto: 'Carpeta IT', tipo: 'carpeta', id: 'C-H1-3', idHotel: 'H1', nombre: 'IT', nombreHotel: 'Hotel Bari' }],
    audiencia: { tipo: 'roles', roles: [2, 3] }, audienciaTexto: 'Roles: Administradores, Superadministradores', estado: 'Programado', programadoPara: new Date(Date.now() + 86400000).toISOString(), caducaEn: null, creadoPor: 'Carolina Ruiz', destinatarios: 3, vistos: 0, editable: true },
  { id: 'AVI-E', titulo: 'Enviado de ejemplo', mensaje: 'Ya salió', enlaces: [], audiencia: { tipo: 'todos' }, audienciaTexto: 'Todas las personas', estado: 'Enviado', programadoPara: new Date(Date.now() - 86400000).toISOString(), caducaEn: null, creadoPor: 'Carolina Ruiz', destinatarios: 12, vistos: 5, editable: false },
  { id: 'AVI-C', titulo: 'Cancelado de ejemplo', mensaje: 'x', enlaces: [], audiencia: { tipo: 'todos' }, audienciaTexto: 'Todas las personas', estado: 'Cancelado', programadoPara: new Date(Date.now() - 2 * 86400000).toISOString(), caducaEn: null, creadoPor: 'Carolina Ruiz', destinatarios: 12, vistos: 1, editable: false }
] });

async function abrirPagina(browser, server, rol) {
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
      if (b.action === 'validarCredenciales') data = { success: true, user: Object.assign({}, SESION, { ID_Rol: rol, Rol_ID: rol, Rol: rol === 3 ? 'Superadministrador' : 'Usuario' }) };
      else if (['registrarAuditoria', 'cerrarSesionUsuario'].includes(b.action)) data = { success: true };
      else if (b.action === 'obtenerAvisosGestion') data = GESTION();
      else if (b.action === 'crearAviso') data = { success: true, id: 'AVI-NUEVO', message: b.args[0].programadoPara ? 'Aviso programado' : 'Aviso enviado' };
      else if (b.action === 'editarAviso') data = { success: true, message: 'Aviso actualizado' };
      else if (b.action === 'cancelarAviso') data = { success: true, message: 'Aviso cancelado' };
      else data = responder(b.action, b.args || []);
      return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) });
    }
    if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#loginEmail', 'cruiz@oxohotel.com'); await page.type('#loginPassword', 'cualquiera1');
  await page.click('#loginBtn');
  await page.waitForSelector('.btn-hotel-carpetas'); await dormir(2800);
  return { page, errores, llamadas };
}

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // ---- Un usuario normal no ve los botones
  console.log('--- Rol 1 ---');
  let { page, errores } = await abrirPagina(browser, server, 1);
  await page.click('#btnNotificaciones'); await dormir(400);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('avisosAdminBotones')).display === 'none'), '1. un usuario normal NO ve «Nuevo» ni «Gestionar» en la campana');
  await page.close();

  // ---- Superadministrador
  console.log('\n--- Rol 3 ---');
  let llamadas; ({ page, errores, llamadas } = await abrirPagina(browser, server, 3));
  await page.click('#btnNotificaciones'); await dormir(400);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('avisosAdminBotones')).display !== 'none'), '2. el superadministrador ve «Nuevo» y «Gestionar»');

  await page.click('#btnAvisoNuevo'); await page.waitForSelector('#avTitulo', { visible: true, timeout: 8000 }); await dormir(300);
  ok(await page.evaluate(() => !document.getElementById('notifDropdown').classList.contains('abierto')), '3. «Nuevo» abre el editor y cierra el panel de la campana');
  const guardar = () => page.evaluate(() => document.getElementById('avGuardar').click());
  const error = () => page.evaluate(() => document.getElementById('avError').textContent);
  llamadas.length = 0;

  await guardar(); await dormir(200);
  ok(await error() === 'Escribe un título' && !llamadas.some(l => l.action === 'crearAviso'), '3b. sin título muestra «' + await error() + '» y no envía nada');
  await page.type('#avTitulo', 'Cierre del sistema');
  await guardar(); await dormir(200);
  ok(await error() === 'Escribe el mensaje', '3c. sin mensaje lo pide');
  await page.type('#avMensaje', 'Línea 1\nLínea 2');
  ok(await page.evaluate(() => document.getElementById('avContador').textContent === '15 / 2000'), '3d. el contador de caracteres se actualiza');
  ok(await page.evaluate(() => /Cierre del sistema/.test(document.getElementById('avVista').innerText) && /Línea 1/.test(document.getElementById('avVista').innerText)), '3e. la vista previa muestra lo que se escribe');

  // Enlaces
  await page.evaluate(() => document.getElementById('avAgregarEnlace').click()); await dormir(200);
  await page.type('#avEnlaces [data-campo="texto"]', 'Ver aviso'); await page.type('#avEnlaces [data-campo="url"]', 'http://inseguro.com');
  await guardar(); await dormir(200);
  ok(/https/.test(await error()), '4. un enlace http se rechaza antes de enviar: «' + await error() + '»');
  await page.evaluate(() => { const i = document.querySelector('#avEnlaces [data-campo="url"]'); i.value = 'https://example.com/aviso'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => document.getElementById('avAgregarEnlace').click()); await dormir(200);
  await page.evaluate(() => { const f = document.querySelectorAll('#avEnlaces .aviso-enlace-fila')[1]; const t = f.querySelector('[data-campo="texto"]'); t.value = 'Carpeta TI'; t.dispatchEvent(new Event('input', { bubbles: true })); const s = f.querySelector('[data-campo="tipo"]'); s.value = 'carpeta'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await dormir(300);
  await page.evaluate(() => { const s = document.querySelectorAll('#avEnlaces .aviso-enlace-fila')[1].querySelector('[data-campo="idHotelCarpeta"]'); s.value = 'H1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await dormir(900);
  ok(await page.evaluate(() => document.querySelectorAll('#avEnlaces .aviso-enlace-fila')[1].querySelector('[data-campo="idCarpeta"]').options.length > 1), '4b. al elegir la propiedad se cargan sus carpetas para elegir (' + llamadas.filter(l => l.action === 'obtenerCarpetasDelHotel').length + ' llamada)');
  await guardar(); await dormir(200);
  ok(/Elige la carpeta/.test(await error()), '4c. una carpeta sin elegir se avisa: «' + await error() + '»');
  await page.evaluate(() => { const s = document.querySelectorAll('#avEnlaces .aviso-enlace-fila')[1].querySelector('[data-campo="idCarpeta"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); });

  // Audiencia
  await page.evaluate(() => document.querySelector('input[name="avAud"][value="roles"]').click()); await dormir(200);
  await guardar(); await dormir(200);
  ok(/rol/.test(await error()), '5. «Por rol» sin elegir ninguno se avisa: «' + await error() + '»');
  await page.evaluate(() => document.querySelector('input[name="avAud"][value="propiedades"]').click()); await dormir(200);
  await page.type('#avBuscar', 'Bari'); await dormir(200);
  ok(await page.evaluate(() => document.querySelectorAll('#avLista [data-id]').length >= 1 && document.querySelectorAll('#avLista [data-id]').length < 6), '5b. el buscador de propiedades filtra la lista');
  await page.evaluate(() => document.querySelector('#avLista [data-id]').click()); await dormir(200);
  ok(await page.evaluate(() => document.querySelectorAll('#avSeleccion .aviso-chip').length === 1), '5c. la propiedad elegida queda como etiqueta');
  await page.evaluate(() => document.querySelector('input[name="avAud"][value="personas"]').click()); await dormir(200);
  await page.type('#avBuscar', 'Carolina'); await dormir(200);
  await page.evaluate(() => document.querySelector('#avLista [data-id]').click()); await dormir(200);
  ok(await page.evaluate(() => document.querySelectorAll('#avSeleccion .aviso-chip').length === 1), '5d. «Personas concretas»: se busca por nombre y se elige');

  // Programar
  await page.evaluate(() => document.querySelector('input[name="avEnvio"][value="programar"]').click()); await dormir(200);
  ok(await page.evaluate(() => document.getElementById('avGuardar').textContent === 'Programar aviso' && !document.getElementById('avFecha').disabled), '6. «Programar» cambia el botón y habilita la fecha');
  await guardar(); await dormir(200);
  ok(/fecha y hora/.test(await error()), '6b. sin fecha se avisa: «' + await error() + '»');
  const futuro = new Date(Date.now() + 3 * 3600000); const p2 = n => String(n).padStart(2, '0');
  const valorFecha = futuro.getFullYear() + '-' + p2(futuro.getMonth() + 1) + '-' + p2(futuro.getDate()) + 'T' + p2(futuro.getHours()) + ':' + p2(futuro.getMinutes());
  await page.evaluate(v => { const i = document.getElementById('avFecha'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, valorFecha);
  await page.evaluate(() => document.querySelector('input[name="avEnvio"][value="ahora"]').click()); await dormir(200);
  ok(await page.evaluate(() => document.getElementById('avGuardar').textContent === 'Enviar aviso'), '6c. volver a «Enviar ahora» cambia el botón a «Enviar aviso»');
  await page.evaluate(() => document.querySelector('input[name="avEnvio"][value="programar"]').click()); await dormir(200);

  llamadas.length = 0;
  await guardar(); await dormir(900);
  const c = llamadas.find(l => l.action === 'crearAviso');
  ok(!!c && c.token && c.args[0].titulo === 'Cierre del sistema' && c.args[0].mensaje === 'Línea 1\nLínea 2', '7. se envía crearAviso con la sesión y el texto (' + (c ? c.args[0].titulo : 'no se envió') + ')');
  ok(c && c.args[0].enlaces.length === 2 && c.args[0].enlaces[0].tipo === 'url' && c.args[0].enlaces[0].url === 'https://example.com/aviso' && c.args[0].enlaces[1].tipo === 'carpeta' && c.args[0].enlaces[1].id, '7b. con sus dos enlaces (uno externo https y otro a una carpeta)');
  ok(c && c.args[0].audiencia.tipo === 'personas' && c.args[0].audiencia.personas.length === 1, '7c. con la audiencia elegida por último (personas concretas)');
  ok(c && c.args[0].programadoPara && Math.abs(new Date(c.args[0].programadoPara).getTime() - futuro.getTime()) < 120000 && c.args[0].caducaEn === null, '7d. con la fecha de envío elegida y sin caducidad');
  ok(await page.evaluate(() => !document.getElementById('overlayAvisoEditor') && /Aviso programado/.test(document.body.innerText)), '7e. el editor se cierra y avisa «Aviso programado»');
  ok(llamadas.some(l => l.action === 'obtenerAvisos'), '7f. la campana se vuelve a leer');

  // Gestionar
  await dormir(2800); // el aviso de «programado» se retira solo: mientras está a la vista cubre los botones de la campana
  await page.click('#btnNotificaciones'); await dormir(300);
  llamadas.length = 0;
  await page.click('#btnAvisoGestionar'); await page.waitForSelector('.aviso-gestion-item', { visible: true, timeout: 8000 }); await dormir(300);
  const filas = await page.evaluate(() => Array.from(document.querySelectorAll('.aviso-gestion-item')).map(f => ({ t: f.querySelector('strong').innerText, e: f.querySelector('.aviso-estado').innerText, editar: !!f.querySelector('[data-accion="editar"]'), cancelar: !!f.querySelector('[data-accion="cancelar"]'), texto: f.innerText })));
  ok(filas.length === 3 && filas[0].e === 'Programado' && filas[1].e === 'Enviado' && filas[2].e === 'Cancelado', '8. la lista muestra el estado de cada aviso: ' + filas.map(f => f.e).join(', '));
  ok(filas[0].editar && !filas[1].editar && !filas[2].editar, '8b. solo el programado se puede editar');
  ok(filas[0].cancelar && filas[1].cancelar && !filas[2].cancelar, '8c. se pueden cancelar el programado y el enviado, no uno ya cancelado');
  ok(/12 persona\(s\)/.test(filas[1].texto) && /5 ya lo vieron/.test(filas[1].texto) && /Todas las personas/.test(filas[1].texto), '8d. muestra a cuántas personas llegó y cuántas lo vieron');

  // Cancelar con confirmación
  llamadas.length = 0;
  await page.evaluate(() => document.querySelector('.aviso-gestion-item [data-accion="cancelar"]').click()); await dormir(400);
  ok(await page.evaluate(() => !!document.getElementById('confirmacionGenericaConfirmar')) && !llamadas.some(l => l.action === 'cancelarAviso'), '9. cancelar pide confirmación y todavía no cancela');
  await page.evaluate(() => document.getElementById('confirmacionGenericaConfirmar').click()); await dormir(900);
  ok(llamadas.some(l => l.action === 'cancelarAviso' && l.args[0] === 'AVI-P'), '9b. al confirmar se cancela ese aviso');

  // Editar
  llamadas.length = 0;
  await page.evaluate(() => document.querySelector('.aviso-gestion-item [data-accion="editar"]').click()); await page.waitForSelector('#avTitulo', { visible: true, timeout: 8000 }); await dormir(500);
  const pre = await page.evaluate(() => ({ titulo: document.getElementById('avTitulo').value, mensaje: document.getElementById('avMensaje').value, aud: document.querySelector('input[name="avAud"]:checked').value, enlaces: document.querySelectorAll('#avEnlaces .aviso-enlace-fila').length, boton: document.getElementById('avGuardar').textContent, programar: document.querySelector('input[name="avEnvio"]:checked').value }));
  ok(pre.titulo === 'Programado de ejemplo' && pre.mensaje === 'Se enviará pronto' && pre.aud === 'roles' && pre.enlaces === 2 && pre.boton === 'Guardar cambios' && pre.programar === 'programar', '10. editar abre el aviso con todo precargado: ' + JSON.stringify(pre));
  await page.evaluate(() => { const t = document.getElementById('avTitulo'); t.value = 'Título corregido'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => document.getElementById('avGuardar').click()); await dormir(900);
  const ed = llamadas.find(l => l.action === 'editarAviso');
  ok(!!ed && ed.args[0] === 'AVI-P' && ed.args[1].titulo === 'Título corregido' && ed.args[1].audiencia.roles.sort().join() === '2,3', '10b. se guarda con editarAviso sobre ese aviso y su audiencia intacta');

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
