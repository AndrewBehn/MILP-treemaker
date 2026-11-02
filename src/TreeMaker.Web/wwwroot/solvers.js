// What differs between the solver families: the options each sends, what it knows before solving, and how its
// result is read out. One entry per API group; the map's solver nodes point at one of them (nodes.js):
//   pure       Pure MILP and Symmetry-Breaking MILP        /api/pure/*
//   optimized  Lattice-Hull MILP and Optimized MILP        /api/optimized/*
//   scalable   Scalable MILP                               /api/scalable/*
// Uses the helpers in app.js ($, el, fmt, stat, group, badge, int, fmtMs, fmtSigned, timeSpanMs, numberOrNull).
"use strict";

const SOLVERS = {};

// ───────────────────────── Base model (Pure MILP, Symmetry-Breaking MILP) ─────────────────────────

SOLVERS.pure = {
  cards: ["metricsCard", "pairsCard", "edgesCard"],
  panes: ["metrics", "messages", "pairsTable", "edgesTable"],
  sizeNote: "exact, before solving",
  solverSummary: "1% gap",
  gap: true,

  options(node) {
    const stage = document.querySelector('input[name="stage"]:checked').value;
    return {
      stage,
      fixedScale: stage === "Edge" && !$("autoScale").checked ? numberOrNull("fixedScale") : null,
      targetScale: numberOrNull("targetScale"),
      strainMin: numberOrNull("strainMin"),
      strainMax: numberOrNull("strainMax"),
      strainObjective: $("strainObjective").value,
      relativeGap: numberOrNull("relativeGap"),
      symmetryBreaking: !!node.extra?.symmetryBreaking,
    };
  },

  updateParams() {
    const stage = document.querySelector('input[name="stage"]:checked').value;
    for (const note of document.querySelectorAll(".stage-note[data-for]")) note.hidden = note.dataset.for !== stage;
    $("edgeParams").hidden = stage !== "Edge";
    $("strainParams").hidden = stage !== "Strain";
    $("fixedScale").disabled = $("autoScale").checked;
  },

  renderAnalysis(a, request) {
    const m = a.predictedModel;
    $("analysis").replaceChildren(
      stat("Variables", m.variables.toLocaleString(), `${m.binaryVariables.toLocaleString()} binary`),
      stat("Constraints", m.constraints.toLocaleString()),
      stat("Nonzeros", m.nonzeros.toLocaleString()),
      stat("Leaf pairs", m.pairCount.toLocaleString(), `× ${m.selectorsPerPair.toLocaleString()} offsets`),
      stat("Scale bound m̄", fmt(a.scaleUpperBound, 4)),
    );
    const P = m.pairCount, S = m.selectorsPerPair, n = m.leafCount, N = request.gridSize;
    const E = request.edges.length, mirrors = request.mirrorPairs.length;
    const largest = request.strainObjective === "LargestAbsolute";
    const continuous = {
      Scale: ["Scale m", "1"],
      Edge: ["Stretch σ", "1"],
      Strain: [largest ? "Strains σₑ, |σₑ| and a_max" : "Strains σₑ and |σₑ|", largest ? `2|E| + 1 = 2 × ${E} + 1` : `2|E| = 2 × ${E}`],
    }[request.stage];
    let rowFormula = `4P = 4 × ${P}`;
    if (mirrors) rowFormula += ` + 2 × ${mirrors} mirror`;
    if (request.stage === "Strain") rowFormula += largest ? ` + 3|E| = + 3 × ${E}` : ` + 2|E| = + 2 × ${E}`;
    if (request.symmetryBreaking) rowFormula += " + C:5, C:6";
    const rows = [
      ["Offset choices w (binary)", `P × |Δ_N| = ${P} × ${S.toLocaleString()}`, m.binaryVariables],
      ["Leaf positions x, y (integer)", `2n = 2 × ${n}`, m.integerVariables],
      [continuous[0] + " (continuous)", continuous[1], m.continuousVariables],
      ["Variables", "", m.variables, "total"],
      ["Constraints", rowFormula, m.constraints, "total"],
      ["Nonzeros", "", m.nonzeros, "total"],
    ];
    sizeTable(rows, `P = n(n − 1)/2 = ${P} leaf pairs; |Δ_N| = (2N + 1)² − 1 = ${S.toLocaleString()} offsets for N = ${N}.`);
  },

  isCancelled: (response) => response?.cancelled && !response.result,
  statusText: (response) => `${response.result.status} in ${fmtMs(response.totalMilliseconds)}`,

  normalize(response) {
    const r = response.result;
    return { status: r.status, layout: r.layout ?? [], scale: r.scale, pairs: r.pairs ?? [], edgeLengths: r.edgeLengths ?? [], violations: r.violations ?? [], messages: r.messages ?? [] };
  },

  renderMetrics(response, request) {
    const r = response.result;
    const m = r.model, s = r.metrics;
    const objectiveName = { Scale: "Scale m*", Edge: "Stretch σ*", Strain: request?.strainObjective === "LargestAbsolute" ? "Largest strain" : "Total strain" }[r.stage] ?? "objective";
    const solution = [
      ["Status", badge(r.status)],
      [objectiveName, fmt(r.objective, 6)],
      ["Model", r.stage],
      ["Best bound", fmt(r.bestBound, 6)],
      ["Relative gap", r.relativeGap == null ? "—" : (r.relativeGap * 100).toPrecision(3) + " %"],
      ...(r.stage === "Scale" ? [] : [["Scale m₀", fmt(r.scale, 6)]]),
      ["TreeMaker scale m/N", fmt(r.treeMakerScale, 6)],
    ];
    if (r.stage === "Edge") solution.push(["Stretch σ", fmt(r.stretch, 6)]);
    if (r.stage === "Strain") {
      solution.push(["Total |σₑ|", fmt(r.totalStrain, 6)]);
      solution.push(["Largest |σₑ|", fmt(r.largestStrain, 6)]);
    }
    const model = [
      ["Variables", int(m.variables)],
      ["Binary (w)", int(m.binaryVariables)],
      ["Integer (x, y)", int(m.integerVariables)],
      ["Continuous", int(m.continuousVariables)],
      ["Constraints", int(m.constraints)],
      ["Nonzeros", int(m.nonzeros)],
      ["Leaves", int(m.leafCount)],
      ["Leaf pairs", int(m.pairCount)],
      ["Offsets per pair", int(m.selectorsPerPair)],
      ["m̄", fmt(m.scaleUpperBound, 4)],
    ];
    const solveRows = [
      ["Solver", r.solverName],
      ["Build", fmtMs(response.buildMilliseconds)],
      ["Solve", fmtMs(response.solveMilliseconds)],
      ["Total (request)", fmtMs(response.totalMilliseconds)],
      ["B&B nodes", int(s?.nodes)],
      ["LP iterations", int(s?.iterations)],
    ];
    const groups = [group("Solution", solution), group("Model", model), group("Solve", solveRows)];
    if (r.stageOne) {
      const o = r.stageOne;
      groups.push(group("Stage one (scale)", [
        ["Status", badge(o.status)],
        ["m*", fmt(o.scale, 6)],
        ["Variables", int(o.model.variables)],
        ["Constraints", int(o.model.constraints)],
        ["Time", fmtMs(response.stageOneMilliseconds)],
        ["B&B nodes", int(o.metrics.nodes)],
      ]));
    }
    $("metrics").replaceChildren(...groups);
  },

  renderExtras(response) {
    const r = response.result;
    $("edgesCard").hidden = !(r.edgeLengths && r.edgeLengths.length);
    const table = $("edgesTable");
    table.replaceChildren(headRow(["Edge", "ℓₑ", "σₑ", "ℓₑ(1 + σₑ)"]));
    for (const e of r.edgeLengths ?? []) table.append(dataRow([e.label, fmt(e.length, 4), fmtSigned(e.strain, 4), fmt(e.newLength, 4)]));
  },
};

