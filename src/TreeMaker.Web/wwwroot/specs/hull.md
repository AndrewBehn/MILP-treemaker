# Lattice-Hull MILP TreeMaker

Oct 25, 2026 · @Andrew Behn

An exact MILP formulation of TreeMaker's scale optimization on a fixed N × N grid, built for speed. It finds the largest scale at which the leaves fit on the grid, with small models, by combining three ideas that depend on one another:

1. **Lattice hulls at a fixed scale.** At a fixed scale, a pair only needs to know whether its offset is too short. The too-short offsets fill a lattice polygon, so one binary per side of the polygon, a few dozen at most, replaces one binary per possible offset.
2. **Scale search.** Hulls exist only once the scale is fixed, so each model answers a yes-or-no question at one scale. The optimal scale is one of finitely many candidate values, and a bisection over them recovers the maximum.
3. **Incremental solving.** Each yes-or-no test starts from a small model, with a few pairs, simple polygons, and leaves confined to windows, and grows it only where a solution breaks a requirement.

It builds on three foundations: the tree, the grid and the spacing condition of the [sheet spec](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), the candidate offsets and candidate scales of the [offsets spec](https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem), and the lattice hulls, inner polygons and leaf windows of the [hulls spec](https://claude.ai/artifact/FxaVEDwfoA6pXYs4aMUwLk). This document holds the model built from them and the procedure that solves it. The optimized spec builds on it and adds symmetry breaking.

**Labels.** P:n and C:n number the parameters and constraints of this document, each kind in order of appearance. Labels of a foundation carry its short name, as in sheet D:2, offsets D:3 or hulls D:1, and so do its sections, as in hulls Section 5. Every definition this document uses comes from a foundation; Section 2 lists them.

## 1. From TreeMaker to fixed-scale lattice-hull models

**TreeMaker on a grid.** TreeMaker maximizes the scale m subject to the spacing condition of sheet D:2: every pair of flap tips at least m·ℓᵢⱼ apart on the sheet. Here every leaf lies on a grid point of the N × N sheet (sheet P:3), so a pair offset is one of the finitely many candidate offsets of offsets D:1, and the grid is the only approximation of TreeMaker.

**At a fixed scale.** If the scale m is fixed, each pair's requirement ‖uᵢ − uⱼ‖₂ ≥ m·ℓᵢⱼ says that its offset must avoid a fixed set of too-short grid offsets. Those offsets fill a lattice polygon, and avoiding them means lying beyond one of the polygon's sides, a choice among a few linear inequalities. That is what makes each fixed-scale model small. The price is that each model answers only whether a layout exists at that scale, so the largest scale is found by searching over scales.

**Leaves versus internal vertices.** Only leaves are placed. Internal vertices are not variables in TreeMaker's scale optimization: their positions are derived later, when the crease pattern is built from the active paths.

**Scale conversion.** This sheet has side N, so the TreeMaker scale is m/N (sheet D:2).

## 2. Notation

Notation follows the sheet spec (sheet Section 1) and the hulls spec (hulls Section 1). The leaves L, the leaf pairs 𝒫, the grid G\_N and the layouts uᵢ are those of sheet Section 3, and the pair offsets δᵢⱼ = uᵢ − uⱼ those of offsets Section 1. The symbols and terms below are added here.

| Symbol or term | Meaning |
| --- | --- |
| ⟺ | If and only if |
| {0, 1} | The binary values; a variable in it is a binary (0/1) variable |
| ⌈x⌉, log₂ | The smallest integer at least x; logarithm base 2 |
| Feasible model | A model is feasible when it has a layout that satisfies every one of its constraints, and infeasible when it has none; a scale m is feasible when Feas(m) is (Section 6) |
| Bisection | Repeatedly halving a sorted range by testing its middle value |
| LP relaxation | The model with its integer requirements dropped, which MILP solvers solve to get bounds |
| Branch-and-bound | The search MILP solvers use: split on variables that come out fractional, and discard branches whose LP relaxation cannot succeed |
| Contact graph | For a set of non-overlapping circles, the graph with one edge per pair of touching circles |

**From the foundations.** The quantities below are computed before solving, from the tree and the grid; those that depend on the scale are computed again at each trial scale.

| Symbol | Meaning | Label |
| --- | --- | --- |
| ℓᵢⱼ, ℓmax | Path length of a leaf pair in the tree; the largest one | sheet D:1 |
| m̄ | Scale upper bound √2·N/ℓmax | sheet D:3 |
| Δ\_N | Candidate offsets {−N, …, N}² ∖ {(0, 0)} | offsets D:1 |
| 𝒞 = {c₁ < … < c\_K} | Candidate scales: table lengths divided by path lengths, up to m̄ | offsets D:3 |
| F(r), P(r), K(r) | Forbidden offsets at radius r, their lattice hull, and its crossable facets aₖᵀδ ≤ bₖ | hulls D:1 |
| conv Qᵢⱼ, K(Qᵢⱼ) | Inner polygon of an active pair and its facets | hulls D:3 |
| Mᵢⱼₖ(W) | Window big-M of facet k of pair {i, j}; with full windows it is the facet big-M bₖ + 1 + ‖aₖ‖₁·N | hulls D:4, hulls D:2 |

**Solver-use labels.** The procedure of Section 8 marks each step with how it uses the solver:

- **No solve:** arithmetic or precomputation only; no MILP is solved.
- **Single solve:** one MILP model, built once and solved once.
- **Repeated solves:** a loop whose passes each contain at least one single solve. The number of passes is not fixed in advance.

## 3. Parameters

The tree, the edge lengths and the grid size (sheet P:1–P:3) describe the problem and stay fixed throughout. The parameters below are fixed for one solve and set by the procedure of Section 8.

**P:1 Trial scale.** The scale tested by one solve. It is a parameter, not a variable; the procedure takes its values from the candidate scales of offsets D:3.

```math
m > 0
```

**The restricted model's inputs.** The active pairs A ⊆ 𝒫, the inner polygon points Qᵢⱼ ⊆ F(m·ℓᵢⱼ) of each active pair, and the leaf windows Wᵢ are hulls P:1, P:2 and P:3. Full windows, Wᵢ = \[0, N\]², allow the whole sheet.

## 4. Variables

The scale is not a variable: it is the trial scale P:1 of each solve.

**Leaf coordinates.** Integer coordinates, so each leaf sits on a grid point (C:1).

```math
x_i,\ y_i \in \mathbb{Z} \cap [0, N], \qquad u_i = (x_i, y_i) \qquad \forall\, i \in L
```

**Facet selectors.** For each active pair (hulls P:1), one binary per facet of its inner polygon (hulls D:3); 1 means the pair lies beyond that facet.

```math
z_{ijk} \in \{0, 1\} \qquad \forall\, \{i, j\} \in A,\ k \in K(Q_{ij})
```

## 5. Constraints

**C:1 Leaves on grid points in their windows.** Every leaf lies on a grid point inside its window (hulls P:3). With full windows this is the whole N × N sheet.

```math
u_i \in W_i \cap G_N \qquad \forall\, i \in L
```

**C:2 Spacing through the inner polygons.** Each active pair's offset lies strictly outside its inner polygon (hulls D:3), beyond at least one facet. Each facet row is switched off by the window big-M of hulls D:4, which with full windows is the facet big-M of hulls D:2; a facet that cannot be crossed inside the windows is left out.

```math
\begin{aligned}
&a_k^{\top} (u_i - u_j) \geq b_k + 1 - M_{ijk}(W)\, (1 - z_{ijk}) && \forall\, k \in K(Q_{ij}) \\
&\textstyle\sum_{k \in K(Q_{ij})} z_{ijk} \geq 1
\end{aligned}
\qquad \forall\, \{i, j\} \in A
```

![C:2 · an offset beyond one facet of its hull at radius 5](figures/hull/01.svg)

*C:2 · an offset beyond one facet of its hull at radius 5*
With the full hull at radius 5, the offset (5, 1) lies beyond exactly one facet, so that facet's selector is the only one that can be 1.

## 6. Models

Both models below have no objective: each asks whether a layout exists at one trial scale.

**The restricted model R (single solve).** C:1 and C:2 over the leaf coordinates and facet selectors, for a given trial scale P:1 and given A, Q and W (hulls P:1–P:3). Every solve in the procedure is one solve of R.

```math
\mathrm{R}(m; A, Q, W): \quad \text{find } u, z \ \text{ satisfying C:1 and C:2}
```

**The full feasibility model Feas(m).** R with every pair active, every inner polygon equal to its full hull, and full windows. It is the lattice-hull model of TreeMaker at scale m: it has a solution exactly when a grid layout exists with every pair at least m·ℓᵢⱼ apart (Section 9).

```math
\mathrm{Feas}(m) = \mathrm{R}\big(m;\ \mathcal{P},\ Q^{\mathrm{full}},\ W^{\mathrm{full}}\big), \qquad Q^{\mathrm{full}}_{ij} = F(m\, \ell_{ij}), \qquad W^{\mathrm{full}}_i = [0, N]^2
```

The procedure never has to build Feas(m) in full. It decides the same question with smaller models R, and uses Feas(m) only as the yardstick for what is exact.

## 7. Objective

Maximize the scale, exactly as TreeMaker does, over the candidate scales of offsets D:3. Because each model fixes the scale, the maximum is taken outside the solver, by the bisection of Section 8.

```math
m^{*} = \max \{\, m \in \mathcal{C} : \mathrm{Feas}(m) \text{ has a solution} \,\}
```

For the running example, m\* = 1.054 on the 9 × 9 grid, with pair 2–4 tight.

## 8. Procedure

### 8.1 Levels

| Level | Step | Solver use | Where |
| --- | --- | --- | --- |
| 0 | Setup: candidate scales, hulls, and the rounded TreeMaker layout | No solve (plus one continuous TreeMaker solve, which is not a MILP) | offsets D:3, hulls D:1, Section 8.5 |
| 1 | Bisection over candidate scales | Repeated solves: at most ⌈log₂ K⌉ tests | 8.2 |
| 2 | One test at a trial scale m | Repeated solves: a windowed phase, then a full-grid phase only if needed | 8.3 |
| 3 | One phase: the generation loop | Repeated solves: one round per pass | 8.4 |
| 4 | One round: the restricted model R | Single solve | Section 6 |
| 5 | The check after each round | No solve | 8.4 |

### 8.2 Bisection over candidate scales (repeated solves)

1. Sort the candidates of offsets D:3: c₁ < c₂ < … < c\_K. No solve.
2. Set lo to the index of any candidate known to be feasible, and hi = K. The rounded TreeMaker layout of 8.5 gives one, at least N·m\_TM − √2/ℓ\_min, where m\_TM is TreeMaker's continuous optimum and ℓ\_min the shortest leaf path; without it, use lo = 1. No solve.
3. While lo < hi: test the middle candidate c\_mid, with mid = ⌈(lo + hi)/2⌉, by the test of 8.3. If Feas(c\_mid) has a solution, set lo = mid and keep the layout; otherwise set hi = mid − 1.
4. Return m\* = c\_lo and the last layout found. No solve.

![bisection over candidate scales · running example, 9 × 9 grid](figures/hull/02.svg)

*bisection over candidate scales · running example, 9 × 9 grid*
### 8.3 One test at a trial scale (repeated solves)

1. **Windowed phase.** Repeated solves. Set the windows around the window center layout: the last feasible layout found, or at the first test the rounded TreeMaker layout. Run the generation loop. A "yes" is final. If R has no layout, go to phase 2.
2. **Full-grid phase.** Repeated solves, run only when the windowed phase fails. Run the generation loop again with full windows, starting from the A and Q the windowed phase built. Its "yes" or "no" is final.

![one bisection step · windowed phase, then full-grid phase](figures/hull/03.svg)

*one bisection step · windowed phase, then full-grid phase*
### 8.4 The generation loop (repeated solves)

The loop takes a trial scale m, a set of windows, and the current A and Q. Each pass:

1. **Solve R(m; A, Q, W).** Single solve.
2. **If R has no layout,** stop. With full windows, the test's answer is a final "no". With smaller windows, the phase has failed and says nothing about Feas(m).
3. **Check the layout.** No solve. For every pair in 𝒫, compare ‖δᵢⱼ‖₂ with m·ℓᵢⱼ. For each pair that is too close: if the pair is not active, add it to A, with its starting points plus the offending offset δᵢⱼ; if it is active, its inner polygon was too small, so add δᵢⱼ to Qᵢⱼ, together with its images under the 8 symmetries of the square.
4. **If no pair was too close,** stop: the test's answer is a final "yes". Otherwise return to 1.

### 8.5 Starting choices (no solve)

- **Rounded TreeMaker layout:** solve TreeMaker's continuous model once, scale its layout by N, and move each leaf to its nearest grid point. Each leaf moves at most √2/2, so every pair distance shrinks by at most √2, which gives the feasible candidate of 8.2.
- **Active pairs:** the pairs that are tight or nearly tight (at, or close to, their minimum distance) in the window center layout, plus every pair of leaves that share a parent.
- **Inner polygon points:** the usual starting set of hulls P:2, which gives at most 8 facets. Setting Qᵢⱼ = F(m·ℓᵢⱼ) gives the full hull back and turns facet generation off.
- **Windows:** a box of half-width h around each leaf of the window center layout, clipped to the grid. h is a tuning choice; it changes how fast a test runs, not its answer.

### 8.6 What carries from one test to the next (no solve)

The bisection moves up after a "yes" and down after a "no".

| Item | To a higher trial scale | To a lower trial scale m′ |
| --- | --- | --- |
| Active pairs A | Kept | Kept |
| Inner polygon points Q | Kept | Kept only while ‖δ‖₂ < m′·ℓᵢⱼ; then the new scale's starting points are added |
| Window center layout | The last feasible layout | The last feasible layout |

Each feasible layout can also be passed to the next solve as a starting solution.

## 9. Why it is exact

**Feas(m) is TreeMaker on the grid at scale m.** By hulls Section 5, a grid offset is too short exactly when it lies in its hull P(r), the +1 shift is exact for lattice offsets, the big-Ms of hulls D:2 and D:4 are large enough, and leaving out uncrossable facets loses nothing. So C:2 with every pair active, full hulls and full windows is the spacing condition of sheet D:2 for every pair.

```math
\mathrm{Feas}(m) \text{ has a solution } u \iff \|u_i - u_j\|_2 \geq m\, \ell_{ij} \ \ \forall\, \{i, j\} \in \mathcal{P}
```

**The bisection finds the maximum.**

- **m\* is a candidate.** Every grid layout's scale, the optimum included, is one of the candidate scales of offsets D:3, and m\* ≤ m̄ (sheet D:3).
- **Feasibility is monotone in the scale.** A layout that works at scale m also works at every smaller scale, because each pair's required distance only shrinks. The sorted candidates split into a feasible lower part and an infeasible upper part, and bisection finds the boundary.

```math
m^{*} \in \mathcal{C}, \qquad \mathrm{Feas}(m) \text{ has a solution and } m' \leq m \ \Longrightarrow\ \mathrm{Feas}(m') \text{ has a solution}
```

**Each test answers Feas(m) exactly.**

- **Full-window solves settle "no".** With full windows, R keeps only some pairs, and each inner polygon lies inside its full hull, so being outside it is a weaker requirement. R is then a relaxation (it drops requirements) of Feas(m): if it has no layout, neither does Feas(m).
- **Checked layouts settle "yes".** The check tests every pair against its true minimum distance, and every layout of R has its leaves on grid points. A layout that passes the check satisfies Feas(m), whatever windows were used; small windows only drop options, a restriction.
- **A windowed "no" is never used as an answer.** It only sends the test to the full-grid phase.
- **The added points are forbidden.** A too-short offset lies in F(m·ℓᵢⱼ), and so do its 8 images, because F depends only on length.
- **The loop ends.** Every pass that does not stop adds at least one pair or one lattice point, and there are finitely many of both. In the worst case R grows into Feas(m).
- **The carried state stays valid.** Any subset of the real pairs gives a relaxation at every scale, so A carries both ways. The forbidden sets are nested, so points carry upward; at a lower scale some points may be long enough, and keeping them would forbid valid offsets, so they are dropped.

```math
m < m' \ \Longrightarrow\ F(m\, \ell_{ij}) \subseteq F(m'\, \ell_{ij})
```

## 10. Model size and costs

The comparison is with the selector model of Pure MILP TreeMaker, which gives each pair one binary per candidate offset, (2N + 1)² − 1 per pair, and finds m\* in one solve.

**Binaries per pair, full hulls.** A pair needs one binary per crossable facet of its full hull: at most 20, 28 and 48 over all scales for N = 9, 16 and 32 (hulls Section 5), against 360, 1,088 and 4,224 offset selectors per pair in the selector model.

**Whole models, full hulls.** Binaries in Feas(m) with every pair active and full windows; the number of tests is at most ⌈log₂|𝒞|⌉.

| Instance | Selector model, one solve | Feas(m), per test | Tests |
| --- | --- | --- | --- |
| Running example, 4 leaves, N = 9 | 2,160 | 56 to 80 | 8 |
| 20 leaves, N = 32 | 802,560 | at most 9,120 | at most 17 |
| 50 leaves, N = 32 | 5,174,400 | at most 58,800 | at most 20 |

At the running example's optimum, the six pairs' hulls have 72 crossable facets in total. Summed over all eight tests, it uses 564 binaries, a quarter of the selector model's 2,160, and each solve is a far smaller search.

**Incremental solving.** Each round of R has one binary per facet of each active pair's inner polygon, instead of one per crossable facet of every pair's full hull.

```math
\underbrace{\textstyle\sum_{\{i, j\} \in A} |K(Q_{ij})|}_{\text{one round of R}} \quad \text{instead of} \quad \underbrace{\textstyle\sum_{\{i, j\} \in \mathcal{P}} |K(m\, \ell_{ij})|}_{\mathrm{Feas}(m)}
```

Binding pairs in TreeMaker layouts tend to form a sparse, roughly planar pattern, like the contact graph of a circle packing, which has at most 3n − 6 edges. If the active set stays near that size, a 50-leaf tree on a 32 × 32 grid needs about 150 active pairs with at most 48 facets each: about 7,200 binaries per round, against at most 58,800 for Feas(m). Small windows also give small big-Ms and a tighter LP relaxation. The running example, with only six pairs, is too small to gain from pair generation.

**Rows and nonzeros.** Each facet row of C:2 touches at most five variables (four coordinates and its selector), so a pair has at most 6|K(Qᵢⱼ)| nonzeros, against about 4(2N + 1)² in the selector model.

```math
\underbrace{O(n^2 N^2)}_{\text{selector model: one solve}}
\quad \longrightarrow \quad
\underbrace{O\big(n^2 N^{2/3}\big)}_{\text{Feas}(m)\text{, per test}} \ \times \ \underbrace{O\big(\log (N^2 n^2)\big)}_{\text{tests}}
```

**The costs.**

- **The scale is fixed in each solve.** The selector model reads the exact length of whichever offset a pair takes, so m can stay a variable. The hull test only says whether an offset is too short at one radius, and P(r) changes with r = m·ℓᵢⱼ. If m stayed a variable, each pair would need a different polygon for every value m could take, which brings back much of the size the hulls remove. So several small solves replace one large one.
- **Big-M constants.** The selector model needs none. The window big-M of hulls D:4 is the price of the smaller selector set, and it keeps the LP relaxation weak: averaging two facet choices can place leaves too close in the relaxation. The gains come from much smaller searches, not from a tighter bound.
- **More rounds per test.** Their number has no useful bound in advance; it depends on how well the starting set guesses the binding pairs.
- **The expensive tests.** The tests that prove infeasibility (that no layout exists), just above m\*, are usually the hardest, and only the full-grid phase can settle them.
