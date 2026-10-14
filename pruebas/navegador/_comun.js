/** Ayudas comunes de las pruebas de navegador: ruta del repositorio, Chrome, puppeteer-core y carpeta de capturas. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..') + '/';

function buscarChrome() {
  const candidatos = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const hallado = candidatos.find(p => fs.existsSync(p));
  if (!hallado) throw new Error('No se encontró Chrome. Define la variable CHROME_PATH con la ruta del ejecutable.');
  return hallado;
}

function cargarPuppeteer() {
  // puppeteer-core se instala una vez en manual/fuente (npm install); también se acepta uno instalado en la raíz o en pruebas/
  const rutas = [REPO, REPO + 'pruebas', REPO + 'manual/fuente'];
  try { return require(require.resolve('puppeteer-core', { paths: rutas })); }
  catch (e) { throw new Error('Falta puppeteer-core. Ejecuta una vez:  cd pruebas && npm install'); }
}

const CAPTURAS = path.join(os.tmpdir(), 'oxodocs-capturas');
fs.mkdirSync(CAPTURAS, { recursive: true });

module.exports = { REPO, CHROME: buscarChrome(), puppeteer: cargarPuppeteer(), CAPTURAS };
