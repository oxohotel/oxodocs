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
              } catch (networkError) {
                console.error('❌ Fallo de red (' + prop + '):', networkError);
                if (typeof failureCallback === 'function') {
                  failureCallback(networkError);
                } else {
                  if (typeof showNotification === 'function') {
                    showNotification('Error de conexión con el servidor Apps Script.', 'error', 4500);
                  }
                }
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
