// The folded base in 3D (the Folded base node of the map, and under the crease card of every solver).
// A uniaxial base stands on its tree: seen from above it is the stick figure, and every facet is a vertical piece of
// paper over one tree edge, rising to its elevation. The server gives, for every facet vertex, how far along its tree
// edge it lies and how high; this file lays the tree out flat with its true edge lengths and lifts each facet into
// place. Drag to turn it; layers that stack (several facets over the same flap) show darker in the x-ray view.
"use strict";

const foldedView = (() => {
  const view = { result: null, edges: null, names: null, yaw: -0.6, pitch: 0.55, xray: true, drag: null, labels: null };
  const q = (id) => document.getElementById(id);
  // Greys and one accent, so the view also reads in black and white; facets are told apart by their outlines.
  const FILLS = ["#5b6b73", "#8d6e63", "#3f6e5a", "#7a5c86", "#9a7b2f", "#4b5d8a", "#7d4e57", "#5e7f2f"];

  /** Lays the tree flat with its true (paper) edge lengths: a radial layout from the centre of the tree. */
  function layoutTree(edges, lengths) {
    const adj = new Map();
    edges.forEach((e, k) => {
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push({ to: b, k });
      }
    });
    const nodes = [...adj.keys()];
    // Centre: the node minimizing the farthest distance.
    const far = (s) => {
      const d = new Map([[s, 0]]); const st = [s];
      while (st.length) { const x = st.pop(); for (const { to, k } of adj.get(x)) if (!d.has(to)) { d.set(to, d.get(x) + lengths[k]); st.push(to); } }
      return Math.max(...d.values());
    };
    const root = nodes.reduce((best, n) => (far(n) < far(best) ? n : best), nodes[0]);
    const parent = new Map([[root, null]]), order = [root];
    for (let i = 0; i < order.length; i++) for (const { to, k } of adj.get(order[i])) if (!parent.has(to)) { parent.set(to, { p: order[i], k }); order.push(to); }
    const kids = new Map(order.map((v) => [v, []]));
    for (const v of order) if (parent.get(v)) kids.get(parent.get(v).p).push(v);
    const leaves = new Map();
    for (const v of [...order].reverse()) leaves.set(v, kids.get(v).length ? kids.get(v).reduce((s, c) => s + leaves.get(c), 0) : 1);
    const pos = new Map([[root, [0, 0]]]);
    const place = (v, a0, a1) => {
      let a = a0;
      for (const c of kids.get(v)) {
        const span = (a1 - a0) * leaves.get(c) / leaves.get(v), mid = a + span / 2, L = lengths[parent.get(c).k];
        const [x, y] = pos.get(v);
        pos.set(c, [x + L * Math.cos(mid), y + L * Math.sin(mid)]);
        place(c, a, a + span);
        a += span;
      }
    };
    place(root, -Math.PI / 2, 1.5 * Math.PI);
    return pos;
  }

  function show(result, edges, lengthsPaper) {
    view.result = result;
    view.edges = edges;
    const card = q("foldCard");
    if (!result?.built || !result.facets?.length) { card.hidden = true; return; }
    card.hidden = false;
    const pos = layoutTree(edges, lengthsPaper);
    view.labels = [...pos.entries()];
    // Every facet vertex in 3D: along its edge in the flat stick figure, lifted by its elevation.
    view.polys = result.facets.map((f, idx) => {
      const e = edges[f.edge];
      const [ux, uy] = pos.get(e.from), [vx, vy] = pos.get(e.to);
      const L = lengthsPaper[f.edge] || 1;
      const heights = f.height ?? f.elevation;   // pleated height when the flaps are pleated
      const pts = f.along.map((a, k) => [ux + (vx - ux) * a / L, uy + (vy - uy) * a / L, heights[k]]);
      return { pts, edge: f.edge, idx };
    });
    view.sticks = edges.map((e) => [pos.get(e.from), pos.get(e.to)]);
    q("foldNote").textContent =
      `${result.facets.length} facets over ${edges.length} tree edges; ` +
      (result.pleatHeight
        ? `pleated to ${Number(result.foldedHeight).toFixed(3)} grid units (unpleated, the tallest ridge is ${Number(result.maxElevation).toFixed(3)}). `
        : `tallest ridge ${Number(result.maxElevation).toFixed(3)} grid units. `) +
      "Seen from above, the base is the stick figure of the tree. Darker areas have more layers of paper.";
    render();
  }

  function project([x, y, z]) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const xr = x * cy - y * sy, yr = x * sy + y * cy;
    return { sx: xr, sy: -(z * cp - yr * sp), depth: yr * cp + z * sp };
  }

  function render() {
    const canvas = q("foldCanvas");
    if (!canvas || !view.polys) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 420;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const all = view.polys.flatMap((p) => p.pts).concat(view.sticks.flat().map(([x, y]) => [x, y, 0]));
    const proj = all.map(project);
    const minX = Math.min(...proj.map((p) => p.sx)), maxX = Math.max(...proj.map((p) => p.sx));
    const minY = Math.min(...proj.map((p) => p.sy)), maxY = Math.max(...proj.map((p) => p.sy));
    const k = 0.86 * Math.min(w / Math.max(1e-9, maxX - minX), h / Math.max(1e-9, maxY - minY));
    const ox = w / 2 - k * (minX + maxX) / 2, oy = h / 2 - k * (minY + maxY) / 2;
    const S = (p) => { const r = project(p); return [ox + k * r.sx, oy + k * r.sy, r.depth]; };

    // Stick figure on the ground.
    g.lineWidth = 1.5; g.strokeStyle = "rgba(31,35,40,.35)"; g.setLineDash([4, 4]);
    for (const [a, b] of view.sticks) {
      const A = S([a[0], a[1], 0]), B = S([b[0], b[1], 0]);
      g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
    }
    g.setLineDash([]);

    // Facets, far to near.
    const drawn = view.polys.map((p) => {
      const s = p.pts.map(S);
      return { p, s, depth: s.reduce((t, v) => t + v[2], 0) / s.length };
    }).sort((a, b) => a.depth - b.depth);
    for (const { p, s } of drawn) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = FILLS[p.edge % FILLS.length];
      g.globalAlpha = view.xray ? 0.16 : 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 0.8; g.strokeStyle = "rgba(31,35,40,.55)"; g.stroke();
    }

    // Node labels on the ground.
    g.font = "600 12px Archivo, system-ui, sans-serif"; g.fillStyle = "#1f2328";
    for (const [name, [x, y]] of view.labels) {
      const [X, Y] = S([x, y, 0]);
      g.beginPath(); g.arc(X, Y, 2.5, 0, 2 * Math.PI); g.fill();
      g.fillText(name, X + 5, Y + 14);
    }
  }

  function setView(yaw, pitch) { view.yaw = yaw; view.pitch = pitch; render(); }

  function init() {
    const canvas = q("foldCanvas");
    canvas.addEventListener("pointerdown", (e) => {
      view.drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!view.drag) return;
      view.yaw = view.drag.yaw + (e.clientX - view.drag.x) * 0.01;
      view.pitch = Math.max(-1.55, Math.min(1.55, view.drag.pitch + (e.clientY - view.drag.y) * 0.01));
      render();
    });
    const end = () => { view.drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    q("foldTop").addEventListener("click", () => setView(0, 1.5707));
    q("foldSide").addEventListener("click", () => setView(0, 0));
    q("foldThree").addEventListener("click", () => setView(-0.6, 0.55));
    q("foldXray").addEventListener("change", (e) => { view.xray = e.target.checked; render(); });
    window.addEventListener("resize", render);
  }

  function hide() { q("foldCard").hidden = true; view.polys = null; }

  return { init, show, hide, render };
})();
