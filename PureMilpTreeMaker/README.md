# Pure MILP TreeMaker

A C# / .NET 10 implementation of the **Pure MILP TreeMaker** spec, solved with SCIP through Google OR-Tools, plus a small web UI that runs in the same process as the solver.

## Run it

You need the .NET 10 SDK. OR-Tools (with its bundled SCIP) comes from NuGet on the first build.

```sh
dotnet run --project src/PureMilpTreeMaker.Web
```

Then open <http://localhost:5080>. To use another port, run `dotnet run --project src/PureMilpTreeMaker.Web --urls http://localhost:5199`.

Run the tests with:

```sh
dotnet test
```

## What is where

| Project | Contents |
|---|---|
| `src/PureMilpTreeMaker` | The library: the tree and definitions (D:1–D:4), the MILP builder (C:1–C:7), the solver driver, an independent layout checker, and an exact model-size predictor. |
| `src/PureMilpTreeMaker.Web` | An ASP.NET Core minimal API with a plain HTML/JS front end in `wwwroot` (no external dependencies). |
| `tests/PureMilpTreeMaker.Tests` | xUnit tests. Expected optima were computed independently with HiGHS. |

## Models

| Stage | Constraints | Objective |
|---|---|---|
| **Scale** | C:1–C:4 | maximize m, with 0 ≤ m ≤ m̄ = √2·N / ℓmax |
| **Edge** | C:1–C:3, C:5 at fixed m₀ | maximize the common stretch σ ≥ 0 of the stretch set S |
| **Strain** | C:1–C:3, C:6, C:7 at target m₀ | minimize Σ aₑ (total) or a_max (largest), with σ_min ≤ σₑ ≤ σ_max |

If edge optimization has no fixed m₀, it solves the scale stage first. It then uses that stage's m* as m₀ and seeds the second solve with the stage-one layout (Section 11.2).

Optional conditions are available for every stage:

- A leaf on an edge or a corner of the square.
- A leaf on the symmetry axis (2x = N, which needs an even N).
- A leaf fixed at a grid point.
- Mirror pairs: x_a + x_b = N and y_a = y_b.

## The UI

- **Tree:** edit edges as rows (from, to, length, and whether the edge is in S), or load a preset. A preview of the tree is drawn as you type.
- **Parameters:** set N, the stage, m₀, the strain bounds and objective, and the solver settings (time limit, gap, threads).
- **Leaf conditions and mirror pairs:** set per leaf.
- **Before solving:** the predicted model size (variables by type, constraints, nonzeros), ℓmax, and m̄ update live.
- **Solve:** builds and solves the model. **Cancel** interrupts SCIP, which then returns its best layout so far. **Ctrl/⌘ + Enter** also solves.
- **Results:**
  - The layout on the grid. Tight pairs (active paths) are drawn solid; other pairs are dashed and shown on request. Leaf circles have radius m·ℓ of the leaf's edge.
  - The solution, model, and solve metrics: status, objective, bound, gap, m and m/N, variable and row counts, nonzeros, build and solve time, B&B nodes, and LP iterations.
  - A stage-one summary, a pair table with slack, and edge lengths before and after.
  - An independent check of the layout.

## Toward a crease pattern (steps 1 to 3, and the folded base)

After a solve, the **Toward a crease pattern** panel checks whether the layout can carry a crease pattern. Both apps share this panel (`polygons.js`) and the library code in `src/PureMilpTreeMaker`.

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The polygons are drawn on the sheet: valid ones are shaded, invalid ones hatched, and the missing boundary is dotted.
2. **Close the polygons** (`PolygonCompletion`, `POST /api/complete`). The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain. **Use these lengths in the tree** copies the new lengths into the editor.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the strain needed** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## Optimality settings

The defaults are a **1% relative gap** and a **60 s time limit** (UI → Solver settings).

- **Relative gap.** SCIP stops once |objective − bound| / |objective| ≤ gap. The result then shows the best bound, and a message says the objective is within the gap of optimal rather than proved optimal. For an exact optimum, set the gap to 1e-7, which is the library's default.
- **Time limit.** When it runs out, you get the best layout found, its bound and the gap, marked "Feasible".

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/example` | — | The doc's running example as a problem |
| POST | `/api/analyze` | problem | Leaves, path lengths, m̄, and the predicted model size |
| POST | `/api/solve` | problem | `{ result, buildMilliseconds, solveMilliseconds, totalMilliseconds, stageOneMilliseconds }` |
| POST | `/api/polygons` | layout | The tight-path polygons, and whether they can carry a crease pattern |
| POST | `/api/creases` | layout, edge lengths | The crease pattern, its facets with their folded positions, and the self-check |
| POST | `/api/complete` | layout, strain bounds | Edge lengths that close the polygons, with the leaves held in place |
| POST | `/api/cancel` | — | `{ cancelled }` |

Only one solve runs at a time; a second request gets 409. Invalid input gets 400 with `{ error }`.
