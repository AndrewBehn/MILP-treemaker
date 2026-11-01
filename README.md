# TreeMaker

One app for TreeMaker's circle-packing problem on an N × N grid, with every specification and the steps after it in one place. It is a C# / .NET 10 ASP.NET Core app with a browser UI that runs in the same process as the solvers (SCIP, GLOP and CP-SAT through Google OR-Tools).

## Run

You need the .NET 10 SDK. From this folder (the repository root):

```sh
dotnet run
```

It builds everything and opens <http://localhost:5080> in your browser: the map, the solvers, the workbench and the specs, all in one app. To use another port, add `--urls http://localhost:6000` after `--`, as in `dotnet run -- --urls http://localhost:6000`.

To build or run every test, also from the root:

```sh
dotnet build
dotnet test
```

The root project, `TreeMaker.csproj`, is only the entry point: it compiles nothing itself, builds the app (`TreeMaker.Web`), the three solver libraries and their three test projects, runs the app, and hands `dotnet test` to the test projects. Open it in an IDE to get all of them.

## The map

The first screen is a map of the specs and the steps after them, drawn like the document graph. Click a box to open that part of the app; **← Map** in the top bar brings you back, and the browser's back button works too. Each box's **Spec ↗** tag opens its document in the docs tab (see *The specs, in the app* below).

| Map node | Route | Spec, and where in it | What runs | API |
|---|---|---|---|---|
| Tree | `#/tree` | Pure MILP, parameters P:1–P:3 | The tree editor, grid size, leaf conditions and mirror pairs | none |
| Pure MILP | `#/pure` | Pure MILP, Sections 3–8 and 11 | The base model as one MILP (SCIP); scale, edge and strain stages | `/api/pure/*` |
| Symmetry-Breaking MILP | `#/sym` | Symmetry-Breaking MILP, C:5 and C:6 | The base model with the anchor leaf in the fundamental domain and siblings in order | `/api/pure/*` with `symmetryBreaking: true` |
| Lattice-Hull MILP | `#/hull` | Lattice-Hull MILP, Sections 8 and 10 | Lattice-hull feasibility tests and bisection over candidate scales, without symmetry breaking | `/api/optimized/*` with `options.symmetryBreaking: false` |
| Optimized MILP | `#/optimized` | Optimized MILP, Section 7 | Lattice hulls, symmetry breaking, pair and facet generation, leaf windows, border seed | `/api/optimized/*` |
| Scalable MILP | `#/scalable` | Scalable MILP, Section 9 | Continuous LP, CP-SAT repair, neighbourhood search, foldability finish | `/api/scalable/*` |
| Close the polygons | `#/close` | Polygon Closing, A:1 to A:4 (Sections 4–7) | Check the polygons; close them by strain; find the strain needed | `/api/polygons`, `/api/complete`, `/api/strain-needed` |
| Crease pattern | `#/creases` | Crease Pattern, A:1 and A:3 (Sections 4, 5, 7 and 8) | Universal molecules, pleats, .fold and .svg | `/api/creases` |
| Folded base | `#/fold` | Crease Pattern, A:2 (Section 6) | The base in 3D | (from the crease pattern) |

Every box links its spec. The step specs are Polygon Closing TreeMaker (which builds on Pure MILP, cites Scalable MILP and hands off to Crease Pattern) and Crease Pattern TreeMaker (which builds on Polygon Closing and Pure MILP); their references follow the pipeline arrows. The solver boxes sit in one frame with the references between their specs drawn as in the document graph: the four derived specs build on Pure MILP, Pure MILP hands off to Optimized MILP, Lattice-Hull MILP cites Symmetry-Breaking MILP, and Scalable MILP cites Optimized MILP. Each solver box also says whether it suits the tree in the editor, from the timings below.

The node definitions are in `TreeMaker.Web/wwwroot/nodes.js`. What a solver family sends and shows is in `solvers.js`; the map is `map.js`.

## The specs, in the app

All seven specification documents are packaged with the app and served by it, so the mathematics and the running solvers can be shared together, and read offline.

- **A tab of their own.** The docs open in a separate browser tab (`docs.html`), so reading stays apart from the working app and its workbench. Every link from the app goes to that one tab, and every link from a doc back to the app goes to the app's tab, so the two tabs don't multiply.
- **Opening them.** On the map, a box opens its part of the app and its **Spec ↗** tag opens its document; **Read the specs ↗** lists them all. In a part of the app, the **Spec ↗** link in the top bar, the spec line under its title, and any section or label in the sidebar (such as `§6` or `C:4`) open the right document at the right place. **Specs ↗** in the top bar lists them.
- **In the docs tab.** The side bar lists the specs and the sections of the one shown. Section numbers and labels (P:, D:, C:, M:, A:, lemmas) are links, also between docs ("base C:1" opens the Pure MILP spec at C:1). Each doc names the parts of the app that implement it, and a tag at each section a part cites opens that part in the app's tab. **Open the app ↗** goes back to the map.
- **Figures and maths.** The figures are drawn from the docs' own figure code (static pictures), and the maths is typeset with KaTeX, which is bundled (`wwwroot/vendor/katex`).
- **Links.** The docs tab's address holds the passage, such as `docs.html#/scalable:A-4`, so a link to it can be shared. The live docs on claude.ai are only where the specs are written; reading them here needs no network and no claude.ai account.
- **Keeping them current.** The packaged copies are `wwwroot/specs/*.md` (text) and `*.figures.json` (figures), with `manifest.json` recording each doc's revision. They are refreshed from the live docs with `tools/extract_spec_exports.py` (CLAUDE.md, "Specification documents", has the steps). The docs tab shows the revision and export date of the copy it shows.

