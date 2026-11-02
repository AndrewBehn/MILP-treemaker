// Drag-and-drop tree editor. state.edges (in app.js) stays the single source of truth; this file only
// draws it and turns gestures into edits of that list.
//
//   Drag a vertex          move it; drop it on another vertex to re-attach it (and what hangs off it) there
//   Drag a vertex to bin   delete a leaf, merge a two-edge joint, or prune a branch
//   Drag "Leaf" chip       onto a vertex to add a leaf there, or onto an edge to branch from its midpoint
//   Drag "Joint" chip      onto an edge to split it in two
//   Click an edge          toggle it in the stretch set S
//   Click a length tag     edit it in place (Enter saves, Esc cancels; Tab also reaches the tags)
//   Double-click a vertex  rename it
//   Click a leaf           pin it to an edge, a corner, the symmetry axis or a grid point, or mirror it with
//                          another leaf (then click that leaf); the conditions show on the drawing
"use strict";

const treeUi = {
  pos: new Map(),       // vertex name -> [u, v] in the unit square of the drawing area
  drag: null,           // { kind: "vertex", v, moved } | { kind: "new", type, x, y }
  hover: null,          // { kind: "vertex", v } | { kind: "edge", index } | { kind: "bin" }
  geometry: null,       // last render: { width, height, pad, px: Map(name -> [x, y]) }
  message: "",
  handPlaced: false,    // true once a vertex was dragged: a new layout then doesn't re-orient the drawing
  pick: null,           // { from: leaf } while choosing the leaf that mirrors `from`
  stub: null,           // Add stubs node (stubs.js): { attach, label } draws the proposed stub from that joint
};

/** In the Add stubs node the tree is the workbench layout's: it can be looked at and rearranged, not edited. */
/** Only the session's tree step edits the tree; every later step shows it locked (“Go back to this result” on step 1 to change it). */
const treeLocked = () => document.body.dataset.view === "work" && document.body.dataset.node !== "tree";
/** True while the workflow document's "Add a stub" move is open: clicks on joints hang the stub (stubs.js). */
const stubbing = () => document.body.dataset.stubbing === "on";

// ───────────────────────── Leaf conditions on the drawing ─────────────────────────
// The same state as the sidebar's Leaf conditions table and Mirror pairs (state.conditions, state.mirrors), set by
// clicking a leaf. conditions P:1, C:1–C:5.

/** The places a leaf can be pinned on the sheet, as a 3 × 3 picture of it (top row = top of the sheet). */
const SHEET_PINS = [
  ["TopLeftCorner", "top-left corner"], ["TopEdge", "top edge"], ["TopRightCorner", "top-right corner"],
  ["LeftEdge", "left edge"], ["", "free"], ["RightEdge", "right edge"],
  ["BottomLeftCorner", "bottom-left corner"], ["BottomEdge", "bottom edge"], ["BottomRightCorner", "bottom-right corner"],
];

/** The short tag a condition shows beside its leaf. */
function conditionTag(c) {
  if (!c?.kind) return "";
  if (c.kind === "OnSymmetryAxis") return "on axis";
  if (c.kind === "Fixed") return `at (${c.x === "" ? "?" : c.x}, ${c.y === "" ? "?" : c.y})`;
  return SHEET_PINS.find(([k]) => k === c.kind)?.[1] ?? c.kind;
}

function setCondition(leaf, kind, x = "", y = "") {
  state.conditions[leaf] = { kind, x: kind === "Fixed" ? String(x) : "", y: kind === "Fixed" ? String(y) : "" };
  renderLeafControls();
  changed();
  say(kind ? `${leaf} is pinned: ${conditionTag(state.conditions[leaf])}.` : `${leaf} is free to go anywhere on the sheet.`);
}

function mirrorOf(leaf) {
  const m = state.mirrors.find((p) => p.a === leaf || p.b === leaf);
  return m ? (m.a === leaf ? m.b : m.a) : null;
}

/** Pairs two leaves (x_a + x_b = N, y_a = y_b), dropping any pair either was in. */
function setMirror(a, b) {
  const dropped = state.mirrors.filter((p) => [p.a, p.b].some((l) => l === a || l === b));
  state.mirrors = state.mirrors.filter((p) => !dropped.includes(p));
  state.mirrors.push({ a, b });
  renderLeafControls();
  changed();
  const len = (leaf) => Number(state.edges.find((e) => e.from.trim() === leaf || e.to.trim() === leaf)?.length);
  const note = len(a) !== len(b)
    ? ` Their edges differ (${fmt(len(a), 3)} and ${fmt(len(b), 3)}), so the layout mirrors but the flaps won't match.`
    : "";
  const was = dropped.length ? ` (replacing ${dropped.map((p) => `${p.a} ↔ ${p.b}`).join(", ")})` : "";
  say(`${a} ↔ ${b} mirror each other${was}.${note}`);
}

function removeMirror(leaf) {
  const other = mirrorOf(leaf);
  state.mirrors = state.mirrors.filter((p) => p.a !== leaf && p.b !== leaf);
  renderLeafControls();
  changed();
  say(`${leaf} and ${other} no longer mirror each other.`);
}

function startMirrorPick(leaf) {
  closeLeafMenu();
  treeUi.pick = { from: leaf };
  say(`Click the leaf that mirrors ${leaf}. Esc cancels.`);
  renderTreePreview();
}

function cancelMirrorPick() {
  if (!treeUi.pick) return;
  treeUi.pick = null;
  say("");
  renderTreePreview();
}

/** A click (no drag) on a vertex: finishes a mirror pick, or opens the leaf's menu. */
function vertexClicked(v) {
  const info = treeInfo(state.edges);
  const leaf = info.leaves.includes(v);
  if (treeLocked()) {
    if (!stubbing()) { linked.pin(leaf ? v : null); return; }
    if (!stubTool.jointClicked(v)) say(leaf ? "A stub hangs from a joint: click a vertex with two or more edges." : "Pick an open region first.");
    return;
  }
  if (treeUi.pick) {
    const from = treeUi.pick.from;
    treeUi.pick = null;
    if (leaf && v !== from) setMirror(from, v);
    else { say(leaf ? "" : "Only leaves can mirror each other."); renderTreePreview(); }
    return;
  }
  if (leaf) openLeafMenu(v);
}

function closeLeafMenu() {
  document.querySelector(".leaf-menu")?.remove();
}