// ───────────────────────── Lattice hulls and bisection (Lattice-Hull MILP, Optimized MILP) ─────────────────────────

SOLVERS.optimized = {
  cards: ["metricsCard", "pairsCard", "traceCard", "hullCard"],
  panes: ["metrics", "messages", "pairsTable", "traceTable", "ladder", "hullView", "hullPair", "hullNote"],
  sizeNote: "known before solving",
  solverSummary: "1% gap",
  gap: true,

  options(node) {
    return {
      options: {
        symmetryBreaking: node.lockOptions?.symmetryBreaking ?? $("optSymmetry").checked,
        pairGeneration: $("optPairs").checked,
        facetGeneration: $("optFacets").checked,
        leafWindows: $("optWindows").checked,
        windowHalfWidth: Math.max(0, Math.round(numberOrNull("optH") ?? 2)),
        useSeed: $("optSeed").checked,
        compareWithBase: $("optCompare").checked,
        relativeGap: Math.max(0, numberOrNull("relativeGap") ?? 0),
      },
    };
  },

  updateParams() {
    $("optH").disabled = !$("optWindows").checked;
  },

  renderAnalysis(a, request) {
    const base = a.baseModel;
    $("analysis").replaceChildren(
      stat("Candidate scales", a.candidateCount.toLocaleString(), `≤ ${a.maxTests} tests`),
      stat("Feas(m) binaries", `≤ ${a.worstCaseBinaries.toLocaleString()}`, "per solve"),
      stat("Base model binaries", base.binaryVariables.toLocaleString(), "one solve"),
      stat("Leaf pairs", a.pairs.toLocaleString()),
      stat("Scale bound m̄", fmt(a.scaleUpperBound, 4)),
    );
    const rows = [
      ["Candidate scales K", `${a.distinctSquaredLengths} lengths × ${a.distinctPathLengths} ℓ, ≤ m̄`, a.candidateCount],
      ["Bisection tests", "⌈log₂ K⌉", a.maxTests],
      ["Feas(m) binaries, worst scale", "Σ facets per pair", a.worstCaseBinaries],
    ];
    if (a.atSeed) rows.push([`Feas(m) at the seed, m = ${fmt(a.atSeed.scale, 3)}`, `${a.atSeed.rows.toLocaleString()} rows`, a.atSeed.binaries]);
    rows.push(["Base model binaries", `P × |Δ_N| = ${base.pairCount} × ${base.selectorsPerPair}`, base.binaryVariables, "total"]);
    const sym = a.symmetry;
    const parts = [];
    if (request.options.symmetryBreaking) {
      parts.push(sym.anchor ? `Anchor leaf ${sym.anchor}.` : "No anchor leaf.");
      if (sym.siblingGroups.length) parts.push(`Interchangeable siblings: ${sym.siblingGroups.map((g) => g.join(" = ")).join("; ")}.`);
      if (sym.note) parts.push(sym.note);
    }
    parts.push("Incremental rounds use fewer binaries; how many rounds each test needs is not known in advance.");
    sizeTable(rows, parts.join(" "));
  },

  isCancelled: (response) => response?.cancelled && !response.status,
  statusText: (response) => `${response.status} in ${fmtMs(response.milliseconds)}`,

  normalize(r) {
    return { status: r.status, layout: r.layout ?? [], scale: r.scale, pairs: r.pairs ?? [], edgeLengths: r.edgeLengths ?? [], violations: r.violations ?? [], messages: r.messages ?? [] };
  },

  renderMetrics(r) {
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
      ["Bisection tests", `${int(r.tests?.length ?? 0)} of ≤ ${int(r.maxTests)}`],
      ["MILP solves", int(r.totalSolves)],
      ["Largest solve", `${int(r.maxBinariesPerSolve)} binaries`],
      ["Binaries, all solves", int(r.totalBinaries)],
      ["Total time", fmtMs(r.milliseconds)],
    ];
    const full = r.fullModelAtOptimum;
    const base = r.baseModel;
    const compare = [
      ["Base model binaries", int(base?.binaryVariables)],
      ["Base rows / nonzeros", `${int(base?.constraints)} / ${int(base?.nonzeros)}`],
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
  },

  renderExtras(r, request, fresh) {
    $("traceCard").hidden = !(r.tests && r.tests.length) && !r.candidateCount;
    $("hullCard").hidden = !(r.hulls && r.hulls.length);
    $("traceTitle").textContent = "Bisection";
    $("traceSub").textContent = "each test asks whether a layout exists at one trial scale";
    $("ladderKey").innerHTML = '<span><i class="mk yes"></i>Layout found</span><span><i class="mk no"></i>Proved no layout</span><span><i class="tk"></i>Candidate scale</span>';
    $("roundsBox").hidden = true;
    $("hullTitle").textContent = "Lattice hull at m*";
    $("hullPick").hidden = false;
    $("hullKey").innerHTML = '<span><i class="lpk f"></i>Too short</span><span><i class="lpk"></i>Allowed</span><span><i class="ck"></i>Radius m*·ℓ</span>';
    renderBisection(r);
    if (fresh === true || state.hullPair == null) {
      const tight = (r.hulls ?? []).findIndex((h) => h.tight);
      state.hullPair = Math.max(0, tight);
    }
    renderHull(r);
  },
};

