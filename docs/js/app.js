/**
 * app.js — Interfaz: buscador, analizador de texto, ficha y enrutador (#/…).
 */
import { Engine, displayCode, normCode } from "./search.js";
import { lookup, searchUrl, sanitize } from "./medlineplus.js";
import { explainTitle } from "./glossary.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
// Tono (hue) por capítulo: ángulo áureo para que capítulos vecinos se distingan
const hue = (i) => Math.round((205 + i * 137.508) % 360);

const ui = {
  q: $("#q"), txt: $("#txt"), txtView: $("#txt-view"),
  results: $("#results"), detail: $("#detail"), periodic: $("#periodic"),
  tabs: { buscar: $("#tab-buscar"), texto: $("#tab-texto") },
  panels: { buscar: $("#panel-buscar"), texto: $("#panel-texto") },
};

let engine;
let detailToken = 0;

/* ------------------------------------------------------------------ */
/* Plantillas                                                          */
/* ------------------------------------------------------------------ */
function tile(e, cls = "") {
  const ch = engine.chapters[e.ch];
  return `<div class="tile ${cls}" style="--h:${hue(e.ch)}" aria-hidden="true">
    <span class="tile-z">${ch.n}</span>
    <span class="tile-sym">${esc(e.disp)}</span>
    <span class="tile-sub">${esc(ch.p)}</span>
  </div>`;
}

function card(e) {
  const ch = engine.chapters[e.ch];
  const syn = e.syn.length ? ` · también: ${esc(e.syn.slice(0, 3).join(", "))}` : "";
  return `<li><a class="card" href="#/c/${e.code}">
    ${tile(e)}
    <div class="card-body">
      <p class="card-title">${esc(e.title)}</p>
      <p class="card-sub">${esc(ch.p)}${syn}</p>
    </div>
    <span class="card-go" aria-hidden="true">›</span>
  </a></li>`;
}

function abbrCard(a) {
  const meanings = a.m.map((m) => {
    const e = m.c ? engine.getCode(m.c) : null;
    const btn = e ? `<a class="link-btn" href="#/c/${e.code}">Ver ${esc(e.disp)} →</a>` : "";
    return `<div class="meaning"><b>${esc(m.e)}</b><p>${esc(m.d)}</p>${btn}</div>`;
  }).join("");
  const note = a.m.length > 1 ? `<p class="hint">Esta sigla tiene varios significados; el correcto depende del contexto de tu historia.</p>` : "";
  return `<div class="abbr-card"><h3><span class="abbr">${esc(a.a)}</span> es una sigla</h3>${meanings}${note}</div>`;
}

function empty(msg) {
  return `<div class="empty">${msg}</div>`;
}

/* ------------------------------------------------------------------ */
/* Vistas                                                              */
/* ------------------------------------------------------------------ */
function showResults(html) {
  ui.detail.hidden = true;
  ui.results.hidden = false;
  ui.results.innerHTML = html;
}

function runSearch(q) {
  if (!q.trim()) { showResults(""); return; }
  const t0 = performance.now();
  const { abbr, results } = engine.search(q);
  const ms = (performance.now() - t0).toFixed(1);
  let html = abbr ? abbrCard(abbr) : "";
  if (results.length) {
    html += `<div class="results-head"><h2>Resultados para «${esc(q)}»</h2>
      <span class="count">n = ${results.length} · ${ms} ms</span></div>
      <ul class="list">${results.map(card).join("")}</ul>`;
  } else if (!abbr) {
    const code = normCode(q);
    const looksCode = /^[A-Z][0-9]{2}[0-9X]{0,2}$/.test(code);
    html += empty(
      `<p><strong>No encontramos «${esc(q)}»</strong> en la base.</p>` +
      (looksCode
        ? `<p><a class="link-btn" href="#/c/${code}">Consultar ${esc(displayCode(code))} en MedlinePlus →</a></p>`
        : `<p>Revisa la ortografía, prueba con menos palabras o con el código de tu historia.</p>`)
    );
  }
  showResults(html);
}

function runChapter(i) {
  const ch = engine.chapters[i];
  if (!ch) return;
  const list = engine.entries.filter((e) => e.ch === i);
  showResults(`<div class="results-head"><h2>Capítulo ${ch.n}: ${esc(ch.p)}</h2>
    <span class="count">${ch.r} · n = ${list.length}</span></div>
    <p class="card-sub" style="margin:-6px 0 12px">${esc(ch.t)}</p>
    ${list.length ? `<ul class="list">${list.map(card).join("")}</ul>` : empty("No hay códigos de este capítulo en la base actual.")}`);
}

