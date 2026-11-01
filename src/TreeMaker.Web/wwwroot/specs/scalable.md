# Scalable MILP TreeMaker: model and algorithm specification

Oct 28, 2026 · @Andrew Behn

This document specifies a method for TreeMaker's grid circle-packing problem at 25 to 100 or more leaves. It covers the models, the algorithms that solve them, the parameters, and what the output guarantees. It solves the same problem as the [Pure MILP TreeMaker](https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4) specification (the *base spec*), under the same hard constraints. It also reuses that spec's polygon test and crease-pattern construction. The [Optimized MILP TreeMaker](https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq) specification (the *optimized spec*) proves m\* exactly, at a cost that grows exponentially with the number of leaves. This method does not prove m\*.

**What it computes.** It returns a grid layout u, its exact scale m(u), and edge lengths ℓ′. Every pair constraint and leaf condition holds at m(u) with lengths ℓ′. It also reports whether the tight pairs at (u, m(u), ℓ′) form valid polygons.

**How.** Four stages run in order. Each stage solves only models that are *local*: every leaf is confined to a small window, and a pair enters a model only if its windows can collide.

| Stage | Model | Problem class | Section |
| --- | --- | --- | --- |
| 1. Continuous layout | Linearized scale problem LP(u, ρ), solved repeatedly | LP | 3 |
| 2. Round and repair | Window model W(m, c, h), bisection over candidate scales | Pure Boolean (CP) | 4, 5 |
| 3. Neighbourhood search | W(m′, u, h) with a leaf-dependent h | Pure Boolean (CP) | 6 |
| 4a. Tight contacts | W(m, u, 1) with a weighted tight-pair objective | Boolean optimization (CP) | 7 |
| 4b. Closing | Closing MILP over positions and strains, then a polish LP | MILP, LP | 8 |

**Guarantees in brief.** The layout is feasible at the reported scale, the reported scale is exact, and m(u) ≤ m̄. Nothing bounds m\* − m(u), and valid polygons are not guaranteed. Section 10 gives the precise properties.

**Notation.** Labels P:, D:, M: and A: number parameters, definitions, model constraints and algorithms, in order of appearance. Definitions used in more than one place are in Section 2. A definition used in one place only is given there. The tree, grid and leaf conditions are as in the base spec.

## 1. Inputs and parameters

**Problem inputs** (as in the base spec):

- **P:1** A tree with vertex set V, edge set E and lengths ℓₑ > 0, and leaf set 𝓛 with n = |𝓛| ≥ 2.
- **P:2** Grid size N ≥ 1. Leaves take points of G = {0, …, N}².
- **P:3** Leaf conditions: for leaf i, an allowed set Aᵢ ⊆ G. It is one of an edge, a corner, the axis 2x = N (N even), or a fixed point. With no condition, Aᵢ = G.
- **P:4** Mirror pairs 𝓜 ⊆ 𝓛 × 𝓛: for (a, b) ∈ 𝓜, x\_a + x\_b = N and y\_a = y\_b.
- **P:5** Strain bounds σ\_min ∈ (−1, 0\] and σ\_max ≥ 0, used only by Stage 4b. Defaults: −0.3 and 0.3.

**Algorithm parameters**, with defaults:

| Label | Meaning | Default |
| --- | --- | --- |
| P:6 | K, number of Stage 1 starts | 4 |
| P:7 | I\_max, most LPs per start | 200 |
| P:8 | ρ₀, initial trust radius; growth and shrink factors | N/4; ×1.5 up to N/2; ÷2 |
| P:9 | ρ\_min, Stage 1 stopping radius | 10⁻³ |
| P:10 | h\_R, repair half-width | 1 |
| P:11 | h\_C, Stage 3 half-width for colliding leaves; h\_N for their neighbours; h\_S for subtree leaves | 3; 1; 2 |
| P:12 | κ, neighbour radius factor | 1.5 |
| P:13 | s₀, s\_max, Stage 3 initial and largest relative step | 0.02; 0.08 |
| P:14 | F\_max, consecutive Stage 3 failures before stopping | 4 |
| P:15 | R\_max, Stage 4b rounds | 3 |
| P:16 | T, total time budget | 60 s |
| P:17 | Switches: Stage 3, subtree neighbourhoods, Stage 4a, Stage 4b | all on |
| P:18 | Random seed for the jittered starts | 1 |

