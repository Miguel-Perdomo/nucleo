/**
 * search.js — Motor de búsqueda local (sin dependencias).
 *
 * Idea: se construye un índice invertido token → [ids de códigos].
 * Para cada palabra de la consulta se puntúa cada token único del vocabulario
 * (exacto > prefijo > error de tipeo > subcadena) y luego se intersectan los
 * conjuntos (lógica AND). Con ~14 000 códigos responde en pocos milisegundos.
 */

const STOP = new Set(
  "de del la las el los y o u en con por para a al un una que se su sus e".split(" ")
);

/** Minúsculas y sin tildes: "Neumonía" → "neumonia". */
export const norm = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "j45.9" → "J459"; "I10X" se mantiene. */
export const normCode = (s) => s.toUpperCase().replace(/[\s.\-]/g, "");

/** "J459" → "J45.9", "I10X" → "I10", "U071" → "U07.1". */
export function displayCode(code) {
  const c = code.endsWith("X") && code.length === 4 ? code.slice(0, 3) : code;
  return c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3)}` : c;
}

const tokenize = (s) =>
  norm(s)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !STOP.has(t));

/** Distancia de Levenshtein acotada: devuelve k+1 si la supera (corte temprano). */
function lev(a, b, k) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > k) return k + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > k) return k + 1;
    prev = cur;
  }
  return prev[lb];
}

/** Puntaje de una palabra de la consulta (q) contra un token del vocabulario (t). */
function tokenScore(q, t) {
  if (q === t) return 10;
  if (q.length >= 2 && t.startsWith(q)) return 7 - Math.min(2, (t.length - q.length) / 4);
  if (q.length >= 4) {
    const k = q.length >= 7 ? 2 : 1;
    if (lev(q, t, k) <= k) return 4;
    if (t.length > q.length && lev(q, t.slice(0, q.length), k) <= k) return 3;
    if (t.includes(q)) return 2;
  }
  return 0;
}

export class Engine {
  /**
   * @param {{chapters: object[], codes: [string,string,number,string][]}} db
   * @param {{a: string, m: object[]}[]} abbr
   */
  constructor(db, abbr) {
    this.chapters = db.chapters;
    this.entries = db.codes.map(([code, title, ch, syn], id) => ({
      id, code, title, ch,
      syn: syn ? syn.split("|") : [],
      disp: displayCode(code),
      hay: norm(`${title} ${syn.replace(/\|/g, " ")}`),
    }));
    this.byCode = new Map(this.entries.map((e) => [e.code, e]));

    // Índice invertido
    this.index = new Map();
    for (const e of this.entries) {
      for (const t of new Set(tokenize(`${e.title} ${e.syn.join(" ")}`))) {
        if (!this.index.has(t)) this.index.set(t, []);
        this.index.get(t).push(e.id);
      }
    }
    this.vocab = [...this.index.keys()];

    // Abreviaturas: clave en minúsculas para buscar, se conserva la forma original
    this.abbr = new Map(abbr.map((x) => [x.a.toLowerCase(), x]));
  }

  /** Busca un código tolerando formatos: "I10", "I10X", "J45.9", "j459". */
  getCode(raw) {
    const c = normCode(raw);
    return this.byCode.get(c) || this.byCode.get(c + "X") || null;
  }

  chapter(e) {
    return this.chapters[e.ch];
  }

  /** Búsqueda principal. Devuelve {abbr, results}. */
  search(query, limit = 25) {
    const q = query.trim();
    if (!q) return { abbr: null, results: [] };

    const abbr = this.abbr.get(q.toLowerCase()) || null;
    const qc = normCode(q);

    // 1) ¿Parece un código? (letra + dígito…)
    if (/^[A-Z][0-9][0-9X]{0,3}$/.test(qc)) {
      const base = qc.length === 4 && qc.endsWith("X") ? qc.slice(0, 3) : qc;
      const hits = this.entries
        .filter((e) => e.code.startsWith(base))
        .map((e) => ({ e, s: e.code === qc || e.code === qc + "X" ? 1000 : 500 - e.code.length }));
      hits.sort((a, b) => b.s - a.s || a.e.code.localeCompare(b.e.code));
      if (hits.length) return { abbr, results: hits.slice(0, limit).map((h) => h.e) };
    }

    // 2) Texto libre
    let qTokens = tokenize(q);
    // Si la consulta es una sigla, añade también su significado
    if (abbr) qTokens = tokenize(abbr.m[0].e);
    if (!qTokens.length) return { abbr, results: [] };

    let acc = null; // Map id → puntaje acumulado
    for (const qt of qTokens) {
      const local = new Map();
      for (const t of this.vocab) {
        const s = tokenScore(qt, t);
        if (!s) continue;
        for (const id of this.index.get(t)) {
          if ((local.get(id) || 0) < s) local.set(id, s);
        }
      }
      if (acc === null) acc = local;
      else {
        const next = new Map();
        for (const [id, s] of local) if (acc.has(id)) next.set(id, acc.get(id) + s);
        acc = next;
      }
      if (!acc.size) break;
    }

    const phrase = norm(abbr ? abbr.m[0].e : q);
    const ranked = [...(acc || new Map())].map(([id, s]) => {
      const e = this.entries[id];
      if (e.hay.includes(phrase)) s += 6; // la frase completa aparece
      if (e.syn.some((x) => norm(x) === phrase)) s += 8; // coincide con un sinónimo
      return { e, s };
    });
    ranked.sort((a, b) => b.s - a.s || a.e.title.length - b.e.title.length);
    return { abbr, results: ranked.slice(0, limit).map((r) => r.e) };
  }

  /**
   * Analiza un fragmento de historia clínica: detecta códigos y siglas.
   * Devuelve {items, spans} donde spans sirve para resaltar el texto.
   */
  analyze(text) {
    const spans = [];
    const items = [];
    const seen = new Set();

    // Códigos CIE-10 (ej. I10X, J45.9, E119, U07.1)
    const codeRe = /\b([A-Z][0-9]{2})(?:\.?([0-9X][0-9]?))?\b/gi;
    for (const m of text.matchAll(codeRe)) {
      const raw = m[0];
      const e = this.getCode(raw);
      const hasSub = Boolean(m[2]);
      // Sin subdivisión y sin coincidencia, es probablemente otra cosa (ej. "B12")
      if (!e && !hasSub) continue;
      spans.push({ start: m.index, end: m.index + raw.length, kind: "code" });
      const key = "c:" + (e ? e.code : normCode(raw));
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "code", raw, entry: e, code: normCode(raw) });
    }

    // Siglas: las de ≤2 letras deben ir tal cual o en mayúsculas (evita "la", "ta"…)
    const wordRe = /[A-Za-zÁÉÍÓÚÑáéíóúñ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9\-]*/g;
    for (const m of text.matchAll(wordRe)) {
      const w = m[0];
      const a = this.abbr.get(w.toLowerCase());
      if (!a) continue;
      // Siglas cortas (≤3) deben escribirse como en el diccionario o en MAYÚSCULAS
      // para no confundirlas con palabras comunes ("sos", "ta", "ca"…)
      if (w.length <= 3 && w !== a.a && w !== a.a.toUpperCase()) continue;
      if (spans.some((s) => m.index < s.end && m.index + w.length > s.start)) continue;
      spans.push({ start: m.index, end: m.index + w.length, kind: "abbr" });
      const key = "a:" + a.a;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "abbr", raw: w, abbr: a });
    }

    spans.sort((x, y) => x.start - y.start);
    return { items, spans };
  }
}