/** The menu a click on a leaf opens: pin it on the sheet, put it on the axis or at a point, or mirror it. */
function openLeafMenu(leaf) {
  closeLeafMenu();
  const stage = $("treeView").parentElement;
  const svg = $("treeView");
  const c = state.conditions[leaf] ?? { kind: "", x: "", y: "" };
  const n = Number($("gridSize").value);
  const node = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  const menu = node("div", { class: "leaf-menu", role: "dialog", "aria-label": `Conditions for leaf ${leaf}` });
  const close = node("button", { type: "button", class: "lm-close", "aria-label": "Close", text: "✕" });
  close.addEventListener("click", closeLeafMenu);
  menu.append(node("div", { class: "lm-head" }, node("b", { text: leaf }), node("span", { class: "lm-now", text: conditionTag(c) || "free" }), close));

  // Pin on the sheet: a little picture of the sheet with its corners, edges and centre.
  menu.append(node("div", { class: "lm-label", text: "Pin to the sheet" }));
  const sheet = node("div", { class: "lm-sheet", role: "group", "aria-label": "Pin to the sheet" });
  SHEET_PINS.forEach(([kind, label], k) => {
    const spot = k === 4 ? "free" : [0, 2, 6, 8].includes(k) ? "corner" : "edge";
    const b = node("button", { type: "button", class: `lm-pin ${spot} p${k}`, title: label, "aria-label": label, "aria-pressed": String(c.kind === kind) });
    if (k === 4) b.textContent = "free";
    b.addEventListener("click", () => { setCondition(leaf, kind); closeLeafMenu(); });
    sheet.append(b);
  });
  menu.append(sheet);

  // The symmetry axis (needs an even N) and a grid point.
  const axis = node("button", { type: "button", class: "lm-btn", "aria-pressed": String(c.kind === "OnSymmetryAxis"), text: "On the symmetry axis (2x = N)" });
  if (n % 2 !== 0) { axis.disabled = true; axis.title = "Needs an even grid size N, so the axis x = N/2 is a grid line"; }
  axis.addEventListener("click", () => { setCondition(leaf, "OnSymmetryAxis"); closeLeafMenu(); });
  const px = node("input", { type: "number", min: 0, max: n, step: 1, value: c.kind === "Fixed" ? c.x : "", "aria-label": "x", placeholder: "x" });
  const py = node("input", { type: "number", min: 0, max: n, step: 1, value: c.kind === "Fixed" ? c.y : "", "aria-label": "y", placeholder: "y" });
  const at = node("button", { type: "button", class: "lm-btn", "aria-pressed": String(c.kind === "Fixed"), text: "At grid point" });
  const pinAt = () => {
    const x = Number(px.value), y = Number(py.value);
    if (px.value === "" || py.value === "" || ![x, y].every((v) => Number.isInteger(v) && v >= 0 && v <= n)) {
      say(`A grid point has whole coordinates from 0 to ${n}.`);
      return;
    }
    setCondition(leaf, "Fixed", x, y);
    closeLeafMenu();
  };
  at.addEventListener("click", pinAt);
  for (const input of [px, py]) input.addEventListener("keydown", (e) => { if (e.key === "Enter") pinAt(); });
  menu.append(node("div", { class: "lm-row" }, axis), node("div", { class: "lm-row" }, at, px, py));

  // Mirror pair.
  menu.append(node("div", { class: "lm-label", text: "Mirror (book symmetry)" }));
  const other = mirrorOf(leaf);
  if (other) {
    const remove = node("button", { type: "button", class: "lm-btn", text: "Remove" });
    remove.addEventListener("click", () => { removeMirror(leaf); closeLeafMenu(); });
    const change = node("button", { type: "button", class: "lm-btn", text: "Change…" });
    change.addEventListener("click", () => startMirrorPick(leaf));
    menu.append(node("div", { class: "lm-row" }, node("span", { class: "lm-pair", text: `${leaf} ↔ ${other}` }), change, remove));
  } else {
    const pick = node("button", { type: "button", class: "lm-btn", text: "Mirror with another leaf…" });
    pick.addEventListener("click", () => startMirrorPick(leaf));
    menu.append(node("div", { class: "lm-row" }, pick));
  }

  // Beside the leaf (right of it if there is room, else left), kept inside the drawing.
  stage.append(menu);
  const spot = toStage(...treeUi.geometry.px.get(leaf));
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const minX = spot.minX + 4, maxX = spot.maxX - w - 4;
  const left = spot.x + 18 <= maxX ? spot.x + 18 : Math.max(minX, spot.x - 18 - w);
  const top = Math.min(Math.max(spot.minY + 4, spot.y - h / 2), spot.maxY - h - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  (menu.querySelector("[aria-pressed=true]") ?? menu.querySelector("button"))?.focus({ preventScroll: true });
}

const HIT_VERTEX = 18;
const HIT_EDGE = 10;

function resetTreeLayout() {
  treeUi.pos.clear();
  treeUi.handPlaced = false;
}

// ───────────────────────── Layout ─────────────────────────

/**
 * The leaves of the layout on the workbench, in drawing coordinates (x right, y down: the sheet's y is up), when that
 * layout belongs to this tree (same edges in the same order). Null otherwise. The sketches use it to face the same
 * way as the sheet, so the tree, the crease pattern and the folded base read alike.
 */
function sheetPoints(edges) {
  const layout = typeof workbench !== "undefined" ? workbench.layout : null;
  const theirs = layout?.problem?.edges;
  if (!layout?.points?.length || !theirs || theirs.length !== edges.length) return null;
  if (!theirs.every((e, k) => e.from === edges[k].from && e.to === edges[k].to)) return null;
  return new Map(layout.points.map((p) => [p.leaf, [p.x, -p.y]]));
}

/**
 * Turns a drawing (raw coordinates, y down) to face the way the leaves sit on the sheet: the rotation, with or
 * without a mirror image, that best matches the leaves' directions from their centre (2D Procrustes). With
 * `flipsOnly` (the bilateral drawing, whose body must stay vertical), only the four flips of the axes are tried.
 * Rotations and mirror images keep every length, so the folded base stays to scale.
 */
function alignToSheet(raw, sheet, { flipsOnly = false } = {}) {
  if (!sheet) return raw;
  const common = [...sheet.keys()].filter((v) => raw.has(v));
  if (common.length < 2) return raw;
  const mean = (pts) => pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  const ca = mean(common.map((v) => raw.get(v))), cb = mean(common.map((v) => sheet.get(v)));
  const A = common.map((v) => [raw.get(v)[0] - ca[0], raw.get(v)[1] - ca[1]]);
  const B = common.map((v) => [sheet.get(v)[0] - cb[0], sheet.get(v)[1] - cb[1]]);
  // Candidate transforms as 2×2 matrices [a, b, c, d]: (x, y) → (a·x + b·y, c·x + d·y).
  const candidates = [];
  if (flipsOnly) {
    for (const sx of [1, -1]) for (const sy of [1, -1]) candidates.push([sx, 0, 0, sy]);
  } else {
    for (const m of [1, -1]) {          // m = -1: mirror x first
      let sxx = 0, sxy = 0;
      A.forEach(([x, y], k) => { const [u, v] = B[k]; sxx += m * x * u + y * v; sxy += m * x * v - y * u; });
      const t = Math.atan2(sxy, sxx), c = Math.cos(t), s = Math.sin(t);
      candidates.push([c * m, -s, s * m, c]);
    }
  }
  const score = ([a, b, c, d]) => A.reduce((sum, [x, y], k) => sum + (a * x + b * y) * B[k][0] + (c * x + d * y) * B[k][1], 0);
  const best = candidates.reduce((p, q) => (score(q) > score(p) ? q : p));
  const [a, b, c, d] = best;
  return new Map([...raw].map(([v, [x, y]]) => [v, [a * x + b * y, c * x + d * y]]));
}

/** Fits raw coordinates (any scale, y down) into the unit square of a width × height box, keeping the shape. */
function fitLayout(raw, width, height) {
  const out = new Map();
  const xs = [...raw.values()].map((p) => p[0]), ys = [...raw.values()].map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit = Math.min(width / Math.max(1e-9, maxX - minX), height / Math.max(1e-9, maxY - minY));
  const offX = (width - fit * (maxX - minX)) / 2, offY = (height - fit * (maxY - minY)) / 2;
  for (const [v, [x, y]] of raw) out.set(v, [(offX + (x - minX) * fit) / width, (offY + (y - minY) * fit) / height]);
  return out;
}

/**
 * Bilateral layout for a tree with left–right mirror pairs (the centipedes): the body is a straight vertical
 * line, and each mirrored flap hangs off it on its own side, drawn as the exact mirror image of its partner.
 * The body is the path through the vertex halfway between each mirror pair (the middle of the path joining them).
 * Returns null when the pairs don't describe such a body, and the caller falls back to the radial layout.
 * Used by the tree editor (a sketch: short body segments are spaced out) and by the folded base (`toScale`: the
 * stick figure keeps the true edge lengths; `edges` and `lengths` are the base's own).
 */
function bilateralLayout(info, mirrors, { edges = state.edges, lengths = null, toScale = false } = {}) {
  if (!mirrors.length || !isTree(info, edges)) return null;
  const lengthOf = (edge) => Math.max(0.05, Number(lengths ? lengths[edge] : edges[edge].length) || 0.05);
  // Tree distances from a vertex, and the path between two vertices.
  const walk = (from) => {
    const dist = new Map([[from, 0]]), prev = new Map([[from, null]]);
    const queue = [from];
    for (let k = 0; k < queue.length; k++) {
      for (const { to, edge } of info.adjacency.get(queue[k])) {
        if (!dist.has(to)) { dist.set(to, dist.get(queue[k]) + lengthOf(edge)); prev.set(to, queue[k]); queue.push(to); }
      }
    }
    return { dist, prev };
  };
  const side = new Map();        // leaf -> -1 (left, the pair's first leaf) | +1 (right)
  const axis = new Set();
  for (const { a, b } of mirrors) {
    if (!info.adjacency.has(a) || !info.adjacency.has(b)) continue;
    side.set(a, -1); side.set(b, +1);
    // The body vertex between a pair is the middle vertex of the path joining them, counted in edges, so it
    // doesn't move when strain makes the two sides' lengths differ slightly.
    const { prev: back } = walk(a);
    const path = [];
    for (let v = b; v != null; v = back.get(v)) path.push(v);
    if (path.length % 2 === 1) axis.add(path[(path.length - 1) / 2]);
  }
  if (!axis.size) return null;
  // The body: the smallest subtree joining the axis vertices. It must be a path to be drawn as a line.
  const start = [...axis][0];
  const { prev } = walk(start);
  const body = new Set();
  for (const v of axis) for (let u = v; u != null && !body.has(u); u = prev.get(u)) body.add(u);
  const ends = [...body].filter((v) => info.adjacency.get(v).filter(({ to }) => body.has(to)).length <= 1);
  if (ends.length > 2) return null;
  // Order the body from one end to the other; the end that appears first in the edge list is the head (top).
  const firstIndex = (v) => edges.findIndex((e) => e.from === v || e.to === v);
  const head = ends.length === 2 ? (firstIndex(ends[0]) <= firstIndex(ends[1]) ? ends[0] : ends[1]) : start;
  const spine = [head];
  const y = new Map([[head, 0]]);
  for (;;) {
    const last = spine[spine.length - 1];
    const next = info.adjacency.get(last).find(({ to }) => body.has(to) && !y.has(to));
    if (!next) break;
    y.set(next.to, y.get(last) + lengthOf(next.edge));
    spine.push(next.to);
  }
  if (spine.length !== body.size) return null;

  const raw = new Map(spine.map((v) => [v, [0, y.get(v)]]));
  // Each vertex's tree distance from the body, to tell long flaps from short ones.
  const fromBody = new Map(spine.map((v) => [v, 0]));
  for (const queue = [...spine]; queue.length;) {
    const v = queue.shift();
    for (const { to, edge } of info.adjacency.get(v)) {
      if (!fromBody.has(to)) { fromBody.set(to, fromBody.get(v) + lengthOf(edge)); queue.push(to); }
    }
  }
  // Unless the drawing must be to scale (the folded base), space the body out to at least 60% of a typical
  // flap's reach, so short body segments between long legs don't stack the legs on top of each other.
  const reaches = info.vertices.filter((v) => info.adjacency.get(v).length === 1).map((v) => fromBody.get(v)).sort((p, q) => p - q);
  const typical = reaches.length ? reaches[Math.floor(reaches.length / 2)] : 1;
  for (let k = 1; k < spine.length; k++) {
    const step = info.adjacency.get(spine[k - 1]).find(({ to }) => to === spine[k]).edge;
    y.set(spine[k], y.get(spine[k - 1]) + (toScale ? lengthOf(step) : Math.max(lengthOf(step), 0.6 * typical)));
  }
  for (const v of spine) raw.set(v, [0, y.get(v)]);
  // Each flap: the subtree off a body vertex. Its side comes from its paired leaves; unpaired flaps go on the axis.
  const leavesUnder = (root, parent) => {
    const out = [];
    const stack = [[root, parent]];
    while (stack.length) {
      const [v, p] = stack.pop();
      const next = info.adjacency.get(v).filter(({ to }) => to !== p);
      if (!next.length) out.push(v);
      for (const { to } of next) stack.push([to, v]);
    }
    return out;
  };
  const partner = new Map();
  for (const { a, b } of mirrors) { partner.set(a, b); partner.set(b, a); }
  // A side-independent key, so a left flap and its right mirror sort to the same place.
  const keyOf = (leaves) => leaves.map((l) => (side.get(l) === +1 ? partner.get(l) : l)).sort()[0] ?? "";
  // Draws a flap as a small fan around a direction (radians, x right, y down), mirrored on the right.
  const place = (root, parent, origin, dir, spread, mirror) => {
    const fan = (v, p, at, angle, width) => {
      const kids = info.adjacency.get(v).filter(({ to }) => to !== p)
        .map(({ to, edge }) => ({ to, edge, leaves: leavesUnder(to, v) }))
        .sort((s, t) => (keyOf(s.leaves) < keyOf(t.leaves) ? -1 : 1));
      const total = kids.reduce((s, k) => s + k.leaves.length, 0);
      let a = angle - width / 2;
      for (const k of kids) {
        const w = width * k.leaves.length / total;
        const theta = a + w / 2;
        const len = lengthOf(k.edge);
        const pt = [at[0] + mirror * len * Math.cos(theta), at[1] + len * Math.sin(theta)];
        raw.set(k.to, pt);
        fan(k.to, v, pt, theta, w * 0.8);
        a += w;
      }
    };
    const len = lengthOf(info.adjacency.get(parent).find(({ to }) => to === root).edge);
    const pt = [origin[0] + mirror * len * Math.cos(dir), origin[1] + len * Math.sin(dir)];
    raw.set(root, pt);
    fan(root, parent, pt, dir, spread);
  };
  spine.forEach((s, i) => {
    const flaps = info.adjacency.get(s).filter(({ to }) => !body.has(to)).map(({ to }) => {
      const leaves = leavesUnder(to, s);
      const sides = new Set(leaves.map((l) => side.get(l) ?? 0));
      return { to, leaves, side: sides.size === 1 ? [...sides][0] : 0 };
    });
    const isHead = i === 0, isTail = i === spine.length - 1;
    // Left flaps point left (angle π, x right and y down), spread from up-left to down-left: forward at the
    // head, backward at the tail, straight out in the middle. Each right flap is drawn as its left mate's mirror.
    const [up, down] = isHead && isTail ? [0.35, 0.35] : isHead ? [0.45, 0.1] : isTail ? [0.1, 0.45] : [0.2, 0.2];
    // At the head the longest flaps (antennae) lean furthest forward, at the tail the longest (cerci) furthest back.
    const reach = (f) => Math.max(...f.leaves.map((l) => fromBody.get(l)));
    const byKey = (f, g) => (keyOf(f.leaves) < keyOf(g.leaves) ? -1 : 1);
    const order = isHead && !isTail ? (f, g) => reach(g) - reach(f) || byKey(f, g)
      : isTail && !isHead ? (f, g) => reach(f) - reach(g) || byKey(f, g) : byKey;
    const left = flaps.filter((f) => f.side === -1).sort(order);
    const right = flaps.filter((f) => f.side === +1);
    const n = left.length;
    left.forEach((f, k) => {
      const t = n === 1 ? 0.5 : k / (n - 1);
      const dir = Math.PI + Math.PI * (up - t * (up + down));
      const spread = Math.min(0.8, Math.PI * (up + down) / Math.max(1, n));
      place(f.to, s, [0, y.get(s)], dir, spread, 1);
      const mate = right.find((g) => keyOf(g.leaves) === keyOf(f.leaves));
      if (mate) place(mate.to, s, [0, y.get(s)], dir, spread, -1);
    });
    // Right flaps without a left mate, then flaps on the axis (out of the head or the tail).
    for (const g of right) if (!raw.has(g.to)) place(g.to, s, [0, y.get(s)], Math.PI, 0.6, -1);
    const middle = flaps.filter((f) => f.side === 0);
    middle.forEach((f, k) => {
      const dir = isHead && !isTail ? -Math.PI / 2 : Math.PI / 2;    // out of the head upward, else downward
      place(f.to, s, [0, y.get(s)], dir + (k - (middle.length - 1) / 2) * 0.35, 0.5, 1);
    });
  });
  return raw.size === info.vertices.length ? raw : null;
}

/** Radial layout from the centre, in unit coordinates fitted to the drawing's aspect ratio. */
function autoLayout(info, width, height, { edges = state.edges, mirrors = state.mirrors ?? [], sheet = sheetPoints(edges) } = {}) {
  // The editor draws the editor's tree, facing the workbench layout; the workflow document draws other trees by
  // passing their edges, mirror pairs and leaf points.
  const out = new Map();
  if (!info.vertices.length) return out;
  const bilateral = bilateralLayout(info, mirrors, { edges });
  if (bilateral) return fitLayout(alignToSheet(bilateral, sheet, { flipsOnly: true }), width, height);
  if (!isTree(info, edges)) {
    info.vertices.forEach((v, k) => {
      const a = (2 * Math.PI * k) / info.vertices.length - Math.PI / 2;
      out.set(v, [0.5 + 0.42 * Math.cos(a), 0.5 + 0.42 * Math.sin(a)]);
    });
    return out;
  }
  const root = treeCentre(info);
  const parentOf = new Map([[root, null]]);
  const order = [root];
  for (let k = 0; k < order.length; k++) {
    for (const { to } of info.adjacency.get(order[k])) {
      if (!parentOf.has(to)) { parentOf.set(to, order[k]); order.push(to); }
    }
  }
  const children = new Map(order.map((v) => [v, []]));
  const edgeOf = new Map();
  for (const v of order) {
    for (const { to, edge } of info.adjacency.get(v)) {
      if (parentOf.get(to) === v) { children.get(v).push(to); edgeOf.set(to, edge); }
    }
  }
  const leafCount = new Map();
  for (const v of [...order].reverse()) {
    const c = children.get(v);
    leafCount.set(v, c.length ? c.reduce((s, x) => s + leafCount.get(x), 0) : 1);
  }
  const depth = new Map([[root, 0]]);
  const angle = new Map([[root, 0]]);
  const assign = (v, start, end) => {
    angle.set(v, (start + end) / 2);
    let a = start;
    for (const c of children.get(v)) {
      const span = (end - start) * leafCount.get(c) / leafCount.get(v);
      depth.set(c, depth.get(v) + Math.max(0.05, Number(edges[edgeOf.get(c)].length) || 0.05));
      assign(c, a, a + span);
      a += span;
    }
  };
  assign(root, -Math.PI / 2, 1.5 * Math.PI);

  const raw = new Map(order.map((v) => [v, [depth.get(v) * Math.cos(angle.get(v)), depth.get(v) * Math.sin(angle.get(v))]]));
  return fitLayout(alignToSheet(raw, sheet), width, height);
}

/** Keep hand-placed vertices where they are; place new ones relative to a placed neighbour. */
function settlePositions(info, width, height) {
  for (const v of [...treeUi.pos.keys()]) if (!info.adjacency.has(v)) treeUi.pos.delete(v);
  const missing = info.vertices.filter((v) => !treeUi.pos.has(v));
  if (!missing.length) return;
  const auto = autoLayout(info, width, height);
  if (treeUi.pos.size === 0) {
    for (const [v, p] of auto) treeUi.pos.set(v, p);
    return;
  }
  // Breadth-first from placed vertices, so a new chain grows outward from what the user arranged.
  let progress = true;
  while (progress) {
    progress = false;
    for (const v of info.vertices) {
      if (treeUi.pos.has(v)) continue;
      const anchor = info.adjacency.get(v).map((n) => n.to).find((n) => treeUi.pos.has(n));
      if (!anchor) continue;
      const [ax, ay] = treeUi.pos.get(anchor);
      const [vx, vy] = auto.get(v), [nx, ny] = auto.get(anchor);
      treeUi.pos.set(v, [clamp01(ax + (vx - nx)), clamp01(ay + (vy - ny))]);
      progress = true;
    }
  }
  for (const v of info.vertices) if (!treeUi.pos.has(v)) treeUi.pos.set(v, auto.get(v));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// ───────────────────────── Rendering ─────────────────────────

function renderTreePreview() {
  const svg = $("treeView");
  const stage = svg.parentElement;
  const width = Math.max(200, svg.clientWidth || 400);
  const height = Math.max(160, svg.clientHeight || 360);
  const expanded = stage.classList.contains("expanded");
  const pad = expanded ? 56 : 34;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const info = treeInfo(state.edges);
  const named = state.edges.filter((e) => e.from.trim() && e.to.trim());
  const error = $("treeError");
  const tree = info.vertices.length > 0 && isTree(info, named) && named.length === state.edges.length;
  error.hidden = tree || !state.edges.length;
  if (!error.hidden) {
    error.textContent = "These edges don't form a tree yet. A tree is connected, with one more vertex than edges.";
  }

  settlePositions(info, width - 2 * pad, height - 2 * pad);
  const px = new Map([...treeUi.pos].map(([v, [u, w]]) => [v, [pad + u * (width - 2 * pad), pad + w * (height - 2 * pad)]]));
  treeUi.geometry = { width, height, pad, px };

  if (!info.vertices.length) {
    const hint = el("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "canvas-hint" });
    hint.textContent = "Drag a leaf here to start a tree";
    svg.append(hint);
  }

  const hover = treeUi.hover;
  const dragging = treeUi.drag;

  // Grid units, as on the sheet: the background is the N × N grid at the sheet's size (one cell = one grid unit), and
  // each leaf circle has the sheet's radius m·ℓ grid units. m is the workbench layout's scale when the layout is of
  // this tree; before a solve it is m̄ = √2·N / (longest leaf-to-leaf path), the largest any layout can reach, so the
  // circles show the most each flap could take. The edges stay a sketch: their drawn lengths are not to scale.
  const sheet = sheetScale(info);
  const unit = Math.min(width, height) / sheet.N;
  const grid = el("g", { class: "unit-grid" });
  const [ox, oy] = [(width - unit * sheet.N) / 2, (height - unit * sheet.N) / 2];
  for (let k = 0; k <= sheet.N; k++) {
    grid.append(el("line", { x1: ox + k * unit, y1: oy, x2: ox + k * unit, y2: oy + sheet.N * unit, class: k % 5 ? "" : "major" }));
    grid.append(el("line", { x1: ox, y1: oy + k * unit, x2: ox + sheet.N * unit, y2: oy + k * unit, class: k % 5 ? "" : "major" }));
  }
  svg.append(grid);
  svg.classList.add("gridded");
  if ($("treeCircles")?.checked !== false && sheet.m > 0) {
    state.edges.forEach((e, k) => {
      const l = sheet.lengths?.[k] ?? Number(e.length);
      for (const v of [e.from.trim(), e.to.trim()]) {
        const a = px.get(v);
        if (a && l > 0 && info.leaves.includes(v)) svg.append(el("circle", { cx: a[0], cy: a[1], r: sheet.m * l * unit, class: "leaf-reach" }));
      }
    });
  }
  const scaleNote = el("text", { x: 10, y: height - 10, class: "unit-note" });
  scaleNote.textContent = `1 cell = 1 grid unit (N = ${sheet.N}) · circles m·ℓ with ` +
    (sheet.from === "layout" ? `m = ${fmt(sheet.m, 3)} (this step's layout)` : `m̄ = ${fmt(sheet.m, 3)}, the most possible`);
  svg.append(scaleNote);

  // Edges: a wide invisible stroke for clicking, then the drawn edge.
  state.edges.forEach((e, index) => {
    const a = px.get(e.from.trim()), b = px.get(e.to.trim());
    if (!a || !b) return;
    const target = hover?.kind === "edge" && hover.index === index;
    const hit = el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "edge-hit", "data-edge": index });
    const title = el("title");
    title.textContent = document.body.dataset.stretch === "off"
      ? `${e.from}–${e.to}`
      : `${e.from}–${e.to}: click to ${e.stretch ? "remove from" : "add to"} the stretch set S`;
    hit.append(title);
    svg.append(
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "edge" + (e.stretch ? " stretch" : "") + (target ? " target" : ""), "data-edge-line": index }),
      hit,
    );
  });

  // Length labels, offset to one side of each edge.
  state.edges.forEach((e, index) => {
    const a = px.get(e.from.trim()), b = px.get(e.to.trim());
    if (!a || !b) return;
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let [nx, ny] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    if (ny > 0) { nx = -nx; ny = -ny; }
    // Each length is a small tag that opens an editor when clicked.
    const text = fmt(Number(e.length), 3);
    const w = 14 + text.length * 7.2, h = 20;
    const cx = mx + nx * 15, cy = my + ny * 15;
    const tag = el("g", { class: "length-tag", "data-length": index, tabindex: 0, role: "button", "aria-label": `Length of ${e.from}–${e.to}: ${text}. Press Enter to edit.` });
    tag.append(
      el("rect", { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 10 }),
      Object.assign(el("text", { x: cx, y: cy + 4.5, "text-anchor": "middle" }), { textContent: text }),
    );
    const title = el("title");
    title.textContent = "Click to change the length";
    tag.append(title);
    svg.append(tag);
  });

  // Mirror pairs: a dashed line between the two leaves.
  for (const m of state.mirrors) {
    const a = px.get(m.a), b = px.get(m.b);
    if (!a || !b) continue;
    const line = el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "mirror-link" });
    const title = el("title");
    title.textContent = `${m.a} ↔ ${m.b}: mirrored (x_a + x_b = N, y_a = y_b)`;
    line.append(title);
    svg.append(line);
  }

  // The proposed stub (Add stubs node): a dashed edge out from its joint, away from the joint's other edges.
  const stub = stubbing() ? treeUi.stub : null;
  if (stub?.attach && px.has(stub.attach)) {
    const [ax, ay] = px.get(stub.attach);
    // Out through the widest gap between the joint's edges.
    const angles = (info.adjacency.get(stub.attach) ?? []).map(({ to }) => {
      const [wx, wy] = px.get(to);
      return Math.atan2(wy - ay, wx - ax);
    }).sort((a, b) => a - b);
    let dir = -Math.PI / 2;
    if (angles.length) {
      let gap = -1;
      angles.forEach((a, k) => {
        const next = k + 1 < angles.length ? angles[k + 1] : angles[0] + 2 * Math.PI;
        if (next - a > gap) { gap = next - a; dir = a + gap / 2; }
      });
    }
    const [dx, dy] = [Math.cos(dir), Math.sin(dir)];
    const [sx, sy] = [ax + dx * 46, ay + dy * 46];
    const g = el("g", { class: "stub-preview" });
    g.append(el("line", { x1: ax, y1: ay, x2: sx, y2: sy }), el("circle", { cx: sx, cy: sy, r: 7 }),
      Object.assign(el("text", { x: sx + (dx >= 0 ? 10 : -10), y: sy + 4, "text-anchor": dx >= 0 ? "start" : "end" }), { textContent: stub.label }));
    svg.append(g);
  }

  const picking = treeUi.pick;
  for (const v of info.vertices) {
    const [x, y] = px.get(v);
    const leaf = info.adjacency.get(v).length === 1;
    const isDragged = dragging?.kind === "vertex" && dragging.v === v;
    const target = hover?.kind === "vertex" && hover.v === v;
    const choosingJoint = treeUi.stub && stubbing();
    const pickClass = picking ? (v === picking.from ? " pick-from" : leaf ? " pickable" : "")
      : choosingJoint && !leaf ? (v === treeUi.stub.attach ? " pick-from" : " pickable") : "";
    const g = el("g", { class: "vertex-group" + (isDragged ? " dragged" : "") + (target ? " target" : "") + pickClass, "data-vertex": v });
    g.append(
      el("circle", { cx: x, cy: y, r: HIT_VERTEX, class: "vertex-hit" }),
      el("circle", { cx: x, cy: y, r: leaf ? 7 : 6, class: "vertex" + (leaf ? " leaf" : "") }),
    );
    const t = el("text", { x: x + 11, y: y - 10, class: "vertex-label" });
    t.textContent = v;
    const title = el("title");
    title.textContent = treeLocked()
      ? (leaf ? v : `${v}: click to hang the stub here (click again to let the search choose)`)
      : leaf
        ? `${v}: click to pin it or mirror it; drag to move or re-attach, double-click to rename`
        : `${v}: drag to move or re-attach, double-click to rename`;
    g.append(t, title);
    // The leaf's condition, as a small tag under its name.
    const tag = leaf ? conditionTag(state.conditions[v]) : "";
    if (tag) {
      const tw = 10 + tag.length * 6.2;
      const ctag = el("g", { class: "cond-tag" });
      ctag.append(el("rect", { x: x + 9, y: y - 4, width: tw, height: 16, rx: 8 }),
        Object.assign(el("text", { x: x + 9 + tw / 2, y: y + 7.5, "text-anchor": "middle" }), { textContent: tag }));
      g.append(ctag);
    }
    svg.append(g);
  }

  // The bin appears while a vertex is being dragged.
  if (dragging?.kind === "vertex" && dragging.moved) {
    const r = binRect();
    const bin = el("g", { class: "bin" + (hover?.kind === "bin" ? " target" : "") });
    bin.append(el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6 }));
    const label = el("text", { x: r.x + r.w / 2, y: r.y + r.h / 2 + 4, "text-anchor": "middle" });
    label.textContent = "Drop to delete";
    bin.append(label);
    svg.append(bin);
  }

  // A ghost of the chip being dragged in.
  if (dragging?.kind === "new" && dragging.inside) {
    const ghost = el("circle", {
      cx: dragging.x, cy: dragging.y, r: dragging.type === "leaf" ? 7 : 6,
      class: "vertex ghost" + (dragging.type === "leaf" ? " leaf" : ""),
    });
    svg.append(ghost);
  }

  const msg = $("treeMessage");
  msg.textContent = treeUi.message;
  msg.hidden = !treeUi.message;
  linked.apply();
}

