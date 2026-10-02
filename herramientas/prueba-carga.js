#!/usr/bin/env node
/**
 * Prueba de carga del backend (Apps Script): simula N personas entrando al sistema a la vez.
 *
 * Qué hace: inicia sesión UNA vez con una cuenta de prueba, y luego cada "persona virtual" repite lo que hace alguien al
 * entrar: el Inicio (obtenerDatosInicio), las áreas de un hotel y el contenido de una carpeta. SOLO LECTURAS: no crea,
 * no modifica ni borra nada. Lo único que escribe es la sesión del login y, si hay llamadas lentas, la hoja Metricas.
 *
 * Uso (PowerShell):
 *   $env:OXO_URL   = "https://script.google.com/macros/s/XXXX/exec"   # idealmente una COPIA de pruebas
 *   $env:OXO_EMAIL = "cuenta-de-prueba@oxohotel.com"
 *   $env:OXO_PASS  = "..."
 *   $env:OXO_CONFIRMO = "SI"                                           # confirma que sabes contra qué corres
 *   node herramientas/prueba-carga.js --usuarios 50 --rondas 2 --subida 10
 *
 * Opciones:  --usuarios N (por defecto 20, máx. 200)   --rondas N (por defecto 1)   --subida S (segundos en los que
 * entran todos; por defecto 10)   --hotel ID_HOTEL (por defecto, el primero que vea la cuenta)
 *
 * IMPORTANTE: contra producción hazlo fuera de horario y empieza con pocos usuarios: las cuotas de Apps Script son
 * reales y compartidas con el resto de la empresa. Mejor contra una copia del proyecto con su propia hoja de cálculo.
 */
const URL_API = process.env.OXO_URL;
const EMAIL = process.env.OXO_EMAIL;
const PASS = process.env.OXO_PASS;

function opcion(nombre, porDefecto) {
  const i = process.argv.indexOf('--' + nombre);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}
const USUARIOS = Math.min(200, Math.max(1, parseInt(opcion('usuarios', '20'), 10)));
const RONDAS = Math.max(1, parseInt(opcion('rondas', '1'), 10));
const SUBIDA_S = Math.max(0, parseFloat(opcion('subida', '10')));
const HOTEL = opcion('hotel', null);

if (!URL_API || !EMAIL || !PASS) {
  console.error('Faltan OXO_URL, OXO_EMAIL u OXO_PASS (ver el encabezado de este archivo).');
  process.exit(1);
}
if (process.env.OXO_CONFIRMO !== 'SI') {
  console.error('Por seguridad define OXO_CONFIRMO=SI para confirmar que sabes contra qué backend vas a correr.\nURL: ' + URL_API);
  process.exit(1);
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function llamar(accion, args) {
  const inicio = Date.now();
  try {
    const resp = await fetch(URL_API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, args }) });
    if (!resp.ok) return { ms: Date.now() - inicio, error: 'HTTP ' + resp.status };
    const json = await resp.json();
    if (!json || !json.success) return { ms: Date.now() - inicio, error: (json && json.message) || 'respuesta sin éxito' };
    return { ms: Date.now() - inicio, data: json.data };
  } catch (e) {
    return { ms: Date.now() - inicio, error: 'red: ' + (e.message || e) };
  }
}

const medidas = {};   // accion -> [ms]
const errores = {};   // accion -> {mensaje: n}
function anotar(accion, r) {
  (medidas[accion] = medidas[accion] || []).push(r.ms);
  if (r.error) { const e = (errores[accion] = errores[accion] || {}); e[r.error] = (e[r.error] || 0) + 1; }
}

function percentil(valores, p) {
  const v = valores.slice().sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(p / 100 * v.length) - 1)] : 0;
}

