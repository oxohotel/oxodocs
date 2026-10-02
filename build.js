/**
 * build.js - Compilador de Frontend para GitHub Pages / Vercel
 *
 * Emula el motor de plantillas de Google Apps Script <?!= include('...') ?>
 * inyectando todas las vistas, estilos y scripts en un único archivo dist/index.html,
 * e incorporando el Polyfill transparente de google.script.run para comunicarse
 * directamente con la API de Google Apps Script.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const ENTRY_HTML = fs.existsSync(path.join(ROOT_DIR, 'index.template.html'))
  ? path.join(ROOT_DIR, 'index.template.html')
  : path.join(ROOT_DIR, 'index.html');
const OUTPUT_HTML = path.join(DIST_DIR, 'index.html');
const ROOT_OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');

// URL del despliegue Web App de Google Apps Script
const APPS_SCRIPT_API_URL = 'https://script.google.com/macros/s/AKfycbzNYPbS_6yLoKwmhUPD4IhipUOVTGMobco4nEWtFtxD0mNdNXeW-sETcfflHD6-GY7qGg/exec';

function resolveInclude(filePath) {
  let candidate = filePath;
  if (!candidate.endsWith('.html')) {
    candidate += '.html';
  }

  const fullPath = path.join(ROOT_DIR, candidate);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }

  console.warn(`⚠️ Archivo de inclusión no encontrado: ${filePath} (${fullPath})`);
  return `<!-- Archivo no encontrado: ${filePath} -->`;
}

function compileTemplate(content, depth = 0) {
  if (depth > 10) return content; // Evitar loops recursivos

  const includeRegex = /<\?!\s*=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g;
  let matchesFound = false;

  const result = content.replace(includeRegex, (match, includePath) => {
    matchesFound = true;
    const includedContent = resolveInclude(includePath);
    return compileTemplate(includedContent, depth + 1);
  });

  return result;
}

function generateApiBridgeScript() {
  return `
  <!-- ============================================================================== -->
  <!-- OXODOCS API BRIDGE: Polyfill de google.script.run para GitHub Pages / Vercel  -->
  <!-- ============================================================================== -->
  <script>
    (function() {
      var APPS_SCRIPT_API_URL = '${APPS_SCRIPT_API_URL}';
      window.APPS_SCRIPT_API_URL = APPS_SCRIPT_API_URL;

      if (!window.google) window.google = {};
      if (!window.google.script) window.google.script = {};

      // Apps Script (plan gratuito) rechaza intermitentemente alguna petición cuando llegan
      // varias casi al mismo tiempo (ver OXODOCS: ráfagas de google.script.run al cargar el
      // Home). Reintentar automáticamente es seguro SOLO para lecturas (nombradas "obtenerX"
      // por convención en todo el backend) — nunca para escrituras (crear/guardar/eliminar/...),
      // porque reintentar una escritura cuyo request sí llegó pero cuya respuesta se perdió
      // duplicaría la acción (ej. subir el mismo archivo dos veces).
      function esLecturaReintentable_(nombreAccion) {
        return /^obtener/i.test(nombreAccion);
      }

      // Escrituras en curso: mientras haya una (guardar, crear, subir, verificar código...) los paneles y
      // modales se niegan a cerrarse y el navegador avisa antes de cerrar/recargar la pestaña, para no
      // perder datos ni dejar una operación a medias. Las lecturas y las tareas de fondo no cuentan.
      var escriturasEnCurso_ = 0;
      function cuentaComoEscritura_(nombreAccion) {
        return !/^(obtener|registrarAuditoria|registrarActividad|cerrarSesionUsuario|validarCredenciales|verificarEmailExistente)/i.test(nombreAccion);
      }
      window.oxoEscrituraEnCurso = function () { return escriturasEnCurso_ > 0; };
      window.addEventListener('beforeunload', function (e) {
        if (escriturasEnCurso_ > 0) { e.preventDefault(); e.returnValue = ''; }
      });

      function esperar_(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
      }

      function createRunner(successCallback, failureCallback) {
        var runnerObj = {
          withSuccessHandler: function(cb) {
            return createRunner(cb, failureCallback);
          },
          withFailureHandler: function(cb) {
            return createRunner(successCallback, cb);
          },
          withUserObject: function(obj) {
            return createRunner(successCallback, failureCallback);
          }
        };

        return new Proxy(runnerObj, {
          get: function(target, prop) {
            if (prop in target) {
              return target[prop];
            }

            return async function() {
              var args = Array.prototype.slice.call(arguments);
              var intentosMax = esLecturaReintentable_(prop) ? 2 : 1;
              var esEscritura = cuentaComoEscritura_(prop);
              if (esEscritura) escriturasEnCurso_++;
              // Se libera ANTES de llamar los callbacks: así un callback que cierra su panel al terminar no es rechazado.
              var liberada = false;
              function liberar() { if (esEscritura && !liberada) { liberada = true; escriturasEnCurso_--; } }
              try {

              for (var intento = 1; intento <= intentosMax; intento++) {
                try {
                  var response = await fetch(APPS_SCRIPT_API_URL, {
                    method: 'POST',
                    redirect: 'follow',
                    headers: {
                      'Content-Type': 'text/plain;charset=utf-8'
                    },
                    body: JSON.stringify({
                      action: prop,
                      args: args
                    })
                  });

                  if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                  }

                  var resJson = await response.json();
                  liberar();
                  if (resJson && resJson.success) {
                    if (typeof successCallback === 'function') {
                      successCallback(resJson.data);
                    }
                  } else {
                    var errMsg = resJson ? resJson.message : 'Error desconocido en backend';
                    var errorObj = new Error(errMsg);
                    if (typeof failureCallback === 'function') {
                      failureCallback(errorObj);
                    } else {
                      console.error('❌ Error API (' + prop + '):', errMsg);
                      if (typeof showNotification === 'function') {
                        showNotification(errMsg, 'error', 4500);
                      }
                    }
                  }
                  return;
                } catch (networkError) {
                  if (intento >= intentosMax) liberar();
                  if (intento < intentosMax) {
                    console.warn('⚠️ Fallo de red (' + prop + '), reintentando (' + intento + '/' + intentosMax + ')...', networkError);
                    await esperar_(400 * intento + Math.floor(Math.random() * 300)); // algo de azar: que los reintentos de muchos usuarios no coincidan
                    continue;
                  }
                  console.error('❌ Fallo de red (' + prop + '):', networkError);
                  if (typeof failureCallback === 'function') {
                    failureCallback(networkError);
                  } else {
                    if (typeof showNotification === 'function') {
                      showNotification('Error de conexión con el servidor Apps Script.', 'error', 4500);
                    }
                  }
                }
              }
              } finally {
                liberar();
              }
            };
          }
        });
      }

      window.google.script.run = createRunner();
      console.log('🚀 [OxoDocs API Bridge] Polyfill google.script.run activo y conectado.');
    })();
  </script>
`;
}

function build() {
  console.log('📦 Iniciando compilación de OxoDocs para GitHub Pages...');

  if (!fs.existsSync(ENTRY_HTML)) {
    console.error(`❌ No se encontró ${ENTRY_HTML}`);
    process.exit(1);
  }

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const rawHtml = fs.readFileSync(ENTRY_HTML, 'utf-8');
  let compiledHtml = compileTemplate(rawHtml);

  // Inyectar el Polyfill de API Bridge justo después de abrir <head> o antes de los scripts
  const bridgeScript = generateApiBridgeScript();
  if (compiledHtml.includes('<head>')) {
    compiledHtml = compiledHtml.replace('<head>', '<head>\n' + bridgeScript);
  } else {
    compiledHtml = bridgeScript + '\n' + compiledHtml;
  }

  fs.writeFileSync(OUTPUT_HTML, compiledHtml, 'utf-8');
  fs.writeFileSync(ROOT_OUTPUT_HTML, compiledHtml, 'utf-8');
  console.log(`✅ Compilación exitosa:`);
  console.log(`   - ${OUTPUT_HTML}`);
  console.log(`   - ${ROOT_OUTPUT_HTML}`);
  console.log('🌐 Listo para desplegar en GitHub Pages o probar en local.');
}

build();
