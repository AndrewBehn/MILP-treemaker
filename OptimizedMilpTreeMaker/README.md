# Optimized MILP TreeMaker

A C# / .NET 10 implementation of the **Optimized MILP TreeMaker** spec, solved with SCIP through Google OR-Tools. It solves the same problem as Pure MILP TreeMaker: place the leaves on an N × N grid at the largest scale m*. Instead of one large model, it solves a series of much smaller ones. Its UI is the TreeMaker app's Optimized MILP and Lattice-Hull MILP nodes. It reuses the base library in `../PureMilpTreeMaker/src/PureMilpTreeMaker` for the tree, the definitions, the layout checks, and the base model it compares against. Keep the two folders side by side.

## Run it

This folder is a library and its tests. It runs inside the TreeMaker app, where the map's Optimized MILP and Lattice-Hull MILP nodes use it. From the repository root:

```sh
dotnet run
```

Then open <http://localhost:5080>. `dotnet test` at the root runs every test project; for this library's alone, `dotnet test OptimizedMilpTreeMaker/tests/OptimizedMilpTreeMaker.Tests`.

## The optimizations

| Section | Optimization | In this code |
|---|---|---|
| 3 | **Lattice hulls at a fixed scale.** One binary per crossable hull facet replaces one per offset. | `LatticeHull`, `HullCache`, `FeasibilityModel` (C:1) |
| 4 | **Symmetry breaking.** The anchor leaf stays in 0 ≤ y ≤ x ≤ N/2 (C:2), and interchangeable siblings stay in lexicographic order (C:3). | `SymmetryBreaking` |
| 5 | **Scale search.** Bisection over the candidate scales D(δ)/ℓᵢⱼ ≤ m̄. | `CandidateScales`, `OptimizedSolver` |
| 6 | **Incremental solving.** Pair generation, facet generation, and leaf windows. A windowed phase can only answer "yes"; the full-grid phase gives a final "no". | `OptimizedSolver.Loop`, `FeasibilityModel` (C:4, C:5, D:5) |

Every optimization except hulls and scale search can be switched off, in the UI or through `OptimizedOptions`. The tests check that every combination finds the same m* as the base model.

### Where this differs from the doc

- **Starting layout.** The doc starts from the rounded TreeMaker layout of base Section 9, which needs TreeMaker's continuous, nonlinear solve. This code uses a **border seed** in its place: the leaves are spread around the sheet's border in the tree's depth-first order, and the best of several rotations is kept. Like the doc's layout, it gives a known-feasible lower end for the bisection and centres the first leaf windows. It is skipped when there are position conditions or mirror pairs.
- **Conditions.** The base model's position conditions and mirror pairs are supported. They fix the sheet's orientation, so the anchor constraint C:2 is switched off when any are present. Leaves with a condition are also left out of the sibling groups.
- **Counts.** For the running example at N = 9, this code finds 192 distinct candidate scales and 80 crossable facets at m*. The doc gives 195 and 72. The worst-case facets per pair (20, 28 and 48 at N = 9, 16 and 32) match the doc exactly.

## Optimality settings

The defaults are a **1% relative gap** and a **60 s time limit** (UI → Solver settings).

- **Relative gap.** The bisection stops once (smallest candidate not ruled out) / (best layout's scale) − 1 ≤ gap. The result says which interval m* is proved to lie in. Set the gap to 0 for the exact m*.
- **Time limit.** This covers the whole search. If it runs out, you get the best layout so far and the proved interval.
- **Comparing with the base model.** "Compare with the base model" solves the base model with the same gap.

## Toward a crease pattern (steps 1 to 3, and the folded base)

After a solve, the **Toward a crease pattern** panel checks whether the layout can carry a crease pattern. Every solver node shares this panel (`TreeMaker.Web/wwwroot/polygons.js`) and the library code in `../PureMilpTreeMaker/src/PureMilpTreeMaker`.

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The polygons are drawn on the sheet: valid ones are shaded, invalid ones hatched, and the missing boundary is dotted.
2. **Close the polygons** (`PolygonCompletion`, `POST /api/complete`). The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain. **Use these lengths in the tree** copies the new lengths into the editor.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the strain needed** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/example` | The doc's running example |
| POST | `/api/analyze` | Candidate count, the maximum number of tests, worst-case and seed-scale Feas(m) sizes, the base model's size, and the symmetry found |
| POST | `/api/solve` | The layout, m*, the proved bound, every bisection test with its phases and rounds, the hulls at m*, and the sizes compared with the base model |
| POST | `/api/polygons` | The tight-path polygons of a layout, and whether they can carry a crease pattern |
| POST | `/api/creases` | The crease pattern, its facets with their folded positions, and the self-check |
| POST | `/api/complete` | Edge lengths that close the polygons, with the leaves held in place |
| POST | `/api/cancel` | Interrupts the search, which returns the best layout and interval so far |
