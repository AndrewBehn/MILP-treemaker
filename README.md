# TreeMaker MILP apps

Three apps for TreeMaker's circle-packing problem on an N × N grid. Each is a C# / .NET 10 library with a browser UI that runs in the same process as the SCIP solver (through Google OR-Tools).

| Folder | App | Port |
|---|---|---|
| `PureMilpTreeMaker/` | **Pure MILP TreeMaker**: the base model as one MILP. It covers the scale, edge and strain stages. | http://localhost:5080 |
| `OptimizedMilpTreeMaker/` | **Optimized MILP TreeMaker**: the same scale optimum, found with lattice hulls, symmetry breaking, bisection, and incremental solving. | http://localhost:5081 |
| `ScalableMilpTreeMaker/` | **Scalable MILP TreeMaker**: good layouts, without a proof of optimality, for 25 to 100 leaves. It runs a continuous layout (LP), then rounding and repair, neighbourhood search (CP-SAT), and a foldability finish. | http://localhost:5082 |

The optimized and scalable apps reuse the base library in `PureMilpTreeMaker/src/PureMilpTreeMaker`, so keep the folders side by side.

## Run

You need the .NET 10 SDK. Run these from this folder:

```sh
dotnet run --project PureMilpTreeMaker/src/PureMilpTreeMaker.Web
dotnet run --project OptimizedMilpTreeMaker/src/OptimizedMilpTreeMaker.Web
dotnet run --project ScalableMilpTreeMaker/src/ScalableMilpTreeMaker.Web
```

To use another port, add `--urls http://localhost:6000`. Each app opens its page in your browser when it starts.

To run every test:

```sh
dotnet test TreeMaker.sln
```

`TreeMaker.sln` holds all nine projects. Each app also has its own solution in its folder.

## The tree editor (all three apps)

All three apps use the same editor file, `tree-editor.js`.

- **Add a leaf.** Drag the **Leaf** chip onto a vertex, or onto an edge to branch from its midpoint.
- **Split an edge.** Drag the **Joint** chip onto the edge.
- **Move or re-attach a vertex.** Drag the vertex to move it. Drop it on another vertex to re-attach it, together with everything beyond it.
- **Delete.** Drag a vertex to **Drop to delete**.
- **Change a length.** Click the length tag on an edge, or Tab to it and press Enter. Type the new length, then press Enter to save or Esc to cancel.
- **Rename a vertex.** Double-click it.
- **Base app only:** click an edge to add it to, or remove it from, the stretch set S.
- **Layout.** **Tidy** lays the tree out again. **Enlarge** opens the editor nearly full screen.

The servers tell the browser not to cache the pages, and the scripts are versioned, so an updated app always loads its new scripts.

## Toward a crease pattern (steps 1 to 3, and the folded base)

After a solve, the **Toward a crease pattern** panel checks whether the layout can carry a crease pattern. All three apps share this panel (`polygons.js`) and the library code in `PureMilpTreeMaker/src/PureMilpTreeMaker`.

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The polygons are drawn on the sheet: valid ones are shaded, invalid ones hatched, and the missing boundary is dotted.
2. **Close the polygons** (`PolygonCompletion`, `POST /api/complete`). The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain. **Use these lengths in the tree** copies the new lengths into the editor.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the strain needed** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## Presets (all three apps)

**Load a preset** lists the same trees in every app.

- **Grid size.** Each preset sets its own grid size N: the largest tested N at which every app that offers the preset solves it within the 60 s limit.
- **Mirror pairs.** The centipede presets also load left–right mirror pairs: legs Lk ↔ Rk, and for the full centipede the antennae and the tail flaps.
- **Greyed out.** A preset an app cannot solve in reasonable time at any useful grid size is greyed out there, marked *scalable app only*.

Times are to the 1% gap, at the preset's N. "off" means greyed out in that app.

| Preset | Leaves | Grid N | Base app | Optimized app | Scalable app |
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

The base and optimized times come from Python prototypes of their algorithms, with HiGHS standing in for SCIP. The prototypes swept N = 4, 6, 8, … for the optimized search, and N = 4, 5, 6, … for the base model. They are not timings of the C# apps.

- **Base app.** The model proves an optimum within 60 s only for 4-leaf trees. Every tree with 5 or more leaves ran out of time even at N = 4.
- **Mirror pairs.** They roughly halve the free leaves. That is what lets the optimized app solve the 4-, 5- and 6-pair centipedes.
- **Too coarse to be useful.** The optimized app solves the 8-pair centipede, the beetle and the deer only at N = 4, so they are off there.
- **Scalable app.** The scalable times are from the scalable prototype, which ignores mirror pairs. The C# scalable app applies them.

## Tree and layout files (all three apps)

- **Open…** and **Save tree** are in the Tree panel. **Save layout** is under the sheet.
- A tree file holds the tree, grid size, leaf conditions and mirror pairs.
- A layout file holds a solved layout with its tree, scale and edge lengths. Opening it shows the layout as if just solved, so the crease-pattern steps are available at once. The next solve then starts from it.
- The formats are in `docs/FILE-FORMATS.md`, and their JSON Schemas are in `schemas/`.

## Starting a new solve

**Solve** clears everything left from the previous solve as soon as you press it: the sheet, the polygons and creases, the folded base, the tables and the traces. Any answer still arriving for the old layout is dropped.

## Defaults

The base and optimized apps default to a **1% relative gap** and a **60 s time limit**. The scalable app has no gap, because it proves no optimum; it has a 60 s limit for all four stages. See each app's README for what the gap means there, and how to get the exact optimum.
