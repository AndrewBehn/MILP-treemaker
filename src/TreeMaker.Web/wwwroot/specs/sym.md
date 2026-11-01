# Symmetry-Breaking MILP TreeMaker

Oct 25, 2026 · @Andrew Behn

A pure mixed-integer linear program (MILP) for TreeMaker's scale optimization on a fixed N × N grid, with symmetry breaking added. It is the model of [Pure MILP TreeMaker](https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4) plus two constraints that remove equivalent copies of each layout: rotations and reflections of the sheet, and swaps of interchangeable leaves. The optimum is the same, and it is still found in one solve. This document restates everything it needs, so it can be read on its own.

Labels P:n, D:n, and C:n number the parameters, definitions, and constraints of this document, in order of appearance. Definitions used in more than one place are in Section 5. A definition used in one place only is given there.

## 1. From TreeMaker to a pure MILP with symmetry breaking

**TreeMaker's scale optimization.** Lang's TreeMaker places the leaves of a weighted tree in the unit square and maximizes the scale m, the paper length per unit of tree length. Folding never stretches paper, so two flap tips must start at least as far apart on the sheet as their tree path length, times the scale.

```math
\max_{m,\ u} \ m \qquad \text{subject to} \qquad \|u_i - u_j\|_2 \geq m\, \ell_{ij} \ \ \forall\, \{i, j\} \in \mathcal{P}, \qquad u_i \in [0, 1]^2 \ \ \forall\, i \in L
```

**The pure MILP version.** The sheet becomes an N × N grid with N chosen in advance, and every leaf must lie on a grid point. Each leaf's continuous position becomes a choice among grid points, and each pair's nonlinear distance becomes a choice among offsets whose lengths are precomputed in a lookup table. Every constraint is then linear.

**Symmetry breaking.** The square sheet looks the same after any of its 8 rotations and reflections, and two leaves with the same parent and the same edge length can trade places. Each of these turns a layout into an equally good one, so the solver meets every layout many times over. Two constraints keep exactly one copy of each.

**Leaves versus internal vertices.** Only leaves are placed. Internal vertices are not variables in TreeMaker's scale optimization: their positions are derived later, when the crease pattern is built from the active paths.

**Scale conversion.** TreeMaker's sheet has side 1 and this one has side N, so the two scales differ by a factor of N.

```math
m_{\mathrm{TreeMaker}} = m / N
```

## 2. Notation

Every symbol and term not defined in Sections 3–6 is listed here.

| Symbol or term | Meaning |
| --- | --- |
| ∅ | The empty set |
| x ∈ X, X ⊆ Y | x is an element of X; X is a subset of Y |
| X \\ Y | Set difference: elements of X that are not in Y |
| X × Y | Cartesian product: all ordered pairs (x, y) with x ∈ X, y ∈ Y |
| \|X\| | Cardinality: the number of elements of X |
| {i, j} | An unordered pair, so {i, j} = {j, i} |
| ∀, ⟹ | For all; implies |
| ∑, max | Sum over, and largest value over, the indexed set |
| ℤ, ℤ≥₁ | The integers; the positive integers |
| ℝ, ℝ² | The real numbers; the real plane |
| \[a, b\] | The closed interval of reals from a to b |
| {0, 1} | The binary values; a variable in it is a binary (0/1) variable |
| {a, …, b} | The integers from a to b inclusive |
| ‖δ‖₂ | Euclidean norm √(δ₁² + δ₂²) of a plane vector |
| deg(v) | Degree: the number of edges incident to vertex v |
| path(u, v) | The edges on the unique path between u and v in a tree |
| Grid point | A point of the sheet whose two coordinates are both integers |
| Dihedral group of the square | The 8 symmetries of a square: 4 rotations (0°, 90°, 180°, 270°) and 4 reflections |
| Fundamental domain | A region holding exactly one image of every point under those 8 symmetries; here the triangle 0 ≤ y ≤ x ≤ N/2 |
| Lexicographic order | Ordering points by x first, and by y when x ties |
| Tight (binding) pair | A leaf pair whose distance equals its required minimum, ‖uᵢ − uⱼ‖₂ = m·ℓᵢⱼ. Tight pairs limit the scale: any larger scale would put them too close. |
| Slack | The amount by which a constraint is more than met |
| Feasible, infeasible | A layout is feasible when it satisfies every constraint of a model; a model is infeasible when no layout does |
| LP relaxation | The model with its integer requirements dropped, so binary variables may take fractional values |
| Branch-and-bound | The search MILP solvers use: split on variables that come out fractional, and discard branches whose LP relaxation cannot beat the best layout found |
| Valid tightening | An added constraint that removes only layouts with an equivalent copy that remains, so the optimum is unchanged |

