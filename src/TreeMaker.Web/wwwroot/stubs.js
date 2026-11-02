// Add stubs: the map node between a layout and closing the polygons. A stub is a new short leaf edge, hung from a
// joint of the tree, whose leaf sits inside an open polygon of the layout, as TreeMaker does it (Polygon Closing spec,
// Open problem 1 in Section 10). The tight paths to the stub's leaf split the open polygon into smaller ones.
//
// Here the stub's leaf goes on a grid point X, so the layout stays a grid layout, and the stub hangs from a joint v.
// With the layout's scale m and the tree distances d(v, a), the longest stub that keeps every pair feasible is
//     ℓ(X, v) = min over leaves a of ( |X − P_a| / m − d(v, a) ),
// and the leaves a that attain the minimum are tight to the stub. A grid point rarely makes three tight at once; the
// Strain the edges step then tightens what is left.
//
// The same two widgets as everywhere else: the tree editor (locked against edits; click a joint to hang the stub
// there) and the sheet (click inside an open polygon to put the stub's leaf on that grid point).
"use strict";

const stubTool = (() => {
  const SIZE = 600, PAD = 40;   // must match the sheet drawing in app.js
  const MIN_LENGTH = 1e-3;
  const ui = { held: null, report: null, region: -1, regions: [], cand: null, attach: null };

  const q = (id) => document.getElementById(id);
  const svgEl = (name, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const active = () => document.body.dataset.stubbing === "on" && !!ui.held;
  const hooks = { onAdd: null };   // the workflow document takes the stub as a step (workflow.js)

  // ───── Geometry and the tree ─────

  /** Strictly inside a polygon (points on its sides are not). */
  function inside([x, y], pts) {
    let wind = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
      if (Math.abs(cross) < 1e-9 && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9
        && y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9) return false;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) wind = !wind;
    }
    return wind;
  }

  /** Tree distances from v to every vertex, with the layout's edge lengths. */
  function distancesFrom(v, edges, lengths) {
    const adj = new Map();
    edges.forEach((e, k) => {
      const l = lengths?.[k] ?? Number(e.length);
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push([b, l]);
      }
    });
    const d = new Map([[v, 0]]);
    const stack = [v];
    while (stack.length) {
      const u = stack.pop();
      for (const [w, l] of adj.get(u) ?? []) if (!d.has(w)) { d.set(w, d.get(u) + l); stack.push(w); }
    }
    return d;
  }

  function joints(edges) {
    const deg = new Map();
    for (const e of edges) for (const v of [e.from, e.to]) deg.set(v, (deg.get(v) ?? 0) + 1);
    return [...deg].filter(([, k]) => k > 1).map(([v]) => v);
  }

  /** The open regions of the report: invalid polygons, and the hull's uncovered part. */
  function openRegions(report, pos) {
    const ring = (leaves) => leaves.map((l) => pos.get(l)).filter(Boolean);
    const regions = [];
    report.polygons.forEach((p) => {
      if (p.valid) return;
      const n = p.leavesInside?.length ?? 0;
      const why = n ? `${n} lea${n === 1 ? "f" : "ves"} inside` : p.convex === false ? "not convex" : "not closed";
      regions.push({ label: `${p.leaves.join("–")} · ${why}`, pts: ring(p.leaves), test: (pt, self) => inside(pt, self.pts) });
    });
    const hull = ring(report.hullLeaves ?? []);
    if (hull.length >= 3 && report.hullArea > 0 && report.coveredArea < report.hullArea * (1 - 1e-6)) {
      const faces = report.polygons.map((p) => ring(p.leaves));
      regions.push({
        label: "Outline no polygon covers", pts: hull, gap: true,
        test: (pt) => inside(pt, hull) && !faces.some((f) => inside(pt, f) || onRing(pt, f)),
      });
    }
    return regions;
  }

  function onRing(pt, f) {
    return !inside(pt, f) && f.length >= 2 && f.some((a, i) => {
      const b = f[(i + 1) % f.length];
      const cross = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
      return Math.abs(cross) < 1e-9 && pt[0] >= Math.min(a[0], b[0]) && pt[0] <= Math.max(a[0], b[0]) && pt[1] >= Math.min(a[1], b[1]) && pt[1] <= Math.max(a[1], b[1]);
    });
  }

  /** The stub hung from v with its leaf at X: its longest length, and the leaves tight to it. */
  function stubAt(X, v, dist) {
    const held = ui.held;
    let len = Infinity;
    const slack = [];
    for (const p of held.points) {
      const s = Math.hypot(X[0] - p.x, X[1] - p.y) / held.scale - (dist.get(p.leaf) ?? Infinity);
      slack.push([p.leaf, s]);
      len = Math.min(len, s);
    }
    const tight = slack.filter(([, s]) => s - len < 1e-9).map(([l]) => l);
    // The next leaves it nearly reaches: how much longer the stub (or how much strain) it would take to make them
    // tight too. A stub that is tight, or nearly, to three leaves around it splits the polygon the TreeMaker way.
    const near = slack.filter(([l]) => !tight.includes(l)).map(([leaf, s]) => ({ leaf, gap: s - len })).sort((a, b) => a.gap - b.gap);
    const three = [...tight, ...near.map((n) => n.leaf)].slice(0, 3);
    const pos = new Map(held.points.map((p) => [p.leaf, [p.x, p.y]]));
    const splits = three.length === 3 && inTriangle(X, ...three.map((l) => pos.get(l)));
    const gap3 = tight.length >= 3 ? 0 : (near[2 - tight.length]?.gap ?? Infinity);
    return { attach: v, x: X[0], y: X[1], len, tight, near: near.slice(0, Math.max(0, 3 - tight.length)), splits, gap3 };
  }

  function inTriangle(X, a, b, c) {
    const d = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    const d1 = d(X, a, b), d2 = d(X, b, c), d3 = d(X, c, a);
    return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
  }

  /**
   * How good a stub is: first, that its three nearest-tight leaves surround it (so it splits the polygon); then how
   * little more it would take to make all three tight (the strain a closing step would need); then the longer stub.
   */
  const rank = (a, b) => (b.splits - a.splits) || (a.gap3 - b.gap3) || (b.len - a.len);

  /** The best stubs in a region, best first (one per grid point): hung from `attach`, or from any joint. */
  function ranked(region, attach, count = 3) {
    const held = ui.held, N = held.gridSize;
    const taken = new Set(held.points.map((p) => `${p.x},${p.y}`));
    const pointsIn = [];
    for (let x = 0; x <= N; x++) for (let y = 0; y <= N; y++) {
      if (!taken.has(`${x},${y}`) && region.test([x, y], region)) pointsIn.push([x, y]);
    }
    const all = [];
    for (const v of attach ? [attach] : joints(held.problem.edges)) {
      const dist = distancesFrom(v, held.problem.edges, held.edgeLengths);
      for (const X of pointsIn) {
        const c = stubAt(X, v, dist);
        if (c.len >= MIN_LENGTH) all.push(c);
      }
    }
    all.sort(rank);
    const out = [], seen = new Set();
    for (const c of all) {
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
      if (out.length === count) break;
    }
    return out;
  }

  function best(region, attach) {
    return ranked(region, attach, 1)[0] ?? null;
  }

  /** The best stub over every open region of a state, if one splits a polygon: for adding stubs region by region. */
  function bestAnywhere(held, report) {
    const saved = ui.held;
    ui.held = held;
    try {
      const pos = new Map(held.points.map((p) => [p.leaf, [p.x, p.y]]));
      const cands = openRegions(report, pos).flatMap((r) => ranked(r, null, 1)).filter((c) => c.splits).sort(rank);
      return cands[0] ? { ...cands[0], name: newName() } : null;
    } finally {
      ui.held = saved;
    }
  }

  // ───── The panel and the drawings ─────

  /** Called by the app when the Add stubs node shows the workbench layout and its polygon report. */
  function show(held, report) {
    ui.held = held;
    ui.report = report;
    ui.cand = null;
    ui.attach = null;
    const pos = new Map(held.points.map((p) => [p.leaf, [p.x, p.y]]));
    ui.regions = report ? openRegions(report, pos) : [];
    // Open the region with the best stub of all.
    const firsts = ui.regions.map((r) => best(r, null));
    let k = -1;
    firsts.forEach((c, i) => { if (c && (k < 0 || rank(c, firsts[k]) < 0)) k = i; });
    ui.region = k >= 0 ? k : ui.regions.length ? 0 : -1;
    if (ui.region >= 0) ui.cand = firsts[ui.region] ?? null;
    render();
  }

  function hide() {
    ui.held = null;
    ui.cand = null;
    treeUi.stub = null;
    q("stubLayer")?.remove();
  }

  function render() {
    if (!ui.held) return;
    const list = q("stubRegions");
    list.replaceChildren();
    if (!ui.report) {
      q("stubState").textContent = "Checking the polygons…";
    } else if (!ui.regions.length) {
      q("stubState").textContent = ui.report.valid
        ? "Every polygon is already valid: no stub needed. Go on to the crease pattern."
        : "No open polygon to put a stub in: what is missing are hull sides, which closing the polygons tightens.";
    } else {
      q("stubState").textContent = `${ui.regions.length} open region${ui.regions.length === 1 ? "" : "s"}:`;
      ui.regions.forEach((r, k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "stub-region";
        b.setAttribute("aria-pressed", String(k === ui.region));
        b.textContent = r.label;
        b.addEventListener("click", () => { ui.region = k; ui.cand = best(r, ui.attach); render(); });
        list.append(b);
      });
    }

    const c = ui.cand;
    const facts = q("stubFacts");
    facts.replaceChildren();
    const r = ui.regions[ui.region];
    const options = r ? ranked(r, ui.attach) : [];
    const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.attach === b.attach;
    if (c && !options.some((o) => same(o, c))) options.push(c);
    options.forEach((o, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stub-option";
      b.setAttribute("aria-pressed", String(same(o, c)));
      const near = o.near.map((n) => `${n.leaf} +${fmt(n.gap, 2)}`).join(", ");
      b.innerHTML = "<b></b><span></span>";
      b.children[0].textContent = `${k === 0 ? "Best: " : ""}(${o.x}, ${o.y}) from ${o.attach}, ℓ ${fmt(o.len, 2)}`;
      b.children[1].textContent = `tight to ${o.tight.join(", ")}` + (near ? `; nearly to ${near}` : "") + (o.splits ? " · splits the polygon" : " · does not split it");
      b.title = "The +numbers are how much longer the stub would have to be to reach those leaves too: what a strain step would have to make up.";
      b.addEventListener("click", () => { ui.cand = o; render(); });
      facts.append(b);
    });
    if (!options.length && ui.region >= 0) {
      facts.textContent = "No grid point in this region leaves room for a stub" + (ui.attach ? ` hung from ${ui.attach}. Click another joint on the tree.` : ".");
    }
    q("addStub").disabled = !c;
    q("bestStub").disabled = ui.region < 0;
    q("stubName").textContent = c ? newName() : "a new leaf";

    treeUi.stub = c ? { attach: c.attach, label: `${newName()} · ${fmt(c.len, 3)}` } : ui.region >= 0 ? { attach: null } : null;
    renderTreePreview();
    draw();
  }

  function newName() {
    const names = new Set(ui.held.problem.edges.flatMap((e) => [e.from, e.to]));
    for (let k = 1; ; k++) if (!names.has("s" + k)) return "s" + k;
  }

  /** The stub on the sheet: the region picked, the leaf, its circle and its tight paths. Call after the sheet is drawn. */
  function draw() {
    const svg = q("layoutView");
    q("stubLayer")?.remove();
    if (!active() || !svg.querySelector("*")) return;
    const unit = (SIZE - 2 * PAD) / ui.held.gridSize;
    const P = ([x, y]) => [PAD + x * unit, SIZE - PAD - y * unit];
    const layer = svgEl("g", { id: "stubLayer" });
    const r = ui.regions[ui.region];
    if (r) layer.append(svgEl("polygon", { points: r.pts.map(P).map((p) => p.join(",")).join(" "), class: "stub-region-outline" }));
    const c = ui.cand;
    if (c) {
      const [x, y] = P([c.x, c.y]);
      const pos = new Map(ui.held.points.map((p) => [p.leaf, P([p.x, p.y])]));
      for (const l of c.tight) {
        const [lx, ly] = pos.get(l);
        layer.append(svgEl("line", { x1: x, y1: y, x2: lx, y2: ly, class: "stub-path" }));
      }
      layer.append(svgEl("circle", { cx: x, cy: y, r: c.len * ui.held.scale * unit, class: "stub-circle" }));
      layer.append(svgEl("circle", { cx: x, cy: y, r: 7, class: "stub-leaf" }));
      const t = svgEl("text", { x: x + 10, y: y - 10, class: "stub-label" });
      t.textContent = newName();
      layer.append(t);
    }
    svg.append(layer);
  }

  /** A click on the sheet: the grid point under it, if it is in an open region. */
  function sheetClick(event) {
    if (!active() || !ui.regions.length) return;
    const svg = q("layoutView");
    const box = svg.getBoundingClientRect();
    const k = SIZE / box.width;
    const unit = (SIZE - 2 * PAD) / ui.held.gridSize;
    const X = [Math.round(((event.clientX - box.left) * k - PAD) / unit), Math.round((SIZE - PAD - (event.clientY - box.top) * k) / unit)];
    const at = ui.regions.findIndex((r) => r.test(X, r));
    if (at < 0) return;
    if (ui.held.points.some((p) => p.x === X[0] && p.y === X[1])) return;
    ui.region = at;
    const pick = (v) => stubAt(X, v, distancesFrom(v, ui.held.problem.edges, ui.held.edgeLengths));
    const options = (ui.attach ? [ui.attach] : joints(ui.held.problem.edges)).map(pick).filter((c) => c.len >= MIN_LENGTH);
    ui.cand = options.sort((a, b) => b.tight.length - a.tight.length || b.len - a.len)[0] ?? null;
    render();
  }

  /** A click on a joint of the tree: hang the stub there (a second click on it lets the search choose again). */
  function jointClicked(v) {
    if (!active() || ui.region < 0) return false;
    if (!joints(ui.held.problem.edges).includes(v)) return false;
    ui.attach = ui.attach === v ? null : v;
    const c = ui.cand;
    if (c && ui.attach) {
      const s = stubAt([c.x, c.y], v, distancesFrom(v, ui.held.problem.edges, ui.held.edgeLengths));
      ui.cand = s.len >= MIN_LENGTH ? s : best(ui.regions[ui.region], v);
    } else {
      ui.cand = best(ui.regions[ui.region], ui.attach);
    }
    render();
    return true;
  }

  /** Hands the stub to the workflow document, which adds it to the tree and the layout as a step. */
  function add() {
    const c = ui.cand;
    if (!c) return;
    hooks.onAdd?.({ ...c, name: newName() });
  }

  function init() {
    q("layoutView").addEventListener("click", sheetClick);
    q("addStub").addEventListener("click", add);
    q("bestStub").addEventListener("click", () => {
      if (ui.region < 0) return;
      ui.attach = null;
      ui.cand = best(ui.regions[ui.region], null);
      render();
    });
  }

  return { init, show, hide, draw, jointClicked, bestAnywhere, hooks, _state: ui };
})();
