# Project context and history

The original chat ran from 25 to 31 October 2026 (claude.ai, Claude Code on the web). It was carried over into this repository so that later sessions start with the same context.

## Goal

Turn TreeMaker's circle-packing scale optimization (Lang's origami design tool) into mixed-integer models on an N × N grid. Then build apps that:
- solve the scale optimization;
- show the layout;
- check and close the polygons;
- build Lang's universal-molecule crease pattern;
- show the folded base;
- optionally pleat the flaps.

The owner's next aim was to scale to about 100 leaves and to get foldable solutions faster.

## Specification documents (Claude Docs artifacts)

| Document | Link | Docs container slug | Tab node |
|---|---|---|---|
| Pure MILP TreeMaker (the base spec) | https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4 | 02a7ba14-b4be-4c9f-99d1-ebac9aacfdb9 | a3a74054-0357 |
| Symmetry-Breaking MILP TreeMaker | https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN | 1d237ba1-10e5-4fa8-82ad-e0bc2ead69e7 | fa0cae2e-1113 |
| Lattice-Hull MILP TreeMaker | https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6 | b1b5b583-372a-4a28-8742-3fe43fcd5d1b | 7ffee6c7-7758 |
| Optimized MILP TreeMaker (the optimized spec) | https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq | a1a48284-c0dd-489d-8389-d5c28f829a88 | c4592889-1f69 |
| Scalable MILP TreeMaker: model and algorithm specification | https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29 | c237e54d-08de-4743-bb5f-274160408d26 | d64e2319-db8f |
| Polygon Closing TreeMaker: model and algorithm specification | https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4 | 789428e8-6756-48fb-8f55-39bbafccb733 | c45537c5-97f5 |
| Crease Pattern TreeMaker: model and algorithm specification | https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp | 0166114f-0d5d-4cdf-b541-17a09cdabca3 | 6a9c70bb-7945 |
| Model and Algorithm Spec Style Guide | https://claude.ai/artifact/BMYoCySQWXLSi53n3wiSMf | 53d9db7d-e04d-41b5-bb44-6d789d5ca27a | 4a574596-3a96 |
| Document graph (HTML artifact) | https://claude.ai/artifact/DDPvTiXvCsGFAnTCNDtzre | (not a doc) | |

To edit a doc, use the Claude Docs tools with container `{"kind":"project","id":"<slug>"}` and ref `{"object":"node","id":"<tab node>"}`. Its source must be read before it is republished.

**Packaged copies.** Since 1 November 2026 the app carries a copy of every doc (`src/TreeMaker.Web/wwwroot/specs/`) and shows it on its own docs page, opened in a separate tab (README.md, "The specs, in the app"). The copies at that date: Pure rev 40 (rev 41 since: optional conditions split into Sections 7.1–7.5), Symmetry-Breaking rev 16, Lattice-Hull rev 27, Optimized rev 44, Scalable rev 48, Polygon Closing rev 14, Crease Pattern rev 12 (`manifest.json`). The figures (45: 20, 6, 10, 8, 1, 0, 0) are compiled from each figure node's JSX source to static SVG; the docs' Markdown export drops them. CLAUDE.md has the refresh steps.

## The app

Since 31 October 2026 there is one app, `TreeMaker.Web` (port 5080), in place of the three separate apps (ports 5080, 5081 and 5082). Its first screen is a map of the specs and the steps after them; each box opens the matching part of the app, and a workbench carries the tree, the layout, the closed polygons and the crease pattern from one part to the next. README.md, "The map" and "The workbench", has the details.

| Map node | Project | What it does |
|---|---|---|
| Pure MILP | `src/TreeMaker.Pure/` | The base model as one MILP: one binary per pair and grid offset, solved with SCIP. It also has edge optimization (common stretch) and strain optimization. |
| Symmetry-Breaking MILP | `src/TreeMaker.Pure/` (rows), `src/TreeMaker.Core/SymmetryBreaking.cs` | The base model with C:5 (anchor leaf in the fundamental domain) and C:6 (siblings in order), via `ProblemSpec.SymmetryBreaking`. `SymmetryBreaking.cs` is shared, so both families use it. |
| Lattice-Hull MILP | `src/TreeMaker.Optimized/` | Lattice hulls (one binary per hull facet) and bisection over candidate scales √s/ℓ, with incremental solving, and symmetry breaking locked off. |
| Optimized MILP | `src/TreeMaker.Optimized/` | The same, with symmetry breaking. |
| Scalable MILP | `src/TreeMaker.Scalable/` | No optimality proof; meant for 25 to 100 leaves. Four stages, listed below. |
| Close the polygons, Crease pattern, Folded base | `src/TreeMaker.Core/` | The steps after any solver, specified (31 October) in Polygon Closing TreeMaker and Crease Pattern TreeMaker. |

