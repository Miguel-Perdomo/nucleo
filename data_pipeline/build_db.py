#!/usr/bin/env python3
"""
build_db.py — Convierte las tablas fuente (CIE-10, sinónimos y abreviaturas)
en los archivos JSON compactos que usa el sitio web (docs/data/).

Uso básico (con la muestra incluida):
    python3 data_pipeline/build_db.py

Con la tabla oficial de MinSalud (CSV o XLSX descargado de SISPRO):
    python3 data_pipeline/build_db.py --cie10 ruta/a/TablaCIE10.xlsx
    python3 data_pipeline/build_db.py --cie10 tabla.csv --col-codigo Codigo --col-nombre Nombre

Solo usa la biblioteca estándar. Para leer .xlsx instala openpyxl:
    pip install openpyxl
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT_DEFAULT = ROOT.parent / "docs" / "data"

# ---------------------------------------------------------------------------
# Capítulos de la CIE-10 (OMS). (desde, hasta, romano, nombre oficial, en palabras simples)
# ---------------------------------------------------------------------------
CHAPTERS = [
    ("A00", "B99", "I", "Ciertas enfermedades infecciosas y parasitarias", "Infecciones"),
    ("C00", "D48", "II", "Tumores [neoplasias]", "Tumores y cáncer"),
    ("D50", "D89", "III", "Enfermedades de la sangre y de los órganos hematopoyéticos, y ciertos trastornos que afectan el mecanismo de la inmunidad", "Sangre y defensas"),
    ("E00", "E90", "IV", "Enfermedades endocrinas, nutricionales y metabólicas", "Hormonas, nutrición y metabolismo"),
    ("F00", "F99", "V", "Trastornos mentales y del comportamiento", "Salud mental"),
    ("G00", "G99", "VI", "Enfermedades del sistema nervioso", "Cerebro y nervios"),
    ("H00", "H59", "VII", "Enfermedades del ojo y sus anexos", "Ojos"),
    ("H60", "H95", "VIII", "Enfermedades del oído y de la apófisis mastoides", "Oídos"),
    ("I00", "I99", "IX", "Enfermedades del sistema circulatorio", "Corazón y circulación"),
    ("J00", "J99", "X", "Enfermedades del sistema respiratorio", "Pulmones y respiración"),
    ("K00", "K93", "XI", "Enfermedades del sistema digestivo", "Digestión"),
    ("L00", "L99", "XII", "Enfermedades de la piel y del tejido subcutáneo", "Piel"),
    ("M00", "M99", "XIII", "Enfermedades del sistema osteomuscular y del tejido conjuntivo", "Huesos, músculos y articulaciones"),
    ("N00", "N99", "XIV", "Enfermedades del sistema genitourinario", "Riñones, vías urinarias y órganos genitales"),
    ("O00", "O99", "XV", "Embarazo, parto y puerperio", "Embarazo y parto"),
    ("P00", "P96", "XVI", "Ciertas afecciones originadas en el período perinatal", "Recién nacidos"),
    ("Q00", "Q99", "XVII", "Malformaciones congénitas, deformidades y anomalías cromosómicas", "Condiciones de nacimiento"),
    ("R00", "R99", "XVIII", "Síntomas, signos y hallazgos anormales clínicos y de laboratorio, no clasificados en otra parte", "Síntomas y hallazgos"),
    ("S00", "T98", "XIX", "Traumatismos, envenenamientos y algunas otras consecuencias de causa externa", "Lesiones e intoxicaciones"),
    ("V01", "Y98", "XX", "Causas externas de morbilidad y de mortalidad", "Causas externas (accidentes)"),
    ("Z00", "Z99", "XXI", "Factores que influyen en el estado de salud y contacto con los servicios de salud", "Controles y motivos de consulta"),
    ("U00", "U99", "XXII", "Códigos para situaciones especiales", "Códigos especiales"),
]

# Código CIE-10 en formato colombiano: letra + 2 dígitos + (dígito | X)? + dígito?
CODE_RE = re.compile(r"^[A-Z][0-9]{2}(?:[0-9X][0-9]?)?$")


def chapter_index(code: str) -> int:
    """Devuelve el índice del capítulo para un código ya normalizado (o -1)."""
    head = code[:3]
    for i, (lo, hi, *_rest) in enumerate(CHAPTERS):
        if lo <= head <= hi:
            return i
    return -1


def norm_code(raw: str) -> str:
    """'j45.9' -> 'J459'; 'I10' -> 'I10' ; ' I10X ' -> 'I10X'."""
    return re.sub(r"[\s.\-]", "", str(raw)).upper()


def fix_case(text: str) -> str:
    """Las tablas oficiales a veces vienen en MAYÚSCULAS: pasa a tipo oración."""
    text = " ".join(str(text).split())
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.9:
        text = text.lower()
        text = text[:1].upper() + text[1:]
        # Restaura siglas habituales
        for sig in ("vih", "covid-19", "sida"):
            text = re.sub(rf"\b{sig}\b", sig.upper(), text)
    return text


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


# ---------------------------------------------------------------------------
# Lectura de tablas
# ---------------------------------------------------------------------------
def read_rows(path: Path) -> list[dict[str, str]]:
    """Lee CSV (detecta codificación y separador) o XLSX y devuelve dicts."""
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            sys.exit("Para leer .xlsx instala openpyxl:  pip install openpyxl")
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(it)]
        return [
            {header[i]: ("" if v is None else str(v)) for i, v in enumerate(row) if i < len(header)}
            for row in it
        ]

    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return list(csv.DictReader(text.splitlines(), dialect=dialect))


def find_column(headers: list[str], wanted: str | None, hints: tuple[str, ...]) -> str:
    if wanted:
        if wanted not in headers:
            sys.exit(f"La columna '{wanted}' no existe. Columnas: {headers}")
        return wanted
    for h in headers:
        hn = strip_accents(h).lower()
        if any(k in hn for k in hints):
            return h
    sys.exit(f"No pude detectar la columna ({'/'.join(hints)}). Columnas: {headers}. "
             "Usa --col-codigo / --col-nombre.")


# ---------------------------------------------------------------------------
# Construcción
# ---------------------------------------------------------------------------
def build_cie10(path: Path, syn_path: Path | None, col_code: str | None, col_name: str | None):
    rows = read_rows(path)
    if not rows:
        sys.exit(f"{path} está vacío.")
    headers = list(rows[0].keys())
    c_code = find_column(headers, col_code, ("cod",))
    c_name = find_column(headers, col_name, ("nombre", "descrip"))

    synonyms: dict[str, str] = {}
    if syn_path and syn_path.exists():
        for r in read_rows(syn_path):
            synonyms[norm_code(r["codigo"])] = r["sinonimos"].strip()

    seen: dict[str, list] = {}
    skipped = 0
    for r in rows:
        code = norm_code(r.get(c_code, ""))
        name = fix_case(r.get(c_name, ""))
        if not CODE_RE.match(code) or not name:
            skipped += 1
            continue
        ch = chapter_index(code)
        if ch < 0:
            skipped += 1
            continue
        seen[code] = [code, name, ch, synonyms.get(code, "")]

    codes = sorted(seen.values(), key=lambda e: e[0])
    chapters = [
        {"n": roman, "r": f"{lo}–{hi}", "t": title, "p": plain}
        for lo, hi, roman, title, plain in CHAPTERS
    ]
    return {"v": date.today().isoformat(), "fuente": path.name,
            "chapters": chapters, "codes": codes}, skipped


def build_abbr(path: Path) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for r in read_rows(path):
        sig = r["sigla"].strip()
        if not sig:
            continue
        meaning = {"e": r["significado"].strip(), "d": r["explicacion"].strip()}
        if r.get("codigo", "").strip():
            meaning["c"] = norm_code(r["codigo"])
        grouped.setdefault(sig, []).append(meaning)
    return [{"a": k, "m": v} for k, v in sorted(grouped.items(), key=lambda kv: kv[0].lower())]


def main() -> None:
    ap = argparse.ArgumentParser(description="Genera docs/data/*.json para el sitio.")
    ap.add_argument("--cie10", type=Path, default=RAW / "cie10_muestra.csv")
    ap.add_argument("--sinonimos", type=Path, default=RAW / "sinonimos.csv")
    ap.add_argument("--abreviaturas", type=Path, default=RAW / "abreviaturas.csv")
    ap.add_argument("--col-codigo", default=None)
    ap.add_argument("--col-nombre", default=None)
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    db, skipped = build_cie10(args.cie10, args.sinonimos, args.col_codigo, args.col_nombre)
    abbr = build_abbr(args.abreviaturas)

    dump = dict(ensure_ascii=False, separators=(",", ":"))
    (args.out / "cie10.json").write_text(json.dumps(db, **dump), encoding="utf-8")
    (args.out / "abreviaturas.json").write_text(json.dumps(abbr, **dump), encoding="utf-8")

    n_syn = sum(1 for c in db["codes"] if c[3])
    size = (args.out / "cie10.json").stat().st_size / 1024
    print(f"✔ cie10.json        {len(db['codes']):>6} códigos  ({n_syn} con sinónimos, "
          f"{skipped} filas descartadas)  {size:.1f} KiB")
    print(f"✔ abreviaturas.json {len(abbr):>6} siglas")
    print(f"→ {args.out}")


if __name__ == "__main__":
    main()
