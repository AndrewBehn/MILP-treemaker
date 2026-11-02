// The session: one document from a tree to a crease pattern. Step 1 is always the tree; then come solves, closings,
// stubs and, if all goes well, the crease pattern (with its folded base). Each step holds its own settings, its
// input and its output, shown as tree widgets (the tree beside the sheet).
//
// Only the last step is live. Its settings are the app's controls for that kind of step (the tree editor and leaf
// conditions; a solver's settings; the closing bounds; the stub; the pleats), and running it replaces its output.
// Choosing a next step freezes it: the step keeps its settings, input and output as they were, and the moves on
// offer depend on its kind and on its output (a tree can only be solved; a layout with open polygons can be closed,
// stubbed or solved again; valid polygons can be built into creases). "Go back to this step" makes an earlier
// step the last one again, live, and drops the steps after it.
//
// A state is { problem, layout, closure, creases, report, stubs }:
//   problem   the tree: edges, gridSize, leafConditions, mirrorPairs
//   layout    { node, points: [{ leaf, x, y }], scale, edgeLengths, status }, or null before a solve
//   closure   { strainMin, strainMax, completion } after closing, or null
//   creases   { result, lengths, pleatHeight } after building the crease pattern, or null
//   report    the polygon check of the state's lengths (the closed lengths when there is a closure)
//   stubs     names of the leaves added as stubs
// A step is { kind: tree | solve | close | stub | creases, node, title, params, input, output, notes, ms, at }; its
// node is the map node whose controls it uses. The last step's output (or its input, before it has run) is what
// the workbench holds. Save the session writes every step (schemas/treemaker-session.schema.json, version 2).
"use strict";

