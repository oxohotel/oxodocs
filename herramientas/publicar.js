#!/usr/bin/env node
/**
 * Publica el backend en PRODUCCIÓN (Apps Script) con comprobaciones previas, y permite volver a una versión anterior.
 * La URL de la aplicación NO cambia: se actualiza la misma implementación a una versión nueva (clasp create-version + redeploy).
 *
 *   node herramientas/publicar.js                      → comprueba, pide confirmación y publica
 *   node herramientas/publicar.js --solo-comprobar     → solo las comprobaciones previas (no publica nada)
 *   node herramientas/publicar.js --estado             → qué versión está publicada hoy y las últimas versiones
 *   node herramientas/publicar.js --revertir           → vuelve a la versión publicada justo antes (con confirmación)
 *   node herramientas/publicar.js --revertir 150       → vuelve a la versión 150 (con confirmación)
 *
 * Opciones: --pruebas          opera sobre el proyecto de PRUEBAS (ver pruebas-gas/README.md) en vez de producción: sirve para ensayar
 *                              el flujo completo (publicar, revertir) sin riesgo
 *           --mensaje "texto"  descripción de la versión (por defecto, el último mensaje de commit)
 *           --navegador        incluye también las pruebas de navegador en las comprobaciones (~3 min)
 *
 * Qué comprueba antes de publicar (si algo falla, NO se publica):
 *   1. Árbol de git limpio: se publica exactamente lo que está en el commit.
 *   2. Ese commit ya está subido a GitHub: backend y frontend (GitHub Pages) salen del mismo commit.
 *   3. El build del frontend está al día.
 *   4. La lista de acciones permitidas coincide con el frontend.
 *   5. La sintaxis del backend es válida.
 *   6. Las pruebas pasan.
 * Después de publicar hace una consulta de humo de solo lectura a producción y registra la publicación en .publicaciones.json.
 *
 * IMPORTANTE: volver atrás SOLO cambia el backend. El frontend (GitHub Pages) sigue siendo el del último commit.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PRUEBAS = process.argv.includes('--pruebas');
const HISTORIAL = path.join(RAIZ, PRUEBAS ? '.publicaciones-pruebas.json' : '.publicaciones.json');
const ENTORNO = PRUEBAS ? 'PRUEBAS' : 'PRODUCCIÓN';
const DIR_CLASP = PRUEBAS ? path.join(RAIZ, '.pruebas-gas') : RAIZ;
const REMOTO = 'oxohotel/main';
const args = process.argv.slice(2);
const tiene = f => args.includes(f);
const valorDe = f => { const i = args.indexOf(f); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };

function sh(cmd, opciones) {
  // Los comandos de clasp se ejecutan en la carpeta del proyecto correspondiente (producción: la raíz; pruebas: .pruebas-gas)
  const cwd = /^clasp /.test(cmd) ? DIR_CLASP : RAIZ;
  return execSync(cmd, Object.assign({ cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }, opciones || {})).trim();
}
function fallar(mensaje) { console.error('\n✖ ' + mensaje + '\n'); process.exit(1); }
function paso(nombre, fn) {
  process.stdout.write('  · ' + nombre.padEnd(52));
  try {
    const extra = fn();
    console.log('✔' + (extra ? '  ' + extra : ''));
  } catch (e) {
    console.log('✖');
    fallar(nombre + ':\n  ' + String(e.message || e).split('\n').slice(0, 12).join('\n  '));
  }
}
const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pasoA(nombre, fn) {
  process.stdout.write('  · ' + nombre.padEnd(52));
  try {
    const extra = await fn();
    console.log('✔' + (extra ? '  ' + extra : ''));
  } catch (e) {
    console.log('✖');
    fallar(nombre + ':\n  ' + String(e.message || e).split('\n').slice(0, 12).join('\n  '));
  }
}

async function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(texto, r => { rl.close(); resolve(r.trim()); }));
}

// ---------- Datos de producción (se leen del propio código, no se escriben a mano)
let URL_PRODUCCION;
if (PRUEBAS) {
  const archivo = path.join(RAIZ, '.pruebas-gas.config.json');
  if (!fs.existsSync(archivo)) fallar('Falta .pruebas-gas.config.json (ver pruebas-gas/README.md).');
  URL_PRODUCCION = JSON.parse(fs.readFileSync(archivo, 'utf8')).webAppUrl;
  if (!URL_PRODUCCION) fallar('Falta webAppUrl en .pruebas-gas.config.json (la URL de la implementación web del proyecto de pruebas).');
  if (!fs.existsSync(path.join(DIR_CLASP, '.clasp.json'))) fallar('Falta .pruebas-gas/. Ejecuta primero: node herramientas/sincronizar-pruebas.js');
} else {
  const build = fs.readFileSync(path.join(RAIZ, 'build.js'), 'utf8');
  URL_PRODUCCION = (build.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/) || [])[0];
  if (!URL_PRODUCCION) fallar('No se encontró la URL de producción en build.js.');
}
const ID_IMPLEMENTACION = URL_PRODUCCION.match(/\/s\/([^/]+)\/exec/)[1];

function estadoRemoto() {
  const imp = sh('clasp deployments').split('\n').map(l => l.match(/^- (\S+) @(\S+)\s*(.*)$/)).filter(Boolean).find(m => m[1] === ID_IMPLEMENTACION);
  if (!imp) throw new Error('La implementación de producción (' + ID_IMPLEMENTACION.slice(0, 10) + '…) no aparece en "clasp deployments". ¿Sesión de clasp o proyecto equivocados?');
  const versiones = sh('clasp versions').split('\n').map(l => l.match(/^(\d+) - (.*)$/)).filter(Boolean).map(m => ({ numero: Number(m[1]), descripcion: m[2] }));
  return { version: imp[2] === 'HEAD' ? null : Number(imp[2]), descripcionImplementacion: String(imp[3] || '').replace(/^-\s*/, ''), versiones };
}

