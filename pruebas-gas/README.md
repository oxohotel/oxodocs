# Pruebas en Apps Script real

Estas pruebas corren **dentro de Apps Script de verdad** (CacheService, LockService, SpreadsheetApp, hash real de contraseñas…) contra una hoja de cálculo de **pruebas con datos ficticios**. Complementan las pruebas de Node, que son rápidas pero usan simuladores y no detectan diferencias con el entorno real (límite de tamaño del caché, cómo cuenta los bytes, qué devuelve Sheets, comportamiento de los candados…).

> **Nunca se ejecutan en producción.** Este directorio no se sube al proyecto de producción (`.claspignore` solo permite `backend/`, `scripts/`, etc.). Se sube a un **proyecto de Apps Script aparte** con `herramientas/sincronizar-pruebas.js`.

## Por qué un proyecto aparte y datos ficticios

- El caché (`CacheService`) y los candados (`LockService`) son **por proyecto**. Si las pruebas corrieran en el proyecto de producción, mezclarían su caché y sus candados con los reales.
- No se copia la base real: tiene hashes de contraseñas y datos personales. Las pruebas siembran usuarios y hoteles **ficticios** con la misma estructura de columnas.

## Protecciones (cualquiera que falle detiene todo)

1. La propiedad de script `ENTORNO` debe valer `PRUEBAS` (solo existe en el proyecto de pruebas).
2. La hoja configurada no puede ser la de producción (`Seguridad.js`, generado por la herramienta, tiene el ID prohibido).
3. `herramientas/sincronizar-pruebas.js` cambia al copiar el código:
   - `SPREADSHEET_ID` → la hoja de pruebas.
   - `ROOT_FOLDER_ID` → `PRUEBAS-SIN-CARPETA-RAIZ`: cualquier llamada a Drive falla al instante.
   - `MailApp.sendEmail(` → `capturarCorreo_(`: **ninguna prueba envía un correo de verdad**. Los correos se capturan en memoria y se verifican.
4. La herramienta se niega a subir si el `scriptId` o la hoja son los de producción, y revisa la carpeta preparada antes de subir.

## Puesta en marcha (una sola vez)

1. Crea una **hoja de cálculo vacía** llamada `OxoDocs - PRUEBAS` (sin datos reales). Copia su ID.
2. Crea un **proyecto de Apps Script independiente** llamado `OxoDocs - PRUEBAS` (script.google.com → Nuevo proyecto). Copia su ID de script.
3. Copia `.pruebas-gas.config.ejemplo.json` a `.pruebas-gas.config.json` y completa `scriptId` y `spreadsheetId`.
4. Sube el código: `node herramientas/sincronizar-pruebas.js --push`.
5. En el editor del proyecto de pruebas, ejecuta **`prepararEntornoDePruebas`** una vez (pide autorización). Imprime la `CLAVE_PRUEBAS`.

## Ejecutar las pruebas

- **Desde el editor:** ejecuta `ejecutarPruebas`. Resultado en el registro de ejecución y en la hoja `Resultados_Pruebas` de la hoja de pruebas.
  - Para un grupo: `ejecutarPruebas('Caché')`, `'Hojas'`, `'Candados'`, `'Flujos'`, `'Rendimiento'`.
- **Desde la computadora:** despliega el proyecto de pruebas como aplicación web, pon `webAppUrl` y `clave` en la configuración y llama a la acción `ejecutarPruebasWeb`.

Cada vez que cambies el backend: `node herramientas/sincronizar-pruebas.js --push` y vuelve a ejecutar.

## Qué se prueba

| Suite | Qué comprueba en el entorno real |
|---|---|
| **Caché real** | Límite de 100 KB, si cuenta bytes o caracteres, trozos con símbolos de 3 bytes, `getAll` con claves ausentes, expiración, ida y vuelta de 800 usuarios, trozo perdido, contador de generación, calentamiento y disparadores reales |
| **Hojas reales** | Tipos que devuelve Sheets (un nombre `2026` llega como número), añadir una columna sin columnas libres, filas más anchas que la hoja, recorte en bloque de miles de filas, IDs de auditoría, registro completo |
| **Candados reales** | Tomar/soltar, candado anidado en la misma ejecución (caracterización), liberación tras un error, que registrar actividad no espere el candado |
| **Flujos reales** | Registro → verificación → aprobación por propiedad → inicio de sesión con hash real; token recuperado desde la hoja si el caché lo pierde; pedir acceso adicional; `doPost` real con la lista de acciones permitidas; alcance por propiedad |
| **Rendimiento real** | Línea base con 600 usuarios: caliente vs. frío, usuarios para gestión, auditoría con 3.000 filas, tamaño del caché |

