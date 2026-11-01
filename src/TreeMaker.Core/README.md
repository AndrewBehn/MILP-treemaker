# TreeMaker.Core

The code every solver and the app share. Nothing here solves the layout problem itself; the solvers (`../TreeMaker.Pure`, `../TreeMaker.Optimized`, `../TreeMaker.Scalable`) build on it.

## What is here

| File | Contents |
|---|---|
| `Tree.cs`, `Definitions.cs` | The tree, its leaves and pairs, path lengths ℓᵢⱼ, the distance table D(δ) and the scale bound m̄ (base spec D:1–D:3). |
| `ProblemSpec.cs` | The problem every solver takes: tree, grid, stage, leaf conditions, mirror pairs, solver settings, a starting layout. |
| `Results.cs` | What a solve returns: status, leaf placements, pair and edge reports, model and solve metrics. |
| `RunningExample.cs` | The specs' running example (leaves 1–4, internal vertices u and v), used by every test project and the app. |
| `LayoutAnalysis.cs` | Independent checks from a layout alone, with exact distances: a layout's exact scale, the pair spacing table and violations. |
| `LayoutImport.cs` | Checks a layout from the workbench or a layout file so it can be shown as if just solved. |
| `SymmetryBreaking.cs` | The anchor leaf and the interchangeable sibling groups (Symmetry-Breaking doc C:5 and C:6), used by the base model and the optimized search. |
| `ActivePaths.cs` | The polygon test: do the tight pairs divide the leaves' hull into valid polygons (Polygon Closing doc A:1)? |
| `PolygonCompletion.cs`, `StrainNeeded.cs` | Closing the polygons by strain with the leaves fixed, and the strain LPs behind **Find the strain needed** (Polygon Closing doc A:2–A:4). |
| `CreasePattern.cs` | Universal molecules, the folded base and its self-check, and pleating (Crease Pattern doc A:1–A:3). |

Its tests are in `tests/TreeMaker.Core.Tests`. Some of them solve a layout with the base model first, so that project also references `TreeMaker.Pure`.

## The steps after a solve: polygons, closing, crease pattern, folded base

After a solve, the **Toward a crease pattern** panel checks whether the layout can carry a crease pattern. Every solver node shares this panel (`src/TreeMaker.Web/wwwroot/polygons.js`) and the code in this library. The routes are the same for every solver.

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The polygons are drawn on the sheet: valid ones are shaded, invalid ones hatched, and the missing boundary is dotted.
2. **Close the polygons** (`PolygonCompletion`, `POST /api/complete`). The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain. **Use these lengths in the tree** copies the new lengths into the editor.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the strain needed** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## API

These routes serve every solver; their body is a problem (any solver's: only the tree, grid and conditions are read) and a layout.

| Method | Path | Returns |
|---|---|---|
| POST | `/api/polygons` | The tight-path polygons of a layout, and whether they can carry a crease pattern |
| POST | `/api/complete` | Edge lengths that close the polygons, with the leaves held in place |
| POST | `/api/strain-needed` | The smallest strain bound that closes the polygons |
| POST | `/api/creases` | The crease pattern, its facets with their folded positions, and the self-check |
