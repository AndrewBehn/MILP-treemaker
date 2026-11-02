# Crease Pattern TreeMaker: model and algorithm specification

Oct 31, 2026 · @Andrew Behn

A layout whose tight paths form valid polygons becomes a crease pattern by filling every polygon with Lang's universal molecule, and that pattern folds into a uniaxial base whose flaps stand over the tree's edges. This specification computes both: the creases with their kinds, the facets of paper between them, where each facet lies in the folded base, and a check that the folding is consistent. It starts from the output of [Polygon Closing TreeMaker](https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4) (the *closing spec*), whose valid subdivision is its input. It takes the tree, the edge lengths and the scale from the [sheet spec](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), the strained lengths from the [strain spec](https://claude.ai/artifact/Xr8Sus42zxf1wu68c1BMWt), and the tight pairs, the valid subdivision and the polygon test from the [polygons spec](https://claude.ai/artifact/TdJgMS7ZgBLRCvMBdGYGMY). Every step is an explicit geometric construction; nothing is solved. It gives up the mountain and valley assignment of most creases and the layer order, which a folder still has to find.

**Overview.**

| Stage | What it computes | Method | Section |
| --- | --- | --- | --- |
| 1. Universal molecule | Ridge, hinge and gusset creases in every polygon, and the facets between them | recursive polygon shrinking | 4 |
| 2. Folded base | Where every facet lies over the tree, and a consistency check | a fold map per band | 6 |
| 3. Pleating (optional) | Contour creases that lower the base to a height H, with their fold directions | clipping at elevation levels | 7 |

Section 1 states the scope and guarantees, Section 2 the inputs, Section 3 the shared definitions, Sections 4 to 7 the stages and the crease kinds, Section 8 the output, Section 9 the correctness properties, Section 10 reference results, and Section 11 open problems.

**Labels.** P:n, D:n and A:n label parameters, definitions and algorithms, each numbered in order of first appearance. Definitions used in more than one place are under Shared definitions; a definition used once sits at its point of use. Labels of the closing spec and of the foundations are written with their short name, as in closing P:1, sheet P:2 or polygons D:3.

## 1. Purpose and scope

The input is a layout whose tight pairs form a valid subdivision of the leaves' hull, with the scale and edge lengths that make them tight. The output is a set of crease segments, each with its kind, a set of convex facets, each with the tree edge it lies over and the position and height of its corners, and a list of any inconsistencies found.

In the folded base every facet stands vertically over one tree edge. Its *along* coordinate is the distance along that edge, in paper units, and its *elevation* is its height above the base's axis. Seen from above, the base is the tree's stick figure.

**Guarantees in brief.**

- Every polygon of the input is filled, and every facet is a convex piece of one polygon's band (Section 4).
- Every facet is checked to lie over one tree edge and to keep its shape when folded, and every vertex to fold to one point; any failure is reported, never hidden (A:2).
- Pleating lowers every flap to at most H and assigns its contour creases (Lemma 4).
- The construction always terminates, at a stated depth cap (A:1).
- The fold directions of axial, ridge, hinge and gusset creases, and the layer order, are **Not** computed (Section 9).

## 2. Inputs and parameters

**P:1 Tree.** The tree T = (V, E) with leaves L, as in sheet P:1.

**P:2 Edge lengths.** The lengths ℓₑ > 0 under which the polygons are valid: the closed lengths of the closing spec (strain D:1), or the tree's lengths of sheet P:2 when no closing was needed.

**P:3 Layout.** The leaf points uᵢ ∈ {0, …, N}², as in closing P:1.

**P:4 Scale.** The scale m > 0 of sheet D:2, in grid units per unit of tree length, at which every leaf pair fits: the fixed scale m₀ of closing P:2.

**P:5 Polygons.** The faces of the valid subdivision (polygons D:3), each a ring of leaves in counter-clockwise order whose every side is tight.

**P:6 Pleat height.** Optionally, a height H > 0 in grid units to pleat the flaps down to.

**Algorithm parameters.**

| Symbol | Meaning | Default |
| --- | --- | --- |
| η | absolute tolerance for merging inset corners and for a diagonal to count as tight, scaled by max(1, h) | 10⁻⁷ |
| κ | relative tolerance of the fold check (A:2) | 10⁻⁶ |
| d\_max | depth cap on polygon splitting (A:1) | 64 |

## 3. Shared definitions

**D:1 Tree points and tree distance.** A *tree point* is a node of T, or a point inside edge e at offset x ∈ (0, ℓₑ) from its first node. The tree distance d(p, q) is the length of the tree path between two tree points, the tree metric of sheet D:1 extended to points inside edges, and walk(p, q, s) is the tree point at distance s from p toward q. Inset polygon corners map to tree points that need not be nodes.

```math
d(p, q) = \text{length of the path from } p \text{ to } q, \qquad d(p, \operatorname{walk}(p, q, s)) = s \ \ (0 \le s \le d(p, q))
```

Used in: D:3, D:4, A:1 and A:2.

**D:2 Corner speed and cotangent.** When every side of a convex polygon moves inward by the same distance h, corner i slides along its angle bisector at the speed rᵢ that keeps it at distance h from both adjacent sides; cᵢ is how fast it moves along the next side, the cotangent of half the corner's angle. With aᵢ and bᵢ the unit vectors from corner i to its previous and next corners, and nᵢ the inward normal of the next side (bᵢ turned 90° counter-clockwise):

```math
\beta_i = \frac{a_i + b_i}{\lVert a_i + b_i \rVert}\ (\text{or } n_i \text{ when } a_i + b_i = 0), \qquad r_i = \frac{\beta_i}{\beta_i \cdot n_i}, \qquad c_i = r_i \cdot b_i
```

Used in: D:3, A:1 and Lemma 1.

**D:3 Reduced path length.** As the polygon shrinks by h, the tree path between corners i and j, with tree points τᵢ and τⱼ, loses h·cᵢ at each end. Its reduced length is what the inset corners' distance must stay at or above.

```math
L_{ij}(h) = m\, d(\tau_i, \tau_j) - h\,(c_i + c_j)
```

Used in: A:1, Lemma 1 and Lemma 2.

**D:4 Band and fold map.** The *band* of side i, from corner qᵢ to qⱼ at elevation e, is the quadrilateral between that side and its inset. With unit vector u along the side and inward normal n, a paper point x has coordinates s = (x − qᵢ)·u and t = (x − qᵢ)·n, and folds to a tree point and an elevation.

```math
\varphi(x) = \Big( \operatorname{walk}\big(\tau_i, \tau_j, \max(0, s)/m\big),\ e + t \Big)
```

Used in: A:1, A:2 and A:3.

## 4. Stage 1: the universal molecule

Each polygon shrinks, all sides moving inward together, until the first event: two adjacent corners meet, or a diagonal's reduced path becomes tight. The bands swept by the sides become facets, the corner tracks become ridges, and what is left splits along its tight diagonals and shrinks again, one level higher.

**Lemma 1.** Adjacent corners i and j = i + 1 meet at h = ‖qⱼ − qᵢ‖ / (cᵢ + cⱼ). Non-adjacent corners become exactly tight at the smallest positive root h of the quadratic below with Lᵢⱼ(h) ≥ 0, where u = qᵢ − qⱼ, v = rᵢ − rⱼ, w = cᵢ + cⱼ and L = m d(τᵢ, τⱼ). *Proof.* An inset side keeps its direction and loses h·c at each end (D:2), so it vanishes at that h. The inset corners are q + h r, and squaring ‖u + h v‖ = L − h w gives the quadratic.

```math
(v \cdot v - w^2)\,h^2 + 2\,(u \cdot v + L w)\,h + (u \cdot u - L^2) = 0
```

**Lemma 2.** For 0 ≤ h ≤ h\*, the first event, every side of the inset polygon is exactly its reduced path length (D:3), and every diagonal is at least its reduced length. *Proof.* A side's length and its reduced length both fall by h(cᵢ + cⱼ) from equal values at h = 0. A diagonal fits at h = 0 because every leaf pair fits (sheet D:2); the difference is continuous in h, so it first reaches zero at a diagonal event, which is no earlier than h\* by its definition.

**A:1 Molecule.** Input: a convex ring of corners q₁, …, qₖ with tree points τ₁, …, τₖ, a crease kind for each side, an elevation e and a depth. The top level calls it on every polygon of P:5 with tree points at the leaves, every side axial, e = 0 and depth 0.

1. If depth > d\_max, report it and stop.
2. Check that every side is tight (polygons D:1): ‖qⱼ − qᵢ‖ = m d(τᵢ, τⱼ) within relative 10⁻⁶; report any that is not.
3. Compute rᵢ and cᵢ for every corner (D:2).
4. **First event.** h\* is the smallest value of Lemma 1 over all adjacent and non-adjacent pairs, ignoring roots below 10⁻⁹·max(1, longest side). If there is none, report it and stop.
5. **Inset.** pᵢ = qᵢ + h\* rᵢ. The inset corner's tree point is walk(τᵢ, τᵢ₊₁, h\* cᵢ / m); walking toward τᵢ₋₁ must give the same point, and a mismatch is reported.
6. **Bands.** For each side, its band (D:4) is the quadrilateral qᵢ qⱼ pⱼ pᵢ. Cut it perpendicular to the side at every internal tree node on the path from τᵢ to τⱼ, at distance m times the node's tree distance from τᵢ. Each piece of positive area is a facet at depth d; each cut, from the side to the top of the band, is a hinge crease. The side itself is a crease of the kind the ring gave it.
7. **Ridges.** Each corner track qᵢpᵢ of positive length is a ridge crease.
8. **What is left.** Merge inset corners closer than η·max(1, h\*).
   1. One corner: done.
   2. Two corners: the segment between them is a ridge; done.
   3. Corners of zero total area (collinear): consecutive ones are joined by ridges; done.
   4. Otherwise, the inset polygon's sides are flat creases and each diagonal whose length equals m times its tree distance within η·max(1, h\*) is a gusset (a diagonal from a corner to itself, where the ring is pinched, is skipped). Split the inset polygon along its gussets into faces, and run A:1 on each face with elevation e + h\* and depth + 1.

**Stopping.** Every call either ends at Step 8.1 to 8.3, stops at Step 1 or 4, or recurses on faces with strictly fewer distinct corners than its own ring has corners, or at a strictly higher elevation; the depth cap d\_max bounds the recursion.

## 5. Crease kinds

Every crease is a segment on the paper with one of six kinds. A side shared by two polygons is built by both; one copy is kept, matched by endpoints within 10⁻⁷.

| Kind | Where it comes from | In the folded base | Fold direction |
| --- | --- | --- | --- |
| Axial | a side of a top-level polygon (a tight path) | lies on the axis, at elevation 0 | not computed |
| Ridge | a corner's track as its polygon shrinks, or the final segment or chain of a molecule | the top edge of a flap | not computed |
| Hinge | a cut across a band at an internal tree node | a vertical line over that node, where flaps hinge | not computed |
| Gusset | a diagonal of an inset polygon that became tight | where the polygon splits; it lies at the level's elevation | not computed |
| Flat | a side of an inset polygon | between two facets in one plane; not folded | flat |
| Pleat | an elevation contour z = kH (Section 7) | a pleat fold | valley or mountain, alternating |

The first four are TreeMaker's crease kinds. The fold direction of each axial, ridge, hinge and gusset crease depends on how the flaps are stacked, which this specification does not compute (Section 11).

## 6. Stage 2: the folded base

Every facet folds by the fold map of its band (D:4): along the side it moves to the matching point of the side's tree path, and across the side it rises to the band's elevation plus its distance from the side. A facet lies wholly between two consecutive hinges, so its corners all fold onto one tree edge, which is where it stands in the base.

**A:2 FoldAndCheck.** Input: the facets of A:1, each with its band.

1. For each facet, fold every corner with φ (D:4).
2. **Tree edge.** Find an edge e whose closed span contains every folded corner's tree point. If there is none, report *a facet spans more than one tree edge* and drop the facet.
3. **Coordinates.** Each corner's along coordinate is m times its offset along e from e's first node; its elevation is the second part of φ.
4. **Shape.** For every two corners of the facet, compare their distance on the paper with their distance in the (along, elevation) plane; a difference above κ·max(1, paper distance) is reported as *a distorted facet*.
5. **Vertices.** Every paper point that is a corner of several facets must fold to the same tree point and elevation from each, within 10⁻⁶; a mismatch is reported as *a vertex that folds to two places*.
6. Return the facets with their edges, along coordinates and elevations, the tallest elevation, the deepest splitting level, and the list of problems.

**Lemma 3.** Within a facet that A:2 does not report, folding is an isometry onto a vertical plane over one tree edge. *Proof.* On a band, φ maps s and t affinely to (along, elevation) while the tree path from τᵢ to τⱼ runs inside one edge between two hinges, so the map is a rigid motion of the facet onto that plane; Step 4 confirms the distances numerically.

The check passing means every facet keeps its shape and the facets agree at shared corners. It does not prove that the layers can be stacked without the paper passing through itself (Section 9).

## 7. Stage 3: pleating to a height H

A tall base can be lowered by pleating every flap: each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley and mountain in turn, so the flap zigzags up and down within a band of height H. H = 1 grid unit gives pleats one grid unit apart, as in box pleating.

**D:5 Pleated height.** The height of elevation z once folded to H, a triangle wave.

```math
\operatorname{pl}_H(z) = H - \big\lvert (z \bmod 2H) - H \big\rvert
```

Used in: A:3.

**A:3 Pleat.** Input: the facets of A:2 and H (P:6). For each facet:

1. **Orientation.** Take the two corners farthest apart along the band's side. The facet's orientation o is +1 when its along coordinate grows in the same direction as the side, and −1 otherwise.
2. **Levels.** List the multiples kH strictly between the facet's lowest and highest elevation.
3. **Slabs.** Clip the facet between consecutive levels (and below the first and above the last). Each slab with at least three distinct corners is a facet, with along coordinates and elevations interpolated along the clipped sides, and height pl\_H(z) at each corner (D:5).
4. **Contours.** Each level kH crossing the facet gives a pleat crease from where it enters to where it leaves, assigned valley when o·(−1)ᵏ > 0 and mountain otherwise.

A:3 visits each facet once and each level once per facet.

**Lemma 4.** After pleating, every facet's height lies in \[0, H\], and the fold direction of a contour flips where it crosses a ridge. *Proof.* pl\_H maps every z ≥ 0 into \[0, H\]. Across a ridge, the band changes and the along direction of the paper reverses relative to the side, so o changes sign while k does not, which flips the assignment, as a pleat folded over a ridge must.

## 8. Output

The result is either *not built*, with the polygon test's list of reasons (polygons A:1) when the input polygons are not valid, or a crease pattern with:

- the creases, each a segment with its kind (Section 5) and, for pleats, its assignment;
- the facets, each with its paper corners, tree edge, along coordinates, elevations, pleated heights (equal to the elevations without pleating) and splitting depth;
- the paper length m·ℓₑ of every tree edge, the tallest elevation, the folded height (the tallest pleated height), the deepest splitting level, and the problems found by A:2 and A:1.

**As a crease graph.** To exchange the pattern as a plane graph (for example in the FOLD format), every crease is split at every vertex lying strictly inside it, and every facet's ring gets those vertices in order along its sides. A graph edge used by exactly one facet lies on the outline of the paper used and is a boundary edge. Assignments are: boundary for those, valley or mountain for pleats, flat for flat creases, and unassigned for the rest.

## 9. Correctness properties

| Property | Status | Reason |
| --- | --- | --- |
| Every inset side stays exactly tight, and no diagonal goes below its reduced length, up to the first event | Guaranteed | Lemma 2 |
| The first event is found exactly, up to root-finding precision | Guaranteed | Lemma 1 |
| A:1 terminates | Guaranteed | The depth cap d\_max; reaching it is reported |
| A:1 finishes every polygon before the cap | **Not** guaranteed | Lang's construction terminates, but the tolerances η decide when corners merge; a missed merge can recurse |
| An unreported facet folds without distortion over one tree edge | Guaranteed | Lemma 3 and A:2 Steps 2 and 4 |
| Every built pattern passes the fold check | **Not** guaranteed | Reference results include distorted facets and facets spanning two edges (Section 10); they are reported |
| Pleated heights lie in \[0, H\] | Guaranteed | Lemma 4 |
| The base folds flat without the paper passing through itself | **Not** guaranteed | The layer order is not computed |
| Axial, ridge, hinge and gusset creases have a fold direction | **Not** guaranteed | Not computed; exported as unassigned |
| A polygon side that is not tight is handled | **Not** guaranteed | The input must be a valid subdivision; A:1 Step 2 reports such a side and builds on |

## 10. Reference results

A Python prototype of A:1 and A:2 ran once on each preset layout that the closing spec's prototype search closed (closing Section 9), at the closed edge lengths.

| Tree | Leaves | Outcome |
| --- | --- | --- |
| Centipede, 2 leg pairs | 4 | built; fold check passed |
| Caterpillar | 6 | built; fold check passed |
| Beetle | 9 | built; fold check passed |
| Centipede, 4 leg pairs | 8 | built; the check reports distorted facets |
| Scorpion | 13 | built; the check reports facets spanning more than one tree edge |

## 11. Open problems

1. **Fold check failures.** Find why the 4-pair centipede and the scorpion fail the check: an inset corner merged too early or too late (η), or a hinge cut placed on the wrong side of a node in walk. Closing them makes "every built pattern passes" a guaranteed property.
2. **Fold directions.** Assign mountain and valley to axial, ridge, hinge and gusset creases from the flap stacking, as Lang's tree theory does for uniaxial bases.
3. **Layer order.** Order the layers over each flap, so the base is proved flat-foldable and can be animated.
4. **Non-tight boundary pieces.** TreeMaker also builds molecules when some boundary pieces are not tight, by treating the hull's outside as a river. Adding that would accept layouts the closing spec cannot close.
5. **Exact merging.** Replace the tolerance η by an exact event structure (corner merges and diagonal events computed symbolically), so A:1 provably finishes without the depth cap.