function runAnalyze(text) {
  if (!text.trim()) { ui.txtView.hidden = true; showResults(""); return; }
  const { items, spans } = engine.analyze(text);

  // Texto con resaltado
  let out = "", pos = 0;
  for (const s of spans) {
    out += esc(text.slice(pos, s.start)) + `<mark class="${s.kind}">${esc(text.slice(s.start, s.end))}</mark>`;
    pos = s.end;
  }
  ui.txtView.innerHTML = out + esc(text.slice(pos));
  ui.txtView.hidden = false;

  if (!items.length) {
    showResults(empty("<p><strong>No detectamos códigos ni siglas conocidas.</strong></p><p>Prueba buscando palabras sueltas en la pestaña «Buscar».</p>"));
    return;
  }
  const codes = items.filter((x) => x.kind === "code");
  const abbrs = items.filter((x) => x.kind === "abbr");
  let html = `<div class="results-head"><h2>Encontramos ${items.length} término${items.length > 1 ? "s" : ""}</h2>
    <span class="count">${codes.length} códigos · ${abbrs.length} siglas</span></div>`;
  if (codes.length) {
    html += `<ul class="list">${codes.map((x) => x.entry ? card(x.entry) :
      `<li><a class="card" href="#/c/${x.code}">
        <div class="tile" style="--h:0" aria-hidden="true"><span class="tile-sym">${esc(displayCode(x.code))}</span></div>
        <div class="card-body"><p class="card-title">Código ${esc(displayCode(x.code))}</p>
        <p class="card-sub">No está en la base actual · toca para consultar MedlinePlus</p></div>
        <span class="card-go" aria-hidden="true">›</span></a></li>`).join("")}</ul>`;
  }
  if (abbrs.length) html += `<div style="margin-top:14px">${abbrs.map((x) => abbrCard(x.abbr)).join("")}</div>`;
  showResults(html);
}

