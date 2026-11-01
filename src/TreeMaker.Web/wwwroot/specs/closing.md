# Polygon Closing TreeMaker: model and algorithm specification

Oct 31, 2026 · @Andrew Behn

A grid layout from any of the layout specifications becomes foldable only when its tight paths divide the leaves' convex hull into valid polygons. This specification decides whether they do, and if not, finds edge strains that make them do so with every leaf held in place and the scale fixed. It builds on the [Pure MILP TreeMaker](https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4) specification (the *base spec*), whose tree, path lengths and strain variables σₑ (base Section 11) it reuses, and complements Section 8 of [Scalable MILP TreeMaker](https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29) (the *scalable spec*), which closes polygons while the leaves may still move. Holding the leaves fixed makes every model here small and fast; the price is that some layouts cannot be closed at any strain, and this specification proves when that happens. Its output feeds [Crease Pattern TreeMaker](https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp).

**Overview.**

| Stage | What it decides | Model | Problem class | Section |
| --- | --- | --- | --- | --- |
| 1. Polygon test | Whether the tight paths form valid polygons | none (exact integer geometry) | combinatorial | 4 |
| 2. Closing | Strains that make the most target pairs tight, then the least total strain | CL(T, w) | MILP | 5 |
| 3. Strain bounds | The smallest symmetric strain bound that can close the boundary, and one that closes a triangulation | LP(K) | LP | 6 |
| 4. Strain needed | The smallest bound that closes every polygon, to a set precision | Stages 2 and 3 in a search | sequence of LPs and MILPs | 7 |

Section 1 states the scope and guarantees, Section 2 the inputs, Section 3 the shared definitions, Sections 4 to 7 the stages, Section 8 the correctness properties, Section 9 sizes and reference results, and Section 10 open problems.

**Labels.** P:n, D:n, M:n and A:n label parameters, definitions, model rows and algorithms, each numbered in order of first appearance. Definitions used in more than one place are under Shared definitions; a definition used once sits at its point of use. Labels of other documents are written with their short name, as in base P:1 or scalable Section 8.

## 1. Purpose and scope

The input is a solved layout: integer leaf points on an N × N grid, a scale m₀ at which every leaf pair fits, and the edge lengths it was solved with. The output is either a proof that the layout's polygons are already valid, a new set of edge lengths ℓₑ(1 + σₑ) under which they are, or a proof that no strain can make them valid.

*Tight*, *active path* and *valid polygon* follow Lang's tree method: a tight pair's leaf circles touch along its tree path, and the universal-molecule construction (in the crease pattern spec) needs the tight pairs to tile the hull with convex, empty polygons.

What is fixed throughout: the leaf points, the scale m₀ and the tree's shape. What changes: only the edge lengths, through one strain σₑ per edge, so that a flap or river may come out longer or shorter than asked.

**Guarantees in brief.**

- The polygon test (A:1) is exact: it uses integer arithmetic except for the tightness test, which has a stated tolerance.
- Every set of strains returned keeps every leaf pair fitting at m₀ (M:1, M:6).
- An infeasible boundary LP proves that no strain closes the polygons with these leaves at this scale (Lemma 4).
- The strain-needed search (A:4) returns a bound that closes every polygon, but it is the smallest such bound only when closing is monotone in the bound, which is **Not** guaranteed (Section 8).

## 2. Inputs and parameters

**P:1 Tree.** The tree T = (V, E) with leaves L and leaf pairs 𝒫, as in base P:1. Each pair (i, j) has its tree path, the edge set P(i, j).

**P:2 Starting edge lengths.** The lengths the layout was solved with: the tree's lengths (base P:2), or lengths from an earlier strain.

```latex
\ell^0_e > 0 \quad (e \in E)
```

**P:3 Grid size.** N, as in base P:3.

**P:4 Layout.** One integer grid point per leaf; Dᵢⱼ is the Euclidean distance between two leaves.