async function personaVirtual(n, sesion, idHotel, idCarpeta) {
  await dormir(SUBIDA_S * 1000 * (n / USUARIOS)); // entran escalonados a lo largo de la "subida"
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    let r = await llamar('obtenerDatosInicio', [sesion.token, sesion.id]); anotar('obtenerDatosInicio', r);
    if (idHotel) { r = await llamar('obtenerCarpetasDelHotel', [idHotel, sesion.token, sesion.id]); anotar('obtenerCarpetasDelHotel', r); }
    if (idCarpeta) { r = await llamar('obtenerContenidoCarpeta', [idCarpeta, sesion.id]); anotar('obtenerContenidoCarpeta', r); }
    await dormir(500 + Math.random() * 1500); // una persona real no pulsa al instante
  }
}

(async () => {
  console.log('Iniciando sesión de prueba…');
  const login = await llamar('validarCredenciales', [EMAIL, PASS]);
  if (login.error || !login.data || !login.data.success) { console.error('No se pudo iniciar sesión:', login.error || (login.data && login.data.message)); process.exit(1); }
  const sesion = { token: login.data.user.token, id: login.data.user.ID_Usuario };

  const inicio = await llamar('obtenerDatosInicio', [sesion.token, sesion.id]);
  let modulos = inicio.data && inicio.data.modulos;
  if (!modulos) { const m = await llamar('obtenerModulosConHoteles', [sesion.token, sesion.id]); modulos = m.data; }
  const hoteles = (modulos || []).flatMap(m => m.hoteles || []);
  const idHotel = HOTEL || (hoteles[0] && hoteles[0].idHotel) || null;
  let idCarpeta = null;
  if (idHotel) {
    const c = await llamar('obtenerCarpetasDelHotel', [idHotel, sesion.token, sesion.id]);
    idCarpeta = c.data && c.data.carpetas && c.data.carpetas[0] && c.data.carpetas[0].id;
  }
  console.log('Hotel de prueba: ' + (idHotel || '(ninguno)') + ' · carpeta: ' + (idCarpeta || '(ninguna)'));
  console.log('Lanzando ' + USUARIOS + ' personas virtuales × ' + RONDAS + ' ronda(s), entrando a lo largo de ' + SUBIDA_S + ' s…');

  const t0 = Date.now();
  await Promise.all(Array.from({ length: USUARIOS }, (_, n) => personaVirtual(n, sesion, idHotel, idCarpeta)));
  const total = (Date.now() - t0) / 1000;

  await llamar('cerrarSesionUsuario', [sesion.token]);

  console.log('\nResultados (' + total.toFixed(1) + ' s en total)');
  console.log('acción'.padEnd(28) + 'llamadas'.padStart(9) + 'errores'.padStart(9) + 'p50 ms'.padStart(9) + 'p95 ms'.padStart(9) + 'máx ms'.padStart(9));
  let hayErrores = false;
  Object.keys(medidas).forEach(a => {
    const nErr = Object.values(errores[a] || {}).reduce((x, y) => x + y, 0);
    if (nErr) hayErrores = true;
    console.log(a.padEnd(28) + String(medidas[a].length).padStart(9) + String(nErr).padStart(9) + String(percentil(medidas[a], 50)).padStart(9) + String(percentil(medidas[a], 95)).padStart(9) + String(Math.max(...medidas[a])).padStart(9));
  });
  if (hayErrores) {
    console.log('\nErrores por tipo:');
    Object.keys(errores).forEach(a => Object.entries(errores[a]).forEach(([msg, n]) => console.log('  ' + a + ': ' + n + ' × ' + String(msg).slice(0, 120))));
  }
  const todas = Object.values(medidas).flat();
  const totalErr = Object.values(errores).flatMap(e => Object.values(e)).reduce((x, y) => x + y, 0);
  console.log('\nVeredicto: ' + (totalErr === 0 && percentil(todas, 95) < 8000 ? 'AGUANTA esta carga (sin errores y p95 < 8 s)' : 'SE DEGRADA con esta carga (errores: ' + totalErr + ', p95: ' + percentil(todas, 95) + ' ms)'));
  process.exit(0);
})();
