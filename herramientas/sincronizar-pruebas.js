#!/usr/bin/env node
/**
 * Prepara el código del backend para el proyecto de PRUEBAS de Apps Script y (con --push) lo sube.
 *
 *   node herramientas/sincronizar-pruebas.js            → solo prepara la carpeta .pruebas-gas/ y la revisa
 *   node herramientas/sincronizar-pruebas.js --push     → además hace "clasp push" a ESE proyecto (nunca al de producción)
 *
 * Qué cambia el código al copiarlo (producción NO se toca: se trabaja sobre una copia en .pruebas-gas/):
 *   1. DRIVE_CONFIG.SPREADSHEET_ID  → la hoja de PRUEBAS (con datos ficticios)
 *   2. DRIVE_CONFIG.ROOT_FOLDER_ID  → "PRUEBAS-SIN-CARPETA-RAIZ": cualquier llamada a Drive falla al instante, no toca carpetas reales
 *   3. MailApp.sendEmail(           → capturarCorreo_(  : ninguna prueba puede enviar un correo de verdad
 *   4. Code.js: se agregan a la lista de acciones permitidas las 3 entradas web de pruebas (solo en el proyecto de pruebas)
 *   + se copian los archivos de pruebas-gas/ y un Seguridad.js con el ID de producción prohibido.
 *
 * Configuración: .pruebas-gas.config.json (no se sube al repositorio). Ver .pruebas-gas.config.ejemplo.json y pruebas-gas/README.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, '.pruebas-gas');
const ARCHIVO_CONFIG = path.join(RAIZ, '.pruebas-gas.config.json');
const PUSH = process.argv.includes('--push');

function fallar(mensaje) { console.error('\n✖ ' + mensaje + '\n'); process.exit(1); }
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

// ---------- Configuración y protecciones
if (!fs.existsSync(ARCHIVO_CONFIG)) fallar('Falta .pruebas-gas.config.json. Copia .pruebas-gas.config.ejemplo.json y completa scriptId y spreadsheetId (ver pruebas-gas/README.md).');
const config = JSON.parse(fs.readFileSync(ARCHIVO_CONFIG, 'utf8'));
if (!config.scriptId || !config.spreadsheetId) fallar('La configuración debe tener scriptId y spreadsheetId.');
// La clave de las ejecuciones web la genera esta herramienta (si falta) y se guarda en la configuración local: no hay que copiarla de ningún lado
if (!config.clave) {
  config.clave = crypto.randomBytes(18).toString('hex');
  fs.writeFileSync(ARCHIVO_CONFIG, JSON.stringify(config, null, 2));
  console.log('Se generó una clave para las ejecuciones web y se guardó en .pruebas-gas.config.json');
}

const driveOriginal = leer('backend', 'Drive.js');
const idHojaProduccion = (driveOriginal.match(/SPREADSHEET_ID:\s*'([^']+)'/) || [])[1];
const idCarpetaProduccion = (driveOriginal.match(/ROOT_FOLDER_ID:\s*'([^']+)'/) || [])[1];
if (!idHojaProduccion || !idCarpetaProduccion) fallar('No se pudo leer SPREADSHEET_ID / ROOT_FOLDER_ID de backend/Drive.js.');

if (config.spreadsheetId === idHojaProduccion) fallar('La hoja de pruebas configurada es la de PRODUCCIÓN. Usa una hoja distinta y vacía (datos ficticios).');
const claspProduccion = path.join(RAIZ, '.clasp.json');
if (fs.existsSync(claspProduccion)) {
  const idScriptProduccion = JSON.parse(fs.readFileSync(claspProduccion, 'utf8')).scriptId;
  if (config.scriptId === idScriptProduccion) fallar('El scriptId de pruebas es el de PRODUCCIÓN. Crea un proyecto de Apps Script aparte.');
}

// ---------- Preparar la carpeta de salida (solo se borra algo dentro de .pruebas-gas)
if (path.resolve(SALIDA) !== path.join(path.resolve(RAIZ), '.pruebas-gas')) fallar('Ruta de salida inesperada.');
fs.rmSync(SALIDA, { recursive: true, force: true });
fs.mkdirSync(path.join(SALIDA, 'backend'), { recursive: true });
fs.mkdirSync(path.join(SALIDA, 'pruebas-gas'), { recursive: true });

let reemplazosCorreo = 0;
function parchear(nombre, texto) {
  let t = texto;
  if (t.includes(idHojaProduccion)) t = t.split(idHojaProduccion).join(config.spreadsheetId);
  if (t.includes(idCarpetaProduccion)) t = t.split(idCarpetaProduccion).join('PRUEBAS-SIN-CARPETA-RAIZ');
  reemplazosCorreo += t.split('MailApp.sendEmail(').length - 1;
  t = t.split('MailApp.sendEmail(').join('capturarCorreo_(');
  return t;
}

// appsscript.json, Code.js y backend
fs.copyFileSync(path.join(RAIZ, 'appsscript.json'), path.join(SALIDA, 'appsscript.json'));

let code = parchear('Code.js', leer('Code.js'));
const ancla = 'const ACCIONES_PERMITIDAS_ = [';
if (!code.includes(ancla)) fallar('No se encontró la lista de acciones permitidas en Code.js.');
code = code.replace(ancla, ancla + "\n  'ejecutarPruebasWeb',\n  'sembrarDatosPruebasWeb',\n  'inspeccionarEstadoPruebasWeb',");
fs.writeFileSync(path.join(SALIDA, 'Code.js'), code);

const excluidos = ['ImportarUsuarios.js', 'desktop.ini'];
fs.readdirSync(path.join(RAIZ, 'backend')).filter(f => f.endsWith('.js') && !excluidos.includes(f)).forEach(f => {
  fs.writeFileSync(path.join(SALIDA, 'backend', f), parchear(f, leer('backend', f)));
});

fs.readdirSync(path.join(RAIZ, 'pruebas-gas')).filter(f => f.endsWith('.js')).forEach(f => {
  fs.copyFileSync(path.join(RAIZ, 'pruebas-gas', f), path.join(SALIDA, 'pruebas-gas', f));
});
fs.writeFileSync(path.join(SALIDA, 'pruebas-gas', 'Seguridad.js'),
  "/** Generado por herramientas/sincronizar-pruebas.js: la hoja de PRODUCCIÓN, que este proyecto jamás debe usar. */\nvar ID_PRODUCCION_PROHIBIDO_ = '" + idHojaProduccion + "';\n" +
  "/** Clave de las ejecuciones web (la toma prepararEntornoDePruebas). */\nvar CLAVE_PRUEBAS_INICIAL_ = '" + config.clave + "';\n");
