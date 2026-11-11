# ⚛ Núcleo — Entiende tu diagnóstico

Sitio web libre y gratuito que traduce los **códigos CIE-10** y las **siglas** de una historia clínica a palabras sencillas, con explicaciones de **MedlinePlus** (Biblioteca Nacional de Medicina de EE. UU.) en español.

- **Sin servidor y sin costo:** es un sitio estático (HTML + CSS + JS) alojable en GitHub Pages.
- **Privado:** la búsqueda y el análisis de texto ocurren en el navegador. Solo al abrir una ficha se envía *el código* a MedlinePlus.
- **Sin IA generativa:** la base son tablas oficiales y fuentes revisadas, así que no inventa diagnósticos.

## Estructura

```
nucleo/
├── data_pipeline/            ← Python: genera la base de datos
│   ├── build_db.py           ← CSV/XLSX → docs/data/*.json
│   └── raw/
│       ├── cie10_muestra.csv ← 154 códigos frecuentes (DEMO)
│       ├── sinonimos.csv     ← términos coloquiales por código
│       └── abreviaturas.csv  ← siglas médicas (HTA, DM2, EPOC…)
├── docs/                     ← EL SITIO (lo que publica GitHub Pages)
│   ├── index.html
│   ├── css/styles.css
│   ├── js/
│   │   ├── app.js            ← interfaz y enrutador (#/c/J459, #/texto…)
│   │   ├── search.js         ← motor de búsqueda (índice invertido + Levenshtein)
│   │   ├── medlineplus.js    ← cliente de MedlinePlus Connect (JSONP + caché 24 h)
│   │   └── glossary.js       ← explica “no especificada”, “agudo”, “esencial”…
│   ├── data/                 ← JSON generados (no editar a mano)
│   └── assets/logo.svg
├── Makefile
└── LICENSE (MIT)
```

## Uso rápido

```bash
make build     # regenera docs/data/*.json
make serve     # abre http://localhost:8000
```

Sin `make`: `python3 data_pipeline/build_db.py` y `python3 -m http.server 8000 -d docs`.

> El sitio **no funciona abriendo `index.html` con doble clic** (`file://`). Los navegadores bloquean `fetch()` de archivos locales, así que hay que servirlo por HTTP.

## Usar la tabla CIE-10 completa (≈ 12 000 códigos)

La muestra incluida es de demostración. Para la tabla completa:

1. Descarga la tabla de referencia CIE-10 de MinSalud desde SISPRO (web.sispro.gov.co → Tablas de referencia → CIE10) en Excel o CSV.
2. Instala `openpyxl` si es Excel: `pip install openpyxl`.
3. Genera la base. El script detecta solo las columnas de código y nombre, el separador y la codificación:
   ```bash
   python3 data_pipeline/build_db.py --cie10 ~/Descargas/TablaCIE10.xlsx
   # si no detecta las columnas:
   python3 data_pipeline/build_db.py --cie10 tabla.csv --col-codigo Codigo --col-nombre Nombre
   ```
   Los sinónimos de `sinonimos.csv` se mezclan automáticamente por código.

⚠️ **Licencia de los datos:** la CIE-10 es de la OMS y la traducción al español de la OPS. Antes de publicar la tabla completa en un repositorio público, revisa sus condiciones de redistribución. El código del proyecto es MIT; los datos tienen su propia licencia.

## MedlinePlus Connect

- API oficial: https://medlineplus.gov/medlineplus-connect/web-service/
- Límite: **100 consultas/minuto por IP**. Por eso las respuestas se guardan 24 h en `localStorage`, como recomienda la NLM.
- Condiciones: citar MedlinePlus.gov como fuente, **no usar su logo** y no sugerir que respalda el sitio.
- Colombia usa la CIE-10 de la OMS y MedlinePlus usa la ICD-10-CM de EE. UU. Coinciden en la mayoría de categorías, pero no en todas. Si un código específico no tiene resultado, el sitio prueba con la categoría de 3 caracteres (J45.9 → J45).

## Aviso

Herramienta informativa. **No reemplaza la consulta médica.** Antes de difundirla ampliamente, pide a un profesional de la salud que revise una muestra de resultados, en especial las siglas y los sinónimos.
