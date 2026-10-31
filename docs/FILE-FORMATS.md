# Tree and layout files

All three apps read and write two JSON formats. Their JSON Schemas (draft 2020-12) are in `schemas/`.

| Format | Schema | Saved by | Opening it |
|---|---|---|---|
| `treemaker-tree` | `schemas/treemaker-tree.schema.json` | **Save tree** (Tree panel) | Loads the tree, grid size, leaf conditions and mirror pairs into the editor. |
| `treemaker-layout` | `schemas/treemaker-layout.schema.json` | **Save layout** (under the sheet) | Loads the tree, then shows the layout as if it had just been solved, and makes it the start of the next solve. |

**Open…** in the Tree panel reads either kind. It tells them apart by the `format` field.

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
- **`stretch: true`** marks an edge as part of the stretch set S. Only the base app's edge optimization uses it.
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
  "solvedBy": { "app": "Scalable MILP TreeMaker", "savedAt": "2026-10-29T16:00:00.000Z" }
}
```

- **`tree`** is the same object as a tree file, without `format` and `version`.
- **`leaves`** places every leaf exactly once, on integer points of {0, …, gridSize}².
- **`scale`** is m, in grid units per unit of tree length. It is optional. When it is missing, or larger than the layout allows, the app uses the layout's exact scale: the smallest distance divided by path length over all leaf pairs.
- **`edgeLengths`** is either null or one length per edge, in edge order. Save layout writes the closed lengths when the crease panel shows *After closing*. Opening such a file restores the closed polygons, so **Build the crease pattern** works at once.

## What opening a layout does

1. **Loads the tree.** The tree and grid size go into the editor, as with a tree file.
2. **Checks the layout.** The server endpoint `POST /api/layout` checks every pair and condition, and works out the exact scale, the tight pairs and the edge strains.
3. **Shows it as just solved.** The app shows the result as if it had just solved it: the sheet, metrics and pair table, and the **Toward a crease pattern** panel. You can check and close the polygons, build the crease pattern, view the folded base, and save .fold or .svg files.
4. **Starts the next solve from it.** Under the sheet, **Start the next solve from the imported layout** is ticked. The next solve then sends the layout as `startLayout`:
   - **Base app:** SCIP gets it as a solution hint.
   - **Optimized app:** the bisection starts from it. It is the first window centre, and when it meets every condition, its scale is a proven lower bound.
   - **Scalable app:** it replaces Stage 1. Stages 2 to 4 repair and improve around it, with the ladder reaching up to 1.25 times its scale.

The checkbox is ignored, with a note, once the tree or grid size no longer matches the layout. Opening a tree file clears it.