/**
 * The sheet's scale for drawing the tree in grid units: the workbench layout's scale and edge lengths when that layout
 * is of this tree, otherwise m̄ = √2·N / (longest leaf-to-leaf path), the bound every solver starts from.
 */
function sheetScale(info) {
  const N = Math.max(1, Math.round(Number($("gridSize")?.value) || 9));
  const held = typeof workbench !== "undefined" ? workbench.layout : null;
  if (held && held.scale > 0 && held.gridSize === N && sameTreeShape(held.problem, buildProblem())) {
    return { N, m: held.scale, lengths: held.edgeLengths ?? null, from: "layout" };
  }
  // The longest leaf-to-leaf path: the farthest vertex from any vertex, then the farthest from that one.
  const far = (from) => {
    const d = new Map([[from, 0]]);
    const queue = [from];
    for (let k = 0; k < queue.length; k++) {
      for (const { to, edge } of info.adjacency.get(queue[k]) ?? []) {
        if (!d.has(to)) { d.set(to, d.get(queue[k]) + (Number(state.edges[edge].length) || 0)); queue.push(to); }
      }
    }
    return [...d].reduce((best, cur) => (cur[1] > best[1] ? cur : best), [from, 0]);
  };
  const start = info.leaves[0];
  const diameter = start ? far(far(start)[0])[1] : 0;
  return { N, m: diameter > 0 ? (Math.SQRT2 * N) / diameter : 0, lengths: null, from: "bound" };
}