Per-solve time caps follow from T (Section 9).

## 2. Shared definitions

- **D:1 Pairs and paths.** 𝓟 = {(i, j) : i, j ∈ 𝓛, i < j}, with P = |𝓟| = n(n − 1)/2. Eᵢⱼ is the set of edges on the tree path from i to j. Given lengths ℓ (the input lengths unless stated), ℓᵢⱼ = Σ\_{e ∈ Eᵢⱼ} ℓₑ.
- **D:2 Exact scale.** For points u (on or off the grid), m(u; ℓ) = min\_{(i,j) ∈ 𝓟} ‖uᵢ − uⱼ‖₂ / ℓᵢⱼ. A layout is *feasible at m* when m(u; ℓ) ≥ m.
- **D:3 Upper bound.** m̄ = √2 · N / max ℓᵢⱼ. Every feasible layout satisfies m(u) ≤ m̄.
- **D:4 Forbidden limit.** For a required distance r > 0: L(r) = r² − 1 if |r² − round(r²)| ≤ 10⁻⁹·max(1, r²), and ⌊r²⌋ otherwise. A grid offset (dx, dy) violates pair (i, j) at scale m exactly when dx² + dy² ≤ L(mℓᵢⱼ).
- **D:5 Tight.** On the grid, a pair at squared distance q is tight at m when |q − (mℓᵢⱼ)²| ≤ 10⁻⁹·max(1, (mℓᵢⱼ)²). In reports, with real-valued lengths, the base spec's test applies: |d − mℓᵢⱼ| ≤ 10⁻⁶·max(1, d).
- **D:6 Candidate scales.** Let Q\_N = {x² + y² : 0 ≤ x ≤ y ≤ N, x + y > 0} and let Λ be the set of distinct values ℓᵢⱼ. Then 𝒞\[lo, hi\] = {√q / ℓ : q ∈ Q\_N, ℓ ∈ Λ, lo ≤ √q/ℓ ≤ hi}, sorted ascending, with values within a relative 10⁻¹² merged. Every grid layout's exact scale lies in 𝒞\[0, m̄\], because some pair attains the minimum in D:2.
- **D:7 Windows.** Given centres cᵢ ∈ G and half-widths hᵢ ≥ 0: Wᵢ = {a ∈ Aᵢ : ‖a − cᵢ‖∞ ≤ hᵢ}. A leaf with hᵢ = 0 is *fixed*, and a leaf with hᵢ > 0 is *free*.
- **D:8 Relevant pairs.** gᵢⱼ = max(0, |cᵢₓ − cⱼₓ| − hᵢ − hⱼ)² + max(0, |cᵢᵧ − cⱼᵧ| − hᵢ − hⱼ)² is the smallest squared distance the two window boxes allow. Then ℛ(m, c, h) = {(i, j) ∈ 𝓟 : gᵢⱼ ≤ L(mℓᵢⱼ)}. A pair outside ℛ cannot be violated by any choice from the windows.
- **D:9 Triangulation targets.** Tri(u, K) is the greedy triangulation of the points u that keeps the pairs K. Start from K, then take all pairs in order of squared distance (ties broken by leaf names). Add a pair if no other leaf lies on its segment and it does not properly cross a segment already taken.
- **D:10 Boundary weights.** A pair is a *boundary pair* when both its leaves lie on one edge of the convex hull of u. For a target set T, the weight is wₚ = |T| + 1 for a boundary pair and wₚ = 1 otherwise, so one boundary pair outweighs all interior pairs together.
- **D:11 Polygon validity.** V(u, m, ℓ) is true when the tight pairs at (u, m, ℓ) pass the base spec's active-path test: their planar network splits the leaves' convex hull into convex faces, each bounded by tight paths, with no leaf inside, covering the hull, and with every hull boundary piece tight.

## 3. Stage 1: continuous layout

Stage 1 approximately solves the continuous relaxation of the problem, which drops the grid:

**(CR)** maximize m over v ∈ ℝ^{2n}, m ≥ 0, subject to ‖vᵢ − vⱼ‖₂ ≥ mℓᵢⱼ for all (i, j) ∈ 𝓟, vᵢ ∈ box(Aᵢ), and the mirror equalities of P:4.

