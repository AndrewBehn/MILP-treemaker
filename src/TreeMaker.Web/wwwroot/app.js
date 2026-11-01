// TreeMaker: one app for every spec. Plain JS, no dependencies; talks to the in-process ASP.NET Core API.
//   #/            the map (map.js): every spec and step; pick one
//   #/<node>      the workspace for that node (nodes.js): a solver, the tree, or a step after a solve
// The tree editor, the sheet and the crease panel are shared by every node; what a solver sends and shows comes from
// solvers.js. What carries over between nodes is on the workbench (workbench.js).
"use strict";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

const CONDITION_KINDS = [
  ["", "—"],
  ["LeftEdge", "Left edge (x = 0)"],
  ["RightEdge", "Right edge (x = N)"],
  ["BottomEdge", "Bottom edge (y = 0)"],
  ["TopEdge", "Top edge (y = N)"],
  ["BottomLeftCorner", "Corner (0, 0)"],
  ["BottomRightCorner", "Corner (N, 0)"],
  ["TopLeftCorner", "Corner (0, N)"],
  ["TopRightCorner", "Corner (N, N)"],
  ["OnSymmetryAxis", "Symmetry axis (2x = N)"],
  ["Fixed", "Fixed point (x, y)"],
];

/** A simple centipede: p backbone nodes in a row, each with a pair of equal legs. */
function centipedeTree(pairs, leg = 1, segment = 1) {
  const edges = [];
  for (let k = 1; k <= pairs; k++) {
    edges.push([`L${k}`, `b${k}`, leg], [`R${k}`, `b${k}`, leg]);
    if (k > 1) edges.push([`b${k - 1}`, `b${k}`, segment]);
  }
  return edges;
}

const PRESETS = {
  star4: [["1", "c", 1], ["2", "c", 1], ["3", "c", 1], ["4", "c", 1]],
  star5: [["1", "c", 1], ["2", "c", 1], ["3", "c", 1], ["4", "c", 1], ["5", "c", 1]],
  bird: [["1", "a", 1], ["2", "a", 1], ["a", "b", 1], ["3", "b", 1], ["4", "b", 1], ["b", "c", 1], ["5", "c", 1], ["6", "c", 1]],
  caterpillar: [["1", "a", 1], ["2", "a", 2], ["a", "b", 1], ["3", "b", 1.5], ["b", "c", 1], ["4", "c", 1], ["5", "c", 2], ["c", "6", 1]],
  // Simple centipedes: pairs of legs along one backbone (3 pairs is the bird preset).
  centipede2: centipedeTree(2),
  centipede4: centipedeTree(4),
  centipede5: centipedeTree(5),
  centipede6: centipedeTree(6),
  centipede8: centipedeTree(8),
  // Larger, origami-style trees (10 to 30 nodes). Leaf names say which flap they are.
  beetle: [
    ["antL", "hd", 2], ["antR", "hd", 2], ["hd", "t1", 1],
    ["L1", "t1", 2], ["R1", "t1", 2], ["t1", "t2", 1],
    ["L2", "t2", 2], ["R2", "t2", 2], ["t2", "t3", 1],
    ["L3", "t3", 2], ["R3", "t3", 2], ["t3", "abd", 2],
  ],
  deer: [
    ["hd", "an1", 1], ["an1", "t1", 1], ["an1", "t2", 1], ["hd", "an2", 1], ["an2", "t3", 1], ["an2", "t4", 1],
    ["earL", "hd", 1], ["earR", "hd", 1], ["snt", "hd", 1], ["hd", "sh", 2],
    ["FL", "sh", 3], ["FR", "sh", 3], ["sh", "hp", 3],
    ["HL", "hp", 3], ["HR", "hp", 3], ["tail", "hp", 1],
  ],
  dragon: [
    ["hnL", "hd", 1], ["hnR", "hd", 1], ["snt", "hd", 1], ["hd", "nk", 2],
    ["nk", "wL", 1], ["wL", "wL1", 3], ["wL", "wL2", 2.5], ["wL", "wL3", 2],
    ["nk", "wR", 1], ["wR", "wR1", 3], ["wR", "wR2", 2.5], ["wR", "wR3", 2],
    ["FL", "nk", 2], ["FR", "nk", 2], ["nk", "hip", 3],
    ["HL", "hip", 2.5], ["HR", "hip", 2.5], ["tail", "hip", 4],
  ],
  scorpion: [
    ["c1", "pL", 2], ["pL", "pL1", 1], ["pL", "pL2", 1], ["c1", "pR", 2], ["pR", "pR1", 1], ["pR", "pR2", 1],
    ["c1", "c2", 0.5], ["L1", "c2", 2], ["R1", "c2", 2], ["c2", "c3", 0.5], ["L2", "c3", 2], ["R2", "c3", 2],
    ["c3", "c4", 0.5], ["L3", "c4", 2], ["R3", "c4", 2], ["c4", "c5", 0.5], ["L4", "c5", 2], ["R4", "c5", 2],
    ["c5", "s1", 1], ["s1", "s2", 1], ["s2", "s3", 1], ["s3", "stg", 1],
  ],
  centipede: [
    ["antL", "g1", 2], ["antR", "g1", 2],
    ["L1", "g1", 1.5], ["R1", "g1", 1.5], ["g1", "g2", 0.5], ["L2", "g2", 1.5], ["R2", "g2", 1.5], ["g2", "g3", 0.5],
    ["L3", "g3", 1.5], ["R3", "g3", 1.5], ["g3", "g4", 0.5], ["L4", "g4", 1.5], ["R4", "g4", 1.5], ["g4", "g5", 0.5],
    ["L5", "g5", 1.5], ["R5", "g5", 1.5], ["g5", "g6", 0.5], ["L6", "g6", 1.5], ["R6", "g6", 1.5], ["g6", "g7", 0.5],
    ["L7", "g7", 1.5], ["R7", "g7", 1.5], ["cL", "g7", 2], ["cR", "g7", 2],
  ],
};

/**
 * The symmetry each bilateral preset is folded with (Pure MILP spec, Sections 7.3 and 7.4): its left–right mirror
 * pairs, and the unpaired flaps (head, tail, stinger) that lie on the mirror line. Every pair has equal edge lengths
 * in the preset, and every preset with axis leaves has an even grid size, as the axis condition needs.
 */
const PRESET_SYMMETRY = {
  bird: { pairs: [["1", "2"], ["3", "4"], ["5", "6"]] },
  beetle: { pairs: [["antL", "antR"], ["L1", "R1"], ["L2", "R2"], ["L3", "R3"]], axis: ["abd"] },
  deer: { pairs: [["earL", "earR"], ["t1", "t3"], ["t2", "t4"], ["FL", "FR"], ["HL", "HR"]], axis: ["snt", "tail"] },
  dragon: {
    pairs: [["hnL", "hnR"], ["wL1", "wR1"], ["wL2", "wR2"], ["wL3", "wR3"], ["FL", "FR"], ["HL", "HR"]],
    axis: ["snt", "tail"],
  },
  scorpion: {
    pairs: [["pL1", "pR1"], ["pL2", "pR2"], ["L1", "R1"], ["L2", "R2"], ["L3", "R3"], ["L4", "R4"]],
    axis: ["stg"],
  },
};

