#!/usr/bin/env node
/**
 * Ejecuta las pruebas en Apps Script REAL (proyecto de PRUEBAS) desde la computadora, suite por suite (cada llamada web tiene el límite
 * de 6 minutos de Apps Script), e imprime el resultado.
 *
 *   node herramientas/ejecutar-pruebas-gas.js                 → todas las suites
 *   node herramientas/ejecutar-pruebas-gas.js Caché           → solo las que contengan "Caché"
 *   node herramientas/ejecutar-pruebas-gas.js --sincronizar   → antes sube el código actual al proyecto de pruebas
 *
 * Requiere .pruebas-gas.config.json con webAppUrl y clave, y haber ejecutado prepararEntornoDePruebas una vez (pruebas-gas/README.md).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const archivo = path.join(RAIZ, '.pruebas-gas.config.json');
if (!fs.existsSync(archivo)) { console.error('Falta .pruebas-gas.config.json (ver pruebas-gas/README.md).'); process.exit(1); }
const config = JSON.parse(fs.readFileSync(archivo, 'utf8'));
if (!config.webAppUrl || !config.clave) { console.error('La configuración debe incluir webAppUrl y clave.'); process.exit(1); }

const args = process.argv.slice(2);
if (args.includes('--sincronizar')) {
  console.log('Subiendo el código actual al proyecto de pruebas…');
  execSync('node herramientas/sincronizar-pruebas.js --push', { cwd: RAIZ, stdio: 'inherit' });
}
const filtro = args.find(a => !a.startsWith('--'));
const SUITES = ['Caché real', 'Hojas reales', 'Candados reales', 'Flujos reales', 'Rendimiento real'];

async function llamar(accion, argumentos) {
  const r = await fetch(config.webAppUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, args: argumentos }) });
  const texto = await r.text();
  try { return JSON.parse(texto); } catch (e) { throw new Error('La web de pruebas no devolvió JSON (¿falta autorizar o la implementación es antigua?): ' + texto.slice(0, 120)); }
}

(async () => {
  let ok = 0, fallas = 0, omitidas = 0;
  const detalles = [];
  for (const suite of SUITES.filter(s => !filtro || s.toLowerCase().includes(filtro.toLowerCase()))) {
    process.stdout.write(suite.padEnd(20));
    const inicio = Date.now();
    let j;
    try { j = await llamar('ejecutarPruebasWeb', [config.clave, suite]); }
    catch (e) { // un corte de red no debe tumbar toda la corrida: se reintenta una vez
      process.stdout.write('(reintentando: ' + e.message + ') ');
      j = await llamar('ejecutarPruebasWeb', [config.clave, suite]);
    }
    if (!j.success) { console.log('✖ ' + j.message); fallas++; continue; }
    const r = j.data;
    ok += r.ok; fallas += r.fallas; omitidas += r.omitidas;
    console.log((r.fallas ? '✖ ' : '✔ ') + r.ok + ' OK, ' + r.fallas + ' fallas' + (r.omitidas ? ', ' + r.omitidas + ' omitidas' : '') + '  (' + ((Date.now() - inicio) / 1000).toFixed(0) + ' s)');
    detalles.push(...r.resultados);
  }
  const conNotas = detalles.filter(d => d.notas);
  const malas = detalles.filter(d => d.estado === 'FALLA');
  if (malas.length) {
    console.log('\nFALLAS:');
    malas.forEach(d => console.log('  ✖ [' + d.suite + '] ' + d.nombre + '\n      → ' + d.detalle));
  }
  if (conNotas.length) {
    console.log('\nOBSERVACIONES del entorno real (caracterización y tiempos):');
    conNotas.forEach(d => console.log('  · [' + d.suite + '] ' + d.nombre + '\n      ' + d.notas));
  }
  console.log('\n' + (fallas ? '✖ ' + fallas + ' fallas' : '✔ Sin fallas') + ' · ' + ok + ' OK' + (omitidas ? ' · ' + omitidas + ' omitidas' : ''));
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('✖ ' + e.message); process.exit(2); });
