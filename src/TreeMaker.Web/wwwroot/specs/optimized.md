# Optimized MILP TreeMaker

Oct 25, 2026 · @Andrew Behn

An exact formulation of TreeMaker's scale optimization on a fixed N × N grid: the model and procedure of the [lattice-hull spec](https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6) with symmetry breaking added, through two constraints of the [conditions spec](https://claude.ai/artifact/3WP1SahWDm9pb5hs8Mhwp7). It finds the same optimum m\* with models of the same small size, and each solve searches one copy of every layout instead of all of them.

It builds on its parent, the lattice-hull spec, and through it on the tree, grid and spacing condition of the [sheet spec](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), the candidate offsets and scales of the [offsets spec](https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem) and the lattice hulls and leaf windows of the [hulls spec](https://claude.ai/artifact/FxaVEDwfoA6pXYs4aMUwLk). It states only what it adds to its parent or changes in it: the symmetry-breaking constraints (Section 3), and the combined algorithm with its model size (Section 4).

**Labels.** This document numbers no labels of its own: every parameter, definition and constraint it uses has a label in its parent or in a foundation. Labels and sections of the parent are written lattice-hull C:2 or lattice-hull Section 8.3, and those of a foundation carry its short name, as in conditions C:6 or hulls D:4.

## 1. Notation

Notation follows the lattice-hull spec (lattice-hull Section 2), including its solver-use labels, and the conditions spec (conditions Section 1), which defines the dihedral group of the square, the fundamental domain, lexicographic order and valid tightenings.

## 2. Starting point: the lattice-hull model

Every part of the lattice-hull model is kept. Symmetry breaking adds one parameter, one set and two constraints, and changes one step of the procedure.

| Component | Lattice-hull model | In this document |
| --- | --- | --- |
| Sets and parameters | Leaves, pairs and grid (sheet Section 3); tree, edge lengths and grid size (sheet P:1–P:3); trial scale (lattice-hull P:1); active pairs, inner polygon points and leaf windows (hulls P:1–P:3) | Kept; adds the anchor leaf r\* (conditions P:2) and the interchangeable siblings 𝒯 (conditions D:1) |
| Definitions | Path lengths, scale bound, candidate offsets and scales, hulls, inner polygons and big-Ms (lattice-hull Section 2) | Kept |
| Variables | Leaf coordinates uᵢ and facet selectors z (lattice-hull Section 4) | Kept |
| Constraints | Leaves in their windows (lattice-hull C:1); spacing through the inner polygons (lattice-hull C:2) | Kept; adds conditions C:6 and C:7 (Section 3.1) |
| Models | The restricted model R(m; A, Q, W) and Feas(m) (lattice-hull Section 6) | Each gains conditions C:6 and C:7 (Section 3.2) |
| Objective | The largest candidate scale m with Feas(m) feasible (lattice-hull Section 7) | Kept |
| Procedure | Bisection, tests, generation loop, starting choices and carried state (lattice-hull Section 8) | Kept; the windowed phase maps its center layout first (Section 3.3) |

## 3. Symmetry breaking

Rotating or reflecting the square sheet, or swapping two interchangeable leaves, turns a layout into an equally good one, and the solver would otherwise search every copy. Two constraints of the conditions spec keep one copy of each; nothing else in the lattice-hull model changes.

### 3.1 Constraints

Kept: lattice-hull C:1 and C:2. Added: conditions C:6, which puts the anchor leaf r\* of conditions P:2 in the fundamental domain 0 ≤ y ≤ x ≤ N/2, and conditions C:7, which puts every pair of interchangeable siblings in 𝒯 (conditions D:1) in lexicographic order of their coordinates.

### 3.2 The models

Every model of the lattice-hull spec gains the two constraints, and in this document R and Feas(m) mean the models with them.

```math
\mathrm{R}(m; A, Q, W): \quad \text{find } u, z \ \text{ satisfying lattice-hull C:1 and C:2 and conditions C:6 and C:7}, \qquad \mathrm{Feas}(m) = \mathrm{R}\big(m;\ \mathcal{P},\ Q^{\mathrm{full}},\ W^{\mathrm{full}}\big)
```

### 3.3 The windowed phase

One step of the lattice-hull procedure changes: the windowed phase of lattice-hull Section 8.3. Its window center layout, the last feasible layout found or, at the first test, the rounded TreeMaker layout of lattice-hull Section 8.5, is first mapped into the form conditions C:6 and C:7 require. The symmetry of the square that puts the anchor leaf in the fundamental domain is applied, and any interchangeable siblings that are out of order are swapped. The windows are then set around the mapped layout, and every other step of lattice-hull Section 8 runs as written.

### 3.4 Why it is exact

- **Feas(m) keeps its answer.** By conditions Lemma 1, every layout that meets the spacing condition at scale m has a copy at the same scale that also satisfies conditions C:6 and C:7. The lattice-hull Feas(m) is exactly that spacing condition on the grid (lattice-hull Section 9), so adding C:6 and C:7 leaves its answer, and the optimum m\*, unchanged.
- **The tests stay exact.** With full windows, R keeps only some pairs and smaller polygons of the symmetry-broken Feas(m), so it is a relaxation of it and its "no" is final. A layout that passes the check satisfies every row of Feas(m), C:6 and C:7 included, so its "yes" is final. The rest of lattice-hull Section 9 carries over unchanged.
- **A badly placed window costs time, not exactness.** Windows around a layout that breaks C:6 or C:7 can make the windowed phase fail even though a mirror image would fit. The full-grid phase catches that, and mapping the center layout first (Section 3.3) avoids it.

### 3.5 What it gains

Without C:6 and C:7, each layout appears up to 8 times from the sheet's symmetries, and g! times more for each group of g interchangeable siblings (conditions Section 4), and branch-and-bound can explore every copy. The two constraints remove those copies in every solve of every test. Translations of a layout with slack (room to spare at the sheet's edges) remain.

