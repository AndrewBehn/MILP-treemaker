# Pure MILP TreeMaker

Oct 25, 2026 · @Andrew Behn

The goal of this document is a pure mixed-integer linear program (MILP) for TreeMaker's scale optimization: the same objective and the same spacing requirement, with every constraint linear. The fixed grid is how it gets there. Restricting the leaves to grid points turns TreeMaker's continuous positions and nonlinear distance constraints into a selection problem: each leaf selects a grid point, each pair selects the offset between its two leaves, and the distance is read from a precomputed lookup table. The grid is the only approximation, and it vanishes as the grid gets finer (Section 6).

The model builds on four foundation documents. The tree, the grid, the spacing condition and the scale are in [TreeMaker foundations: the tree, the sheet and spacing](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), the sheet spec. The candidate offsets and their lookup table are in [TreeMaker foundations: grid offsets](https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem), the offsets spec. The optional leaf conditions are in [TreeMaker foundations: leaf conditions and symmetry](https://claude.ai/artifact/3WP1SahWDm9pb5hs8Mhwp7), the conditions spec, and the strains of the follow-on stages are in [TreeMaker foundations: strain](https://claude.ai/artifact/Xr8Sus42zxf1wu68c1BMWt), the strain spec.

**Labels.** P:n, D:n and C:n number the parameters, definitions and constraints of this document, each kind in order of appearance. A foundation's labels carry its short name, as in sheet D:2, offsets D:1, conditions C:3 or strain P:1.

## 1. From TreeMaker to a pure MILP

**TreeMaker's scale optimization.** Lang's TreeMaker places the leaves of a weighted tree in the unit square and maximizes the scale m, the paper length per unit of tree length, subject to the spacing condition: every leaf pair is at least m times its path length apart (sheet D:2).

**The pure MILP version.** This model keeps TreeMaker's objective and pair constraints and makes them linear. The sheet becomes an N × N grid with N chosen in advance, and **every leaf must lie on a grid point**. That turns each leaf's continuous position into a choice among grid points, and each pair's nonlinear distance into a choice among offsets whose lengths are precomputed in a lookup table. What remains is a selection problem with linear constraints, solvable by any MILP solver.

**Leaves versus internal vertices.** Only leaves are placed (sheet Section 3), so this model puts no grid condition on internal vertices. Landing hinges on grid lines would be a crease-pattern requirement, which matters for styles such as box pleating but not for the scale optimization.

**Scale conversion.** TreeMaker's sheet has side 1 and this one has side N, so TreeMaker's scale is m/N (sheet D:2). As N grows, the lattice optimum approaches TreeMaker's continuous optimum (Section 6).

## 2. Notation

Notation follows the sheet spec (sheet Section 1). The model takes the inputs and sets below from the foundations, and the figures use the sheet spec's running example: the four-leaf tree on a 9 × 9 grid.

| Symbol | Meaning | Defined in |
| --- | --- | --- |
| T = (V, E), ℓₑ, N | The tree, its edge lengths and the grid size | sheet P:1–P:3 |
| L, n, 𝒫 | The leaves, their number and the leaf pairs | sheet Section 3 |
| G\_N, uᵢ = (xᵢ, yᵢ) | The grid points of the sheet, and the grid point of leaf i | sheet Section 3 |
| ℓᵢⱼ, ℓmax | The path length of a pair, and the largest one | sheet D:1 |
| m\*, m\_TreeMaker | The optimal scale, and TreeMaker's scale m/N | sheet D:2 |
| m̄ | The scale upper bound √2·N/ℓmax | sheet D:3 |
| δᵢⱼ | The offset uᵢ − uⱼ of a pair, with i < j | offsets Section 1 |
| Δ\_N | The candidate offsets, (2N + 1)² − 1 of them | offsets D:1 |
| D(δ) | The offset distance lookup table | offsets D:2 |

The terms below are added here.

| Symbol or term | Meaning |
| --- | --- |
| {0, 1} | The binary values; a variable in it is a binary (0/1) variable |
| LP relaxation | The model with its integer requirements dropped, so binary variables may take fractional values (Section 7) |
| Branch-and-bound | The search MILP solvers use: split on variables that come out fractional, and discard branches whose LP relaxation cannot beat the best layout found (Section 7) |

## 3. Variables

**Scale.** Grid units of paper per unit of tree length, as in TreeMaker but measured on the N × N sheet, and at most the scale bound m̄ of sheet D:3.

```math
m \in [0, \bar{m}]
```

**Leaf coordinates.** Integer coordinates, so each leaf sits on a grid point (constraint C:1).

```math
x_i,\ y_i \in \mathbb{Z} \cap [0, N], \qquad u_i = (x_i, y_i) \qquad \forall\, i \in L
```

**Offset selectors.** For each leaf pair, one binary per candidate offset of offsets D:1; C:2 and C:3 make the selected candidate equal the pair offset δᵢⱼ.

```math
w_{ij\delta} \in \{0, 1\} \qquad \forall\, \{i, j\} \in \mathcal{P},\ \delta \in \Delta_N
```

Each pair uses |Δ\_N| = (2N + 1)² − 1 selectors: 360 for N = 9, so 2,160 for the six pairs of the running example. This size is what the other layout specs avoid (Section 9).

## 4. Constraints

**C:1 Leaves on grid points.** The key constraint added to TreeMaker: every leaf lies on a grid point of the fixed N × N sheet. This replaces TreeMaker's continuous unit square.

```math
u_i \in G_N \iff x_i,\ y_i \in \{0, 1, \dots, N\} \qquad \forall\, i \in L
```

**C:2 Offset selection.** Each pair selects exactly one candidate offset.

```math
\sum_{\delta \in \Delta_N} w_{ij\delta} = 1 \qquad \forall\, \{i, j\} \in \mathcal{P}
```

**C:3 Offset linking.** The selected candidate equals the pair offset δᵢⱼ = uᵢ − uⱼ, one equation per coordinate.

```math
\delta_{ij} = u_i - u_j = \sum_{\delta \in \Delta_N} \delta\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

![C:2–C:4 · offset selection, linking, and spacing for pair 2–4](figures/pure/01.svg)

*C:2–C:4 · offset selection, linking, and spacing for pair 2–4*
For pair 2–4 of the running example, C:2 sets one selector to 1, C:3 makes that offset the leaves' actual difference, and C:4 reads its length from the lookup table.

**C:4 Spacing through the lookup table.** The spacing condition of sheet D:2, with the Euclidean distance read from the lookup table of offsets D:2 at the selected candidate.

```math
m\, \ell_{ij} \leq \sum_{\delta \in \Delta_N} D(\delta)\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

![C:4 · every pair's distance against its minimum at m\* = 1.054](figures/pure/02.svg)

*C:4 · every pair's distance against its minimum at m\* = 1.054*
At the optimum every pair's grid distance reaches its required minimum, and pair 2–4 reaches it exactly: it is the tight pair that stops m from growing.

**Exactness.** The candidates in Δ\_N are distinct and exactly one is selected, so C:2 and C:3 force w to pick the candidate equal to the pair offset δᵢⱼ. C:4 then reads its exact length, so the four constraints together are TreeMaker's model restricted to grid points, with no approximation and no big-M constants. Excluding the zero offset also keeps two leaves off the same grid point.

```math
\text{C:1–C:4} \iff u_i \in G_N \ \ \forall\, i \in L \quad \text{and} \quad \|u_i - u_j\|_2 \geq m\, \ell_{ij} \ \ \forall\, \{i, j\} \in \mathcal{P}
```

**Optional leaf conditions.** A design may pin flaps to chosen places on the sheet, or tie two flaps together as mirror images. Each such condition is one of conditions C:1–C:5, chosen through conditions P:1, and is linear in the leaf coordinates, so it joins C:1–C:4 without changing the kind of model. A condition only removes layouts, so it can lower m\* but never raise it. The conditions apply to every stage, including the follow-on stages of Section 8.

## 5. Objective

Maximize the scale, exactly as TreeMaker does. A larger m means longer flaps from the same sheet, so this maximizes paper usage.

```math
\max_{m,\, x,\, y,\, w} \quad m
```

At the optimum, m\* is set by the tight pairs (pairs exactly at their minimum distance), and their paths are the active paths, as in TreeMaker.

```math
m^{*} = \max_{u \in G_N^{\,L}} \ \min_{\{i, j\} \in \mathcal{P}} \frac{D(u_i - u_j)}{\ell_{ij}}
```

For the running example, m\* = 0.949 on an 8 × 8 grid, 1.054 on 9 × 9, and 1.197 on 10 × 10, all confirmed by exhaustive search (sheet D:2). If the tree must keep its stated proportions with integer flap lengths (m = 1), the smallest grid that allows it is N = 9.

## 6. Behavior as N grows

The grid is the only approximation in this model: the lookup table gives exact Euclidean distances at every N. As the grid gets finer, the model's optimum converges to TreeMaker's. Write m\*\_N for the optimum on the N × N grid and m\_TM for TreeMaker's optimum on the unit square. The two sheets differ in size by a factor of N, so they compare through m\*\_N / N (Section 1). Two bounds squeeze it.

**Upper bound: the grid cannot beat TreeMaker.** Shrinking any feasible grid layout by a factor of N gives a feasible TreeMaker layout, because the grid points land in the unit square and every distance and the scale shrink by the same factor.

```math
\|u_i - u_j\|_2 \geq m\, \ell_{ij},\ \ u_i \in [0, N]^2 \quad \Longrightarrow \quad \Big\| \frac{u_i}{N} - \frac{u_j}{N} \Big\|_2 \geq \frac{m}{N}\, \ell_{ij},\ \ \frac{u_i}{N} \in [0, 1]^2 \qquad \text{so} \qquad \frac{m^{*}_N}{N} \leq m_{\mathrm{TM}}
```

![upper bound · the 9 × 9 optimum shrunk into the unit square](figures/pure/03.svg)

*upper bound · the 9 × 9 optimum shrunk into the unit square*
**Lower bound: rounding TreeMaker's layout loses little.** Take TreeMaker's optimal layout v, scale it to the N × N sheet, and move each leaf to its nearest grid point uᵢ. Each leaf moves at most half a grid diagonal, so by the triangle inequality each pair distance shrinks by at most √2.

```math
\|u_i - N v_i\|_2 \leq \tfrac{\sqrt{2}}{2} \quad \Longrightarrow \quad \|u_i - u_j\|_2 \geq N \|v_i - v_j\|_2 - \sqrt{2} \geq N\, m_{\mathrm{TM}}\, \ell_{ij} - \sqrt{2}
```

![lower bound · TreeMaker's layout rounded onto the 9 × 9 grid](figures/pure/04.svg)

*lower bound · TreeMaker's layout rounded onto the 9 × 9 grid*
The rounded layout is therefore feasible at scale N·m\_TM − √2/ℓᵢⱼ for every pair, and the shortest leaf path ℓ\_min is the worst case. Once that scale is positive, no two rounded leaves coincide.

```math
m^{*}_N \geq N\, m_{\mathrm{TM}} - \frac{\sqrt{2}}{\ell_{\min}}, \qquad \ell_{\min} = \min_{\{i, j\} \in \mathcal{P}} \ell_{ij}
```

**The squeeze.** Dividing by N and combining the two bounds:

```math
m_{\mathrm{TM}} - \frac{\sqrt{2}}{N\, \ell_{\min}} \ \leq\ \frac{m^{*}_N}{N} \ \leq\ m_{\mathrm{TM}} \qquad \Longrightarrow \qquad \lim_{N \to \infty} \frac{m^{*}_N}{N} = m_{\mathrm{TM}}
```

The gap closes like 1/N, and the relative loss is at most √2 / (N·m\_TM·ℓ\_min), which says how fine a grid is fine enough for a given tree.

![the squeeze · m\*\_N / N for N = 2 to 16 between the two bounds](figures/pure/05.svg)

*the squeeze · m\*\_N / N for N = 2 to 16 between the two bounds*
**The layouts converge too.** The shrunken optimal layouts u/N all lie in the bounded, closed set \[0, 1\]²ⁿ, so they have convergent subsequences. The pair constraints are closed conditions, so every limit satisfies TreeMaker's constraints at scale m\_TM: it is a TreeMaker optimum. In that sense the model reduces to TreeMaker as N → ∞.

![the layouts converge · shrunken optima for N = 4, 8, and 16 against TreeMaker's layout](figures/pure/06.svg)

*the layouts converge · shrunken optima for N = 4, 8, and 16 against TreeMaker's layout*
**Refining the grid never hurts.** Doubling N puts every old grid point onto the new grid, with all distances doubled, so the scaled optimum cannot drop. Unrelated grid sizes need not improve in order: for the running example m\*\_N / N is 0.119 at N = 8, 0.117 at N = 9, and 0.120 at N = 10.

```math
m^{*}_{2N} \geq 2\, m^{*}_N
```

![refining never hurts · the N = 4 optimum embedded in the N = 8 grid](figures/pure/07.svg)

*refining never hurts · the N = 4 optimum embedded in the N = 8 grid*
**The cost of a finer grid.** Each pair has (2N + 1)² − 1 offset selectors, so the model grows quadratically in N. In practice N is chosen as a trade-off between the bound above and the model size.

![the cost of a finer grid · selectors per pair against the loss bound](figures/pure/08.svg)

*the cost of a finer grid · selectors per pair against the loss bound*
## 7. Cost trade-offs

The formulation buys linearity and exactness with size. Every nonlinear distance becomes a choice among precomputed offsets, so the number of integer variables, and with it the solve time, grows quickly with both the tree and the grid.

**Variable counts.** The leaf coordinates are few; the offset selectors dominate, with one binary per leaf pair per candidate offset.

```math
\underbrace{2n}_{\text{integer coordinates}} \;+\; \underbrace{\tfrac{n(n - 1)}{2} \big( (2N + 1)^2 - 1 \big)}_{\text{binary offset selectors}} \;+\; \underbrace{1}_{m} \;=\; O(n^2 N^2)
```

| Leaves n | Pairs | N = 9 | N = 16 | N = 32 |
| --- | --- | --- | --- | --- |
| 4 | 6 | 2,160 | 6,528 | 25,344 |
| 20 | 190 | 68,400 | 206,720 | 802,560 |
| 50 | 1,225 | 441,000 | 1,332,800 | 5,174,400 |

The count is quadratic in each direction: doubling the number of leaves or the grid size multiplies it by about four. The constraints are few, four rows per pair, but dense: each pair's C:2 and C:4 rows touch all (2N + 1)² − 1 of its selectors, so the constraint matrix has O(n²N²) nonzeros as well.

**Solve time.** The underlying problem is NP-hard (circle packing for origami design is hard even in its continuous form), and MILP solvers attack it with branch-and-bound. They solve the LP relaxation, the same model with the integer requirements dropped, use its value as a bound to discard branches, and branch on variables that come out fractional. How well that works depends on the problem, and three of this problem's properties work against it. None is a component of the model that could be left out; each is a limitation the solver meets.

- **The LP relaxation gives a weak bound.** In the relaxation, selectors may take fractional values. A pair can then put half its weight on an offset δ and half on −δ: C:3 sees an average offset of zero while C:4 still reads a long distance. Every leaf can sit on the same grid point, and the relaxation reaches the diagonal bound m̄ of sheet D:3 whatever the tree. This comes from the problem, not from a modelling choice: "far apart" is a nonconvex requirement, and averaging two far-apart placements gives a close one. Natural linear formulations share the weakness to some degree (the big-M constraints of Lattice-Hull MILP TreeMaker do too), so the solver must close the gap by branching.
- **Symmetry.** The square sheet has eight symmetries, a layout with slack (room to spare between leaves and the sheet's edges) can be translated, and interchangeable sibling leaves can swap. Each gives equal-valued solutions, and branch-and-bound explores every copy unless constraints cut them away.
- **Coupling.** Each leaf takes part in n − 1 pairs, so fixing one selector rarely settles the others, and branching makes slow progress.

As a rough guide, a handful of leaves on a grid of a dozen or so cells per side solves quickly, while trees with tens of leaves on fine grids are out of reach for this formulation as written; the exact boundary depends on the solver and the tree.

**Mitigations within this formulation.**

- **Prune offsets with a known scale.** Any feasible layout (one that meets every constraint) gives an achievable scale m\_L ≤ m\*, and every optimal layout then satisfies D(δᵢⱼ) ≥ m\_L·ℓᵢⱼ. Offsets shorter than that can be removed from Δ\_N pair by pair without losing an optimum. The rounded TreeMaker layout of Section 6 provides such a scale, and a starting solution.
- **Use the sign symmetry of the table.** D depends only on |δ₁| and |δ₂|, so selectors over (N + 1)² absolute offsets plus sign variables can replace the (2N + 1)² signed ones, at the cost of linearizing the signs.
- **Break symmetry.** Add conditions C:6 and C:7, which anchor one leaf in the fundamental domain and put interchangeable siblings in order; this is the symmetry-breaking model of Section 9.
- **Choose N deliberately.** Section 6's bound gives the coarsest grid whose relative loss √2 / (N·m\_TM·ℓ\_min) is acceptable.

These help by constant factors. Formulations that change the model itself start from the same foundations (Section 9).

## 8. Follow-on stages: edge and strain optimization

The model above keeps the tree's proportions and finds only its largest scale. TreeMaker refines a scale-optimized design in two further stages that let edges change length. Both carry over to the fixed grid unchanged in spirit: they keep C:1–C:3 and the lookup table, replace C:4, and hold the scale fixed so every constraint stays linear.

![the two follow-on stages · inputs and running-example results](figures/pure/09.svg)

*the two follow-on stages · inputs and running-example results*
### 8.1 Additional parameters

**P:1 Fixed scale.** For edge optimization, the optimum m\* of Section 5. For strain optimization, a target scale, typically larger than m\*, at which the tree does not fit unstrained.

```math
m_0 > 0
```

![P:1 · where each stage fixes the scale](figures/pure/10.svg)

*P:1 · where each stage fixes the scale*
**P:2 Stretch set.** The edges allowed to lengthen in edge optimization, for example the legs of an insect.

```math
S \subseteq E
```

**Strain bounds.** Strain optimization limits each edge's relative change by the strain bounds σmin and σmax of strain P:1.

![P:2 and strain P:1 · stretch set and allowed edge-length ranges](figures/pure/11.svg)

*P:2 and strain P:1 · stretch set and allowed edge-length ranges*
### 8.2 Edge optimization

**Variables.** The per-edge strains σₑ of strain optimization (8.3), tied to one common stretch σ: every edge in S lengthens by the same fraction, to the strained length ℓₑ(1 + σ) of strain D:1, and every other edge keeps its length. The leaf coordinates and offset selectors of Section 3 stay as they are.

```math
\sigma_e = \sigma \ \ \forall\, e \in S, \qquad \sigma_e = 0 \ \ \forall\, e \in E \setminus S, \qquad \sigma \geq 0
```

**D:1 Stretchable path length.** The part of a pair's path length that lies on edges in the stretch set. Only this part grows when the stretch set lengthens.

```math
s_{ij} = \sum_{e \in \mathrm{path}(i, j) \cap S} \ell_e \qquad \forall\, \{i, j\} \in \mathcal{P}
```

Used in: constraint C:5.

![stretch set S = {v–3} · stretchable path lengths and result](figures/pure/12.svg)

*stretch set S = {v–3} · stretchable path lengths and result*
**C:5 Stretched spacing.** Replaces C:4. It is the strained spacing C:6 of 8.3 with the strains above: a pair's strained path length ℓᵢⱼ(σ) of strain D:2 reduces to ℓᵢⱼ + σ·sᵢⱼ, so each pair's path grows by σ times its stretchable part (D:1), at the fixed scale.

```math
m_0 \Big( \ell_{ij} + \sum_{e \in \mathrm{path}(i, j)} \ell_e\, \sigma_e \Big) = m_0 \left( \ell_{ij} + \sigma\, s_{ij} \right) \leq \sum_{\delta \in \Delta_N} D(\delta)\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

![C:5 · layout before and after edge optimization](figures/pure/13.svg)

*C:5 · layout before and after edge optimization*
**Objective.** Make the chosen edges as long as the leftover paper allows.

```math
\max \quad \sigma \qquad \text{subject to C:1–C:3 and C:5}
```

![C:5 · every pair against its stretched minimum at σ\* = 0.320](figures/pure/14.svg)

*C:5 · every pair against its stretched minimum at σ\* = 0.320*
The stage-one layout with σ = 0 is feasible, so it is a ready starting solution. Pairs with sᵢⱼ = 0 keep C:4 at scale m₀. If an edge of S lies on a pair that was binding (exactly at its minimum distance) in stage one, it may not be able to grow at all.

Edge optimization is therefore strain optimization restricted to one common, nonnegative strain on S, and that strain is maximized rather than kept small.

### 8.3 Strain optimization

**Variables.** One strain per edge, now independent and signed, which changes edge e to its strained length ℓₑ(1 + σₑ) of strain D:1, with its magnitude for the objective, plus the leaf coordinates and offset selectors of Section 3. Each strain stays within the strain bounds of strain P:1, which are the edge bounds of strain D:3 with every room 1.

```math
\sigma_e \in [\sigma_{\min}, \sigma_{\max}], \qquad a_e \geq 0 \qquad \forall\, e \in E
```

**C:6 Strained spacing.** Replaces C:4. Each pair's path length becomes its strained path length ℓᵢⱼ(σ) of strain D:2, which is linear in the strains.

```math
m_0\, \ell_{ij}(\sigma) = m_0 \left( \ell_{ij} + \sum_{e \in \mathrm{path}(i, j)} \ell_e\, \sigma_e \right) \leq \sum_{\delta \in \Delta_N} D(\delta)\, w_{ij\delta} \qquad \forall\, \{i, j\} \in \mathcal{P}
```

![C:6 · optimal strained layout and strain per edge at m₀ = 1.2](figures/pure/15.svg)

*C:6 · optimal strained layout and strain per edge at m₀ = 1.2*
**C:7 Strain magnitude.** Each aₑ is at least the absolute value of its strain.

```math
a_e \geq \sigma_e, \qquad a_e \geq -\sigma_e \qquad \forall\, e \in E
```

![C:7 · two rows that linearize |σₑ|](figures/pure/16.svg)

*C:7 · two rows that linearize |σₑ|*
**Objective.** Make the tree fit at the target scale with as little total strain as possible.

```math
\min \quad \sum_{e \in E} a_e \qquad \text{subject to C:1–C:3, C:6, and C:7}
```

![strain objective · every pair against its minimum with and without strain at m₀ = 1.2](figures/pure/17.svg)

*strain objective · every pair against its minimum with and without strain at m₀ = 1.2*
TreeMaker minimizes the sum of squared strains instead. SCIP can solve that convex quadratic objective too, but the absolute-value form keeps the model a MILP. Minimizing the largest strain (a\_max ≥ aₑ for every edge, then minimize a\_max) spreads the distortion evenly instead. With only spacing constraints, lengthening an edge never helps, so optimal strains are zero or negative unless leaf conditions (conditions C:1–C:5) force otherwise. If m₀ ≤ m\*, the optimum is zero strain.

## 9. From this model to the symmetry-breaking model

[Symmetry-Breaking MILP TreeMaker](https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN) builds on this model. It keeps the variables, constraints and objective, and adds conditions C:6 and C:7: one leaf anchored in the fundamental domain of the square, and interchangeable siblings in order. Each layout then appears once instead of up to 8 times, and the optimum is unchanged (conditions Lemma 1).

The other layout specs start from the same foundations rather than from this model: Lattice-Hull MILP TreeMaker, with Optimized MILP TreeMaker after it, and Scalable MILP TreeMaker. They meet the spacing condition of sheet D:2 without one selector per candidate offset, the size that Section 7 counts.