Here box(Aᵢ) is the smallest axis-aligned box that contains Aᵢ. CR is nonconvex.

### 3.1 The linearized model LP(u, ρ)

Given a current point u and a trust radius ρ > 0, let d̂ᵢⱼ = (uᵢ − uⱼ)/‖uᵢ − uⱼ‖. When uᵢ = uⱼ, d̂ᵢⱼ = (1, 0).

- **Variables:** vᵢ = (xᵢ, yᵢ) for i ∈ 𝓛, and m ≥ 0.
- **Objective:** maximize m.
- **M:1 (spacing)** d̂ᵢⱼ · (vᵢ − vⱼ) − ℓᵢⱼ·m ≥ 0 for all (i, j) ∈ 𝓟.
- **M:2 (bounds)** each coordinate of vᵢ lies within box(Aᵢ) and within \[uᵢ − ρ, uᵢ + ρ\]. If uᵢ lies inside its box, the intersection is never empty.
- **M:3 (mirror)** x\_a + x\_b = N and y\_a − y\_b = 0 for (a, b) ∈ 𝓜.

The model has 2n + 1 variables, P + 2|𝓜| rows and 5P + 4|𝓜| nonzeros.

**Lemma 1 (inner approximation).** By Cauchy–Schwarz, ‖vᵢ − vⱼ‖ ≥ d̂ᵢⱼ · (vᵢ − vⱼ), so every feasible (v, m) of LP(u, ρ) has m(v) ≥ m. If u satisfies M:3 and lies in its boxes, then (u, m(u)) is feasible for LP(u, ρ), so the LP optimum is at least m(u).

### 3.2 A:1 Sequential linear programming

Input: a start u⁰, and a time cap τ₁ per start.

1. Set u ← u⁰, m ← m(u), ρ ← ρ₀, k ← 0.
2. While k < I\_max, ρ ≥ ρ\_min, and time is left:
   1. Solve LP(u, ρ) and set k ← k + 1. If it is not solved to optimality, set ρ ← ρ/2 and repeat.
   2. Let v be the LP's positions and m′ = m(v).
   3. If m′ > m(1 + 10⁻⁹): set u ← v, m ← m′ and ρ ← min(N/2, 1.5ρ). Otherwise set ρ ← ρ/2.
3. Return (u, m).

**Lemma 2 (monotone).** The values of m produced by A:1 never decrease, by Lemma 1.

**Lemma 3 (stationarity).** Suppose A:1 stalls with ρ → 0 at u, and u is a point where the active pairs are separated. Each M:1 row then has the same value and gradient at u as the true constraint ‖vᵢ − vⱼ‖ ≥ mℓᵢⱼ, so u satisfies the KKT conditions of CR. A:1 is a local method: its result depends on the start.

### 3.3 A:2 Starts

**D:12 Depth-first order.** π is the order in which a depth-first traversal from the first leaf meets the leaves.

Place the leaves in order π at evenly spaced arc lengths tₖ = (4N·k/n + δ) mod 4N, k = 0, …, n − 1, along the sheet's border, which is parameterized counter-clockwise from (0, 0).

- Start 1 uses δ = 0.
- Starts 2 to K draw δ uniformly from \[0, 4N/n) and add independent N(0, (N/10)²) noise to each coordinate.
- Every point is then clamped into box(Aᵢ).
- For each (a, b) ∈ 𝓜, set u\_b ← (N − x\_a, y\_a).

Run A:1 from each start and keep the result with the largest m. Call it (u^c, m\_c).

## 4. The window model W(m, c, h)

Stages 2, 3 and 4a all use one model. Its inputs are a trial scale m, centres cᵢ ∈ G and half-widths hᵢ ∈ ℤ≥0, which give windows Wᵢ by D:7.

**Variables.** One Boolean yᵢₐ for each i ∈ 𝓛 and a ∈ Wᵢ. Leaf i sits at a when yᵢₐ = 1.

**Constraints.**