## 4. The combined algorithm and model size

### 4.1 The full algorithm

| Level | Step | Solver use | Where |
| --- | --- | --- | --- |
| 0 | Setup: candidate scales, hulls, and the rounded TreeMaker layout | No solve (plus one continuous TreeMaker solve, which is not a MILP) | offsets D:3, hulls D:1, lattice-hull Section 8.5 |
| 1 | Bisection over candidate scales | Repeated solves: at most ⌈log₂ K⌉ tests | lattice-hull Section 8.2 |
| 2 | One test at a trial scale m | Repeated solves: a windowed phase, then a full-grid phase only if needed | lattice-hull Section 8.3, with Section 3.3 |
| 3 | One phase: the generation loop | Repeated solves: one round per pass | lattice-hull Section 8.4 |
| 4 | One round: the restricted model R, with conditions C:6 and C:7 | Single solve | Section 3.2 |
| 5 | The check after each round | No solve | lattice-hull Section 8.4 |

Without incremental solving (lattice-hull Sections 8.3 and 8.4), levels 2–5 collapse into one single solve of Feas(m) per test.

### 4.2 Model size compared with the pure MILP of the base model

The pure MILP of the base model solves one large MILP, with one offset selector per candidate offset of offsets D:1 for every pair, (2N + 1)² − 1 per pair; this model solves a short sequence of small ones. Both reach the same optimum. The counts below are for the full Feas(m); lattice-hull Section 10 gives the smaller sizes of each round of the generation loop.

**Binaries per pair.** The base model needs one selector per candidate offset. This model needs one per crossable facet of the pair's hull, and a hull's facet count grows only like r^(2/3), with r ≤ √2·N on the sheet (hulls Section 5).

| Grid | Base: selectors per pair | This model: facets per pair, worst case over all scales |
| --- | --- | --- |
| N = 9 | 360 | 20 |
| N = 16 | 1,088 | 28 |
| N = 32 | 4,224 | 48 |

**Whole models.** Counts below are binaries. For this model they are per solve, with the number of solves bounded by ⌈log₂|𝒞|⌉ over the candidate scales of offsets D:3.

| Instance | Base model, one solve | This model, per solve | Solves |
| --- | --- | --- | --- |
| Running example, 4 leaves, N = 9 | 2,160 | 56 to 80 | 8 |
| 20 leaves, N = 32 | 802,560 | at most 9,120 | at most 17 |
| 50 leaves, N = 32 | 5,174,400 | at most 58,800 | at most 20 |

Even summed over all eight solves, the running example uses 564 binaries, a quarter of the base model's 2,160, and each solve is a far smaller search, which matters more because MILP effort grows much faster than linearly with size.

**Rows and nonzeros.** The base model has four rows per pair, but each touches all (2N + 1)² − 1 selectors of the pair. This model has one row per facet plus one, and each facet row touches at most five variables (four coordinates and its selector). Nonzeros per pair fall from about 4(2N + 1)² to at most 6|K(m·ℓᵢⱼ)|.

**How the sizes scale.**

```math
\underbrace{O(n^2 N^2)}_{\text{base: one model}}
\quad \longrightarrow \quad
\underbrace{O\big(n^2 N^{2/3}\big)}_{\text{per feasibility model}} \ \times \ \underbrace{O\big(\log (N^2 n^2)\big)}_{\text{solves}}
```

**What does not improve.** The facet rows of lattice-hull C:2 use big-M constants (hulls D:2 and D:4), so the LP relaxation is still weak: averaging two facet choices can place leaves too close in the relaxation. The gains come from a much smaller search per solve and from the symmetry breaking of conditions C:6 and C:7, not from a tighter bound.
