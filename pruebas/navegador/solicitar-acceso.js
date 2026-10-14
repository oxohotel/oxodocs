const http = require('http'), fs = require('fs'), { puppeteer, CHROME, CAPTURAS, REPO } = require('./_comun');
const { responder, SESION } = require(REPO + 'manual/fuente/mock-data.js');
const dormir = ms => new Promise(r => setTimeout(r, ms));
let fallos = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) fallos++; };

const USUARIO_NORMAL = Object.assign({}, SESION, { ID_Usuario: '7', Nombre_Completo: 'Persona Normal', Email: 'normal@oxohotel.com', ID_Rol: 1, Rol_ID: 1, Rol: 'Usuario', token: 'tok-normal' });
const HOTELES = [
  { idHotel: 'H2', nombre: '84DC', modulo: 'Hoteles en operación' },
  { idHotel: 'H3', nombre: 'Pop Art Tocancipá', modulo: 'Hoteles en pre-apertura' },
  { idHotel: 'H5', nombre: 'Hotel Futuro', modulo: 'Hoteles en desarrollo' },
  { idHotel: 'HC', nombre: 'Corporativo', modulo: 'Corporativo' }
];
const MIS_ACCESOS = () => ({ success: true, tieneTodos: false, permitidos: [{ idHotel: 'H1', nombre: 'Distrito', modulo: 'Hoteles en operación' }],
  pendientes: [{ idHotel: 'H9', nombre: 'Double Tree', modulo: 'Hoteles en pre-apertura' }], disponibles: HOTELES });

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(REPO + 'dist/index.html')); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errores = []; let llamadas = []; let misAccesos = MIS_ACCESOS(); let sinHoteles = false; let lentoMis = 0;

  async function nuevaPagina(sesion) {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 950 });
    await page.setRequestInterception(true);
    page.on('pageerror', e => errores.push(e.message));
    page.on('request', req => {
      const u = req.url();
      if (u.startsWith('http://127.0.0.1') || u.startsWith('data:')) return req.continue();
      if (/script\.google\.com\/macros/.test(u)) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
        const b = JSON.parse(req.postData() || '{}'); llamadas.push({ a: b.action, args: b.args });
        let data; let demora = 0;
        if (b.action === 'obtenerMisAccesos') { data = misAccesos; demora = lentoMis; }
        else if (b.action === 'solicitarAccesoPropiedades') data = { success: true, message: 'Solicitud enviada: 84DC, Pop Art Tocancipá. El administrador de cada propiedad la revisará.' };
        else if (b.action === 'cancelarSolicitudesPropias') data = { success: true, message: 'Solicitud cancelada', canceladas: (b.args || [])[1] };
        else if (b.action === 'obtenerDatosInicio') {
          const a = b.args || []; let modulos = responder('obtenerModulosConHoteles', a);
          if (sinHoteles) modulos = modulos.map(m => Object.assign({}, m, { hoteles: [] }));
          data = { modulos, idsFavoritos: responder('obtenerIdsFavoritosUsuario', [a[1]]), actividad: responder('obtenerActividadReciente', [a[1], 4]), favoritos: responder('obtenerFavoritosDetallados', [a[1]]), pendientes: null };
        }
        else data = b.action === 'registrarAuditoria' ? { success: true } : responder(b.action, b.args || []);
        return setTimeout(() => req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, data }) }), demora);
      }
      if (/fonts\.g|acabrales-oxohotel/.test(u)) return req.continue(); req.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('currentUser', JSON.stringify(s)); localStorage.setItem('appCacheVersion', JSON.stringify('1')); }, sesion);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#navInicio'); await dormir(1500);
    return page;
  }
  const cuenta = a => llamadas.filter(l => l.a === a).length;
  const panelAbierto = page => page.evaluate(() => !!document.getElementById('panelLateralOverlay') && document.getElementById('panelLateralOverlay').classList.contains('active'));
  const abrirDesdeMenu = async page => { await page.evaluate(() => document.getElementById('btnPerfil').click()); await dormir(200); await page.evaluate(() => document.getElementById('btnSolicitarAccesoNavbar').click()); await dormir(600); };

  // ================= A. Desde el menú del usuario
  let page = await nuevaPagina(USUARIO_NORMAL);
  ok(await page.evaluate(() => { const b = document.getElementById('btnSolicitarAccesoNavbar'); return !!b && /Solicitar acceso/.test(b.textContent); }), 'A1. el menú del usuario tiene la opción "Solicitar acceso"');
  llamadas = [];
  await abrirDesdeMenu(page);
  ok(await panelAbierto(page) && await page.evaluate(() => document.getElementById('panelLateralTitulo').textContent === 'Solicitar acceso') && cuenta('obtenerMisAccesos') === 1, 'A2. se abre el panel "Solicitar acceso" y pide al servidor los accesos de la persona');
  ok(await page.evaluate(() => !document.getElementById('perfilDropdown').classList.contains('abierto')), 'A2b. el menú del usuario se cierra al elegir la opción');
  const grupos = await page.evaluate(() => [...document.querySelectorAll('#accesoLista .propiedades-grupo')].map(e => e.textContent));
  ok(grupos.join() === 'Hoteles en operación,Hoteles en pre-apertura,Hoteles en desarrollo,Corporativo', 'A3. se ofrecen TODAS las propiedades agrupadas, incluidas pre-apertura y desarrollo → ' + grupos.join(' / '));
  ok(await page.evaluate(() => [...document.querySelectorAll('.acceso-pendiente .solicitud-nombre')].map(e => e.textContent).join() === 'Double Tree' && !!document.querySelector('.btn-cancelar-solicitud')), 'A4. se ven las solicitudes pendientes (Double Tree) con su botón Cancelar');
  ok(await page.evaluate(() => ![...document.querySelectorAll('#accesoLista span')].some(e => e.textContent === 'Distrito' || e.textContent === 'Double Tree')), 'A5. no se ofrece lo que ya tiene (Distrito) ni lo que ya pidió (Double Tree)');
  await page.screenshot({ path: CAPTURAS + '/panel-solicitar-acceso.png' });
  await page.type('#accesoBuscar', 'TOCANCIPA'); await dormir(150);
  ok(await page.evaluate(() => [...document.querySelectorAll('#accesoLista .propiedad-item')].filter(e => !e.hidden).map(e => e.innerText.trim()).join() === 'Pop Art Tocancipá' && [...document.querySelectorAll('#accesoLista .propiedades-grupo')].filter(e => !e.hidden).length === 1), 'A6. el buscador filtra ignorando mayúsculas y tildes y oculta los grupos sin resultados');
  await page.evaluate(() => { const b = document.getElementById('accesoBuscar'); b.value = ''; b.dispatchEvent(new Event('input')); });
  llamadas = [];
  await page.evaluate(() => document.getElementById('btnAccesoEnviar').click()); await dormir(300);
  ok(cuenta('solicitarAccesoPropiedades') === 0 && await page.evaluate(() => /al menos una propiedad/.test(document.body.innerText)), 'A7. sin elegir ninguna no se envía y se pide elegir');
  await page.evaluate(() => { document.querySelector('#accesoLista input[value="H2"]').click(); document.querySelector('#accesoLista input[value="H3"]').click(); }); await dormir(100);
  ok(await page.evaluate(() => /2 seleccionadas/.test(document.getElementById('accesoContador').textContent)), 'A8. el contador muestra cuántas lleva marcadas');
  await page.evaluate(() => document.getElementById('btnAccesoEnviar').click()); await dormir(900);
  const env = llamadas.find(l => l.a === 'solicitarAccesoPropiedades');
  ok(env && env.args[0] === 'tok-normal' && JSON.stringify(env.args[1]) === '["H2","H3"]', 'A9. se envían las dos propiedades con el token de la sesión (no el id de la persona) → ' + JSON.stringify(env && env.args));
  ok(!(await panelAbierto(page)) && await page.evaluate(() => /Solicitud enviada/.test(document.body.innerText)), 'A10. se muestra la confirmación del servidor y el panel se cierra');

  // Cancelar una pendiente
  llamadas = [];
  await abrirDesdeMenu(page);
  await page.evaluate(() => document.querySelector('.btn-cancelar-solicitud').click()); await dormir(900);
  const canc = llamadas.find(l => l.a === 'cancelarSolicitudesPropias');
  ok(canc && canc.args[0] === 'tok-normal' && JSON.stringify(canc.args[1]) === '["H9"]' && cuenta('obtenerMisAccesos') >= 2 && await panelAbierto(page), 'A11. cancelar una solicitud la envía al servidor y el panel se vuelve a pintar con la lista al día');
  await page.evaluate(() => document.getElementById('btnAccesoCerrar').click()); await dormir(200);
  ok(!(await panelAbierto(page)), 'A12. el botón Cerrar cierra el panel');

  // Cerrar el panel antes de que lleguen los datos: la respuesta tardía no debe pisar OTRO panel abierto después
  lentoMis = 1200; llamadas = [];
  await abrirDesdeMenu(page); await page.evaluate(() => cerrarPanelLateral());
  await page.evaluate(() => abrirPanelLateral({ titulo: 'Otro panel', html: '<div id=\"otroPanel\">contenido propio</div>' })); await dormir(1800);
  ok(await page.evaluate(() => !!document.getElementById('otroPanel') && document.getElementById('panelLateralTitulo').textContent === 'Otro panel' && !document.getElementById('panelAccesoRaiz')), 'A13. si se cierra el panel mientras cargaba, la respuesta tardía NO pisa el panel que se abrió después');
  await page.evaluate(() => cerrarPanelLateral());
  lentoMis = 0;

  // Error del servidor
  misAccesos = { success: false, message: 'Tu cuenta no está activa' };
  await abrirDesdeMenu(page);
  ok(await page.evaluate(() => /Tu cuenta no está activa/.test(document.getElementById('panelAccesoRaiz').innerText)), 'A14. si el servidor rechaza, se muestra su mensaje en el panel');
  await page.evaluate(() => cerrarPanelLateral());

  // Quien ya tiene todo
  misAccesos = { success: true, tieneTodos: true, permitidos: [], pendientes: [], disponibles: [] };
  await abrirDesdeMenu(page);
  ok(await page.evaluate(() => /todas las propiedades/.test(document.getElementById('panelAccesoRaiz').innerText) && !document.getElementById('btnAccesoEnviar')), 'A15. una cuenta con acceso a todo lo ve y no tiene botón para enviar');
  await page.evaluate(() => cerrarPanelLateral());

  // Todo ya pedido o concedido
  misAccesos = { success: true, tieneTodos: false, permitidos: [{ idHotel: 'H1', nombre: 'Distrito' }], pendientes: [], disponibles: [] };
  await abrirDesdeMenu(page);
  ok(await page.evaluate(() => /ya pediste/.test(document.getElementById('panelAccesoRaiz').innerText) && !document.getElementById('btnAccesoEnviar')), 'A16. si no queda nada por pedir se avisa y no se ofrece enviar');
  await page.evaluate(() => cerrarPanelLateral());

  // ================= B. Desde el Perfil
  misAccesos = MIS_ACCESOS(); llamadas = [];
  await page.evaluate(() => document.getElementById('btnPerfil').click()); await dormir(150);
  await page.evaluate(() => document.getElementById('btnVerPerfil').click()); await page.waitForSelector('#perfilMisAccesos', { visible: true }); await dormir(1000);
  const perfil = await page.evaluate(() => ({
    acceso: [...document.querySelectorAll('#perfilMisAccesos .acceso-item .solicitud-nombre')].map(e => e.textContent).join(),
    pendiente: [...document.querySelectorAll('#perfilMisAccesos .solicitud-item .solicitud-nombre')].map(e => e.textContent).join(),
    boton: !!document.getElementById('btnSolicitarAccesoPerfil') && document.getElementById('btnSolicitarAccesoPerfil').offsetParent !== null
  }));
  ok(perfil.acceso === 'Distrito' && perfil.pendiente === 'Double Tree' && perfil.boton, 'B1. el Perfil muestra "Mis accesos" (Distrito), las solicitudes pendientes (Double Tree) y el botón para pedir más → ' + JSON.stringify(perfil));
  await page.evaluate(() => document.getElementById('btnSolicitarAccesoPerfil').click()); await dormir(600);
  ok(await panelAbierto(page) && await page.evaluate(() => !!document.getElementById('accesoLista')), 'B2. el botón del Perfil abre el mismo panel');
  await page.evaluate(() => cerrarPanelLateral());
  misAccesos = { success: true, tieneTodos: true, permitidos: [], pendientes: [], disponibles: [] };
  await page.evaluate(() => actualizarResumenAccesosPerfil_()); await dormir(700);
  ok(await page.evaluate(() => /todas las propiedades/.test(document.getElementById('perfilMisAccesos').innerText) && document.getElementById('btnSolicitarAccesoPerfil').classList.contains('oculto')), 'B3. con acceso a todo, el Perfil lo dice y oculta el botón');
  await page.close();

  // ================= C. Aviso del Inicio cuando no hay ninguna propiedad
  misAccesos = MIS_ACCESOS(); sinHoteles = true; llamadas = [];
  page = await nuevaPagina(USUARIO_NORMAL);
  ok(await page.evaluate(() => { const a = document.getElementById('avisoSinPropiedades'); return !a.classList.contains('oculto') && a.offsetParent !== null && /Aún no tienes propiedades asignadas/.test(a.innerText); }), 'C1. una persona sin ninguna propiedad ve en el Inicio el aviso "Aún no tienes propiedades asignadas"');
  await page.screenshot({ path: CAPTURAS + '/aviso-sin-propiedades.png' });
  await page.evaluate(() => document.getElementById('btnSolicitarAccesoAviso').click()); await dormir(600);
  ok(await panelAbierto(page) && await page.evaluate(() => !!document.getElementById('accesoLista')), 'C2. el botón del aviso abre el panel para pedir acceso');
  await page.evaluate(() => cerrarPanelLateral());
  await page.close();

  sinHoteles = false;
  page = await nuevaPagina(USUARIO_NORMAL);
  ok(await page.evaluate(() => document.getElementById('avisoSinPropiedades').classList.contains('oculto')), 'C3. con propiedades asignadas el aviso NO aparece');
  await page.close();

  sinHoteles = true;
  page = await nuevaPagina(SESION);
  ok(await page.evaluate(() => document.getElementById('avisoSinPropiedades').classList.contains('oculto')), 'C4. un superadministrador nunca ve ese aviso, aunque no haya hoteles');
  await page.close();

  ok(errores.length === 0, 'sin errores de JS' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await browser.close(); server.close();
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODAS LAS PRUEBAS PASARON'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
