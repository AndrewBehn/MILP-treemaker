// The first screen: a map of the specs and the steps after them, akin to the document graph. Every box opens the
// part of the app that implements it (#/<node id>); its "Spec ↗" pill opens the document. What was done lives in the
// session (workflow.js), not here: the map marks only the box of the session's live step.
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

  /** A rough guide from the README's timings, shown only as a warning: a solver that may be slow for the tree. */
  function warning(id, leaves) {
    if (!leaves || NODES[id]?.kind !== "solver") return null;
    const fit = appMapFit(id, leaves);
    return fit.cls === "fit" ? null : fit;
  }

  /**
   * The map shows what each part is; the session shows what was done. The one link between them is the box of the
   * session's live step, marked so you can see where Continue leads.
   */
  function liveStep() {
    const steps = workflowDoc.steps;
    const live = steps.at(-1);
    return live ? { node: live.node, n: steps.length } : null;
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
    sub.textContent = "Pick one to solve the tree";

    // The pipeline: tree → solvers → close → creases → fold.
    const flows = [
      ["tree-frame", port("tree", "right"), [FRAME.x, BOX.tree.y + H / 2]],
      ["frame-close", [FRAME.x + FRAME.w, BOX.close.y + H / 2], port("close", "left")],
      ["close-creases", port("close", "right"), port("creases", "left")],
      ["creases-fold", port("creases", "right"), port("fold", "left")],
    ];
    for (const [, a, b] of flows) {
      svgEl("path", { d: `M${a[0]},${a[1]} L${b[0] - 2},${b[1]}`, class: "map-flow", "marker-end": "url(#mk-flow)" }, svg);
    }
    // The stubs detour: down from Strain the edges into Add stubs, and back up with the new layout.
    {
      const cx = BOX.close.x + SW / 2, top = BOX.stubs.y, bottom = BOX.close.y + H;
      svgEl("path", { d: `M${cx - 22},${bottom} L${cx - 22},${top - 2}`, class: "map-flow side", "marker-end": "url(#mk-flow)" }, svg);
      svgEl("path", { d: `M${cx + 22},${top} L${cx + 22},${bottom + 2}`, class: "map-flow side", "marker-end": "url(#mk-flow)" }, svg);
      const t = svgEl("text", { x: cx + 32, y: (top + bottom) / 2 + 4, class: "map-frame-sub" }, svg);
      t.textContent = "then strain again";
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

    const tree = workflowDoc.steps[0]?.output?.problem ?? workbench.tree;
    const leaves = tree?.edges?.length ? treeInfo(tree.edges).leaves.length : 0;
    const live = liveStep();
    for (const [id, b] of Object.entries(BOX)) {
      const node = NODES[id];
      const isLive = live?.node === id;
      const status = isLive ? { cls: "held", text: `Live step ${live.n}` } : warning(id, leaves);
      const g = svgEl("g", { class: `map-node ${node.kind}${b.base ? " base" : ""}${isLive ? " holding" : ""}` }, svg);
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
    renderContinue();
  }

  /** The one way back into the session from here: its live step. */
  function renderContinue() {
    const live = workflowDoc.steps.at(-1);
    const go = q("mapContinue");
    const has = workflowDoc.steps.length > 1 || !!live?.output;
    go.href = "#/" + (live?.node ?? "tree");
    go.textContent = has ? `Continue the session: step ${workflowDoc.steps.length} →` : "Start with a tree →";
  }

  function init() {
    q("showRefs").addEventListener("change", render);
    workbench.onChange(() => { if (document.body.dataset.view === "map") render(); });
  }

  return { init, render };
})();
