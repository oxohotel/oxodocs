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