/** A preset's mirror pairs and leaf conditions: the table above, or for the centipedes Lk ↔ Rk, antennae and cerci. */
function presetSymmetry(value, edges) {
  const leaves = new Set(treeInfo(edges.map(([from, to, length]) => ({ from, to, length }))).leaves);
  const known = PRESET_SYMMETRY[value];
  if (known) {
    return {
      mirrors: known.pairs.filter(([a, b]) => leaves.has(a) && leaves.has(b)).map(([a, b]) => ({ a, b })),
      conditions: Object.fromEntries((known.axis ?? []).filter((l) => leaves.has(l)).map((l) => [l, { kind: "OnSymmetryAxis", x: "", y: "" }])),
    };
  }
  if (!value.startsWith("centipede")) return { mirrors: [], conditions: {} };
  const mirrors = [];
  for (const leaf of leaves) {
    const m = /^L(\d+)$/.exec(leaf);
    if (m && leaves.has("R" + m[1])) mirrors.push({ a: leaf, b: "R" + m[1] });
  }
  for (const [a, b] of [["antL", "antR"], ["cL", "cR"]]) if (leaves.has(a) && leaves.has(b)) mirrors.push({ a, b });
  return { mirrors, conditions: {} };
}

/** Each preset's grid size: the largest tested N at which every solver it is enabled in solves it within 60 s. */
const PRESET_GRID = {
  example: 8, star4: 6, star5: 16, bird: 8, caterpillar: 10,
  centipede2: 12, centipede4: 12, centipede5: 8, centipede6: 8, centipede8: 13,
  beetle: 12, deer: 12, dragon: 14, scorpion: 14, centipede: 16,
};

const state = {
  node: null,           // the current map node (nodes.js), or null on the map
  edges: [],            // { from, to, length, stretch }
  conditions: {},       // leaf -> { kind, x, y }
  mirrors: [],          // { a, b }
  lastResponse: null,   // the shown solver response (the solver's own shape)
  lastRequest: null,
  lastView: null,       // its normalized form: { status, layout, scale, pairs, edgeLengths, violations, messages }
  solving: null,        // { node } while a solve runs
  viewSeq: 0,           // bumped whenever the workspace changes, so late answers for an old view are dropped
  randomSeed: 1,
  hullPair: null,
};

const solver = () => (state.node?.kind === "solver" ? SOLVERS[state.node.api] : null);

// ───────────────────────── Tree structure (client side, for the editor) ─────────────────────────