async function showDetail(rawCode) {
  const token = ++detailToken;
  const code = normCode(rawCode);
  const e = engine.getCode(code);
  const disp = e ? e.disp : displayCode(code);
  const ch = e ? engine.chapters[e.ch] : null;
  const terms = e ? explainTitle(e.title) : [];
  const backHref = ui.q.value ? `#/buscar/${encodeURIComponent(ui.q.value)}` : "#/";

  ui.results.hidden = true;
  ui.detail.hidden = false;
  ui.detail.innerHTML = `
    <a class="back" href="${backHref}">← Volver</a>
    <div class="detail-head">
      ${e ? tile(e, "lg") : `<div class="tile lg" style="--h:0"><span class="tile-sym">${esc(disp)}</span></div>`}
      <div>
        <h2>${esc(e ? e.title : `Código ${disp}`)}</h2>
        <div class="badges">
          <span class="badge mono">CIE-10 ${esc(disp)}</span>
          ${e && e.code !== disp.replace(".", "") ? `<span class="badge mono">en la historia: ${esc(e.code)}</span>` : ""}
          ${ch ? `<span class="badge">Capítulo ${ch.n} · ${esc(ch.p)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="grid">
      <div>
        <article class="box" id="mp">
          <h3><span class="ic">✦</span> En palabras sencillas</h3>
          <div class="loading"><span class="atom-spin"><i></i></span> Consultando MedlinePlus…</div>
        </article>
      </div>
      <aside>
        ${terms.length ? `<section class="box"><h3><span class="ic">⚛</span> Descomponiendo el nombre</h3>
          <dl class="terms">${terms.map((t) => `<dt>${esc(t.term)}</dt><dd>${esc(t.text)}</dd>`).join("")}</dl></section>` : ""}
        ${e && e.syn.length ? `<section class="box"><h3><span class="ic">≈</span> También se le dice</h3>
          <div class="syn">${e.syn.map((s) => `<span>${esc(s)}</span>`).join("")}</div></section>` : ""}
        ${ch ? `<section class="box"><h3><span class="ic">${ch.n}</span> Capítulo</h3>
          <p style="margin:0">${esc(ch.t)} <span class="mono" style="color:var(--muted)">(${ch.r})</span></p></section>` : ""}
        <section class="box"><h3><span class="ic">?</span> Para llevar a tu cita</h3>
          <ul class="qs">
            <li>¿Qué significa este diagnóstico en mi caso?</li>
            <li>¿Necesito exámenes, tratamiento o controles?</li>
            <li>¿Qué señales deben hacerme consultar por urgencias?</li>
            <li>¿Cómo afecta mi vida diaria, trabajo o alimentación?</li>
          </ul>
        </section>
      </aside>
    </div>`;
  window.scrollTo({ top: ui.detail.offsetTop - 80, behavior: "smooth" });

  // MedlinePlus (asíncrono)
  const box = $("#mp");
  const term = e ? (e.syn[0] || e.title) : disp;
  const fallback = `<a class="link-btn" href="${searchUrl(term)}" target="_blank" rel="noopener">Buscar «${esc(term)}» en MedlinePlus →</a>`;
  try {
    const { icd, entries } = await lookup(code);
    if (token !== detailToken) return; // el usuario ya navegó a otra ficha
    if (!entries.length) {
      box.innerHTML = `<h3><span class="ic">✦</span> En palabras sencillas</h3>
        <p>MedlinePlus no tiene una página asociada al código <span class="mono">${esc(icd)}</span>.</p>${fallback}`;
      return;
    }
    box.innerHTML = `<h3><span class="ic">✦</span> En palabras sencillas</h3>` +
      entries.slice(0, 2).map((x) => `<div class="mp-more">
        <p class="mp-title">${esc(x.title)}</p>
        <div class="mp-summary">${x.summary ? sanitize(x.summary) : ""}</div>
        <a class="link-btn" href="${esc(x.url)}" target="_blank" rel="noopener">Leer completo en MedlinePlus →</a>
      </div>`).join("") +
      `<div class="mp-src"><span>Fuente: MedlinePlus.gov, Biblioteca Nacional de Medicina de EE. UU.</span>
        <span class="mono">ICD-10-CM ${esc(icd)}</span></div>
      <p class="caveat">MedlinePlus usa la versión estadounidense del código (ICD-10-CM). Verifica que el tema coincida con tu diagnóstico y resuelve dudas con tu médico.</p>`;
  } catch {
    if (token !== detailToken) return;
    box.innerHTML = `<h3><span class="ic">✦</span> En palabras sencillas</h3>
      <p>No pudimos conectar con MedlinePlus (¿sin internet o bloqueado por el navegador?).</p>${fallback}`;
  }
}

/* ------------------------------------------------------------------ */
/* Pestañas y enrutador                                                */
/* ------------------------------------------------------------------ */
function setTab(name) {
  for (const k of Object.keys(ui.tabs)) {
    ui.tabs[k].setAttribute("aria-selected", String(k === name));
    ui.panels[k].hidden = k !== name;
  }
}

function route() {
  const h = decodeURIComponent(location.hash);
  if (h && !h.startsWith("#/")) return; // anclas normales (#como, #capitulos)
  const [, view, ...rest] = h.split("/");
  const arg = rest.join("/");
  if (view === "c" && arg) { showDetail(arg); return; }
  if (view === "cap") { setTab("buscar"); runChapter(Number(arg)); return; }
  if (view === "texto") { setTab("texto"); ui.txt.focus(); runAnalyze(ui.txt.value); return; }
  setTab("buscar");
  if (view === "buscar") ui.q.value = arg;
  runSearch(ui.q.value);
}

function bind() {
  const onQuery = debounce(() => {
    const q = ui.q.value;
    history.replaceState(null, "", q ? `#/buscar/${encodeURIComponent(q)}` : "#/");
    runSearch(q);
  }, 70);
  ui.q.addEventListener("input", onQuery);
  ui.q.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = ui.results.querySelector("a.card");
      if (first) location.hash = first.getAttribute("href");
    }
  });
  ui.txt.addEventListener("input", debounce(() => runAnalyze(ui.txt.value), 120));

  ui.tabs.buscar.addEventListener("click", () => { location.hash = ui.q.value ? `#/buscar/${encodeURIComponent(ui.q.value)}` : "#/"; ui.q.focus(); });
  ui.tabs.texto.addEventListener("click", () => { location.hash = "#/texto"; });

  document.querySelectorAll(".chip[data-q]").forEach((b) =>
    b.addEventListener("click", () => { ui.q.value = b.dataset.q; location.hash = `#/buscar/${encodeURIComponent(b.dataset.q)}`; })
  );

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "/" && document.activeElement !== ui.q && document.activeElement !== ui.txt) {
      ev.preventDefault();
      setTab("buscar");
      ui.q.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  window.addEventListener("hashchange", route);
}

function renderPeriodic() {
  ui.periodic.innerHTML = engine.chapters.map((c, i) => {
    const sym = c.r.split("–")[0][0] + (c.r.split("–")[1][0] !== c.r[0] ? "–" + c.r.split("–")[1][0] : "");
    return `<a class="ptile" href="#/cap/${i}" style="--h:${hue(i)};text-decoration:none" title="${esc(c.t)}">
      <span class="z">${c.n}<span style="float:right">${c.r}</span></span><span class="sym">${sym}</span><span class="nm">${esc(c.p)}</span></a>`;
  }).join("");
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */
async function init() {
  try {
    const [db, abbr] = await Promise.all([
      fetch("data/cie10.json").then((r) => r.json()),
      fetch("data/abreviaturas.json").then((r) => r.json()),
    ]);
    engine = new Engine(db, abbr);
    const demo = /muestra/i.test(db.fuente) ? " · base de demostración" : "";
    $("#db-meta").textContent = `${db.codes.length.toLocaleString("es-CO")} códigos · ${abbr.length} siglas · act. ${db.v}${demo}`;
  } catch (err) {
    ui.results.innerHTML = empty("<p><strong>No se pudo cargar la base de datos.</strong></p><p>Si abriste el archivo directamente, sirve la carpeta con <code>python3 -m http.server</code>.</p>");
    console.error(err);
    return;
  }
  renderPeriodic();
  bind();
  route();
}

init();