function binRect() {
  const { width, height } = treeUi.geometry;
  return { x: width - 132, y: height - 46, w: 120, h: 34 };
}

// ───────────────────────── Hit testing ─────────────────────────

function svgPoint(event) {
  const r = $("treeView").getBoundingClientRect();
  return [event.clientX - r.left, event.clientY - r.top, r];
}

function hitTest(x, y, exclude) {
  const { px } = treeUi.geometry;
  const b = binRect();
  if (treeUi.drag?.kind === "vertex" && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
    return { kind: "bin" };
  }
  let best = null, bestD = HIT_VERTEX;
  for (const [v, [vx, vy]] of px) {
    if (v === exclude) continue;
    const d = Math.hypot(vx - x, vy - y);
    if (d < bestD) { best = v; bestD = d; }
  }
  if (best) return { kind: "vertex", v: best };
  if (treeUi.drag?.kind !== "new") return null;
  let edge = null, edgeD = HIT_EDGE;
  state.edges.forEach((e, index) => {
    const a = px.get(e.from.trim()), c = px.get(e.to.trim());
    if (!a || !c) return;
    const d = segmentDistance(x, y, a, c);
    if (d < edgeD) { edge = index; edgeD = d; }
  });
  return edge === null ? null : { kind: "edge", index: edge };
}

