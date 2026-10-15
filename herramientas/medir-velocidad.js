#!/usr/bin/env node
/**
 * Mide cuánto tarda el sistema desplegado en lo que hace una persona: iniciar sesión, ver el inicio, entrar a una propiedad, abrir
 * carpetas, buscar, abrir un archivo y cerrar sesión. SOLO LECTURAS (el inicio y el cierre de sesión sí escriben una fila de sesión).
 *
 *   OXO_EMAIL=usuario@oxohotel.com OXO_CLAVE=... node herramientas/medir-velocidad.js [--url <URL /exec>] [--repeticiones 3]
 *
 * Las credenciales solo se leen del entorno: nunca se guardan. Por defecto usa la URL de producción que está en build.js.
 * Imprime el mínimo y la mediana de cada paso (la primera llamada de cada tipo suele ser la más lenta: caché frío).
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valor = (n, def) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : def; };
const REPS = Math.max(1, parseInt(valor('--repeticiones', '3'), 10) || 3);
let URL_API = valor('--url');
if (!URL_API) {
  const m = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8').match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
  URL_API = m && m[0];
}
const EMAIL = process.env.OXO_EMAIL, CLAVE = process.env.OXO_CLAVE;
if (!URL_API || !EMAIL || !CLAVE) { console.error('Faltan OXO_EMAIL y OXO_CLAVE (variables de entorno) o la URL (--url).'); process.exit(1); }

let TOKEN = null; // desde el inicio de sesión todas las peticiones llevan el token: el servidor decide quién llama solo por él
async function llamar(accion, argumentos) {
  const t0 = Date.now();
  let datos = null, error = null;
  try {
    const r = await fetch(URL_API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, args: argumentos, token: TOKEN }) });
    const texto = await r.text();
    try { const j = JSON.parse(texto); if (j.success) datos = j.data; else error = j.message || 'sin éxito'; } catch (e) { error = 'respuesta no válida (página de error de Google)'; }
  } catch (e) { error = 'red: ' + e.message; }
  return { ms: Date.now() - t0, datos, error };
}

const mediana = v => { const o = v.slice().sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; };
const filas = [];
async function medir(nombre, fn, reps) {
  const tiempos = []; let ultimo = null, errores = 0;
  for (let i = 0; i < (reps || REPS); i++) {
    const r = await fn();
    tiempos.push(r.ms); ultimo = r;
    if (r.error) errores++;
  }
  filas.push({ nombre, primera: tiempos[0], min: Math.min(...tiempos), med: mediana(tiempos), errores, nota: ultimo && ultimo.error ? ultimo.error : '' });
  return ultimo;
}
const seg = ms => (ms / 1000).toFixed(1).padStart(5) + ' s';

(async () => {
  console.log('Midiendo ' + URL_API.slice(0, 60) + '… (' + REPS + ' repeticiones por paso)\n');
  const login = await medir('Iniciar sesión', () => llamar('validarCredenciales', [EMAIL, CLAVE]), 1);
  const u = login.datos && login.datos.user;
  const token = login.datos && login.datos.token;
  if (!token) { console.error('No se pudo iniciar sesión: ' + (login.error || (login.datos && login.datos.message))); process.exit(1); }
  TOKEN = token;
  const id = u.ID_Usuario;

  const ini = await medir('Pantalla de inicio', () => llamar('obtenerDatosInicio', [token, id, false]));
  const modulos = (ini.datos && ini.datos.modulos) || [];
  const hotel = modulos.reduce((a, m) => a || (m.hoteles || [])[0], null);

  await medir('Módulos y propiedades', () => llamar('obtenerModulosConHoteles', [token, id]));
  await medir('Mis accesos (perfil)', () => llamar('obtenerMisAccesos', [token]));
  await medir('Favoritos', () => llamar('obtenerFavoritosDetallados', [id]));
  await medir('Actividad reciente', () => llamar('obtenerActividadReciente', [id, 15]));

  let carpeta = null, archivo = null;
  if (hotel) {
    const cs = await medir('Entrar a una propiedad', () => llamar('obtenerCarpetasDelHotel', [String(hotel.idHotel), token, id]));
    const lista = (cs.datos && (cs.datos.carpetas || cs.datos.areas)) || [];
    carpeta = lista[0] || null;
    if (carpeta) {
      const idc = carpeta.idCarpeta || carpeta.id;
      await medir('Ruta de la carpeta', () => llamar('obtenerRutaCarpeta', [idc]));
      const cont = await medir('Abrir una carpeta', () => llamar('obtenerContenidoCarpeta', [idc, id]));
      const archivos = (cont.datos && (cont.datos.archivos || cont.datos.files)) || [];
      archivo = archivos[0] || null;
      const sub = ((cont.datos && cont.datos.subcarpetas) || [])[0];
      if (sub) await medir('Abrir una subcarpeta', () => llamar('obtenerContenidoCarpeta', [sub.idCarpeta || sub.id, id]));
    }
  }
  await medir('Búsqueda global', () => llamar('buscarGlobal', ['a']));
  if (archivo) {
    const ref = archivo.url || archivo.urlArchivo || archivo.idArchivo || archivo.id;
    await medir('Abrir un archivo (datos)', () => llamar('obtenerArchivoPorIdOUrl', [String(ref)]));
  }
  await medir('Cerrar sesión', () => llamar('cerrarSesionUsuario', [token]), 1);

  console.log('Paso'.padEnd(28) + ' primera    mínimo   mediana');
  filas.forEach(f => console.log(f.nombre.padEnd(28) + seg(f.primera) + '  ' + seg(f.min) + '  ' + seg(f.med) + (f.errores ? '   ⚠ ' + f.errores + ' con error' + (f.nota ? ': ' + f.nota : '') : '')));
  if (!carpeta) console.log('\n(No se encontró ninguna carpeta con esta cuenta: no se midieron carpetas ni archivos.)');
  else if (!archivo) console.log('\n(La primera carpeta no tiene archivos: no se midió abrir un archivo.)');
})().catch(e => { console.error('✖ ' + e.message); process.exit(2); });
