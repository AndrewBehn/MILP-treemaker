# TreeMaker foundations: strain

Nov 2, 2026 · @Andrew Behn

This document defines how the edges of the tree may change length: the strain bounds, each edge's room and cost, the strained edge and path lengths, and the range each edge's strain may take. The base spec's follow-on stages (Pure MILP), the closing spec and the scalable spec's closing stage use them, and the crease spec builds on the lengths they give. It builds on the tree and the path lengths of the [sheet spec](https://claude.ai/artifact/Wkj6BjP3fGNPKLv3p3zW3C), and keeps its running example: the four-leaf tree.

**Labels.** P:n and D:n number the parameters and shared definitions of this document, each kind in order of appearance. Other documents cite them with the short name strain, as in strain D:2. Labels of the sheet spec are written sheet D:1.

## 1. Notation

Notation follows the sheet spec (sheet Section 1). A strain σₑ is the relative change of edge e's length: σₑ = 0 keeps the edge as it is, σₑ > 0 lengthens it and σₑ < 0 shortens it; σ is the vector of all strains. A trial bound s ≥ 0 is a common symmetric limit ±s on the strains that a search tries.

## 2. Parameters

**P:1 Strain bounds.** Limits on each edge's relative change, the same for every edge before its room scales them (P:2, D:3); the lower bound above −1 keeps every edge length positive, and −0.3 and 0.3 are the usual defaults.

```math
-1 < \sigma_{\min} \leq 0 \leq \sigma_{\max}
```

Used in: D:3; base P:2 and Section 8.3, scalable Section 1 and Section 8.1, closing Section 2 and A:1.

**P:2 Edge room and cost.** Optionally, a room rₑ ≥ 0 and a cost cₑ ≥ 0 for each edge, both 1 by default; the room scales the strain bounds on that edge, and rₑ = 0 locks the edge at its length, while the cost weighs the edge's strain in a least-strain objective, so an edge with a high cost is strained last.

```math
r_e \ge 0, \quad c_e \ge 0 \qquad \forall\, e \in E, \qquad r_e = c_e = 1 \text{ by default}
```

Used in: D:3; closing Section 1, Section 2, the objectives of Section 5.1, A:1, the objective of Section 6.1, A:2 and A:3.

## 3. Shared definitions

**D:1 Strained edge length.** The length of edge e once it is stretched or shrunk by its strain, starting from the length ℓₑ it had before (the tree's length of sheet P:2, or one an earlier strain gave).

```math
\ell_e(\sigma_e) = \ell_e\, (1 + \sigma_e) \qquad \forall\, e \in E
```

Used in: D:2; base Section 8.2 and Section 8.3, scalable A:6, closing Section 2, crease P:2.

**D:2 Strained path length.** The length of a pair's tree path once every edge on it is strained, which is the path length of sheet D:1 plus a term linear in σ, so a spacing condition (sheet D:2) at a fixed scale m₀ with these lengths in place of ℓᵢⱼ stays linear.

```math
\ell_{ij}(\sigma) = \sum_{e \in \mathrm{path}(i, j)} \ell_e\, (1 + \sigma_e) = \ell_{ij} + \sum_{e \in \mathrm{path}(i, j)} \ell_e\, \sigma_e, \qquad m_0\, \ell_{ij}(\sigma) \leq \|u_i - u_j\|_2 \ \ \forall\, \{i, j\} \in \mathcal{P}
```

Used in: base C:5 and C:6, scalable Section 8.1, M:9 and M:10, closing Section 3, M:1, M:2, M:5 and M:6.

In the running example, the path of pair 2–4 runs over the edges u–2, u–v and v–4, of lengths 2, 3 and 4, so ℓ₂₄(σ) = 9 + 2σᵤ₂ + 3σᵤᵥ + 4σᵥ₄. Shortening any of these three edges gives the tight pair 2–4 room at a fixed scale.

**D:3 Edge bounds.** Each edge strains within the bounds of P:1 times its room (P:2), and never below a floor σfloor > −1 (−0.99 by default), so every length stays positive; a trial bound ±s gives edge e the range ±rₑs in the same way, so s is the bound on an edge whose room is 1, and a locked edge keeps its length.

```math
\underline{\sigma}_e = \max(r_e\, \sigma_{\min},\ \sigma_{\mathrm{floor}}), \qquad \overline{\sigma}_e = r_e\, \sigma_{\max}, \qquad \underline{\sigma}_e \leq \sigma_e \leq \overline{\sigma}_e \qquad \forall\, e \in E
```

Used in: base Section 8.3 (every room 1), scalable Section 8.1, closing Section 2, Section 3, the variables of Section 5.1 and Section 6.1, M:7, Lemma 3, Section 7 and Lemma 5.
