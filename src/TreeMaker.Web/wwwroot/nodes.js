// The map's nodes: one per specification document (the layout solvers) and one per step after a solve.
// Every node names the spec it implements, the part of that spec, and the API group that runs it, so the map, the
// docs and the code correspond one to one. See README.md, "The map".
"use strict";

/**
 * The specification documents, as a directed tree (docs/DOC-TREE.md): each has at most one parent, the document it
 * builds on. The foundations hold what several documents share; any document may cite them, but they are never
 * parents. The docs page draws this tree; the map draws the workflow instead.
 */
const DOCS = {
  sheet: { title: "TreeMaker foundations: the tree, the sheet and spacing", short: "sheet", group: "foundations", url: "https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C" },
  offsets: { title: "TreeMaker foundations: grid offsets", short: "offsets", group: "foundations", url: "https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem" },
  conditions: { title: "TreeMaker foundations: leaf conditions and symmetry", short: "conditions", group: "foundations", url: "https://claude.ai/artifact/3WP1SahWDm9pb5hs8Mhwp7" },
  hulls: { title: "TreeMaker foundations: lattice hulls and leaf windows", short: "hulls", group: "foundations", url: "https://claude.ai/artifact/FxaVEDwfoA6pXYs4aMUwLk" },
  strain: { title: "TreeMaker foundations: strain", short: "strain", group: "foundations", url: "https://claude.ai/artifact/Xr8Sus42zxf1wu68c1BMWt" },
  polygons: { title: "TreeMaker foundations: tight pairs and polygons", short: "polygons", group: "foundations", url: "https://claude.ai/artifact/TdJgMS7ZgBLRCvMBdGYGMY" },
  pure: { title: "Pure MILP TreeMaker", short: "base", group: "solvers", url: "https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4" },
  sym: { title: "Symmetry-Breaking MILP TreeMaker", short: "symmetry-breaking", group: "solvers", parent: "pure", url: "https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN" },
  hull: { title: "Lattice-Hull MILP TreeMaker", short: "lattice-hull", group: "solvers", url: "https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6" },
  optimized: { title: "Optimized MILP TreeMaker", short: "optimized", group: "solvers", parent: "hull", url: "https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq" },
  scalable: { title: "Scalable MILP TreeMaker", short: "scalable", group: "solvers", url: "https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29" },
  closing: { title: "Polygon Closing TreeMaker", short: "closing", group: "after", url: "https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4" },
  crease: { title: "Crease Pattern TreeMaker", short: "crease", group: "after", parent: "closing", url: "https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp" },
};

/** The tree's top level, in the order the docs page shows it. */
const DOC_GROUPS = [
  { id: "foundations", title: "Foundations", note: "What the specifications share: cited by any of them, never built on." },
  { id: "solvers", title: "Layout solvers", note: "Each places the leaves on the grid; a child builds on its parent." },
  { id: "after", title: "After the layout", note: "Closing the polygons, then the crease pattern and the folded base." },
];

/** A doc's children in the tree. */
const docChildren = (key) => Object.keys(DOCS).filter((k) => DOCS[k].parent === key);

/** Presets each solver can solve in reasonable time (README, "Presets"). */
const PRESETS_BASE = ["example", "star4", "centipede2"];
const PRESETS_OPTIMIZED = ["example", "star4", "star5", "bird", "caterpillar", "centipede2", "centipede4", "centipede5", "centipede6"];

