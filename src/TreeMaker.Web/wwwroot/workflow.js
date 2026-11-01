// The workflow document: the steps after a tree, as one page that grows with every step. Solving, closing the
// polygons by strain, adding stubs and building the crease pattern are all moves on one state, toward polygons that
// are all valid and a crease pattern built in them. Each step shows its input and its output as tree widgets (the
// tree beside the sheet), what changed, and what is still open; at the end of the page, "Add a step" holds the live
// widget (the current state, interactive) and the moves. Steps are only added; "Continue from here" drops the steps
// after one, and "Redo from here" drops it and the ones after, so you can take another path from any point.
//
// A state is { problem, layout, closure, creases, report, stubs }:
//   problem   the tree: edges, gridSize, leafConditions, mirrorPairs
//   layout    { node, points: [{ leaf, x, y }], scale, edgeLengths, status } or null before a solve
//   closure   { strainMin, strainMax, completion } after closing, or null
//   creases   { result, lengths, pleatHeight } after building the crease pattern, or null
//   report    the polygon check of the state's lengths (closed lengths when there is a closure)
//   stubs     names of the leaves added as stubs
// The last step's output is what the workbench holds. The document is saved in this browser, and Save the session
// writes it whole, every step with its input and output (schemas/treemaker-session.schema.json).
"use strict";

