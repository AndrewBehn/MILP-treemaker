# Scalable MILP TreeMaker

A C# / .NET 10 app for TreeMaker's circle-packing problem at **25 to 100 leaves**, where the exact models of the other two apps stop being practical. It does not prove optimality. It finds a good grid layout fast and tries to make it foldable. The design is written up in the doc *Scalable MILP TreeMaker*.

It reuses the base library in `../PureMilpTreeMaker/src/PureMilpTreeMaker`: the tree, the layout checks, the polygons, the closing step and the crease pattern. Keep the folders side by side.

## Run it

You need the .NET 10 SDK.

```sh
dotnet run --project src/ScalableMilpTreeMaker.Web
```

Then open <http://localhost:5082>. The base app uses 5080 and the optimized app uses 5081, so all three can run at once. Run the tests with `dotnet test`.

## The four stages

| Stage | What it does | Solver | Code |
|---|---|---|---|
| 1. Continuous layout | TreeMaker's scale optimization off the grid, by sequential LP. Each LP keeps every pair apart along its current direction, d̂ᵢⱼ·(vᵢ − vⱼ) ≥ m·ℓᵢⱼ. That bounds the true distance from below, so every step is a real layout that is at least as good. A trust box grows and shrinks. It runs from several starts. | GLOP | `ContinuousLayout` |
| 2. Round and repair | Rounds each leaf to the grid. It then finds the largest candidate scale √s/ℓ at which every leaf can stay within h of its rounded point. Each test is a table model: one Boolean per window point, and "too close" combinations forbidden pair by pair. Pairs whose windows cannot collide are left out. | CP-SAT | `WindowModel`, `Placement` |
| 3. Neighbourhood search | Aims a little higher. It frees the leaves that collide at that scale (half-width 3) and their neighbours (1), holds the rest, and solves again. On alternate failures it frees a whole subtree instead (the optional decomposition). | CP-SAT | `ScalableSolver` |
| 4a. Most tight pairs | At the final scale, it moves each leaf at most one step to make the most pairs of a triangulation exactly tight. Boundary pairs count first. | CP-SAT | `WindowModel` with targets |
| 4b. Close with moving leaves | Changes edge strains while leaves may still move one step, to close the polygons. A polish step, with the points fixed, then makes the chosen pairs tight to LP precision. | SCIP | `MovingClosure` |

The crease-pattern panel, the folded base and pleating are the same files as in the other two apps (`polygons.js`, `folded.js`, `tree-editor.js`). If Stage 4b changes edge lengths, the panel starts from those lengths.

## What to expect

- **Speed.** The prototype of Stages 1 to 4a took 1 to 3 seconds at 25, 50 and 100 leaves on random trees. No CP-SAT model had more than about 1,300 Booleans. The base model for 100 leaves at N = 32 has 20.9 million binaries.
- **Quality.** The grid layout reached 90% to 102% of the continuous layout's scale. It can beat the continuous layout because Stage 1 finds only a local optimum.
- **Bound.** The only proved bound is m̄ = √2·N / ℓmax. The continuous scale is shown for reference, but it is not a bound.
- **Foldability.** Closing the polygons is the hard part. With the leaves held fixed, none of the 25-, 50- or 100-leaf test layouts closed, even at ±0.9 strain. Letting the leaves move (Stage 4b) closed one of five test trees (9, 11, 15 twice and 25 leaves): the 9-leaf tree, at ±0.5. Expect valid polygons only on small or regular trees for now. The doc describes what would come next.
- **Larger presets.** Simple centipedes (2 to 8 leg pairs on one backbone, loaded with left–right mirror pairs), and beetle, deer, dragon, scorpion and centipede trees with 13 to 25 nodes. In the prototype, every one reached 91% to 99% of the continuous scale in under 1.5 s. Each preset sets a grid size that the apps offering it can solve. The base and optimized apps grey out the presets they cannot solve in reasonable time (see the top-level README).
- **Random trees.** **Load a preset → Random tree, 25 / 50 / 100 leaves** makes a new random tree each time, on a suggested grid size of about 3.2·√leaves.

These figures come from a Python prototype (SciPy and HiGHS), because the C# could not be compiled where it was written. CP-SAT is usually faster than HiGHS on table models, but measure it on your machine.

## Settings

All the stage settings are in the **Search** panel and in `ScalableOptions`. The defaults are 4 starts, repair half-width 1, search half-width 3, subtree neighbourhoods on, Stage 4a and 4b on, strain ±0.3, and a 60 s limit for the whole pipeline. Stage 4b gets at most 20 s of that.