/**
 * El servicio de Google es "eventualmente consistente": justo después de actualizar una implementación, algunas lecturas aún devuelven la
 * versión anterior. Por eso (1) para DECIDIR algo se exigen dos lecturas iguales seguidas y (2) para VERIFICAR un cambio se reintenta hasta verlo.
 */
async function estadoRemotoEstable() {
  let anterior = estadoRemoto();
  for (let i = 0; i < 5; i++) {
    await dormir(2500);
    const ahora = estadoRemoto();
    if (ahora.version === anterior.version) return ahora;
    anterior = ahora;
  }
  return anterior;
}

async function esperarVersion(esperada) {
  let ultima;
  for (let i = 0; i < 10; i++) {
    ultima = estadoRemoto();
    if (ultima.version === esperada) return ultima;
    await dormir(3000);
  }
  throw new Error('La implementación sigue en la versión ' + ultima.version + ' y no en la ' + esperada + ' tras esperar 30 s.');
}

function leerHistorial() { try { return JSON.parse(fs.readFileSync(HISTORIAL, 'utf8')); } catch (e) { return []; } }
function anotar(registro) { const h = leerHistorial(); h.push(Object.assign({ fecha: new Date().toISOString() }, registro)); fs.writeFileSync(HISTORIAL, JSON.stringify(h, null, 2)); }

/** Consulta de humo de SOLO LECTURA contra producción. */
async function humo(esReversion) {
  const llamar = async (accion) => {
    const r = await fetch(URL_PRODUCCION, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, args: [] }) });
    return r.json();
  };
  const a = await llamar('obtenerVersionCacheGlobal');
  if (!a.success) throw new Error('obtenerVersionCacheGlobal no respondió bien: ' + (a.message || ''));
  const b = await llamar('obtenerHotelesParaRegistro');
  const hotelesOk = b.success && b.data && b.data.success && Array.isArray(b.data.hoteles);
  if (!hotelesOk && !esReversion) throw new Error('obtenerHotelesParaRegistro no respondió bien: ' + (b.message || JSON.stringify(b.data).slice(0, 120)));
  return 'versión de caché ' + a.data + (hotelesOk ? ', ' + b.data.hoteles.length + ' propiedades' : ' (sin lista de propiedades: versión antigua)');
}

function comprobarYa() { return (async () => { try { return await humo(true); } catch (e) { return 'sin respuesta: ' + e.message; } })(); }

// ---------- Estado
async function mostrarEstado() {
  const e = await estadoRemotoEstable();
  const hist = leerHistorial();
  console.log('Implementación de ' + ENTORNO.toLowerCase() + ': ' + ID_IMPLEMENTACION.slice(0, 12) + '…  (URL fija, no cambia)');
  console.log('Versión publicada hoy (' + ENTORNO.toLowerCase() + '): ' + (e.version === null ? 'HEAD (sin versión fija)' : e.version) + (e.descripcionImplementacion ? '  — ' + e.descripcionImplementacion : ''));
  console.log('\nÚltimas versiones:');
  e.versiones.slice(-8).forEach(v => console.log('  ' + String(v.numero).padStart(4) + '  ' + v.descripcion + (v.numero === e.version ? '   ← publicada' : '')));
  if (hist.length) {
    console.log('\nÚltimas publicaciones hechas con esta herramienta:');
    hist.slice(-5).forEach(h => console.log('  ' + h.fecha.slice(0, 16).replace('T', ' ') + '  ' + (h.tipo || 'publicación') + '  v' + h.version + (h.commit ? '  (' + h.commit + ')' : '') + '  ' + (h.mensaje || '')));
  }
  console.log('\nEstado de ' + ENTORNO.toLowerCase() + ' ahora: ' + await comprobarYa());
}