function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function toUnit(x, y) {
  const { width, height, pad } = treeUi.geometry;
  return [clamp01((x - pad) / (width - 2 * pad)), clamp01((y - pad) / (height - 2 * pad))];
}

// ───────────────────────── Edits ─────────────────────────

function commitStructure(message = "") {
  treeUi.message = message;
  renderEdges();
  changed({ structure: true });
}

function say(message) {
  treeUi.message = message;
  renderTreePreview();
}

function pathEdges(info, from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift();
    if (v === to) break;
    for (const { to: w, edge } of info.adjacency.get(v)) {
      if (!prev.has(w)) { prev.set(w, { v, edge }); queue.push(w); }
    }
  }
  if (!prev.has(to)) return null;
  const edges = [];
  for (let v = to; prev.get(v); v = prev.get(v).v) edges.unshift(prev.get(v).edge);
  return edges;
}

/** Cut the first edge on the path v → t and reconnect v's side to t, keeping the edge's length and S flag. */
function reattach(v, t) {
  const info = treeInfo(state.edges);
  const path = pathEdges(info, v, t);
  if (!path) return say("Those two vertices aren't connected yet.");
  if (path.length === 1) return say(`${v} is already joined to ${t}.`);
  const e = state.edges[path[0]];
  if (e.from.trim() === v) e.to = t; else e.from = t;
  commitStructure(`Moved ${v} onto ${t}.`);
}