function renderBisection(r) {
  const svg = $("ladder");
  svg.replaceChildren();
  const tests = r.tests ?? [];
  const width = svg.clientWidth || 700, height = 92, pad = 26;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const values = r.candidates?.length ? r.candidates : tests.map((t) => t.scale);
  const table = $("traceTable");
  table.replaceChildren(headRow(["Test", "Trial m", "Answer", "Phases", "Solves", "Largest solve", "Time"]));
  if (!values.length) return;
  const min = Math.min(...values, ...tests.map((t) => t.scale)), max = Math.max(...values, ...tests.map((t) => t.scale));
  const X = (v) => pad + (max > min ? (v - min) / (max - min) : 0.5) * (width - 2 * pad);
  const axisY = 58;
  svg.append(el("line", { x1: pad, y1: axisY, x2: width - pad, y2: axisY, class: "ladder-axis" }));
  for (const v of r.candidates ?? []) svg.append(el("line", { x1: X(v), y1: axisY - 4, x2: X(v), y2: axisY + 4, class: "ladder-tick" }));
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
  for (const t of tests) {
    const phases = t.phases.map((p) => `${p.windowed ? "windowed" : "full grid"}: ${p.outcome.toLowerCase()} after ${p.rounds.length}`).join("; ");
    table.append(dataRow([t.test, fmt(t.scale, 6), t.answer, phases, t.solves, `${int(t.maxBinaries)} binaries`, fmtMs(t.milliseconds)], "answer-" + t.answer.toLowerCase()));
  }
}