fs.writeFileSync(path.join(SALIDA, '.clasp.json'), JSON.stringify({ scriptId: config.scriptId, rootDir: '', scriptExtensions: ['.js', '.gs'], jsonExtensions: ['.json'], filePushOrder: [] }, null, 2));

// ---------- Revisión final de lo preparado (si algo no cuadra, no se sube nada)
const todos = [];
(function recorrer(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p); else if (e.name.endsWith('.js')) todos.push(p);
  });
})(SALIDA);

const problemas = [];
todos.forEach(p => {
  const t = fs.readFileSync(p, 'utf8');
  const rel = path.relative(SALIDA, p);
  if (!rel.endsWith('Seguridad.js') && t.includes(idHojaProduccion)) problemas.push(rel + ': todavía contiene el ID de la hoja de producción');
  if (t.includes(idCarpetaProduccion)) problemas.push(rel + ': todavía contiene la carpeta raíz de producción');
  if (t.includes('MailApp.sendEmail(')) problemas.push(rel + ': todavía envía correos reales (MailApp.sendEmail)');
});
if (!fs.readFileSync(path.join(SALIDA, 'backend', 'Drive.js'), 'utf8').includes(config.spreadsheetId)) problemas.push('Drive.js no quedó apuntando a la hoja de pruebas');
if (reemplazosCorreo < 1) problemas.push('no se reemplazó ninguna llamada de correo (¿cambió el código?)');
if (problemas.length) fallar('La carpeta preparada NO es segura:\n  - ' + problemas.join('\n  - '));

console.log('✔ Preparado en .pruebas-gas/ (' + todos.length + ' archivos .js)');
console.log('  · Hoja de cálculo: ' + config.spreadsheetId + '  (producción: ' + idHojaProduccion.slice(0, 6) + '…, no se usa)');
console.log('  · Carpeta raíz de Drive: PRUEBAS-SIN-CARPETA-RAIZ');
console.log('  · Llamadas de correo reemplazadas por captura: ' + reemplazosCorreo);

if (!PUSH) {
  console.log('\nPara subirlo al proyecto de pruebas:  node herramientas/sincronizar-pruebas.js --push');
  process.exit(0);
}

console.log('\nSubiendo al proyecto de PRUEBAS (' + config.scriptId.slice(0, 8) + '…) con clasp…');
try {
  execSync('clasp push -f', { cwd: SALIDA, stdio: 'inherit' });
} catch (e) {
  fallar('clasp push falló. Revisa que hayas iniciado sesión (clasp login) y que el scriptId sea correcto.');
}
// Si hay una implementación web configurada, se actualiza a una versión nueva con este código (las ejecuciones web usan una versión fija)
if (config.webAppUrl && config.webAppUrl.includes('/s/') && !process.env.SIN_REDEPLOY) {
  const idImplementacion = config.webAppUrl.split('/s/')[1].split('/')[0];
  try {
    const salida = execSync('clasp version "sincronización ' + new Date().toISOString().slice(0, 16) + '"', { cwd: SALIDA, encoding: 'utf8' });
    const numeros = salida.match(/\d+/g);
    const version = numeros[numeros.length - 1];
    execSync('clasp redeploy ' + idImplementacion + ' -V ' + version + ' -d "sincronización"', { cwd: SALIDA, encoding: 'utf8' });
    console.log('✔ Implementación web de pruebas actualizada a la versión ' + version);
  } catch (e) {
    console.log('⚠ No se pudo actualizar la implementación web de pruebas: ' + String(e.message).split('\n')[0]);
  }
}
console.log('\n✔ Listo. En el editor del proyecto de pruebas: ejecuta prepararEntornoDePruebas (una vez) y luego ejecutarPruebas.');