function removeVertex(v) {
  const info = treeInfo(state.edges);
  const adjacent = info.adjacency.get(v) ?? [];
  if (adjacent.length === 1) {
    state.edges.splice(adjacent[0].edge, 1);
    return commitStructure(`Deleted ${v}.`);
  }
  if (adjacent.length === 2) {
    const [first, second] = adjacent;
    const keep = state.edges[first.edge], drop = state.edges[second.edge];
    keep.from = first.to;
    keep.to = second.to;
    keep.length = String(Number(keep.length) + Number(drop.length));
    keep.stretch = keep.stretch || drop.stretch;
    state.edges.splice(second.edge, 1);
    return commitStructure(`Merged the two edges through ${v}.`);
  }
  // Prune the branch on the far side of v from the tree's centre.
  const root = treeCentre(info);
  if (root === v) return say(`${v} is the centre of the tree; drag its branches away first.`);
  const toRoot = pathEdges(info, v, root);
  const cut = toRoot[0];
  const doomed = new Set([cut]);
  const seen = new Set([v]);
  const stack = [v];
  while (stack.length) {
    const w = stack.pop();
    for (const { to, edge } of info.adjacency.get(w)) {
      if (edge === cut || seen.has(to)) continue;
      seen.add(to);
      doomed.add(edge);
      stack.push(to);
    }
  }
  state.edges = state.edges.filter((_, i) => !doomed.has(i));
  commitStructure(`Deleted ${v} and the ${seen.size - 1} vertices beyond it.`);
}

