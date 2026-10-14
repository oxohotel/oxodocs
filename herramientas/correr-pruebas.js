#!/usr/bin/env node
/**
 * Corre las pruebas del repositorio y resume el resultado. Sale con código 1 si alguna falla.
 *
 *   node herramientas/correr-pruebas.js              → pruebas de backend (simuladores en Node, segundos)
 *   node herramientas/correr-pruebas.js --navegador  → además las de navegador (Chrome con servidor simulado, ~3 min)
 *   node herramientas/correr-pruebas.js --solo texto → solo las pruebas cuyo nombre contenga "texto"
 *
 * Las pruebas en Apps Script REAL son aparte: ver pruebas-gas/README.md.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const args = process.argv.slice(2);
const conNavegador = args.includes('--navegador');
const iSolo = args.indexOf('--solo');
const solo = iSolo !== -1 ? (args[iSolo + 1] || '') : '';

const lista = (carpeta, excluir) => fs.readdirSync(path.join(RAIZ, 'pruebas', carpeta)).filter(f => f.endsWith('.js') && !f.startsWith('_') && !(excluir || []).includes(f)).sort()
  .map(f => ({ grupo: carpeta, nombre: f.replace(/\.js$/, ''), ruta: path.join(RAIZ, 'pruebas', carpeta, f) }));

let pruebas = lista('backend');
if (conNavegador) pruebas = pruebas.concat(lista('navegador'));
if (solo) pruebas = pruebas.filter(p => (p.grupo + '/' + p.nombre).includes(solo));
if (!pruebas.length) { console.error('Ninguna prueba coincide.'); process.exit(1); }

const resultados = [];
for (const p of pruebas) {
  const inicio = Date.now();
  process.stdout.write('  ' + (p.grupo + '/' + p.nombre).padEnd(34));
  const r = spawnSync(process.execPath, [p.ruta], { encoding: 'utf8', cwd: RAIZ, timeout: 15 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
  const salida = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const comprobaciones = (salida.match(/^OK /gm) || []).length;
  const fallas = (salida.match(/^FALLA/gm) || []).length;
  console.log((ok ? '✔ ' : '✖ ') + (comprobaciones ? comprobaciones + ' comprobaciones' : '') + (fallas ? ', ' + fallas + ' fallas' : '') + '  (' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s)');
  if (!ok) {
    const lineas = salida.split('\n').filter(l => /^FALLA|^ERROR|Error|Cannot find/.test(l)).slice(0, 6);
    lineas.forEach(l => console.log('      ' + l.slice(0, 200)));
  }
  resultados.push({ ...p, ok });
}

const malas = resultados.filter(r => !r.ok);
console.log('\n' + (malas.length ? '✖ ' + malas.length + ' de ' + resultados.length + ' pruebas fallaron: ' + malas.map(m => m.grupo + '/' + m.nombre).join(', ') : '✔ Las ' + resultados.length + ' pruebas pasaron'));
process.exit(malas.length ? 1 : 0);