The scalable pipeline's stages:
1. Continuous layout by sequential LP (GLOP).
2. Rounding and repair with a CP-SAT window model, by bisection over the candidate scales.
3. Large neighbourhood search over collision and subtree windows.
4. A foldability finish: CP-SAT maximization of tight pairs, then a SCIP closing MILP with the leaves still free to move, polished by an LP.

Shared library code in `src/TreeMaker.Core` (every solver uses it; on 1 November it moved out of the base solver's project, and the repository took its `src/` and `tests/` layout):
- `ActivePaths`: the polygon validity test.
- `PolygonCompletion`: closing the polygons by strain, with the leaves fixed.
- `StrainNeeded`: the strain LPs behind **Find the strain needed**.
- `CreasePatternBuilder`: universal molecules, the folded map, the self-check and pleating.
- `SymmetryBreaking`: the anchor and sibling groups, used by the base model and the optimized search.

## Key decisions and facts

- **Gap and time limit.** The exact solvers default to a 1% relative gap and a 60 s time limit. Scalable MILP has no gap, and its 60 s covers all four stages.
- **Pleating.** It cuts each facet at elevation contours z = kH, which fold valley, mountain, valley, … in turn. A contour flips from mountain to valley where it crosses a ridge.
- **Hard problems.**
  - Box-pleating flat-foldability is NP-complete (Akitaya et al. 2016).
  - Polygon closing with the leaves held fixed rarely succeeds beyond about 10 leaves.
  - The proposed next step is TreeMaker-style stubs (open problem 1 in the scalable spec).
- **Bugs fixed earlier:**
  - A JSON serialization cycle in `Vec2`, fixed with `[JsonIgnore]` on its derived properties.
  - A stale browser cache, fixed with no-cache headers and versioned script URLs.
  - Drag-and-drop switched from pointer capture to window listeners.

## Measured results (Python prototypes; HiGHS stood in for SCIP, GLOP and CP-SAT)

- **Grid sizes.** A grid-size sweep (28 Oct) set each preset's grid size to the largest N that the solvers offering it solve within 60 s. The table is in README.md.
- **Base model.** Only 4-leaf trees prove an optimum within 60 s, at any N. Every tree with 5 or more leaves runs out of time even at N = 4.
- **Optimized search.** Solves every preset with up to 6 leaves. With left–right mirror pairs it also solves the centipedes with 4, 5 and 6 leg pairs, at N = 12, 8 and 8.
- **Scalable pipeline.**
  - All presets ran in 0.3–1.3 s.
  - Random trees with 25, 52 and 101 leaves ran in 1–3 s, reaching 92.6–102.1% of the continuous scale.
  - Its largest CP-SAT model had about 1,300 Booleans, against 21 million binaries for the base model at 101 leaves.
  - Valid polygons resulted only on small trees: one of five test trees closed, a 9-leaf tree at ±0.5 strain.

## Status and next steps

1. **Compile and test.** Run `dotnet build` and `dotnet test` (the C# has never been compiled), and fix the API mismatches. The unified web project (`TreeMaker.Web`) is new and also uncompiled; its front end was tested in Chrome against a Python mock of the API.
2. **Re-time the solvers.** Time the real solvers on the presets (including the new Symmetry-Breaking node), and re-enable any greyed-out preset that a solver actually solves.
3. **Stubs.** Add stub insertion to the closing stage.
4. **Other follow-ups.** The items in section 12 of the scalable spec: a table-constraint form of the closing MILP, pair generation in Stage 1, handing the scalable layout to the optimized search for a certificate, and better starting layouts.

## Testing the front end without .NET

`tools/mock_api.py` serves `src/TreeMaker.Web/wwwroot` and answers every API route with real geometry (exact distances, the hull, tight pairs) and fake solves. `tools/ui_flow.js` drives Chrome through the map, a solve, the three steps, a second solver starting from the workbench layout, and a reload. `tools/ui_reader.js` checks the docs tab: opening it from the map and from a part of the app, reusing one tab, every doc with its figures and typeset maths, links within and between docs and back to the app's tab, and the app keeping a solve's results. On 1 November both passed with no page errors; the C# behind the same routes has not been compiled yet.