- **M:4 (one point)** Σ\_{a ∈ Wᵢ} yᵢₐ = 1 for every i.
- **M:5 (spacing table)** For every (i, j) ∈ ℛ(m, c, h) and every a ∈ Wᵢ, let Fᵢⱼ(a) = {b ∈ Wⱼ : ‖a − b‖² ≤ L(mℓᵢⱼ)}. Then yᵢₐ ⇒ ⋀\_{b ∈ Fᵢⱼ(a)} ¬yⱼ\_b. When Fᵢⱼ(a) = Wⱼ, this reduces to the unit clause ¬yᵢₐ. When Fᵢⱼ(a) is empty, there is no row.
- **M:6 (mirror)** For every (a, b) ∈ 𝓜 and p ∈ W\_a: y\_{a,p} ⇒ ⋁ {y\_{b,q} : q ∈ W\_b, q = (N − pₓ, pᵧ)}. When no such q exists, this is the unit clause ¬y\_{a,p}.

Pairs outside ℛ get no constraint (D:8). In particular, pairs of two fixed leaves are omitted unless they collide, in which case M:5 makes the model infeasible.

**Answer.** The model is a pure Boolean satisfaction problem. A solution gives the layout uᵢ = the a with yᵢₐ = 1, and that layout is feasible at m (Lemma 4). An infeasibility proof means *no layout inside these windows* is feasible at m. It says nothing about layouts outside them.

**Lemma 4.** Every solution of W(m, c, h) is feasible at m. Pairs in ℛ are covered by M:5. Pairs outside ℛ have gᵢⱼ > L(mℓᵢⱼ), so every choice from the windows keeps them apart by D:4.

**Optional objective (Stage 4a).** Given targets T ⊆ 𝓟 with weights wₚ, add a Boolean tₚ for each p = (i, j) ∈ T, the rows below, and the objective maximize Σ wₚ tₚ.

- **M:7 (tight target)** For each a ∈ Wᵢ, let Hₚ(a) = {b ∈ Wⱼ : (a, b) tight at m by D:5}. Then (tₚ ∧ yᵢₐ) ⇒ ⋁\_{b ∈ Hₚ(a)} yⱼ\_b. When Hₚ(a) is empty, this is the clause ¬tₚ ∨ ¬yᵢₐ.

**Size.** The model has Σᵢ |Wᵢ| ≤ n(2h + 1)² Booleans, plus |T| with the objective. It has n rows for M:4, at most Σ\_{(i,j) ∈ ℛ} |Wᵢ| rows for M:5, Σ\_{(a,b) ∈ 𝓜} |W\_a| rows for M:6, and Σ\_{p ∈ T} |Wᵢ| rows for M:7. All coefficients are integers, and no tolerance enters the model except D:4 and D:5, which are evaluated exactly on integer squared distances.

**Solving.** Any complete CP or SAT solver can be used. The reference choice is CP-SAT, with a time cap. For Stage 4a, the current layout is passed as a solution hint.

## 5. Stage 2: rounding and repair

### A:3 Round and repair

Input: (u^c, m\_c) from Stage 1.

1. **Centres.** For each leaf, cᵢ = round(clamp(u^cᵢ, box(Aᵢ))), taken componentwise. If cᵢ ∉ Aᵢ, use the point of Aᵢ nearest to it by search over growing ℓ∞ rings. For each (a, b) ∈ 𝓜, set c\_b ← (N − c\_{a,x}, c\_{a,y}) when that point is in A\_b.
2. **Ladder.** Let m\_top = min(m\_c, m̄) and Μ = 𝒞\[m\_top/2, m\_top\] = (μ₀ < … < μ\_{K−1}).
3. **Bisection.** hᵢ = h\_R for all i, and lo ← −1, hi ← K − 1. Invariant: a layout is known at μ\_lo (none yet when lo = −1), and W(μ, c, h) is infeasible for every μ above μ\_hi.
   - While lo < hi: set mid = ⌈(lo + hi)/2⌉ and solve W(μ\_mid, c, h).
   - If it is feasible, set lo ← mid and keep its layout.
   - If it is proved infeasible, set hi ← mid − 1.
   - If it is undecided (time cap or cancellation), stop the bisection.
4. **Fallback.** If no layout is known, solve W(m\_top/2·(1 − 10⁻⁹), c, h\_R + 2) once. If that also fails, the method stops with *no layout found*.
5. **Output** the layout u and its exact scale m = m(u). By Lemma 4, m ≥ μ\_lo, and m may exceed it.