The docs page is `TreeMaker.Web/wwwroot/docs.html`, driven by `specs.js`.

## The workbench

The workbench holds what carries over from one part of the app to the next. The top bar shows it as four chips, and the map shows it as cards with **Continue**, **Save** and **Clear** buttons.

| Slot | Set by | Used as the starting point of |
|---|---|---|
| Tree | Every edit in the tree editor, a preset, or a tree file | Every solver |
| Layout | Every solve that finds a layout, and opening a layout file | The next solve in any solver whose tree and grid it fits (the **Start the next solve from the workbench layout** box under the sheet); Close the polygons |
| Closed polygons | **Close the polygons** and **Find the strain needed** | Crease pattern, which uses the closed edge lengths |
| Crease pattern | **Build the crease pattern** | Folded base |

- **Replacing.** A new result replaces its slot and clears the slots after it, since they were made from the old one. A new layout clears the closed polygons and the crease pattern.
- **Every solver.** Opening a solver with a layout on the workbench shows that layout as if the solver had just found it, together with its closed polygons and crease pattern, as long as it fits the editor's tree and grid.
- **Leaving during a solve.** A solve keeps running if you go back to the map. Its layout goes on the workbench when it finishes. One solve runs at a time, in any solver.
- **Kept between visits.** The workbench is stored in the browser (`localStorage`). It survives a reload, and **Clear** on a card empties that slot.

The workbench is `TreeMaker.Web/wwwroot/workbench.js`.

## Where the code is

| Folder | Contents |
|---|---|
| `TreeMaker.Web/` | The app: `Program.cs` maps the API groups; `Pure/`, `Optimized/` and `Scalable/` hold each solver family's request shapes and endpoints; `Shared/` holds the steps after a solve and the one-solve-at-a-time coordinator; `wwwroot/` is the page, with the packaged specs in `wwwroot/specs/`. |
| `PureMilpTreeMaker/` | The base library: the tree, definitions, base model (with optional symmetry breaking), layout checks, polygons, closing, strain LPs, crease pattern. Its tests. |
| `OptimizedMilpTreeMaker/` | Lattice hulls, candidate scales, bisection and incremental generation. Its tests. |
| `ScalableMilpTreeMaker/` | The four-stage pipeline. Its tests. |
| `tools/` | Packaging the specs (`extract_spec_exports.py`, `render_spec_figures.js`) and front-end checks without .NET (`mock_api.py`, `ui_flow.js`, `ui_reader.js`). |

## The tree editor

Every solver and the Tree node use the same editor, `tree-editor.js`.

- **Add a leaf.** Drag the **Leaf** chip onto a vertex, or onto an edge to branch from its midpoint.
- **Split an edge.** Drag the **Joint** chip onto the edge.
- **Move or re-attach a vertex.** Drag the vertex to move it. Drop it on another vertex to re-attach it, together with everything beyond it.
- **Delete.** Drag a vertex to **Drop to delete**.
- **Change a length.** Click the length tag on an edge, or Tab to it and press Enter. Type the new length, then press Enter to save or Esc to cancel.
- **Rename a vertex.** Double-click it.
- **Pure MILP and Symmetry-Breaking MILP only:** click an edge to add it to, or remove it from, the stretch set S, which edge optimization uses.
- **Layout.** **Tidy** lays the tree out again. **Enlarge** opens the editor nearly full screen.
- **Mirrored trees.** A tree with mirror pairs, such as the centipede presets, is drawn bilaterally: the body is a straight vertical line and each leg sits on its own side, opposite its partner. The longest flaps at the head and tail (antennae, cerci) point forward and back. The drawing is a sketch, not to scale: short body segments are spaced out so the legs don't overlap. The mirror pairs themselves make every solver place each pair symmetrically about the sheet's vertical axis, x_a + x_b = N. The folded base draws its stick figure the same way, to scale: the body straight and each leg opposite its partner.

The server tells the browser not to cache the page, and the scripts are versioned, so an updated app always loads its new scripts.

## Toward a crease pattern (the steps after a solve)