function newLeafName(info) {
  if (info.leaves.length && info.leaves.every((l) => /^\d+$/.test(l))) {
    return String(Math.max(...info.leaves.map(Number)) + 1);
  }
  for (let k = 1; ; k++) if (!info.adjacency.has(String(k)) && !info.adjacency.has("L" + k)) {
    return info.leaves.some((l) => /^\d+$/.test(l)) || !info.leaves.length ? String(k) : "L" + k;
  }
}

function newJointName(info) {
  for (const c of "uvwabcdefghijkmnpqrstxyz") if (!info.adjacency.has(c)) return c;
  for (let k = 1; ; k++) if (!info.adjacency.has("j" + k)) return "j" + k;
}

/** Split edge `index` at its midpoint with a new joint; returns the joint's name. */
function splitEdge(index, info) {
  const e = state.edges[index];
  const joint = newJointName(info);
  const half = Number(e.length) / 2;
  const a = e.from.trim(), b = e.to.trim();
  const [ax, ay] = treeUi.pos.get(a), [bx, by] = treeUi.pos.get(b);
  treeUi.pos.set(joint, [(ax + bx) / 2, (ay + by) / 2]);
  e.to = joint;
  e.length = String(half);
  state.edges.splice(index + 1, 0, { from: joint, to: b, length: String(half), stretch: e.stretch });
  return joint;
}

function dropNew(type, hit, x, y) {
  const info = treeInfo(state.edges);
  if (!info.vertices.length) {
    if (type !== "leaf") return say("Start with a leaf, then split edges with joints.");
    state.edges.push({ from: "1", to: "2", length: "1", stretch: false });
    const [u, w] = toUnit(x, y);
    treeUi.pos.set("1", [clamp01(u - 0.2), w]);
    treeUi.pos.set("2", [clamp01(u + 0.2), w]);
    return commitStructure("Added your first edge. Keep dragging leaves onto vertices or edges.");
  }
  if (!hit || hit.kind === "bin") {
    return say(type === "leaf" ? "Drop a leaf on a vertex or an edge." : "Drop a joint on an edge to split it.");
  }

  if (type === "joint") {
    if (hit.kind !== "edge") return say("Drop a joint on an edge to split it.");
    const joint = splitEdge(hit.index, info);
    return commitStructure(`Split the edge with joint ${joint}.`);
  }

  let parent;
  if (hit.kind === "edge") {
    parent = splitEdge(hit.index, info);
  } else {
    parent = hit.v;
  }
  const leaf = newLeafName(treeInfo(state.edges));
  // Put the new leaf where it was dropped, nudged outward if it was dropped right on the vertex.
  const [pu, pw] = treeUi.pos.get(parent);
  let [u, w] = toUnit(x, y);
  if (Math.hypot(u - pu, w - pw) < 0.08) {
    // Point away from the parent's existing neighbours, into the widest gap.
    const info = treeInfo(state.edges);
    const angles = (info.adjacency.get(parent) ?? [])
      .map(({ to }) => treeUi.pos.get(to)).filter(Boolean)
      .map(([x, y]) => Math.atan2(y - pw, x - pu)).sort((p, q) => p - q);
    let direction = -Math.PI / 2;
    if (angles.length === 1) direction = angles[0] + Math.PI;
    if (angles.length > 1) {
      let widest = -1;
      angles.forEach((a, k) => {
        const next = k + 1 < angles.length ? angles[k + 1] : angles[0] + 2 * Math.PI;
        if (next - a > widest) { widest = next - a; direction = a + (next - a) / 2; }
      });
    }
    u = clamp01(pu + 0.22 * Math.cos(direction));
    w = clamp01(pw + 0.22 * Math.sin(direction));
  }
  treeUi.pos.set(leaf, [u, w]);
  state.edges.push({ from: parent, to: leaf, length: "1", stretch: false });
  commitStructure(`Added leaf ${leaf} on ${parent}.`);
}

function renameVertex(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  const info = treeInfo(state.edges);
  if (info.adjacency.has(newName)) return say(`There's already a vertex called ${newName}.`);
  for (const e of state.edges) {
    if (e.from.trim() === oldName) e.from = newName;
    if (e.to.trim() === oldName) e.to = newName;
  }
  if (state.conditions[oldName]) {
    state.conditions[newName] = state.conditions[oldName];
    delete state.conditions[oldName];
  }
  for (const m of state.mirrors) {
    if (m.a === oldName) m.a = newName;
    if (m.b === oldName) m.b = newName;
  }
  treeUi.pos.set(newName, treeUi.pos.get(oldName));
  treeUi.pos.delete(oldName);
  commitStructure(`Renamed ${oldName} to ${newName}.`);
}

// ───────────────────────── Inline editing ─────────────────────────

/**
 * A point of the drawing (viewBox units) in the tree stage's CSS pixels, for placing an editor or menu there. SVG
 * elements have no offsetLeft, and the drawing is scaled to its box, so this goes through the bounding boxes.
 */
function toStage(vx, vy) {
  const svg = $("treeView"), stage = svg.parentElement;
  const view = svg.getBoundingClientRect(), box = stage.getBoundingClientRect();
  const k = view.width / (treeUi.geometry?.width || view.width);
  return {
    x: view.left - box.left + vx * k, y: view.top - box.top + vy * k,
    minX: view.left - box.left, maxX: view.right - box.left, minY: view.top - box.top, maxY: view.bottom - box.top,
  };
}

