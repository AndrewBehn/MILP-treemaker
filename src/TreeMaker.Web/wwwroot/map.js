// The first screen: a map of the specs and the steps after them, akin to the document graph. Every box opens the
// part of the app that implements it (#/<node id>); its "Spec ↗" pill opens the document. The workbench cards below
// show what carries over between the parts.
"use strict";

const appMap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 214, H = 108, SW = 170;   // solver boxes; tree and step boxes are narrower
  const BOX = {
    tree: { x: 16, y: 226, w: 160 },
    pure: { x: 236, y: 226, w: W, base: true },
    sym: { x: 562, y: 52, w: W },
    hull: { x: 562, y: 170, w: W },
    optimized: { x: 562, y: 288, w: W },
    scalable: { x: 562, y: 406, w: W },
    close: { x: 826, y: 226, w: SW },
    stubs: { x: 826, y: 392, w: SW },
    creases: { x: 1006, y: 226, w: SW },
    fold: { x: 1186, y: 226, w: SW },
  };
  const FRAME = { x: 206, y: 12, w: 590, h: 536 };

  const q = (id) => document.getElementById(id);
  const svgEl = (name, attrs = {}, parent) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent?.append(node);
    return node;
  };

  /** Splits text into lines of at most `max` characters, at spaces. */
  function wrap(text, max) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      if ((line + " " + word).trim().length > max && line) { lines.push(line); line = word; } else line = (line + " " + word).trim();
    }
    if (line) lines.push(line);
    return lines;
  }

  /** A rough guide from the README's timings: can this solver handle the editor's tree in about a minute? */
  function suitability(id, leaves) {
    if (!leaves || !NODES[id] || NODES[id].kind !== "solver") return null;
    const limits = { pure: [4, 6], sym: [4, 6], hull: [10, 12], optimized: [12, 16], scalable: [200, 200] }[id];
    return appMapFit(id, leaves);
  }

  function badgeFor(id) {
    const wb = workbench;
    const node = NODES[id];
    if (node.kind === "solver") {
      if (wb.layout?.node === id) return { cls: "held", text: `Holds the layout · m = ${fmt(wb.layout.scale, 4)}` };
      return null;
    }
    if (id === "tree") {
      const t = wb.tree;
      if (!t?.edges?.length) return { cls: "need", text: "No tree yet" };
      return { cls: "held", text: `${treeInfo(t.edges).leaves.length} leaves · N = ${t.gridSize}` };
    }
    if (id === "close") {
      if (!wb.layout) return { cls: "need", text: "Needs a layout" };
      if (wb.closure?.completion?.after?.valid) return { cls: "held", text: `Closed · ±${fmt(wb.closure.strainMax, 3)}` };
      if (wb.layout.polygonsValid) return { cls: "held", text: "Already closed" };
      if (wb.closure) return { cls: "slow", text: "Tried; not closed yet" };
      return { cls: "fit", text: "Ready: layout waiting" };
    }
    if (id === "stubs") {
      if (!wb.layout) return { cls: "need", text: "Needs a layout" };
      if (wb.layout.stubs?.length) return { cls: "held", text: `${wb.layout.stubs.length} stub${wb.layout.stubs.length === 1 ? "" : "s"} added` };
      if (wb.layout.polygonsValid) return { cls: "held", text: "Not needed: closed" };
      return { cls: "fit", text: "Optional: open polygons" };
    }
    if (id === "creases") {
      if (wb.creases?.result?.built) return { cls: "held", text: `Built · ${wb.creases.result.creases.length} creases` };
      if (wb.polygonsValid()) return { cls: "fit", text: "Ready: polygons valid" };
      return { cls: "need", text: "Needs closed polygons" };
    }
    if (id === "fold") {
      if (wb.creases?.result?.built) return { cls: "fit", text: "Ready: pattern waiting" };
      return { cls: "need", text: "Needs a crease pattern" };
    }
    return null;
  }

  function port(id, side, dy = 0) {
    const b = BOX[id];
    const cy = b.y + H / 2 + dy;
    return side === "right" ? [b.x + b.w, cy] : side === "left" ? [b.x, cy] : [b.x + b.w / 2, side === "top" ? b.y : b.y + H];
  }

  function curve([x1, y1], [x2, y2]) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function render() {
    const svg = q("mapSvg");
    svg.replaceChildren();
    const defs = svgEl("defs", {}, svg);
    for (const k of ["flow", "build", "hand", "cite", "lit"]) {
      const m = svgEl("marker", { id: "mk-" + k, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: "mk-" + k }, m);
    }

    // The solver frame: one box per spec; the tree goes into one of them.
    svgEl("rect", { x: FRAME.x, y: FRAME.y, width: FRAME.w, height: FRAME.h, rx: 12, class: "map-frame-box" }, svg);
    const title = svgEl("text", { x: FRAME.x + 18, y: FRAME.y + 26, class: "map-frame-title" }, svg);
    title.textContent = "Layout solvers · one per spec";
    const sub = svgEl("text", { x: FRAME.x + 18, y: FRAME.y + 43, class: "map-frame-sub" }, svg);
    sub.textContent = "Pick one; the layout it finds goes on the workbench";

    const lit = new Set();
    const wb = workbench;
    if (wb.tree?.edges?.length) lit.add("tree-frame");
    if (wb.layout) lit.add("frame-close");
    if (wb.polygonsValid()) lit.add("close-creases");
    if (wb.creases?.result?.built) lit.add("creases-fold");

    // The pipeline: tree → solvers → close → creases → fold.
    const flows = [
      ["tree-frame", port("tree", "right"), [FRAME.x, BOX.tree.y + H / 2]],
      ["frame-close", [FRAME.x + FRAME.w, BOX.close.y + H / 2], port("close", "left")],
      ["close-creases", port("close", "right"), port("creases", "left")],
      ["creases-fold", port("creases", "right"), port("fold", "left")],
    ];
    for (const [key, a, b] of flows) {
      const on = lit.has(key);
      svgEl("path", { d: `M${a[0]},${a[1]} L${b[0] - 2},${b[1]}`, class: "map-flow" + (on ? " lit" : ""), "marker-end": `url(#mk-${on ? "lit" : "flow"})` }, svg);
    }
    // The stubs detour: down from Close the polygons into Add stubs, and back up with the new layout.
    {
      const cx = BOX.close.x + SW / 2, top = BOX.stubs.y, bottom = BOX.close.y + H;
      const on = !!wb.layout?.stubs?.length;
      svgEl("path", { d: `M${cx - 22},${bottom} L${cx - 22},${top - 2}`, class: "map-flow side" + (on ? " lit" : ""), "marker-end": `url(#mk-${on ? "lit" : "flow"})` }, svg);
      svgEl("path", { d: `M${cx + 22},${top} L${cx + 22},${bottom + 2}`, class: "map-flow side" + (on ? " lit" : ""), "marker-end": `url(#mk-${on ? "lit" : "flow"})` }, svg);
      const t = svgEl("text", { x: cx + 32, y: (top + bottom) / 2 + 4, class: "map-frame-sub" }, svg);
      t.textContent = "then close again";
    }
    // Inside the frame: from the frame's left edge into the base spec, and the solver that holds the layout out to the right.
    if (wb.layout && BOX[wb.layout.node]) {
      const [x, y] = port(wb.layout.node, "right");
      svgEl("path", { d: curve([x, y], [FRAME.x + FRAME.w, BOX.close.y + H / 2]), class: "map-flow lit inner" }, svg);
    }

    // References between the specs, as in the document graph.
    if (q("showRefs").checked) {
      const into = { sym: -30, hull: -12, optimized: 12, scalable: 30 };
      for (const e of SPEC_EDGES) {
        let d;
        if (e.to === "pure") {
          d = curve(port(e.from, "left"), port("pure", "right", into[e.from]));
        } else if (e.from === "pure") {
          d = curve(port("pure", "right", 44), port(e.to, "left", 22));
        } else {
          // Same column: an arc out to the right of the boxes.
          const [x1, y1] = port(e.from, "right", -14), [x2, y2] = port(e.to, "right", 14);
          d = `M${x1},${y1} C${x1 + 26},${y1} ${x2 + 26},${y2} ${x2},${y2}`;
        }
        const path = svgEl("path", { d, class: "map-ref " + e.kind, "marker-end": `url(#mk-${e.kind})` }, svg);
        const t = svgEl("title", {}, path);
        t.textContent = `${DOCS[e.from].title} ${{ build: "builds on", hand: "hands off to", cite: "cites" }[e.kind]} ${DOCS[e.to].title}`;
      }
    }

    const leaves = wb.tree?.edges?.length ? treeInfo(wb.tree.edges).leaves.length : 0;
    for (const [id, b] of Object.entries(BOX)) {
      const node = NODES[id];
      const badge = badgeFor(id);
      const fit = suitability(id, leaves);
      const g = svgEl("g", { class: `map-node ${node.kind}${b.base ? " base" : ""}${badge?.cls === "held" ? " holding" : ""}${badge?.cls === "need" ? " waiting" : ""}` }, svg);
      const a = svgEl("a", { href: "#/" + id, class: "map-node-link" }, g);
      const label = svgEl("title", {}, a);
      label.textContent = `Open ${node.title}: ${node.blurb}`;
      svgEl("rect", { x: b.x, y: b.y, width: b.w, height: H, rx: 9, class: "map-box" }, a);
      const kicker = svgEl("text", { x: b.x + 12, y: b.y + 18, class: "map-kicker" }, a);
      kicker.textContent = node.mapKicker ?? node.kicker;
      const t = svgEl("text", { x: b.x + 12, y: b.y + 37, class: "map-title" }, a);
      t.textContent = node.title;
      wrap(node.blurb, b.w > 180 ? 34 : 27).slice(0, 2).forEach((line, k) => {
        const s = svgEl("text", { x: b.x + 12, y: b.y + 54 + k * 14, class: "map-blurb" }, a);
        s.textContent = line;
      });
      const status = badge ?? fit;
      if (status) {
        const s = svgEl("text", { x: b.x + 12, y: b.y + H - 11, class: "map-badge " + status.cls }, a);
        s.textContent = (status.cls === "held" ? "● " : status.cls === "need" ? "○ " : "") + status.text;
      }
      // The spec pill, outside the box's link so it opens the document instead.
      const doc = nodeDoc(node);
      if (doc) {
        // Opens the packaged doc in the docs tab, at the first section or label the node cites; the box itself
        // opens the part of the app.
        const t = specLinks.firstTarget(node.section, node.doc);
        const pill = svgEl("a", { href: specLinks.href(t.doc, t.at), target: SPEC_TAB, class: "map-spec" }, g);
        const pt = svgEl("title", {}, pill);
        pt.textContent = `Read the spec: ${doc.title} (${node.section})`;
        svgEl("rect", { x: b.x + b.w - 56, y: b.y + 8, width: 46, height: 18, rx: 9 }, pill);
        const tx = svgEl("text", { x: b.x + b.w - 33, y: b.y + 21, "text-anchor": "middle" }, pill);
        tx.textContent = "Spec ↗";
      }
    }
    renderBench();
  }

  // ───── Workbench cards ─────

  function card(title, lines, actions, empty) {
    const c = document.createElement("article");
    c.className = "bench-card" + (empty ? " vacant" : "");
    const h = document.createElement("h3");
    h.textContent = title;
    c.append(h);
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      c.append(p);
    }
    const row = document.createElement("div");
    row.className = "bench-actions";
    for (const [text, fn, kind] of actions) {
      const b = document.createElement(typeof fn === "string" ? "a" : "button");
      b.className = kind === "primary" ? "bench-go" : typeof fn === "string" ? "quiet-link" : "quiet small";
      b.textContent = text;
      if (typeof fn === "string") b.href = fn; else { b.type = "button"; b.addEventListener("click", fn); }
      row.append(b);
    }
    c.append(row);
    return c;
  }

  const when = (iso) => {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  };

  /** The session in short: one line per step, and the way back into it. */
  function renderBench() {
    const steps = workflowDoc.steps;
    const live = steps.at(-1);
    const list = document.createElement("ol");
    list.className = "bench-steps";
    for (const [k, step] of steps.entries()) {
      const li = document.createElement("li");
      li.textContent = `${k + 1}. ${step.kind === "solve" ? `Solve with ${NODES[step.node]?.title ?? step.node}` : { tree: "Tree", close: "Close the polygons", stub: `Add the stub ${step.params?.name ?? ""}`.trim(), creases: "Crease pattern" }[step.kind]}`
        + (k === steps.length - 1 ? (step.output ? " (live)" : " (not run yet)") : "");
      list.append(li);
    }
    const c = card(steps.length ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "No steps yet", [],
      [[steps.length ? "Continue the session" : "Start with a tree", "#/" + (live?.node ?? "tree"), "primary"],
       ["Open a session…", () => q("fileInput").click()],
       ["New session", () => workflowDoc.startOver()]]);
    c.insertBefore(list, c.querySelector(".bench-actions"));
    q("benchCards").replaceChildren(c);
  }

  function init() {
    q("showRefs").addEventListener("change", render);
    workbench.onChange(() => { if (document.body.dataset.view === "map") render(); });
  }

  return { init, render };
})();