## 3. Sets and spaces

**Leaves.** The leaves of the input tree T = (V, E) (Section 4) are its vertices of degree 1, the flap tips; n is their number.

```math
L = \{\, v \in V : \deg(v) = 1 \,\} \subseteq V, \qquad n = |L|
```

**Leaf pairs.** The set of unordered pairs of distinct leaves.

```math
\mathcal{P} = \{\, \{i, j\} : i, j \in L,\ i \neq j \,\}
```

**Integer lattice and grid.** The integer lattice ℤ² is the set of points whose two coordinates are both integers. The sheet is the square \[0, N\]², and its grid points are the lattice points it contains.

```math
\mathbb{Z}^2 = \{\, (p, q) : p, q \in \mathbb{Z} \,\}, \qquad G_N = \mathbb{Z}^2 \cap [0, N]^2 = \{0, 1, \dots, N\}^2, \qquad |G_N| = (N + 1)^2
```

**Pair offsets.** The offset of a leaf pair is the difference of the two leaves' positions uᵢ (Section 6). Fix an order i < j for each pair so the offset has a sign.

```math
\delta_{ij} = u_i - u_j \in \mathbb{Z}^2 \qquad \forall\, \{i, j\} \in \mathcal{P},\ i < j
```

**Candidate offsets.** Every value a pair offset can take on the N × N grid. Both coordinates of two grid points lie in {0, …, N}, so their difference lies in {−N, …, N}². The zero offset is excluded because two leaves cannot share a grid point when the scale is positive.

```math
\Delta_N = \{-N, \dots, N\}^2 \setminus \{(0, 0)\}, \qquad |\Delta_N| = (2N + 1)^2 - 1, \qquad \delta_{ij} \in \Delta_N \ \ \forall\, \{i, j\} \in \mathcal{P}
```

**Interchangeable siblings.** Ordered pairs (a, b) of distinct leaves with the same parent and equal edge length. A group of g such leaves contributes one pair for each consecutive two in a fixed listing of the group, g − 1 pairs in all.

```math
\mathcal{T} \subseteq L \times L
```

In the running example of Section 5, leaves 1 and 2 share the parent u but have edge lengths 3 and 2, and leaves 3 and 4 share v but have lengths 2 and 4, so 𝒯 = ∅.

## 4. Parameters

**P:1 Tree.** The input tree: a finite vertex set V and an edge set E saying which vertices are joined. A tree is connected and has no cycles, so it has exactly one fewer edge than vertices.

```math
T = (V, E), \qquad E \subseteq \{\, \{u, v\} : u, v \in V,\ u \neq v \,\}, \qquad T \text{ connected}, \qquad |E| = |V| - 1
```

**P:2 Edge lengths.** Positive edge lengths in tree units. They need not be integers: the scale m converts them to grid units.

```math
\ell_e > 0 \qquad \forall\, e \in E
```

**P:3 Grid size.** The number of grid squares along each side of the sheet, fixed in advance.

```math
N \in \mathbb{Z}_{\geq 1}
```

**P:4 Anchor leaf.** One leaf, chosen in advance, that is in no pair of 𝒯. C:5 places it in the fundamental domain. In the running example any leaf will do; take leaf 1.

```math
r^{\ast} \in L, \qquad r^{\ast} \notin \{\, a, b : (a, b) \in \mathcal{T} \,\}
```

## 5. Shared definitions

Every quantity below is computed once from the parameters before solving. The diagrams use one running example: a tree with four leaves and two internal vertices u and v.

**D:1 Tree metric and path lengths.** The tree metric d is the total edge length along the unique path between two vertices. Between two leaves it gives the path length ℓᵢⱼ, which the scale converts into that pair's minimum separation. The largest path length is ℓmax.

```math
d(u, v) = \sum_{e \in \mathrm{path}(u, v)} \ell_e, \qquad \ell_{ij} = d(i, j) \ \ \forall\, \{i, j\} \in \mathcal{P}, \qquad \ell_{\max} = \max_{\{i, j\} \in \mathcal{P}} \ell_{ij}
```

Used in: D:3 and constraint C:4.

&#91;embedded content: example tree · path lengths between leaves\]

In the running example, leaves 1 and 4 are farthest apart along the tree, so ℓmax = 10.

