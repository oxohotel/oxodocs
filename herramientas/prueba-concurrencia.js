#!/usr/bin/env node
/**
 * Prueba de CONCURRENCIA contra el proyecto de PRUEBAS (jamás contra producción): lanza muchas llamadas en paralelo y comprueba
 * que no se pierden ni se duplican datos. Es lo único que ejercita de verdad los candados (LockService) entre ejecuciones simultáneas.
 *
 *   node herramientas/prueba-concurrencia.js [--concurrencia 20]
 *
 * Requiere .pruebas-gas.config.json con webAppUrl (URL de la implementación web del proyecto de pruebas) y clave (CLAVE_PRUEBAS).
 * Se niega a correr si la URL no es la del proyecto de pruebas: las acciones de siembra solo existen allí.
 */
const fs = require('fs');
const path = require('path');

const ARCHIVO_CONFIG = path.join(__dirname, '..', '.pruebas-gas.config.json');
if (!fs.existsSync(ARCHIVO_CONFIG)) { console.error('Falta .pruebas-gas.config.json (ver pruebas-gas/README.md).'); process.exit(1); }
const config = JSON.parse(fs.readFileSync(ARCHIVO_CONFIG, 'utf8'));
if (!config.webAppUrl || !config.clave) { console.error('La configuración debe incluir webAppUrl y clave.'); process.exit(1); }

const iConc = process.argv.indexOf('--concurrencia');
const CONCURRENCIA = iConc !== -1 ? Math.max(1, parseInt(process.argv[iConc + 1], 10) || 20) : 20;

async function llamar(accion, args) {
  try {
    const r = await fetch(config.webAppUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: accion, args: args || [] }) });
    const j = await r.json();
    if (!j.success) return { error: j.message || 'sin éxito' };
    return { data: j.data };
  } catch (e) {
    return { error: 'red: ' + (e.message || e) };
  }
}

/** Ejecuta las tareas con un máximo de "limite" en vuelo a la vez. */
async function enParalelo(tareas, limite) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, async () => {
    while (siguiente < tareas.length) { const i = siguiente++; resultados[i] = await tareas[i](); }
  }));
  return resultados;
}

let fallos = 0;
const informe = (ok, titulo, detalle) => { console.log((ok ? 'OK    ' : 'FALLA ') + titulo + (detalle ? '\n        ' + detalle : '')); if (!ok) fallos++; };
// Bajo saturación una llamada puede ser rechazada limpiamente (candado no obtenido a tiempo: success:false) sin tocar datos; eso NO es pérdida.
// Las invariantes se exigen sobre lo que SÍ respondió éxito. Una respuesta rota (error de red / página de error) es ambigua: no se exige nada.
const exito = r => !!(r && r.data && r.data.success);
const resumenErrores = rs => {
  const c = {}; rs.filter(r => r.error).forEach(r => { c[r.error] = (c[r.error] || 0) + 1; });
  return Object.entries(c).map(([m, n]) => n + '× ' + m.slice(0, 80)).join(' · ');
};