```latex
u_i \in \{0, \dots, N\}^2 \ (i \in L), \qquad D_{ij} = \lVert u_i - u_j \rVert
```

**P:5 Scale.** The fixed scale m₀ > 0 at which every pair fits with the starting lengths.

**P:6 Strain bounds.** The range each edge's strain may take.

```latex
-1 < \sigma_{\min} \le 0 \le \sigma_{\max}
```

**P:7 Target pairs.** Optionally, the set T ⊆ 𝒫 of pairs to make tight. When it is not given, A:2 chooses it.

**Algorithm parameters.**

| Symbol | Meaning | Default |
| --- | --- | --- |
| τ | relative tolerance of the tightness test (D:2) | 10⁻⁶ |
| ε | precision of the strain-needed search (A:4) | 0.01 |
| γ | rounding step for strain bounds, upward (A:4) | 0.001 |
| σ\_floor | lowest strain the bound LPs allow, so every length stays positive (M:7) | −0.99 |
| λ | tie-break weight on total strain in LP(K) (Section 6) | 10⁻⁴ / max(1, #E) |
| t\_cap | time cap of each MILP solve | 60 s |
| σ\_min, σ\_max for A:2 | default strain bounds | −0.3, 0.3 |

## 3. Shared definitions

**D:1 Strained path length.** The length of a pair's tree path once every edge is stretched or shrunk by its strain. It is linear in σ, which keeps every model in this document linear.

```latex
\ell_{ij}(\sigma) = \sum_{e \in P(i,j)} \ell^0_e \, (1 + \sigma_e)
```

Used in: D:2, M:1, M:2, M:5 and M:6.

**D:2 Tight pair.** A pair whose leaves are exactly at their minimum distance m₀ℓᵢⱼ(σ), up to the relative tolerance τ. Its straight segment is an *active path*.

```latex
\text{tight}_{ij}(\sigma) \iff \lvert D_{ij} - m_0\,\ell_{ij}(\sigma) \rvert \le \tau \max(1, D_{ij})
```

Used in: A:1, A:3 and Lemma 2.

**D:3 Hull and boundary pieces.** H is the convex hull of the leaf points. Its *boundary pieces* B are the pairs of leaves that are consecutive along the hull's boundary, counting leaves that lie on a hull side between its corners.

```latex
B = \{ (i, j) : u_i, u_j \in \partial H,\ \text{no leaf strictly between } u_i \text{ and } u_j \text{ on } \partial H \}
```

Used in: D:4, A:2, A:3 and Lemma 4.

**D:4 Valid subdivision.** The tight pairs give a valid subdivision when their segments, split at any leaf lying on them, cross nowhere, and their bounded faces are simple, convex, free of leaves in their interiors, and together cover H exactly. This is the condition the universal molecule needs.

```latex
\text{valid}(S) \iff \text{no crossings} \wedge \forall F: F \text{ simple, convex, empty} \wedge \textstyle\sum_F \operatorname{area}(F) = \operatorname{area}(H) > 0
```

Used in: A:1, A:2, A:3, A:4, Lemma 4 and Lemma 5.

**D:5 Greedy triangulation.** Given a set K of segments to keep, Δ(K) adds pairs in order of increasing Dᵢⱼ (ties by leaf name), skipping any pair whose segment passes through a third leaf or properly crosses a segment already taken. The result is a maximal non-crossing set, so its bounded faces are triangles with no leaf inside, and it contains every boundary piece of D:3.

```latex
\Delta(K) \supseteq K \cup B, \qquad \Delta(K) \text{ maximal non-crossing}
```

Used in: A:2 and A:3.

**D:6 Boundary-first weights.** In a closing solve (Section 5), each target on the hull's boundary is worth more than all interior targets together, so the first solve maximizes the boundary count before anything else.

```latex
w_k = \begin{cases} \#T + 1 & k \in B \\ 1 & \text{otherwise} \end{cases}
```

Used in: A:2 and Lemma 3.

## 4. Stage 1: the polygon test

The test reads a layout and a set of tight pairs and reports whether they form a valid subdivision (D:4), and if not, every reason why. It solves no model.

**A:1 PolygonTest.** Input: the leaf points u (P:4) and the tight pairs S (D:2) at the current lengths.

1. **Segments.** For each tight pair (i, j), list the leaves lying strictly inside the segment uᵢuⱼ, in order of distance from uᵢ, and add each consecutive piece as a segment. The result is the segment set G.
2. **Crossings.** For every two segments of G with no shared end, record a crossing when each one's ends lie strictly on opposite sides of the other's line.
3. **Faces.** Sort each leaf's segments by angle. Walk every directed segment, turning to the next segment clockwise at each leaf, so the face lies on the left. Each closed walk with positive signed area is a bounded face F; the walks with area 0 or less are the outer face or the two sides of a dangling segment.
4. **Each face.** For every bounded face:
   1. *Simple*: no leaf repeats along the walk; a repeat means a segment dangles into the face.
   2. *Convex*: no three consecutive corners turn right (straight runs are allowed).
   3. *Empty*: no leaf other than its corners lies strictly inside (winding number).
5. **Hull.** Build H with a monotone chain and list its boundary pieces B (D:3). Each piece not in G is *missing*.
6. **Cover.** Sum the bounded faces' areas and compare with H's area.
7. **Verdict.** Valid when H has positive area, there are no crossings and no missing pieces, every face is simple, convex and empty, and the faces cover H. Otherwise report each failure: crossings, missing boundary pieces, dangling, non-convex or occupied faces, and uncovered area.

The test stops after one pass over the pairs, segments and faces; with n leaves it takes O(n⁴) time in the worst case (Step 2 over O(n²) segments), far below any solve.

**Lemma 1.** Every decision in A:1 except tightness is exact. *Proof.* Leaf points are integers, so every orientation test, area and point-in-polygon test is an integer cross product, computed without rounding. Only D:2 compares a square root with m₀ℓᵢⱼ, under the tolerance τ.

## 5. Stage 2: the closing MILP

The closing MILP CL(T, w) changes edge lengths so that as many target pairs as possible become tight, the boundary pieces before everything else, while every pair still fits. A second solve keeps that many tight and uses the least total strain.

### 5.1 The model CL(T, w)

**Variables.** A strain per edge, its absolute value, and a switch per target pair.

```latex
\sigma_e \in [\sigma_{\min}, \sigma_{\max}], \quad a_e \ge 0 \ (e \in E), \qquad t_k \in \{0, 1\} \ (k \in T)
```

**M:1 Every pair fits.** No pair may end up closer than its new minimum distance.

```latex
m_0\,\ell_{ij}(\sigma) \le D_{ij} \qquad \forall (i,j) \in \mathcal{P}
```

**M:2 Switched tightness.** A target pair with tₖ = 1 reaches its distance from below; with M:1 it is then exactly tight.

```latex
m_0\,\ell_k(\sigma) \ge D_k\, t_k \qquad \forall k \in T
```

**M:3 Absolute strain.** aₑ is at least |σₑ|.

```latex
a_e \ge \sigma_e, \quad a_e \ge -\sigma_e \qquad \forall e \in E
```

**M:4 Keep the count.** In the second solve only: the weighted count of the first solve, W\*, is kept.

```latex
\textstyle\sum_{k \in T} w_k t_k \ge W^* - \tfrac12
```

**Objectives.** The first solve maximizes Σ wₖtₖ; the second, with M:4, minimizes Σ aₑ.

**Switching and big-M.** M:2 is the only switching row, and its big-M constant is Dₖ itself. With tₖ = 0 it reads m₀ℓₖ(σ) ≥ 0, which always holds because every σₑ > −1 keeps every length positive, so the switch off removes nothing. M:4 uses W\* − ½ because the weights are integers.

### 5.2 The algorithm

**A:2 Close.** Input: P:1 to P:6, and optionally T (P:7). Each solve is capped at t\_cap.

1. Run A:1 at the starting lengths; let S be the tight pairs.
2. If T is not given, set T = Δ(S) (D:5), so every face left after closing is a triangle or a convex union of triangles.
3. **Boundary first.** If T was not given and contains both boundary pieces and interior pairs: solve CL(T ∩ B, 1) twice (both objectives). If every boundary piece is tight and A:1 at the resulting lengths reports a valid subdivision, replace T by T ∩ B. (A square with four tight sides needs no diagonal.)
4. Solve CL(T, w) with the weights of D:6 to get W\*. If it is infeasible, stop: no strains within the bounds keep every pair apart.
5. Solve CL(T, w) again with M:4 and the least-strain objective. If this second solve fails within its cap, keep the first solve's strains.
6. Set ℓₑ = ℓ⁰ₑ(1 + σₑ), with |σₑ| < 10⁻⁹ rounded to 0, and run A:1 at the new lengths. Return the strains, the new lengths, the pairs made tight and the verdict.

A:2 makes at most four solves.

**Lemma 2.** Every pair with tₖ = 1 is tight at the new lengths, and every pair still fits at m₀. *Proof.* M:1 and M:2 together give m₀ℓₖ(σ) = Dₖ for tₖ = 1, which meets D:2 within the solver's feasibility tolerance; M:1 holds for every pair.

**Lemma 3.** The first solve of Step 4 makes the largest possible number of boundary pieces in T tight. *Proof.* One boundary piece weighs #T + 1, more than all interior targets together (at most #T), so trading a boundary piece for any number of interior ones lowers the objective.

## 6. Stage 3: the strain bounds

With the leaves fixed, the smallest symmetric bound s that lets strains make a chosen set K of pairs exactly tight, with every other pair still fitting, is a linear program LP(K). Two choices of K bracket the strain needed: the boundary pieces give a lower bound, and a whole triangulation gives a bound that usually closes.

### 6.1 The model LP(K)

**Variables.** The bound s, a strain per edge (kept above σ\_floor so every length stays positive) and its absolute value.

```latex
s \ge 0, \quad \sigma_e \ge \sigma_{\text{floor}}, \quad a_e \ge 0 \qquad (e \in E)
```

**M:5 Chosen pairs tight.** Every pair of K is exactly at its minimum distance.

```latex
m_0\,\ell_k(\sigma) = D_k \qquad \forall k \in K
```

**M:6 Every other pair fits.**

```latex
m_0\,\ell_{ij}(\sigma) \le D_{ij} \qquad \forall (i,j) \in \mathcal{P} \setminus K
```

**M:7 Symmetric bound.** Every strain lies within ±s.

```latex
-s \le \sigma_e \le s \qquad \forall e \in E
```

**M:8 Absolute strain.** As M:3, for the tie-break.

```latex
a_e \ge \sigma_e, \quad a_e \ge -\sigma_e \qquad \forall e \in E
```

**Objective.** The largest strain first; among equal bounds, the least total strain. The weight λ is small enough that it never trades against s.

```latex
\min \; s + \lambda \textstyle\sum_{e} a_e
```

LP(K) has no switching rows and no big-M constants. It is infeasible exactly when no strains above σ\_floor make K tight while every other pair fits.

### 6.2 The algorithm

**A:3 StrainBounds.** Input: P:1 to P:5.

1. Run A:1 at the starting lengths. If the subdivision is already valid, return s = 0.
2. Let S be the tight pairs, Δ = Δ(S) (D:5), and BΔ the boundary pieces in Δ (D:3).
3. Solve LP(BΔ). If it is infeasible, return *no strain closes this layout*. Otherwise let s\_b be its optimum and σ\_b its strains.
4. Run A:1 at the lengths ℓ⁰ₑ(1 + σ\_b,ₑ). If the subdivision is valid, return s\_b as the strain needed, with the pairs tight there as the targets that reproduce it.
5. Otherwise solve LP(Δ). Return s\_b as a lower bound, and s\_t, its optimum, as the upper end of the search, or none if LP(Δ) is infeasible.

A:3 solves at most two LPs.

**Lemma 4.** Any strains with every σₑ ≥ σ\_floor that make the subdivision valid with these leaves at m₀ have max |σₑ| ≥ s\_b; if LP(BΔ) is infeasible, no such strains exist. *Proof.* A valid subdivision has no missing boundary pieces (D:4), so every pair in BΔ ⊆ B is tight, and every pair fits. Those strains are therefore feasible in LP(BΔ) with s = max |σₑ|, so its optimum is at most that; with none feasible, none close.

**Lemma 5.** If LP(Δ) is feasible, every face of Δ is a triangle bounded by tight pairs with no leaf inside, at strains within ±s\_t. *Proof.* Δ is maximal non-crossing (D:5), so its bounded faces are empty triangles that cover H, and M:5 makes all their sides tight. The subdivision is valid unless some pair outside Δ also becomes tight across a triangle, which A:1 reports; Section 8 lists this case.

## 7. Stage 4: finding the strain needed

The search returns the smallest symmetric bound ±s it finds that closes every polygon, and the closing at that bound. It brackets s with A:3, then bisects with A:2, because the closing MILP may close the polygons with fewer tight pairs than a full triangulation.

Two bounds enter A:2 for each trial s: σ\_min = −min(s, |σ\_floor|) and σ\_max = s. Every bound is rounded up to the step γ, written ⌈s⌉\_γ, so the bound returned is never below the one proved.

**A:4 StrainNeeded.** Input: P:1 to P:5.

1. Run A:3.
   1. Already valid: return s = 0.
   2. LP(BΔ) infeasible: return *no strain closes this layout* (Lemma 4).
2. **Boundary suffices.** If A:3 returned s\_b as the strain needed, set s = ⌈s\_b⌉\_γ and run A:2 at ±s with T = the pairs tight at σ\_b. Return s and that closing, with its A:1 verdict.
3. **Bracket.** Set lo = ⌈s\_b⌉\_γ and hi = ⌈s\_t⌉\_γ, or ⌈max(|σ\_floor|, 1.5 s\_b)⌉\_γ when LP(Δ) was infeasible.
4. Run A:2 at ±hi with T chosen by A:2. If its subdivision is not valid, return *not closed within ±hi*, with that closing.
5. **Bisect.** While hi − lo > ε:
   1. mid = ⌈(lo + hi)/2⌉\_γ; if mid ≥ hi, stop.
   2. Run A:2 at ±mid. If its subdivision is valid, set hi = mid and keep this closing; otherwise set lo = mid.
6. Return hi and its closing.

**Stopping.** Step 5 halves hi − lo each pass and stops below ε or when the rounded midpoint reaches hi, so it runs at most ⌈log₂((hi − lo)/ε)⌉ passes. With every A:2 capped at four solves of t\_cap, A:4 makes at most 2 LPs and 4(2 + ⌈log₂((hi − lo)/ε)⌉) MILP solves.

**Lemma 6.** A bound returned in Step 6 closes every polygon, and every bound A:4 returns is at least the true strain needed s\* (the least max |σₑ| over strains with every σₑ ≥ σ\_floor that give a valid subdivision). *Proof.* Step 6 returns a bound only with an A:2 closing whose A:1 verdict is valid (Step 4 or Step 5.2). Lemma 4 gives s\_b ≤ s\*, every returned bound is at least ⌈s\_b⌉\_γ ≥ s\_b, and rounding only raises bounds.

The bound returned is within ε of the smallest closing bound only if a bound that closes implies every larger bound closes; Section 8 marks this as **Not** guaranteed.

## 8. Correctness properties

| Property | Status | Reason |
| --- | --- | --- |
| The polygon test is exact apart from the tightness tolerance | Guaranteed | Lemma 1 |
| Every closing keeps every pair fitting at m₀ | Guaranteed | M:1 and M:6 hold in every solution |
| Every target with tₖ = 1 is tight after closing | Guaranteed | Lemma 2 |
| The closing makes the most boundary pieces of T tight | Guaranteed | Lemma 3 |
| An infeasible LP(BΔ) proves no strain above σ\_floor closes the layout | Guaranteed | Lemma 4 |
| s\_b is a lower bound on the strain needed | Guaranteed | Lemma 4 |
| A bound returned in Step 6 of A:4 closes every polygon | Guaranteed | Lemma 6 |
| Step 2 of A:4 returns a valid closing | **Not** guaranteed | The least-strain solve may tighten an extra pair across a polygon; its A:1 verdict is returned with it |
| s\_t closes every polygon | **Not** guaranteed | A pair outside Δ may also become tight and cross a triangle (Lemma 5) |
| A:4 returns the smallest closing bound to within ε | **Not** guaranteed | Bisection needs closing to be monotone in s; a wider bound can change which targets the first solve keeps |
| A closing exists for every layout | **Not** guaranteed | The leaves are fixed; many layouts have boundary pieces no strain can tighten (Lemma 4 detects this) |
| A:2 is optimal within its cap | **Not** guaranteed | A solve stopped by t\_cap returns its best strains, reported as Feasible |

The values s\_t and ⌈max(|σ\_floor|, 1.5 s\_b)⌉\_γ are starting points for the search, not bounds on the strain needed.

## 9. Model sizes and reference results

**Sizes.** With #E edges, P leaf pairs and #T targets:

| Model | Variables | Binaries | Rows |
| --- | --- | --- | --- |
| CL(T, w), first solve | 2#E + #T | #T | P + #T + 2#E |
| CL(T, w), second solve | 2#E + #T | #T | P + #T + 2#E + 1 |
| LP(K) | 2#E + 1 | 0 | P + 4#E |

A triangulation of n leaves has at most 3n − 3 pairs, so #T ≤ 3n − 3 and every model is linear in the number of pairs, P = n(n − 1)/2, which is the fastest-growing term. None depends on N.

**Reference results.** A Python prototype of A:3 and A:4, with HiGHS standing in for GLOP and SCIP, ran once on each preset layout found by the scalable prototype. Each LP took 0.1 to 0.2 s.

| Tree | Leaves | Outcome of A:4 |
| --- | --- | --- |
| Centipede, 2 leg pairs | 4 | closes at ±0.183 |
| Caterpillar | 6 | closes at ±0.123 |
| Centipede, 4 leg pairs | 8 | closes at ±0.349 |
| Beetle | 9 | closes, with strains up to +1.316 |
| Scorpion | 13 | closes at ±0.987 |
| Bird-base–like centipede, 3 leg pairs | 6 | not closed within ±1.377 |
| Centipede, 8 leg pairs | 16 | LP(BΔ) infeasible: no strain closes this layout |

The last two rows are why Section 10 begins with closing that does not rely on strain alone.

## 10. Open problems

1. **Stubs.** Close a polygon by adding a short new leaf edge whose leaf is tight to three corners, as TreeMaker does, instead of straining existing edges. It would close layouts that Lemma 4 rules out, at the cost of an extra flap.
2. **Moving leaves.** Combine A:4 with the scalable spec's Section 8, which lets each leaf move one grid step while closing, so a layout ruled out by Lemma 4 can be repaired nearby.
3. **An exact strain needed.** Replace the bisection of A:4 by one MILP that minimizes s subject to a valid subdivision, with a binary per candidate pair and non-crossing constraints. It would make the smallest closing bound a guaranteed property rather than a search result.
4. **Choosing the targets.** Δ is the greedy triangulation. Choosing the interior pairs with the strains, for example by a Delaunay or a weighted triangulation, could lower the strain needed.
5. **Closure in the layout search.** Require a valid subdivision while the layout is solved, by choosing the grid size N and requiring tight pairs in the window models, so every layout found closes at zero strain.