function inlineEdit(x, y, value, onCommit, { numeric = false, label = "" } = {}) {
  closeInlineEdit();
  const stage = $("treeView").parentElement;
  const input = document.createElement("input");
  input.type = numeric ? "number" : "text";
  if (numeric) { input.min = "0"; input.step = "any"; }
  input.value = value;
  input.className = "inline-edit";
  input.setAttribute("aria-label", label);
  // Centred on the point, kept inside the drawing (the input is 84 × 30 and centred by a transform).
  const at = toStage(x, y);
  input.style.left = `${Math.min(Math.max(at.x, at.minX + 46), at.maxX - 46)}px`;
  input.style.top = `${Math.min(Math.max(at.y, at.minY + 19), at.maxY - 19)}px`;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    input.remove();
    if (commit) onCommit(input.value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  // A tap moves focus once more after the click that opened the editor; keep the editor open through that.
  const openedAt = performance.now();
  input.addEventListener("blur", () => {
    if (performance.now() - openedAt < 450) {
      setTimeout(() => { if (!done) { input.focus({ preventScroll: true }); input.select(); } }, 0);
      return;
    }
    finish(true);
  });
  stage.append(input);
  input.focus({ preventScroll: true });
  input.select();
}

function editLength(index, x, y) {
  const e = state.edges[index];
  inlineEdit(x, y, e.length, (value) => {
    const v = Number(value);
    if (!(v > 0) || !Number.isFinite(v)) return say("Lengths must be positive numbers.");
    if (String(v) === String(Number(e.length))) return;
    e.length = String(v);
    commitStructure(`${e.from}–${e.to} is now ${fmt(v, 3)} long.`);
  }, { numeric: true, label: `Length of ${e.from}–${e.to}` });
}

function closeInlineEdit() {
  document.querySelector(".inline-edit")?.blur();
}

// ───────────────────────── Gestures ─────────────────────────

/** Calls onMove for every move of this pointer and onEnd(cancelled) once, listening on the window. */
function followPointer(down, onMove, onEnd) {
  const id = down.pointerId;
  const move = (e) => { if (e.pointerId === id) { e.preventDefault(); onMove(e); } };
  const up = (e) => { if (e.pointerId === id) finish(false); };
  const cancel = (e) => { if (e.pointerId === id) finish(true); };
  const blur = () => finish(true);
  let done = false;
  function finish(cancelled) {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", blur);
    onEnd(cancelled);
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
}

function initTreeEditor() {
  const svg = $("treeView");
  const circles = $("treeCircles");
  circles.addEventListener("change", renderTreePreview);

  // Vertex drags. Moves and the release are followed on the window rather than through pointer capture, which
  // behaves differently across Safari, Firefox and Chrome and is lost when the drawing is redrawn mid-drag.
  svg.addEventListener("pointerdown", (event) => {
    const group = event.target.closest("[data-vertex]");
    if (!group) {
      // A press on empty drawing closes the leaf menu and cancels a mirror pick.
      if (!event.target.closest("[data-length], [data-edge]")) { closeLeafMenu(); cancelMirrorPick(); }
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    closeInlineEdit();
    closeLeafMenu();
    const v = group.dataset.vertex;
    const start = svgPoint(event);
    treeUi.drag = { kind: "vertex", v, moved: false };
    followPointer(event, (move) => {
      const drag = treeUi.drag;
      if (drag?.kind !== "vertex") return;
      const [x, y] = svgPoint(move);
      if (!drag.moved && Math.hypot(x - start[0], y - start[1]) < 4) return;
      drag.moved = true;
      treeUi.handPlaced = true;
      treeUi.pos.set(drag.v, toUnit(x, y));
      treeUi.hover = hitTest(x, y, drag.v);
      renderTreePreview();
    }, (cancelled) => {
      const drag = treeUi.drag;
      treeUi.drag = null;
      const hover = treeUi.hover;
      treeUi.hover = null;
      if (drag?.kind === "vertex" && !drag.moved && !cancelled) return vertexClicked(drag.v);
      if (drag?.kind !== "vertex" || !drag.moved) return;
      if (cancelled || !hover || treeLocked()) return renderTreePreview();
      if (hover.kind === "vertex") {
        // Put the vertex beside its new neighbour rather than on top of it.
        const [tu, tw] = treeUi.pos.get(hover.v);
        treeUi.pos.set(drag.v, [clamp01(tu + 0.12), clamp01(tw - 0.08)]);
        reattach(drag.v, hover.v);
      } else if (hover.kind === "bin") {
        removeVertex(drag.v);
      }
    });
  });

  svg.addEventListener("click", (event) => {
    if (treeLocked()) return;
    const lengthLabel = event.target.closest("[data-length]");
    if (lengthLabel) {
      const index = Number(lengthLabel.dataset.length);
      const box = lengthLabel.getBBox();
      editLength(index, box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
    const edgeHit = event.target.closest("[data-edge]");
    if (edgeHit && document.body.dataset.stretch !== "off") {
      const e = state.edges[Number(edgeHit.dataset.edge)];
      e.stretch = !e.stretch;
      commitStructure(`${e.from}–${e.to} is ${e.stretch ? "now" : "no longer"} in the stretch set S.`);
    }
  });

  svg.addEventListener("keydown", (event) => {
    const tag = event.target.closest?.("[data-length]");
    if (!tag || treeLocked() || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    const index = Number(tag.dataset.length);
    const box = tag.getBBox();
    editLength(index, box.x + box.width / 2, box.y + box.height / 2);
  });

  svg.addEventListener("dblclick", (event) => {
    const group = event.target.closest("[data-vertex]");
    if (!group || treeLocked()) return;
    const v = group.dataset.vertex;
    closeLeafMenu();
    const [x, y] = treeUi.geometry.px.get(v);
    inlineEdit(x, y, v, (value) => renameVertex(v, value), { label: `Rename ${v}` });
  });

  // Chips: drag a new leaf or joint into the drawing.
  for (const chip of document.querySelectorAll("[data-chip]")) {
    chip.addEventListener("dragstart", (e) => e.preventDefault());
    chip.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      closeInlineEdit();
      treeUi.drag = { kind: "new", type: chip.dataset.chip, x: 0, y: 0, inside: false };
      chip.classList.add("lifted");
      document.body.classList.add("dragging-chip");
      followPointer(event, (move) => {
        const drag = treeUi.drag;
        if (drag?.kind !== "new") return;
        const [x, y, r] = svgPoint(move);
        drag.x = x;
        drag.y = y;
        drag.inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
        treeUi.hover = drag.inside ? hitTest(x, y, null) : null;
        renderTreePreview();
      }, (cancelled) => {
        chip.classList.remove("lifted");
        document.body.classList.remove("dragging-chip");
        const drag = treeUi.drag;
        treeUi.drag = null;
        const hover = treeUi.hover;
        treeUi.hover = null;
        if (drag?.kind !== "new") return;
        if (cancelled || !drag.inside) return renderTreePreview();
        dropNew(drag.type, hover, drag.x, drag.y);
      });
    });
    // Keyboard: Enter on a chip adds a leaf to the first internal vertex, or splits the first edge.
    chip.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const info = treeInfo(state.edges);
      const { px } = treeUi.geometry;
      if (chip.dataset.chip === "leaf") {
        const v = info.internal[0] ?? info.vertices[0];
        if (!v) return dropNew("leaf", null, treeUi.geometry.width / 2, treeUi.geometry.height / 2);
        const [x, y] = px.get(v);
        dropNew("leaf", { kind: "vertex", v }, x, y);
      } else if (state.edges.length) {
        dropNew("joint", { kind: "edge", index: 0 }, 0, 0);
      }
    });
  }

  $("tidyTree").addEventListener("click", () => {
    resetTreeLayout();
    say("");
  });

  const stage = svg.parentElement;
  const toggle = $("expandTree");
  const setExpanded = (on) => {
    stage.classList.toggle("expanded", on);
    document.body.classList.toggle("tree-expanded", on);
    toggle.textContent = on ? "Done" : "Enlarge";
    toggle.setAttribute("aria-expanded", String(on));
    requestAnimationFrame(renderTreePreview);
  };
  toggle.addEventListener("click", () => setExpanded(!stage.classList.contains("expanded")));
  $("treeBackdrop").addEventListener("click", () => setExpanded(false));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.querySelector(".leaf-menu")) { closeLeafMenu(); return; }
    if (treeUi.pick) { cancelMirrorPick(); return; }
    if (stage.classList.contains("expanded")) setExpanded(false);
  });
  // A press outside the drawing and the menu closes the menu.
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".leaf-menu, #treeView")) closeLeafMenu();
  });

  new ResizeObserver(() => renderTreePreview()).observe(svg);
}