The bisection takes at most ⌈log₂(K + 1)⌉ solves. Monotonicity in μ holds for a fixed window: a layout feasible at μ is feasible at every μ′ < μ, because L(·) is nondecreasing. So the bisection finds the largest ladder value at which the windows admit a layout, up to undecided tests.

## 6. Stage 3: neighbourhood search

Stage 3 aims above the current scale. Each attempt re-solves the window model with only the leaves that are in the way free to move.

- **D:13 Colliding leaves.** B(u, m) = {i : ∃ j with ‖uᵢ − uⱼ‖² ≤ L(mℓᵢⱼ)}.
- **D:14 Subtrees.** Removing an edge (x, y) splits the tree. Let S(x → y) be the leaves on y's side. The family 𝒮 is the distinct sets S(x → y) over both orientations of every edge, with 2 ≤ |S| ≤ max(2, ⌊n/2⌋).

**Neighbourhoods.** Given the current layout u and a target m′ > m(u), with B = B(u, m′) (D:13):

- **Collision neighbourhood** 𝑁\_C(u, m′): hᵢ = h\_C for i ∈ B; hᵢ = h\_N for i ∉ B with ‖uᵢ − u\_b‖ ≤ κ·m′·ℓᵢ\_b for some b ∈ B; and hᵢ = 0 otherwise.
- **Subtree neighbourhood** 𝑁\_S(S): hᵢ = h\_S for i ∈ S and hᵢ = 0 otherwise, for a subtree S ∈ 𝒮 (D:14).

Both are centred at u.

### A:4 Large neighbourhood search

Input: a layout u with m = m(u). State: step s ← s₀, failures f ← 0, rotation counter r ← 0.

1. While f < F\_max and time is left:
   1. **Target.** Let C = {μ ∈ 𝒞\[m, min(m̄, m(1 + s))\] : μ > m(1 + 10⁻¹²)}.
      - If C is empty: stop if m(1 + s) ≥ m̄, otherwise set s ← 2s and repeat.
      - Otherwise set m′ ← max C.
   2. **Neighbourhood.** If f is odd and subtree neighbourhoods are on, let 𝒮\_B be the sets of 𝒮 that meet B(u, m′), sorted by size, falling back to 𝒮 when none meets it. Use 𝑁\_S(𝒮\_B\[r mod |𝒮\_B|\]) and set r ← r + 1. Otherwise use 𝑁\_C(u, m′).
   3. **Solve** W(m′, u, h) with the chosen h.
   4. **Accept or reject.**
      - If it is feasible: u ← its layout, m ← m(u), f ← 0, s ← min(s\_max, 1.5s).
      - Otherwise: f ← f + 1, and if f is even, s ← max(10⁻⁶, s/3).
2. Return u.

**Lemma 5.** Every accepted layout is feasible at m′ > m (Lemma 4), so m(u) strictly increases with each acceptance. It is bounded by m̄ and takes values in the finite set 𝒞\[0, m̄\], so A:4 terminates even without a time cap.

Fixed leaves contribute only through their pairs with free leaves. In M:5 these become unit clauses on the free leaf's window. A pair of two fixed leaves either already fits at m′ and is left out by D:8, or collides and makes the model infeasible at once. The second case arises in a subtree neighbourhood that does not contain both leaves of a colliding pair, and counts as a failure.

## 7. Stage 4a: tight-contact maximization

At the scale m that Stage 3 reached, many grid layouts are feasible. Stage 4a picks one, near u, with as many exactly tight targets as possible, weighting the hull boundary first.

### A:5 Most tight pairs

Input: a layout u with m = m(u), and the input lengths ℓ.

1. Let K be the pairs tight at (u, m, ℓ) by D:5, and let T = Tri(u, K) (D:9), with weights wₚ from D:10.
2. Solve W(m(1 − 10⁻¹²), u, 1) with the objective of M:7 over T, using u as a hint. The factor 1 − 10⁻¹² keeps the pair that defines m allowed when L is evaluated in floating point.
3. Let u′ be the best solution found. Accept u′ when m(u′) ≥ m(1 − 10⁻⁹) and the number of pairs tight at (u′, m, ℓ) is at least |K|. Otherwise keep u.