const workflowDoc = (() => {
  const KEY = "treemaker.session.v2", OLD_KEY = "treemaker.session.v1";
  const SOLVER_NODES = () => SOLVER_IDS;
  const KIND_NODE = { tree: "tree", close: "close", stub: "stubs", creases: "creases" };
  const doc = load();
  let running = null;   // { title, started, ticker, progress }
  let treeTimer = null;

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
  const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
  const slim = (r) => r && {
    valid: r.valid, polygons: r.polygons, segments: r.segments, missingBoundary: r.missingBoundary, tightPairs: r.tightPairs,
    hullLeaves: r.hullLeaves, hullArea: r.hullArea, coveredArea: r.coveredArea, issues: r.issues,
  };
  const emptyState = (problem) => ({ problem: clone(problem), layout: null, closure: null, creases: null, report: null, stubs: [] });

  // ───── Storage, and documents from before the tree was a step ─────

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d?.steps?.length) return d;
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old?.steps?.length) return migrate(old);
    } catch { /* start afresh */ }
    return { name: "", steps: [] };
  }

  /** Version 1 started at the first solve: give it its tree step, and every step its node. */
  function migrate(d) {
    const steps = d.steps.map((s) => ({ ...s, node: s.node ?? (s.kind === "solve" ? (s.params?.solver ?? s.output?.layout?.node ?? "scalable") : KIND_NODE[s.kind]) }));
    if (steps[0]?.kind !== "tree") {
      const problem = steps[0].input?.problem ?? steps[0].output.problem;
      steps.unshift({ kind: "tree", node: "tree", title: "The tree", params: {}, input: null, output: emptyState(problem), notes: [] });
    }
    for (const s of steps) if (NODES[s.node] == null) s.node = "scalable";
    return { name: d.name ?? "", steps };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch {
      try { localStorage.setItem(KEY, JSON.stringify({ ...doc, steps: doc.steps.map(stripCreases) })); } catch { /* memory only */ }
    }
  }
  const stripCreases = (s) => ({ ...s, input: s.input && { ...s.input, creases: null }, output: s.output && { ...s.output, creases: null } });

  const last = () => doc.steps.at(-1);
  /** What the last step works on: its output once it has run, else its input. */
  const current = () => last()?.output ?? last()?.input ?? null;

  /** A session always starts with the tree: the editor's, if there is none yet. */
  function ensure() {
    if (doc.steps.length) return;
    doc.steps.push({ kind: "tree", node: "tree", title: "The tree", params: {}, input: null, output: emptyState(buildProblem()), notes: [] });
    save();
  }

  // ───── States ─────

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

  const problemKey = (p) => JSON.stringify({
    e: p.edges.map((e) => [String(e.from), String(e.to), Number(e.length), !!e.stretch]), n: p.gridSize,
    c: (p.leafConditions ?? []).map((c) => [c.leaf, c.kind, c.x ?? null, c.y ?? null]), m: (p.mirrorPairs ?? []).map((m) => [m.a, m.b]),
  });

  /** Puts a state on the workbench, and its tree into the editor. */
  function commit(s) {
    if (problemKey(buildProblem()) !== problemKey(s.problem)) applyProblem(s.problem);
    if (!s.layout) { workbench.setLayout(null); return; }
    workbench.setLayout({
      node: s.layout.node, problem: s.problem, gridSize: s.problem.gridSize, points: s.layout.points, scale: s.layout.scale,
      edgeLengths: s.layout.edgeLengths ?? null, status: s.layout.status, stubs: s.stubs,
      polygonsValid: s.closure ? undefined : s.report?.valid,
    });
    if (s.closure) workbench.setClosure(s.closure);
    if (s.creases) workbench.setCreases(s.creases);
  }

  // ───── What is open, and what can come next ─────

  function outlook(s) {
    const r = s?.report;
    if (!s) return { open: "", ok: false };
    if (!s.layout) return { open: `A tree of ${treeInfo(s.problem.edges).leaves.length} leaves on an ${s.problem.gridSize} × ${s.problem.gridSize} grid.`, ok: true };
    if (!r) return { open: "Not checked yet.", ok: false };
    if (s.creases?.result?.built) return { open: `Crease pattern built: ${s.creases.result.creases.length} creases.`, ok: true };
    if (r.valid) return { open: "Every polygon is valid: ready for the crease pattern.", ok: true };
    const bad = (r.polygons ?? []).filter((p) => !p.valid);
    const sides = r.missingBoundary?.length ?? 0;
    const parts = [];
    if (sides) parts.push(`${sides} hull side${sides === 1 ? "" : "s"} loose`);
    if (bad.length) parts.push(`${bad.length} polygon${bad.length === 1 ? "" : "s"} not valid`);
    const open = Math.max(0, (r.hullArea ?? 0) - (r.coveredArea ?? 0));
    if (open > 1e-6) parts.push(`${area(open)} of the outline not yet in a polygon`);
    return { open: parts.join(", ") + ".", ok: false, inside: bad.find((p) => p.leavesInside?.length) };
  }

  /** How far a state is toward valid polygons (for ranking only; never shown as a number). */
  function standing(s) {
    const r = s?.report;
    if (!s?.layout || !r) return null;
    const polys = r.polygons ?? [];
    const valid = polys.filter((p) => p.valid).length;
    const loose = r.missingBoundary?.length ?? 0;
    const open = Math.max(0, (r.hullArea ?? 0) - (r.coveredArea ?? 0));
    return { score: (r.valid ? 1e6 : 0) + valid * 1000 - open - loose * 10 + (r.tightPairs?.length ?? 0) * 0.01 };
  }

  const pairName = (p) => [p.a, p.b].sort(naturalCompare).join("–");
  const polyName = (p) => p.leaves.join("–");
  const area = (v) => `${fmt(v, 2)} square grid unit${Math.abs(v - 1) < 1e-9 ? "" : "s"}`;
  const listOf = (xs, max = 4) => xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;

  /** What changed between two states, in words: polygons, hull sides, tight paths, open area, scale, leaves. */
  function differences(a, b) {
    const ra = a?.report, rb = b?.report;
    const out = [];
    if (a?.layout && b?.layout && Math.abs(a.layout.scale - b.layout.scale) > 1e-9) out.push(`scale m ${fmt(a.layout.scale, 4)} → ${fmt(b.layout.scale, 4)}`);
    if (a?.layout && b?.layout) {
      const was = new Map(a.layout.points.map((p) => [p.leaf, p]));
      const moved = b.layout.points.filter((p) => was.has(p.leaf) && (was.get(p.leaf).x !== p.x || was.get(p.leaf).y !== p.y)).map((p) => p.leaf);
      const added = b.layout.points.filter((p) => !was.has(p.leaf)).map((p) => `${p.leaf} at (${p.x}, ${p.y})`);
      if (added.length) out.push(`added ${listOf(added)}`);
      if (moved.length) out.push(`moved ${listOf(moved)}`);
    }
    const lengthsA = a?.layout ? lengthsOf(a) : null, lengthsB = b?.layout ? lengthsOf(b) : null;
    if (lengthsA && lengthsB) {
      const changed = b.problem.edges.map((e, k) => k < lengthsA.length && Math.abs(lengthsA[k] - lengthsB[k]) > 1e-9 ? `${e.from}–${e.to} ${fmt(lengthsA[k], 3)} → ${fmt(lengthsB[k], 3)}` : null).filter(Boolean);
      if (changed.length) out.push(`edge lengths ${listOf(changed, 3)}`);
    }
    if (!ra || !rb) return out;
    const validA = new Set((ra.polygons ?? []).filter((p) => p.valid).map(polyName));
    const validB = new Set((rb.polygons ?? []).filter((p) => p.valid).map(polyName));
    const closed = [...validB].filter((x) => !validA.has(x)), reopened = [...validA].filter((x) => !validB.has(x));
    if (closed.length) out.push(`polygon${closed.length === 1 ? "" : "s"} ${listOf(closed)} now valid`);
    if (reopened.length) out.push(`polygon${reopened.length === 1 ? "" : "s"} ${listOf(reopened)} no longer valid`);
    const looseA = new Set((ra.missingBoundary ?? []).map(pairName)), looseB = new Set((rb.missingBoundary ?? []).map(pairName));
    const tightened = [...looseA].filter((x) => !looseB.has(x)), loosened = [...looseB].filter((x) => !looseA.has(x));
    if (tightened.length) out.push(`hull side${tightened.length === 1 ? "" : "s"} ${listOf(tightened)} now tight`);
    if (loosened.length) out.push(`hull side${loosened.length === 1 ? "" : "s"} ${listOf(loosened)} now loose`);
    const tightA = new Set((ra.tightPairs ?? []).map(pairName)), tightB = new Set((rb.tightPairs ?? []).map(pairName));
    const newTight = [...tightB].filter((x) => !tightA.has(x)), lostTight = [...tightA].filter((x) => !tightB.has(x));
    if (newTight.length) out.push(`new tight path${newTight.length === 1 ? "" : "s"} ${listOf(newTight)}`);
    if (lostTight.length) out.push(`tight path${lostTight.length === 1 ? "" : "s"} ${listOf(lostTight)} lost`);
    const openA = Math.max(0, (ra.hullArea ?? 0) - (ra.coveredArea ?? 0)), openB = Math.max(0, (rb.hullArea ?? 0) - (rb.coveredArea ?? 0));
    if (Math.abs(openA - openB) > 1e-6) out.push(openB < 1e-6 ? `no open area left (was ${area(openA)})` : `open area ${area(openA)} → ${area(openB)}`);
    return out;
  }

  const sentence = (parts) => parts.length ? parts[0][0].toUpperCase() + parts[0].slice(1) + (parts.length > 1 ? "; " + parts.slice(1).join("; ") : "") + "." : "";

  /**
   * Whether a step got anywhere: { kind: progress | neutral | none | worse | pending, text }, the text listing what
   * actually changed. A step that made no progress (nothing feasible, or nothing changed) cannot be built on: change
   * its settings and run it again, or go back. A step that made things worse can be built on, with a warning.
   */
  function progressOf(step) {
    if (!step?.output) return { kind: "pending", text: "Not run yet." };
    if (step.kind === "tree") {
      const edges = step.output.problem.edges;
      const info = treeInfo(edges);
      return info.leaves.length >= 2 && info.vertices.length === edges.length + 1
        ? { kind: "progress", text: "The tree is ready to solve." }
        : { kind: "none", text: "Draw a tree first: at least two leaves, connected, with one more vertex than edges." };
    }
    if (step.kind === "creases") return step.output.creases?.result?.built ? { kind: "progress", text: `Crease pattern built: ${step.output.creases.result.creases.length} creases.` } : { kind: "none", text: "No crease pattern was built." };
    if (step.kind === "close" && step.params?.already) return { kind: "neutral", text: "Every polygon was already valid: no strain needed." };
    if (step.kind === "close" && !step.output.closure?.completion?.after) {
      const why = step.output.closure?.completion?.messages?.join(" ");
      const next = step.params?.auto ? "Add stubs to split the open polygons, or go back and solve again." : "Widen the bounds or find the smallest strain, add stubs instead, or go back.";
      return { kind: "none", text: (why ? why + " " : "No strain within these bounds keeps every pair feasible, so nothing changed. ") + next };
    }
    if (step.kind === "solve" && !step.input?.layout) {
      const r = step.output.report;
      return { kind: "progress", text: `A first layout at scale m = ${fmt(step.output.layout.scale, 4)}` + (r ? `: ${(r.polygons ?? []).filter((p) => p.valid).length} of ${(r.polygons ?? []).length} polygons valid.` : ".") };
    }
    const a = standing(step.input), b = standing(step.output);
    if (!a || !b) return { kind: "neutral", text: "Not checked yet." };
    const diff = differences(step.input, step.output);
    const better = b.score > a.score + 1e-6 || (step.kind === "solve" && step.output.layout.scale > step.input.layout.scale + 1e-9);
    const worse = b.score < a.score - 1e-6 || (step.kind === "solve" && step.output.layout.scale < step.input.layout.scale - 1e-9);
    if (better && !worse) return { kind: "progress", text: sentence(diff) || "Progress." };
    if (worse && !better) return { kind: "worse", text: `${sentence(diff)} Worse than its input: you can go on from it, or go back.` };
    if (better && worse) return { kind: "neutral", text: `${sentence(diff)} Some better, some worse.` };
    if (step.kind === "stub") return { kind: "neutral", text: `${sentence(diff) || "Stubs added."} The polygons are not closed yet: straining usually closes them now.` };
    return { kind: "none", text: `No progress${diff.length ? ": " + diff.join("; ") + ", but no polygon closed and no open area shrank" : ": nothing changed"}. Change the settings and run it again, or go back.` };
  }

  /**
   * The moves that can follow a step, from its kind and its output: [{ kind, label, note, which?, suggested? }].
   * A tree is solved; a layout with open polygons is closed, stubbed or solved again; valid polygons become creases.
   */
  function movesAfter(step) {
    const s = step?.output;
    if (!s || progressOf(step).kind === "none") return [];
    if (step.kind === "tree") return [{ kind: "solve", label: "Solve", note: "Place the leaves on the grid with a layout solver." }];
    if (step.kind === "creases") return [];
    const o = outlook(s);
    const moves = [];
    if (s.report?.valid) moves.push({ kind: "creases", label: "Build the crease pattern", note: "Fill every polygon with universal molecules.", suggested: true });
    else {
      // After stubs the layout is already feasible; straining is what usually closes it. A solve of just the stubs
      // is offered, but with the other leaves held it can at best keep the scale, so it is not the suggestion.
      moves.push({ kind: "close", label: "Strain the edges", note: "Stretch or shrink edge lengths, leaves held, until the open pairs are tight and the polygons close.", suggested: !o.inside || step.kind === "stub" });
      if (step.kind === "stub") moves.push({ kind: "solve", which: "stubs", label: "Solve just the stubs", note: "Let a solver re-place the stubs, every other leaf held. Optional: the stubs already fit." });
      if (step.kind !== "stub") moves.push({ kind: "stub", label: "Add stubs", note: o.inside ? `A leaf is inside ${o.inside.leaves.join("–")}: split it with stubs.` : "Split open polygons with short new flaps, as many as you like in one step.", suggested: !!o.inside });
    }
    moves.push({ kind: "solve", which: "all", label: "Solve again", note: "Solve all the leaves again, from this layout." });
    if (s.stubs?.length && step.kind !== "stub") moves.push({ kind: "solve", which: "stubs", label: "Solve just the stubs", note: "Every other leaf held where it is." });
    return moves;
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


  // ───── Rendering ─────

  const kindName = { tree: "Tree", solve: "Solve", close: "Strain the edges", stub: "Add stubs", creases: "Crease pattern" };

  /** The settings a frozen step ran with, as label/value pairs. */
  function settings(step) {
    const p = step.params ?? {};
    const o = step.output;
    switch (step.kind) {
      case "tree": {
        const pr = o.problem;
        return [["Leaves", String(treeInfo(pr.edges).leaves.length)], ["Edges", String(pr.edges.length)], ["Grid N", String(pr.gridSize)],
          ["Leaf conditions", String((pr.leafConditions ?? []).length)], ["Mirror pairs", String((pr.mirrorPairs ?? []).length)]];
      }
      case "solve": {
        const rows = [["Solver", NODES[step.node]?.title ?? step.node]];
        if (p.opened) rows.push(["Opened", p.opened]);
        if (p.which) rows.push(["Leaves", p.which === "stubs" ? "just the stubs (the others held)" : "all, from the previous layout"]);
        if (p.timeLimit) rows.push(["Time limit", `${p.timeLimit} s`]);
        // Only the settings that say what was solved; the solver's full option set is under Notes.
        if (p.options?.stage) rows.push(["Model", p.options.stage]);
        return rows;
      }
      case "close": return p.auto ? [["Strain", "the smallest that closes the polygons (A:4)"], ["Found", `±${fmt(p.strainMax, 3)}`]]
        : [["σ_min", fmt(p.strainMin, 3)], ["σ_max", fmt(p.strainMax, 3)]];
      case "stub": return stubsOf(p).map((t) => [t.name, `from ${t.attach}, ℓ = ${fmt(t.len, 4)}, at (${t.x}, ${t.y}), tight to ${(t.tight ?? []).join(", ")}`]);
      case "creases": return [["Pleats", p.pleatHeight ? `to height ${p.pleatHeight}` : "none"]];
      default: return [];
    }
  }

  function stepTitle(step) {
    if (step.kind === "solve" && step.params?.opened) return `Opened ${step.params.opened}`;
    if (step.kind === "solve") return `Solve with ${NODES[step.node]?.title ?? step.node}` + (step.params?.which === "stubs" ? ": just the stubs" : "");
    if (step.kind === "stub" && stubsOf(step.params).length) return `Add stubs: ${stubsOf(step.params).map((t) => t.name).join(", ")}`;
    if (step.kind === "close" && step.output?.closure) return `Strain the edges: ±${fmt(step.output.closure.strainMax, 3)}` + (step.output.report?.valid ? ", polygons closed" : ", still open");
    return kindName[step.kind];
  }

  function frozenItem(step, k) {
    const li = h("li", "doc-step frozen" + (step.output?.report?.valid || step.kind === "creases" ? " valid" : ""));
    const pr = progressOf(step);
    li.dataset.progress = pr.kind;
    li.id = "doc-step-" + k;
    const head = h("header", "doc-step-head");
    head.append(h("span", "doc-no", String(k + 1)), h("h3", "", stepTitle(step)));
    if (step.ms) head.append(h("span", "doc-time", `${(step.ms / 1000).toFixed(1)} s`));
    const back = h("button", "quiet small go-back", "Go back to this step");
    back.type = "button";
    const later = doc.steps.length - 1 - k;
    back.title = `Make step ${k + 1} the live step again; the ${later} step${later === 1 ? "" : "s"} after it will be dropped`;
    back.addEventListener("click", () => {
      if (back.dataset.armed !== "yes") {
        back.dataset.armed = "yes";
        back.textContent = `Drop the ${later} later step${later === 1 ? "" : "s"} and go back?`;
        setTimeout(() => { back.dataset.armed = ""; back.textContent = "Go back to this step"; }, 4000);
        return;
      }
      goBack(k);
    });
    head.append(back);
    li.append(head);
    const spec = specLine(step.node);
    if (spec) li.append(spec);
    const dl = h("div", "doc-settings");
    for (const [a, b] of settings(step)) {
      const row = h("div", "setting");
      row.append(h("span", "k", a), h("span", "v", b));
      dl.append(row);
    }
    const io = h("div", "doc-io" + (step.input ? "" : " single"));
    if (step.input) io.append(widget(step.input, null, "Input"), h("span", "doc-arrow", "→"));
    io.append(widget(step.output, step.input, "Output"));
    li.append(dl, io);
    li.append(resultLine(step), notesBox(step));
    return li;
  }

  /** One line under a step: what it changed, and what is still open (or that it is done). */
  function resultLine(step) {
    const pr = progressOf(step);
    const o = outlook(step.output);
    const p = h("p", "doc-progress " + pr.kind, step.kind === "tree" ? o.open : pr.text);
    if (step.kind !== "tree" && o.open && !pr.text.includes(o.open)) p.append(h("span", "still", (o.ok ? " " : " Still open: ") + (o.ok ? o.open : o.open.replace(/^./, (c) => c.toLowerCase()))));
    return p;
  }

  /** The solver's and the server's own messages, folded away. */
  function notesBox(step) {
    const notes = (step.notes ?? []).filter(Boolean);
    // A solve's full option set, too: the settings line shows only the solver, the leaves and the model.
    const opts = { ...(step.params?.options ?? {}), ...(step.params?.options?.options ?? {}) };
    delete opts.options;
    const shown = Object.entries(opts).filter(([, v]) => v != null && typeof v !== "object");
    if (shown.length) notes.push("Solver settings: " + shown.map(([k, v]) => `${k} ${v}`).join(", ") + ".");
    if (!notes.length) return document.createTextNode("");
    const d = h("details", "doc-more");
    d.append(h("summary", "", "Notes"), ...notes.map((n) => h("p", "doc-note", n)));
    return d;
  }

  /** "Spec: <doc> · <sections>", linked into the docs tab, for the map node a step uses. */
  function specLine(nodeId) {
    const node = NODES[nodeId];
    if (!node?.doc || !DOCS[node.doc]) return null;
    const p = h("p", "doc-spec");
    p.append("Spec: ", specLinks.link(DOCS[node.doc].title, node.doc, null), " · ", specLinks.linkify(node.section, node.doc));
    return p;
  }

  /** The whole document: the frozen steps, the live step's frame, the outline and the next moves. */
  function render() {
    ensure();
    const steps = doc.steps;
    const n = steps.length;
    q("docSteps").replaceChildren(...steps.slice(0, -1).map(frozenItem));
    const f = last();
    q("finalNo").textContent = String(n);
    q("finalStep").dataset.kind = f.kind;
    q("outputLabel").textContent = f.kind === "tree" ? "The tree: draw it, pin and mirror its leaves" : "Output";
    q("finalStep").dataset.progress = running ? "pending" : progressOf(f).kind;
    q("finalInput").replaceChildren(...(f.input ? [widget(f.input, null, "Input")] : []));
    renderFinalNotes();
    renderWhich();
    renderOutline();
    renderNext();
    q("docName").value = doc.name ?? "";
  }

  function renderFinalNotes() {
    const f = last();
    const box = q("finalNotes");
    box.replaceChildren();
    if (running) { box.append(h("p", "doc-note running", running.progress ?? "Running…")); return; }
    if (f.output && f.kind !== "tree") box.append(resultLine(f), notesBox(f));
  }

  /**
   * The step cards beside the document: one per step, with its number, title, what it did and a small sheet. They
   * stay in view while the page scrolls; the card of the step on screen is outlined, and a click scrolls to it.
   */
  function renderOutline() {
    const ol = q("docOutline");
    ol.replaceChildren(...doc.steps.map((step, k) => {
      const live = k === doc.steps.length - 1;
      const pr = progressOf(step);
      const li = h("li", "step-card" + (live ? " current" : ""));
      li.dataset.progress = pr.kind;
      li.dataset.target = live ? "finalStep" : "doc-step-" + k;
      const a = h("a");
      a.href = "#" + li.dataset.target;
      const body = h("span", "sc-body");
      const mark = { progress: "▲", worse: "▼", none: "■", neutral: "●", pending: "○" }[pr.kind];
      body.append(h("span", "sc-kicker", `${mark} Step ${k + 1}${live ? (step.output ? " · live" : " · not run yet") : ""}`), h("b", "sc-title", stepTitle(step)),
        h("span", "sc-text", pr.text.length > 110 ? pr.text.slice(0, 108).replace(/[;,]?\s+\S*$/, "") + "…" : pr.text));
      a.append(body);
      const s0 = step.output ?? step.input;
      if (s0?.layout) { const t = sheetDrawing(s0, null); t.classList.add("sc-thumb"); a.append(t); }
      a.title = pr.text;
      a.addEventListener("click", (e) => { e.preventDefault(); q(li.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
      li.append(a);
      return li;
    }));
    if (running) ol.append(h("li", "step-card running", `Step ${doc.steps.length}: ${running.progress ?? "running"}…`));
    watchSteps();
  }

  /** Outlines the card of the step that fills most of the screen. */
  let spy = null;
  function watchSteps() {
    spy?.disconnect();
    if (!("IntersectionObserver" in window)) return;
    const seen = new Map();
    spy = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.intersectionRatio * e.boundingClientRect.height);
      let best = null, most = 0;
      for (const [id, v] of seen) if (v > most) { most = v; best = id; }
      for (const card of q("docOutline").children) card.classList.toggle("in-view", card.dataset.target === best);
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    for (const el of [...q("docSteps").children, q("finalStep")]) if (el.id) spy.observe(el);
  }


  /** The next moves, from the live step's kind and output. */
  function renderNext() {
    const f = last();
    const menu = q("nextMenu");
    const moves = running ? [] : movesAfter(f);
    menu.hidden = false;
    q("pickCard").hidden = !(f.kind === "tree" && f.output && !running);
    const box = q("nextMoves");
    box.replaceChildren();
    if (running) { q("nextIntro").textContent = "Wait for this step to finish, or cancel it."; return; }
    if (!f.output) { q("nextIntro").textContent = `Run step ${doc.steps.length} first: its output is what the next step starts from.`; return; }
    if (progressOf(f).kind === "none") {
      q("pickCard").hidden = true;
      q("nextIntro").textContent = f.kind === "tree" ? progressOf(f).text
        : `Step ${doc.steps.length} made no progress, so there is nothing new to build on. Change its settings and run it again, or go back to an earlier step.`;
      return;
    }
    if (f.kind === "creases") {
      q("nextIntro").textContent = "The crease pattern is built: the end of this path. Go back to an earlier step to try another.";
      return;
    }
    if (f.kind === "tree") {
      q("nextIntro").textContent = "Choosing a solver freezes the tree: it becomes step 1, and the solve becomes step 2.";
      return;
    }
    q("nextIntro").textContent = `Choosing a move freezes step ${doc.steps.length} as it is and adds step ${doc.steps.length + 1}.`;
    const solver = h("select", "next-solver");
    solver.setAttribute("aria-label", "Solver for the next solve");
    for (const id of SOLVER_IDS) { const o = h("option", "", NODES[id].title); o.value = id; solver.append(o); }
    const lastSolve = [...doc.steps].reverse().find((st) => st.kind === "solve" && SOLVER_IDS.includes(st.node) && !st.params?.opened);
    solver.value = lastSolve?.node ?? "scalable";
    for (const m of moves) {
      const card = h("div", "next-move" + (m.suggested ? " suggested" : "") + (m.kind === "solve" ? " solve" : ""));
      const b = h("button", m.suggested ? "primary small-primary" : "quiet", m.label);
      b.type = "button";
      b.addEventListener("click", () => addStep(m.kind, m.kind === "solve" ? solver.value : KIND_NODE[m.kind], m.which ? { which: m.which } : {}));
      const note = h("p", "btn-note", m.note + " ");
      const node = NODES[m.kind === "solve" ? solver.value : KIND_NODE[m.kind]];
      if (node?.doc) note.append(specLinks.link("Spec", node.doc, specLinks.firstTarget(node.section, node.doc).at, "spec-mini"));
      card.append(b, note);
      box.append(card);
    }
    if (moves.some((m) => m.kind === "solve")) {
      const row = h("label", "next-solver-row", "Solve with ");
      row.append(solver);
      box.prepend(row);
    }
  }

  /** The "Which leaves" choice of a live solve step: only when it starts from a layout. */
  function renderWhich() {
    const f = last();
    const block = q("whichBlock");
    const has = f.kind === "solve" && !!f.input?.layout && !f.params?.opened;
    block.hidden = !has;
    if (!has) return;
    const stubs = f.input.stubs ?? [];
    const stubsRadio = document.querySelector('input[name="solveWhich"][value="stubs"]');
    stubsRadio.disabled = !stubs.length;
    const want = f.params?.which ?? "all";
    document.querySelector(`input[name="solveWhich"][value="${want === "stubs" && stubs.length ? "stubs" : "all"}"]`).checked = true;
    q("solveStubsNote").textContent = stubs.length ? `Holds every other leaf where it is; the solver places ${stubs.join(", ")} and finds the scale.` : "No stubs yet.";
    q("solveWarning").hidden = !document.querySelector('input[name="solveWhich"][value="all"]').checked;
  }

  // ───── Moving through the document ─────

  /** Freezes the live step and adds a new one of this kind after it. */
  function addStep(kind, node, params = {}) {
    const f = last();
    if (!f.output || running) return;
    doc.steps.push({ kind, node, title: "", params, input: clone(f.output), output: null, notes: [] });
    save();
    commit(last().input);
    go(node, true);
    autoRun();
  }

  /**
   * A new step runs at once with its default settings: a solve solves, straining finds the smallest strain, the
   * crease pattern builds. Change the settings and run it again if the result is not what you want. Stubs wait for
   * you to pick them (the best is proposed).
   */
  function autoRun() {
    const f = last();
    if (f.output || running) return;
    setTimeout(() => {
      if (last() !== f || f.output || running) return;
      if (f.kind === "solve" && typeof solve === "function" && !state.solving) solve();
      else if (f.kind === "close" && f.input?.layout && !f.input.report?.valid) runClose(true);
      else if (f.kind === "creases" && f.input?.report?.valid) runCreases();
    }, 350);
  }

  /** Makes step k the live one again; the steps after it are dropped. */
  function goBack(k) {
    if (running) return;
    const dropped = doc.steps.length - 1 - k;
    doc.steps = doc.steps.slice(0, k + 1);
    save();
    const f = last();
    commit(f.output ?? f.input);
    setStatus(`Back at step ${k + 1}; ${dropped} later step${dropped === 1 ? " was" : "s were"} dropped.`);
    go(f.node, true);
  }

  /**
   * Redraws the page without losing your place: the page is rebuilt (and briefly shorter while the sheet is
   * redrawn), so the scroll position is put back as the content returns.
   */
  function stayInPlace(redraw) {
    const y = window.scrollY;
    state.keepScroll = true;
    try { redraw(); } finally { state.keepScroll = false; }
    for (const t of [0, 120, 400, 900]) setTimeout(() => window.scrollTo(0, y), t);
  }

  /** Shows the session at its live step (enterNode runs that step's part of the app), then scrolls to it. */
  function go(node, scroll) {
    if (location.hash !== "#/" + node) history.replaceState(null, "", "#/" + node);
    enterNode(node);
    if (scroll) requestAnimationFrame(() => q("finalStep").scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  /**
   * Where a map node leads: the live step when it is that node; a new step when the node is a move the live step
   * allows; otherwise the latest step of that kind, shown in place. Returns the node to enter and what to scroll to.
   */
  function navigate(id) {
    ensure();
    const f = last();
    if (id === "fold") id = "creases";
    if (id === f.node) return { node: id, scroll: id === "creases" ? "foldCard" : null };
    const kind = SOLVER_IDS.includes(id) ? "solve" : Object.keys(KIND_NODE).find((k) => KIND_NODE[k] === id);
    if (kind === "solve" && f.kind === "solve" && !f.output) { f.node = id; save(); return { node: id }; }
    if (kind && kind !== "tree" && movesAfter(f).some((m) => m.kind === kind)) {
      doc.steps.push({ kind, node: id, title: "", params: {}, input: clone(f.output), output: null, notes: [] });
      save();
      commit(last().input);
      return { node: id, scroll: "finalStep", auto: true };
    }
    const k = doc.steps.map((s) => s.node).lastIndexOf(id);
    return { node: f.node, scroll: k >= 0 && k < doc.steps.length - 1 ? "doc-step-" + k : "finalStep" };
  }

  // ───── The live step: its output ─────

  /** The tree step's output follows the editor. */
  function treeEdited() {
    const f = last();
    if (!f || f.kind !== "tree") return;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => {
      f.output = emptyState(buildProblem());
      save();
      renderNext();
    }, 200);
  }

  /** A solver page's request, as the live solve step wants it: just the stubs holds every other leaf. */
  function adjustRequest(request) {
    const f = last();
    if (f?.kind !== "solve" || !f.input?.layout) return request;
    const which = document.querySelector('input[name="solveWhich"]:checked')?.value ?? "all";
    if (which !== "stubs" || !f.input.stubs?.length) return request;
    const stubs = new Set(f.input.stubs);
    return {
      ...request,
      leafConditions: [
        ...(request.leafConditions ?? []).filter((c) => stubs.has(c.leaf)),
        ...f.input.layout.points.filter((p) => !stubs.has(p.leaf)).map((p) => ({ leaf: p.leaf, kind: "Fixed", x: p.x, y: p.y })),
      ],
      startLayout: f.input.layout.points,
    };
  }

  /** The live solve step ran: its output is the new layout. */
  async function solved(request, view, response, node) {
    const f = last();
    if (f?.kind !== "solve") return;
    const S = SOLVERS[node.api];
    const which = document.querySelector('input[name="solveWhich"]:checked')?.value ?? "all";
    const out = {
      problem: f.input.problem,
      layout: { node: node.id, points: view.layout.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })), scale: view.scale, edgeLengths: view.edgeLengths.length ? view.edgeLengths.map((e) => e.newLength) : null, status: view.status },
      closure: null, creases: null, report: null, stubs: f.input.stubs ?? [],
    };
    f.node = node.id;
    f.params = { which: f.input.layout ? which : undefined, timeLimit: request.timeLimitSeconds, options: S.options(node) };
    f.ms = response.totalMilliseconds ?? null;
    const before = f.input.layout;
    const moved = before ? out.layout.points.filter((p) => { const o = before.points.find((x) => x.leaf === p.leaf); return o && (o.x !== p.x || o.y !== p.y); }).length : null;
    f.notes = [`${S.statusText(response)}.` + (before ? ` m = ${fmt(before.scale, 4)} → ${fmt(out.layout.scale, 4)}; ${moved} lea${moved === 1 ? "f" : "ves"} moved.` : ` m = ${fmt(out.layout.scale, 4)}.`)];
    f.output = out;
    save();
    render();
    try { out.report = await check(out); save(); render(); } catch { /* shown as not checked */ }
  }

  /** The live step of kind close, stub or creases: run it, show progress, keep its output. */
  async function run(kind, title, work) {
    const f = last();
    if (f.kind !== kind || running) return;
    running = { title, started: performance.now(), progress: `${title}…` };
    running.ticker = setInterval(() => { renderFinalNotes(); }, 250);
    renderFinalNotes(); renderNext(); renderOutline();
    try {
      const result = await work((t) => { running.progress = t; });
      const ms = performance.now() - running.started;
      if (result) {
        Object.assign(f, result, { ms });
        save();
        commit(f.output);
        clearInterval(running.ticker);
        running = null;
        stayInPlace(() => go(f.node, false));
        return;
      }
    } catch (e) {
      setStatus(`${title} failed: ${e.message}`, "error");
    }
    clearInterval(running?.ticker);
    running = null;
    render();
  }

  /**
   * The strain step. Each closing solve is a MILP with no time limit of its own on the server, and the search for the
   * smallest strain makes several, so each gets the step's time limit; the search shows where it is beside its
   * buttons, can be cancelled between solves, and every outcome (none needed, none possible, failed) is recorded as
   * the step's result rather than left as a passing message.
   */
  let strainStop = false;
  function runClose(auto) {
    const f = last();
    const s = f.input;
    const min = Number(q("docStrainMin").value), max = Number(q("docStrainMax").value);
    const limit = Math.max(1, Number(q("docStrainLimit").value) || 20);
    const started = performance.now();
    const say = (t) => { q("strainProgress").textContent = `${t} · ${((performance.now() - started) / 1000).toFixed(0)} s`; };
    const ticker = setInterval(() => { if (strainLast) say(strainLast); }, 1000);
    let strainLast = "";
    strainStop = false;
    for (const id of ["docAuto", "docBounds"]) q(id).disabled = true;
    q("strainCancel").hidden = false;
    const stuck = (message, params) => ({
      params, output: { ...s, closure: { ...params, completion: { after: null, messages: [message] } }, creases: null }, notes: [message],
    });
    const done = run("close", auto ? "Finding the smallest strain" : `Straining within ±${fmt(max, 3)}`, async (progress) => {
      const tell = (t) => { strainLast = t; say(t); progress(t); };
      const req = { ...base(s), problem: { ...s.problem, timeLimitSeconds: limit } };
      let result, bounds, text;
      if (auto) {
        let found;
        try {
          found = await creaseReadiness.searchStrain(req, tell, () => strainStop);
        } catch (e) {
          return stuck(strainStop ? "Cancelled: the search for the smallest strain was stopped." : `The search failed: ${e.message}`, { auto });
        }
        if (found.already) return { params: { auto, already: true }, output: { ...s }, notes: ["No strain needed: " + found.text] };
        if (!found.result) return stuck(found.text, { auto });
        result = found.result;
        bounds = { strainMin: -Math.min(found.bound, 0.99), strainMax: found.bound };
        text = found.text;
      } else {
        tell("Closing the polygons");
        result = await postJson("/api/complete", { ...req, strainMin: min, strainMax: max });
        bounds = { strainMin: min, strainMax: max };
        text = result.messages?.join(" ") ?? "";
      }
      const changed = (result.edgeLengths ?? []).filter((e) => Math.abs(e.strain) > 1e-9).length;
      return {
        params: { auto, ...bounds },
        output: { ...s, closure: { ...bounds, completion: result }, creases: null, report: slim(result.after) ?? s.report },
        notes: [text, `${result.madeTight ?? 0} of ${result.targets?.length ?? 0} target pairs made tight; ${changed} edge length${changed === 1 ? "" : "s"} changed, largest strain ${fmt(result.largestStrain, 3)}.`].filter(Boolean),
      };
    });
    return Promise.resolve(done).finally(() => {
      clearInterval(ticker);
      const el = q("strainProgress");
      if (el) el.textContent = "";
      for (const id of ["docAuto", "docBounds"]) if (q(id)) q(id).disabled = false;
      if (q("strainCancel")) q("strainCancel").hidden = true;
    });
  }

  /** The stubs a stub step added (version 2 saved one stub per step, as the params themselves). */
  const stubsOf = (p) => p?.stubs ?? (p?.name ? [p] : []);

  /** Adds one more stub to the live stub step: a step can add as many as you like. */
  function addStub(c) {
    const f = last();
    const s = f.output ?? f.input;
    return run("stub", `Adding the stub ${c.name}`, async () => {
      const lengths = lengthsOf(s);
      const out = {
        problem: { ...s.problem, edges: [...s.problem.edges, { from: c.attach, to: c.name, length: c.len, stretch: false }] },
        layout: { ...s.layout, points: [...s.layout.points, { leaf: c.name, x: c.x, y: c.y }], edgeLengths: [...lengths, c.len], status: `${s.layout.status ?? "Layout"} + stub ${c.name}` },
        closure: null, creases: null, report: null, stubs: [...(s.stubs ?? []), c.name],
      };
      out.report = await check(out);
      const added = [...stubsOf(f.params), { name: c.name, attach: c.attach, len: c.len, x: c.x, y: c.y, tight: c.tight }];
      return {
        params: { stubs: added },
        output: out,
        states: [...(f.states ?? []), out],
        notes: [(f.input.closure?.completion?.after ? "The stubs keep the closed lengths: they become the layout's lengths. " : "") + `The scale stays; every pair still fits. ${added.length} stub${added.length === 1 ? "" : "s"} in this step; add more, or choose the next step.`],
      };
    });
  }

  /** Adds the best stub that splits a polygon, checks again, and repeats while one does (at most six). */
  async function stubEveryRegion() {
    const f = last();
    if (f.kind !== "stub" || running) return;
    let added = 0;
    for (; added < 6; added++) {
      const now = last().output ?? last().input;
      const c = stubTool.bestAnywhere({ ...now.layout, problem: now.problem, gridSize: now.problem.gridSize, edgeLengths: lengthsOf(now) }, now.report);
      if (!c) break;
      const count = (r) => [(r?.polygons ?? []).length, (r?.polygons ?? []).filter((p) => p.valid).length];
      const [n0, v0] = count(now.report);
      await addStub(c);
      const [n1, v1] = count(last().output?.report);
      // A stub that neither split a polygon nor made one valid is not worth keeping: take it out and stop.
      if (n1 <= n0 && v1 <= v0) { removeStub(); break; }
      if (last().output?.report?.valid) { added++; break; }
    }
    setStatus(added ? `Added ${added} stub${added === 1 ? "" : "s"}, each the best that split a polygon at the time; stopped when the next would not.` : "No stub splits an open polygon here: straining the edges, or solving again, is the way on.");
  }

  /** Takes the last stub out of the live stub step again. */
  function removeStub() {
    const f = last();
    if (f.kind !== "stub" || running || !stubsOf(f.params).length) return;
    const states = (f.states ?? []).slice(0, -1);
    const stubs = stubsOf(f.params).slice(0, -1);
    f.states = states;
    f.params = { stubs };
    f.output = states.at(-1) ?? null;
    f.notes = stubs.length ? [`${stubs.length} stub${stubs.length === 1 ? "" : "s"} in this step.`] : [];
    save();
    commit(f.output ?? f.input);
    stayInPlace(() => go(f.node, false));
  }

  function runCreases() {
    const s = last().input;
    const pleat = q("docPleatOn").checked ? Number(q("docPleatHeight").value) : null;
    if (pleat !== null && !(pleat > 0)) { setStatus("The pleat height must be a positive number of grid units.", "error"); return; }
    return run("creases", "Building the crease pattern", async () => {
      const lengths = lengthsOf(s);
      const result = await postJson("/api/creases", { ...base(s, lengths), pleatHeight: pleat });
      if (!result.built) { setStatus(`The crease pattern was not built: ${(result.messages ?? []).join(" ")}`, "error"); return null; }
      return {
        params: { pleatHeight: pleat },
        output: { ...s, creases: { result, lengths, pleatHeight: pleat } },
        notes: [`${result.creases.length} creases.` + (result.messages?.length ? " " + result.messages.join(" ") : "")],
      };
    });
  }

  /** The live step's controls for close, stub and creases, from its input. */
  function prepareLive() {
    const f = last();
    const s = f.input;
    document.body.dataset.stubbing = f.kind === "stub" && s?.layout ? "on" : "off";
    if (f.kind === "close") {
      q("closeValidNote").hidden = !s?.report?.valid;
      if (f.params?.strainMax != null && !f.params.auto) { q("docStrainMin").value = f.params.strainMin; q("docStrainMax").value = f.params.strainMax; }
    }
    if (f.kind === "creases") {
      q("docBuild").disabled = !s?.report?.valid;
      q("docBuildNote").textContent = s?.report?.valid ? `Builds in the ${s.closure?.completion?.after ? "closed" : "solver's"} lengths.` : "Needs valid polygons.";
      q("docPleatOn").checked = !!f.params?.pleatHeight;
      q("docPleatHeight").disabled = !f.params?.pleatHeight;
      if (f.params?.pleatHeight) q("docPleatHeight").value = f.params.pleatHeight;
    }
    if (f.kind === "stub" && s?.layout) {
      const now = f.output ?? s;   // each stub starts from the ones already added in this step
      stubTool.show({ ...now.layout, problem: now.problem, gridSize: now.problem.gridSize, edgeLengths: lengthsOf(now) }, now.report);
      const n = stubsOf(f.params).length;
      q("removeStub").hidden = !n;
      q("removeStub").textContent = n ? `Remove ${stubsOf(f.params).at(-1).name}` : "Remove the last stub";
      q("stubCount").textContent = n ? `${n} stub${n === 1 ? "" : "s"} added in this step: ${stubsOf(f.params).map((t) => t.name).join(", ")}.` : "No stubs added in this step yet.";
    }
  }

  // ───── Starting a session from a file ─────

  /** A layout file: a new session, its tree as step 1 and the opened layout as step 2 (live). */
  async function startFromLayout(problem, layout, name) {
    resetControls();
    const tree = emptyState(problem);
    const out = { ...emptyState(problem), layout: { node: "scalable", points: clone(layout.points), scale: layout.scale, edgeLengths: layout.edgeLengths ?? null, status: layout.status ?? "Imported" } };
    doc.name = "";
    doc.steps = [
      { kind: "tree", node: "tree", title: "", params: {}, input: null, output: tree, notes: [] },
      { kind: "solve", node: "scalable", title: "", params: { opened: name }, input: tree, output: out, notes: [`Opened the layout file ${name}.`] },
    ];
    save();
    try { out.report = await check(out); save(); } catch { /* not checked */ }
  }

  function saveFile() {
    const name = (q("docName").value || "session").trim();
    doc.name = name;
    save();
    const file = { format: "treemaker-session", version: 2, name, savedAt: new Date().toISOString(), steps: doc.steps };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[^\w.-]+/g, "-").toLowerCase() + ".session.json";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** A session file (files.js has checked its format): it becomes the document; version 1 gains its tree step. */
  function openFile(data, fileName) {
    if (!Array.isArray(data.steps) || !data.steps.length) throw new Error(`${fileName} has no steps.`);
    const d = data.version === 1 ? migrate(data) : data;
    resetControls();
    doc.name = d.name ?? fileName.replace(/\.json$/i, "");
    doc.steps = d.steps;
    save();
    const f = last();
    commit(f.output ?? f.input);
    go(f.node, true);
  }

  // ───── Each document stands alone ─────

  /** The settings controls as the page loads them: a new or opened document starts from these, not from another's. */
  let defaults = null;
  function captureDefaults() {
    defaults = [...document.querySelectorAll(".final-config input, .final-config select")].map((el) => [el, el.type === "checkbox" || el.type === "radio" ? el.checked : el.value]);
  }
  function resetControls() {
    for (const [el, v] of defaults ?? []) {
      if (el.type === "checkbox" || el.type === "radio") el.checked = v; else el.value = v;
    }
    for (const el of document.querySelectorAll(".final-config [data-touched]")) delete el.dataset.touched;
    if (typeof resetTreeLayout === "function") resetTreeLayout();
    treeUi.handPlaced = false;
  }

  /** On load: the kept document's live step goes back on the page. */
  function restore() {
    const f = last();
    commit(f.output ?? f.input);
  }

  /** A new, empty session: an empty tree, default settings, nothing from the document before. */
  function startOver() {
    if (running) return;
    resetControls();
    const blank = { edges: [], gridSize: Number(defaults?.find(([el]) => el.id === "gridSize")?.[1]) || 9, leafConditions: [], mirrorPairs: [] };
    doc.name = "";
    doc.steps = [{ kind: "tree", node: "tree", title: "", params: {}, input: null, output: emptyState(blank), notes: [] }];
    save();
    applyProblem(blank);
    workbench.setLayout(null);
    go("tree", true);
    setStatus("A new session: draw a tree, load a preset or open a file.");
  }

  function init() {
    for (const r of document.querySelectorAll('input[name="solveWhich"]')) r.addEventListener("change", () => {
      q("solveWarning").hidden = !document.querySelector('input[name="solveWhich"][value="all"]').checked;
      const f = last();
      if (f.kind === "solve") { f.params = { ...f.params, which: r.value }; save(); }
    });
    q("docAuto").addEventListener("click", () => runClose(true));
    q("docBounds").addEventListener("click", () => runClose(false));
    q("docBuild").addEventListener("click", runCreases);
    q("strainCancel").addEventListener("click", () => { strainStop = true; q("strainProgress").textContent = "Stopping after the closing solve now running…"; });
    q("removeStub").addEventListener("click", removeStub);
    q("stubEvery").addEventListener("click", stubEveryRegion);
    q("docPleatOn").addEventListener("change", () => { q("docPleatHeight").disabled = !q("docPleatOn").checked; });
    q("docSave").addEventListener("click", saveFile);
    q("docNew").addEventListener("click", startOver);
    q("docName").addEventListener("change", () => { doc.name = q("docName").value; save(); });
    stubTool.hooks.onAdd = addStub;
  }

  return {
    init, render, navigate, captureDefaults, restore, autoRun, prepareLive, treeEdited, adjustRequest, solved, startFromLayout, openFile, startOver,
    get steps() { return doc.steps; }, get running() { return !!running; }, last, current,
  };
})();