function renderHull(r) {
  const hulls = r.hulls ?? [];
  const select = $("hullPair");
  select.replaceChildren(...hulls.map((h, k) => new Option(`${h.a}–${h.b}${h.tight ? " (tight)" : ""}`, k)));
  const svg = $("hullView");
  svg.replaceChildren();
  if (!hulls.length) return;
  const k = Math.min(state.hullPair ?? 0, hulls.length - 1);
  select.value = k;
  const h = hulls[k];
  const reach = Math.max(2, Math.ceil(Math.max(Math.sqrt(h.limit + 1), Math.abs(h.dx), Math.abs(h.dy))) + 1);
  const size = 320, pad = 14, unit = (size - 2 * pad) / (2 * reach);
  const X = (x) => size / 2 + x * unit, Y = (y) => size / 2 - y * unit;
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.append(el("circle", { cx: X(0), cy: Y(0), r: h.radius * unit, class: "hull-circle" }));
  if (h.vertices.length >= 3) svg.append(el("polygon", { points: h.vertices.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), class: "hull-poly" }));
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

// ───────────────────────── Four-stage pipeline (Scalable MILP) ─────────────────────────

const GOOD = new Set(["Layout", "Improved", "Optimal", "Feasible", "Polygons closed"]);

SOLVERS.scalable = {
  cards: ["metricsCard", "pairsCard", "traceCard", "hullCard"],
  panes: ["metrics", "messages", "pairsTable", "traceTable", "roundTable", "ladder", "hullView", "hullNote"],
  sizeNote: "known before solving",
  solverSummary: "threads",
  gap: false,

  options() {
    return {
      options: {
        multistarts: Math.max(1, Math.round(numberOrNull("optStarts") ?? 4)),
        repairHalfWidth: Math.max(1, Math.round(numberOrNull("optRepairH") ?? 1)),
        neighbourhoodSearch: $("optLns").checked,
        neighbourhoodHalfWidth: Math.max(1, Math.round(numberOrNull("optLnsH") ?? 3)),
        subtreeNeighbourhoods: $("optSubtrees").checked,
        maximizeTightPairs: $("optTight").checked,
        closeWithMovingLeaves: $("optClose").checked,
        strainMin: Math.min(0, numberOrNull("optStrainMin") ?? -0.3),
        strainMax: Math.max(0, numberOrNull("optStrainMax") ?? 0.3),
        windowSeconds: Math.max(1, numberOrNull("optWindowSec") ?? 20),
        neighbourhoodSeconds: Math.max(1, numberOrNull("optLnsSec") ?? 10),
        randomSeed: state.randomSeed,
      },
    };
  },

  updateParams() {
    $("optLnsH").disabled = $("optSubtrees").disabled = !$("optLns").checked;
    $("optStrainMin").disabled = $("optStrainMax").disabled = !$("optClose").checked;
  },

  renderAnalysis(a, request) {
    const base = a.baseModel;
    $("analysis").replaceChildren(
      stat("Leaves", a.leaves.toLocaleString(), `${a.pairs.toLocaleString()} pairs`),
      stat("Stage 1 LP", `${a.lpVariables.toLocaleString()} × ${a.lpRows.toLocaleString()}`, "vars × rows"),
      stat("Repair model", `≤ ${a.repairBooleans.toLocaleString()}`, "Booleans"),
      stat("Base model binaries", base.binaryVariables.toLocaleString(), "one solve"),
      stat("Scale bound m̄", fmt(a.scaleUpperBound, 4)),
    );
    const h = request.options.repairHalfWidth;
    sizeTable([
      ["Stage 1: each LP", `2·${a.leaves} + 1 variables, one row per pair`, a.lpRows],
      ["Stage 2: repair window points", `(2h + 1)², h = ${h}`, a.repairWindowPoints],
      ["Stage 2: repair Booleans, at most", `${a.leaves} leaves × ${a.repairWindowPoints}`, a.repairBooleans],
      ["Base model binaries", `P × |Δ_N| = ${base.pairCount} × ${base.selectorsPerPair}`, base.binaryVariables, "total"],
    ], "Only pairs whose windows could collide get a table, so the repair and search models stay far below the base model. " +
      "How many repair tests and search rounds run depends on the layout.");
  },

  isCancelled: (response) => response?.cancelled && !response.status,
  statusText: (response) => `${response.status} in ${fmtMs(response.milliseconds)}`,

  normalize(r) {
    return { status: r.status, layout: r.layout ?? [], scale: r.scale, pairs: r.pairs ?? [], edgeLengths: r.edgeLengths ?? [], violations: r.violations ?? [], messages: r.messages ?? [], polygonsValid: r.polygonsValid };
  },

  renderMetrics(r) {
    const solution = [
      ["Status", badge(r.status)],
      ["Scale m", fmt(r.scale, 6)],
      ["Continuous scale", fmt(r.continuousScale, 6)],
      ["Grid / continuous", r.scale && r.continuousScale ? `${(100 * r.scale / r.continuousScale).toFixed(1)} %` : "—"],
      ["Proved bound", `m ≤ m̄ = ${fmt(r.upperBound, 6)}`],
      ["TreeMaker scale m/N", fmt(r.treeMakerScale, 6)],
    ];
    const stageRows = (r.stages ?? []).map((st) => [`${st.stage}. ${st.name}`, `${st.scale == null ? "—" : "m = " + fmt(st.scale, 4)} · ${fmtMs(st.milliseconds)}`]);
    stageRows.push(["Solves, all stages", int(r.totalSolves)]);
    stageRows.push(["Largest solve", `${int(r.largestSolve)} variables`]);
    stageRows.push(["Total time", fmtMs(r.milliseconds)]);
    const strains = (r.edgeLengths ?? []).map((e) => Math.abs(e.strain));
    const fold = [
      ["Tight pairs", `${int(r.tightBefore)} → ${int(r.tightAfter)}`],
      ["Polygons", r.layout?.length ? (r.polygonsValid ? "Valid" : "Not all valid") : "—"],
      ["Largest strain", strains.length ? `${(100 * Math.max(...strains)).toFixed(1)} %` : "None"],
    ];
    const base = r.baseModel;
    const compare = [
      ["Base model binaries", int(base?.binaryVariables)],
      ["Base rows / nonzeros", `${int(base?.constraints)} / ${int(base?.nonzeros)}`],
    ];
    $("metrics").replaceChildren(group("Solution", solution), group("Stages", stageRows), group("Foldability", fold), group("Model size", compare));
  },

  renderExtras(r, request) {
    $("traceCard").hidden = !(r.rounds && r.rounds.length);
    $("hullCard").hidden = !(r.continuousLayout && r.continuousLayout.length);
    $("traceTitle").textContent = "Stages";
    $("traceSub").textContent = "every solve's scale, from the continuous start to the finish";
    $("ladderKey").innerHTML = '<span><i class="mk yes"></i>Layout found or improved</span><span><i class="mk no"></i>No layout, or no gain</span><span><i class="tk"></i>Continuous scale</span>';
    $("roundsBox").hidden = false;
    $("hullTitle").textContent = "Continuous to grid";
    $("hullPick").hidden = true;
    $("hullKey").innerHTML = '<span><i class="ck"></i>Continuous point</span><span><i class="lpk f"></i>Grid point</span>';
    renderStages(r);
    renderContinuous(r, request);
  },
};

