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
