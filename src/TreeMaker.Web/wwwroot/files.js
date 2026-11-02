// Tree and layout files. The formats are defined by schemas/treemaker-tree.schema.json and
// schemas/treemaker-layout.schema.json at the top of the repository.
//   Save tree:   the tree in the editor, its grid size, leaf conditions and mirror pairs.
//   Save layout: the layout on the sheet, with its scale and the edge lengths in use (the closed lengths when the
//                crease panel shows "After closing").
//   Open…:       a tree file loads into the editor; a layout file loads its tree and goes on the workbench as the
//                layout, ready for the steps after a solve and as the starting point of the next solve; a session
//                file (schemas/treemaker-session.schema.json, saved by workflow.js) becomes the workflow document.
// The host app calls treeFiles.init({ appName, getProblem, applyTree, importLayout, status, openButtons }).
"use strict";

const treeFiles = (() => {
  const q = (id) => document.getElementById(id);
  let host = null;

  const CONDITION_KINDS = new Set(["LeftEdge", "RightEdge", "BottomEdge", "TopEdge", "BottomLeftCorner", "BottomRightCorner",
    "TopLeftCorner", "TopRightCorner", "OnSymmetryAxis", "Fixed"]);

  function treeOf(problem) {
    const tree = {
      gridSize: problem.gridSize,
      edges: problem.edges.map((e) => {
        const edge = { from: e.from, to: e.to, length: Number(e.length) };
        if (e.stretch) edge.stretch = true;
        return edge;
      }),
    };
    if (problem.leafConditions?.length) tree.leafConditions = problem.leafConditions.map((c) => ({ leaf: c.leaf, kind: c.kind, x: c.x ?? null, y: c.y ?? null }));
    if (problem.mirrorPairs?.length) tree.mirrorPairs = problem.mirrorPairs.map((m) => ({ a: m.a, b: m.b }));
    return tree;
  }

  function download(name, object) {
    const blob = new Blob([JSON.stringify(object, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function saveTree() {
    const problem = host.getProblem();
    download("tree.json", { format: "treemaker-tree", version: 1, ...treeOf(problem) });
    host.status?.(`Saved the tree (${problem.edges.length} edges) as tree.json.`);
  }

  /** The solved layout on the sheet, from the crease panel's context (set after every solve or import). */
  function current() {
    const ui = typeof creaseReadiness !== "undefined" ? creaseReadiness._state : null;
    const c = ui?.context;
    if (!c?.layout?.length) return null;
    let lengths = c.edgeLengths ?? null;
    if (ui.view === "after" && ui.completion?.after) lengths = ui.completion.edgeLengths.map((e) => e.newLength);
    return { problem: c.problem, layout: c.layout, scale: c.scale, edgeLengths: lengths };
  }

  /** Saves the layout on the sheet, or the one given: { problem, layout: [{leaf, x, y}], scale, edgeLengths }. */
  function saveLayout(given) {
    const s = given?.layout ? given : current();
    if (!s) return;
    const file = {
      format: "treemaker-layout",
      version: 1,
      tree: treeOf(s.problem),
      gridSize: s.problem.gridSize,
      scale: s.scale,
      edgeLengths: s.edgeLengths,
      leaves: s.layout.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })),
      solvedBy: { app: typeof host.appName === "function" ? host.appName() : host.appName, savedAt: new Date().toISOString() },
    };
    download("layout.json", file);
    host.status?.(`Saved the layout (${file.leaves.length} leaves, m = ${Number(s.scale).toPrecision(6)}) as layout.json.`);
  }

  // ───── Reading and checking ─────

  function fail(message) { throw new Error(message); }
  const isName = (v) => typeof v === "string" && v.length > 0;

  function checkTree(t, where) {
    if (!t || typeof t !== "object") fail(`${where} is not an object.`);
    if (!Array.isArray(t.edges) || !t.edges.length) fail(`${where} needs a non-empty "edges" list.`);
    t.edges.forEach((e, k) => {
      if (!isName(e?.from) || !isName(e?.to)) fail(`Edge ${k + 1} needs "from" and "to" vertex names.`);
      if (!(typeof e.length === "number" && e.length > 0)) fail(`Edge ${k + 1} (${e.from}–${e.to}) needs a positive "length".`);
    });
    if (t.gridSize != null && !(Number.isInteger(t.gridSize) && t.gridSize >= 1)) fail(`"gridSize" must be a positive whole number.`);
    for (const c of t.leafConditions ?? []) {
      if (!isName(c?.leaf) || !CONDITION_KINDS.has(c.kind)) fail(`Leaf condition ${JSON.stringify(c)} needs a "leaf" and a known "kind".`);
    }
    for (const m of t.mirrorPairs ?? []) if (!isName(m?.a) || !isName(m?.b)) fail(`Mirror pair ${JSON.stringify(m)} needs "a" and "b".`);
  }

  function checkLayout(f) {
    checkTree(f.tree, "The layout's \"tree\"");
    if (!(Number.isInteger(f.gridSize) && f.gridSize >= 1)) fail(`"gridSize" must be a positive whole number.`);
    if (!Array.isArray(f.leaves) || f.leaves.length < 2) fail(`"leaves" must list every leaf's grid point.`);
    for (const p of f.leaves) {
      if (!isName(p?.leaf) || !Number.isInteger(p.x) || !Number.isInteger(p.y)) fail(`Leaf point ${JSON.stringify(p)} needs "leaf" and whole-number "x" and "y".`);
      if (p.x < 0 || p.y < 0 || p.x > f.gridSize || p.y > f.gridSize) fail(`Leaf ${p.leaf} at (${p.x}, ${p.y}) is outside the ${f.gridSize} × ${f.gridSize} grid.`);
    }
    if (f.scale != null && !(typeof f.scale === "number" && f.scale > 0)) fail(`"scale" must be a positive number.`);
    if (f.edgeLengths != null) {
      if (!Array.isArray(f.edgeLengths) || f.edgeLengths.length !== f.tree.edges.length) fail(`"edgeLengths" must have one length per tree edge (${f.tree.edges.length}).`);
      if (f.edgeLengths.some((l) => !(typeof l === "number" && l > 0))) fail(`Every entry of "edgeLengths" must be a positive number.`);
    }
  }

  async function open(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      fail(`${file.name} is not valid JSON.`);
    }
    if (data?.format === "treemaker-tree") {
      if (data.version !== 1) fail(`${file.name} is tree format version ${data.version}; this app reads version 1.`);
      checkTree(data, file.name);
      host.applyTree({ ...data, gridSize: data.gridSize ?? undefined });
      host.status?.(`Opened the tree in ${file.name}: ${data.edges.length} edges.`);
      return;
    }
    if (data?.format === "treemaker-layout") {
      if (data.version !== 1) fail(`${file.name} is layout format version ${data.version}; this app reads version 1.`);
      checkLayout(data);
      host.applyTree({ ...data.tree, gridSize: data.gridSize });
      await host.importLayout({
        points: data.leaves.map((p) => ({ leaf: p.leaf, x: p.x, y: p.y })),
        scale: data.scale ?? null,
        edgeLengths: data.edgeLengths ?? null,
        name: file.name,
        solvedBy: data.solvedBy?.app ?? null,
      });
      return;
    }
    if (data?.format === "treemaker-session") {
      if (data.version !== 1 && data.version !== 2) fail(`${file.name} is session format version ${data.version}; this app reads versions 1 and 2.`);
      for (const [k, step] of (data.steps ?? []).entries()) checkTree((step.output ?? step.input)?.problem ?? {}, `${file.name}, step ${k + 1}`);
      workflowDoc.openFile(data, file.name);
      host.status?.(`Opened the session in ${file.name}: ${data.steps.length} steps.`);
      return;
    }
    fail(`${file.name} is not a tree, layout or session file: its "format" must be "treemaker-tree", "treemaker-layout" or "treemaker-session".`);
  }

  function refresh() {
    const b = q("saveLayout");
    if (b) b.disabled = !current();
  }

  function init(options) {
    host = options;
    const input = q("fileInput");
    for (const id of options.openButtons ?? ["openFile"]) q(id)?.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        await open(file);
      } catch (e) {
        host.status?.("Could not open the file: " + e.message, "error");
      }
      refresh();
    });
    q("saveTree").addEventListener("click", saveTree);
    q("saveLayout").addEventListener("click", () => saveLayout());
    // The crease panel's context changes after every solve, import or clear; keep the button in step.
    setInterval(refresh, 500);
    refresh();
  }

  return { init, refresh, current, saveLayout };
})();
