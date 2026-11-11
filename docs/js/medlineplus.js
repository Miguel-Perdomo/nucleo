/**
 * medlineplus.js — Cliente mínimo de MedlinePlus Connect (NLM, EE. UU.).
 *
 * Documentación: https://medlineplus.gov/medlineplus-connect/web-service/
 *  - Solo HTTPS, un código por consulta.
 *  - Límite: 100 consultas/minuto por IP → se cachean respuestas 24 h.
 *  - Se usa JSONP (documentado oficialmente) para no depender de CORS.
 *  - Condiciones: indicar que la información viene de MedlinePlus.gov,
 *    no usar su logo ni sugerir que respalda este sitio.
 */

const BASE = "https://connect.medlineplus.gov/service";
const ICD10CM = "2.16.840.1.113883.6.90";
const TTL = 24 * 3600 * 1000;
let seq = 0;

/** Código colombiano (CIE-10 OMS) → formato ICD-10-CM: "J459"→"J45.9", "I10X"→"I10". */
export function toICD10CM(code) {
  let c = code.toUpperCase().replace(/[\s.]/g, "");
  if (c.length === 4 && c.endsWith("X")) c = c.slice(0, 3);
  return c.length > 3 ? `${c.slice(0, 3)}.${c.slice(3)}` : c;
}

function jsonp(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const cb = `__mpc${Date.now().toString(36)}${seq++}`;
    const script = document.createElement("script");
    const done = () => {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    };
    const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, timeout);
    window[cb] = (data) => { done(); resolve(data); };
    script.onerror = () => { done(); reject(new Error("network")); };
    script.src = `${url}&callback=${cb}`;
    document.head.appendChild(script);
  });
}

// Los nodos del feed pueden venir como string o como {_value: "..."}
const txt = (v) => (v == null ? "" : typeof v === "string" ? v : v._value ?? v.value ?? "");

function parse(data) {
  let entries = data?.feed?.entry ?? [];
  if (!Array.isArray(entries)) entries = [entries];
  return entries
    .map((e) => {
      const links = Array.isArray(e.link) ? e.link : e.link ? [e.link] : [];
      return {
        title: txt(e.title),
        url: links.find((l) => l?.href)?.href ?? "",
        summary: txt(e.summary),
      };
    })
    .filter((e) => e.title && e.url.startsWith("https://"));
}

function cacheGet(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(key));
    if (hit && Date.now() - hit.t < TTL) return hit.d;
  } catch { /* almacenamiento no disponible */ }
  return null;
}
function cacheSet(key, d) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* ignorar */ }
}

async function query(icd) {
  const key = `mpc:es:${icd}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const params = new URLSearchParams({
    "mainSearchCriteria.v.cs": ICD10CM,
    "mainSearchCriteria.v.c": icd,
    "informationRecipient.languageCode.c": "es",
    knowledgeResponseType: "application/javascript",
  });
  const out = parse(await jsonp(`${BASE}?${params}`));
  cacheSet(key, out);
  return out;
}

/**
 * Busca explicaciones para un código. Si el código específico no tiene
 * resultados, intenta con la categoría de 3 caracteres (ej. J45.9 → J45).
 * @returns {Promise<{icd: string, entries: {title,url,summary}[]}>}
 */
export async function lookup(code) {
  const icd = toICD10CM(code);
  let entries = await query(icd);
  if (!entries.length && icd.length > 3) {
    const parent = icd.slice(0, 3);
    entries = await query(parent);
    return { icd: parent, entries };
  }
  return { icd, entries };
}

/** Enlace de búsqueda en MedlinePlus en español (respaldo si falla la API). */
export const searchUrl = (term) =>
  `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus-spanish&query=${encodeURIComponent(term)}`;

/** Limpia el HTML devuelto: solo etiquetas de texto y enlaces https. */
export function sanitize(html) {
  const ALLOWED = new Set(["P", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "BR", "A", "SPAN", "H3", "H4"]);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(el.tagName)) { el.remove(); continue; }
      walk(el); // primero los hijos (post-orden), luego se decide sobre el nodo
      if (!ALLOWED.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        const keep = el.tagName === "A" && attr.name === "href" && /^https:\/\//.test(attr.value);
        if (!keep && attr.name !== "class") el.removeAttribute(attr.name);
      }
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  const root = doc.body.firstElementChild;
  walk(root);
  return root.innerHTML;
}