function renderStages(r) {
  const svg = $("ladder");
  svg.replaceChildren();
  const rounds = r.rounds ?? [];
  const width = svg.clientWidth || 700, height = 92, pad = 26;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const table = $("traceTable");
  table.replaceChildren(headRow(["Stage", "Result", "Solves", "Largest solve", "Time"]));
  const detail = $("roundTable");
  detail.replaceChildren(headRow(["#", "Stage", "Solve", "Scale", "Outcome", "Free leaves", "Variables", "Rows", "Time"]));
  if (rounds.length) {
    const values = rounds.map((x) => x.scale).concat(r.scale ?? [], r.continuousScale ?? []).filter((v) => v > 0);
    const min = Math.min(...values), max = Math.max(...values);
    const X = (v) => pad + (max > min ? (v - min) / (max - min) : 0.5) * (width - 2 * pad);
    const axisY = 58;
    svg.append(el("line", { x1: pad, y1: axisY, x2: width - pad, y2: axisY, class: "ladder-axis" }));
    for (const [v, anchor, label] of [[min, "start", fmt(min, 3)], [max, "end", fmt(max, 3)]]) {
      const t = el("text", { x: X(v), y: axisY + 22, "text-anchor": anchor, class: "ladder-label" });
      t.textContent = label;
      svg.append(t);
    }
    if (r.continuousScale) {
      const x = X(r.continuousScale);
      svg.append(el("line", { x1: x, y1: 10, x2: x, y2: axisY + 8, class: "ladder-tick continuous" }));
    }
    if (r.scale != null) {
      const x = X(r.scale);
      svg.append(el("line", { x1: x, y1: 10, x2: x, y2: axisY + 8, class: "ladder-optimum" }));
      const t = el("text", { x, y: axisY + 22, "text-anchor": "middle", class: "ladder-label strong" });
      t.textContent = `m = ${fmt(r.scale, 4)}`;
      svg.append(t);
    }
    rounds.forEach((round) => {
      if (round.stage === 1 && round.outcome !== "Improved") return;   // keep the LP steps that moved
      const x = X(round.scale), y = 12 + (round.stage - 1) * 11;
      const answer = GOOD.has(round.outcome) ? "yes" : round.outcome === "No layout" || round.outcome === "Stalled" ? "no" : "unknown";
      const mark = el("circle", { cx: x, cy: y, r: 4.5, class: "ladder-mark " + answer });
      const title = el("title");
      title.textContent = `Stage ${round.stage}, ${round.kind}: m = ${fmt(round.scale, 6)} → ${round.outcome}`;
      mark.append(title);
      svg.append(mark);
    });
  }
  for (const st of r.stages ?? []) {
    table.append(dataRow([`${st.stage}. ${st.name}`, st.note, st.solves, `${int(st.largestSolve)} variables`, fmtMs(st.milliseconds)]));
  }
  rounds.forEach((round, k) => {
    const cls = GOOD.has(round.outcome) ? "answer-yes" : round.outcome === "No layout" ? "answer-no" : "";
    detail.append(dataRow([k + 1, round.stage, round.kind, fmt(round.scale, 6), round.outcome, int(round.freeLeaves), int(round.variables), int(round.constraints), fmtMs(round.milliseconds)], cls));
  });
  $("roundCount").textContent = `${rounds.length} solves`;
}