(async () => {
  console.log('Sembrando datos ficticios en el proyecto de pruebas…');
  const siembra = await llamar('sembrarDatosPruebasWeb', [config.clave]);
  if (siembra.error) {
    console.error('✖ No se pudo sembrar: ' + siembra.error + '\n  ¿Es la URL del proyecto de PRUEBAS? Estas acciones no existen en producción (y es lo correcto).');
    process.exit(1);
  }
  const tokens = siembra.data.tokens;
  console.log('Concurrencia máxima: ' + CONCURRENCIA + ' llamadas a la vez\n');

  const estado = async () => (await llamar('inspeccionarEstadoPruebasWeb', [config.clave])).data;

  // ---- S1: registros simultáneos
  const antesS1 = await estado();
  const emails = Array.from({ length: 25 }, (_, i) => 'conc' + Date.now().toString().slice(-6) + i + '@oxohotel.com');
  const rS1 = await enParalelo(emails.map(e => () => llamar('registrarUsuario', ['Persona Concurrente', e, 'Clave1234!', ['H1']])), CONCURRENCIA);
  const exitos = rS1.filter(r => r.data && r.data.success).length;
  const despuesS1 = await estado();
  const nuevos = despuesS1.usuarios.slice(antesS1.usuarios.length);
  const idsUnicos = new Set(despuesS1.usuarios.map(u => u.id));
  informe(exitos === nuevos.length && idsUnicos.size === despuesS1.usuarios.length,
    'S1. 25 registros simultáneos: sin IDs repetidos y sin filas perdidas',
    exitos + ' respondieron éxito, ' + nuevos.length + ' filas nuevas, ' + idsUnicos.size + '/' + despuesS1.usuarios.length + ' IDs únicos' + (resumenErrores(rS1) ? ' · errores: ' + resumenErrores(rS1) : ''));

  // ---- S2: auditoría simultánea (el ID se calcula sin candado)
  const antesS2 = (await estado()).auditoriaIds.length;
  const rS2 = await enParalelo(Array.from({ length: 30 }, (_, i) => () => llamar('registrarAuditoria', [{ usuarioId: 1, emailUsuario: 'sa@pruebas.oxo', tipo: 'Carga', descripcion: 'prueba ' + i, entidadAfectada: 'Usuario' }])), CONCURRENCIA);
  const sS2 = await estado();
  const nuevosIds = sS2.auditoriaIds.slice(antesS2);
  const duplicados = nuevosIds.length - new Set(sS2.auditoriaIds).size + antesS2;
  const acepS2 = rS2.filter(exito).length, ambS2 = rS2.filter(r => r.error).length;
  informe(nuevosIds.length >= acepS2 && nuevosIds.length <= acepS2 + ambS2 && new Set(sS2.auditoriaIds).size === sS2.auditoriaIds.length,
    'S2. 30 registros de auditoría simultáneos: ninguno se pierde y los IDs no se repiten',
    nuevosIds.length + ' filas nuevas de 30; IDs repetidos: ' + Math.max(0, sS2.auditoriaIds.length - new Set(sS2.auditoriaIds).size) + (resumenErrores(rS2) ? ' · errores: ' + resumenErrores(rS2) : ''));

  // ---- S3: una persona pide varias propiedades a la vez (cada llamada modifica la misma celda)
  const rS3 = await enParalelo(['H2', 'H3', 'H4', 'HC'].map(h => () => llamar('solicitarAccesoPropiedades', [tokens[5], [h]])), CONCURRENCIA);
  const u5 = (await estado()).usuarios.find(u => String(u.id) === '5');
  const pedidas = String(u5.solicitados).split(',').filter(Boolean).sort();
  informe(pedidas.join() === 'H2,H3,H4,HC', 'S3. 4 solicitudes simultáneas sobre la misma cuenta: no se pierde ninguna (sin "última escritura gana")',
    'quedaron pendientes: ' + (pedidas.join(', ') || '(ninguna)') + (resumenErrores(rS3) ? ' · errores: ' + resumenErrores(rS3) : ''));

  // ---- S4: dos administradores resuelven la misma cuenta a la vez
  const estadoS4 = await estado();
  const pendientes = estadoS4.usuarios.filter(u => String(u.estado) === 'Pendiente_Aprobacion').slice(0, 4);
  if (!pendientes.length) {
    informe(false, 'S4. dos administradores resuelven la misma cuenta a la vez', 'la siembra no dejó cuentas pendientes de aprobación');
  } else {
    const tareas = [];
    pendientes.forEach(p => {
      tareas.push(() => llamar('resolverSolicitudesUsuario', [p.id, ['H1'], [], tokens[2], '2']));
      tareas.push(() => llamar('resolverSolicitudesUsuario', [p.id, [], ['H2'], tokens[3], '3']));
    });
    const rS4 = await enParalelo(tareas, CONCURRENCIA);
    const despues = await estado();
    const rechazadas = pendientes.filter((p, k) => !exito(rS4[2 * k]) || !exito(rS4[2 * k + 1])).map(p => p.id);
    const malas = pendientes.filter(p => rechazadas.indexOf(p.id) === -1).filter(p => { const u = despues.usuarios.find(x => x.id === p.id); return !(u.estado === 'Activo' && String(u.hoteles) === 'H1' && String(u.solicitados) === ''); });
    informe(malas.length === 0, 'S4. ' + pendientes.length + ' cuentas resueltas por dos administradores a la vez: cada decisión se aplica una sola vez y ninguna se pisa',
      malas.length ? 'estado inconsistente en: ' + malas.map(p => p.email).join(', ') : 'las cuentas con ambas decisiones aceptadas quedaron Activo, con Distrito y sin pendientes' + (rechazadas.length ? ' (' + rechazadas.length + ' cuenta(s) con una decisión rechazada por saturación, sin tocar datos)' : '') + (resumenErrores(rS4) ? ' · errores: ' + resumenErrores(rS4) : ''));
  }

  // ---- S5: muchos registros de actividad a la vez
  const antesS5 = (await estado()).actividadFilas;
  const rS5 = await enParalelo(Array.from({ length: 60 }, () => () => llamar('registrarActividad', ['1', 'Hotel', 'H1', 'Abrir'])), CONCURRENCIA);
  const despuesS5 = (await estado()).actividadFilas;
  const acepS5 = rS5.filter(exito).length, ambS5 = rS5.filter(r => r.error).length;
  // Cada respuesta de éxito debe tener su fila; una respuesta rota puede haberla escrito o no
  informe(despuesS5 - antesS5 >= acepS5 && despuesS5 - antesS5 <= acepS5 + ambS5, 'S5. 60 registros de actividad simultáneos: ninguno se pierde',
    (despuesS5 - antesS5) + ' filas nuevas de 60' + (resumenErrores(rS5) ? ' · errores: ' + resumenErrores(rS5) : ''));

  // ---- S6: alternar el mismo favorito muchas veces a la vez (cada llamada lee y escribe)
  const rS6 = await enParalelo(Array.from({ length: 12 }, () => () => llamar('alternarFavorito', ['1', 'Hotel', 'H1'])), CONCURRENCIA);
  const favs = (await estado()).favoritos.filter(f => String(f.usuario) === '1' && f.recurso === 'H1');
  const aceptadas = rS6.filter(exito).length, ambiguas = rS6.filter(r => r.error).length;
  informe(ambiguas > 0 || favs.length === aceptadas % 2, 'S6. 12 alternancias simultáneas del mismo favorito: queda en el estado que corresponde (par de alternancias aceptadas → sin favorito)',
    'quedaron ' + favs.length + ' filas de ese favorito' + (resumenErrores(rS6) ? ' · errores: ' + resumenErrores(rS6) : ''));

  console.log(fallos ? '\n' + fallos + ' ESCENARIO(S) CON PROBLEMAS: hay datos perdidos o duplicados bajo concurrencia.' : '\nTODOS LOS ESCENARIOS PASARON');
  process.exit(fallos ? 1 : 0);
})();
