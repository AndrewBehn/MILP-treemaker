// Add stubs: the map node between a layout and closing the polygons. A stub is a new short leaf edge, hung from a
// joint of the tree, whose leaf sits inside an open polygon of the layout, as TreeMaker does it (Polygon Closing spec,
// Open problem 1 in Section 10). The tight paths to the stub's leaf split the open polygon into smaller ones.
//
// Here the stub's leaf goes on a grid point X, so the layout stays a grid layout, and the stub hangs from a joint v.
// With the layout's scale m and the tree distances d(v, a), the longest stub that keeps every pair feasible is
//     ℓ(X, v) = min over leaves a of ( |X − P_a| / m − d(v, a) ),
// and the leaves a that attain the minimum are tight to the stub. A grid point rarely makes three tight at once; the
// Close the polygons step then strains the edges to tighten what is left.
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
    return { attach: v, x: X[0], y: X[1], len, tight };
  }

  /** The best stub in a region: hung from `attach` (or the best joint), most leaves tight, then the longest. */
  function best(region, attach) {
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
    if (!all.length) return null;
    const longest = Math.max(...all.map((c) => c.len));
    return all.filter((c) => c.len >= 0.25 * longest)
      .sort((a, b) => b.tight.length - a.tight.length || b.len - a.len)[0];
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
    ui.region = ui.regions.length ? 0 : -1;
    if (ui.region >= 0) ui.cand = best(ui.regions[0], null);
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
      q("stubState").textContent = `${ui.regions.length} open region${ui.regions.length === 1 ? "" : "s"}. Pick one, here or on the sheet:`;
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
    if (c) {
      for (const [k, v] of [
        ["Hangs from", c.attach],
        ["Length ℓ", fmt(c.len, 4)],
        ["Leaf at", `(${c.x}, ${c.y})`],
        ["Tight to", c.tight.join(", ")],
      ]) {
        const row = document.createElement("div");
        row.className = "held-row on";
        const a = document.createElement("span"); a.className = "k"; a.textContent = k;
        const b = document.createElement("span"); b.className = "v"; b.textContent = v;
        row.append(a, b);
        facts.append(row);
      }
    } else if (ui.region >= 0) {
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

  return { init, show, hide, draw, jointClicked, hooks, _state: ui };
})();