function renderContinuous(r, request) {
  const svg = $("hullView");
  svg.replaceChildren();
  const points = r.continuousLayout ?? [];
  if (!points.length) return;
  const N = request.gridSize;
  const size = 320, pad = 14, unit = (size - 2 * pad) / N;
  const X = (x) => pad + x * unit, Y = (y) => size - pad - y * unit;
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.append(el("rect", { x: X(0), y: Y(N), width: N * unit, height: N * unit, class: "grid-border" }));
  const grid = new Map((r.layout ?? []).map((p) => [p.leaf, p]));
  let moved = 0, total = 0;
  for (const p of points) {
    const g = grid.get(p.leaf);
    if (g) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      total += d; moved = Math.max(moved, d);
      svg.append(el("line", { x1: X(p.x), y1: Y(p.y), x2: X(g.x), y2: Y(g.y), class: "hull-offset thin" }));
      svg.append(el("circle", { cx: X(g.x), cy: Y(g.y), r: 2.6, class: "lp forbidden" }));
    }
    const dot = el("circle", { cx: X(p.x), cy: Y(p.y), r: 3.2, class: "hull-offset-end hollow" });
    const title = el("title");
    title.textContent = `${p.leaf}: (${fmt(p.x, 2)}, ${fmt(p.y, 2)})` + (g ? ` → (${g.x}, ${g.y})` : "");
    dot.append(title);
    svg.append(dot);
  }
  $("hullNote").textContent =
    `Stage 1 reached m = ${fmt(r.continuousScale, 4)} with the leaves anywhere on the sheet. ` +
    `On the grid, each leaf moved ${fmt(total / points.length, 2)} grid units on average (at most ${fmt(moved, 2)}).`;
}

// ───────────────────────── Small table helpers ─────────────────────────

function headRow(headers) {
  const tr = document.createElement("tr");
  for (const h of headers) { const th = document.createElement("th"); th.textContent = h; tr.append(th); }
  return tr;
}

function dataRow(values, className) {
  const tr = document.createElement("tr");
  if (className) tr.className = className;
  for (const v of values) { const td = document.createElement("td"); td.textContent = v ?? "—"; tr.append(td); }
  return tr;
}

/** The "Model size" table under the tree: rows of [label, formula, value, "total"?] and a note. */
function sizeTable(rows, noteText) {
  const box = $("sizeBreakdown");
  box.classList.remove("stale");
  const table = document.createElement("table");
  for (const [label, formula, value, kind] of rows) {
    const tr = document.createElement("tr");
    if (kind === "total") tr.className = "total";
    tr.innerHTML = `<th scope="row"></th><td class="f"></td><td class="n"></td>`;
    tr.children[0].textContent = label;
    tr.children[1].textContent = formula;
    tr.children[2].textContent = Number(value).toLocaleString();
    table.append(tr);
  }
  const note = document.createElement("p");
  note.className = "size-note";
  note.textContent = noteText;
  box.replaceChildren(table, note);
}
