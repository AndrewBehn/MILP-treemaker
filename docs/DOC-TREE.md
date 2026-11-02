# The document tree

Since 2 November 2026 the TreeMaker specifications form a directed tree. Every document has at most one parent: the
document it builds on. The pieces that several documents share are **foundation** documents of their own. Any
document may cite a foundation, but a foundation is never a parent, and no foundation cites a model or algorithm
specification. Specifications on different branches do not link to each other.

```
TreeMaker specifications (index: the app's docs page)
├─ Foundations (cited, never parents)
│  ├─ F1 The tree, the sheet and spacing      short name: sheet spec
│  ├─ F2 Grid offsets                          short name: offsets spec
│  ├─ F3 Leaf conditions and symmetry          short name: conditions spec
│  ├─ F4 Lattice hulls and leaf windows        short name: hulls spec
│  ├─ F5 Strain                                short name: strain spec
│  └─ F6 Tight pairs and polygons              short name: polygons spec
├─ Layout solvers
│  ├─ Pure MILP TreeMaker                      (base spec)
│  │  └─ Symmetry-Breaking MILP TreeMaker      parent: Pure
│  ├─ Lattice-Hull MILP TreeMaker
│  │  └─ Optimized MILP TreeMaker              parent: Lattice-Hull
│  └─ Scalable MILP TreeMaker
└─ After the layout
   └─ Polygon Closing TreeMaker
      └─ Crease Pattern TreeMaker              parent: Polygon Closing
```

## What each foundation holds (labels)

Labels follow the style guide: each kind numbered through the document in order of appearance. Other documents
cite them by short name, for example sheet D:1 or conditions C:6.

| Foundation | Labels | Taken from |
|---|---|---|
| F1 sheet | P:1 Tree, P:2 Edge lengths, P:3 Grid size; D:1 Tree metric and path lengths; D:2 Scale and the spacing condition (a pair fits when ‖uᵢ − uⱼ‖ ≥ m·ℓᵢⱼ; m\*, the TreeMaker scale m/N); D:3 Scale upper bound | base P:1–P:3, D:1, D:3, Notation, Sets; figures base 01 and 03 |
| F2 offsets | D:1 Candidate offsets Δ\_N; D:2 Offset distance lookup table; D:3 Candidate scales | base Sets and D:2, lattice-hull D:5, optimized D:3; figure base 02 |
| F3 conditions | P:1 Leaf conditions; C:1 Leaf on an edge, C:2 Leaf in a corner, C:3 Mirrored pair, C:4 Leaf on the symmetry axis, C:5 Leaf at a fixed point; P:2 Anchor leaf; D:1 Interchangeable siblings 𝒯; C:6 Anchor in the fundamental domain; C:7 Sibling order; Lemma 1 (symmetry breaking keeps an optimum) | base Sections 7.1–7.5, symmetry-breaking P:4, C:5, C:6 and Section 9; figure symmetry-breaking 06 |
| F4 hulls | D:1 Forbidden offsets and their lattice hull; D:2 Facet big-M; P:1 Active pairs; P:2 Inner polygon points; P:3 Leaf windows; D:3 Inner polygon; D:4 Window big-M | lattice-hull D:2, D:6, D:7, P:5–P:7, optimized D:1, D:2, D:4, D:5; figures lattice-hull 02, 06, 07, 08, optimized 07 |
| F5 strain | P:1 Strain bounds; P:2 Edge room and cost; D:1 Strained edge length; D:2 Strained path length; D:3 Edge bounds | base P:6 and Section 11.3, closing P:6, P:8, D:1, D:7 |
| F6 polygons | D:1 Tight pair; D:2 Hull and boundary pieces; D:3 Valid subdivision; D:4 Greedy triangulation; A:1 PolygonTest and its lemma | closing D:2–D:5, A:1, Lemma 1 |

The running example stays the four-leaf tree on a 9 × 9 grid.

## The foundation documents (Claude Docs)