The scale used afterwards is still the m of step 1. Because u′ is feasible at m(1 − 10⁻¹²), it is feasible at m to within that tolerance, and the final check in Section 9 re-verifies it exactly.

**Remark.** For a tight pair, ‖a − b‖² = (mℓᵢⱼ)² must hold for whole numbers on the left. When the ℓᵢⱼ are pairwise incommensurate, as with random real lengths, typically only the pairs that define m can be tight, and A:5 can gain nothing. With commensurate lengths, such as whole numbers, it can gain many.

## 8. Stage 4b: closing with moving leaves

Stage 4b runs only when V(u, m, ℓ) is false. It changes edge lengths by strains σₑ while every leaf may still move by one grid step. The aim is to make the triangulation targets tight. The scale m stays fixed. Lengths are kept relative to the input lengths ℓ⁰, so after several rounds the total strain still lies within \[σ\_min, σ\_max\].

### 8.1 The closing model CM(u, ℓ, m)

Inputs: the current layout u, the current lengths ℓ (ℓ = ℓ⁰ in the first round), the scale m, and windows Wᵢ = Wᵢ(uᵢ, 1).

Derived quantities:

- Per-edge strain bounds loₑ = min(0, (1 + σ\_min)·ℓ⁰ₑ/ℓₑ − 1) and hiₑ = max(0, (1 + σ\_max)·ℓ⁰ₑ/ℓₑ − 1).
- Targets T = Tri(u, K), where K is the pairs tight now, with weights wₚ (D:10).
- For each pair, distances d(a, b) = ‖a − b‖₂ over a ∈ Wᵢ and b ∈ Wⱼ, with extremes d⁻ᵢⱼ and d⁺ᵢⱼ.
- Mᵢⱼ = m·Σ\_{e ∈ Eᵢⱼ} ℓₑ(1 + hiₑ), the largest required distance any strain allows.

**Variables.**

- yᵢₐ ∈ {0, 1} for each window point.
- σₑ ∈ \[loₑ, hiₑ\] and αₑ ≥ 0 for each edge.
- tₚ ∈ {0, 1} for each target.

Write ℓ′ᵢⱼ(σ) = Σ\_{e ∈ Eᵢⱼ} ℓₑ(1 + σₑ). It is linear in σ.

**Constraints.**

- **M:8 (one point)** Σₐ yᵢₐ = 1 for every i.
- **M:9 (fit)** For every pair with d⁻ᵢⱼ ≤ Mᵢⱼ, or that is a target, and every a ∈ Wᵢ: mℓ′ᵢⱼ(σ) ≤ Σ\_{b ∈ Wⱼ} d(a, b)·yⱼ\_b + Mᵢⱼ(1 − yᵢₐ).
- **M:10 (tight)** For every target p = (i, j) and every a ∈ Wᵢ, with Γₚ = d⁺ᵢⱼ + 1: mℓ′ᵢⱼ(σ) ≥ Σ\_b d(a, b)·yⱼ\_b − Γₚ(1 − yᵢₐ) − Γₚ(1 − tₚ).
- **M:11 (absolute strain)** αₑ ≥ σₑ and αₑ ≥ −σₑ.
- **M:12 (mirror)** Σ\_p pₓ·y\_{a,p} + Σ\_q qₓ·y\_{b,q} = N and Σ\_p pᵧ·y\_{a,p} − Σ\_q qᵧ·y\_{b,q} = 0 for every (a, b) ∈ 𝓜.

Because exactly one yⱼ\_b is 1, Σ\_b d(a, b)·yⱼ\_b is the chosen distance. With yᵢₐ = 1, M:9 is the spacing requirement, and M:9 with M:10 under tₚ = 1 makes the pair exactly tight. With yᵢₐ = 0, M:9 holds because mℓ′ᵢⱼ ≤ Mᵢⱼ, and M:10 holds because its right side is at most d⁺ − Γ < 0. A pair left out of M:9 has d⁻ᵢⱼ > Mᵢⱼ, so no point choice and no strain can violate it.

**Objective.** Maximize Σₚ wₚ tₚ − ε·Σₑ αₑ, with ε = 0.5 / (|E|·maxₑ max(−loₑ, hiₑ)). The strain term totals less than one, so it can never cost a target.

### 8.2 The polish LP