// ---------- Comprobaciones previas
function comprobaciones() {
  console.log('Comprobaciones previas:');
  paso('Árbol de git limpio (se publica lo que está en el commit)', () => {
    const sucio = sh('git status --porcelain');
    if (sucio) throw new Error('Hay cambios sin commit:\n' + sucio.split('\n').slice(0, 10).join('\n') + '\nHaz commit (y push) primero.');
  });
  paso('El commit ya está en GitHub (' + REMOTO + ')', () => {
    let remoto;
    try { remoto = sh('git rev-parse ' + REMOTO); } catch (e) { throw new Error('No se encontró la referencia ' + REMOTO + '. Haz "git push oxohotel main" primero.'); }
    const local = sh('git rev-parse HEAD');
    if (local !== remoto) throw new Error('HEAD (' + local.slice(0, 7) + ') no es el último subido a GitHub (' + remoto.slice(0, 7) + '). Haz push primero: así backend y frontend salen del mismo commit.');
    return local.slice(0, 7);
  });
  paso('Build del frontend al día', () => {
    sh('node build.js');
    const cambios = sh('git status --porcelain -- dist index.html');
    if (cambios) throw new Error('El build generó cambios en dist/index.html o index.html: no estaba actualizado. Haz commit del build.');
  });
  paso('Lista de acciones permitidas = frontend', () => sh('node herramientas/verificar-acciones.js').split('\n').pop());
  paso('Sintaxis del backend', () => {
    const archivos = fs.readdirSync(path.join(RAIZ, 'backend')).filter(f => f.endsWith('.js') && f !== 'ImportarUsuarios.js').map(f => 'backend/' + f).concat(['Code.js']);
    archivos.forEach(f => sh('node --check "' + f + '"'));
    return archivos.length + ' archivos';
  });
  paso('Pruebas' + (tiene('--navegador') ? ' (backend y navegador)' : ' (backend)'), () => {
    const salida = sh('node herramientas/correr-pruebas.js' + (tiene('--navegador') ? ' --navegador' : ''), { stdio: ['ignore', 'pipe', 'pipe'] });
    return salida.split('\n').filter(Boolean).pop();
  });
}

// ---------- Flujos
async function publicar() {
  const nuevoPlan = await estadoRemotoEstable();
  comprobaciones();
  if (tiene('--solo-comprobar')) { console.log('\n✔ Todo en orden (no se publicó nada).'); return; }

  const commit = sh('git rev-parse --short HEAD');
  let mensaje = valorDe('--mensaje');
  if (!mensaje) {
    const porDefecto = sh('git log -1 --pretty=%s');
    const r = await preguntar('\nDescripción de la versión [' + porDefecto + ']: ');
    mensaje = r || porDefecto;
  }

  const siguiente = nuevoPlan.versiones.length ? nuevoPlan.versiones[nuevoPlan.versiones.length - 1].numero + 1 : 1;
  console.log('\nSe publicará en ' + ENTORNO + ':');
  console.log('  · Commit:          ' + commit + '  ' + mensaje);
  console.log('  · Implementación:  ' + ID_IMPLEMENTACION.slice(0, 12) + '…  (hoy en la versión ' + (nuevoPlan.version === null ? 'HEAD' : nuevoPlan.version) + ')');
  console.log('  · Versión nueva:   ' + siguiente + '   La URL no cambia.');
  console.log('  · Para volver atrás:  node herramientas/publicar.js ' + (PRUEBAS ? '--pruebas ' : '') + '--revertir');
  const r = await preguntar('\n¿Publicar? Escribe SI para continuar: ');
  if (r.toLowerCase() !== 'si' && r.toLowerCase() !== 'sí') fallar('Cancelado. No se publicó nada.');

  console.log('\nPublicando…');
  paso('Subiendo el código' + (PRUEBAS ? ' (sincronizar-pruebas)' : ' (clasp push)'), () => { sh(PRUEBAS ? 'node herramientas/sincronizar-pruebas.js --push' : 'clasp push -f', PRUEBAS ? { env: Object.assign({}, process.env, { SIN_REDEPLOY: '1' }) } : undefined); });
  let numero;
  paso('Creando la versión', () => {
    const salida = sh('clasp version ' + JSON.stringify(mensaje));
    const m = salida.match(/(\d+)/g);
    if (!m) throw new Error('No se pudo leer el número de versión: ' + salida);
    numero = Number(m[m.length - 1]);
    return 'v' + numero;
  });
  paso('Actualizando la implementación', () => { sh('clasp redeploy ' + ID_IMPLEMENTACION + ' -V ' + numero + ' -d ' + JSON.stringify(mensaje)); });
  await pasoA('Comprobando que quedó la versión ' + numero, async () => { await esperarVersion(numero); });
  let resultadoHumo;
  try { resultadoHumo = await humo(false); } catch (e) { resultadoHumo = null; console.log('\n✖ La consulta de humo a producción FALLÓ: ' + e.message + '\n  Para volver atrás ahora mismo:  node herramientas/publicar.js --revertir'); }
  anotar({ tipo: 'publicación', version: numero, versionAnterior: nuevoPlan.version, commit: commit, mensaje: mensaje });
  if (resultadoHumo) console.log('  · Consulta de humo a ' + ENTORNO.toLowerCase().padEnd(31) + '✔  ' + resultadoHumo);
  console.log('\n✔ Publicado: versión ' + numero + '. ' + (resultadoHumo ? ENTORNO.charAt(0) + ENTORNO.slice(1).toLowerCase() + ' responde.' : 'REVISA ' + ENTORNO.toLowerCase() + '.'));
  console.log('  Si algo no va bien:  node herramientas/publicar.js --revertir   (vuelve a la ' + (nuevoPlan.version === null ? 'anterior' : 'versión ' + nuevoPlan.version) + ')');
  process.exit(resultadoHumo ? 0 : 1);
}