function treeInfo(edges) {
  const adjacency = new Map();
  const add = (u, v, i) => {
    if (!adjacency.has(u)) adjacency.set(u, []);
    adjacency.get(u).push({ to: v, edge: i });
  };
  edges.forEach((e, i) => {
    const u = String(e.from).trim(), v = String(e.to).trim();
    if (!u || !v) return;
    add(u, v, i);
    add(v, u, i);
  });
  const vertices = [...adjacency.keys()];
  const leaves = vertices.filter((v) => adjacency.get(v).length === 1).sort(naturalCompare);
  const internal = vertices.filter((v) => adjacency.get(v).length !== 1).sort(naturalCompare);
  return { adjacency, vertices, leaves, internal };
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isTree(info, edges) {
  if (info.vertices.length !== edges.length + 1) return false;
  const seen = new Set([info.vertices[0]]);
  const stack = [info.vertices[0]];
  while (stack.length) {
    const v = stack.pop();
    for (const { to } of info.adjacency.get(v)) {
      if (!seen.has(to)) { seen.add(to); stack.push(to); }
    }
  }
  return seen.size === info.vertices.length;
}

function treeCentre(info) {
  // Repeatedly strip leaves; what remains last is the centre.
  const degree = new Map(info.vertices.map((v) => [v, info.adjacency.get(v).length]));
  let layer = info.vertices.filter((v) => degree.get(v) <= 1);
  let remaining = info.vertices.length;
  while (remaining > 2) {
    remaining -= layer.length;
    const next = [];
    for (const v of layer) {
      for (const { to } of info.adjacency.get(v)) {
        degree.set(to, degree.get(to) - 1);
        if (degree.get(to) === 1) next.push(to);
      }
    }
    layer = next;
  }
  return layer[0] ?? info.vertices[0];
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// ───────────────────────── Requests ─────────────────────────

function numberOrNull(id) {
  const raw = $(id).value.trim();
  if (raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function toIntOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** The tree in the editor, with its grid, conditions and mirror pairs: what every solver reads. */
function buildProblem() {
  const info = treeInfo(state.edges);
  const leafSet = new Set(info.leaves);
  const conditions = Object.entries(state.conditions)
    .filter(([leaf, c]) => c.kind && leafSet.has(leaf))
    .map(([leaf, c]) => ({
      leaf,
      kind: c.kind,
      x: c.kind === "Fixed" ? toIntOrNull(c.x) : null,
      y: c.kind === "Fixed" ? toIntOrNull(c.y) : null,
    }));
  return {
    edges: state.edges.map((e) => ({ from: String(e.from).trim(), to: String(e.to).trim(), length: Number(e.length), stretch: !!e.stretch })),
    gridSize: Math.round(numberOrNull("gridSize") ?? 9),
    leafConditions: conditions,
    mirrorPairs: state.mirrors.filter((m) => leafSet.has(m.a) && leafSet.has(m.b)),
  };
}

/** The current solver's request: the problem, the workbench layout to start from, and the solver's own options. */
function buildRequest() {
  const problem = buildProblem();
  const s = solver();
  return {
    ...problem,
    startLayout: currentStart(problem),
    timeLimitSeconds: numberOrNull("timeLimit"),
    threads: numberOrNull("threads"),
    ...(s ? s.options(state.node) : {}),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    const message = data?.error ?? data?.detail ?? data?.title ?? `${response.status} ${response.statusText}`;
    const errors = data?.errors ? "\n" + Object.values(data.errors).flat().join("\n") : "";
    throw new Error(message + errors);
  }
  return data;
}

// ───────────────────────── Editor rendering ─────────────────────────

function renderEdges() {
  const body = $("edgeRows");
  body.replaceChildren();
  state.edges.forEach((edge, i) => {
    const tr = document.createElement("tr");
    tr.append(
      cell(textInput(edge.from, (v) => { edge.from = v; changed({ structure: true }); }, "from")),
      cell(textInput(edge.to, (v) => { edge.to = v; changed({ structure: true }); }, "to")),
      cell(numberInput(edge.length, (v) => { edge.length = v; changed(); })),
      cell(checkbox(edge.stretch, (v) => { edge.stretch = v; changed(); }, "In stretch set S")),
      cell(button("×", () => { state.edges.splice(i, 1); renderEdges(); changed({ structure: true }); }, "Remove edge", "icon")),
    );
    body.append(tr);
  });
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function textInput(value, onChange, label) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function numberInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.value = value;
  input.setAttribute("aria-label", "length");
  input.addEventListener("input", () => {
    const v = Number(input.value);
    input.classList.toggle("invalid", !(v > 0));
    onChange(input.value);
  });
  return input;
}

function checkbox(checked, onChange, title) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.title = title;
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function button(text, onClick, title, className) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (title) b.title = title;
  if (className) b.className = className;
  b.addEventListener("click", onClick);
  return b;
}

function renderLeafControls() {
  const info = treeInfo(state.edges);

  // Leaf conditions table.
  const body = $("conditionRows");
  body.replaceChildren();
  for (const leaf of info.leaves) {
    const c = state.conditions[leaf] ?? (state.conditions[leaf] = { kind: "", x: "", y: "" });
    const tr = document.createElement("tr");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Condition for leaf ${leaf}`);
    for (const [value, label] of CONDITION_KINDS) select.append(new Option(label, value));
    select.value = c.kind;
    const x = document.createElement("input");
    const y = document.createElement("input");
    for (const [input, key] of [[x, "x"], [y, "y"]]) {
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = c[key];
      input.disabled = c.kind !== "Fixed";
      input.setAttribute("aria-label", `${key} for leaf ${leaf}`);
      input.addEventListener("input", () => { c[key] = input.value; changed(); });
    }
    select.addEventListener("change", () => {
      c.kind = select.value;
      x.disabled = y.disabled = c.kind !== "Fixed";
      changed();
    });
    const name = document.createElement("td");
    name.textContent = leaf;
    tr.append(name, cell(select), cell(x), cell(y));
    body.append(tr);
  }

  // Mirror pair selectors and chips.
  for (const id of ["mirrorA", "mirrorB"]) {
    const select = $(id);
    const keep = select.value;
    select.replaceChildren(...info.leaves.map((l) => new Option(l, l)));
    if (info.leaves.includes(keep)) select.value = keep;
  }
  if ($("mirrorA").value === $("mirrorB").value && info.leaves.length > 1) {
    $("mirrorB").value = info.leaves.find((l) => l !== $("mirrorA").value);
  }
  const leafSet = new Set(info.leaves);
  state.mirrors = state.mirrors.filter((m) => leafSet.has(m.a) && leafSet.has(m.b));
  const list = $("mirrorRows");
  list.replaceChildren();
  state.mirrors.forEach((m, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(`${m.a} ↔ ${m.b}`, button("×", () => { state.mirrors.splice(i, 1); renderLeafControls(); changed(); }, "Remove pair"));
    list.append(chip);
  });
  if (!state.mirrors.length) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "None";
    list.append(none);
  }

  // Parent selector for "Add leaf to".
  const parent = $("leafParent");
  const keepParent = parent.value;
  const vertices = [...info.internal, ...info.leaves];
  parent.replaceChildren(...vertices.map((v) => new Option(v, v)));
  if (vertices.includes(keepParent)) parent.value = keepParent;
}

// ───────────────────────── Analysis (before solving) ─────────────────────────

let analyzeTimer = null;
let analyzeSeq = 0;

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(analyze, 250);
}

async function analyze() {
  const seq = ++analyzeSeq;
  const err = $("analysisError");
  const s = solver();
  if (!s) {
    renderTreeStats();
    err.hidden = true;
    return;
  }
  const node = state.node;
  try {
    const request = buildRequest();
    const a = await postJson(`/api/${node.api}/analyze`, request);
    if (seq !== analyzeSeq || state.node !== node) return;
    err.hidden = true;
    s.renderAnalysis(a, request);
  } catch (e) {
    if (seq !== analyzeSeq) return;
    $("analysis").replaceChildren();
    $("sizeBreakdown").classList.add("stale");
    err.hidden = false;
    err.textContent = e.message;
  }
}

/** The toolbar for the tree and the steps: what is known without a solver. */
function renderTreeStats() {
  const p = state.node?.kind === "step" && workbench.layout ? workbench.layout.problem : buildProblem();
  const info = treeInfo(p.edges);
  const n = info.leaves.length;
  const stats = [
    stat("Leaves", n.toLocaleString(), `${(n * (n - 1) / 2).toLocaleString()} pairs`),
    stat("Edges", p.edges.length.toLocaleString()),
    stat("Grid", `${p.gridSize} × ${p.gridSize}`),
  ];
  if (state.node?.kind === "step" && workbench.layout) stats.push(stat("Scale m", fmt(workbench.layout.scale, 4), "workbench layout"));
  $("analysis").replaceChildren(...stats);
}

function stat(label, value, note) {
  const d = document.createElement("div");
  d.className = "stat";
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = label;
  const v = document.createElement("div");
  v.className = "v";
  v.textContent = value;
  if (note) {
    const s = document.createElement("small");
    s.textContent = " " + note;
    v.append(s);
  }
  d.append(k, v);
  return d;
}

// ───────────────────────── Solve ─────────────────────────

async function solve() {
  const s = solver();
  if (!s || state.solving) return;
  const node = state.node;
  const request = buildRequest();
  clearResults({ solving: true });
  const seq = state.viewSeq;
  state.solving = { node };
  setSolving(true);
  setStatus("Solving…", "running");
  const started = performance.now();
  const ticker = setInterval(() => {
    setStatus(`Solving with ${node.title}… ${((performance.now() - started) / 1000).toFixed(1)} s`, "running");
  }, 200);
  try {
    const response = await postJson(`/api/${node.api}/solve`, request);
    if (s.isCancelled(response)) {
      setStatus("Cancelled");
      return;
    }
    const view = s.normalize(response);
    // The result goes on the workbench even if you have moved to another node meanwhile.
    if (view.layout.length) {
      workbench.setLayout({
        node: node.id, problem: buildProblemFrom(request), gridSize: request.gridSize,
        points: view.layout.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })), scale: view.scale,
        edgeLengths: view.edgeLengths.length ? view.edgeLengths.map((e) => e.newLength) : null,
        status: view.status, polygonsValid: view.polygonsValid,
      });
    }
    if (state.node === node && state.viewSeq === seq) {
      showResponse(response, request, true);
      setStatus(s.statusText(response));
    } else {
      setStatus(`${node.title}: ${s.statusText(response)}. The layout is on the workbench.`);
    }
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  } finally {
    clearInterval(ticker);
    restoreEmptySheet();
    state.solving = null;
    setSolving(false);
  }
}

/** The problem part of a solver request (what the steps after it need), without the solver's options. */
function buildProblemFrom(request) {
  return { edges: request.edges, gridSize: request.gridSize, leafConditions: request.leafConditions, mirrorPairs: request.mirrorPairs };
}

const ALL_CARDS = ["metricsCard", "pairsCard", "traceCard", "hullCard", "edgesCard", "pickCard", "needCard"];
const ALL_PANES = ["metrics", "messages", "pairsTable", "traceTable", "roundTable", "ladder", "hullView", "hullPair", "hullNote", "edgesTable"];

/** Removes everything an earlier solve or node left on the page (sheet, polygons, creases, folded base, tables). */
function clearResults({ solving = false } = {}) {
  state.viewSeq++;
  stubTool.hide();
  state.lastResponse = null;
  state.lastView = null;
  creaseReadiness.update(null);
  foldedView.hide();
  $("layoutView").replaceChildren();
  const empty = $("emptySheet");
  const [lead, sub] = empty.querySelectorAll("p");
  empty.dataset.lead ??= lead.textContent;
  empty.dataset.sub ??= sub.textContent;
  if (solving) {
    lead.textContent = "Solving…";
    sub.textContent = "The new layout lands here.";
  } else {
    lead.textContent = empty.dataset.lead;
    sub.textContent = empty.dataset.sub;
  }
  empty.hidden = false;
  for (const id of ALL_CARDS) { const card = $(id); if (card) card.hidden = true; }
  for (const id of ALL_PANES) $(id)?.replaceChildren();
  $("nextBar").hidden = true;
}

/** Puts the empty sheet's own words back once the solve has finished. */
function restoreEmptySheet() {
  const empty = $("emptySheet");
  const [lead, sub] = empty.querySelectorAll("p");
  if (empty.dataset.lead) lead.textContent = empty.dataset.lead;
  if (empty.dataset.sub) sub.textContent = empty.dataset.sub;
}

async function cancel() {
  try {
    await postJson("/api/cancel");
    setStatus("Interrupting…", "running");
  } catch (e) {
    setStatus("Cancel failed: " + e.message, "error");
  }
}

function setSolving(on) {
  $("solve").disabled = on;
  $("cancel").disabled = !on;
}

function setStatus(text, kind) {
  const s = $("status");
  s.textContent = text;
  s.className = "status" + (kind ? " " + kind : "");
  s.style.color = kind === "error" ? "var(--bad)" : "";
}

// ───────────────────────── Result rendering ─────────────────────────

/** Shows a solver's response (a fresh solve, or the workbench layout read back by that solver's /layout). */
function showResponse(response, request, fresh, held) {
  const s = solver();
  state.lastResponse = response;
  state.lastRequest = request;
  state.lastView = s.normalize(response);
  renderResult(fresh);
  const v = state.lastView;
  const context = v.layout.length && v.scale > 0 ? {
    problem: buildProblemFrom(request), gridSize: request.gridSize, layout: v.layout, scale: v.scale,
    edgeLengths: v.edgeLengths.length ? v.edgeLengths.map((e) => e.newLength) : null,
  } : null;
  if (held) creaseReadiness.restore(context, held); else creaseReadiness.update(context);
  creaseReadiness.focus("all");
  renderNextBar();
}

function renderResult(fresh = false) {
  const s = solver();
  const r = state.lastResponse;
  const v = state.lastView;
  if (!r || !v || !s) return;
  $("metricsCard").hidden = false;
  $("emptySheet").hidden = !!v.layout.length;
  $("pairsCard").hidden = !v.pairs.length;
  renderLayout(v, state.lastRequest);
  creaseReadiness.draw();
  animateSheet(fresh);
  s.renderMetrics(r, state.lastRequest);
  renderMessages(v);
  renderPairs(v);
  s.renderExtras(r, state.lastRequest, fresh);
}

function animateSheet(fresh) {
  const sheet = document.querySelector(".sheet");
  sheet.classList.remove("fresh");
  if (fresh === true) {
    void sheet.offsetWidth;   // restart the animation
    sheet.classList.add("fresh");
  }
}

function renderLayout(r, request) {
  const svg = $("layoutView");
  svg.replaceChildren();
  if (!r.layout || !r.layout.length) return;
  const N = request.gridSize;
  const size = 600, pad = 40;
  const unit = (size - 2 * pad) / N;
  const X = (x) => pad + x * unit;
  const Y = (y) => size - pad - y * unit;   // y up, as in the specs
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  // Clip circles to the square, as TreeMaker draws them.
  const defs = el("defs");
  const clip = el("clipPath", { id: "square" });
  clip.append(el("rect", { x: X(0), y: Y(N), width: N * unit, height: N * unit }));
  defs.append(clip);
  svg.append(defs);

  for (let k = 0; k <= N; k++) {
    svg.append(el("line", { x1: X(k), y1: Y(0), x2: X(k), y2: Y(N), class: "grid-line" }));
    svg.append(el("line", { x1: X(0), y1: Y(k), x2: X(N), y2: Y(k), class: "grid-line" }));
    const step = N > 24 ? 5 : N > 12 ? 2 : 1;
    if (k % step === 0 || k === N) {
      const tx = el("text", { x: X(k), y: Y(0) + 16, "text-anchor": "middle", class: "axis-label" });
      tx.textContent = k;
      const ty = el("text", { x: X(0) - 8, y: Y(k) + 3, "text-anchor": "end", class: "axis-label" });
      ty.textContent = k;
      svg.append(tx, ty);
    }
  }
  svg.append(el("rect", { x: X(0), y: Y(N), width: N * unit, height: N * unit, class: "grid-border" }));
  if (N % 2 === 0 && ((request.mirrorPairs ?? []).length || (request.leafConditions ?? []).some((c) => c.kind === "OnSymmetryAxis"))) {
    svg.append(el("line", { x1: X(N / 2), y1: Y(0), x2: X(N / 2), y2: Y(N), class: "sym-axis" }));
  }

  const position = new Map(r.layout.map((p) => [p.leaf, p]));

  // Leaf circles: radius m × (current) length of the leaf's edge.
  if ($("showCircles").checked && r.scale > 0) {
    const g = el("g", { "clip-path": "url(#square)" });
    const lengths = new Map((r.edgeLengths ?? []).map((e) => [e.edge, e.newLength]));
    request.edges.forEach((e, i) => {
      for (const leaf of [e.from, e.to]) {
        const p = position.get(leaf);
        if (!p) continue;
        const length = lengths.get(i) ?? e.length;
        g.append(el("circle", { cx: X(p.x), cy: Y(p.y), r: r.scale * length * unit, class: "leaf-circle" }));
      }
    });
    svg.append(g);
  }

  const showAll = $("showAllPairs").checked;
  const pairs = [...(r.pairs ?? [])].sort((a, b) => Number(a.tight) - Number(b.tight));
  for (const p of pairs) {
    if (!p.tight && !showAll) continue;
    const a = position.get(p.a), b = position.get(p.b);
    if (!a || !b) continue;
    const line = el("line", { x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y), class: "pair " + (p.tight ? "tight" : "loose") });
    line.style.setProperty("--len", Math.hypot(X(a.x) - X(b.x), Y(a.y) - Y(b.y)).toFixed(1));
    const title = el("title");
    title.textContent = `${p.a}–${p.b}: D = ${fmt(p.distance, 4)}, required ${fmt(p.required, 4)}, slack ${fmt(p.slack, 4)}`;
    line.append(title);
    svg.append(line);
  }

  r.layout.forEach((p, i) => {
    const dot = el("circle", { cx: X(p.x), cy: Y(p.y), r: 7, class: "leaf", style: `--i:${i}` });
    const title = el("title");
    title.textContent = `${p.leaf} at (${p.x}, ${p.y})`;
    dot.append(title);
    // Keep labels inside the sheet: flip them toward the centre near the right or top edge.
    const right = p.x > N * 0.85, top = p.y > N * 0.9;
    const label = el("text", {
      x: X(p.x) + (right ? -11 : 11), y: Y(p.y) + (top ? 20 : -11),
      "text-anchor": right ? "end" : "start", class: "leaf-label", style: `--i:${i}`,
    });
    label.textContent = p.leaf;
    svg.append(dot, label);
  });
}

function renderMessages(v) {
  const messages = $("messages");
  messages.replaceChildren();
  if (v.messages?.length) {
    const ul = document.createElement("ul");
    ul.className = "messages";
    for (const text of v.messages) { const li = document.createElement("li"); li.textContent = text; ul.append(li); }
    messages.append(ul);
  }
  if (v.layout?.length) {
    if (v.violations?.length) {
      const ul = document.createElement("ul");
      ul.className = "violations";
      for (const text of v.violations) { const li = document.createElement("li"); li.textContent = text; ul.append(li); }
      messages.append(ul);
    } else {
      const ok = document.createElement("div");
      ok.className = "ok";
      ok.textContent = "Rechecked with exact distances: every pair and condition holds.";
      messages.append(ok);
    }
  }
}

/** "00:00:01.2345678" → milliseconds. */
function timeSpanMs(span) {
  if (typeof span === "number") return span;
  if (!span) return 0;
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(span);
  if (!m) return 0;
  return (((Number(m[1] ?? 0) * 24 + Number(m[2])) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000;
}

function group(title, rows) {
  const d = document.createElement("div");
  d.className = "metric-group";
  const h = document.createElement("h3");
  h.textContent = title;
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    if (v instanceof Node) dd.append(v); else dd.textContent = v ?? "—";
    dl.append(dt, dd);
  }
  d.append(h, dl);
  return d;
}

function badge(status) {
  const b = document.createElement("span");
  b.className = "badge " + status;
  b.textContent = status;
  return b;
}

function renderPairs(r) {
  const table = $("pairsTable");
  table.replaceChildren(headRow(["Pair", "ℓᵢⱼ", "ℓ used", "δ", "D(δ)", "m·ℓ", "Slack", "Tight"]));
  const pairs = [...(r.pairs ?? [])].sort((a, b) => a.slack - b.slack).slice(0, 300);
  $("pairsNote").textContent = (r.pairs?.length ?? 0) > pairs.length
    ? `the ${pairs.length} tightest of ${r.pairs.length.toLocaleString()}`
    : "tightest first";
  for (const p of pairs) {
    table.append(dataRow([`${p.a}–${p.b}`, fmt(p.pathLength, 4), fmt(p.effectiveLength, 4), `(${p.dx}, ${p.dy})`,
      fmt(p.distance, 4), fmt(p.required, 4), fmt(p.slack, 4), p.tight ? "●" : ""], p.tight ? "tight" : ""));
  }
}

// ───────────────────────── Formatting ─────────────────────────

function fmt(v, digits = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  const out = String(parseFloat(Number(v).toFixed(digits)));
  return out === "-0" ? "0" : out;
}

function fmtSigned(v, digits) {
  if (v === null || v === undefined) return "—";
  const s = fmt(Math.abs(v), digits);
  return v < 0 && s !== "0" ? "−" + s : (v > 0 && s !== "0" ? "+" + s : "0");
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function int(v) {
  return v === null || v === undefined ? "—" : Number(v).toLocaleString();
}

// ───────────────────────── Editing and the workbench tree ─────────────────────────

function changed({ structure = false } = {}) {
  if (structure) renderLeafControls();
  renderTreePreview();
  workbench.setTree(buildProblem());
  renderShelf();
  updateStartRow();
  scheduleAnalyze();
}

/** Replaces every edge's length (by edge index), e.g. with the lengths found by closing the polygons. */
function applyEdgeLengths(lengths) {
  lengths.forEach((l, k) => {
    if (state.edges[k]) state.edges[k].length = String(parseFloat(Number(l).toFixed(6)));
  });
  renderEdges();
  changed();
  setStatus("New edge lengths copied into the tree. Solve again.");
}

function loadEdges(edges) {
  resetTreeLayout();
  state.edges = edges.map((e) => Array.isArray(e)
    ? { from: e[0], to: e[1], length: e[2], stretch: false }
    : { from: e.from, to: e.to, length: e.length, stretch: !!e.stretch });
  state.conditions = {};
  state.mirrors = [];
  renderEdges();
  changed({ structure: true });
}

function applyProblem(p) {
  loadEdges(p.edges ?? []);
  $("gridSize").value = p.gridSize ?? 9;
  for (const c of p.leafConditions ?? []) state.conditions[c.leaf] = { kind: c.kind, x: c.x ?? "", y: c.y ?? "" };
  state.mirrors = (p.mirrorPairs ?? []).map((m) => ({ a: m.a, b: m.b }));
  if (state.mirrors.length) resetTreeLayout();
  if (p.targetScale != null) $("targetScale").value = p.targetScale;
  renderLeafControls();
  changed();
}

function nextName(info, prefix) {
  for (let k = 1; ; k++) {
    const name = prefix + k;
    if (!info.adjacency.has(name)) return name;
  }
}

// ───────────────────────── Starting from the workbench ─────────────────────────

/** The workbench layout to start the next solve from, when it fits the tree and grid in the editor. */
function currentStart(problem) {
  const held = workbench.layout;
  if (!held || state.node?.kind !== "solver") return null;
  return sameTreeShape(held.problem, problem) && $("useStart").checked ? held.points : null;
}

function updateStartRow() {
  const held = workbench.layout;
  const row = $("startRow");
  row.hidden = !held || state.node?.kind !== "solver";
  if (row.hidden) return;
  const fits = sameTreeShape(held.problem, buildProblem());
  const from = held.node === state.node.id ? "" : ` (from ${NODES[held.node]?.title ?? "a file"})`;
  $("startNote").textContent = fits ? from : " (it was made for a different tree or grid, so it is not used)";
  $("useStart").disabled = !fits;
}

/** Reads a layout back through an API's /layout, which checks it and returns that solver's result shape. */
async function evaluateLayout(api, problem, held) {
  const lengths = held.edgeLengths
    ?? (held.problem.edges.some((e, k) => Number(e.length) !== Number(problem.edges[k]?.length)) ? held.problem.edges.map((e) => Number(e.length)) : null);
  return postJson(`/api/${api}/layout`, { problem: { ...problem, startLayout: null }, layout: held.points, scale: held.scale, edgeLengths: lengths });
}

/** What polygons.js needs to restore the workbench's closure and crease pattern. */
function heldSteps() {
  const c = workbench.closure, k = workbench.creases;
  return { completion: c?.completion ?? null, strainMin: c?.strainMin, strainMax: c?.strainMax, creases: k ?? null };
}

/** On a solver node: show the workbench layout as if just solved, when it fits the editor's tree. */
async function showHeldOnSolver() {
  const held = workbench.layout;
  updateStartRow();
  if (!held) return;
  const request = buildRequest();
  if (!sameTreeShape(held.problem, request)) return;
  const seq = state.viewSeq, node = state.node;
  try {
    const response = await evaluateLayout(node.api, request, held);
    if (seq !== state.viewSeq || node !== state.node) return;
    showResponse(response, request, false, heldSteps());
    const from = NODES[held.node]?.title ?? "a layout file";
    setStatus(held.node === node.id ? "The workbench layout from this solver." : `Showing the workbench layout from ${from}; the next solve starts from it.`);
  } catch (e) {
    if (seq === state.viewSeq) { console.error(e.stack); setStatus("Could not show the workbench layout: " + e.message, "error"); }
  }
}

/** Opening a layout file: check it, put it on the workbench, and show it where you are. */
async function importLayout({ points, scale, edgeLengths, name, solvedBy }) {
  const problem = buildProblem();
  const response = await postJson("/api/pure/layout", { problem: { ...problem, startLayout: null }, layout: points, scale, edgeLengths });
  const v = SOLVERS.pure.normalize(response);
  workbench.setLayout({
    node: "file", note: name, problem, gridSize: problem.gridSize, points, scale: v.scale,
    edgeLengths: edgeLengths ?? null, status: "Imported" + (solvedBy ? ` (solved by ${solvedBy})` : ""),
  });
  setStatus(`Opened ${name}: the layout is on the workbench, ready for the steps after a solve and as the start of the next solve.`);
  if (state.node) enterNode(state.node.id);
}

// ───────────────────────── Steps after a solve ─────────────────────────

function showNeed(title, text, actions) {
  $("needCard").hidden = false;
  $("needTitle").textContent = title;
  $("needText").textContent = text;
  $("needActions").replaceChildren(...actions.map(([label, href, primary]) => {
    const a = document.createElement("a");
    a.href = href;
    a.className = primary ? "bench-go" : "quiet-link";
    a.textContent = label;
    return a;
  }));
}

async function showStep(node) {
  const held = workbench.layout;
  const summary = $("heldSummary");
  renderHeldSummary(summary);
  $("stageArea").hidden = false;
  if (!held) {
    $("stageArea").hidden = true;
    showNeed("No layout on the workbench yet", "Every step after a solve starts from a layout. Solve the tree with one of the layout solvers, or open a layout file.",
      [["Pick a solver on the map", "#/", true], ["Edit the tree", "#/tree"]]);
    return;
  }
  if (node.id === "creases" && !workbench.polygonsValid()) {
    showNeed("The polygons are not closed yet", "The crease pattern fills valid polygons. Close the workbench layout's polygons first.",
      [["Close the polygons", "#/close", true]]);
  }
  if (node.id === "fold" && !workbench.creases?.result?.built) {
    showNeed("No crease pattern yet", "The folded base comes from a crease pattern. Build one first.",
      [[workbench.polygonsValid() ? "Build the crease pattern" : "Close the polygons", workbench.polygonsValid() ? "#/creases" : "#/close", true]]);
  }
  const seq = state.viewSeq;
  try {
    const response = await evaluateLayout("pure", { ...held.problem, startLayout: null }, { ...held, edgeLengths: held.edgeLengths });
    if (seq !== state.viewSeq) return;
    const v = SOLVERS.pure.normalize(response);
    state.lastView = v;
    state.lastRequest = held.problem;
    $("emptySheet").hidden = !!v.layout.length;
    $("metricsCard").hidden = false;
    $("pairsCard").hidden = !v.pairs.length;
    renderLayout(v, held.problem);
    renderHeldMetrics(held, v);
    renderMessages(v);
    renderPairs(v);
    const context = { problem: held.problem, gridSize: held.gridSize, layout: v.layout, scale: v.scale, edgeLengths: held.edgeLengths ?? null };
    if (node.id !== "fold" || workbench.creases?.result?.built) {
      creaseReadiness.focus(node.step);
      await creaseReadiness.restore(context, heldSteps());
      if (node.id === "stubs" && seq === state.viewSeq) stubTool.show(held, creaseReadiness._state.before);
    }
    renderNextBar();
  } catch (e) {
    if (seq === state.viewSeq) { console.error(e.stack); setStatus("Could not show the workbench layout: " + e.message, "error"); }
  }
}

function renderHeldMetrics(held, v) {
  const from = NODES[held.node]?.title ?? (held.node === "file" ? "Layout file" : held.node);
  $("metrics").replaceChildren(
    group("Workbench layout", [
      ["From", from],
      ["Status", held.status ?? "—"],
      ["Scale m", fmt(v.scale, 6)],
      ["Grid", `${held.gridSize} × ${held.gridSize}`],
      ["TreeMaker scale m/N", fmt(v.scale / held.gridSize, 6)],
      ["Tight pairs", int(v.pairs.filter((p) => p.tight).length)],
    ]),
  );
}

function renderHeldSummary(box) {
  const wb = workbench;
  const lines = [];
  const l = wb.layout;
  if (l) {
    const from = NODES[l.node]?.title ?? (l.node === "file" ? `the file ${l.note ?? ""}` : l.node);
    lines.push(["Layout", `from ${from}: m = ${fmt(l.scale, 4)} on ${l.gridSize} × ${l.gridSize}, ${l.points.length} leaves`, true]);
  } else {
    lines.push(["Layout", "none yet", false]);
  }
  const c = wb.closure;
  lines.push(["Closed polygons", c ? (c.completion?.after?.valid ? `closed within ±${fmt(c.strainMax, 3)}` : "tried, not closed yet") : l?.polygonsValid ? "already valid" : "not yet", !!c?.completion?.after?.valid || !!l?.polygonsValid]);
  if (l?.stubs?.length) lines.push(["Stubs", l.stubs.join(", "), true]);
  const k = wb.creases;
  lines.push(["Crease pattern", k?.result?.built ? `${k.result.creases.length} creases` : "not built yet", !!k?.result?.built]);
  box.replaceChildren(...lines.map(([key, value, on]) => {
    const row = document.createElement("div");
    row.className = "held-row" + (on ? " on" : "");
    const a = document.createElement("span"); a.className = "k"; a.textContent = key;
    const b = document.createElement("span"); b.className = "v"; b.textContent = value;
    row.append(a, b);
    return row;
  }));
}

/** The "next step" links under the sheet, from what the workbench now holds. */
function renderNextBar() {
  const bar = $("nextBar");
  const node = state.node;
  if (!node || node.kind === "tree") { bar.hidden = true; return; }
  const wb = workbench;
  const links = [];
  if (wb.layout) {
    if (node.id !== "close") links.push(["Close the polygons", "#/close", !wb.polygonsValid()]);
    if (node.id === "close" && !wb.polygonsValid()) links.push(["Add stubs", "#/stubs", false]);
    if (wb.polygonsValid() && node.id !== "creases") links.push(["Crease pattern", "#/creases", !wb.creases?.result?.built]);
    if (wb.creases?.result?.built && node.id !== "fold") links.push(["Folded base", "#/fold", true]);
  }
  bar.hidden = !links.length;
  const label = document.createElement("span");
  label.className = "next-label";
  label.textContent = "Next, from the workbench:";
  bar.replaceChildren(label, ...links.map(([text, href, primary]) => {
    const a = document.createElement("a");
    a.href = href;
    a.className = primary ? "bench-go" : "quiet-link";
    a.textContent = text + " →";
    return a;
  }));
}

// ───────────────────────── Tree node ─────────────────────────

function renderPick() {
  const n = treeInfo(state.edges).leaves.length;
  $("pickCard").hidden = false;
  $("pickList").replaceChildren(...SOLVER_IDS.map((id) => {
    const node = NODES[id];
    const item = document.createElement("a");
    item.className = "pick-item";
    item.href = "#/" + id;
    const fit = appMapFit(id, n);
    item.innerHTML = `<span class="pick-kicker"></span><b></b><span class="pick-blurb"></span><span class="pick-fit"></span>`;
    item.children[0].textContent = node.kicker;
    item.children[1].textContent = node.title;
    item.children[2].textContent = node.blurb;
    item.children[3].textContent = fit.text;
    item.children[3].className = "pick-fit " + fit.cls;
    return item;
  }));
}

function appMapFit(id, leaves) {
  const limits = { pure: [4, 6], sym: [4, 6], hull: [10, 12], optimized: [12, 16], scalable: [200, 200] }[id];
  if (leaves <= limits[0]) return { cls: "fit", text: `Suits your ${leaves}-leaf tree` };
  if (leaves <= limits[1]) return { cls: "slow", text: `May be slow for ${leaves} leaves` };
  return { cls: "no", text: `Likely too slow for ${leaves} leaves` };
}

// ───────────────────────── The shelf (top bar) ─────────────────────────

function renderShelf() {
  const wb = workbench;
  const chips = [];
  const t = wb.tree;
  if (t?.edges?.length) chips.push(["Tree", `${treeInfo(t.edges).leaves.length} leaves · N ${t.gridSize}`, "#/tree", true]);
  const l = wb.layout;
  chips.push(["Layout", l ? `${NODES[l.node]?.title ?? "file"} · m ${fmt(l.scale, 3)}` : "none", "#/close", !!l]);
  const closed = wb.polygonsValid();
  chips.push(["Polygons", closed ? (wb.closure?.completion?.after?.valid ? `closed ±${fmt(wb.closure.strainMax, 2)}` : "valid") : l ? "open" : "—", "#/creases", closed]);
  const k = wb.creases?.result;
  chips.push(["Creases", k?.built ? `${k.creases.length}` : "—", "#/fold", !!k?.built]);
  $("shelf").replaceChildren(...chips.map(([key, value, href, on]) => {
    const a = document.createElement("a");
    a.className = "shelf-chip" + (on ? " on" : "");
    a.href = href;
    a.title = `Workbench ${key.toLowerCase()}: ${value}`;
    const k1 = document.createElement("span"); k1.className = "k"; k1.textContent = key;
    const v1 = document.createElement("span"); v1.className = "v"; v1.textContent = value;
    a.append(k1, v1);
    return a;
  }));
}

// ───────────────────────── Routing between the map and the nodes ─────────────────────────

function route() {
  // `#/<node>`: the part of the app. The specs open in their own tab (docs.html), so a link from before the split,
  // `#/<node>?read=<doc>:<anchor>`, opens that passage there and keeps the node here.
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const read = new URLSearchParams(query).get("read");
  if (read != null) {
    const [doc, at] = read.split(":");
    history.replaceState(null, "", `#/${path}`);
    specLinks.open(doc || null, at || null);
  }
  const id = NODES[path] ? path : "";
  if (id !== (state.node?.id ?? "") || !state.routed) {
    state.routed = true;
    if (!id) showMap(); else enterNode(id);
  }
}

function showMap() {
  state.node = null;
  clearResults();
  document.body.dataset.view = "map";
  document.body.dataset.node = "";
  $("mapView").hidden = false;
  $("workView").hidden = true;
  $("crumbNode").textContent = "";
  $("crumbSpec").hidden = true;
  $("backToMap").hidden = true;
  document.title = "TreeMaker";
  appMap.render();
  renderShelf();
}

function enterNode(id) {
  const node = NODES[id];
  state.node = node;
  clearResults();
  document.body.dataset.view = "work";
  document.body.dataset.node = id;
  document.body.dataset.kind = node.kind;
  document.body.dataset.stretch = node.stretch ? "on" : "off";
  $("mapView").hidden = true;
  $("workView").hidden = false;
  $("backToMap").hidden = false;
  window.scrollTo(0, 0);
  document.title = `${node.title} · TreeMaker`;

  // Header and crumbs: which spec this part of the app implements.
  const doc = nodeDoc(node);
  $("crumbNode").textContent = node.title;
  $("crumbSpec").hidden = !doc;
  if (doc) {
    const t = specLinks.firstTarget(node.section, node.doc);
    $("crumbSpec").href = specLinks.href(t.doc, t.at);
    $("crumbSpec").title = `Read ${doc.title}: ${node.section}`;
  }
  $("nodeKicker").textContent = node.kicker;
  $("nodeTitle").textContent = node.title;
  $("nodeLede").textContent = node.lede;
  const spec = $("nodeSpec");
  spec.replaceChildren();
  if (doc) {
    spec.append("Spec: ");
    // The doc, and every label and section the node cites, open in the docs tab.
    spec.append(specLinks.link(doc.title, node.doc, null), " · ", specLinks.linkify(node.section, node.doc));
  } else {
    spec.textContent = "Spec: none yet.";
  }

  // Sidebar blocks for this node, and solver-specific fields.
  for (const block of document.querySelectorAll("[data-nodes]")) {
    block.hidden = !block.dataset.nodes.split(" ").includes(id);
  }
  const s = solver();
  $("gapField").hidden = !(s?.gap);
  $("solverSummary").textContent = s?.solverSummary ?? "";
  $("sizeNote").textContent = s?.sizeNote ?? "";
  $("treeHelp").textContent = node.stretch
    ? "Drag vertices to move them, or onto another vertex to re-attach. Click a leaf to pin it to an edge, a corner or the axis, or to mirror it with another leaf. Click an edge to toggle S, click a length to edit it, double-click a vertex to rename it."
    : "Drag vertices to move them, or onto another vertex to re-attach. Click a leaf to pin it to an edge, a corner or the axis, or to mirror it with another leaf. Click a length to edit it, double-click a vertex to rename it.";
  if (node.id === "stubs") {
    $("treeHelp").textContent = "The workbench layout's tree, locked: edit the tree in the Tree node. The dashed edge is the proposed stub; click a joint to hang it there, click it again to let the search choose.";
  }
  if (node.lockOptions?.symmetryBreaking === false) {
    $("optSymmetry").checked = false;
    $("optSymmetry").disabled = true;
    $("optSymmetryRow").classList.add("locked");
    $("optSymmetryRef").textContent = "Off: the Lattice-Hull spec has none; the Optimized MILP adds it";
    $("searchRef").textContent = "Lattice-Hull spec, Sections 8 and 10";
  } else {
    $("optSymmetry").disabled = false;
    $("optSymmetryRow").classList.remove("locked");
    $("optSymmetryRef").textContent = "§4";
    $("searchRef").textContent = "Optimized spec, Sections 3 and 5";
    if (id === "optimized" && $("optSymmetry").dataset.touched !== "1") $("optSymmetry").checked = true;
  }
  s?.updateParams();
  applyPresetAvailability(node);
  $("solve").hidden = $("cancel").hidden = node.kind !== "solver";
  $("solve").disabled = !!state.solving;
  $("cancel").disabled = !state.solving;
  if (!state.solving) setStatus(node.kind === "solver" ? "Ready" : "");

  renderTreePreview();
  renderShelf();
  if (node.kind === "solver") {
    $("stageArea").hidden = false;
    scheduleAnalyze();
    showHeldOnSolver();
  } else if (node.kind === "tree") {
    $("stageArea").hidden = true;
    renderTreeStats();
    renderPick();
  } else {
    renderTreeStats();
    showStep(node);
  }
}

/** Greys out presets that the current solver cannot solve in reasonable time. */
function applyPresetAvailability(node) {
  for (const option of $("preset").options) {
    if (!option.value) continue;
    option.dataset.label ??= option.textContent;
    const random = option.value.startsWith("random");
    const allowed = node.kind === "tree" || (random ? !!node.random : (node.presets == null || node.presets.includes(option.value)));
    option.disabled = !allowed;
    option.textContent = option.dataset.label + (allowed ? "" : " · too slow here; use the Scalable MILP");
    option.title = allowed ? "" : `${node.title} cannot solve this tree in reasonable time at any useful grid size.`;
  }
}

// ───────────────────────── Start-up ─────────────────────────

async function init() {
  window.name = APP_TAB;     // links from the docs tab ("Run it") come back to this tab
  $("addEdge").addEventListener("click", () => {
    state.edges.push({ from: "", to: "", length: 1, stretch: false });
    renderEdges();
    const inputs = $("edgeRows").querySelectorAll("input[type=text]");
    inputs[inputs.length - 2]?.focus();
  });
  $("addLeaf").addEventListener("click", () => {
    const info = treeInfo(state.edges);
    const parent = $("leafParent").value || "c";
    const isNumeric = info.leaves.every((l) => /^\d+$/.test(l));
    const name = isNumeric ? String(Math.max(0, ...info.leaves.map(Number)) + 1) : nextName(info, "L");
    state.edges.push({ from: name, to: parent, length: 1, stretch: false });
    renderEdges();
    changed({ structure: true });
  });
  $("clearTree").addEventListener("click", () => loadEdges([]));
  $("preset").addEventListener("change", async (event) => {
    const value = event.target.value;
    event.target.value = "";
    if (value === "example") {
      applyProblem(await (await fetch("/api/example")).json());
      $("gridSize").value = PRESET_GRID.example;
      changed();
    } else if (/^random\d+$/.test(value)) {
      const leaves = Number(value.slice(6));
      state.randomSeed = (state.randomSeed % 9999) + 1;
      applyProblem(await (await fetch(`/api/random?leaves=${leaves}&seed=${state.randomSeed}&whole=true`)).json());
      setStatus(`Random tree with ${leaves} leaves (seed ${state.randomSeed}) on a ${$("gridSize").value} × ${$("gridSize").value} grid.`);
    } else if (PRESETS[value]) {
      loadEdges(PRESETS[value]);
      if (PRESET_GRID[value]) $("gridSize").value = PRESET_GRID[value];
      ({ mirrors: state.mirrors, conditions: state.conditions } = presetSymmetry(value, PRESETS[value]));
      // Redraw with the mirror pairs known, so the body is a straight line with a leg on each side.
      resetTreeLayout();
      renderLeafControls();
      changed();
    }
  });
  $("addMirror").addEventListener("click", () => {
    const a = $("mirrorA").value, b = $("mirrorB").value;
    if (!a || !b || a === b) return;
    if (state.mirrors.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))) return;
    state.mirrors.push({ a, b });
    renderLeafControls();
    changed();
  });

  // Solver settings: any change re-runs the analysis.
  for (const radio of document.querySelectorAll('input[name="stage"]')) {
    radio.addEventListener("change", () => { solver()?.updateParams(); scheduleAnalyze(); });
  }
  for (const id of ["autoScale", "optSymmetry", "optPairs", "optFacets", "optWindows", "optSeed", "optCompare", "optLns", "optSubtrees", "optTight", "optClose"]) {
    $(id).addEventListener("change", () => { solver()?.updateParams(); scheduleAnalyze(); });
  }
  $("optSymmetry").addEventListener("change", () => { $("optSymmetry").dataset.touched = "1"; });
  for (const id of ["fixedScale", "targetScale", "strainMin", "strainMax", "strainObjective", "timeLimit", "relativeGap", "threads",
    "optH", "optStarts", "optRepairH", "optLnsH", "optStrainMin", "optStrainMax"]) {
    $(id).addEventListener("input", scheduleAnalyze);
  }
  $("gridSize").addEventListener("input", () => changed());
  $("useStart").addEventListener("change", updateStartRow);
  $("hullPair").addEventListener("change", (e) => { state.hullPair = Number(e.target.value); renderHull(state.lastResponse); });
  window.addEventListener("resize", () => { if (state.lastResponse && solver()) solver().renderExtras(state.lastResponse, state.lastRequest, false); });

  $("solve").addEventListener("click", solve);
  $("cancel").addEventListener("click", cancel);
  $("showAllPairs").addEventListener("change", redrawSheet);
  $("showCircles").addEventListener("change", redrawSheet);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && state.node?.kind === "solver") solve();
  });

  initTreeEditor();
  treeFiles.init({
    appName: () => state.node?.appName ?? "TreeMaker",
    getProblem: () => ({ ...buildProblem(), startLayout: null }),
    applyTree: (tree) => {
      const grid = Math.round(numberOrNull("gridSize") ?? 9);
      applyProblem({ ...tree, gridSize: tree.gridSize ?? grid });
    },
    importLayout,
    status: setStatus,
    openButtons: ["openFile", "mapOpen", "stepOpenFile"],
  });
  creaseReadiness.init();
  stubTool.init();
  creaseReadiness.hooks.afterDraw = () => stubTool.draw();
  foldedView.init();
  appMap.init();

  // The crease panel reports to the workbench.
  creaseReadiness.hooks.onReport = (report) => {
    if (workbench.layout && workbench.layout.polygonsValid !== report.valid) workbench.noteLayout({ polygonsValid: report.valid });
  };
  creaseReadiness.hooks.onCompletion = (result, bounds) => workbench.setClosure({ ...bounds, completion: result });
  creaseReadiness.hooks.onCreases = (creases) => workbench.setCreases(creases);
  workbench.onChange((slot) => {
    // A new layout: redraw the tree sketch to face the way the leaves sit on the sheet, unless it was arranged by hand.
    if (slot === "layout" && !treeUi.handPlaced) { resetTreeLayout(); renderTreePreview(); }
    renderShelf();
    renderNextBar();
    if (state.node?.kind === "step") renderHeldSummary($("heldSummary"));
  });

  // The tree: from the workbench when there is one, otherwise the running example.
  if (workbench.tree?.edges?.length) {
    applyProblem(workbench.tree);
  } else {
    try {
      applyProblem(await (await fetch("/api/example")).json());
      $("gridSize").value = PRESET_GRID.example;
      changed();
    } catch {
      loadEdges(PRESETS.star4);
    }
  }
  window.addEventListener("hashchange", route);
  route();
}

/** Redraws the sheet after a display option changes. */
function redrawSheet() {
  if (!state.lastView) return;
  renderLayout(state.lastView, state.lastRequest);
  creaseReadiness.draw();
}

init();
