// Pure MILP TreeMaker UI. Plain JS, no dependencies; talks to the in-process ASP.NET Core API.
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

/** Left–right mirror pairs for the centipede presets: Lk ↔ Rk, and the antennae and tail pairs. */
function presetMirrors(value, edges) {
  if (!value.startsWith("centipede")) return [];
  const leaves = new Set(treeInfo(edges.map(([from, to, length]) => ({ from, to, length }))).leaves);
  const pairs = [];
  for (const leaf of leaves) {
    const m = /^L(\d+)$/.exec(leaf);
    if (m && leaves.has("R" + m[1])) pairs.push({ a: leaf, b: "R" + m[1] });
  }
  for (const [a, b] of [["antL", "antR"], ["cL", "cR"]]) if (leaves.has(a) && leaves.has(b)) pairs.push({ a, b });
  return pairs;
}

/** Each preset's grid size: the largest tested N at which the apps it is enabled in solve it within 60 s. */
const PRESET_GRID = {
  example: 8, star4: 6, star5: 16, bird: 8, caterpillar: 10,
  centipede2: 12, centipede4: 12, centipede5: 8, centipede6: 8, centipede8: 13,
  beetle: 12, deer: 12, dragon: 14, scorpion: 14, centipede: 16,
};


const state = {
  edges: [],        // { from, to, length, stretch }
  conditions: {},   // leaf -> { kind, x, y }
  mirrors: [],      // { a, b }
  lastResponse: null,
  lastRequest: null,
  solving: false,
  startLayout: null, // [{leaf, x, y}] from an imported layout file
};

// ───────────────────────── Tree structure (client side, for the editor) ─────────────────────────

