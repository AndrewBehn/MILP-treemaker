# Optimized MILP TreeMaker

A C# / .NET 10 implementation of the **Optimized MILP TreeMaker** spec, solved with SCIP through Google OR-Tools. It solves the same problem as Pure MILP TreeMaker: place the leaves on an N × N grid at the largest scale m*. Instead of one large model, it solves a series of much smaller ones. Its UI is the TreeMaker app's Optimized MILP and Lattice-Hull MILP nodes. It builds on the shared library, `../TreeMaker.Core` (the tree, the definitions, the layout checks), and uses the base model, `../TreeMaker.Pure`, for its predicted size and the optional comparison solve.

## Run it

This folder is a library and its tests. It runs inside the TreeMaker app, where the map's Optimized MILP and Lattice-Hull MILP nodes use it. From the repository root:

```sh
dotnet run
```

Then open <http://localhost:5080>. `dotnet test` at the root runs every test project; for this library's alone, `dotnet test tests/TreeMaker.Optimized.Tests`.

## The optimizations

| Where | Optimization | In this code |
|---|---|---|
| lattice-hull Sections 3–6; hulls D:1, D:2 | **Lattice hulls at a fixed scale.** One binary per crossable hull facet replaces one per offset. | `LatticeHull`, `HullCache`, `FeasibilityModel` (lattice-hull C:2) |
| Section 3; conditions C:6, C:7 | **Symmetry breaking.** The anchor leaf stays in 0 ≤ y ≤ x ≤ N/2 (conditions C:6), and interchangeable siblings stay in lexicographic order (conditions C:7). | `SymmetryBreaking` |
| lattice-hull Section 8.2; offsets D:3 | **Scale search.** Bisection over the candidate scales D(δ)/ℓᵢⱼ ≤ m̄. | `CandidateScales`, `OptimizedSolver` |
| lattice-hull Sections 8.3–8.6; hulls P:1–P:3 | **Incremental solving.** Pair generation, facet generation, and leaf windows. A windowed phase can only answer "yes"; the full-grid phase gives a final "no". | `OptimizedSolver.Loop`, `FeasibilityModel` (lattice-hull C:1, C:2, hulls D:4) |

Every optimization except hulls and scale search can be switched off, in the UI or through `OptimizedOptions`. The tests check that every combination finds the same m* as the base model.

### Where this differs from the doc

- **Starting layout.** The doc starts from the rounded TreeMaker layout of base Section 6, which needs TreeMaker's continuous, nonlinear solve. This code uses a **border seed** in its place: the leaves are spread around the sheet's border in the tree's depth-first order, and the best of several rotations is kept. Like the doc's layout, it gives a known-feasible lower end for the bisection and centres the first leaf windows. It is skipped when there are position conditions or mirror pairs.
- **Conditions.** The base model's position conditions and mirror pairs are supported. They fix the sheet's orientation, so the anchor constraint (conditions C:6) is switched off when any are present. Leaves with a condition are also left out of the sibling groups.
- **Counts.** For the running example at N = 9, this code finds 192 distinct candidate scales and 80 crossable facets at m*. The doc gives 195 and 72. The worst-case facets per pair (20, 28 and 48 at N = 9, 16 and 32) match the doc exactly.

## Optimality settings

The defaults are a **1% relative gap** and a **60 s time limit** (UI → Solver settings).

- **Relative gap.** The bisection stops once (smallest candidate not ruled out) / (best layout's scale) − 1 ≤ gap. The result says which interval m* is proved to lie in. Set the gap to 0 for the exact m*.
- **Time limit.** This covers the whole search. If it runs out, you get the best layout so far and the proved interval.
- **Comparing with the base model.** "Compare with the base model" solves the base model with the same gap.

## Toward a crease pattern

The steps after a solve are shared by every solver; see [`../TreeMaker.Core/README.md`](../TreeMaker.Core/README.md).

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/example` | The doc's running example |
| POST | `/api/optimized/analyze` | Candidate count, the maximum number of tests, worst-case and seed-scale Feas(m) sizes, the base model's size, and the symmetry found |
| POST | `/api/optimized/solve` | The layout, m*, the proved bound, every bisection test with its phases and rounds, the hulls at m*, and the sizes compared with the base model |
| POST | `/api/optimized/layout` | A layout from the workbench or a file, checked and shown as if just solved |
| POST | `/api/cancel` | Interrupts the search, which returns the best layout and interval so far |