CM's big-M rows meet their equalities only to the MILP's feasibility tolerance, which is too loose for D:5. So, with the new points u′ fixed and T\* = {p : tₚ = 1}, re-solve for strains with no position variables. This is the base spec's closing problem, with targets T\* and common bounds \[maxₑ loₑ, minₑ hiₑ\]: first maximize the number of targets in T\* made tight, then minimize Σ|σₑ| keeping that number. Accept the polished lengths when they violate no pair and either make the polygons valid or keep at least as many tight pairs as the MILP's own lengths.

### A:6 Closing rounds

1. If V(u, m, ℓ⁰) holds, return u and ℓ⁰.
2. For r = 1, …, R\_max, while time is left:
   1. Build and solve CM(u, ℓ, m) with a time cap of 0.8 of this round's share. If no solution is found, stop.
   2. Read u′ and ℓ′ₑ = ℓₑ(1 + σₑ), with |σₑ| < 10⁻⁹ rounded to 0. Polish (8.2) within 0.2 of the share.
   3. If (u′, m, ℓ′) violates any pair or leaf condition when checked exactly, reject the round and stop.
   4. Set u ← u′ and ℓ ← ℓ′. If V(u, m, ℓ) holds, stop.
3. Return u and ℓ. The strains relative to the input are ℓₑ/ℓ⁰ₑ − 1.

The share of round r is (remaining Stage 4b time)/(R\_max − r + 1). Each round re-triangulates, because the points may have moved.

## 9. The pipeline

### A:7 Scalable TreeMaker

Input: P:1 to P:18. Let t be the time used so far and T′ = T − t the time left.

1. **Stage 1.** Run A:2 and A:1 for starts k = 1, …, K, with τ₁ = 0.2T per start. Skip later starts once t > 0.25T. The result is (u^c, m\_c).
2. **Stage 2.** Run A:3 with each W solve capped at min(20 s, T′). If it finds no layout, return *no layout found*.
3. **Stage 3** (if on). Run A:4 with each W solve capped at min(10 s, T′). Stop when T′ < 1 s.
4. **Stage 4a** (if on, and T′ ≥ 1 s). Run A:5 with a cap of min(20 s, T′).
5. **Stage 4b** (if on, V false, and T′ ≥ 1 s). Run A:6 with a total cap of min(20 s, T′).
6. **Verify.** Recompute m(u; ℓ′) and check every pair at m with lengths ℓ′, every leaf condition and every mirror pair, with exact distances. Recompute V(u, m, ℓ′).

**Output.**

- The layout u.
- The scale m from Stage 3, or Stage 2 if Stage 3 is off.
- The lengths ℓ′ and strains ℓ′ₑ/ℓ⁰ₑ − 1, which are all 0 unless Stage 4b changed them.
- The flag V.
- The reference values m\_c and m̄.
- The pairs tight before and after Stage 4a.
- A trace of every solve: stage, kind, scale, outcome, number of free leaves, variables, rows and time.
- Any violation found in step 6. There should be none.

If the run is cancelled or T runs out, every stage that has a layout returns its best layout so far, and steps 6 and the output still apply.

## 10. Correctness properties

| Property | Status | Reason |
| --- | --- | --- |
| The output layout is feasible at m with lengths ℓ′, and satisfies every leaf condition and mirror pair | Guaranteed | Lemma 4, A:6 step 2.3, and the exact check in A:7 step 6 |
| m is the exact scale of the layout Stage 3 returns, and the final layout attains at least m | Guaranteed | It is computed by D:2 from integer points |
| Stages 3 and 4 never lower the scale | Guaranteed | Lemma 5; A:5 and A:6 keep m fixed and keep the spacing rows |
| m ≤ m̄ | Guaranteed | D:3. It is usually very loose |
| m\_c ≥ m\* | **Not** guaranteed | A:1 finds a local optimum (Lemma 3). m\_c is only a reference value. A global optimum of CR would bound m\* from above |
| Infeasibility of W(μ, c, h) implies m\* < μ | **Not** guaranteed | It excludes only layouts inside the windows |
| V(u, m, ℓ′) holds | **Not** guaranteed | It is reported. Sections 7 and 8 only try to achieve it |
| Termination | Guaranteed | Every loop is bounded: I\_max, the ladder length, Lemma 5, R\_max, and T |