**D:2 Offset distance lookup table.** The Euclidean length of every candidate offset in Δ\_N. It depends only on N, not on the tree, so it is computed once per grid size and shared by every leaf pair.

```math
D : \Delta_N \to \mathbb{R}_{> 0}, \qquad D(\delta) = \|\delta\|_2 = \sqrt{\delta_1^2 + \delta_2^2}, \qquad D(\pm\delta_1, \pm\delta_2) = D(\delta_1, \delta_2)
```

Used in: constraint C:4 and the optimum's closed form (Section 8).

&#91;embedded content: offset distance lookup table · quadrant for N = 5\]

The table replaces the nonconvex function ‖uᵢ − uⱼ‖₂ by a finite list of values, one per possible offset, so selecting an offset reads its length as a linear expression.

**D:3 Scale upper bound.** No two grid points are farther apart than the sheet's diagonal, √2·N, and the pair with the longest path needs m·ℓmax of that.

```math
\bar{m} = \frac{\sqrt{2}\, N}{\ell_{\max}}, \qquad \text{since} \quad m\, \ell_{\max} \leq \|u_i - u_j\|_2 \leq \sqrt{2}\, N
```

Used in: the bounds on the variable m, and Section 10.

&#91;embedded content: running example on a 9 × 9 grid · binding pair and diagonal bound\]

The bound is usually loose because other pairs also need room. In the running example it is reached by the diagonal pair 1–4, but pair 2–4 binds first (becomes tight, exactly at its minimum distance, at a smaller scale).

## 6. Variables

**Scale.** Grid units of paper per unit of tree length, as in TreeMaker but measured on the N × N sheet.

```math
m \in [0, \bar{m}]
```

**Leaf coordinates.** Integer coordinates, so each leaf sits on a grid point (C:1).

```math
x_i,\ y_i \in \mathbb{Z} \cap [0, N], \qquad u_i = (x_i, y_i) \qquad \forall\, i \in L
```

**Offset selectors.** For each leaf pair, one binary per candidate offset; C:2 and C:3 make the selected candidate equal the pair offset δᵢⱼ.

```math
w_{ij\delta} \in \{0, 1\} \qquad \forall\, \{i, j\} \in \mathcal{P},\ \delta \in \Delta_N
```

Each pair uses |Δ\_N| = (2N + 1)² − 1 selectors: 360 for N = 9, so 2,160 for the six pairs of the running example. Symmetry breaking adds no variables.

## 7. Constraints

C:1–C:4 are TreeMaker's model on the grid. C:5 and C:6 break its symmetry.

**C:1 Leaves on grid points.** Every leaf lies on a grid point of the fixed N × N sheet. This replaces TreeMaker's continuous unit square.

```math
u_i \in G_N \iff x_i,\ y_i \in \{0, 1, \dots, N\} \qquad \forall\, i \in L
```

**C:2 Offset selection.** Each pair selects exactly one candidate offset.

```math
\sum_{\delta \in \Delta_N} w_{ij\delta} = 1 \qquad \forall\, \{i, j\} \in \mathcal{P}
```

**C:3 Offset linking.** The selected candidate equals the pair offset, one equation per coordinate.

```math
\delta_{ij} = u_i - u_j = \sum_{\delta \in \Delta_N} \delta\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

**C:4 Spacing through the lookup table.** TreeMaker's pair constraint, with the distance read from the table entry of the selected candidate.

```math
m\, \ell_{ij} \leq \sum_{\delta \in \Delta_N} D(\delta)\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

&#91;embedded content: C:2–C:4 · offset selection, linking, and spacing for pair 2–4\]

For pair 2–4 of the running example, C:2 sets one selector to 1, C:3 makes that offset the leaves' actual difference, and C:4 reads its length from the lookup table.

&#91;embedded content: C:4 · every pair's distance against its minimum at m\* = 1.054\]

At the optimum every pair's grid distance reaches its required minimum, and pair 2–4 reaches it exactly: it is the tight pair that stops m from growing.

**C:5 Anchor in the fundamental domain.** The anchor leaf lies in the triangle 0 ≤ y ≤ x ≤ N/2.

```math
2 x_{r^\ast} \leq N, \qquad 2 y_{r^\ast} \leq N, \qquad y_{r^\ast} \leq x_{r^\ast}
```

**C:6 Sibling order.** Interchangeable siblings appear in lexicographic order of their coordinates.

```math
(N + 1)\, x_a + y_a \leq (N + 1)\, x_b + y_b \qquad \forall\, (a, b) \in \mathcal{T}
```

&#91;embedded content: C:5 and C:6 · anchor in the fundamental domain, siblings in order\]

