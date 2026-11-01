# Tree and layout files

The TreeMaker app reads and writes two JSON formats. Their JSON Schemas (draft 2020-12) are in `schemas/`.

| Format | Schema | Saved by | Opening it |
|---|---|---|---|
| `treemaker-tree` | `schemas/treemaker-tree.schema.json` | **Save tree** (Tree panel) | Loads the tree, grid size, leaf conditions and mirror pairs into the editor. |
| `treemaker-layout` | `schemas/treemaker-layout.schema.json` | **Save layout** (under the sheet, or the map's Layout card) | Loads the tree, then puts the layout on the workbench, where the steps after a solve and the next solve start from it. |

**Open…** in the Tree panel, **Open a file…** on the map, and **Open a layout file…** in the steps' sidebar read either kind. It tells them apart by the `format` field.

## Tree file

```json
{
  "format": "treemaker-tree",
  "version": 1,
  "name": "Centipede, 2 leg pairs",
  "gridSize": 12,
  "edges": [
    { "from": "L1", "to": "b1", "length": 1 },
    { "from": "R1", "to": "b1", "length": 1 },
    { "from": "L2", "to": "b2", "length": 1 },
    { "from": "R2", "to": "b2", "length": 1 },
    { "from": "b1", "to": "b2", "length": 1 }
  ],
  "mirrorPairs": [ { "a": "L1", "b": "R1" }, { "a": "L2", "b": "R2" } ]
}
```

- **Edges** must form one tree. The leaves are the vertices of degree 1, and the order of `edges` is the edge index that layout files use.
- **`stretch: true`** marks an edge as part of the stretch set S. Only edge optimization (Pure MILP and Symmetry-Breaking MILP) uses it.
- **`leafConditions`** entries are `{ "leaf", "kind", "x", "y" }`:
  - `kind` is one of LeftEdge, RightEdge, BottomEdge, TopEdge, BottomLeftCorner, BottomRightCorner, TopLeftCorner, TopRightCorner, OnSymmetryAxis or Fixed.
  - `x` and `y` are used only by Fixed.
- **`mirrorPairs`** entries `{ "a", "b" }` mean x_a + x_b = N and y_a = y_b.
- **`gridSize`** is optional. Without it, the app keeps its current grid size.

## Layout file

```json
{
  "format": "treemaker-layout",
  "version": 1,
  "tree": { "edges": [ … ], "mirrorPairs": [ … ] },
  "gridSize": 12,
  "scale": 4.123106,
  "edgeLengths": null,
  "leaves": [
    { "leaf": "L1", "x": 0, "y": 0 }, { "leaf": "R1", "x": 12, "y": 0 },
    { "leaf": "L2", "x": 1, "y": 12 }, { "leaf": "R2", "x": 11, "y": 12 }
  ],
  "solvedBy": { "app": "TreeMaker · Scalable MILP", "savedAt": "2026-10-29T16:00:00.000Z" }
}
```

- **`tree`** is the same object as a tree file, without `format` and `version`.
- **`leaves`** places every leaf exactly once, on integer points of {0, …, gridSize}².
- **`scale`** is m, in grid units per unit of tree length. It is optional. When it is missing, or larger than the layout allows, the app uses the layout's exact scale: the smallest distance divided by path length over all leaf pairs.
- **`edgeLengths`** is either null or one length per edge, in edge order. Save layout writes the closed lengths when the crease panel shows *After closing*. Opening such a file restores the closed polygons, so **Build the crease pattern** works at once.

- **`solvedBy.app`** names the part of the app that saved it, such as `TreeMaker · Scalable MILP`. Files from the earlier separate apps say `Scalable MILP TreeMaker` and the like; both read the same.

## What opening a layout does

1. **Loads the tree.** The tree and grid size go into the editor, as with a tree file.
2. **Checks the layout.** The server endpoint `POST /api/pure/layout` checks every pair and condition, and works out the exact scale, the tight pairs and the edge strains.
3. **Puts it on the workbench.** It becomes the workbench layout, replacing the one there and clearing the closed polygons and crease pattern. Wherever you are, the page shows it:
   - **On the map,** the Layout card shows it, with **Continue: Close the polygons**.
   - **In a step** (Close the polygons, Crease pattern, Folded base), the sheet shows it and the step starts from it.
   - **In a solver,** it is shown as if that solver had just found it (read back through that solver's `/layout` endpoint), with the crease panel ready.
4. **Starts the next solve from it.** Under the sheet, **Start the next solve from the workbench layout** is ticked. The next solve then sends the layout as `startLayout`:
   - **Pure MILP and Symmetry-Breaking MILP:** SCIP gets it as a solution hint (first turned into the fundamental domain when symmetry breaking is on).
   - **Optimized MILP and Lattice-Hull MILP:** the bisection starts from it. It is the first window centre, and when it meets every condition, its scale is a proven lower bound.
   - **Scalable MILP:** it replaces Stage 1. Stages 2 to 4 repair and improve around it, with the ladder reaching up to 1.25 times its scale.

The box is greyed out, with a note, while the tree or grid size in the editor does not match the layout.
