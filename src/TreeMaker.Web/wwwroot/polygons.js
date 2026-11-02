// Toward a crease pattern: the steps after a layout (map nodes "Close the polygons", "Crease pattern", "Folded base",
// and the crease card under every solver's sheet).
//   Step 1: after a solve, ask the server whether the tight paths divide the leaves' hull into valid polygons, and
//           draw those polygons on the sheet.
//   Step 2: "Close the polygons" changes edge lengths (strain), with the leaves held in place, so more pairs become
//           tight; the result can be copied into the tree.
//   Step 3: "Build the crease pattern" fills every polygon with Lang's universal molecule, draws the creases on the
//           sheet, shows the folded base (folded.js), and offers FOLD and SVG downloads.
// The host app calls creaseReadiness.update(context) after each solve, creaseReadiness.restore(context, held) to pick
// up a closure and crease pattern from the workbench, and creaseReadiness.draw() after it redraws the sheet.
// context = { problem, gridSize, layout: [{leaf, x, y}], scale, edgeLengths? }. Results go back to the host through
// creaseReadiness.hooks: onReport(report), onCompletion(result, bounds), onCreases({ result, lengths, pleatHeight }).
"use strict";

const creaseReadiness = (() => {
  const SIZE = 600, PAD = 40;   // must match the sheet drawing in app.js
  const ui = { context: null, before: null, completion: null, view: "before", seq: 0, creases: null };
  const hooks = { onReport: null, onCompletion: null, onCreases: null, afterDraw: null };
  const call = (name, ...args) => { try { hooks[name]?.(...args); } catch (e) { console.error(e); } };

  const q = (id) => document.getElementById(id);
  const svgEl = (name, attrs = {}) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const num = (v, d = 4) => (v == null || Number.isNaN(v) ? "—" : String(parseFloat(Number(v).toFixed(d))));

  async function post(url, body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = null;
    try { data = await response.json(); } catch { /* empty */ }
    if (!response.ok) throw new Error(data?.error ?? data?.detail ?? data?.title ?? `${response.status} ${response.statusText}`);
    return data;
  }

  function request(extra = {}) {
    const c = ui.context;
    return {
      problem: c.problem,
      layout: c.layout.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })),
      scale: c.scale,
      edgeLengths: c.edgeLengths ?? null,
      ...extra,
    };
  }

  /** Called by the app after every solve that produced a layout (or with null to clear). */
  async function update(context) {
    return restore(context, null);
  }

  /**
   * Shows a layout and, from the workbench, the closure and crease pattern made from it:
   * held = { completion?, strainMin?, strainMax?, creases?: { result, lengths, pleatHeight } }.
   */
  async function restore(context, held) {
    const seq = ++ui.seq;   // any answer still on its way for an earlier layout is dropped
    ui.context = context;
    ui.before = null;
    ui.completion = null;
    ui.view = "before";
    clearCreases();
    const card = q("creaseCard");
    q("creaseSummary").textContent = "";
    q("creaseIssues").replaceChildren();
    q("completionOut").replaceChildren();
    q("creaseViews").hidden = true;
    q("buildCreases").disabled = true;
    document.getElementById("layoutView")?.querySelector("#polygonLayer")?.remove();
    if (!context || !context.layout?.length || !(context.scale > 0)) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    q("creaseSummary").textContent = "Checking the tight paths…";
    q("creaseIssues").replaceChildren();
    q("completionOut").replaceChildren();
    try {
      const report = await post("/api/polygons", request());
      if (seq !== ui.seq) return;
      ui.before = report;
      call("onReport", report);
      if (held?.completion) {
        ui.completion = held.completion;
        ui.view = held.completion.after ? "after" : "before";
        if (held.strainMin != null) q("strainMinC").value = held.strainMin;
        if (held.strainMax != null) q("strainMaxC").value = held.strainMax;
      }
      renderPanel();
      if (held?.creases?.result) {
        ui.creases = { result: held.creases.result, lengths: held.creases.lengths };
        if (held.creases.pleatHeight) { q("pleatOn").checked = true; q("pleatHeight").disabled = false; q("pleatHeight").value = held.creases.pleatHeight; }
        renderCreaseOut();
        if (held.creases.result.built) {
          const edges = ui.context.problem.edges.map((e) => ({ from: e.from, to: e.to }));
          foldedView.show(held.creases.result, edges, held.creases.result.edgePaperLengths);
        }
      }
      draw();
    } catch (e) {
      if (seq !== ui.seq) return;
      q("creaseSummary").textContent = "Could not check the polygons: " + e.message;
    }
  }

  async function complete() {
    if (!ui.context) return;
    const button = q("completeButton");
    button.disabled = true;
    q("completionOut").replaceChildren(note("Solving for edge lengths…"));
    try {
      const min = Number(q("strainMinC").value), max = Number(q("strainMaxC").value);
      const seq = ui.seq;
      const result = await post("/api/complete", request({ strainMin: min, strainMax: max }));
      if (seq !== ui.seq) return;
      ui.completion = result;
      ui.view = result.after ? "after" : "before";
      clearCreases();
      renderPanel();
      draw();
      call("onCompletion", result, { strainMin: min, strainMax: max });
    } catch (e) {
      q("completionOut").replaceChildren(note("The completion failed: " + e.message, "bad"));
    } finally {
      button.disabled = false;
    }
  }

  function note(text, kind) {
    const p = document.createElement("p");
    p.className = "crease-note" + (kind ? " " + kind : "");
    p.textContent = text;
    return p;
  }

  function current() {
    return ui.view === "after" && ui.completion?.after ? ui.completion.after : ui.before;
  }

  function summarize(report) {
    const polygons = report.polygons.length;
    const valid = report.polygons.filter((p) => p.valid).length;
    const hullPieces = boundaryPieces(report);
    const closed = hullPieces - report.missingBoundary.length;
    return `${report.tightPairs.length} tight pair${report.tightPairs.length === 1 ? "" : "s"} · ` +
      `${valid} of ${polygons} polygon${polygons === 1 ? "" : "s"} valid · ` +
      `boundary ${closed} of ${hullPieces} tight · ` +
      (report.hullArea - report.coveredArea > 1e-6 ? `${fmt(report.hullArea - report.coveredArea, 2)} square grid units not yet in a polygon` : "the whole hull in polygons");
  }

  // Number of hull-boundary pieces: those already tight plus those missing.
  function boundaryPieces(report) {
    const hull = new Set(report.hullLeaves);
    const tightOnHull = report.segments.filter((s) => hull.has(s.a) && hull.has(s.b) && isHullNeighbour(report, s)).length;
    return tightOnHull + report.missingBoundary.length;
  }

  function isHullNeighbour(report, s) {
    const h = report.hullLeaves;
    for (let k = 0; k < h.length; k++) {
      const a = h[k], b = h[(k + 1) % h.length];
      if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return true;
    }
    return false;
  }

  function renderPanel() {
    const report = current();
    if (!report) return;
    const status = q("creaseStatus");
    status.textContent = report.valid ? "Ready for crease generation" : "Not ready yet";
    status.className = "crease-status " + (report.valid ? "ok" : "no");
    q("creaseSummary").textContent = summarize(report);

    const issues = q("creaseIssues");
    issues.replaceChildren();
    for (const text of report.issues) {
      const li = document.createElement("li");
      li.textContent = text;
      issues.append(li);
    }
    if (report.valid) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "Every polygon is convex, bounded by tight paths, and empty, and together they cover the leaves' hull.";
      issues.append(li);
    }

    const views = q("creaseViews");
    views.hidden = !ui.completion?.after;
    for (const b of views.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.view === ui.view));

    renderCompletion();

    const build = q("buildCreases");
    build.disabled = !report.valid;
    build.title = report.valid ? "" : "Close the polygons first (step 2): every polygon must be valid.";
    q("creaseLengths").textContent = report.valid
      ? (ui.view === "after" && ui.completion?.after ? "Ready. It will use the edge lengths found by closing the polygons." : "Ready. It will use the edge lengths the layout was solved with.")
      : "Waits for step 2: every polygon must be valid first.";
    renderSteps(report);
  }

  /** The state chip on each step's heading, and the note that says when there is nothing to close. */
  function renderSteps(report) {
    const chip = (id, text, kind) => { const c = q(id); c.textContent = text; c.className = "step-state" + (kind ? " " + kind : ""); };
    const solvedValid = !!ui.before?.valid;
    chip("stepCheckState", solvedValid ? "ready as solved" : "needs closing", solvedValid ? "ok" : "no");
    if (solvedValid) chip("stepCloseState", "not needed", "ok");
    else if (ui.completion?.after?.valid) chip("stepCloseState", "closed", "ok");
    else if (ui.completion) chip("stepCloseState", "still open", "no");
    else chip("stepCloseState", "to do", "");
    const built = !!ui.creases?.result?.built;
    chip("stepBuildState", built ? "built" : report.valid ? "ready" : "waiting for step 2", built || report.valid ? "ok" : "");
    q("closeSkip").hidden = !solvedValid;
  }

  function renderCompletion() {
    const out = q("completionOut");
    out.replaceChildren();
    const r = ui.completion;
    if (!r) return;
    if (!r.after) {
      out.append(note(r.messages?.join(" ") || `The completion ended with status ${r.status}.`, "bad"));
      return;
    }
    out.append(note(r.messages.join(" "), r.after.valid ? "good" : ""));

    const facts = document.createElement("div");
    facts.className = "crease-facts";
    for (const [k, v] of [
      ["Pairs made tight", `${r.madeTight} of ${r.targets.length}`],
      ["Boundary pairs tight", `${r.boundaryMadeTight} of ${r.boundaryTargets}`],
      ["Total strain Σ|σₑ|", num(r.totalStrain)],
      ["Largest strain", num(r.largestStrain)],
      ["Model", `${r.variables} variables (${r.binaries} binary), ${r.constraints} rows`],
      ["Time", `${Math.round(r.milliseconds)} ms`],
    ]) {
      const fact = document.createElement("div");
      fact.className = "fact";
      const key = document.createElement("span"); key.className = "k"; key.textContent = k;
      const value = document.createElement("span"); value.className = "v"; value.textContent = v;
      fact.append(key, value);
      facts.append(fact);
    }
    out.append(facts);

    const tables = document.createElement("div");
    tables.className = "crease-tables";
    tables.append(
      table(["Target pair", "Boundary", "Before", "After", "Distance", "Required now"],
        r.targets.map((t) => [`${t.a}–${t.b}`, t.onBoundary ? "yes" : "", t.tightBefore ? "tight" : "", t.tightAfter ? "tight" : "—",
          num(t.distance), num(t.requiredAfter)]),
        (row, k) => r.targets[k].tightAfter ? "made" : "missed"),
      table(["Edge", "ℓₑ", "σₑ", "New ℓₑ"],
        r.edgeLengths.map((e) => [e.label, num(e.length), (e.strain > 0 ? "+" : "") + num(e.strain), num(e.newLength)]),
        (row, k) => Math.abs(r.edgeLengths[k].strain) > 1e-9 ? "changed" : ""),
    );
    out.append(tables);

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "quiet";
    apply.textContent = "Use these lengths in the tree";
    apply.addEventListener("click", () => {
      if (typeof applyEdgeLengths === "function") applyEdgeLengths(r.edgeLengths.map((e) => e.newLength));
      apply.disabled = true;
      apply.textContent = "Lengths copied to the tree. Solve again to place the leaves for them.";
    });
    out.append(apply);
  }

  function table(headers, rows, rowClass) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    t.className = "data";
    const head = document.createElement("tr");
    for (const h of headers) { const th = document.createElement("th"); th.textContent = h; head.append(th); }
    t.append(head);
    rows.forEach((cells, k) => {
      const tr = document.createElement("tr");
      const cls = rowClass?.(cells, k);
      if (cls) tr.className = cls;
      for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.append(td); }
      t.append(tr);
    });
    wrap.append(t);
    return wrap;
  }

  /** Draws the polygons of the current view onto the sheet (call after the sheet is redrawn). */
  function draw() {
    drawPolygons();
    call("afterDraw");
  }

  function drawPolygons() {
    const svg = document.getElementById("layoutView");
    svg.querySelector("#polygonLayer")?.remove();
    const report = current();
    const showPolygons = q("showPolygons").checked;
    const showCreases = !!ui.creases?.result?.built && q("showCreases").checked;
    q("polyKeys").hidden = true;
    q("polyTodo").hidden = true;
    document.querySelector('[data-layer="polygons"]').hidden = !current();
    document.querySelector('[data-layer="creases"]').hidden = !ui.creases?.result?.built;
    if (!report || !ui.context || (!showPolygons && !showCreases)) return;
    const n = ui.context.gridSize;
    const unit = (SIZE - 2 * PAD) / n;
    const pos = new Map(ui.context.layout.map((p) => [p.leaf, [PAD + p.x * unit, SIZE - PAD - p.y * unit]]));
    const layer = svgEl("g", { id: "polygonLayer" });

    // Hatch pattern for polygons that are not valid (readable in black and white).
    const defs = svgEl("defs");
    const pattern = svgEl("pattern", { id: "badHatch", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 8, class: "hatch-line" }));
    defs.append(pattern);
    layer.append(defs);

    // What still needs closing: the part of the hull no polygon covers (hull and polygons drawn even-odd, so
    // only the gaps fill), and every polygon that is not valid, labelled with why.
    const ring = (leaves) => leaves.map((l) => pos.get(l)).filter(Boolean);
    const pathOf = (pts) => pts.length ? "M" + pts.map(([x, y]) => `${x},${y}`).join("L") + "Z" : "";
    const hull = ring(report.hullLeaves ?? []);
    const uncovered = showPolygons && !report.valid && hull.length >= 3 && report.hullArea > 0 && report.coveredArea < report.hullArea * (1 - 1e-6);
    if (uncovered) {
      const d = pathOf(hull) + report.polygons.map((p) => pathOf(ring(p.leaves))).join("");
      layer.append(svgEl("path", { d, "fill-rule": "evenodd", class: "uncovered" }));
    }
    const open = [];
    for (const polygon of showPolygons ? report.polygons : []) {
      const pts = ring(polygon.leaves);
      const points = pts.map(([x, y]) => `${x},${y}`).join(" ");
      layer.append(svgEl("polygon", { points, class: "face " + (polygon.valid ? "valid" : "invalid") }));
      if (!polygon.valid && pts.length) open.push({ polygon, pts });
    }
    for (const s of showPolygons && !showCreases ? report.segments : []) {
      const a = pos.get(s.a), b = pos.get(s.b);
      if (a && b) layer.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "active-path" }));
    }
    for (const m of showPolygons ? report.missingBoundary : []) {
      const a = pos.get(m.a), b = pos.get(m.b);
      if (a && b) layer.append(svgEl("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "missing-path" }));
    }
    // Labels on the open polygons, and a ring round every leaf that sits inside one.
    if (showPolygons && !showCreases) {
      for (const { polygon, pts } of open) {
        for (const leaf of polygon.leavesInside ?? []) {
          const p = pos.get(leaf);
          if (p) layer.append(svgEl("circle", { cx: p[0], cy: p[1], r: 11, class: "inside-leaf" }));
        }
        const inside = polygon.leavesInside?.length ?? 0;
        const why = inside ? `${inside} lea${inside === 1 ? "f" : "ves"} inside` : polygon.convex === false ? "not convex" : "not closed";
        const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
        const tag = svgEl("g", { class: "open-tag" });
        const w = 7 * why.length + 14;
        tag.append(svgEl("rect", { x: cx - w / 2, y: cy - 10, width: w, height: 20, rx: 10 }));
        const text = svgEl("text", { x: cx, y: cy + 4, "text-anchor": "middle" });
        text.textContent = why;
        tag.append(text);
        layer.append(tag);
      }
    }
    if (showCreases) {
      const scaleXY = ([x, y]) => [PAD + x * unit, SIZE - PAD - y * unit];
      for (const c of ui.creases.result.creases) {
        if (c.kind === "Flat") continue;
        const [x1, y1] = scaleXY([c.a.x, c.a.y]), [x2, y2] = scaleXY([c.b.x, c.b.y]);
        const cls = "crease " + c.kind.toLowerCase() + (c.assignment ? " " + c.assignment.toLowerCase() : "");
        layer.append(svgEl("line", { x1, y1, x2, y2, class: cls }));
      }
    }
    // Under the leaves and labels, above the grid and circles.
    const firstLeaf = svg.querySelector(".leaf");
    if (firstLeaf) svg.insertBefore(layer, firstLeaf); else svg.append(layer);

    // Under the sheet: the key, and in words what is left to close.
    if (showPolygons && !showCreases) {
      q("polyKeys").hidden = false;
      const todo = q("polyTodo");
      const parts = [];
      const sides = report.missingBoundary.length;
      if (sides) parts.push(`${sides} hull side${sides === 1 ? "" : "s"} to make tight (dashed)`);
      if (open.length) parts.push(`${open.length} polygon${open.length === 1 ? "" : "s"} not valid (hatched)`);
      if (uncovered) parts.push(`${fmt(report.hullArea - report.coveredArea, 2)} square grid units of the outline not yet in a polygon (hatched)`);
      todo.hidden = false;
      todo.className = "poly-todo " + (report.valid ? "ok" : "no");
      todo.textContent = report.valid
        ? "Every polygon is valid: ready for the crease pattern."
        : `To close before a crease pattern: ${parts.join(", ") || "see the list under the sheet"}.`;
    }
  }

  /**
   * A:3 of the Polygon Closing TreeMaker spec (strain needed; precision ε = 0.01, rounding γ = 0.001).
   * Finds the smallest symmetric strain bound that closes every polygon, then closes them at it.
   *  1. Two LPs on the server (/api/strain-needed): the boundary pairs alone give a lower bound s_b (and prove at once
   *     that nothing works when they cannot all be made tight); the whole triangulation gives an upper bound s_t.
   *  2. When tightening the boundary already gives valid polygons, s_b is the answer: one closing solve.
   *  3. Otherwise bisect between s_b and s_t with the closing MILP, which may close the polygons with fewer tight pairs,
   *     to within 0.01.
   */
  /**
   * A:3 as a search any part of the app can run: the request (problem, layout, scale, edgeLengths) and a callback
   * for progress notes. Returns { result, bound, text, ok } (result null when nothing was tried), or { already } when
   * the polygons are valid already.
   */
  async function searchStrain(base, progress = () => {}, shouldStop = () => false) {
    const roundUp = (v) => Math.max(0.001, Math.ceil(v * 1000 * (1 + 1e-9) + 1e-9) / 1000);
    const close = (bound, targets) => {
      if (shouldStop()) throw new Error("Cancelled.");
      return post("/api/complete", { ...base, strainMin: -Math.min(bound, 0.99), strainMax: bound, ...(targets?.length ? { targets } : {}) });
    };
    progress("Finding the smallest strain that closes the polygons…");
    const need = await post("/api/strain-needed", base);
    if (need.alreadyValid) return { already: true, text: need.messages.join(" ") };
    if (need.boundaryStrain == null) return { result: null, text: need.messages.join(" "), ok: false };
    let lo = roundUp(need.boundaryStrain);
    if (need.boundaryValid) {
      const result = await close(lo, need.tightTargets);
      return { result, bound: lo, ok: !!result.after?.valid, text: `The smallest strain that closes every polygon is ±${lo.toFixed(3)}. ${need.messages.join(" ")}` };
    }
    let hi = roundUp(need.triangulationStrain ?? Math.max(0.99, 1.5 * need.boundaryStrain));
    progress(`${need.messages.join(" ")} Searching between ±${lo.toFixed(3)} and ±${hi.toFixed(3)}…`);
    let best = await close(hi);
    if (!best.after?.valid) return { result: best, bound: hi, ok: false, text: `Even strains within ±${hi.toFixed(3)} do not close every polygon with the leaves where they are. ${need.messages.join(" ")}` };
    let tries = 1;
    while (hi - lo > 0.01) {
      const mid = roundUp((lo + hi) / 2);
      if (mid >= hi) break;
      progress(`Closes at ±${hi.toFixed(3)}; trying ±${mid.toFixed(3)}…`);
      const result = await close(mid);
      tries++;
      if (result.after?.valid) { hi = mid; best = result; } else lo = mid;
    }
    return { result: best, bound: hi, ok: true, text: `The smallest strain found that closes every polygon is ±${hi.toFixed(3)} (${tries} closing solves). ${need.messages.join(" ")}` };
  }

  async function findStrain() {
    if (!ui.context) return;
    const button = q("findStrain");
    button.disabled = true;
    const seq = ui.seq;
    const roundUp = (v) => Math.max(0.001, Math.ceil(v * 1000 * (1 + 1e-9) + 1e-9) / 1000);
    const close = async (bound, targets) => {
      const lo = -Math.min(bound, 0.99);
      return post("/api/complete", request({ strainMin: lo, strainMax: bound, ...(targets?.length ? { targets } : {}) }));
    };
    const show = (result, bound, text, kind) => {
      q("strainMinC").value = (-Math.min(bound, 0.99)).toFixed(3);
      q("strainMaxC").value = bound.toFixed(3);
      ui.completion = result;
      ui.view = result.after ? "after" : "before";
      clearCreases();
      renderPanel();
      draw();
      q("completionOut").prepend(note(text, kind));
      call("onCompletion", result, { strainMin: -Math.min(bound, 0.99), strainMax: bound, note: text });
    };
    try {
      q("completionOut").replaceChildren(note("Finding the smallest strain that closes the polygons…"));
      const need = await post("/api/strain-needed", request());
      if (seq !== ui.seq) return;
      if (need.alreadyValid) {
        q("completionOut").replaceChildren(note(need.messages.join(" "), "good"));
        return;
      }
      if (need.boundaryStrain == null) {
        q("completionOut").replaceChildren(note(need.messages.join(" "), "bad"));
        return;
      }
      let lo = roundUp(need.boundaryStrain);
      if (need.boundaryValid) {
        const result = await close(lo, need.tightTargets);
        if (seq !== ui.seq) return;
        show(result, lo, `The smallest strain that closes every polygon is ±${lo.toFixed(3)}. ${need.messages.join(" ")}`, result.after?.valid ? "good" : "bad");
        return;
      }
      // Bisection with the closing MILP between the two LP bounds.
      let hi = roundUp(need.triangulationStrain ?? Math.max(0.99, 1.5 * need.boundaryStrain));
      q("completionOut").replaceChildren(note(`${need.messages.join(" ")} Searching between ±${lo.toFixed(3)} and ±${hi.toFixed(3)}…`));
      let best = await close(hi);
      if (seq !== ui.seq) return;
      if (!best.after?.valid) {
        show(best, hi, `Even strains within ±${hi.toFixed(3)} do not close every polygon with the leaves where they are. ${need.messages.join(" ")}`, "bad");
        return;
      }
      const tried = [hi];
      while (hi - lo > 0.01) {
        const mid = roundUp((lo + hi) / 2);
        if (mid >= hi) break;
        q("completionOut").replaceChildren(note(`Closes at ±${hi.toFixed(3)}; trying ±${mid.toFixed(3)}…`));
        const result = await close(mid);
        if (seq !== ui.seq) return;
        tried.push(mid);
        if (result.after?.valid) { hi = mid; best = result; } else lo = mid;
      }
      show(best, hi, `The smallest strain found that closes every polygon is ±${hi.toFixed(3)} (${tried.length} closing solves). ${need.messages.join(" ")}`, "good");
    } catch (e) {
      q("completionOut").replaceChildren(note("Finding the strain needed failed: " + e.message, "bad"));
    } finally {
      button.disabled = false;
    }
  }

  // ───── Step 3: crease pattern ─────

  function clearCreases() {
    ui.creases = null;
    const out = q("creaseOut");
    if (out) out.replaceChildren();
    for (const id of ["downloadFold", "downloadSvg"]) { const b = q(id); if (b) b.disabled = true; }
    if (typeof foldedView !== "undefined") foldedView.hide();
  }

  function currentLengths() {
    if (ui.view === "after" && ui.completion?.after) return ui.completion.edgeLengths.map((e) => e.newLength);
    return ui.context.edgeLengths ?? null;
  }

  async function buildCreases() {
    if (!ui.context) return;
    const button = q("buildCreases");
    button.disabled = true;
    q("creaseOut").replaceChildren(note("Building the universal molecules…"));
    try {
      const lengths = currentLengths();
      const pleatHeight = q("pleatOn").checked ? Number(q("pleatHeight").value) : null;
      if (pleatHeight !== null && !(pleatHeight > 0)) throw new Error("The pleat height must be a positive number of grid units.");
      const seq = ui.seq;
      const result = await post("/api/creases", request({ edgeLengths: lengths, pleatHeight }));
      if (seq !== ui.seq) return;
      ui.creases = { result, lengths };
      renderCreaseOut();
      renderSteps(current());
      draw();
      call("onCreases", { result, lengths, pleatHeight });
      if (result.built) {
        const edges = ui.context.problem.edges.map((e) => ({ from: e.from, to: e.to }));
        foldedView.show(result, edges, result.edgePaperLengths);
      }
    } catch (e) {
      q("creaseOut").replaceChildren(note("Building the crease pattern failed: " + e.message, "bad"));
    } finally {
      button.disabled = !current()?.valid;
    }
  }

  function renderCreaseOut() {
    const out = q("creaseOut");
    out.replaceChildren();
    const r = ui.creases?.result;
    if (!r) return;
    if (!r.built) {
      out.append(note(r.messages.join(" "), "bad"));
      return;
    }
    const ok = r.problems.length === 0;
    out.append(note(r.messages.join(" "), ok ? "good" : ""));
    if (!ok) {
      const ul = document.createElement("ul");
      ul.className = "crease-issues";
      for (const t of r.problems) { const li = document.createElement("li"); li.textContent = t; ul.append(li); }
      out.append(ul);
    }
    const counts = {};
    for (const c of r.creases) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    const facts = document.createElement("div");
    facts.className = "crease-facts";
    for (const [k, v] of [
      ["Axial creases", counts.Axial ?? 0], ["Ridge creases", counts.Ridge ?? 0], ["Hinge creases", counts.Hinge ?? 0],
      ["Gusset creases", counts.Gusset ?? 0], ["Facets", r.facets.length], ["Splitting depth", r.maxDepth],
      ["Tallest ridge", num(r.maxElevation, 3)], ["Folded height", num(r.foldedHeight, 3)],
      ["Pleat folds", counts.Pleat ?? 0], ["Time", `${Math.round(r.milliseconds)} ms`],
    ]) {
      const f = document.createElement("div"); f.className = "fact";
      const a = document.createElement("span"); a.className = "k"; a.textContent = k;
      const b = document.createElement("span"); b.className = "v"; b.textContent = v;
      f.append(a, b); facts.append(f);
    }
    out.append(facts);
    const key = document.createElement("div");
    key.className = "crease-key";
    key.innerHTML = '<span><i class="ck axial"></i>Axial</span><span><i class="ck ridge"></i>Ridge</span>' +
      '<span><i class="ck hinge"></i>Hinge</span><span><i class="ck gusset"></i>Gusset</span>' +
      (counts.Pleat ? '<span><i class="ck pleat-v"></i>Pleat, valley</span><span><i class="ck pleat-m"></i>Pleat, mountain</span>' : "");
    out.append(key);
    out.append(note(counts.Pleat
      ? "Pleats alternate valley and mountain; the other creases' fold directions are not assigned yet (step 5) and download as unassigned."
      : "Mountain and valley folds are not assigned yet (step 5); the downloads mark folds as unassigned."));
    for (const id of ["downloadFold", "downloadSvg"]) q(id).disabled = false;
  }

  // Splits every crease at any vertex lying on it, so the export is a proper plane graph.
  function planarGraph() {
    const r = ui.creases.result;
    const verts = [], keyOf = new Map();
    const id = (p) => {
      const key = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
      if (!keyOf.has(key)) { keyOf.set(key, verts.length); verts.push([p.x, p.y]); }
      return keyOf.get(key);
    };
    for (const f of r.facets) for (const p of f.paper) id(p);
    for (const c of r.creases) { id(c.a); id(c.b); }
    const onSeg = (v, a, b) => {
      const [px, py] = verts[v], [ax, ay] = verts[a], [bx, by] = verts[b];
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const len = Math.hypot(bx - ax, by - ay);
      if (Math.abs(cross) > 1e-6 * len) return null;
      const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len);
      return t > 1e-9 && t < 1 - 1e-9 ? t : null;
    };
    const edges = [], seen = new Set();
    for (const c of r.creases) {
      const a = id(c.a), b = id(c.b);
      const inner = [];
      for (let v = 0; v < verts.length; v++) {
        if (v === a || v === b) continue;
        const t = onSeg(v, a, b);
        if (t !== null) inner.push([t, v]);
      }
      inner.sort((x, y) => x[0] - y[0]);
      const chain = [a, ...inner.map((x) => x[1]), b];
      for (let k = 0; k + 1 < chain.length; k++) {
        const u = chain[k], w = chain[k + 1], key = u < w ? `${u}-${w}` : `${w}-${u}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ u, w, kind: c.kind, assignment: c.assignment ?? null }); }
      }
    }
    // Faces, with any vertex lying on a side inserted in order.
    const faces = r.facets.map((f) => {
      const ring = f.paper.map(id), out = [];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        out.push(a);
        const inner = [];
        for (let v = 0; v < verts.length; v++) {
          if (v === a || v === b) continue;
          const t = onSeg(v, a, b);
          if (t !== null) inner.push([t, v]);
        }
        inner.sort((x, y) => x[0] - y[0]).forEach((x) => out.push(x[1]));
      }
      return out;
    });
    // An edge used by only one face is on the outline of the paper used.
    const use = new Map();
    for (const ring of faces) for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
    for (const e of edges) e.boundary = (use.get(e.u < e.w ? `${e.u}-${e.w}` : `${e.w}-${e.u}`) ?? 0) === 1;
    return { verts, edges, faces };
  }

  function toFold() {
    const r = ui.creases.result;
    const { verts, edges, faces } = planarGraph();
    // The folded base as a second frame: each vertex lifted from its first facet.
    const edgesTree = ui.context.problem.edges;
    return JSON.stringify({
      file_spec: 1.1,
      file_creator: "TreeMaker MILP apps",
      file_classes: ["singleModel"],
      frame_title: "Crease pattern (universal molecules)",
      frame_classes: ["creasePattern"],
      frame_attributes: ["2D"],
      frame_unit: "unit",
      vertices_coords: verts,
      edges_vertices: edges.map((e) => [e.u, e.w]),
      edges_assignment: edges.map((e) => (e.boundary ? "B" : e.assignment ?? (e.kind === "Flat" ? "F" : "U"))),
      "treemaker:edges_kind": edges.map((e) => e.kind.toLowerCase()),
      faces_vertices: faces,
      "treemaker:faces_treeEdge": r.facets.map((f) => `${edgesTree[f.edge].from}-${edgesTree[f.edge].to}`),
    }, null, 1);
  }

  function toSvg() {
    const r = ui.creases.result;
    const n = ui.context.gridSize, k = 60, pad = 20, size = n * k + 2 * pad;
    const X = (x) => (pad + x * k).toFixed(3), Y = (y) => (pad + (n - y) * k).toFixed(3);
    const style = {
      Axial: 'stroke="#000" stroke-width="2.4"',
      Ridge: 'stroke="#444" stroke-width="1.4"',
      Hinge: 'stroke="#444" stroke-width="1.2" stroke-dasharray="6 4"',
      Gusset: 'stroke="#000" stroke-width="1.4" stroke-dasharray="10 4 2 4"',
      PleatV: 'stroke="#1f4e8c" stroke-width="1.2" stroke-dasharray="8 4"',
      PleatM: 'stroke="#c2304a" stroke-width="1.2" stroke-dasharray="10 3 2 3 2 3"',
    };
    const lines = r.creases.filter((c) => c.kind !== "Flat").map((c) =>
      `  <line x1="${X(c.a.x)}" y1="${Y(c.a.y)}" x2="${X(c.b.x)}" y2="${Y(c.b.y)}" ${style[c.kind === "Pleat" ? "Pleat" + c.assignment : c.kind]} stroke-linecap="round"><title>${c.kind}${c.assignment ? " (" + (c.assignment === "M" ? "mountain" : "valley") + ")" : ""}</title></line>`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>Crease pattern: axial (thick), ridge (solid), hinge (dashed), gusset (dash-dot), pleats: valley (blue dashed), mountain (red dash-dot-dot)</title>
  <rect x="${pad}" y="${pad}" width="${n * k}" height="${n * k}" fill="#fff" stroke="#999" stroke-width="1"/>
${lines.join("\n")}
</svg>`;
  }

  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function init() {
    q("completeButton").addEventListener("click", complete);
    q("showPolygons").addEventListener("change", draw);
    for (const b of q("creaseViews").querySelectorAll("button")) {
      b.addEventListener("click", () => { ui.view = b.dataset.view; clearCreases(); renderPanel(); draw(); });
    }
    q("buildCreases").addEventListener("click", buildCreases);
    q("findStrain").addEventListener("click", findStrain);
    q("pleatOn").addEventListener("change", () => { q("pleatHeight").disabled = !q("pleatOn").checked; });
    q("showCreases").addEventListener("change", draw);
    q("downloadFold").addEventListener("click", () => download("crease-pattern.fold", "application/json", toFold()));
    q("downloadSvg").addEventListener("click", () => download("crease-pattern.svg", "image/svg+xml", toSvg()));
  }

  /** Which part of the card the current map node is about: "close", "creases" or "all" (a solver's sheet). */
  function focus(step) {
    q("creaseCard").dataset.focus = step ?? "all";
  }

  /** The report the sheet shows now (as solved, or after closing). */
  function report() { return current(); }

  return { init, update, restore, draw, focus, report, searchStrain, hooks, _state: ui };
})();
