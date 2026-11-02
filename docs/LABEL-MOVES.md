# Label moves of 2 November 2026 (docs/DOC-TREE.md)

Old label → new label, per document, when the specs were split into the tree and its foundations. Code comments and old links that cite the old labels map through this list.

```
closing: P:1,P:2,P:3 -> sheet P:1-P:3; P:6 -> strain P:1; P:8 -> strain P:2; D:1 -> strain D:2; D:2 -> polygons D:1; D:3 -> polygons D:2; D:4 -> polygons D:3; D:5 -> polygons D:4; D:7 -> strain D:3; A:1 -> polygons A:1; Lemma 1 -> polygons Lemma 1
closing: P:4->P:1, P:5->P:2, P:7->P:3; D:6->D:1; A:2->A:1, A:3->A:2, A:4->A:3; Lemma 2..6 -> 1..5; M:1-M:8, sections unchanged
crease: no label changes; cites closing P:1 (layout), P:2 (scale), Section 9
USES closing: sheet P:1-P:3, D:2; strain P:1,P:2,D:1,D:2,D:3; polygons D:1-D:4, A:1, Lemma 1
USES crease: sheet P:1,P:2,D:1,D:2; strain D:1; polygons D:1,D:3,A:1
lattice-hull sections: 3 removed (sheet Section 3, offsets Section 1); 5 removed; 4->3, 6->4, 7->5, 8->6, 9->7, 10->8 (10.1-10.6 -> 8.1-8.6), 11->9, 12->10
lattice-hull labels: P:1-P:3 -> sheet P:1-P:3; P:4 -> P:1; P:5,P:6,P:7 -> hulls P:1,P:2,P:3; D:1 -> sheet D:1; D:2 -> hulls D:1; D:3 -> offsets D:2; D:4 -> sheet D:3; D:5 -> offsets D:3; D:6 -> hulls D:3; D:7 -> hulls D:4 (full windows hulls D:2); C:1,C:2 unchanged
optimized sections: 3 removed (lattice-hull 3-6 + hulls); 5 removed (lattice-hull 7, 8.2, 9; offsets D:3); 6 removed (lattice-hull 8.3-8.6, 9, 10); 6.9 step1 -> 3.3; 4->3 (4.3->3.1, 4.4->3.2, 4.5->3.4, 4.6->3.5); 7->4 (7.1->4.1, 7.2->4.2)
optimized labels: P:1 -> lattice-hull P:1; D:1 -> hulls D:1; D:2 -> hulls D:2; C:1 -> lattice-hull C:2; P:2 -> conditions P:2; C:2 -> conditions C:6; C:3 -> conditions C:7; D:3 -> offsets D:3; P:3-P:5 -> hulls P:1-P:3; D:4 -> hulls D:3; C:4 -> lattice-hull C:1; D:5 -> hulls D:4; C:5 -> lattice-hull C:2
USES lattice-hull: sheet P:1-P:3,D:1-D:3,Sec 1,3; offsets D:1,D:3,Sec1; hulls D:1-D:4,P:1-P:3,Sec1,5
USES optimized: conditions P:2,D:1,C:6,C:7,Lemma 1; hulls D:1,D:2,D:4,P:1-P:3; offsets D:1,D:3; sheet P:1-P:3
base labels: P:1-P:3 -> sheet P:1-P:3; D:1 -> sheet D:1; D:2 -> offsets D:2; D:3 -> sheet D:3; P:4 -> P:1; P:5 -> P:2; P:6 -> strain P:1; D:4 -> D:1; C:1-C:7 unchanged; candidate offsets set -> offsets D:1
base sections: 3,4,5 removed (sheet/offsets); 6->3; 7->4; 7.1-7.5 removed -> conditions C:1-C:5; 8->5; 9->6; 10->7; 11->8 (11.1/11.2/11.3 -> 8.1/8.2/8.3); 12->9
symmetry-breaking labels: P:1-P:3 -> sheet P:1-P:3; P:4 -> conditions P:2; D:1 -> sheet D:1; D:2 -> offsets D:2; D:3 -> sheet D:3; C:1-C:4 -> base C:1-C:4; C:5 -> conditions C:6; C:6 -> conditions C:7; set T -> conditions D:1
symmetry-breaking sections: 3,4,5 removed; 6,7 -> 3; 8 -> 4; 9 -> 5; 10 -> 6
USES base: sheet Sec1,3,P:1-P:3,D:1,D:2,D:3; offsets Sec1,D:1,D:2; conditions P:1,C:1-C:7,Lemma 1; strain P:1,D:1,D:2,D:3
USES symmetry-breaking: conditions Sec1,P:1,P:2,D:1,C:1-C:7,Lemma 1,Sec4; sheet Sec1,D:2,D:3; offsets D:1,D:2
scalable: P:1 -> sheet P:1,P:2; P:2 -> sheet P:3; P:3 -> conditions P:1 (C:1,C:2,C:4,C:5); P:4 -> conditions C:3; P:5 -> strain P:1
scalable: D:1 -> sheet D:1; D:2 -> sheet D:2; D:3 -> sheet D:3; D:6 -> offsets D:3; D:9 -> polygons D:4; D:11 -> polygons D:1,D:3,A:1
scalable: P:6..P:18 -> P:1..P:13 (minus 5)
scalable: D:4->D:1, D:5->D:2, D:7->D:3, D:8->D:4, D:10->D:5, D:12->D:6, D:13->D:7, D:14->D:8
scalable: M, A, Lemmas, Sections unchanged
USES scalable: sheet P:1,P:2,P:3,D:1,D:2,D:3,Section 3; offsets D:1,D:3; conditions P:1,C:1-C:5; hulls D:1,P:3; strain P:1,D:1,D:2,D:3; polygons D:1-D:4,A:1
```