The method therefore certifies a layout and its scale, but no gap to m\*. A certificate needs a proof that no layout exists at the next candidate above m. In general that is the optimized spec's full-grid feasibility test, whose cost this method exists to avoid.

## 11. Model sizes and reference results

### 11.1 Sizes

Write n for the number of leaves, P = n(n − 1)/2, w = (2h + 1)² for the window size, and R for the relevant pairs (D:8).

| Model | Variables | Rows |
| --- | --- | --- |
| LP(u, ρ) | 2n + 1 continuous | P + 2·#𝓜 |
| W(m, c, h) | ≤ n·w Booleans, plus #T with the objective | n + ≤ #R·w, plus #T·w with the objective |
| CM(u, ℓ, m) | ≤ 9n + #T binaries; 2·#E continuous | n + 2·#E + ≤ 9·(#R + #T) + 2·#𝓜 |
| Base model (base spec), for comparison | P·((2N + 1)² − 1) binaries | 4P + 2·#𝓜 |

(#X is the number of elements of X.)

Only the LP grows with P. The others grow with n·w and with |R|, which stays near linear in n when the windows are small: a leaf's window can only collide with nearby leaves.

### 11.2 Reference results

These results come from a prototype of A:7 through Stage 4a. It used SciPy's HiGHS in place of GLOP and CP-SAT. The trees were random, with 25, 52 and 101 leaves on grids of 16, 24 and 32, and edge lengths that were either real or whole numbers. There was one run per tree.

&#91;embedded content: Python prototype (SciPy linprog and HiGHS in place of GLOP and CP-SAT), six random trees, one run each, 28 Oct 2026\]

| Leaves | N | P | Base model binaries | Last repair model | Time, Stages 1–4a |
| --- | --- | --- | --- | --- | --- |
| 25 | 16 | 300 | 326,400 | 176 Booleans | 0.8–1.0 s |
| 52 | 24 | 1,326 | 3,182,400 | 369 Booleans | 1.9–2.4 s |
| 101 | 32 | 5,050 | 21,331,200 | 616 Booleans | 2.6–3.1 s |

The repair alone (A:3) kept 90.0% to 99.8% of m\_c. Neighbourhood search (A:4) added 0.2% to 11.8%, and in three of six runs it passed m\_c, which confirms that Lemma 3 gives only a local optimum. For closing:

- A:5 gained nothing with real lengths: one tight pair before and after, as the remark in Section 7 predicts. With whole-number lengths it took the tight pairs from 4 to 6, 4 to 12, and 2 to 2.
- The base spec's closing with fixed leaves made no 25- to 101-leaf layout valid, even at strain ±0.9.
- A:6, in a separate test on trees of 9, 11, 15 (twice) and 25 leaves, made one valid: the 9-leaf tree at ±0.5, with four polygons. The CM rounds hit a 60 s cap at about 500 to 1,800 rows, a sign that the big-M rows M:9 and M:10 relax poorly.

## 12. Open problems

1. **Stubs.** When the tight paths do not tile the hull, TreeMaker adds a stub: a new leaf on a new short edge, placed inside an open polygon and tight to its corners, which splits that polygon into valid ones. Here a stub is one more leaf with a window and a few targets, so it fits W and CM unchanged. The open part is choosing where the stubs attach in the tree and how long they are. That is likely the step that makes V hold reliably beyond about 10 leaves.
2. **A table form of CM.** Discretize each strain to a few levels and write each target pair as a table over (window point, window point, strain levels of the path's edges). This removes M:9 and M:10's big-M constants, at the cost of more Booleans.
3. **Pair generation in Stage 1.** LP(u, ρ) is the only model with P rows. Keep only the pairs whose M:1 slack at u is below a threshold, and add the others back when the new v violates them. This makes Stage 1 near linear in n for several hundred leaves.
4. **Certificates.** Seed the optimized spec's bisection with u and m, and give it a time-limited full-grid test of the next candidate above m. A "no" certifies m = m\*, and a "yes" improves the layout.
5. **Better starts.** Lemma 3 makes m\_c depend on the start. Seeds from a tree embedding, such as a radial layout or one scaled to the leaves' path lengths, may beat the border start on deep trees.