Las pruebas de **caracterización** no fallan: guardan en las *notas* cómo se comporta el entorno real (por ejemplo, si el candado es reentrante) para decidir con datos.

## Volumen de datos de las pruebas (tenlo presente al comparar tiempos)

Los números de rendimiento solo se pueden comparar entre corridas **con el mismo volumen**. Este es el que usan hoy las pruebas (está en `Pruebas_Rendimiento.js`, `Entorno.js` y `herramientas/prueba-concurrencia.js`):

| Dato | Volumen de prueba | Dónde se siembra |
|---|---|---|
| **Personas** | **600** (más las 6 de partida) | `sembrarUsuariosMasivos_(600)` |
| **Carpetas** | **500** (20 áreas + 480 subcarpetas) en una propiedad | prueba «abrir una carpeta con 500 carpetas y 5.000 archivos» |
| **Archivos** | **5.000** (10 por carpeta) | la misma prueba |
| Actividad reciente | 3.000 filas | prueba «pantalla de inicio y Mis accesos con volumen realista» |
| Favoritos | 6.000 filas | la misma prueba |
| Sesiones | 4.000 filas (inicio y cierre de sesión) y 5.000 (limpieza) | pruebas de sesiones |
| Auditoría | 3.000 filas | prueba de auditoría |
| Concurrencia | hasta 20 llamadas simultáneas: 25 registros, 30 auditorías, 60 actividades, 12 favoritos | `prueba-concurrencia.js` |

**Referencia de resultados con ese volumen** (tiempos del servidor, sin los 2-3 s de red de Google; varían entre corridas): abrir una carpeta 3,5-6 s sin caché y 0,3-0,5 s con caché; pantalla de inicio 5-6 s antes y ~1,1 s con caché por persona; iniciar sesión 1,6 s; cerrar sesión 0,3 s; índice del buscador 0,7 s sin caché y 0,2 s con caché; `calentarCaches` (el disparador de cada 10 minutos) unos 4 s; limpiar 5.000 sesiones 2,6 s.

**Ese volumen es MAYOR que el de producción hoy** (unas 37 propiedades, pocos archivos por carpeta). Sirve para detectar problemas antes de que lleguen. Si el sistema crece mucho más que estos números (por ejemplo 5 veces), conviene volver a medir con un volumen mayor y revisar: el tamaño de lo que cabe en el caché (CacheService guarda trozos de ~30.000 caracteres; con muchísimas filas un valor puede no caber y se lee de la hoja), la hoja `Archivos` (cada lectura completa crece con ella) y el tiempo de `calentarCaches`.

## Concurrencia entre ejecuciones

Los candados solo se prueban de verdad con ejecuciones simultáneas. `node herramientas/prueba-concurrencia.js` lanza decenas de llamadas en paralelo contra la web del proyecto de pruebas y comprueba que no se pierden ni se duplican datos:

- 25 registros simultáneos (IDs únicos, sin filas perdidas)
- 30 registros de auditoría simultáneos
- 4 solicitudes simultáneas sobre la misma cuenta
- Dos administradores resolviendo la misma cuenta a la vez
- 60 registros de actividad simultáneos
- 12 alternancias simultáneas del mismo favorito

Se niega a correr si la URL no es la del proyecto de pruebas (las acciones de siembra solo existen allí).

## Qué NO cubre (todavía)

- Funciones que usan Drive (crear/mover/borrar carpetas y archivos): se bloquean a propósito. Se podrían probar contra una carpeta de pruebas propia.
- El envío real de correos: se capturan para verificar contenido y destinatarios, pero no se prueba la entrega.
