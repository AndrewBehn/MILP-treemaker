// The map's nodes: one per specification document (the layout solvers) and one per step after a solve.
// Every node names the spec it implements, the part of that spec, and the API group that runs it, so the map, the
// docs and the code correspond one to one. See README.md, "The map".
"use strict";

const DOCS = {
  pure: { title: "Pure MILP TreeMaker", url: "https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4" },
  sym: { title: "Symmetry-Breaking MILP TreeMaker", url: "https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN" },
  hull: { title: "Lattice-Hull MILP TreeMaker", url: "https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6" },
  optimized: { title: "Optimized MILP TreeMaker", url: "https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq" },
  scalable: { title: "Scalable MILP TreeMaker", url: "https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29" },
  closing: { title: "Polygon Closing TreeMaker", url: "https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4" },
  crease: { title: "Crease Pattern TreeMaker", url: "https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp" },
};

/** Presets each solver can solve in reasonable time (README, "Presets"). */
const PRESETS_BASE = ["example", "star4", "centipede2"];
const PRESETS_OPTIMIZED = ["example", "star4", "star5", "bird", "caterpillar", "centipede2", "centipede4", "centipede5", "centipede6"];

const NODES = {
  tree: {
    id: "tree", kind: "tree", title: "Tree", kicker: "Input", mapKicker: "Input",
    lede: "The tree to fold, the grid it is placed on, and any leaf conditions. Every solver reads it from here.",
    blurb: "Edit the tree, grid and leaf conditions",
    doc: "pure", section: "Parameters P:1–P:3 (Section 4); leaf conditions and mirror pairs (Sections 7.1–7.5)",
  },
  pure: {
    id: "pure", kind: "solver", api: "pure", settings: "pure", title: "Pure MILP", kicker: "Layout solver · exact", mapKicker: "Base spec · exact",
    lede: "The base model: every leaf pair picks one grid offset, all in one MILP solved by SCIP. Exact, but the model grows as N⁴, so only small trees and grids solve in time.",
    blurb: "One MILP for the whole layout (SCIP); also edge and strain optimization",
    doc: "pure", section: "Sections 3–8; edge and strain stages in Section 11",
    presets: PRESETS_BASE, stretch: true, appName: "TreeMaker · Pure MILP",
  },
  sym: {
    id: "sym", kind: "solver", api: "pure", settings: "pure", title: "Symmetry-Breaking MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "The base model with symmetry breaking: an anchor leaf in one eighth of the sheet and identical siblings in order, so SCIP searches one of each set of equivalent layouts. Same optimum m*.",
    blurb: "The base model plus anchor and sibling-order constraints",
    doc: "sym", section: "C:5 and C:6 (Section 7); gains in Section 10",
    presets: PRESETS_BASE, stretch: true, extra: { symmetryBreaking: true }, appName: "TreeMaker · Symmetry-Breaking MILP",
  },
  hull: {
    id: "hull", kind: "solver", api: "optimized", settings: "optimized", title: "Lattice-Hull MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "One binary per side of each pair's lattice hull instead of one per offset, tested scale by scale with bisection over the candidate scales. Same optimum m*, with far smaller models.",
    blurb: "Lattice-hull feasibility tests and bisection over candidate scales",
    doc: "hull", section: "Models in Section 8; procedure in Section 10",
    presets: PRESETS_OPTIMIZED, lockOptions: { symmetryBreaking: false }, appName: "TreeMaker · Lattice-Hull MILP",
  },
  optimized: {
    id: "optimized", kind: "solver", api: "optimized", settings: "optimized", title: "Optimized MILP", kicker: "Layout solver · exact", mapKicker: "Exact",
    lede: "Lattice hulls and bisection, with symmetry breaking, pair and facet generation, leaf windows and a border seed. The same optimum m* as the base model, from a series of much smaller MILPs.",
    blurb: "Lattice hulls + symmetry breaking + incremental generation",
    doc: "optimized", section: "The combined algorithm, Section 7",
    presets: PRESETS_OPTIMIZED, appName: "TreeMaker · Optimized MILP",
  },
  scalable: {
    id: "scalable", kind: "solver", api: "scalable", settings: "scalable", title: "Scalable MILP", kicker: "Layout solver · heuristic", mapKicker: "Heuristic",
    lede: "Good layouts for 25 to 100 leaves: a continuous layout by LPs, rounded and repaired on the grid with CP-SAT, improved by neighbourhood search, then a foldability finish. No proof of optimality.",
    blurb: "Continuous LP → CP-SAT repair → neighbourhood search → closing",
    doc: "scalable", section: "The pipeline, Section 9",
    presets: null, random: true, appName: "TreeMaker · Scalable MILP",
  },
  close: {
    id: "close", kind: "step", step: "close", title: "Close the polygons", kicker: "Step after a layout", mapKicker: "Step 1",
    lede: "The session, step by step: every move after a solve (solve again, close the polygons by strain, add stubs, build the crease pattern) with its input and output. Closing changes edge lengths (strain) until the tight paths divide the leaves' hull into valid polygons, with the leaves held where they are.",
    blurb: "Check the polygons; find the strain that closes them",
    doc: "closing", section: "Polygon test A:1, closing A:2, strain bounds A:3, strain needed A:4 (Sections 4–7)",
    needs: "layout",
  },
  stubs: {
    id: "stubs", kind: "step", step: "stubs", title: "Add stubs", kicker: "Step after a layout · optional", mapKicker: "Step 1 · option",
    lede: "The session, opened at its Add a stub move: split an open polygon with a new short leaf edge hung from a joint of the tree, its leaf on a grid point inside the polygon. Then solve just the stubs, or close the polygons, to tighten what is left.",
    blurb: "Hang a short new flap inside an open polygon",
    doc: "closing", section: "Open problem 1, stubs (Section 10)",
    needs: "layout",
  },
  creases: {
    id: "creases", kind: "step", step: "creases", title: "Crease pattern", kicker: "Step after closing", mapKicker: "Step 2",
    lede: "Fill every valid polygon with Lang's universal molecule: ridges, hinges and gussets. Optionally pleat the flaps. Download it as .fold or .svg.",
    blurb: "Universal molecules, pleats, .fold and .svg",
    doc: "crease", section: "Universal molecule A:1 (Sections 4–5), pleating A:3 (Section 7), output (Section 8)",
    needs: "polygons",
  },
  fold: {
    id: "fold", kind: "step", step: "fold", title: "Folded base", kicker: "Step after the crease pattern", mapKicker: "Step 3",
    lede: "The crease pattern folded into its base: every facet stands over its tree edge at its height. Drag to turn it.",
    blurb: "The base in 3D, from the crease pattern",
    doc: "crease", section: "The folded base and its check, A:2 (Section 6)",
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
const SPEC_EDGES = [
  { from: "sym", to: "pure", kind: "build" },
  { from: "hull", to: "pure", kind: "build" },
  { from: "optimized", to: "pure", kind: "build" },
  { from: "scalable", to: "pure", kind: "build" },
  { from: "pure", to: "optimized", kind: "hand" },
  { from: "hull", to: "sym", kind: "cite" },
  { from: "scalable", to: "optimized", kind: "cite" },
];

function nodeDoc(node) {
  return node.doc ? DOCS[node.doc] : null;
}
