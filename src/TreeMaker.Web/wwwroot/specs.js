// The specs, packaged with the app, and the page that shows them.
//
// The seven specification documents are copied into wwwroot/specs/*.md by tools/extract_spec_exports.py (see
// CLAUDE.md, "Specification documents"). Reading them is kept apart from the working app: the docs open in their
// own browser tab (docs.html), and the app's tab stays on the map and the workbench.
//   - specLinks, used by the app: the map's Spec tags, the Spec link in the top bar, each node's header and every
//     `.ref` label in the sidebar open docs.html at the section or label they name, in the one docs tab.
//   - specReader, used by docs.html: renders a doc, gives every section and label an anchor, links labels within
//     and between docs, and links each part of a doc that the app implements back to that part, in the app's tab.
// The docs page is driven by its hash, `docs.html#/<doc>:<anchor>` (`#/` alone lists the specs), so Back works and
// a link to a passage can be shared. It needs no network: KaTeX is vendored in wwwroot/vendor/katex.
"use strict";

// ───────────────────────── Markdown to HTML (no DOM; also used by tools/check_spec_links.js) ─────────────────────────

const SpecText = (() => {
  /** A label as written in the docs ("A:2", "Lemma 3", "Section 5.1") → the anchor id used in the reader. */
  function anchorFor(kind, number) {
    if (kind === "Lemma") return `lemma-${number}`;
    if (kind === "Section") return `sec-${String(number).replace(/\./g, "-")}`;
    return `${kind}-${number}`;
  }

  /** How the docs name each other in running text: "base C:1", "closing D:4", "the scalable spec". */
  const PREFIX = { base: "pure", closing: "closing", scalable: "scalable", optimized: "optimized", crease: "crease" };

  /** Doc names as they appear in the app's own text ("Pure MILP C:5", "Lattice-Hull spec, Section 10"). */
  const NAMES = [
    [/Pure MILP|base (?:spec|model)/i, "pure"],
    [/Symmetry-Breaking/i, "sym"],
    [/Lattice-Hull/i, "hull"],
    [/Optimized/i, "optimized"],
    [/Scalable/i, "scalable"],
    [/Polygon Closing|closing spec/i, "closing"],
    [/Crease Pattern|crease spec/i, "crease"],
  ];

  /** Every reference in a piece of text: labels, lemmas and sections, with the doc they point into. */
  const REF = /(?:\b(base|closing|scalable|optimized|crease)\s+)?(?:\b([PDCMA]):(\d+)\b|\b(Lemma)\s+(\d+)\b|\b(Sections?)\s+(\d+(?:\.\d+)?)|§\s?(\d+(?:\.\d+)?))/g;

  function refsIn(text, doc) {
    const found = [];
    for (const m of text.matchAll(REF)) {
      // "its Section 3" and "Section 8 of [another doc]" name a section of a doc the text does not say: skip them.
      if (!m[1] && (/\bits\s+$/.test(text.slice(0, m.index)) || /^\s+of\s/.test(text.slice(m.index + m[0].length)))) continue;
      const target = m[1] ? PREFIX[m[1]] : doc;
      let at;
      if (m[2]) at = anchorFor(m[2], m[3]);
      else if (m[4]) at = anchorFor("Lemma", m[5]);
      else if (m[6]) at = anchorFor("Section", m[7]);
      else at = anchorFor("Section", m[8]);
      // Link the label itself, not the doc prefix in front of it.
      const start = m.index + (m[1] ? m[0].indexOf(m[0].slice(m[1].length).trimStart()) : 0);
      found.push({ index: start, end: m.index + m[0].length, doc: target, at });
    }
    return found;
  }

  /** The doc a piece of app text names, if any. */
  function docNamedIn(text) {
    for (const [rx, key] of NAMES) if (rx.test(text)) return key;
    return null;
  }

  const ESCAPABLE = /\\([\\`*_{}\[\]()#+\-.!|<>~])/g;
  const html = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /**
   * Inline Markdown: escapes, code, links, bold, italic, and `x\_sub` subscripts as the exports write them.
   * `docUrls` maps a doc's online URL to its key, so links between specs stay in the reader.
   */
  function inline(text, docUrls) {
    const held = [];
    const hold = (s) => `\u0000${held.push(s) - 1}\u0000`;
    let s = text
      .replace(/\\_(\{[^}]*\}|[A-Za-z0-9]+)/g, (_, sub) => hold(`<sub>${html(sub.replace(/^\{|\}$/g, ""))}</sub>`))
      .replace(ESCAPABLE, (_, c) => hold(html(c)));
    s = html(s);
    s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const raw = url.replace(/&amp;/g, "&");
      const key = docUrls[raw];
      return key
        ? hold(`<a class="doc-link" data-doc="${key}" href="${html(raw)}">${label}</a>`)
        : hold(`<a href="${html(raw)}" target="_blank" rel="noopener">${label} ↗</a>`);
    });
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, n) => held[n]);
  }

  /** The anchor a block defines when it starts with its label in bold: "**D:4 Inner polygon.**", "- **P:1** …". */
  function definedLabel(raw) {
    const m = raw.match(/^\*\*(?:([PDCMA]):(\d+)\b|Lemma (\d+)\b)/);
    if (!m) return null;
    return m[1] ? anchorFor(m[1], m[2]) : anchorFor("Lemma", m[3]);
  }

  /**
   * Parses one exported doc. Returns its HTML, the anchors it defines, its contents (sections), its title and
   * a one-paragraph summary. Anchors are prefixed in the DOM (`spec-…`) so they never clash with the app's ids.
   */
  function parse(md, docUrls = {}) {
    const lines = md.replace(/\r/g, "").split("\n");
    const out = [];
    const ids = new Set();
    const toc = [];
    let title = "", summary = "", byline = "";
    let figures = 0;
    const claim = (id) => (id && !ids.has(id) ? (ids.add(id), id) : null);
    const idAttr = (id) => (id ? ` id="spec-${id}"` : "");
    const isBlockStart = (l) => /^```|^#{1,4}\s|^\||^\s*(?:[-*]|\d+\.)\s|^&#91;embedded content:/.test(l);

    // Gives the first <strong> of a block the anchor of the label it defines.
    const markDef = (h, id) => (id ? h.replace("<strong>", `<strong class="def"${idAttr(id)}>`) : h);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;

      // Fenced blocks: ```math (and ```latex, as the docs export it) becomes display maths; anything else stays preformatted.
      if ((m = line.match(/^```(\w*)\s*$/))) {
        const body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        const src = body.join("\n");
        out.push(m[1] === "math" || m[1] === "latex"
          ? `<div class="math" data-tex="${html(src)}"><pre class="tex">${html(src)}</pre></div>`
          : `<pre class="code">${html(src)}</pre>`);
        continue;
      }

      // Headings: "## 4. Stage 1 …" anchors Section 4; "### 5.1 …" anchors Section 5.1; a label in the heading too.
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        const level = m[1].length;
        const text = m[2].trim();
        i++;
        if (level === 1) {
          title = text.replace(/:.*$/, "");
          out.push(`<h1>${inline(text, docUrls)}</h1>`);
          continue;
        }
        const num = text.match(/^(\d+(?:\.\d+)*)\.?\s/);
        const label = text.match(/(?:^|\s)([PDCMA]):(\d+)\s/);
        const secId = num ? claim(anchorFor("Section", num[1])) : null;
        const labelId = label ? claim(anchorFor(label[1], label[2])) : null;
        const id = secId ?? labelId ?? claim(`h-${out.length}`);
        const extra = secId && labelId ? `<span class="anchor"${idAttr(labelId)}></span>` : "";
        if (level <= 3) toc.push({ level, id, text: text.replace(/\\(.)/g, "$1").replace(/\*\*/g, "") });
        out.push(`<h${level}${idAttr(id)}>${extra}${inline(text, docUrls)}</h${level}>`);
        continue;
      }

      // Pipe tables: the first row is the header; a row whose first cell is a label anchors that label.
      if (/^\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.replace(/^\||\|\s*$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(rows[1] && /^\|\s*:?-+/.test(rows[1]) ? 2 : 1);
        const tr = body.map((r) => {
          const c = cells(r);
          const lm = c[0]?.match(/^([PDCMA]):(\d+)$/);
          const id = lm ? claim(anchorFor(lm[1], lm[2])) : null;
          return `<tr${idAttr(id)}>${c.map((x) => `<td>${inline(x, docUrls)}</td>`).join("")}</tr>`;
        });
        out.push(`<div class="table-scroll"><table class="spec-table"><thead><tr>${head.map((h) => `<th>${inline(h, docUrls)}</th>`).join("")}</tr></thead><tbody>${tr.join("")}</tbody></table></div>`);
        continue;
      }

      // Lists, nested by indentation.
      if (/^\s*(?:[-*]|\d+\.)\s/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s/.test(lines[i])) {
          const lm = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
          items.push({ indent: lm[1].length, ordered: /\d/.test(lm[2]), start: parseInt(lm[2], 10), text: lm[3] });
          i++;
        }
        const stack = [];
        let h = "";
        for (const it of items) {
          while (stack.length && it.indent < stack[stack.length - 1].indent) {
            h += `</li></${stack.pop().tag}>`;
          }
          const top = stack[stack.length - 1];
          if (!top || it.indent > top.indent) {
            const tag = it.ordered ? "ol" : "ul";
            const start = it.ordered && it.start !== 1 ? ` start="${it.start}"` : "";
            h += `<${tag}${start}>`;
            stack.push({ indent: it.indent, tag });
          } else {
            h += "</li>";
          }
          h += `<li>${markDef(inline(it.text, docUrls), claim(definedLabel(it.text)))}`;
        }
        while (stack.length) h += `</li></${stack.pop().tag}>`;
        out.push(h);
        continue;
      }

      // An interactive figure of the live doc that Markdown cannot carry.
      if ((m = line.match(/^&#91;embedded content:\s*(.*?)\\?\]\s*$/))) {
        i++;
        out.push(`<figure class="spec-fig" data-fig="${figures++}"><figcaption>${inline(m[1], docUrls)}</figcaption><span class="fig-missing">Figure not packaged; re-run tools/extract_spec_exports.py.</span></figure>`);
        continue;
      }

      // A paragraph: lines up to the next blank line or block.
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
      const raw = para.join(" ");
      if (!byline && !summary && /^[A-Z][a-z]{2} \d{1,2}, \d{4} ·/.test(raw)) {
        byline = raw.replace(/\\(.)/g, "$1");
        out.push(`<p class="byline">${inline(raw, docUrls)}</p>`);
        continue;
      }
      if (!summary && !raw.startsWith("**")) {
        summary = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\\(.)/g, "$1").replace(/\*+/g, "");
      }
      out.push(`<p>${markDef(inline(raw, docUrls), claim(definedLabel(raw)))}</p>`);
    }
    return { html: out.join("\n"), ids, toc, title, summary, byline };
  }

  return { anchorFor, refsIn, docNamedIn, inline, parse };
})();

if (typeof module !== "undefined") module.exports = SpecText;

// ───────────────────────── Links from the app to the docs tab ─────────────────────────

/** The browser tabs the app and the docs open in, so each link reuses the one tab instead of opening more. */
const SPEC_TAB = "treemaker-specs";
const APP_TAB = "treemaker-app";

const specLinks = typeof document === "undefined" ? null : (() => {
  /** The docs page at a doc and anchor; with no doc, the list of specs. */
  function href(doc, at) {
    return `docs.html#/${doc ?? ""}${at ? ":" + at : ""}`;
  }

  /** Opens a doc in the docs tab (and brings that tab forward). */
  function open(doc, at) {
    const w = window.open(href(doc, at), SPEC_TAB);
    w?.focus();
  }

  function link(text, doc, at, cls) {
    const a = document.createElement("a");
    a.href = href(doc, at);
    a.target = SPEC_TAB;
    if (cls) a.className = cls;
    a.textContent = text;
    return a;
  }

  /** Text with every reference turned into a link to the docs tab (for a node's header line). */
  function linkify(text, doc) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const r of SpecText.refsIn(text, doc)) {
      if (!DOCS[r.doc]) continue;
      frag.append(text.slice(last, r.index), link(text.slice(r.index, r.end), r.doc, r.at, "xref"));
      last = r.end;
    }
    frag.append(text.slice(last));
    return frag;
  }

  /** The first place a piece of text points to in a doc: its first label or section, or the top. */
  function firstTarget(text, doc) {
    const r = SpecText.refsIn(text ?? "", doc)[0];
    return r ? { doc: r.doc, at: r.at } : { doc, at: null };
  }

  /** Where a `.ref` in the sidebar points: its own data-doc, a doc it names, or the open node's doc. */
  function refTarget(span) {
    const node = typeof state !== "undefined" ? state.node : null;
    const text = span.textContent;
    const doc = (node?.id === "hull" && span.dataset.hull ? "hull" : span.dataset.doc)
      ?? SpecText.docNamedIn(text) ?? node?.doc;
    return doc ? firstTarget(text, doc) : null;
  }

  // In the app, a click on a section or label in the sidebar opens it in the docs tab.
  if (document.body.dataset.page !== "docs") {
    document.addEventListener("click", (e) => {
      const ref = e.target.closest(".ref");
      if (!ref) return;
      const t = refTarget(ref);
      if (t) { e.preventDefault(); open(t.doc, t.at); }
    });
  }

  return { href, open, link, linkify, firstTarget, refTarget };
})();

// ───────────────────────── The docs page (docs.html) ─────────────────────────

const specReader = typeof document === "undefined" || document.body.dataset.page !== "docs" ? null : (() => {
  const docs = {};           // key → { ...parse(), md }
  let manifest = null;
  let loading = null;
  let katex = "none";        // none | loading | ready | failed
  let shown = null;          // { doc, at } currently in the pane, or { doc: "" } for the list
  const urlToKey = Object.fromEntries(Object.entries(DOCS).map(([k, d]) => [d.url, k]));

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };

  // ───── Loading ─────

  function loadAll() {
    loading ??= (async () => {
      const r = await fetch("specs/manifest.json", { cache: "no-cache" });
      manifest = await r.json();
      const v = encodeURIComponent(manifest.packagedAt ?? "");
      await Promise.all(Object.keys(DOCS).map(async (key) => {
        const entry = manifest.specs?.[key];
        if (!entry) return;
        const [md, figs] = await Promise.all([
          fetch(`specs/${entry.file}?v=${v}`).then((r) => r.text()),
          entry.figures ? fetch(`specs/${entry.figures}?v=${v}`).then((r) => r.json()).catch(() => null) : null,
        ]);
        docs[key] = { ...SpecText.parse(md, urlToKey), md, figures: figs?.figures ?? [] };
      }));
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  function loadKatex() {
    if (katex !== "none") return;
    katex = "loading";
    document.head.append(el("link", { rel: "stylesheet", href: "vendor/katex/katex.min.css" }));
    const s = el("script", { src: "vendor/katex/katex.min.js" });
    s.onload = () => { katex = "ready"; typeset($("readerBody")); };
    s.onerror = () => { katex = "failed"; };
    document.head.append(s);
  }

  /** Display maths: KaTeX when it has loaded; until then (or without it) the TeX source in monospace. */
  function typeset(root) {
    if (katex !== "ready" || !root) return;
    for (const m of root.querySelectorAll(".math:not(.done)")) {
      try {
        window.katex.render(m.dataset.tex, m, { displayMode: true, throwOnError: false, strict: "ignore", trust: false });
        m.classList.add("done");
      } catch { /* keep the TeX source */ }
    }
  }

  // ───── Links ─────

  const href = (doc, at) => `#/${doc ?? ""}${at ? ":" + at : ""}`;
  /** A part of the app, opened in the app's tab. */
  const appHref = (node) => `./#/${node}`;

  // ───── Rendering ─────

  /** The parts of the app that implement a doc, and the anchors each cites (from its `section`). */
  function implementers(key) {
    return Object.values(NODES).filter((n) => n.doc === key && n.kind !== "tree");
  }

  function renderList() {
    const body = $("readerBody");
    const wrap = el("div", { class: "spec-list" });
    wrap.append(
      el("h1", { text: "The specifications" }),
      el("p", { class: "lede", text: "Every part of this app implements one of these documents: the models, the algorithms and why they are exact. All of them are served by the app itself, so they read offline." }),
    );
    const groups = [["Layout solvers", SOLVER_IDS.map((id) => NODES[id].doc)], ["After a layout", ["closing", "crease"]]];
    for (const [name, keys] of groups) {
      wrap.append(el("h2", { text: name }));
      const list = el("div", { class: "spec-cards" });
      for (const key of keys) {
        const d = docs[key];
        const meta = manifest?.specs?.[key];
        const card = el("article", { class: "spec-card" });
        card.append(
          el("a", { class: "spec-card-title", href: href(key), text: DOCS[key].title }),
          el("p", { text: trimTo(d?.summary ?? "", 260) }),
        );
        const row = el("div", { class: "spec-card-row" });
        row.append(el("span", { class: "muted", text: meta ? `Revision ${meta.rev ?? "?"}` : "Not packaged" }));
        for (const n of implementers(key)) row.append(el("a", { class: "app-chip", href: appHref(n.id), target: APP_TAB, text: `Run it: ${n.title} →` }));
        card.append(row);
        list.append(card);
      }
      wrap.append(list);
    }
    if (manifest?.packagedAt) wrap.append(el("p", { class: "muted small", text: `Packaged ${fmtDate(manifest.packagedAt)}.` }));
    body.replaceChildren(wrap);
    $("readerTitle").textContent = "Specifications";
    $("readerMeta").textContent = `${Object.keys(docs).length} documents, packaged with the app`;
    $("readerToc").hidden = true;
    $("readerList").hidden = true;
    renderNav(null);
    body.scrollTop = 0;
  }

  function renderDoc(key) {
    const d = docs[key];
    const body = $("readerBody");
    const meta = manifest?.specs?.[key];
    const article = el("article", { class: "spec-doc", "data-doc": key });
    article.innerHTML = d.html;

    // Figures: the packaged drawing (compiled from the doc by tools/render_spec_figures.js), else a link to the doc.
    for (const fig of article.querySelectorAll("figure[data-fig]")) {
      const drawn = d.figures[Number(fig.dataset.fig)]?.html;
      if (!drawn) continue;
      const art = el("div", { class: "fig-art" });
      art.innerHTML = drawn;
      fig.querySelector(".fig-missing")?.remove();
      fig.prepend(art);
      fig.classList.add("drawn");
    }
    for (const a of article.querySelectorAll("a.doc-link")) a.href = href(a.dataset.doc);
    linkRefs(article, key);

    // Where the app implements this doc: one bar at the top, and a chip at each section or label a node cites.
    const nodes = implementers(key);
    if (nodes.length) {
      const bar = el("div", { class: "spec-impl" }, el("span", { text: "In the app:" }));
      // A part of the app opens in the app's tab; this tab stays on the doc.
      for (const n of nodes) bar.append(el("a", { class: "app-chip", href: appHref(n.id), target: APP_TAB, title: n.section, text: `${n.title} →` }));
      article.querySelector("h1")?.after(bar);
      for (const n of nodes) {
        for (const r of SpecText.refsIn(n.section ?? "", key)) {
          if (r.doc !== key) continue;
          const target = article.querySelector(`#spec-${CSS.escape(r.at)}`);
          if (!target || target.dataset.chipped?.split(" ").includes(n.id)) continue;
          target.dataset.chipped = `${target.dataset.chipped ?? ""} ${n.id}`.trim();
          const chip = el("a", { class: "app-chip inline", href: appHref(n.id), target: APP_TAB, title: `Implemented in ${n.title}`, text: `▸ ${n.title}` });
          (target.matches("strong, span.anchor") ? target.parentElement : target).append(" ", chip);
        }
      }
    }

    body.replaceChildren(article);
    $("readerTitle").textContent = DOCS[key].title;
    $("readerMeta").textContent = meta
      ? `Packaged copy · revision ${meta.rev ?? "?"} · exported ${fmtDate(meta.exportedAt)}`
      : "Packaged copy";
    $("readerList").hidden = false;
    renderNav(key);
    renderToc(d.toc, key);
    typeset(body);
  }

  /** Turns labels and sections in the text into links, when the doc they name defines them. */
  function linkRefs(root, key) {
    const skip = "a, h1, h2, h3, h4, .def, .math, code, pre, .fig-art";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) {
      const refs = SpecText.refsIn(t.data, key).filter((r) => docs[r.doc]?.ids.has(r.at));
      if (!refs.length) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const r of refs) {
        frag.append(t.data.slice(last, r.index));
        const label = t.data.slice(r.index, r.end);
        frag.append(el("a", { class: "xref" + (r.doc !== key ? " other" : ""), href: href(r.doc, r.at), title: r.doc !== key ? DOCS[r.doc].title : null, text: label }));
        last = r.end;
      }
      frag.append(t.data.slice(last));
      t.replaceWith(frag);
    }
  }

  /** The list of specs in the side bar, with the one shown marked. */
  function renderNav(current) {
    const nav = $("specNav");
    const list = el("ol");
    for (const key of Object.keys(DOCS)) {
      if (!docs[key]) continue;
      const a = el("a", { href: href(key), text: DOCS[key].title.replace(/ TreeMaker$/, "") });
      if (key === current) a.setAttribute("aria-current", "page");
      list.append(el("li", {}, a));
    }
    nav.querySelector("ol")?.remove();
    nav.append(list);
  }

  function renderToc(toc, key) {
    const nav = $("readerToc");
    const list = el("ol");
    for (const t of toc) {
      list.append(el("li", { class: `toc-${t.level}` }, el("a", { href: href(key, t.id), text: t.text })));
    }
    nav.querySelector("ol")?.remove();
    nav.append(list);
    nav.hidden = false;
  }

  function goTo(at) {
    const body = $("readerBody");
    body.querySelectorAll(".hit").forEach((e) => e.classList.remove("hit"));
    if (!at) { body.scrollTop = 0; return; }
    const target = body.querySelector(`#spec-${CSS.escape(at)}`);
    if (!target) { body.scrollTop = 0; return; }
    const block = target.matches("strong, span.anchor") ? target.closest("p, li, h2, h3, h4") ?? target : target;
    const top = block.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 16;
    body.scrollTo({ top: Math.max(0, top), behavior: shown?.scrolled ? "smooth" : "auto" });
    block.classList.add("hit");
  }

  // ───── Showing a doc (driven by the hash) ─────

  async function sync() {
    const [doc, at] = location.hash.replace(/^#\/?/, "").split(":");
    loadKatex();
    try {
      await loadAll();
    } catch {
      $("readerBody").replaceChildren(el("p", { class: "reader-error", text: "The packaged specs could not be loaded. Run tools/extract_spec_exports.py to package them (see the README)." }));
      return;
    }
    if (!doc || !docs[doc]) {
      if (shown?.doc !== "") renderList();
      shown = { doc: "" };
      document.title = "Specs · TreeMaker";
      return;
    }
    if (shown?.doc !== doc) { renderDoc(doc); shown = { doc }; }
    document.title = `${DOCS[doc].title} · TreeMaker specs`;
    goTo(at ? decodeURIComponent(at) : null);
    shown.scrolled = true;
  }

  // ───── Small helpers ─────

  function trimTo(s, n) { return s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n)) + " …"; }
  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ───── Wiring ─────

  window.name = SPEC_TAB;      // links from the app come back to this tab
  window.addEventListener("hashchange", sync);
  $("readerList").addEventListener("click", () => { location.hash = "#/"; });
  // A click on a link to the passage already shown: the hash does not change, so scroll to it again.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (a && a.getAttribute("href") === location.hash) { e.preventDefault(); goTo(a.getAttribute("href").split(":")[1]); }
  });
  sync();

  return { sync };
})();
