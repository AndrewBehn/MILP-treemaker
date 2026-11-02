# Pure MILP TreeMaker

A C# / .NET 10 implementation of the **Pure MILP TreeMaker** spec, solved with SCIP through Google OR-Tools. Its UI is the TreeMaker app's Pure MILP and Symmetry-Breaking MILP nodes.

## Run it

This folder is a library and its tests. It runs inside the TreeMaker app, where the map's Pure MILP and Symmetry-Breaking MILP nodes use it. From the repository root:

```sh
dotnet run
```

Then open <http://localhost:5080>. `dotnet test` at the root runs every test project; for this library's alone, `dotnet test tests/TreeMaker.Pure.Tests`.

## What is where

| Project | Contents |
|---|---|
| `src/TreeMaker.Pure` | This library: the MILP builder (C:1–C:7, and conditions C:6–C:7 for the Symmetry-Breaking doc), the solver driver (`PureMilpSolver`) and an exact model-size predictor (`ModelSize`). |
| `src/TreeMaker.Core` | What it builds on, shared with every solver: the tree and definitions (sheet D:1, offsets D:2, sheet D:3 and base D:1), the problem, the independent layout checker, and the steps after a solve. |
| `tests/TreeMaker.Pure.Tests` | xUnit tests of the solver and its symmetry breaking. Expected optima were computed independently with HiGHS. |

## Models

| Stage | Constraints | Objective |
|---|---|---|
| **Scale** | C:1–C:4 | maximize m, with 0 ≤ m ≤ m̄ = √2·N / ℓmax |
| **Edge** | C:1–C:3, C:5 at fixed m₀ | maximize the common stretch σ ≥ 0 of the stretch set S |
| **Strain** | C:1–C:3, C:6, C:7 at target m₀ | minimize Σ aₑ (total) or a_max (largest), with σ_min ≤ σₑ ≤ σ_max |

If edge optimization has no fixed m₀, it solves the scale stage first. It then uses that stage's m* as m₀ and seeds the second solve with the stage-one layout (Section 8.2).

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

## Toward a crease pattern

The steps after a solve (polygons, closing, crease pattern, folded base, pleats) are shared by every solver. They live in the shared library; see [`../TreeMaker.Core/README.md`](../TreeMaker.Core/README.md).

## Optimality settings

The defaults are a **1% relative gap** and a **60 s time limit** (UI → Solver settings).

- **Relative gap.** SCIP stops once |objective − bound| / |objective| ≤ gap. The result then shows the best bound, and a message says the objective is within the gap of optimal rather than proved optimal. For an exact optimum, set the gap to 1e-7, which is the library's default.
- **Time limit.** When it runs out, you get the best layout found, its bound and the gap, marked "Feasible".

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/example` | — | The doc's running example as a problem |
| POST | `/api/pure/analyze` | problem | Leaves, path lengths, m̄, and the predicted model size |
| POST | `/api/pure/solve` | problem | `{ result, buildMilliseconds, solveMilliseconds, totalMilliseconds, stageOneMilliseconds }` |
| POST | `/api/pure/layout` | problem, layout | A layout from the workbench or a file, checked and shown as if just solved |
| POST | `/api/cancel` | — | `{ cancelled }` |

The steps after a solve (`/api/polygons`, `/api/complete`, `/api/strain-needed`, `/api/creases`) are listed in the shared library's README. Only one solve runs at a time; a second request gets 409. Invalid input gets 400 with `{ error }`.
