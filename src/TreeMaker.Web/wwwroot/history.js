// The closing history: every state the workbench layout went through on its way to valid polygons, oldest first.
// A layout from a solver (or a file) starts it; each stub added and each closing tried adds an entry. The page grows
// downward as entries are added, each with a small drawing of the sheet, what changed, what is still open, what to
// try next, and "Start over from here", which puts that state back on the workbench. The sidebar lists the same
// entries in short, as an overview.
//
// Entries are keyed by the layout's id (workbench.setLayout gives every layout one; a restored layout keeps its own).
// entry = { kind: "layout" | "closing", lid, title, layout, closure?, report, at }
"use strict";

const closingHistory = (() => {
  const KEY = "treemaker.history.v1";
  let entries = load();

  const q = (id) => document.getElementById(id);
  const svgEl = (name, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* kept in memory only */ }
  }
  const slim = (r) => r && {
    valid: r.valid, polygons: r.polygons, segments: r.segments, missingBoundary: r.missingBoundary,
    hullLeaves: r.hullLeaves, hullArea: r.hullArea, coveredArea: r.coveredArea, issues: r.issues,
  };
  const snapshot = (l) => ({ ...l });

  /** The polygon check of the workbench layout (as solved). Starts the history, or adds the layout to it. */
  function noteReport(report) {
    const l = workbench.layout;
    if (!l?.lid || !report) return;
    const known = entries.find((e) => e.kind === "layout" && e.lid === l.lid);
    if (known) {
      if (!known.report) { known.report = slim(report); save(); render(); }
      return;
    }
    if (!l.parentLid || !entries.some((e) => e.lid === l.parentLid)) entries = [];
    entries.push({ kind: "layout", lid: l.lid, title: l.historyTitle ?? layoutTitle(l), layout: snapshot(l), report: slim(report), at: new Date().toISOString() });
    save();
    render();
  }

  function layoutTitle(l) {
    if (l.node === "file") return `Opened ${l.note ?? "a layout file"}`;
    return `Solved by ${NODES[l.node]?.title ?? l.node}: m = ${fmt(l.scale, 4)}`;
  }

  /** A closing tried on the workbench layout: by the strain needed, or within bounds. */
  function noteClosing(result, bounds) {
    const l = workbench.layout;
    if (!l?.lid) return;
    const ok = !!result.after?.valid;
    const range = `±${fmt(bounds.strainMax, 3)}`;
    const title = bounds.note
      ? (ok ? `Found the strain needed and closed: ${range}` : `Searched for the strain needed: not closed within ${range}`)
      : (ok ? `Closed within ${range}` : `Tried closing within ${range}: still open`);
    entries.push({ kind: "closing", lid: l.lid, title, layout: snapshot(l), closure: { ...bounds, completion: result }, report: slim(result.after), at: new Date().toISOString() });
    save();
    render();
  }

  /** Puts entry k back on the workbench and drops the entries after it. */
  function startOver(k) {
    const e = entries[k];
    if (!e) return;
    entries = entries.slice(0, k + 1);
    save();
    workbench.setLayout({ ...e.layout });
    if (e.closure) workbench.setClosure(e.closure);
    if (typeof applyProblem === "function") applyProblem(e.layout.problem);
    const target = state.node?.id === "stubs" && !e.report?.valid ? "stubs" : "close";
    if (state.node?.id === target) enterNode(target); else location.hash = "#/" + target;
    setStatus(`Started over from step ${k + 1}: ${e.title}.`);
  }

  /** What is still open in a report, in a few words, and what to try next (as [text, href] pairs). */
  function outlook(e) {
    const r = e.report;
    if (!r) return { open: "Not checked yet.", next: [] };
    if (r.valid) return { open: "Every polygon is valid.", next: [["Build the crease pattern", "#/creases"]] };
    const bad = (r.polygons ?? []).filter((p) => !p.valid);
    const inside = bad.filter((p) => p.leavesInside?.length);
    const sides = r.missingBoundary?.length ?? 0;
    const parts = [];
    if (sides) parts.push(`${sides} hull side${sides === 1 ? "" : "s"} loose`);
    if (bad.length) parts.push(`${bad.length} polygon${bad.length === 1 ? "" : "s"} not valid`);
    if (r.hullArea > 0 && r.coveredArea < r.hullArea * (1 - 1e-6)) parts.push(`${Math.round((1 - r.coveredArea / r.hullArea) * 100)}% uncovered`);
    const next = [];
    if (e.kind === "closing") {
      next.push(["Add a stub in what is still open", "#/stubs"]);
      next.push(["Try wider bounds", "#/close"]);
    } else {
      if (inside.length) next.push([`Add a stub in ${inside[0].leaves.join("–")} (a leaf is inside it)`, "#/stubs"]);
      next.push(["Find the strain needed and close", "#/close"]);
      if (!inside.length && bad.length) next.push(["Add a stub", "#/stubs"]);
    }
    return { open: parts.join(", ") + ".", next };
  }

  /** A small drawing of the sheet: leaves, tight paths, valid and open polygons, loose hull sides. */
  function thumb(e) {
    const l = e.layout, r = e.report, N = l.gridSize, S = 150, P = 8, u = (S - 2 * P) / N;
    const pos = new Map(l.points.map((p) => [p.leaf, [P + p.x * u, S - P - p.y * u]]));
    const svg = svgEl("svg", { viewBox: `0 0 ${S} ${S}`, class: "hist-thumb", role: "img", "aria-label": "The sheet at this step" });
    svg.append(svgEl("rect", { x: P, y: P, width: S - 2 * P, height: S - 2 * P, class: "ht-sheet" }));
    const ring = (ls) => ls.map((x) => pos.get(x)).filter(Boolean).map((p) => p.join(",")).join(" ");
    for (const p of r?.polygons ?? []) svg.append(svgEl("polygon", { points: ring(p.leaves), class: p.valid ? "ht-ok" : "ht-bad" }));
    for (const s of r?.segments ?? []) {
      const a = pos.get(s.a), b = pos.get(s.b);
      if (a && b) svg.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "ht-path" }));
    }
    for (const s of r?.missingBoundary ?? []) {
      const a = pos.get(s.a), b = pos.get(s.b);
      if (a && b) svg.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "ht-missing" }));
    }
    const stubs = new Set(l.stubs ?? []);
    for (const [leaf, [x, y]] of pos) svg.append(svgEl("circle", { cx: x, cy: y, r: stubs.has(leaf) ? 3.6 : 3, class: stubs.has(leaf) ? "ht-stub" : "ht-leaf" }));
    return svg;
  }

  function render() {
    const show = ["close", "stubs", "creases"].includes(state.node?.id) && entries.length > 0;
    const card = q("historyCard"), side = q("historySide");
    card.hidden = !show;
    side.hidden = !show;
    if (!show) return;
    const current = entries.length - 1;

    const list = q("historyList");
    list.replaceChildren(...entries.map((e, k) => {
      const o = outlook(e);
      const item = document.createElement("li");
      item.className = "hist-step" + (k === current ? " current" : "") + (e.report?.valid ? " valid" : "");
      item.id = "hist-" + k;
      const text = document.createElement("div");
      text.className = "hist-text";
      const h = document.createElement("h3");
      h.innerHTML = `<span class="hist-no"></span> <span class="hist-title"></span>`;
      h.children[0].textContent = String(k + 1);
      h.children[1].textContent = e.title;
      const open = document.createElement("p");
      open.className = "hist-open " + (e.report?.valid ? "ok" : "no");
      open.textContent = o.open;
      text.append(h, open);
      if (k === current && o.next.length) {
        const next = document.createElement("div");
        next.className = "hist-next";
        next.append("Try next: ");
        o.next.forEach(([label, href], j) => {
          const a = document.createElement("a");
          a.href = href;
          a.textContent = label;
          if (j) next.append(" · ");
          next.append(a);
        });
        text.append(next);
      }
      if (k < current) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "quiet small";
        b.textContent = "Start over from here";
        b.title = `Put step ${k + 1} back on the workbench and drop the ${current - k} step${current - k === 1 ? "" : "s"} after it`;
        b.addEventListener("click", () => startOver(k));
        text.append(b);
      } else {
        const now = document.createElement("span");
        now.className = "hist-now";
        now.textContent = "On the workbench now";
        text.append(now);
      }
      item.append(thumb(e), text);
      return item;
    }));

    // The overview in the sidebar.
    q("historyOverview").replaceChildren(...entries.map((e, k) => {
      const li = document.createElement("li");
      li.className = (k === current ? "current " : "") + (e.report?.valid ? "valid" : "open");
      const a = document.createElement("a");
      a.href = "#hist-" + k;
      a.textContent = `${k + 1}. ${e.title}`;
      a.addEventListener("click", (ev) => { ev.preventDefault(); q("hist-" + k)?.scrollIntoView({ behavior: "smooth", block: "center" }); });
      li.append(a);
      return li;
    }));
  }

  return { noteReport, noteClosing, startOver, render, get entries() { return entries; } };
})();
