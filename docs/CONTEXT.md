# Project context and history

The original chat ran from 25 to 28 October 2026 (claude.ai, Claude Code on the web). It was carried over into this repository so that later sessions start with the same context.

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
| Model and Algorithm Spec Style Guide | https://claude.ai/artifact/BMYoCySQWXLSi53n3wiSMf | 53d9db7d-e04d-41b5-bb44-6d789d5ca27a | 4a574596-3a96 |
| Document graph (HTML artifact) | https://claude.ai/artifact/DDPvTiXvCsGFAnTCNDtzre | (not a doc) | |

To edit a doc, use the Claude Docs tools with container `{"kind":"project","id":"<slug>"}` and ref `{"object":"node","id":"<tab node>"}`. Its source must be read before it is republished.

## The three apps

| App | Folder | What it does |
|---|---|---|
| Pure MILP TreeMaker | `PureMilpTreeMaker/` | The base model as one MILP: one binary per pair and grid offset, solved with SCIP. It also has edge optimization (common stretch) and strain optimization. |
| Optimized MILP TreeMaker | `OptimizedMilpTreeMaker/` | The same optimum, found with lattice hulls (one binary per hull facet), symmetry breaking, bisection over candidate scales √s/ℓ, and incremental solving (pair and facet generation, leaf windows). |
| Scalable MILP TreeMaker | `ScalableMilpTreeMaker/` | No optimality proof; meant for 25 to 100 leaves. Four stages, listed below. |

The scalable app's stages:
1. Continuous layout by sequential LP (GLOP).
2. Rounding and repair with a CP-SAT window model, by bisection over the candidate scales.
3. Large neighbourhood search over collision and subtree windows.
4. A foldability finish: CP-SAT maximization of tight pairs, then a SCIP closing MILP with the leaves still free to move, polished by an LP.

Shared library code in `PureMilpTreeMaker/src/PureMilpTreeMaker` (all three apps use it):
- `ActivePaths`: the polygon validity test.
- `PolygonCompletion`: closing the polygons by strain, with the leaves fixed.
- `CreasePatternBuilder`: universal molecules, the folded map, the self-check and pleating.

## Key decisions and facts

- **Gap and time limit.** The apps default to a 1% relative gap and a 60 s time limit. The scalable app has no gap, and its 60 s covers all four stages.
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

- **Grid sizes.** A grid-size sweep (28 Oct) set each preset's grid size to the largest N that the apps offering it solve within 60 s. The table is in README.md.
- **Base app.** Only 4-leaf trees prove an optimum within 60 s, at any N. Every tree with 5 or more leaves runs out of time even at N = 4.
- **Optimized app.** Solves every preset with up to 6 leaves. With left–right mirror pairs it also solves the centipedes with 4, 5 and 6 leg pairs, at N = 12, 8 and 8.
- **Scalable app.**
  - All presets ran in 0.3–1.3 s.
  - Random trees with 25, 52 and 101 leaves ran in 1–3 s, reaching 92.6–102.1% of the continuous scale.
  - Its largest CP-SAT model had about 1,300 Booleans, against 21 million binaries for the base model at 101 leaves.
  - Valid polygons resulted only on small trees: one of five test trees closed, a 9-leaf tree at ±0.5 strain.

## Status and next steps

1. **Compile and test.** Run `dotnet build` and `dotnet test` (the C# has never been compiled), and fix the API mismatches.
2. **Re-time the apps.** Time the real apps on the presets, and re-enable any greyed-out preset the optimized app actually solves.
3. **Stubs.** Add stub insertion to the closing stage.
4. **Other follow-ups.** The items in section 12 of the scalable spec: a table-constraint form of the closing MILP, pair generation in Stage 1, handing the scalable layout to the optimized search for a certificate, and better starting layouts.
