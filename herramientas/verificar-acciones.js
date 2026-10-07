#!/usr/bin/env node
/**
 * Comprueba que la lista de acciones permitidas de Code.js (ACCIONES_PERMITIDAS_) coincide con lo que usa el frontend.
 * La lista es una puerta: lo que no está en ella deja de funcionar desde la web. Por eso la comprobación es ESTRICTA:
 *   - ERROR si el frontend referencia (como .nombre( o como texto 'nombre') una función pública del backend que NO está en la lista.
 *   - ERROR si la lista nombra una función que ya no existe en el backend, o una que termina en _ (interna).
 *   - AVISO si la lista incluye algo que el frontend no usa (superficie de ataque innecesaria).
 * Si algún nombre coincide por casualidad con otra cosa del frontend (falso positivo), se agrega a IGNORAR_ con su motivo.
 * Correr antes de cada publicación:  node herramientas/verificar-acciones.js
 */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

// Nombres que el frontend puede contener sin llamar al backend. Ninguno por ahora.
const IGNORAR_ = {};

const backend = fs.readdirSync(path.join(RAIZ, 'backend')).filter(f => f.endsWith('.js')).map(f => leer('backend', f)).join('\n') + '\n' + leer('Code.js');
const funciones = new Set([...backend.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)].map(m => m[1]));
const publicas = [...funciones].filter(n => !n.endsWith('_') && !['doPost', 'doGet', 'include'].includes(n));

const codigo = leer('Code.js');
const bloque = codigo.match(/const ACCIONES_PERMITIDAS_ = \[([\s\S]*?)\];/);
if (!bloque) { console.error('No se encontró ACCIONES_PERMITIDAS_ en Code.js'); process.exit(2); }
const permitidas = new Set([...bloque[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

const carpetasFront = ['scripts', 'views', 'components', 'styles'];
const frontend = carpetasFront
  .flatMap(d => fs.readdirSync(path.join(RAIZ, d)).filter(f => f.endsWith('.html')).map(f => leer(d, f)))
  .join('\n') + '\n' + leer('index.template.html') + '\n' + leer('build.js');

const comoLlamada = new Set([...frontend.matchAll(/\.([A-Za-z0-9_]+)\s*\(/g)].map(m => m[1]));
const comoTexto = new Set([...frontend.matchAll(/['"`]([A-Za-z0-9_]+)['"`]/g)].map(m => m[1]));

let errores = 0;
publicas.filter(n => !permitidas.has(n) && !IGNORAR_[n]).forEach(n => {
  if (comoLlamada.has(n)) { console.error('ERROR  el frontend llama a "' + n + '(" y no está en ACCIONES_PERMITIDAS_'); errores++; }
  else if (comoTexto.has(n)) { console.error('ERROR  el frontend menciona "' + n + '" como texto (¿llamada dinámica?) y no está en ACCIONES_PERMITIDAS_'); errores++; }
});
[...permitidas].filter(n => !funciones.has(n)).forEach(n => { console.error('ERROR  "' + n + '" está en la lista pero no existe en el backend'); errores++; });
[...permitidas].filter(n => n.endsWith('_')).forEach(n => { console.error('ERROR  "' + n + '" termina en _ (función interna): no debe estar permitida'); errores++; });
[...permitidas].filter(n => !comoLlamada.has(n) && !comoTexto.has(n)).forEach(n => console.warn('AVISO  "' + n + '" está permitida pero el frontend no la usa'));

const usadas = publicas.filter(n => comoLlamada.has(n) || comoTexto.has(n));
console.log(permitidas.size + ' acciones permitidas · ' + usadas.length + ' funciones públicas del backend referenciadas por el frontend · ' + errores + ' error(es)');
process.exit(errores ? 1 : 0);