async function revertir() {
  const e = await estadoRemotoEstable();
  if (e.version === null) fallar('Producción está en HEAD (sin versión fija); no hay una versión a la que volver.');
  const pedida = valorDe('--revertir');
  let destino;
  if (pedida) destino = Number(pedida);
  else {
    const hist = leerHistorial().filter(h => h.version === e.version && h.versionAnterior);
    destino = hist.length ? hist[hist.length - 1].versionAnterior : e.versiones.map(v => v.numero).filter(n => n < e.version).pop();
  }
  const info = e.versiones.find(v => v.numero === destino);
  if (!destino || !info) fallar('No se encontró la versión a la que volver' + (pedida ? ' (' + pedida + ')' : '') + '. Mira --estado.');
  if (destino === e.version) fallar('Producción ya está en la versión ' + destino + '.');

  console.log('\nVolver atrás en ' + ENTORNO + ':');
  console.log('  · Hoy:      versión ' + e.version + '  ' + (e.versiones.find(v => v.numero === e.version) || {}).descripcion);
  console.log('  · Destino:  versión ' + destino + '  ' + info.descripcion);
  console.log('\n  OJO: solo vuelve el BACKEND. El frontend de GitHub Pages sigue siendo el del último commit; si el frontend nuevo');
  console.log('  usa acciones que la versión antigua no tiene, esas pantallas mostrarán error hasta que vuelvas a publicar o hagas');
  console.log('  "git revert" del frontend.');
  const r = await preguntar('\n¿Volver a la versión ' + destino + '? Escribe SI para continuar: ');
  if (r.toLowerCase() !== 'si' && r.toLowerCase() !== 'sí') fallar('Cancelado. No se cambió nada.');

  paso('Actualizando la implementación a la versión ' + destino, () => { sh('clasp redeploy ' + ID_IMPLEMENTACION + ' -V ' + destino + ' -d ' + JSON.stringify('Reversión a la v' + destino + ' (desde la v' + e.version + ')')); });
  await pasoA('Comprobando que quedó la versión ' + destino, async () => { await esperarVersion(destino); });
  anotar({ tipo: 'reversión', version: destino, versionAnterior: e.version, mensaje: 'Reversión a la v' + destino });
  { const h = await comprobarYa(); console.log('  · Consulta de humo a ' + ENTORNO.toLowerCase().padEnd(31) + (h.startsWith('sin respuesta') ? '⚠  ' : '✔  ') + h); }
  console.log('\n✔ ' + ENTORNO.charAt(0) + ENTORNO.slice(1).toLowerCase() + ' volvió a la versión ' + destino + '. Para publicar de nuevo lo actual:  node herramientas/publicar.js');
}

(async () => {
  try { sh('clasp --version'); } catch (e) { fallar('No se encontró clasp. Instálalo con: npm install -g @google/clasp'); }
  if (tiene('--estado')) return mostrarEstado();
  if (tiene('--revertir')) return revertir();
  return publicar();
})().catch(e => fallar(String(e.message || e)));
