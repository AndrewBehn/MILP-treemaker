// The tree and the sheet are one widget: what you point at in one lights up in the other.
//   Hover a leaf (either side)       the leaf, its circle and its tight pairs on the sheet; the leaf and its edge
//                                    on the tree
//   Hover a pair on the sheet        both leaves, and the path between them in the tree: the path whose length the
//                                    pair's spacing is measured by
//   Click a leaf on the sheet        keeps it lit (click again, or on empty paper, to let go); on the tree, a click
//                                    does the same in the steps after a layout, where the tree is locked
// Both drawings call linked.apply() after they redraw, so the highlight survives redraws.
"use strict";

const linked = (() => {
  let hover = null;    // { leaves: [..] } from the pointer
  let pinned = null;   // a leaf kept lit by a click

  const q = (id) => document.getElementById(id);

  /** The tree edges (by index) on the path between two vertices. */
  function pathEdges(a, b) {
    const info = treeInfo(state.edges);
    if (!info.adjacency.has(a) || !info.adjacency.has(b)) return [];
    const prev = new Map([[a, null]]);
    const queue = [a];
    for (let k = 0; k < queue.length && !prev.has(b); k++) {
      for (const { to, edge } of info.adjacency.get(queue[k])) if (!prev.has(to)) { prev.set(to, [queue[k], edge]); queue.push(to); }
    }
    const edges = [];
    for (let v = b; prev.get(v); v = prev.get(v)[0]) edges.push(prev.get(v)[1]);
    return edges;
  }

  function apply() {
    const tree = q("treeView"), sheet = q("layoutView");
    if (!tree || !sheet) return;
    for (const el of document.querySelectorAll(".lit, .lit-path")) el.classList.remove("lit", "lit-path");
    const focus = hover ?? (pinned ? { leaves: [pinned] } : null);
    tree.classList.toggle("has-lit", !!focus);
    sheet.classList.toggle("has-lit", !!focus);
    if (!focus) return;
    const leaves = new Set(focus.leaves);
    for (const leaf of leaves) {
      tree.querySelector(`.vertex-group[data-vertex="${CSS.escape(leaf)}"]`)?.classList.add("lit");
      for (const el of sheet.querySelectorAll(`[data-leaf="${CSS.escape(leaf)}"]`)) el.classList.add("lit");
    }
    // Pairs on the sheet: the one hovered, or every tight pair of a single leaf.
    for (const line of sheet.querySelectorAll(".pair")) {
      const a = line.dataset.a, b = line.dataset.b;
      const on = focus.leaves.length === 2 ? leaves.has(a) && leaves.has(b) : (leaves.has(a) || leaves.has(b)) && line.classList.contains("tight");
      if (on) line.classList.add("lit");
    }
    // Edges in the tree: the path between the two leaves of a pair, or a single leaf's own edge.
    const [a, b] = focus.leaves;
    const edges = b ? pathEdges(a, b) : (treeInfo(state.edges).adjacency.get(a) ?? []).map((n) => n.edge);
    for (const k of edges) tree.querySelector(`[data-edge-line="${k}"]`)?.classList.add("lit-path");
  }

  function set(next) {
    const key = (f) => f?.leaves.join("|") ?? "";
    if (key(next) === key(hover)) return;
    hover = next;
    apply();
  }

  function pin(leaf) {
    pinned = leaf && leaf !== pinned ? leaf : null;
    apply();
  }

  function init() {
    const tree = q("treeView"), sheet = q("layoutView");
    tree.addEventListener("pointerover", (e) => {
      if (treeUi.drag) return;
      const g = e.target.closest(".vertex-group");
      set(g && treeInfo(state.edges).leaves.includes(g.dataset.vertex) ? { leaves: [g.dataset.vertex] } : null);
    });
    tree.addEventListener("pointerleave", () => set(null));
    sheet.addEventListener("pointerover", (e) => {
      const leafEl = e.target.closest("[data-leaf]");
      const pair = e.target.closest(".pair");
      if (leafEl && !leafEl.classList.contains("leaf-circle")) set({ leaves: [leafEl.dataset.leaf] });
      else if (pair) set({ leaves: [pair.dataset.a, pair.dataset.b] });
      else set(null);
    });
    sheet.addEventListener("pointerleave", () => set(null));
    sheet.addEventListener("click", (e) => {
      if (document.body.dataset.node === "stubs") return;   // there a click places the stub
      const leafEl = e.target.closest("[data-leaf]:not(.leaf-circle)");
      pin(leafEl ? leafEl.dataset.leaf : null);
    });
  }

  /** Forget the highlight (a new node or a new tree). */
  function reset() { hover = null; pinned = null; apply(); }

  return { init, apply, pin, reset };
})();