| Doc | Short name | Artifact | Container slug | Tab node | Labels |
|---|---|---|---|---|---|
| TreeMaker foundations: the tree, the sheet and spacing | sheet | https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C | f0f3f117-5139-484f-bf3d-82cc3c7112fb | 7b8bf7ce-7924 | P:1 Tree, P:2 Edge lengths, P:3 Grid size, D:1 Tree metric and path lengths, D:2 Scale and the spacing condition, D:3 Scale upper bound |
| TreeMaker foundations: grid offsets | offsets | https://claude.ai/artifact/DLXohGDzg22AYwjJeHyYem | 63e7c7a4-40f1-4a8b-bee6-420b172ec50a | 069f4cc8-543d | D:1 Candidate offsets, D:2 Offset distance lookup table, D:3 Candidate scales |
| TreeMaker foundations: leaf conditions and symmetry | conditions | https://claude.ai/artifact/3WP1SahWDm9pb5hs8Mhwp7 | 144c68c9-1128-4de4-964a-fa60b70593a4 | 86010a5e-2237 | P:1 Leaf conditions, C:1 Leaf on an edge, C:2 Leaf in a corner, C:3 Mirrored pair, C:4 Leaf on the symmetry axis, C:5 Leaf at a fixed point, P:2 Anchor leaf, D:1 Interchangeable siblings, C:6 Anchor in the fundamental domain, C:7 Sibling order, Lemma 1 |
| TreeMaker foundations: lattice hulls and leaf windows | hulls | https://claude.ai/artifact/FxaVEDwfoA6pXYs4aMUwLk | 79227c49-6d9f-49e7-abc9-56fa8071d9e9 | 230caaa8-90ad | D:1 Forbidden offsets and their lattice hull, D:2 Facet big-M, P:1 Active pairs, P:2 Inner polygon points, P:3 Leaf windows, D:3 Inner polygon, D:4 Window big-M |
| TreeMaker foundations: strain | strain | https://claude.ai/artifact/Xr8Sus42zxf1wu68c1BMWt | f9ce3199-b5b3-4dda-97e3-98df8668b845 | 3bbea88a-7fdc | P:1 Strain bounds, P:2 Edge room and cost, D:1 Strained edge length, D:2 Strained path length, D:3 Edge bounds |
| TreeMaker foundations: tight pairs and polygons | polygons | https://claude.ai/artifact/TdJgMS7ZgBLRCvMBdGYGMY | d79f4690-02a1-4283-a956-9385d8cb7e8b | d784c8ef-4f31 | D:1 Tight pair, D:2 Hull and boundary pieces, D:3 Valid subdivision, D:4 Greedy triangulation, A:1 PolygonTest, Lemma 1 |

## The specifications (Claude Docs)

| Doc | Short name | Parent | Container slug | Tab node |
|---|---|---|---|---|
| Pure MILP TreeMaker | base | none | 02a7ba14-b4be-4c9f-99d1-ebac9aacfdb9 | a3a74054-0357 |
| Symmetry-Breaking MILP TreeMaker | symmetry-breaking | base | 1d237ba1-10e5-4fa8-82ad-e0bc2ead69e7 | fa0cae2e-1113 |
| Lattice-Hull MILP TreeMaker | lattice-hull | none | b1b5b583-372a-4a28-8742-3fe43fcd5d1b | 7ffee6c7-7758 |
| Optimized MILP TreeMaker | optimized | lattice-hull | a1a48284-c0dd-489d-8389-d5c28f829a88 | c4592889-1f69 |
| Scalable MILP TreeMaker | scalable | none | c237e54d-08de-4743-bb5f-274160408d26 | d64e2319-db8f |
| Polygon Closing TreeMaker | closing | none | 789428e8-6756-48fb-8f55-39bbafccb733 | c45537c5-97f5 |
| Crease Pattern TreeMaker | crease | closing | 0166114f-0d5d-4cdf-b541-17a09cdabca3 | 6a9c70bb-7945 |