After a solve, the **Toward a crease pattern** panel under the sheet checks whether the layout can carry a crease pattern. The same panel (`polygons.js`) is the Close the polygons and Crease pattern nodes of the map, each showing its own part of it, and it runs the library code in `PureMilpTreeMaker/src/PureMilpTreeMaker`.

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The polygons are drawn on the sheet: valid ones are shaded, invalid ones hatched, and the missing boundary is dotted.
2. **Close the polygons** (`PolygonCompletion`, `POST /api/complete`). The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain. **Use these lengths in the tree** copies the new lengths into the editor.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the strain needed** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## Presets

**Load a preset** lists the same trees in every solver.

- **Grid size.** Each preset sets its own grid size N: the largest tested N at which every solver that offers the preset solves it within the 60 s limit.
- **Mirror pairs.** The centipede presets also load left–right mirror pairs: legs Lk ↔ Rk, and for the full centipede the antennae and the tail flaps.
- **Greyed out.** A preset a solver cannot solve in reasonable time at any useful grid size is greyed out there, marked *too slow here; use the Scalable MILP*. The Tree node offers every preset.

Times are to the 1% gap, at the preset's N. "off" means greyed out in that solver. The base model column covers Pure MILP and Symmetry-Breaking MILP; the optimized column covers Optimized MILP and Lattice-Hull MILP, which offer the same presets.

| Preset | Leaves | Grid N | Base model | Optimized | Scalable |
|---|---|---|---|---|---|
| Running example | 4 | 8 | 28 s | 0.1 s | under 1 s |
| Star, 4 legs | 4 | 6 | 6 s | 0.1 s | under 1 s |
| Star, 5 legs | 5 | 16 | off | 8 s | under 1 s |
| Bird-base–like (centipede, 3 leg pairs) | 6 | 8 | off | 46 s | under 1 s |
| Caterpillar | 6 | 10 | off | 25 s | under 1 s |
| Centipede, 2 leg pairs (mirrored) | 4 | 12 | 6 s | 0.3 s | under 1 s |
| Centipede, 4 leg pairs (mirrored) | 8 | 12 | off | 35 s | under 1 s |
| Centipede, 5 leg pairs (mirrored) | 10 | 8 | off | 23 s | under 1 s |
| Centipede, 6 leg pairs (mirrored) | 12 | 8 | off | 13 s | under 1 s |
| Centipede, 8 leg pairs (mirrored) | 16 | 13 | off | off | under 1 s |
| Beetle | 9 | 12 | off | off | under 1 s |
| Deer with antlers | 12 | 12 | off | off | under 1 s |
| Dragon with wings | 14 | 14 | off | off | about 1 s |
| Scorpion | 13 | 14 | off | off | under 1 s |
| Centipede with antennae and tail (mirrored) | 18 | 16 | off | off | about 1 s |
| Random, 25 / 50 / 100 leaves | 25 to 100 | about 3.2·√leaves | not listed | not listed | 1 to 3 s |

The base and optimized times come from Python prototypes of their algorithms, with HiGHS standing in for SCIP. The prototypes swept N = 4, 6, 8, … for the optimized search, and N = 4, 5, 6, … for the base model. They are not timings of the C# solvers.

- **Base model.** The model proves an optimum within 60 s only for 4-leaf trees. Every tree with 5 or more leaves ran out of time even at N = 4.
- **Mirror pairs.** They roughly halve the free leaves. That is what lets the optimized search solve the 4-, 5- and 6-pair centipedes.
- **Too coarse to be useful.** The optimized search solves the 8-pair centipede, the beetle and the deer only at N = 4, so they are off there.
- **Not yet timed.** Symmetry breaking in the base model and the Lattice-Hull node (the optimized search without symmetry breaking) have no separate timings; they use the presets of their families.
- **Scalable MILP.** The scalable times are from the scalable prototype, which ignores mirror pairs. The C# pipeline applies them.

## Tree and layout files

- **Open…** and **Save tree** are in the Tree panel. **Save layout** is under the sheet, and on the map's Layout card. **Open a file…** is also on the map and in the steps' sidebar.
- A tree file holds the tree, grid size, leaf conditions and mirror pairs.
- A layout file holds a solved layout with its tree, scale and edge lengths. Opening it puts it on the workbench as the layout, so the steps after a solve can start from it at once, and the next solve in any solver whose tree it fits starts from it.
- The formats are in `docs/FILE-FORMATS.md`, and their JSON Schemas are in `schemas/`.

## Starting a new solve

**Solve** clears everything left on the page from the previous solve as soon as you press it: the sheet, the polygons and creases, the folded base, the tables and the traces. Any answer still arriving for the old layout is dropped. Moving to another node of the map clears the page the same way; the workbench keeps the results.

## Defaults

The exact solvers default to a **1% relative gap** and a **60 s time limit**. Scalable MILP has no gap, because it proves no optimum; it has a 60 s limit for all four stages. See each library's README for what the gap means there, and how to get the exact optimum.