function treeInfo(edges) {
  const adjacency = new Map();
  const add = (u, v, i) => {
    if (!adjacency.has(u)) adjacency.set(u, []);
    adjacency.get(u).push({ to: v, edge: i });
  };
  edges.forEach((e, i) => {
    const u = e.from.trim(), v = e.to.trim();
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

// ───────────────────────── Request building ─────────────────────────

function numberOrNull(id) {
  const raw = $(id).value.trim();
  if (raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}



function buildRequest() {
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
    edges: state.edges.map((e) => ({ from: e.from.trim(), to: e.to.trim(), length: Number(e.length) })),
    gridSize: Math.round(numberOrNull("gridSize") ?? 9),
    leafConditions: conditions,
    mirrorPairs: state.mirrors.filter((m) => leafSet.has(m.a) && leafSet.has(m.b)),
    startLayout: currentStart(info),
    timeLimitSeconds: numberOrNull("timeLimit"),
    threads: numberOrNull("threads"),
    options: {
      symmetryBreaking: $("optSymmetry").checked,
      pairGeneration: $("optPairs").checked,
      facetGeneration: $("optFacets").checked,
      leafWindows: $("optWindows").checked,
      windowHalfWidth: Math.max(0, Math.round(numberOrNull("optH") ?? 2)),
      useSeed: $("optSeed").checked,
      compareWithBase: $("optCompare").checked,
      relativeGap: Math.max(0, numberOrNull("relativeGap") ?? 0),
    },
  };
}

function toIntOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
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
    for (const [value, label] of CONDITION_KINDS) {
      const o = new Option(label, value);
      select.append(o);
    }
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

  // Parent selector for "+ Leaf on".
  const parent = $("leafParent");
  const keepParent = parent.value;
  const vertices = [...info.internal, ...info.leaves];
  parent.replaceChildren(...vertices.map((v) => new Option(v, v)));
  if (vertices.includes(keepParent)) parent.value = keepParent;
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
  try {
    const a = await postJson("/api/analyze", buildRequest());
    if (seq !== analyzeSeq) return;
    err.hidden = true;
    renderAnalysis(a);
  } catch (e) {
    if (seq !== analyzeSeq) return;
    $("analysis").replaceChildren();
    $("sizeBreakdown").classList.add("stale");
    err.hidden = false;
    err.textContent = e.message;
  }
}

function renderAnalysis(a) {
  const base = a.baseModel;
  $("analysis").replaceChildren(
    stat("Candidate scales", a.candidateCount.toLocaleString(), `≤ ${a.maxTests} tests`),
    stat("Feas(m) binaries", `≤ ${a.worstCaseBinaries.toLocaleString()}`, "per solve"),
    stat("Base model binaries", base.binaryVariables.toLocaleString(), "one solve"),
    stat("Leaf pairs", a.pairs.toLocaleString()),
    stat("Scale bound m̄", fmt(a.scaleUpperBound, 4)),
  );
  renderSizeBreakdown(a, buildRequest());
}

// Before solving: the candidate list and the size of each feasibility model are known exactly; how many
// generation rounds each test takes is not (Section 6.12).
function renderSizeBreakdown(a, request) {
  const base = a.baseModel;
  const box = $("sizeBreakdown");
  box.classList.remove("stale");
  const rows = [
    ["Candidate scales K", `${a.distinctSquaredLengths} lengths × ${a.distinctPathLengths} ℓ, ≤ m̄`, a.candidateCount],
    ["Bisection tests", "⌈log₂ K⌉", a.maxTests],
    ["Feas(m) binaries, worst scale", "Σ facets per pair", a.worstCaseBinaries],
  ];
  if (a.atSeed) {
    rows.push([`Feas(m) at the seed, m = ${fmt(a.atSeed.scale, 3)}`, `${a.atSeed.rows.toLocaleString()} rows`, a.atSeed.binaries]);
  }
  rows.push(["Base model binaries", `P × |Δ_N| = ${base.pairCount} × ${base.selectorsPerPair}`, base.binaryVariables]);

  const table = document.createElement("table");
  rows.forEach(([label, formula, value], k) => {
    const tr = document.createElement("tr");
    if (k === rows.length - 1) tr.className = "total";
    tr.innerHTML = `<th scope="row"></th><td class="f"></td><td class="n"></td>`;
    tr.children[0].textContent = label;
    tr.children[1].textContent = formula;
    tr.children[2].textContent = Number(value).toLocaleString();
    table.append(tr);
  });
  const note = document.createElement("p");
  note.className = "size-note";
  const sym = a.symmetry;
  const parts = [];
  if (request.options.symmetryBreaking) {
    parts.push(sym.anchor ? `Anchor leaf ${sym.anchor}.` : "No anchor leaf.");
    if (sym.siblingGroups.length) parts.push(`Interchangeable siblings: ${sym.siblingGroups.map((g) => g.join(" = ")).join("; ")}.`);
    if (sym.note) parts.push(sym.note);
  }
  parts.push("Incremental rounds use fewer binaries; how many rounds each test needs is not known in advance.");
  note.textContent = parts.join(" ");
  box.replaceChildren(table, note);
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
  if (state.solving) return;
  const request = buildRequest();
  clearResults();
  setSolving(true);
  setStatus("Searching…", "running");
  const started = performance.now();
  const ticker = setInterval(() => {
    setStatus(`Searching… ${((performance.now() - started) / 1000).toFixed(1)} s`, "running");
  }, 200);
  try {
    const response = await postJson("/api/solve", request);
    if (response?.cancelled && !response.status) {
      setStatus("Cancelled");
      return;
    }
    state.lastResponse = response;
    state.lastRequest = request;
    renderResult(true);
    setStatus(`${response.status} in ${fmtMs(response.milliseconds)}`);
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  } finally {
    clearInterval(ticker);
    restoreEmptySheet();
    setSolving(false);
  }
}

const CARDS = ["metricsCard", "pairsCard", "traceCard", "hullCard"];
const PANES = ["metrics", "messages", "pairsTable", "traceTable", "ladder", "hullView", "hullPair", "hullNote"];

/** Removes everything an earlier solve left on the page (sheet, polygons, creases, folded base, tables), before a new solve. */
function clearResults() {
  state.lastResponse = null;
  creaseReadiness.update(null);
  foldedView.hide();
  $("layoutView").replaceChildren();
  const empty = $("emptySheet");
  const [lead, sub] = empty.querySelectorAll("p");
  empty.dataset.lead ??= lead.textContent;
  empty.dataset.sub ??= sub.textContent;
  lead.textContent = "Solving…";
  sub.textContent = "The new layout lands here.";
  empty.hidden = false;
  for (const id of CARDS) { const card = $(id); if (card) card.hidden = true; }
  for (const id of PANES) $(id)?.replaceChildren();
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
  state.solving = on;
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

function renderResult(fresh = false) {
  const r = state.lastResponse;
  if (!r) return;
  $("metricsCard").hidden = false;
  $("emptySheet").hidden = !!(r.layout && r.layout.length);
  $("pairsCard").hidden = !(r.pairs && r.pairs.length);
  $("traceCard").hidden = !(r.tests && r.tests.length) && !r.candidateCount;
  $("hullCard").hidden = !(r.hulls && r.hulls.length);
  renderLayout(r, state.lastRequest);
  creaseReadiness.draw();
  if (fresh === true) {
    creaseReadiness.update(r.layout?.length ? {
      problem: state.lastRequest,
      gridSize: state.lastRequest.gridSize,
      layout: r.layout,
      scale: r.scale,
      edgeLengths: r.edgeLengths?.length ? r.edgeLengths.map((e) => e.newLength) : null,
    } : null);
  }
  const sheet = document.querySelector(".sheet");
  sheet.classList.remove("fresh");
  if (fresh === true) {
    void sheet.offsetWidth;   // restart the animation
    sheet.classList.add("fresh");
  }
  renderMetrics(r);
  renderPairs(r);
  renderTrace(r);
  if (fresh === true || state.hullPair == null) {
    const tight = (r.hulls ?? []).findIndex((h) => h.tight);
    state.hullPair = Math.max(0, tight);
  }
  renderHull(r);
}

function renderLayout(r, request) {
  const svg = $("layoutView");
  svg.replaceChildren();
  if (!r.layout || !r.layout.length) return;
  const N = request.gridSize;
  const size = 600, pad = 40;
  const unit = (size - 2 * pad) / N;
  const X = (x) => pad + x * unit;
  const Y = (y) => size - pad - y * unit;   // y up, as in the doc
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
  if (N % 2 === 0 && (request.mirrorPairs.length || request.leafConditions.some((c) => c.kind === "OnSymmetryAxis"))) {
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

function renderMetrics(r) {
  const solution = [
    ["Status", badge(r.status)],
    ["Scale m*", fmt(r.scale, 6)],
    ["Proved bound", r.upperBound == null ? "—" : `m* ≤ ${fmt(r.upperBound, 6)}`],
    ["Gap", r.upperBound == null || !r.scale ? "—" : `${((r.upperBound / r.scale - 1) * 100).toPrecision(3)} %`],
    ["TreeMaker scale m*/N", fmt(r.treeMakerScale, 6)],
    ["Seed scale", fmt(r.seedScale, 6)],
  ];
  const search = [
    ["Candidate scales", int(r.candidateCount)],
    ["Bisection tests", `${int(r.tests.length)} of ≤ ${int(r.maxTests)}`],
    ["MILP solves", int(r.totalSolves)],
    ["Largest solve", `${int(r.maxBinariesPerSolve)} binaries`],
    ["Binaries, all solves", int(r.totalBinaries)],
    ["Total time", fmtMs(r.milliseconds)],
  ];
  const full = r.fullModelAtOptimum;
  const base = r.baseModel;
  const compare = [
    ["Base model binaries", int(base.binaryVariables)],
    ["Base rows / nonzeros", `${int(base.constraints)} / ${int(base.nonzeros)}`],
  ];
  if (full) {
    compare.push(["Full Feas(m*) binaries", int(full.binaries)]);
    compare.push(["Full Feas(m*) rows / nonzeros", `${int(full.rows)} / ${int(full.nonzeros)}`]);
  }
  const groups = [group("Solution", solution), group("Search", search), group("Model size", compare)];
  if (r.baseSolve) {
    const b = r.baseSolve;
    const same = b.scale != null && r.scale != null && Math.abs(b.scale - r.scale) <= 1e-6 * Math.max(1, r.scale);
    groups.push(group("Base model, solved directly", [
      ["Status", badge(b.status)],
      ["m*", fmt(b.scale, 6)],
      ["Agrees", b.scale == null ? "—" : same ? "Yes" : "No"],
      ["Time", fmtMs(timeSpanMs(b.metrics.buildTime) + timeSpanMs(b.metrics.solveTime))],
      ["B&B nodes", int(b.metrics.nodes)],
    ]));
  }
  $("metrics").replaceChildren(...groups);

  const messages = $("messages");
  messages.replaceChildren();
  if (r.messages?.length) {
    const ul = document.createElement("ul");
    ul.className = "messages";
    for (const text of r.messages) { const li = document.createElement("li"); li.textContent = text; ul.append(li); }
    messages.append(ul);
  }
  if (r.layout?.length) {
    if (r.violations?.length) {
      const ul = document.createElement("ul");
      ul.className = "violations";
      for (const text of r.violations) { const li = document.createElement("li"); li.textContent = text; ul.append(li); }
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
  table.replaceChildren();
  const head = document.createElement("tr");
  for (const h of ["Pair", "ℓᵢⱼ", "ℓ used", "δ", "D(δ)", "m·ℓ", "Slack", "Tight"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
  const pairs = [...(r.pairs ?? [])].sort((a, b) => a.slack - b.slack);
  for (const p of pairs) {
    const tr = document.createElement("tr");
    if (p.tight) tr.className = "tight";
    for (const v of [`${p.a}–${p.b}`, fmt(p.pathLength, 4), fmt(p.effectiveLength, 4), `(${p.dx}, ${p.dy})`,
      fmt(p.distance, 4), fmt(p.required, 4), fmt(p.slack, 4), p.tight ? "●" : ""]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    table.append(tr);
  }
}

// ───── Bisection trace: where each test landed on the candidate ladder, and what it cost ─────

function renderTrace(r) {
  const svg = $("ladder");
  svg.replaceChildren();
  const tests = r.tests ?? [];
  const width = svg.clientWidth || 700, height = 92, pad = 26;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const values = r.candidates?.length ? r.candidates : tests.map((t) => t.scale);
  if (!values.length) return;
  const min = Math.min(...values, ...tests.map((t) => t.scale)), max = Math.max(...values, ...tests.map((t) => t.scale));
  const X = (v) => pad + (max > min ? (v - min) / (max - min) : 0.5) * (width - 2 * pad);
  const axisY = 58;
  svg.append(el("line", { x1: pad, y1: axisY, x2: width - pad, y2: axisY, class: "ladder-axis" }));
  for (const v of r.candidates ?? []) {
    svg.append(el("line", { x1: X(v), y1: axisY - 4, x2: X(v), y2: axisY + 4, class: "ladder-tick" }));
  }
  for (const [v, anchor, label] of [[min, "start", fmt(min, 3)], [max, "end", fmt(max, 3)]]) {
    const t = el("text", { x: X(v), y: axisY + 22, "text-anchor": anchor, class: "ladder-label" });
    t.textContent = label;
    svg.append(t);
  }
  if (r.scale != null) {
    const x = X(r.scale);
    svg.append(el("line", { x1: x, y1: 10, x2: x, y2: axisY + 8, class: "ladder-optimum" }));
    const t = el("text", { x, y: axisY + 22, "text-anchor": "middle", class: "ladder-label strong" });
    t.textContent = `m* = ${fmt(r.scale, 4)}`;
    svg.append(t);
  }
  tests.forEach((t, k) => {
    const x = X(t.scale), y = 16 + (k % 3) * 12;
    svg.append(el("line", { x1: x, y1: y, x2: x, y2: axisY, class: "ladder-stem" }));
    const mark = el("circle", { cx: x, cy: y, r: 5.5, class: "ladder-mark " + t.answer.toLowerCase() });
    const title = el("title");
    title.textContent = `Test ${t.test}: m = ${fmt(t.scale, 6)} → ${t.answer}`;
    mark.append(title);
    const num = el("text", { x, y: y + 3.5, "text-anchor": "middle", class: "ladder-num " + t.answer.toLowerCase() });
    num.textContent = t.test;
    svg.append(mark, num);
  });

  const table = $("traceTable");
  table.replaceChildren();
  const head = document.createElement("tr");
  for (const h of ["Test", "Trial m", "Answer", "Phases", "Solves", "Largest solve", "Time"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
  for (const t of tests) {
    const tr = document.createElement("tr");
    tr.className = "answer-" + t.answer.toLowerCase();
    const phases = t.phases.map((p) => `${p.windowed ? "windowed" : "full grid"}: ${p.outcome.toLowerCase()} after ${p.rounds.length}`).join("; ");
    for (const v of [t.test, fmt(t.scale, 6), t.answer, phases, t.solves, `${int(t.maxBinaries)} binaries`, fmtMs(t.milliseconds)]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    table.append(tr);
  }
}

// ───── Hull viewer: one pair's forbidden offsets, lattice hull and offset at m* ─────

function renderHull(r) {
  const hulls = r.hulls ?? [];
  const select = $("hullPair");
  select.replaceChildren(...hulls.map((h, k) => new Option(`${h.a}–${h.b}${h.tight ? " (tight)" : ""}`, k)));
  if (!hulls.length) return;
  const k = Math.min(state.hullPair ?? 0, hulls.length - 1);
  select.value = k;
  const h = hulls[k];
  const svg = $("hullView");
  svg.replaceChildren();
  const reach = Math.max(2, Math.ceil(Math.max(Math.sqrt(h.limit + 1), Math.abs(h.dx), Math.abs(h.dy))) + 1);
  const size = 320, pad = 14, unit = (size - 2 * pad) / (2 * reach);
  const X = (x) => size / 2 + x * unit, Y = (y) => size / 2 - y * unit;
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.append(el("circle", { cx: X(0), cy: Y(0), r: h.radius * unit, class: "hull-circle" }));
  if (h.vertices.length >= 3) {
    svg.append(el("polygon", { points: h.vertices.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), class: "hull-poly" }));
  }
  for (let x = -reach; x <= reach; x++) {
    for (let y = -reach; y <= reach; y++) {
      const forbidden = x * x + y * y <= h.limit;
      svg.append(el("circle", { cx: X(x), cy: Y(y), r: forbidden ? 2.6 : 1.6, class: forbidden ? "lp forbidden" : "lp" }));
    }
  }
  svg.append(el("line", { x1: X(0), y1: Y(0), x2: X(h.dx), y2: Y(h.dy), class: "hull-offset" }));
  svg.append(el("circle", { cx: X(h.dx), cy: Y(h.dy), r: 5, class: "hull-offset-end" }));
  $("hullNote").textContent =
    `Radius m*·ℓ = ${fmt(h.radius, 4)}. The ${h.crossableFacets} crossable facets of the hull replace ` +
    `${(r.baseModel.selectorsPerPair).toLocaleString()} offset selectors. Offset δ = (${h.dx}, ${h.dy}), length ${fmt(Math.hypot(h.dx, h.dy), 4)}` +
    (h.tight ? ", exactly on the circle: this pair is tight." : ".");
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

// ───────────────────────── Wiring ─────────────────────────

function changed({ structure = false } = {}) {
  if (structure) renderLeafControls();
  renderTreePreview();
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
  loadEdges(p.edges);
  $("gridSize").value = p.gridSize ?? 9;
  for (const c of p.leafConditions ?? []) state.conditions[c.leaf] = { kind: c.kind, x: c.x ?? "", y: c.y ?? "" };
  state.mirrors = (p.mirrorPairs ?? []).map((m) => ({ a: m.a, b: m.b }));
  renderLeafControls();
  scheduleAnalyze();
}

function nextName(info, prefix) {
  for (let k = 1; ; k++) {
    const name = prefix + k;
    if (!info.adjacency.has(name)) return name;
  }
}

function updateStageParams() {
  $("optH").disabled = !$("optWindows").checked;
}

// ───────────────────────── Tree and layout files (files.js) ─────────────────────────

/** The imported layout to start the next solve from, when it still fits the tree and the grid. */
function currentStart(info) {
  const note = $("startNote");
  if (!state.startLayout) return null;
  const n = Math.round(numberOrNull("gridSize") ?? 9);
  const leaves = new Set(info.leaves);
  const fits = state.startLayout.length === leaves.size &&
    state.startLayout.every((p) => leaves.has(p.leaf) && p.x <= n && p.y <= n);
  if (note) note.textContent = fits ? "" : " (it no longer fits the tree or the grid, so it is not used)";
  return fits && $("useStart").checked ? state.startLayout : null;
}

function updateStartRow() {
  $("startRow").hidden = !state.startLayout;
}

/** Shows a layout the server has checked (/api/layout) as if it had just been solved. */
function showImported(response, request, leaves) {
  clearResults();
  restoreEmptySheet();
  state.lastResponse = response;
  state.lastRequest = request;
  renderResult(true);
  state.startLayout = leaves;
  $("useStart").checked = true;
  updateStartRow();
  setStatus("Imported layout: the crease-pattern steps are ready, and the next solve starts from it.");
}

function initFiles(appName) {
  treeFiles.init({
    appName,
    getProblem: buildRequest,
    applyTree: (tree) => {
      const grid = Math.round(numberOrNull("gridSize") ?? 9);
      applyProblem({ ...tree, gridSize: tree.gridSize ?? grid });
      state.startLayout = null;
      updateStartRow();
    },
    showImported,
    status: setStatus,
  });
}

async function init() {
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
    const name = isNumeric
      ? String(Math.max(0, ...info.leaves.map(Number)) + 1)
      : nextName(info, "L");
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
      scheduleAnalyze();
    } else if (PRESETS[value]) {
      loadEdges(PRESETS[value]);
      if (PRESET_GRID[value]) $("gridSize").value = PRESET_GRID[value];
      state.mirrors = presetMirrors(value, PRESETS[value]);
      renderLeafControls();
      scheduleAnalyze();
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

  for (const id of ["optSymmetry", "optPairs", "optFacets", "optWindows", "optSeed", "optCompare"]) {
    $(id).addEventListener("change", () => { updateStageParams(); scheduleAnalyze(); });
  }
  $("hullPair").addEventListener("change", (e) => { state.hullPair = Number(e.target.value); renderHull(state.lastResponse); });
  window.addEventListener("resize", () => state.lastResponse && renderTrace(state.lastResponse));
  for (const id of ["gridSize", "optH", "timeLimit", "relativeGap", "threads"]) {
    $(id).addEventListener("input", scheduleAnalyze);
  }
  $("solve").addEventListener("click", solve);
  $("cancel").addEventListener("click", cancel);
  $("showAllPairs").addEventListener("change", () => renderResult());
  $("showCircles").addEventListener("change", () => renderResult());
  initTreeEditor();
  initFiles("Optimized MILP TreeMaker");
  creaseReadiness.init();
  foldedView.init();
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") solve();
  });

  try {
    applyProblem(await (await fetch("/api/example")).json());
    $("gridSize").value = PRESET_GRID.example;
    scheduleAnalyze();
  } catch {
    loadEdges(PRESETS.star4);
  }
}

init();
