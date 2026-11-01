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
"use strict";

const treeUi = {
  pos: new Map(),       // vertex name -> [u, v] in the unit square of the drawing area
  drag: null,           // { kind: "vertex", v, moved } | { kind: "new", type, x, y }
  hover: null,          // { kind: "vertex", v } | { kind: "edge", index } | { kind: "bin" }
  geometry: null,       // last render: { width, height, pad, px: Map(name -> [x, y]) }
  message: "",
};

const HIT_VERTEX = 18;
const HIT_EDGE = 10;

function resetTreeLayout() {
  treeUi.pos.clear();
}

// ───────────────────────── Layout ─────────────────────────

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
function autoLayout(info, width, height) {
  const out = new Map();
  if (!info.vertices.length) return out;
  const bilateral = bilateralLayout(info, state.mirrors ?? []);
  if (bilateral) return fitLayout(bilateral, width, height);
  if (!isTree(info, state.edges)) {
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
      depth.set(c, depth.get(v) + Math.max(0.05, Number(state.edges[edgeOf.get(c)].length) || 0.05));
      assign(c, a, a + span);
      a += span;
    }
  };
  assign(root, -Math.PI / 2, 1.5 * Math.PI);

  const raw = new Map(order.map((v) => [v, [depth.get(v) * Math.cos(angle.get(v)), depth.get(v) * Math.sin(angle.get(v))]]));
  const xs = [...raw.values()].map((p) => p[0]), ys = [...raw.values()].map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Uniform scale so the drawing keeps its shape, centred in the unit square of a width × height box.
  const fit = Math.min(width / Math.max(1e-9, maxX - minX), height / Math.max(1e-9, maxY - minY));
  const offX = (width - fit * (maxX - minX)) / 2, offY = (height - fit * (maxY - minY)) / 2;
  for (const v of order) {
    const [x, y] = raw.get(v);
    out.set(v, [(offX + (x - minX) * fit) / width, (offY + (y - minY) * fit) / height]);
  }
  return out;
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
      el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "edge" + (e.stretch ? " stretch" : "") + (target ? " target" : "") }),
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

  for (const v of info.vertices) {
    const [x, y] = px.get(v);
    const leaf = info.adjacency.get(v).length === 1;
    const isDragged = dragging?.kind === "vertex" && dragging.v === v;
    const target = hover?.kind === "vertex" && hover.v === v;
    const g = el("g", { class: "vertex-group" + (isDragged ? " dragged" : "") + (target ? " target" : ""), "data-vertex": v });
    g.append(
      el("circle", { cx: x, cy: y, r: HIT_VERTEX, class: "vertex-hit" }),
      el("circle", { cx: x, cy: y, r: leaf ? 7 : 6, class: "vertex" + (leaf ? " leaf" : "") }),
    );
    const t = el("text", { x: x + 11, y: y - 10, class: "vertex-label" });
    t.textContent = v;
    const title = el("title");
    title.textContent = `${v}: drag to move or re-attach, double-click to rename`;
    g.append(t, title);
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

function inlineEdit(x, y, value, onCommit, { numeric = false, label = "" } = {}) {
  closeInlineEdit();
  const stage = $("treeView").parentElement;
  const input = document.createElement("input");
  input.type = numeric ? "number" : "text";
  if (numeric) { input.min = "0"; input.step = "any"; }
  input.value = value;
  input.className = "inline-edit";
  input.setAttribute("aria-label", label);
  const svg = $("treeView");
  input.style.left = `${x + svg.offsetLeft}px`;
  input.style.top = `${y + svg.offsetTop}px`;
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
      setTimeout(() => { if (!done) { input.focus(); input.select(); } }, 0);
      return;
    }
    finish(true);
  });
  stage.append(input);
  input.focus();
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

  // Vertex drags. Moves and the release are followed on the window rather than through pointer capture, which
  // behaves differently across Safari, Firefox and Chrome and is lost when the drawing is redrawn mid-drag.
  svg.addEventListener("pointerdown", (event) => {
    const group = event.target.closest("[data-vertex]");
    if (!group || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    closeInlineEdit();
    const v = group.dataset.vertex;
    const start = svgPoint(event);
    treeUi.drag = { kind: "vertex", v, moved: false };
    followPointer(event, (move) => {
      const drag = treeUi.drag;
      if (drag?.kind !== "vertex") return;
      const [x, y] = svgPoint(move);
      if (!drag.moved && Math.hypot(x - start[0], y - start[1]) < 4) return;
      drag.moved = true;
      treeUi.pos.set(drag.v, toUnit(x, y));
      treeUi.hover = hitTest(x, y, drag.v);
      renderTreePreview();
    }, (cancelled) => {
      const drag = treeUi.drag;
      treeUi.drag = null;
      const hover = treeUi.hover;
      treeUi.hover = null;
      if (drag?.kind !== "vertex" || !drag.moved) return;
      if (cancelled || !hover) return renderTreePreview();
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
    if (!tag || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    const index = Number(tag.dataset.length);
    const box = tag.getBBox();
    editLength(index, box.x + box.width / 2, box.y + box.height / 2);
  });

  svg.addEventListener("dblclick", (event) => {
    const group = event.target.closest("[data-vertex]");
    if (!group) return;
    const v = group.dataset.vertex;
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
    if (event.key === "Escape" && stage.classList.contains("expanded")) setExpanded(false);
  });

  new ResizeObserver(() => renderTreePreview()).observe(svg);
}