const workflowDoc = (() => {
  const KEY = "treemaker.session.v1";
  const doc = load() ?? { name: "", steps: [] };
  let running = null;   // { kind, title, params, input, started, ticker, cancel }
  let syncing = false;  // true while the document writes the workbench, so its listener knows the change is ours
  let move = "solve";   // the move open in "Add a step"
  let note = "";        // the last message for the move panel

  const q = (id) => document.getElementById(id);
  const svgEl = (name, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch {
      // Too big for this browser's storage: keep the crease patterns only in memory.
      try { localStorage.setItem(KEY, JSON.stringify({ ...doc, steps: doc.steps.map(stripCreases) })); } catch { /* memory only */ }
    }
  }
  const stripCreases = (s) => ({ ...s, input: { ...s.input, creases: null }, output: { ...s.output, creases: null } });
  const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
  const slim = (r) => r && {
    valid: r.valid, polygons: r.polygons, segments: r.segments, missingBoundary: r.missingBoundary, tightPairs: r.tightPairs,
    hullLeaves: r.hullLeaves, hullArea: r.hullArea, coveredArea: r.coveredArea, issues: r.issues,
  };

  // ───── States ─────

  const current = () => doc.steps.at(-1)?.output ?? null;

  /** The edge lengths a state's polygons and creases use: the closed ones after closing, else the layout's. */
  function lengthsOf(s) {
    const c = s.closure?.completion;
    if (c?.after && c.edgeLengths?.length) return c.edgeLengths.map((e) => e.newLength);
    return s.layout?.edgeLengths ?? s.problem.edges.map((e) => Number(e.length));
  }

  function base(s, lengths = s.layout.edgeLengths ?? null) {
    return { problem: s.problem, layout: s.layout.points.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })), scale: s.layout.scale, edgeLengths: lengths };
  }

  async function check(s) {
    return slim(await postJson("/api/polygons", base(s, s.layout.edgeLengths ?? null)));
  }

  /** The state the workbench holds now, for a document that starts from it. */
  function fromWorkbench() {
    const l = workbench.layout;
    if (!l) return null;
    return {
      problem: clone(l.problem),
      layout: { node: l.node, points: clone(l.points), scale: l.scale, edgeLengths: l.edgeLengths ?? null, status: l.status ?? "" },
      closure: workbench.closure ? clone(workbench.closure) : null,
      creases: workbench.creases ? clone(workbench.creases) : null,
      report: null, stubs: [...(l.stubs ?? [])],
    };
  }

  /** Puts a state on the workbench (and its tree into the editor). */
  function commit(s) {
    syncing = true;
    try {
      if (JSON.stringify(buildProblem().edges.map((e) => [e.from, e.to, e.length])) !== JSON.stringify(s.problem.edges.map((e) => [e.from, e.to, Number(e.length)]))
        || buildProblem().gridSize !== s.problem.gridSize) applyProblem(s.problem);
      if (!s.layout) { workbench.setLayout(null); return; }
      workbench.setLayout({
        node: s.layout.node, problem: s.problem, gridSize: s.problem.gridSize, points: s.layout.points, scale: s.layout.scale,
        edgeLengths: s.layout.edgeLengths ?? null, status: s.layout.status, stubs: s.stubs,
        polygonsValid: s.closure ? undefined : s.report?.valid,
      });
      if (s.closure) workbench.setClosure(s.closure);
      if (s.creases) workbench.setCreases(s.creases);
    } finally {
      syncing = false;
    }
  }

  // ───── The document ─────

  function addStep(step) {
    doc.steps.push({ ...step, at: new Date().toISOString() });
    save();
    commit(step.output);
    refresh(doc.steps.length - 1);
  }

  /** A layout that came from outside the document (a solver page, a layout file): it starts a new document. */
  async function startFrom(state, title) {
    doc.steps = [];
    doc.name = "";
    const step = { kind: "solve", title, params: {}, input: { problem: state.problem, layout: null, closure: null, creases: null, report: null, stubs: [] }, output: state, notes: [] };
    doc.steps.push({ ...step, at: new Date().toISOString() });
    save();
    try { state.report = await check(state); save(); } catch { /* shown as unchecked */ }
    if (onDocPage()) refresh(0);
  }

  /** Called by the workbench listener: a new layout not written by the document starts a new one. */
  function workbenchChanged(slot) {
    if (syncing || slot !== "layout") return;
    const s = fromWorkbench();
    if (!s) return;
    const l = workbench.layout;
    const from = l.node === "file" ? `Opened ${l.note ?? "a layout file"}` : `Solved by ${NODES[l.node]?.title ?? l.node}: m = ${fmt(l.scale, 4)}`;
    startFrom(s, from);
  }

  function continueFrom(k) {
    if (running) return;
    doc.steps = doc.steps.slice(0, k + 1);
    save();
    commit(doc.steps[k].output);
    setStatus(`Continuing from step ${k + 1}; the steps after it were dropped.`);
    refresh(k);
  }

  function redoFrom(k) {
    if (running) return;
    const step = doc.steps[k];
    doc.steps = doc.steps.slice(0, k);
    save();
    if (doc.steps.length) commit(doc.steps.at(-1).output);
    else commit(step.input);
    move = step.kind === "solve" ? "solve" : step.kind;
    setStatus(`Step ${k + 1} and the steps after it were dropped; choose the move again below.`);
    if (!doc.steps.length) { location.hash = "#/" + (step.output?.layout?.node && NODES[step.output.layout.node] ? step.output.layout.node : "tree"); return; }
    refresh(null, true);
  }

  const onDocPage = () => ["close", "stubs", "creases", "fold"].includes(state.node?.id);

  /** Re-renders the page around the workbench state (the live widget, the overlays) and scrolls to a step. */
  function refresh(scrollTo, toMenu) {
    if (!onDocPage()) return;
    enterNode(state.node.id);
    requestAnimationFrame(() => {
      const target = toMenu ? q("docAdd") : scrollTo != null ? q("doc-step-" + scrollTo) : null;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ───── What is open, and what to try next ─────

  function outlook(s) {
    const r = s?.report;
    if (!s?.layout) return { open: "No layout yet.", ok: false, next: [] };
    if (!r) return { open: "Not checked yet.", ok: false, next: [] };
    if (s.creases?.result?.built) return { open: `Crease pattern built: ${s.creases.result.creases.length} creases.`, ok: true, next: [] };
    if (r.valid) return { open: "Every polygon is valid.", ok: true, next: [["Build the crease pattern", "creases"]] };
    const bad = (r.polygons ?? []).filter((p) => !p.valid);
    const inside = bad.filter((p) => p.leavesInside?.length);
    const sides = r.missingBoundary?.length ?? 0;
    const parts = [];
    if (sides) parts.push(`${sides} hull side${sides === 1 ? "" : "s"} loose`);
    if (bad.length) parts.push(`${bad.length} polygon${bad.length === 1 ? "" : "s"} not valid`);
    if (r.hullArea > 0 && r.coveredArea < r.hullArea * (1 - 1e-6)) parts.push(`${Math.round((1 - r.coveredArea / r.hullArea) * 100)}% of the outline uncovered`);
    const next = [];
    if (inside.length) next.push([`Add a stub in ${inside[0].leaves.join("–")} (a leaf is inside it)`, "stub"]);
    if (s.stubs?.length && !s.closure) next.push(["Solve just the stubs", "solve", { which: "stubs" }]);
    next.push([s.closure ? "Close again with other bounds" : "Find the strain needed and close", "close"]);
    if (!inside.length && bad.length) next.push(["Add a stub", "stub"]);
    return { open: parts.join(", ") + ".", ok: false, next };
  }

  // ───── Tree widgets: a state's tree beside its sheet ─────

  /** The tree of a state, laid out as the editor would, facing its leaves on the sheet; in grid units like the sheet. */
  function treeDrawing(s, prev) {
    const W = 230, H = 230, P = 16;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "w-tree", role: "img", "aria-label": "The tree" });
    const edges = s.problem.edges.map((e) => ({ ...e, from: String(e.from), to: String(e.to), length: String(e.length) }));
    const info = treeInfo(edges);
    if (!info.vertices.length) return svg;
    const sheet = s.layout ? new Map(s.layout.points.map((p) => [p.leaf, [p.x, -p.y]])) : null;
    const unitPos = autoLayout(info, W - 2 * P, H - 2 * P, { edges, mirrors: s.problem.mirrorPairs ?? [], sheet });
    const px = new Map([...unitPos].map(([v, [u, w]]) => [v, [P + u * (W - 2 * P), P + w * (H - 2 * P)]]));
    const N = s.problem.gridSize, cell = Math.min(W, H) / N;
    const grid = svgEl("g", { class: "w-grid" });
    for (let k = 0; k <= N; k++) {
      grid.append(svgEl("line", { x1: k * cell, y1: 0, x2: k * cell, y2: N * cell }), svgEl("line", { x1: 0, y1: k * cell, x2: N * cell, y2: k * cell }));
    }
    svg.append(grid);
    const lengths = lengthsOf(s);
    const before = prev ? lengthsOf(prev) : null;
    const m = s.layout?.scale ?? 0;
    const stubs = new Set(s.stubs ?? []);
    const newOnes = new Set(prev ? info.vertices.filter((v) => !prev.problem.edges.some((e) => e.from === v || e.to === v)) : []);
    edges.forEach((e, k) => {
      const leaf = info.leaves.includes(e.to) ? e.to : info.leaves.includes(e.from) ? e.from : null;
      if (leaf && m > 0) {
        const [x, y] = px.get(leaf);
        svg.append(svgEl("circle", { cx: x, cy: y, r: m * lengths[k] * cell, class: "w-reach" }));
      }
    });
    edges.forEach((e, k) => {
      const a = px.get(e.from), b = px.get(e.to);
      const changed = before && before[k] != null && Math.abs(before[k] - lengths[k]) > 1e-9;
      const added = newOnes.has(e.from) || newOnes.has(e.to);
      const line = svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "w-edge" + (added ? " added" : changed ? " changed" : "") + (stubs.has(e.to) || stubs.has(e.from) ? " stub" : "") });
      const t = svgEl("title");
      t.textContent = `${e.from}–${e.to}: ℓ = ${fmt(lengths[k], 4)}` + (changed ? ` (was ${fmt(before[k], 4)})` : "");
      line.append(t);
      svg.append(line);
      if (changed || added) {
        const label = svgEl("text", { x: (a[0] + b[0]) / 2 + 4, y: (a[1] + b[1]) / 2 - 4, class: "w-len" + (added ? " added" : "") });
        label.textContent = fmt(lengths[k], 2);
        svg.append(label);
      }
    });
    for (const v of info.vertices) {
      const [x, y] = px.get(v);
      const leaf = info.leaves.includes(v);
      svg.append(svgEl("circle", { cx: x, cy: y, r: leaf ? 3.6 : 3, class: "w-v" + (leaf ? " leaf" : "") + (stubs.has(v) ? " stub" : "") + (newOnes.has(v) ? " added" : "") }));
      if (leaf) {
        const t = svgEl("text", { x: x + 5, y: y - 5, class: "w-label" });
        t.textContent = v;
        svg.append(t);
      }
    }
    return svg;
  }

  /** The sheet of a state: grid, leaf circles, polygons, tight paths, loose sides, creases; moved leaves from prev. */
  function sheetDrawing(s, prev) {
    const S = 230, P = 10;
    const svg = svgEl("svg", { viewBox: `0 0 ${S} ${S}`, class: "w-sheet", role: "img", "aria-label": "The sheet" });
    const N = s.problem.gridSize, u = (S - 2 * P) / N;
    const X = (x) => P + x * u, Y = (y) => S - P - y * u;
    svg.append(svgEl("rect", { x: P, y: P, width: S - 2 * P, height: S - 2 * P, class: "w-paper" }));
    const grid = svgEl("g", { class: "w-grid" });
    for (let k = 0; k <= N; k++) grid.append(svgEl("line", { x1: X(k), y1: Y(0), x2: X(k), y2: Y(N) }), svgEl("line", { x1: X(0), y1: Y(k), x2: X(N), y2: Y(k) }));
    svg.append(grid);
    if (!s.layout) {
      const t = svgEl("text", { x: S / 2, y: S / 2, "text-anchor": "middle", class: "w-empty" });
      t.textContent = "No layout yet";
      svg.append(t);
      return svg;
    }
    const id = "clip" + Math.random().toString(36).slice(2, 8);
    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id });
    clip.append(svgEl("rect", { x: P, y: P, width: S - 2 * P, height: S - 2 * P }));
    defs.append(clip);
    svg.append(defs);
    const pos = new Map(s.layout.points.map((p) => [p.leaf, [X(p.x), Y(p.y)]]));
    const lengths = lengthsOf(s);
    const circles = svgEl("g", { "clip-path": `url(#${id})` });
    const info = treeInfo(s.problem.edges);
    s.problem.edges.forEach((e, k) => {
      for (const v of [e.from, e.to]) if (info.leaves.includes(v) && pos.has(v)) {
        const [x, y] = pos.get(v);
        circles.append(svgEl("circle", { cx: x, cy: y, r: s.layout.scale * lengths[k] * u, class: "w-circle" }));
      }
    });
    svg.append(circles);
    const r = s.report;
    const ring = (ls) => ls.map((l) => pos.get(l)).filter(Boolean).map((p) => p.join(",")).join(" ");
    for (const p of r?.polygons ?? []) svg.append(svgEl("polygon", { points: ring(p.leaves), class: p.valid ? "w-ok" : "w-bad" }));
    if (s.creases?.result?.built) {
      for (const c of s.creases.result.creases) {
        if (c.kind === "Flat") continue;
        svg.append(svgEl("line", { x1: X(c.a.x), y1: Y(c.a.y), x2: X(c.b.x), y2: Y(c.b.y), class: "w-crease " + c.kind.toLowerCase() }));
      }
    } else {
      for (const p of r?.segments ?? []) {
        const a = pos.get(p.a), b = pos.get(p.b);
        if (a && b) svg.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "w-path" }));
      }
    }
    for (const p of r?.missingBoundary ?? []) {
      const a = pos.get(p.a), b = pos.get(p.b);
      if (a && b) svg.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "w-missing" }));
    }
    // Leaves that moved since the input: a ghost where they were.
    const was = prev?.layout ? new Map(prev.layout.points.map((p) => [p.leaf, p])) : null;
    const stubs = new Set(s.stubs ?? []);
    for (const p of s.layout.points) {
      const [x, y] = pos.get(p.leaf);
      const old = was?.get(p.leaf);
      if (old && (old.x !== p.x || old.y !== p.y)) {
        svg.append(svgEl("line", { x1: X(old.x), y1: Y(old.y), x2: x, y2: y, class: "w-moved" }), svgEl("circle", { cx: X(old.x), cy: Y(old.y), r: 3, class: "w-ghost" }));
      }
      const fresh = was && !was.has(p.leaf);
      svg.append(svgEl("circle", { cx: x, cy: y, r: 3.6, class: "w-leaf" + (stubs.has(p.leaf) ? " stub" : "") + (fresh ? " added" : "") }));
      const t = svgEl("text", { x: x + 5, y: y - 5, class: "w-label" });
      t.textContent = p.leaf;
      svg.append(t);
    }
    return svg;
  }

  function widget(s, prev, label) {
    const fig = h("figure", "state-widget");
    const cap = h("figcaption", "", label);
    const facts = h("span", "w-facts");
    if (s.layout) {
      const r = s.report;
      const valid = r ? (r.polygons ?? []).filter((p) => p.valid).length : null;
      facts.textContent = ` · m = ${fmt(s.layout.scale, 4)}` + (r ? ` · ${valid} of ${(r.polygons ?? []).length} polygons valid` : "")
        + (s.closure?.completion?.after ? ` · strain ±${fmt(s.closure.strainMax, 3)}` : "");
    } else {
      facts.textContent = ` · ${treeInfo(s.problem.edges).leaves.length} leaves, N = ${s.problem.gridSize}`;
    }
    cap.append(facts);
    const pair = h("div", "w-pair");
    pair.append(treeDrawing(s, prev), sheetDrawing(s, prev));
    fig.append(cap, pair);
    return fig;
  }

  // ───── Rendering the document ─────

  function paramsText(step) {
    const p = step.params ?? {};
    if (step.kind === "solve") {
      if (!p.solver) return "";
      return [NODES[p.solver]?.title, p.which === "stubs" ? "just the stubs (the other leaves held)" : "all leaves, from the previous layout", p.timeLimit ? `${p.timeLimit} s limit` : ""].filter(Boolean).join(" · ");
    }
    if (step.kind === "close") return p.auto ? "the smallest strain that closes them (A:4)" : `strain within [${fmt(p.strainMin, 3)}, ${fmt(p.strainMax, 3)}] (A:2)`;
    if (step.kind === "stub") return `ℓ = ${fmt(p.len, 4)} from ${p.attach}, leaf at (${p.x}, ${p.y}), tight to ${(p.tight ?? []).join(", ")}`;
    if (step.kind === "creases") return p.pleatHeight ? `pleated to height ${p.pleatHeight}` : "universal molecules (A:1)";
    return "";
  }

  function render() {
    const card = q("docCard");
    const show = onDocPage() && (doc.steps.length > 0 || !!workbench.layout);
    card.hidden = !show;
    q("docSide").hidden = !show;
    if (!show) return;
    if (!doc.steps.length && workbench.layout) {
      const s = fromWorkbench();
      const l = workbench.layout;
      startFrom(s, l.node === "file" ? `Opened ${l.note ?? "a layout file"}` : `Solved by ${NODES[l.node]?.title ?? l.node}: m = ${fmt(l.scale, 4)}`).then(render);
    }
    q("docName").value = doc.name ?? "";
    const list = q("docSteps");
    const last = doc.steps.length - 1;
    list.replaceChildren(...doc.steps.map((step, k) => {
      const li = h("li", "doc-step" + (k === last ? " current" : "") + (step.output.report?.valid ? " valid" : ""));
      li.id = "doc-step-" + k;
      const head = h("header", "doc-step-head");
      head.append(h("span", "doc-no", String(k + 1)), h("h3", "", step.title));
      const meta = h("p", "doc-meta", [paramsText(step), step.ms ? `${(step.ms / 1000).toFixed(1)} s` : ""].filter(Boolean).join(" · "));
      const io = h("div", "doc-io");
      io.append(widget(step.input, null, "Input"), h("span", "doc-arrow", "→"), widget(step.output, step.input, "Output"));
      li.append(head, meta, io);
      for (const n of step.notes ?? []) li.append(h("p", "doc-note", n));
      const o = outlook(step.output);
      li.append(h("p", "doc-open " + (o.ok ? "ok" : "no"), o.open));
      const actions = h("div", "doc-actions");
      if (k < last) {
        const c = h("button", "quiet small", "Continue from here");
        c.type = "button";
        c.title = `Keep steps 1–${k + 1}, drop the ${last - k} after it, and add new steps from this output`;
        c.addEventListener("click", () => continueFrom(k));
        actions.append(c);
      } else if (o.next.length) {
        actions.append(h("span", "doc-try", "Try next:"));
        for (const [label, m, params] of o.next) {
          const b = h("button", "link-button", label);
          b.type = "button";
          b.addEventListener("click", () => openMove(m, params, true));
          actions.append(b);
        }
      }
      const r = h("button", "quiet small", "Redo from here");
      r.type = "button";
      r.title = `Drop step ${k + 1}${k < last ? " and the steps after it" : ""}, and choose its move again from its input`;
      r.addEventListener("click", () => redoFrom(k));
      actions.append(r);
      li.append(actions);
      return li;
    }));
    if (running) list.append(runningItem());
    renderOutline();
    renderMoves();
  }

  function runningItem() {
    const li = h("li", "doc-step running");
    li.id = "doc-running";
    const head = h("header", "doc-step-head");
    head.append(h("span", "doc-no", String(doc.steps.length + 1)), h("h3", "", running.title));
    const status = h("p", "doc-meta");
    status.id = "docRunStatus";
    status.textContent = running.progress ?? "Running…";
    const io = h("div", "doc-io");
    io.append(widget(running.input, null, "Input"), h("span", "doc-arrow", "→"), h("div", "state-widget pending", "Working…"));
    li.append(head, status, io);
    if (running.cancel) {
      const b = h("button", "quiet small", "Cancel");
      b.type = "button";
      b.addEventListener("click", running.cancel);
      li.append(b);
    }
    return li;
  }

  function renderOutline() {
    const ol = q("docOutline");
    ol.replaceChildren(...doc.steps.map((step, k) => {
      const li = h("li", (k === doc.steps.length - 1 ? "current " : "") + (step.output.report?.valid ? "valid" : "open"));
      const a = h("a", "", `${k + 1}. ${step.title}`);
      a.href = "#doc-step-" + k;
      a.addEventListener("click", (e) => { e.preventDefault(); q("doc-step-" + k)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
      li.append(a);
      return li;
    }));
    if (running) ol.append(h("li", "running", `${doc.steps.length + 1}. ${running.title}…`));
  }

  // ───── The moves ─────

  function openMove(m, params = {}, scroll = false) {
    move = m;
    if (m === "solve" && params.which) {
      const radio = document.querySelector(`input[name="solveWhich"][value="${params.which}"]`);
      if (radio) radio.checked = true;
    }
    renderMoves();
    if (scroll) q("docAdd").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderMoves() {
    const s = current();
    const o = outlook(s);
    const suggested = new Set(o.next.map(([, m]) => m));
    for (const tab of document.querySelectorAll(".move-tab")) {
      tab.setAttribute("aria-selected", String(tab.dataset.move === move));
      tab.classList.toggle("suggested", suggested.has(tab.dataset.move));
    }
    for (const panel of document.querySelectorAll(".move-panel")) panel.hidden = panel.dataset.move !== move;
    q("docMoveNote").textContent = note;
    const busy = !!running;
    for (const b of document.querySelectorAll(".move-panel button.run")) b.disabled = busy || !s?.layout;

    // Solve: which leaves, and the warning for all of them once there is something to lose.
    const hasStubs = !!s?.stubs?.length;
    const stubsRadio = document.querySelector('input[name="solveWhich"][value="stubs"]');
    stubsRadio.disabled = !hasStubs;
    if (!hasStubs && stubsRadio.checked) document.querySelector('input[name="solveWhich"][value="all"]').checked = true;
    q("solveStubsNote").textContent = hasStubs ? `Holds every other leaf where it is; the solver places ${s.stubs.join(", ")} and finds the scale.` : "No stubs yet: add one first.";
    const all = document.querySelector('input[name="solveWhich"][value="all"]').checked;
    q("solveWarning").hidden = !(all && doc.steps.length > 1);
    if (!q("docSolver").value && s?.layout?.node && NODES[s.layout.node]?.kind === "solver") q("docSolver").value = s.layout.node;

    // Close: nothing to do when valid.
    const valid = !!s?.report?.valid;
    q("closeValidNote").hidden = !valid || !!s?.closure;

    // Creases: needs valid polygons.
    q("docBuild").disabled = busy || !valid;
    q("docBuildNote").textContent = valid
      ? `Builds in the ${s.closure?.completion?.after ? "closed" : "solver's"} lengths.` : "Waits for valid polygons: close them, or add stubs, first.";

    // Stub: the live widget picks the region, the point and the joint.
    const stubOpen = move === "stub" && !!s?.layout && !busy;
    document.body.dataset.stubbing = stubOpen ? "on" : "off";
    if (stubOpen) {
      const lengths = lengthsOf(s);
      stubTool.show({ ...s.layout, problem: s.problem, gridSize: s.problem.gridSize, edgeLengths: lengths }, s.report);
    } else {
      stubTool.hide();
      renderTreePreview();
    }
  }

  function begin(kind, title, params, cancel) {
    running = { kind, title, params, input: clone(current()), started: performance.now(), cancel };
    note = "";
    running.ticker = setInterval(() => {
      const el = q("docRunStatus");
      if (el) el.textContent = `${running.progress ?? "Running"} · ${((performance.now() - running.started) / 1000).toFixed(1)} s`;
    }, 200);
    render();
    q("doc-running")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return running;
  }

  function end(message) {
    if (running) clearInterval(running.ticker);
    const ms = running ? performance.now() - running.started : 0;
    running = null;
    if (message != null) { note = message; render(); }
    return ms;
  }

  async function runSolve() {
    const s = current();
    if (!s?.layout || running) return;
    const solver = q("docSolver").value;
    const node = NODES[solver], S = SOLVERS[node.api];
    const which = document.querySelector('input[name="solveWhich"]:checked').value;
    const timeLimit = Number(q("docTimeLimit").value) || 60;
    let conditions = s.problem.leafConditions ?? [];
    if (which === "stubs") {
      const stubs = new Set(s.stubs);
      conditions = [
        ...conditions.filter((c) => stubs.has(c.leaf)),
        ...s.layout.points.filter((p) => !stubs.has(p.leaf)).map((p) => ({ leaf: p.leaf, kind: "Fixed", x: p.x, y: p.y })),
      ];
    }
    const request = {
      ...s.problem, leafConditions: conditions, startLayout: s.layout.points,
      timeLimitSeconds: timeLimit, threads: numberOrNull("threads"), ...S.options(node),
    };
    const params = { solver, which, timeLimit };
    let cancelled = false;
    begin("solve", `Solve with ${node.title}` + (which === "stubs" ? ": just the stubs" : ": all leaves"), params, async () => {
      cancelled = true;
      running.progress = "Cancelling";
      try { await postJson("/api/cancel"); } catch { /* the solve ends on its own */ }
    });
    try {
      const response = await postJson(`/api/${node.api}/solve`, request);
      if (S.isCancelled(response) || cancelled && !S.normalize(response).layout.length) { end("The solve was cancelled; nothing changed."); return; }
      const v = S.normalize(response);
      if (!v.layout.length) { end(`${node.title} found no layout: ${S.statusText(response)}.`); return; }
      const out = {
        problem: s.problem,
        layout: { node: solver, points: v.layout.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })), scale: v.scale, edgeLengths: v.edgeLengths.length ? v.edgeLengths.map((e) => e.newLength) : null, status: v.status },
        closure: null, creases: null, report: null, stubs: s.stubs ?? [],
      };
      running.progress = "Checking the polygons";
      out.report = await check(out);
      const moved = out.layout.points.filter((p) => { const o = s.layout.points.find((x) => x.leaf === p.leaf); return o && (o.x !== p.x || o.y !== p.y); }).length;
      const ms = end();
      addStep({
        kind: "solve", title: running?.title ?? `Solve with ${node.title}` + (which === "stubs" ? ": just the stubs" : ": all leaves"), params, input: s, output: out, ms,
        notes: [`${S.statusText(response)}. m = ${fmt(s.layout.scale, 4)} → ${fmt(out.layout.scale, 4)}; ${moved} lea${moved === 1 ? "f" : "ves"} moved.`],
      });
    } catch (e) {
      end(`The solve failed: ${e.message}`);
    }
  }

  async function runClose(auto) {
    const s = current();
    if (!s?.layout || running) return;
    const min = Number(q("docStrainMin").value), max = Number(q("docStrainMax").value);
    const title = auto ? "Close the polygons: the strain needed" : `Close the polygons within ±${fmt(max, 3)}`;
    const r = begin("close", title, auto ? { auto: true } : { strainMin: min, strainMax: max });
    try {
      const req = base(s);
      let result, bounds, text;
      if (auto) {
        const found = await creaseReadiness.searchStrain(req, (t) => { r.progress = t; });
        if (found.already) { end("Nothing to close: " + found.text); return; }
        if (!found.result) { end(found.text); return; }
        result = found.result;
        bounds = { strainMin: -Math.min(found.bound, 0.99), strainMax: found.bound };
        text = found.text;
      } else {
        result = await postJson("/api/complete", { ...req, strainMin: min, strainMax: max });
        bounds = { strainMin: min, strainMax: max };
        text = result.messages?.join(" ") ?? "";
      }
      const out = { ...s, closure: { ...bounds, completion: result }, creases: null, report: slim(result.after) ?? s.report };
      const ms = end();
      const changed = (result.edgeLengths ?? []).filter((e) => Math.abs(e.strain) > 1e-9).length;
      addStep({
        kind: "close", title: result.after?.valid ? `${title}: closed` : `${title}: still open`, params: { auto, ...bounds }, input: s, output: out, ms,
        notes: [text, `${result.madeTight ?? 0} of ${result.targets?.length ?? 0} target pairs made tight; ${changed} edge length${changed === 1 ? "" : "s"} changed, largest strain ${fmt(result.largestStrain, 3)}.`].filter(Boolean),
      });
    } catch (e) {
      end(`Closing failed: ${e.message}`);
    }
  }

  async function addStub(c) {
    const s = current();
    if (!s?.layout || running) return;
    const lengths = lengthsOf(s);
    const out = {
      problem: { ...s.problem, edges: [...s.problem.edges, { from: c.attach, to: c.name, length: c.len, stretch: false }] },
      layout: { ...s.layout, points: [...s.layout.points, { leaf: c.name, x: c.x, y: c.y }], edgeLengths: [...lengths, c.len], status: `${s.layout.status ?? "Layout"} + stub ${c.name}` },
      closure: null, creases: null, report: null, stubs: [...(s.stubs ?? []), c.name],
    };
    begin("stub", `Add the stub ${c.name}`, c);
    try {
      out.report = await check(out);
      const ms = end();
      addStep({
        kind: "stub", title: `Add the stub ${c.name}`, params: { attach: c.attach, len: c.len, x: c.x, y: c.y, tight: c.tight }, input: s, output: out, ms,
        notes: [s.closure?.completion?.after ? "The stub keeps the closed lengths: they become the layout's lengths." : "The scale stays; every pair still fits."],
      });
    } catch (e) {
      end(`Adding the stub failed: ${e.message}`);
    }
  }

  async function runCreases() {
    const s = current();
    if (!s?.report?.valid || running) return;
    const pleat = q("docPleatOn").checked ? Number(q("docPleatHeight").value) : null;
    if (pleat !== null && !(pleat > 0)) { note = "The pleat height must be a positive number of grid units."; render(); return; }
    begin("creases", "Build the crease pattern", { pleatHeight: pleat });
    try {
      const lengths = lengthsOf(s);
      const result = await postJson("/api/creases", { ...base(s, lengths), pleatHeight: pleat });
      if (!result.built) { end(`The crease pattern was not built: ${(result.messages ?? []).join(" ")}`); return; }
      const out = { ...s, creases: { result, lengths, pleatHeight: pleat } };
      const ms = end();
      addStep({
        kind: "creases", title: "Build the crease pattern", params: { pleatHeight: pleat }, input: s, output: out, ms,
        notes: [`${result.creases.length} creases.` + (result.messages?.length ? " " + result.messages.join(" ") : "")],
      });
    } catch (e) {
      end(`Building the crease pattern failed: ${e.message}`);
    }
  }

  // ───── Session files ─────

  function saveFile() {
    const name = (q("docName").value || "session").trim();
    doc.name = name;
    save();
    const file = { format: "treemaker-session", version: 1, name, savedAt: new Date().toISOString(), steps: doc.steps };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[^\w.-]+/g, "-").toLowerCase() + ".session.json";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** A session file (files.js has checked its format and version): it becomes the document. */
  function openFile(data, fileName) {
    if (!Array.isArray(data.steps) || !data.steps.length) throw new Error(`${fileName} has no steps.`);
    for (const [k, s] of data.steps.entries()) {
      if (!s.output?.problem?.edges) throw new Error(`${fileName}: step ${k + 1} has no output tree.`);
    }
    doc.name = data.name ?? fileName.replace(/\.json$/i, "");
    doc.steps = data.steps;
    save();
    commit(doc.steps.at(-1).output);
    if (onDocPage()) refresh(doc.steps.length - 1); else location.hash = "#/close";
  }

  function init() {
    for (const tab of document.querySelectorAll(".move-tab")) tab.addEventListener("click", () => openMove(tab.dataset.move));
    for (const r of document.querySelectorAll('input[name="solveWhich"]')) r.addEventListener("change", renderMoves);
    q("docSolver").replaceChildren(...SOLVER_IDS.map((id) => { const o = document.createElement("option"); o.value = id; o.textContent = NODES[id].title; return o; }));
    q("docSolver").value = "";
    q("docRunSolve").addEventListener("click", runSolve);
    q("docAuto").addEventListener("click", () => runClose(true));
    q("docBounds").addEventListener("click", () => runClose(false));
    q("docBuild").addEventListener("click", runCreases);
    q("docPleatOn").addEventListener("change", () => { q("docPleatHeight").disabled = !q("docPleatOn").checked; });
    q("docSave").addEventListener("click", saveFile);
    q("docName").addEventListener("change", () => { doc.name = q("docName").value; save(); });
    stubTool.hooks.onAdd = addStub;
  }

  /** Which move a map node opens with. */
  function moveFor(nodeId) {
    return { close: "close", stubs: "stub", creases: "creases", fold: "creases" }[nodeId] ?? move;
  }

  return {
    init, render, workbenchChanged, openFile, openMove, moveFor, current,
    get steps() { return doc.steps; }, get running() { return !!running; },
  };
})();