On an 8 × 8 grid, an anchor leaf at (6, 1) has 8 images and only (2, 1) satisfies C:5; for two siblings, only the order with the smaller key first satisfies C:6. In the running example the optimal layout already has leaf 1 at (0, 0), inside the triangle, and 𝒯 is empty, so C:6 has no rows.

**Position and symmetry conditions.** TreeMaker's optional conditions (a leaf on an edge or a corner, a mirrored pair under book symmetry) stay linear on the grid, but they break the sheet's symmetry. With such conditions, C:5 must be dropped or limited to the symmetries the conditions keep, and C:6 kept only for siblings the conditions treat alike.

## 8. Objective

Maximize the scale, exactly as TreeMaker does. A larger m means longer flaps from the same sheet, so this maximizes paper usage. The model is C:1–C:6 with this objective, solved once.

```math
\max_{m,\, x,\, y,\, w} \quad m \qquad \text{subject to C:1–C:6}
```

At the optimum, m\* is set by the tight pairs (pairs exactly at their minimum distance).

```math
m^{*} = \max_{u \in G_N^{\,L}} \ \min_{\{i, j\} \in \mathcal{P}} \frac{D(u_i - u_j)}{\ell_{ij}}
```

For the running example, m\* = 0.949 on an 8 × 8 grid, 1.054 on 9 × 9, and 1.197 on 10 × 10, all confirmed by exhaustive search. If the tree must keep its stated proportions with integer flap lengths (m = 1), the smallest grid that allows it is N = 9.

## 9. Why it is exact

**C:1–C:4 are TreeMaker on the grid.** The candidates in Δ\_N are distinct and exactly one is selected, so C:2 and C:3 force w to pick the candidate equal to the pair offset δᵢⱼ. C:4 then reads its exact length, so the four constraints are TreeMaker's model restricted to grid points, with no approximation and no big-M constants. Excluding the zero offset also keeps two leaves off the same grid point.

```math
\text{C:1–C:4} \iff u_i \in G_N \ \ \forall\, i \in L \quad \text{and} \quad \|u_i - u_j\|_2 \geq m\, \ell_{ij} \ \ \forall\, \{i, j\} \in \mathcal{P}
```

**The sheet's symmetries keep every layout feasible.** Each symmetry g of the square maps grid points to grid points and keeps every distance. Applying g to all leaves maps each offset δ to its rotated or reflected image, which is again in Δ\_N and has the same table entry D. Selecting that image gives a solution of C:1–C:4 with the same scale m.

**Swapping interchangeable siblings keeps every layout feasible.** Two leaves a and b with the same parent and equal edge length have the same path length to every other leaf, and the pair {a, b} itself is unordered. Exchanging their positions, and the selectors of their pairs to match, gives a solution with the same scale.

**One copy always satisfies C:5 and C:6.** Every point of the square has an image in the fundamental domain, so some symmetry g puts the anchor leaf there. Sorting each group of interchangeable siblings by its key then satisfies C:6. The key (N + 1)x + y takes a different value at every grid point, and two leaves never share a grid point, so the order is strict. Sorting does not move the anchor, because P:4 keeps the anchor out of every sibling pair.

So every layout of C:1–C:4 has a copy with the same scale that also satisfies C:5 and C:6, and the optimum is unchanged: C:5 and C:6 are a valid tightening (constraints that remove only layouts with an equivalent copy left).

## 10. What symmetry breaking gains

**Fewer equivalent solutions.** Without C:5 and C:6, each layout can appear up to 8 times from the sheet's symmetries, and g! times more for each group of g interchangeable siblings. Branch-and-bound (the solver's search) can explore every copy, both while looking for good layouts and, more expensively, while proving that none is better. C:5 and C:6 keep one copy, so the search space shrinks by up to that factor.

```math
\text{copies removed per layout} \ \leq \ 8 \prod_{\text{sibling groups}} g!
```

The running example has no interchangeable siblings, so the factor there is at most 8.

**No change in size.** C:5 adds three rows and C:6 one row per sibling pair, with no new variables. The model still has (2N + 1)² − 1 binaries per leaf pair, 2,160 for the running example on the 9 × 9 grid.

**What it does not change.** The LP relaxation (the model with its integer requirements dropped) stays weak: a pair can still put half its weight on an offset δ and half on −δ, so the relaxation reaches the diagonal bound m̄ whatever the tree. Symmetry breaking speeds up the search; it does not tighten that bound. Translations of a layout with slack (room to spare at the sheet's edges) are not removed either.
