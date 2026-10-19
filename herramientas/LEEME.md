# Herramientas

Todas se ejecutan con `node herramientas/<nombre>.js`. Ninguna escribe en producción salvo `publicar.js` (con confirmación tuya).

| Herramienta | Para qué sirve |
|---|---|
| **`publicar.js`** | Publica el backend en producción: comprueba (árbol limpio, commit subido, build, acciones, sintaxis, pruebas), pide confirmación, sube, crea la versión y actualiza **la misma implementación** (la URL no cambia). También `--estado` y `--revertir` |
| **`correr-pruebas.js`** | Corre las pruebas de `pruebas/`: backend (segundos) y, con `--navegador`, las de navegador (~3 min) |
| **`verificar-acciones.js`** | Comprueba que la lista de acciones permitidas de `Code.js` coincide con lo que usa el frontend |
| **`sincronizar-pruebas.js`** | Prepara y sube el código al proyecto de Apps Script de **pruebas** (sin correos reales, sin Drive, sin la hoja de producción) |
| **`prueba-concurrencia.js`** | Ejecuciones simultáneas contra el proyecto de pruebas, para comprobar que los candados evitan pérdidas y duplicados |
| **`ejecutar-pruebas-gas.js`** | Corre las pruebas reales (Apps Script de pruebas) suite por suite desde la computadora (`--sincronizar` sube antes el código) |
| **`medir-velocidad.js`** | Mide lo que tarda cada paso que hace una persona (iniciar sesión, inicio, propiedad, carpetas, búsqueda, archivo, cerrar sesión) con una cuenta real: `OXO_EMAIL=… OXO_CLAVE=… node herramientas/medir-velocidad.js`. Las credenciales solo se leen del entorno |
| **`prueba-carga.js`** | Simula N personas entrando al sistema (solo lecturas). Requiere confirmación explícita |

## Publicar y volver atrás

```
node herramientas/publicar.js --solo-comprobar     # solo las comprobaciones, no publica
node herramientas/publicar.js                      # comprueba, pide confirmación y publica (versión nueva sobre la misma implementación)
node herramientas/publicar.js --estado             # qué versión está publicada hoy y las últimas versiones
node herramientas/publicar.js --revertir           # vuelve a la versión publicada justo antes (con confirmación)
node herramientas/publicar.js --revertir 150       # vuelve a la versión 150
```

Reglas del flujo:

1. Primero `git commit` y `git push oxohotel main`: se publica exactamente lo que está en el commit, y backend y frontend salen del mismo commit.
2. **Volver atrás solo cambia el backend.** El frontend (GitHub Pages) sigue siendo el del último commit; si usa acciones que la versión antigua no tiene, esas pantallas mostrarán error hasta que vuelvas a publicar o hagas `git revert` del frontend.
3. Cada publicación queda en `.publicaciones.json` (local, no se sube a git).
4. `--pruebas` (en `publicar.js`) hace lo mismo sobre el proyecto de **pruebas**: sirve para ensayar el flujo sin riesgo.

## Pruebas

- **Node y navegador** (`pruebas/`): `node herramientas/correr-pruebas.js [--navegador]`. Las de navegador necesitan `cd pruebas && npm install` una vez.
- **Apps Script real** (`pruebas-gas/`): ver `pruebas-gas/README.md`.

## Volumen de las pruebas

Las pruebas de rendimiento usan **600 personas, 500 carpetas y 5.000 archivos** (más 3.000 actividades, 6.000 favoritos y 4.000 sesiones), más que lo que hay hoy en producción. Los tiempos solo son comparables entre corridas con ese mismo volumen; el detalle y los resultados de referencia están en `pruebas-gas/README.md`.

## Copia de seguridad de la base de datos

Todo el orden del sistema vive en el Google Sheet. `backend/Respaldos.js` hace una copia completa cada noche (~3 a.m.) en la carpeta de Drive **«OXO Docs - Respaldos»** (en el Drive de la cuenta dueña del script), la verifica (misma cantidad de pestañas y de filas en Usuarios, Carpetas y Archivos) y aplica la retención: las de los últimos 30 días, la más antigua de cada mes de los últimos 6 y siempre las 3 más recientes. Lo demás va a la papelera de Drive (recuperable ~30 días). Si falla, avisa por correo a la cuenta dueña y a los superadministradores; y si pasan 36 horas sin copia buena, vuelve a avisar (una vez al día).

Desde el editor de Apps Script (Ejecutar → función):

| Función | Para qué |
|---|---|
| `instalarRespaldoDiario` | Una sola vez: crea el disparador diario, hace la primera copia y activa la vigilancia |
| `respaldarHojas` | Hace una copia ahora |
| `estadoDeRespaldos` | Muestra si está activo, la última copia buena, el último error y cuántas copias hay |
| `desinstalarRespaldoDiario` | Quita el disparador (las copias ya hechas se quedan) |

**Recuperar datos.** Abre la copia que quieras en la carpeta de respaldos (el nombre lleva la fecha y hora). Para recuperar una pestaña o unas filas: cópialas desde la copia y pégalas (solo valores) en la pestaña del Sheet real. No cambies el Sheet real por una copia entera: el sistema usa el ID del Sheet real. Para deshacer algo muy reciente también sirve Archivo → Historial de versiones del Sheet real.
