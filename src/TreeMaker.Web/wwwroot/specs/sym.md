# Symmetry-Breaking MILP TreeMaker

Oct 25, 2026 · @Andrew Behn

A pure mixed-integer linear program (MILP) for TreeMaker's scale optimization on a fixed N × N grid, with symmetry breaking added. It is the model of [Pure MILP TreeMaker](https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4), the base spec, plus conditions C:6 and C:7 of [TreeMaker foundations: leaf conditions and symmetry](https://claude.ai/artifact/3WP1SahWDm9pb5hs8Mhwp7), the conditions spec. The two constraints remove equivalent copies of each layout: rotations and reflections of the sheet, and swaps of interchangeable leaves. The optimum is the same, and it is still found in one solve.

The tree, the grid, the spacing condition and the scale are those of [TreeMaker foundations: the tree, the sheet and spacing](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), the sheet spec. The candidate offsets and their lookup table are those of [TreeMaker foundations: grid offsets](https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem), the offsets spec.

**Labels.** This document adds no labels of its own. Labels of the base spec are written base C:4, and a foundation's labels carry its short name, as in sheet D:2, offsets D:2 or conditions C:6.

## 1. From the base model to symmetry breaking

**The base model.** The base spec restricts every leaf to a grid point and reads each pair's distance from a lookup table. Its variables are the scale, the leaf coordinates and one binary offset selector per leaf pair and candidate offset (base Section 3). Its constraints base C:1–C:4 are exactly the spacing condition of sheet D:2 on grid points (base Section 4), and its objective maximizes the scale (base Section 5).

**Symmetry breaking.** The square sheet looks the same after any of its 8 rotations and reflections, and interchangeable siblings (conditions D:1) can trade places. Each of these turns a layout into an equally good one, so the solver meets every layout many times over. Conditions C:6 and C:7 keep exactly one copy of each.

## 2. Notation

Notation follows the sheet spec (sheet Section 1) and the base spec (base Section 2). The terms dihedral group, fundamental domain, lexicographic order, copy of a layout and valid tightening are those of conditions Section 1. The symbols below are the ones this document uses.

| Symbol | Meaning | Defined in |
| --- | --- | --- |
| m, xᵢ, yᵢ, wᵢⱼᵟ | The scale, the leaf coordinates and the offset selectors | base Section 3 |
| Δ\_N, D(δ) | The candidate offsets and their lookup table | offsets D:1, offsets D:2 |
| Aᵢ, 𝓜 | The leaf conditions and the mirror pairs | conditions P:1 |
| r\* | The anchor leaf | conditions P:2 |
| 𝒯 | The interchangeable sibling pairs | conditions D:1 |

## 3. Variables and constraints

**Variables.** Those of the base model (base Section 3). Symmetry breaking adds none.

**Constraints.** The base constraints base C:1–C:4, and two more from the conditions spec:

- conditions C:6 puts the anchor leaf r\* of conditions P:2 in the fundamental domain, the triangle 0 ≤ y ≤ x ≤ N/2;
- conditions C:7 orders each pair of interchangeable siblings of conditions D:1 by the key (N + 1)x + y.

**Leaf conditions.** A design may add conditions C:1–C:5, as in the base model (base Section 4). A condition fixes the sheet's orientation, so conditions C:6 applies only when there is none. Conditions C:7 orders only siblings that carry no condition (conditions D:1).

## 4. Objective

Maximize the scale, exactly as the base model does, in one solve.

```math
\max_{m,\, x,\, y,\, w} \quad m \qquad \text{subject to base C:1–C:4 and conditions C:6–C:7}
```

The optimum m\* is the base model's (base Section 5): 1.054 for the running example on the 9 × 9 grid.

## 5. Why the optimum is unchanged

**The base constraints are the spacing condition.** Base C:1–C:4 hold exactly when every leaf lies on a grid point and every pair meets the spacing condition of sheet D:2 (base Section 4). With leaf conditions, conditions C:1–C:5 hold as well.

**Every layout has a copy that satisfies C:6 and C:7.** By conditions Lemma 1, every such layout at scale m has a copy at the same scale that also satisfies conditions C:6 and C:7.

**The selectors follow the copy.** A symmetry g of the square maps each offset δ to its image, which is again in Δ\_N (offsets D:1) and has the same table entry (offsets D:2). A sibling swap exchanges the selectors of the swapped pairs, taking −δ where the swap reverses a pair's order. Selecting those offsets gives a solution of base C:1–C:4 with the same m.

So every solution of the base model has a solution of this model with the same scale, and the converse holds because this model only adds constraints. The two optima are equal: conditions C:6 and C:7 are a valid tightening.

```math
\max \{\, m : \text{base C:1–C:4} \,\} \ = \ \max \{\, m : \text{base C:1–C:4, conditions C:6–C:7} \,\}
```

## 6. What symmetry breaking gains

**Fewer equivalent solutions.** Without conditions C:6 and C:7, each layout can appear up to 8 times from the sheet's symmetries, and g! times more for each group of g interchangeable siblings (conditions Section 4). Branch-and-bound can explore every copy, both while looking for good layouts and, more expensively, while proving that none is better. The two constraints keep one copy, so the search space shrinks by up to that factor. The running example has no interchangeable siblings, so the factor there is at most 8.

**No change in size.** Conditions C:6 adds three rows and conditions C:7 one row per sibling pair, with no new variables. The model still has (2N + 1)² − 1 binaries per leaf pair, 2,160 for the running example on the 9 × 9 grid (base Section 3).

**What it does not change.** The LP relaxation stays as weak as the base model's (base Section 7): a pair can still put half its weight on an offset δ and half on −δ, so the relaxation reaches the scale bound m̄ of sheet D:3 whatever the tree. Symmetry breaking speeds up the search without tightening that bound. Translations of a layout with slack at the sheet's edges are not removed either.