const NODES = {
  tree: {
    id: "tree", kind: "tree", title: "Tree", kicker: "Input", mapKicker: "Input",
    lede: "The tree to fold, the grid it is placed on, and any leaf conditions. Every solver reads it from here.",
    blurb: "Edit the tree, grid and leaf conditions",
    doc: "pure", section: "The inputs of the base model (Section 1)",
    cites: [{ doc: "sheet", section: "P:1–P:3" }, { doc: "conditions", section: "P:1, C:1–C:5" }],
  },
  pure: {
    id: "pure", kind: "solver", api: "pure", settings: "pure", title: "Pure MILP", kicker: "Layout solver · exact", mapKicker: "Base spec · exact",
    lede: "The base model: every leaf pair picks one grid offset, all in one MILP solved by SCIP. Exact, but the model grows as N⁴, so only small trees and grids solve in time.",
    blurb: "One MILP for the whole layout (SCIP); also edge and strain optimization",
    doc: "pure", section: "Sections 3–5; edge and strain stages in Section 8",
    cites: [{ doc: "sheet", section: "P:1–P:3, D:1–D:3" }, { doc: "offsets", section: "D:1, D:2" },
      { doc: "conditions", section: "P:1, C:1–C:5" }, { doc: "strain", section: "P:1, D:1" }],
    presets: PRESETS_BASE, stretch: true, appName: "TreeMaker · Pure MILP",
  },
  sym: {
    id: "sym", kind: "solver", api: "pure", settings: "pure", title: "Symmetry-Breaking MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "The base model with symmetry breaking: an anchor leaf in one eighth of the sheet and identical siblings in order, so SCIP searches one of each set of equivalent layouts. Same optimum m*.",
    blurb: "The base model plus anchor and sibling-order constraints",
    doc: "sym", section: "Constraints in Section 3; gains in Section 6",
    cites: [{ doc: "sheet", section: "P:1–P:3, D:1–D:3" }, { doc: "offsets", section: "D:1, D:2" },
      { doc: "conditions", section: "P:1, C:1–C:5; P:2, D:1, C:6, C:7, Lemma 1" }],
    presets: PRESETS_BASE, stretch: true, extra: { symmetryBreaking: true }, appName: "TreeMaker · Symmetry-Breaking MILP",
  },
  hull: {
    id: "hull", kind: "solver", api: "optimized", settings: "optimized", title: "Lattice-Hull MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "One binary per side of each pair's lattice hull instead of one per offset, tested scale by scale with bisection over the candidate scales. Same optimum m*, with far smaller models.",
    blurb: "Lattice-hull feasibility tests and bisection over candidate scales",
    doc: "hull", section: "Models in Section 6; procedure in Section 8",
    cites: [{ doc: "sheet", section: "P:1–P:3, D:1–D:3" }, { doc: "offsets", section: "D:1, D:3" },
      { doc: "hulls", section: "D:1–D:4, P:1–P:3" }],
    presets: PRESETS_OPTIMIZED, lockOptions: { symmetryBreaking: false }, appName: "TreeMaker · Lattice-Hull MILP",
  },
  optimized: {
    id: "optimized", kind: "solver", api: "optimized", settings: "optimized", title: "Optimized MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "Lattice hulls and bisection, with symmetry breaking, pair and facet generation, leaf windows and a border seed. The same optimum m* as the base model, from a series of much smaller MILPs.",
    blurb: "Lattice hulls + symmetry breaking + incremental generation",
    doc: "optimized", section: "The combined algorithm, Section 4",
    cites: [{ doc: "sheet", section: "P:1–P:3" }, { doc: "offsets", section: "D:1, D:3" },
      { doc: "hulls", section: "D:1–D:4, P:1–P:3" }, { doc: "conditions", section: "P:2, D:1, C:6, C:7, Lemma 1" }],
    presets: PRESETS_OPTIMIZED, appName: "TreeMaker · Optimized MILP",
  },
  scalable: {
    id: "scalable", kind: "solver", api: "scalable", settings: "scalable", title: "Scalable MILP", kicker: "Layout solver · heuristic", mapKicker: "Heuristic",
    lede: "Good layouts for 25 to 100 leaves: a continuous layout by LPs, rounded and repaired on the grid with CP-SAT, improved by neighbourhood search, then a foldability finish. No proof of optimality.",
    blurb: "Continuous LP → CP-SAT repair → neighbourhood search → closing",
    doc: "scalable", section: "The pipeline, Section 9",
    cites: [{ doc: "sheet", section: "P:1–P:3, D:1–D:3" }, { doc: "offsets", section: "D:1, D:3" },
      { doc: "conditions", section: "P:1, C:1–C:5" }, { doc: "hulls", section: "D:1, P:3" },
      { doc: "polygons", section: "D:1–D:4, A:1" }, { doc: "strain", section: "P:1, D:1–D:3" }],
    presets: null, random: true, appName: "TreeMaker · Scalable MILP",
  },
  close: {
    id: "close", kind: "step", step: "close", title: "Strain the edges", kicker: "Step after a layout", mapKicker: "Step 1",
    lede: "Stretch or shrink edge lengths (strain σ), with the leaves held where they are and the scale fixed, until the tight paths divide the leaves' hull into valid polygons: one way to close the polygons, beside adding stubs and solving again.",
    blurb: "Change edge lengths until the polygons close",
    doc: "closing", section: "Polygon test (Section 4), closing A:1, strain bounds A:2, strain needed A:3 (Sections 5–7)",
    cites: [{ doc: "strain", section: "P:1, P:2, D:1–D:3" }, { doc: "polygons", section: "D:1–D:4, A:1, Lemma 1" }],
    needs: "layout",
  },
  stubs: {
    id: "stubs", kind: "step", step: "stubs", title: "Add stubs", kicker: "Step after a layout · optional", mapKicker: "Step 1 · option",
    lede: "Split open polygons with stubs, as many as you like in one step: each a new short leaf edge hung from a joint of the tree, its leaf on a grid point inside a polygon. Then solve just the stubs, or strain the edges, to tighten what is left.",
    blurb: "Hang a short new flap inside an open polygon",
    doc: "closing", section: "Open problem 1, stubs (Section 10)",
    cites: [{ doc: "polygons", section: "D:1, D:3, A:1" }],
    needs: "layout",
  },
  creases: {
    id: "creases", kind: "step", step: "creases", title: "Crease pattern", kicker: "Step after closing", mapKicker: "Step 2",
    lede: "Fill every valid polygon with Lang's universal molecule: ridges, hinges and gussets. Optionally pleat the flaps. Download it as .fold or .svg.",
    blurb: "Universal molecules, pleats, .fold and .svg",
    doc: "crease", section: "Universal molecule A:1 (Sections 4–5), pleating A:3 (Section 7), output (Section 8)",
    cites: [{ doc: "polygons", section: "D:3" }],
    needs: "polygons",
  },
  fold: {
    id: "fold", kind: "step", step: "fold", title: "Folded base", kicker: "Step after the crease pattern", mapKicker: "Step 3",
    lede: "The crease pattern folded into its base: every facet stands over its tree edge at its height. Drag to turn it.",
    blurb: "The base in 3D, from the crease pattern",
    doc: "crease", section: "The folded base and its check, A:2 (Section 6)",
    cites: [{ doc: "polygons", section: "D:3" }],
    needs: "creases",
  },
};

/** The order of the pipeline after a layout. */
const STEP_ORDER = ["close", "stubs", "creases", "fold"];
const SOLVER_IDS = ["pure", "sym", "hull", "optimized", "scalable"];

/**
 * References between the solver specs (from the document graph): from → to. The map draws these inside the solver
 * frame. The step specs' references (closing builds on base and cites scalable; crease builds on closing and base;
 * closing hands off to crease) run along the pipeline arrows, so they are not drawn again.
 */
function nodeDoc(node) {
  return node.doc ? DOCS[node.doc] : null;
}

/** Every doc a node's step depends on: its own spec first, then the foundations it cites ({ doc, section }). */
function nodeDocs(node) {
  if (!node?.doc) return [];
  return [{ doc: node.doc, section: node.section }, ...(node.cites ?? [])].filter((d) => DOCS[d.doc]);
}
