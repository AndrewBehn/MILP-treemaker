// The workbench: what carries over from one part of the app to the next.
//   tree     the tree in the editor (with grid size, leaf conditions and mirror pairs); every solver reads it
//   layout   the last layout found or opened: which node made it, its problem, leaf points, scale and edge lengths
//   closure  the last attempt to close that layout's polygons (the /api/complete answer and its strain bounds)
//   creases  the last crease pattern built from it (the /api/creases answer)
// A new result replaces its own slot and clears the slots after it, since they were made from the old one.
// Everything is kept in localStorage, so the workbench survives a reload; a failed write only loses persistence.
"use strict";

const workbench = (() => {
  const KEY = "treemaker.workbench.v1";
  const listeners = [];
  let data = { tree: null, layout: null, closure: null, creases: null };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object") data = { ...data, ...saved };
  } catch { /* private window or blocked storage: start empty */ }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Too large (a big crease pattern) or blocked: keep everything but the crease pattern, then nothing.
      try { localStorage.setItem(KEY, JSON.stringify({ ...data, creases: null })); } catch { /* in memory only */ }
    }
  }

  function emit(slot) {
    persist();
    for (const fn of listeners) {
      try { fn(slot, data); } catch (e) { console.error(e); }
    }
  }

  const now = () => new Date().toISOString();

  return {
    get tree() { return data.tree; },
    get layout() { return data.layout; },
    get closure() { return data.closure; },
    get creases() { return data.creases; },

    onChange(fn) { listeners.push(fn); },

    /** The editor's tree; saved quietly (no listeners), since it changes on every edit. */
    setTree(problem) {
      data.tree = problem;
      persist();
    },

    /**
     * A new layout. layout = { node, problem, gridSize, points: [{leaf, x, y}], scale, edgeLengths, status, note }.
     * Clears the closure and the crease pattern, which belonged to the old layout.
     */
    setLayout(layout) {
      // Every layout gets an id, kept when a layout is put back.
      data.layout = layout ? { ...layout, lid: layout.lid ?? Math.random().toString(36).slice(2, 10), at: now() } : null;
      data.closure = null;
      data.creases = null;
      emit("layout");
    },

    /** Adds facts about the held layout (such as whether its polygons are valid) without clearing anything. */
    noteLayout(patch) {
      if (!data.layout) return;
      data.layout = { ...data.layout, ...patch };
      emit("note");
    },

    /** The latest closing of the layout's polygons; clears the crease pattern. */
    setClosure(closure) {
      data.closure = closure ? { ...closure, at: now() } : null;
      data.creases = null;
      emit("closure");
    },

    /** The latest crease pattern. */
    setCreases(creases) {
      data.creases = creases ? { ...creases, at: now() } : null;
      emit("creases");
    },

    clear(slot) {
      if (slot === "layout") this.setLayout(null);
      else if (slot === "closure") this.setClosure(null);
      else if (slot === "creases") this.setCreases(null);
    },

    /** The edge lengths the steps after closing should use: the closed ones when the closure made valid polygons. */
    closedLengths() {
      const c = data.closure;
      return c?.completion?.after?.valid ? c.completion.edgeLengths.map((e) => e.newLength) : null;
    },

    /** Whether the held layout's polygons are known to be valid, before or after closing. */
    polygonsValid() {
      return !!(data.closure?.completion?.after?.valid || data.layout?.polygonsValid);
    },
  };
})();

/** True when two problems have the same tree shape (edge endpoints, in order) and grid size. */
function sameTreeShape(a, b) {
  if (!a || !b || a.gridSize !== b.gridSize || a.edges.length !== b.edges.length) return false;
  return a.edges.every((e, k) => e.from === b.edges[k].from && e.to === b.edges[k].to);
}
