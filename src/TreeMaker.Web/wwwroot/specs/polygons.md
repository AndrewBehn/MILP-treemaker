# TreeMaker foundations: tight pairs and polygons

Nov 2, 2026 · @Andrew Behn

This document defines when the tight pairs of a grid layout divide the leaves' convex hull into polygons that Lang's universal molecule can fill, the greedy triangulation that proposes which pairs to make tight, and the exact test that decides validity. The closing spec, the scalable spec and the crease spec use them. It builds on the tree, grid and spacing condition of the [sheet spec](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), and keeps its running example: the four-leaf tree at its optimum on a 9 × 9 grid.

**Labels.** D:n and A:n number the shared definitions and algorithms of this document, each kind in order of appearance. Other documents cite them with the short name polygons, as in polygons D:3 or polygons A:1. Labels of the sheet spec are written sheet D:2.

## 1. Notation

Notation follows the sheet spec (sheet Section 1). The inputs are a layout u (sheet Section 3), a scale m at which every pair fits, and the edge lengths under which the path lengths ℓᵢⱼ are taken (sheet D:1). The symbols and terms below are added here.

| Symbol or term | Meaning |
| --- | --- |
| Dᵢⱼ | The Euclidean distance ‖uᵢ − uⱼ‖₂ between two leaves of the layout |
| Segment | The straight piece uᵢuⱼ between two leaf points |
| H, ∂H | The convex hull of the leaf points, and its boundary |
| Face | A region of the hull bounded by segments; a bounded face is a polygon |
| Simple, convex, empty | A face is simple when no leaf repeats along its boundary, convex when no corner turns inward, and empty when no leaf lies strictly inside it |
| area(F) | The area of a face or of the hull |
| Active path | The segment of a tight pair, along which its two leaf circles touch |
| Universal molecule | Lang's crease construction that fills one valid polygon (in the crease spec) |

## 2. Shared definitions

The running example's optimum on the 9 × 9 grid puts leaf 1 at (0, 0), leaf 2 at (0, 6), leaf 3 at (9, 0) and leaf 4 at (9, 9), at m\* = 1.054.

**D:1 Tight pair.** A pair whose leaves are exactly at their minimum distance m·ℓᵢⱼ (sheet D:2), up to a relative tolerance τ (10⁻⁶ by default); its segment is an active path, and S is the set of tight pairs.

```math
\text{tight}_{ij} \iff \lvert D_{ij} - m\, \ell_{ij} \rvert \le \tau \max(1, D_{ij}), \qquad S = \{\, \{i, j\} \in \mathcal{P} : \text{tight}_{ij} \,\}
```

Used in: D:3, A:1 and Lemma 1; scalable Section 2 and D:2, closing Section 1, P:3, Section 3 and Lemma 1, crease A:1. In the running example only pair 2–4 is tight: its distance √90 ≈ 9.487 equals 1.054 × 9, and every other pair has slack.

**D:2 Hull and boundary pieces.** H is the convex hull of the leaf points, and its boundary pieces B are the pairs of leaves that are consecutive along the hull's boundary, counting leaves that lie on a hull side between its corners.

```math
B = \{\, \{i, j\} : u_i, u_j \in \partial H,\ \text{no leaf strictly between } u_i \text{ and } u_j \text{ on } \partial H \,\}
```

Used in: D:3, D:4 and A:1; scalable D:5, closing Section 3, D:1, A:1, A:2 and Lemma 3. In the running example all four leaves are hull corners, and B = {1–2, 1–3, 3–4, 2–4}.

**D:3 Valid subdivision.** The tight pairs give a valid subdivision when their segments, split at any leaf lying on them, cross nowhere, and their bounded faces are simple, convex, free of leaves in their interiors, and together cover H exactly; this is the condition the universal molecule needs.

```math
\text{valid}(S) \iff \text{no crossings} \ \wedge\ \forall F: F \text{ simple, convex, empty} \ \wedge\ \textstyle\sum_F \operatorname{area}(F) = \operatorname{area}(H) > 0
```

Used in: A:1; scalable Section 2, closing Section 1, Section 3, Section 4 and Lemma 3, crease P:5. A valid subdivision has every boundary piece tight, since otherwise some of H is left uncovered. The running example's optimum is not valid: of the four boundary pieces only 2–4 is tight.

**D:4 Greedy triangulation.** Given a set K of segments to keep, Δ(K) adds pairs in order of increasing Dᵢⱼ (ties by leaf name), skipping any pair whose segment passes through a third leaf or properly crosses a segment already taken; the result is a maximal non-crossing set, so its bounded faces are triangles with no leaf inside, and it contains every boundary piece.

```math
\Delta(K) \supseteq K \cup B, \qquad \Delta(K) \text{ maximal non-crossing}
```

Used in: scalable Section 2, A:5 and Section 8.1, closing Section 3, A:1, A:2 and Lemma 4. In the running example Δ(S) takes 1–2 (length 6), 1–3 and 3–4 (9 each), 2–4 (9.49) and 2–3 (10.82), and skips 1–4, which crosses 2–3: two triangles, 1–3–2 and 2–3–4.

## 3. The polygon test

The test reads a layout and its tight pairs and reports whether they form a valid subdivision (D:3), and if not, every reason why. It solves no model.

**A:1 PolygonTest.** Input: the leaf points u and the tight pairs S (D:1) at the current lengths.

1. **Segments.** For each tight pair {i, j}, list the leaves lying strictly inside the segment uᵢuⱼ, in order of distance from uᵢ, and add each consecutive piece as a segment. The result is the segment set G.
2. **Crossings.** For every two segments of G with no shared end, record a crossing when each one's ends lie strictly on opposite sides of the other's line.
3. **Faces.** Sort each leaf's segments by angle. Walk every directed segment, turning to the next segment clockwise at each leaf, so the face lies on the left. Each closed walk with positive signed area is a bounded face F; the walks with area 0 or less are the outer face or the two sides of a dangling segment.
4. **Each face.** For every bounded face:
   1. *Simple*: no leaf repeats along the walk; a repeat means a segment dangles into the face.
   2. *Convex*: no three consecutive corners turn right (straight runs are allowed).
   3. *Empty*: no leaf other than its corners lies strictly inside (winding number).
5. **Hull.** Build H with a monotone chain and list its boundary pieces B (D:2). Each piece not in G is *missing*.
6. **Cover.** Sum the bounded faces' areas and compare with H's area.
7. **Verdict.** Valid when H has positive area, there are no crossings and no missing pieces, every face is simple, convex and empty, and the faces cover H. Otherwise report each failure: crossings, missing boundary pieces, dangling, non-convex or occupied faces, and uncovered area.

Used in: scalable Section 2, Section 8, A:6 and Section 10, closing Section 1, Section 4, A:1, A:2, Lemma 4, A:3, Lemma 5 and Section 8, crease Section 8.

The test stops after one pass over the pairs, segments and faces; with n leaves it takes O(n⁴) time in the worst case (Step 2 over O(n²) segments), far below any solve. On the running example's optimum it finds one segment, 2–4, no bounded face, and three missing boundary pieces, 1–2, 1–3 and 3–4, so the verdict is not valid.

**Lemma 1.** Every decision in A:1 except tightness is exact. *Proof.* Leaf points are integers, so every orientation test, area and point-in-polygon test is an integer cross product, computed without rounding. Only D:1 compares a square root with m·ℓᵢⱼ, under the tolerance τ.

Used in: closing Section 1, Section 4 and Section 8.
