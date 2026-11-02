# TreeMaker

One app for TreeMaker's circle-packing problem on an N × N grid, with every specification and the steps after it in one place. It is a C# / .NET 10 ASP.NET Core app with a browser UI that runs in the same process as the solvers (SCIP, GLOP and CP-SAT through Google OR-Tools).

## The specs

Every part of the app implements one of these model and algorithm specifications. Read them in the running app (**Specs ↗**, with figures and typeset maths), in the repository as Markdown, or as the live documents on claude.ai, where they are written.

| Spec | What it specifies | In the app (map node) | Code | Read it |
|---|---|---|---|---|
| [Pure MILP TreeMaker](src/TreeMaker.Web/wwwroot/specs/pure.md) | The base model: TreeMaker's scale optimization as one exact MILP on an N × N grid, with edge and strain stages. | Tree, Pure MILP | `src/TreeMaker.Pure`, `src/TreeMaker.Core` | [in the repo](src/TreeMaker.Web/wwwroot/specs/pure.md) · [live doc](https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4) |
| [Symmetry-Breaking MILP TreeMaker](src/TreeMaker.Web/wwwroot/specs/sym.md) | The base model plus an anchor leaf in the fundamental domain (C:5) and siblings in order (C:6). | Symmetry-Breaking MILP | `src/TreeMaker.Pure`, `src/TreeMaker.Core/SymmetryBreaking.cs` | [in the repo](src/TreeMaker.Web/wwwroot/specs/sym.md) · [live doc](https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN) |
| [Lattice-Hull MILP TreeMaker](src/TreeMaker.Web/wwwroot/specs/hull.md) | Lattice hulls at a fixed scale, bisection over candidate scales and incremental generation, without symmetry breaking. | Lattice-Hull MILP | `src/TreeMaker.Optimized` | [in the repo](src/TreeMaker.Web/wwwroot/specs/hull.md) · [live doc](https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6) |
| [Optimized MILP TreeMaker](src/TreeMaker.Web/wwwroot/specs/optimized.md) | The exact model made fast: lattice hulls, symmetry breaking, scale search and incremental solving together. | Optimized MILP | `src/TreeMaker.Optimized` | [in the repo](src/TreeMaker.Web/wwwroot/specs/optimized.md) · [live doc](https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq) |
| [Scalable MILP TreeMaker](src/TreeMaker.Web/wwwroot/specs/scalable.md) | Good layouts for 25 to 100 leaves without an optimality proof: continuous LPs, CP-SAT repair, neighbourhood search and a closing finish. | Scalable MILP | `src/TreeMaker.Scalable` | [in the repo](src/TreeMaker.Web/wwwroot/specs/scalable.md) · [live doc](https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29) |
| [Polygon Closing TreeMaker](src/TreeMaker.Web/wwwroot/specs/closing.md) | After a layout: the polygon test, closing the polygons by strain, strain bounds and the strain needed. | Close the polygons | `src/TreeMaker.Core` | [in the repo](src/TreeMaker.Web/wwwroot/specs/closing.md) · [live doc](https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4) |
| [Crease Pattern TreeMaker](src/TreeMaker.Web/wwwroot/specs/crease.md) | From closed polygons to creases: universal molecules, the folded base and its check, and pleats. | Crease pattern, Folded base | `src/TreeMaker.Core/CreasePattern.cs` | [in the repo](src/TreeMaker.Web/wwwroot/specs/crease.md) · [live doc](https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp) |

- **In the repo.** The Markdown copies are the ones the app serves, refreshed from the live docs (revisions in [`manifest.json`](src/TreeMaker.Web/wwwroot/specs/manifest.json)). GitHub shows them with the maths typeset and the figures in place. The figures are SVG files in `specs/figures/`, the same files the app's docs page shows.
- **Live docs.** The claude.ai links are the documents as they are being written. They open for people the owner has shared them with.
- **How they relate.** The four derived solver specs build on Pure MILP; Pure MILP hands off to Optimized MILP; Lattice-Hull MILP cites Symmetry-Breaking MILP; Scalable MILP cites Optimized MILP. Polygon Closing builds on Pure MILP and cites Scalable MILP, and hands off to Crease Pattern, which builds on Polygon Closing and Pure MILP. The app's map draws the same graph.

## Run

You need the .NET 10 SDK. From this folder (the repository root):

```sh
dotnet run
```

It builds everything and opens <http://localhost:5080> in your browser: the map, the session from a tree to a crease pattern, and the specs, all in one app. To use another port, add `--urls http://localhost:6000` after `--`, as in `dotnet run -- --urls http://localhost:6000`.

To build or run every test, also from the root:

```sh
dotnet build
dotnet test
```

The root project, `TreeMaker.csproj`, is only the entry point: it compiles nothing itself; it builds the app (`src/TreeMaker.Web`), the shared library and the three solvers (`src/`) and their four test projects (`tests/`), runs the app, and hands `dotnet test` to the test projects. Open it in an IDE to get all of them.

## The map

The first screen is a map of the specs and the steps after them, drawn like the document graph. Every box opens **the session** (below) at its step: the live step when it is that box, a new step when the live step allows it (a solver after the tree or after a layout; Close the polygons, Add stubs or Crease pattern after a layout), and otherwise the latest step of that kind, shown in place; **← Map** in the top bar brings you back, and the browser's back button works too. Each box's **Spec ↗** tag opens its document in the docs tab (see *The specs, in the app* below).

| Map node | Route | Spec, and where in it | What runs | API |
|---|---|---|---|---|
| Tree | `#/tree` | [Pure MILP](src/TreeMaker.Web/wwwroot/specs/pure.md), parameters P:1–P:3; conditions, Sections 7.1–7.5 | The tree editor, grid size, leaf conditions and mirror pairs | none |
| Pure MILP | `#/pure` | [Pure MILP](src/TreeMaker.Web/wwwroot/specs/pure.md), Sections 3–8 and 11 | The base model as one MILP (SCIP); scale, edge and strain stages | `/api/pure/*` |
| Symmetry-Breaking MILP | `#/sym` | [Symmetry-Breaking MILP](src/TreeMaker.Web/wwwroot/specs/sym.md), C:5 and C:6 | The base model with the anchor leaf in the fundamental domain and siblings in order | `/api/pure/*` with `symmetryBreaking: true` |
| Lattice-Hull MILP | `#/hull` | [Lattice-Hull MILP](src/TreeMaker.Web/wwwroot/specs/hull.md), Sections 8 and 10 | Lattice-hull feasibility tests and bisection over candidate scales, without symmetry breaking | `/api/optimized/*` with `options.symmetryBreaking: false` |
| Optimized MILP | `#/optimized` | [Optimized MILP](src/TreeMaker.Web/wwwroot/specs/optimized.md), Section 7 | Lattice hulls, symmetry breaking, pair and facet generation, leaf windows, border seed | `/api/optimized/*` |
| Scalable MILP | `#/scalable` | [Scalable MILP](src/TreeMaker.Web/wwwroot/specs/scalable.md), Section 9 | Continuous LP, CP-SAT repair, neighbourhood search, foldability finish | `/api/scalable/*` |
| Strain the edges | `#/close` | [Polygon Closing](src/TreeMaker.Web/wwwroot/specs/closing.md), A:1 to A:4 (Sections 4–7) | Check the polygons; change edge lengths (strain) until they close; find the smallest strain | `/api/polygons`, `/api/complete`, `/api/strain-needed` |
| Add stubs (optional) | `#/stubs` | [Polygon Closing](src/TreeMaker.Web/wwwroot/specs/closing.md), open problem 1 (Section 10) | Hang a short new leaf edge inside an open polygon; then close again | none: computed in the browser (`stubs.js`), checked by `/api/polygons` |
| Crease pattern | `#/creases` | [Crease Pattern](src/TreeMaker.Web/wwwroot/specs/crease.md), A:1 and A:3 (Sections 4, 5, 7 and 8) | Universal molecules, pleats, .fold and .svg | `/api/creases` |
| Folded base | `#/fold` | [Crease Pattern](src/TreeMaker.Web/wwwroot/specs/crease.md), A:2 (Section 6) | The base in 3D | (from the crease pattern) |

Every box links its spec. The step specs are Polygon Closing TreeMaker (which builds on Pure MILP, cites Scalable MILP and hands off to Crease Pattern) and Crease Pattern TreeMaker (which builds on Polygon Closing and Pure MILP); their references follow the pipeline arrows. The solver boxes sit in one frame with the references between their specs drawn as in the document graph: the four derived specs build on Pure MILP, Pure MILP hands off to Optimized MILP, Lattice-Hull MILP cites Symmetry-Breaking MILP, and Scalable MILP cites Optimized MILP. Each solver box also says whether it suits the tree in the editor, from the timings below.

The node definitions are in `src/TreeMaker.Web/wwwroot/nodes.js`. What a solver family sends and shows is in `solvers.js`; the map is `map.js`.

## The specs, in the app

All seven specification documents are packaged with the app and served by it, so the mathematics and the running solvers can be shared together, and read offline.

- **A tab of their own.** The docs open in a separate browser tab (`docs.html`), so reading stays apart from the working app. Every link from the app goes to that one tab, and every link from a doc back to the app goes to the app's tab, so the two tabs don't multiply.
- **Opening them.** On the map, a box opens its part of the app and its **Spec ↗** tag opens its document; **Read the specs ↗** lists them all. In a part of the app, the **Spec ↗** link in the top bar, the spec line under its title, and any section or label in the sidebar (such as `§6` or `C:4`) open the right document at the right place. **Specs ↗** in the top bar lists them.
- **In the docs tab.** The side bar lists the specs and the sections of the one shown. Section numbers and labels (P:, D:, C:, M:, A:, lemmas) are links, also between docs ("base C:1" opens the Pure MILP spec at C:1). Each doc names the parts of the app that implement it, and a tag at each section a part cites opens that part in the app's tab. **Open the app ↗** goes back to the map.
- **Figures and maths.** The figures are drawn from the docs' own figure code into SVG files (static pictures), and the maths is typeset with KaTeX, which is bundled (`wwwroot/vendor/katex`).
- **Links.** The docs tab's address holds the passage, such as `docs.html#/scalable:A-4`, so a link to it can be shared. The live docs on claude.ai are only where the specs are written; reading them here needs no network and no claude.ai account.
- **Keeping them current.** The packaged copies are `wwwroot/specs/*.md` (text and maths) and `wwwroot/specs/figures/<doc>/NN.svg` (figures, linked from the text), with `manifest.json` recording each doc's revision. GitHub and the app show the same files, so the two views always agree. They are refreshed from the live docs with `tools/extract_spec_exports.py` (CLAUDE.md, "Specification documents", has the steps). The docs tab shows the revision and export date of the copy it shows.

The docs page is `src/TreeMaker.Web/wwwroot/docs.html`, driven by `specs.js`.

## The session

The work view is one document, **the session** (`workflow.js`). It runs from a tree to a crease pattern, with every step in order. Step 1 is always the tree. Then come solves, closings and stubs, and, if all goes well, the crease pattern with its folded base.

- **Each step holds its settings, its input and its output.** The input and output are drawn as tree widgets: the state's tree beside its sheet, both in grid units, with the leaf circles, polygons, tight paths, loose hull sides and, once built, the creases. The output marks what the step changed:
  - added edges and stubs in red;
  - changed lengths in amber, with their values;
  - moved leaves, with a ghost where they were.

  Under them are the step's notes and what is still open. Every step names its spec and section, linked into the docs tab.
- **Only the last step is live.** Its settings are the controls for that kind of step:
  - the tree editor, grid size, leaf conditions and mirror pairs for the tree;
  - a solver's model and settings for a solve;
  - the bounds for closing;
  - the stub, picked on the live sheet and tree;
  - the pleats for the crease pattern.

  Running it replaces its output. Every earlier step is frozen: its settings, input and output are shown as they were, with no controls.
- **Next step.** Under the live step, the moves on offer depend on its kind and its output:

  | After | You can |
  |---|---|
  | the tree | solve, with any solver: the solvers are listed with how well each suits the tree |
  | a layout with open polygons | strain the edges, add stubs, or solve again |
  | added stubs | strain the edges (suggested), or solve just the stubs (optional: the stubs already fit) |
  | valid polygons | build the crease pattern (suggested), or solve again |
  | the crease pattern | nothing: this is the end of the path |

  Choosing a move freezes the live step and adds the new one, which runs at once with its default settings:
  - a solve solves;
  - straining finds the smallest strain;
  - the crease pattern builds.

  If the result isn't what you want, change the step's settings and run it again. Add stubs is the exception: it waits for you to pick the stubs, with the best one proposed.
- **Solving after the first layout** has a **Which leaves** choice:
  - **Solve all leaves** starts from the previous layout. A warning says this can make large changes and throw away refinements from earlier steps, such as where stubs were put and the lengths found by closing.
  - **Solve just the stubs** holds every other leaf where it is, as a Fixed condition.

  A running solve can be cancelled.
- **Progress.** Every step says what it actually changed, for example "polygon 1–2–3 now valid; hull side 1–4 now tight; open area 2.4 → 0.4 square grid units" or "scale m 0.8 → 0.63; moved 2, 3". From that, each step is marked:
  - **▲ made progress**: a polygon closed, a hull side tightened, open area shrank, or the scale grew;
  - **● changed** without closing anything, as stubs often do;
  - **▼ worse**: you can still go on from it, with a warning;
  - **■ no progress**: nothing was feasible (strain bounds too tight) or nothing changed.

  A live step with no progress, or one that made things worse, is framed in red with a pulsing glow. A step with no progress offers no next move: change its settings and run it again, or delete it. The step cards beside the document carry each step's status in the same colours (green progress, red no progress or worse, dashed not run yet or running, with the running step's progress), and the card of the step on screen is outlined.
- **What each step shows.** One result line says what the step changed and what is still open. Everything else is folded away under small toggles:
  - the step's notes, including the solver's full settings;
  - the sheet's key;
  - the model size;
  - **About this step**, the step's description;
  - **How to edit the tree**;
  - **Details**: the solver's metrics, leaf pairs, traces and edge lengths.

  Toggles are the same rounded pills on the tree and on the sheet. The main action of each step is the one red button.
- **Go back to this result**, on any frozen step, deletes the steps after it, with no confirmation, so that step's result is live again, and scrolls to the moves offered after it, to choose another next step.
- **Delete this step**, on the live step only, deletes it with no confirmation; the step before it becomes the live step again. Deleting step 1 starts an empty session.
- **Step cards** run down the side of the document, one per step. Each card has the step's number, title, progress mark, a line on what it did and a small sheet. They stay in view as you scroll, the card of the step on screen is outlined, and a click goes to that step. Above the cards, **Save the session** writes the whole session (every step with its settings, input and output) as a `treemaker-session` file, version 2 ([docs/FILE-FORMATS.md](docs/FILE-FORMATS.md)). **Open…** reads a session, layout or tree file, and **New session** starts an empty one.
- **Opening a layout file** starts a new session: its tree as step 1 and the layout as step 2.
- **Only the session is kept.** The session document is the only thing the app keeps in the browser between visits, and it survives a reload. A new session starts empty, with default settings: it takes nothing from the previous one. An opened file starts afresh the same way. The map shows the session in short, with **Continue the session**.

`workbench.js` still holds the live step's state for the drawing code (the sheet, the polygons, the folded base), but it is internal: there is no workbench in the interface.

## Where the code is

| Folder | Contents |
|---|---|
| `src/TreeMaker.Web/` | The app: `Program.cs` maps the API groups; `Shared/` holds the request shapes every solver shares, the steps after a solve and the one-solve-at-a-time coordinator; `Pure/`, `Optimized/` and `Scalable/` hold each solver's own options and endpoints; `wwwroot/` is the page, with the packaged specs in `wwwroot/specs/`. |
| `src/TreeMaker.Core/` | Shared by every solver and the app: the tree, definitions, the problem, layout checks, symmetry breaking, polygons and closing, strain LPs, the crease pattern, and the running example. |
| `src/TreeMaker.Pure/` | The base model (Pure MILP and Symmetry-Breaking MILP) and its model-size predictor. |
| `src/TreeMaker.Optimized/` | Lattice hulls, candidate scales, bisection and incremental generation (Optimized MILP and Lattice-Hull MILP). |
| `src/TreeMaker.Scalable/` | The four-stage pipeline (Scalable MILP). |
| `tests/` | One xUnit project per library: `TreeMaker.Core.Tests`, `TreeMaker.Pure.Tests`, `TreeMaker.Optimized.Tests`, `TreeMaker.Scalable.Tests`. |
| `tools/` | Packaging the specs (`extract_spec_exports.py`, `render_spec_figures.js`) and front-end checks without .NET (`mock_api.py`, `ui_flow.js`, `ui_reader.js`). |

## The tree editor

**In the tree step** (step 1), the drawing comes first. The tree step has no separate settings panel: everything is on the tree.
- The grid size **N** sits in the editor's toolbar.
- Leaf conditions and mirror pairs are set by clicking a leaf (below), and a line under the drawing lists them.
- **Edit as a table** under the drawing gives the edge list.

Every part of the app shows the tree and the sheet side by side, as one widget: the tree editor (`tree-editor.js`) on the left and the sheet on the right. What you point at in one lights up in the other (`linked.js`):
- Point at a leaf on either side: the leaf, its circle and its tight pairs on the sheet, and its edge in the tree.
- Point at a tight pair on the sheet: the path between its two leaves in the tree, which is the path whose length sets that pair's spacing.
- Click a leaf on the sheet to keep it lit.

A row of toggles above the sheet chooses what it shows: leaf circles, every pair and, once they exist, the polygons and the creases.

The tree can be edited only while the tree is the session's live step. In every later step it is locked: use **Go back to this result** on step 1 to change it.

The editor works the same everywhere it can edit.

- **Add a leaf.** Drag the **Leaf** chip onto a vertex, or onto an edge to branch from its midpoint.
- **Split an edge.** Drag the **Joint** chip onto the edge.
- **Move or re-attach a vertex.** Drag the vertex to move it. Drop it on another vertex to re-attach it, together with everything beyond it.
- **Delete.** Drag a vertex to **Drop to delete**.
- **Change a length.** Click the length tag on an edge, or Tab to it and press Enter. Type the new length, then press Enter to save or Esc to cancel.
- **Rename a vertex.** Double-click it.
- **Pin or mirror a leaf.** Click a leaf to open its menu. The small square stands for the sheet: click a corner or a side to pin the leaf there, or the centre to free it. The menu can also put the leaf on the symmetry axis (2x = N, N even) or at a grid point. **Mirror with another leaf…** then a click on the partner makes a mirror pair (x_a + x_b = N, y_a = y_b). The drawing shows each condition as a tag under the leaf and each pair as a dashed line, and the leaf conditions list in the sidebar follows. Esc or a click elsewhere closes the menu or cancels the pick.
- **Pure MILP and Symmetry-Breaking MILP only:** click an edge to add it to, or remove it from, the stretch set S, which edge optimization uses.
- **Grid units.** The editor's background is the sheet's N × N grid, one cell per grid unit, at the sheet's size. **Leaf circles** (on by default) have the sheet's radius, m·ℓ grid units, so they match the circles on the sheet and keep their size when you drag. m is the session's layout scale when there is a layout of this tree. Before a solve it is m̄ = √2·N / (the longest leaf-to-leaf path), the largest scale any layout can reach. A note in the corner says which m is in use. The edges are still a sketch: their drawn lengths aren't to scale.
- **Layout.** **Tidy** lays the tree out again. **Enlarge** opens the editor nearly full screen.
- **Mirrored trees.** A tree with mirror pairs, such as the centipede presets, is drawn bilaterally: the body is a straight vertical line and each leg sits on its own side, opposite its partner. The longest flaps at the head and tail (antennae, cerci) point forward and back. The drawing is a sketch, not to scale: short body segments are spaced out so the legs don't overlap. The mirror pairs themselves make every solver place each pair symmetrically about the sheet's vertical axis, x_a + x_b = N. The folded base draws its stick figure the same way, to scale: the body straight and each leg opposite its partner.
- **Facing the sheet.** Once the session has a layout for this tree, the tree drawing and the folded base turn to face the way the leaves sit on the sheet: a centipede's head points where its first legs landed, and left and right match the crease pattern. A tree without mirror pairs is turned by the rotation (or mirror image) that best matches its leaves' directions. A drawing you've arranged by dragging stays as you left it; **Tidy** re-orients it.

The server tells the browser not to cache the page, and the scripts are versioned, so an updated app always loads its new scripts.

## Toward a crease pattern (the steps after a solve)

After a solve, the session's next steps close the polygons (by straining the edges, adding stubs or solving again) and build the crease pattern (see *The session* above). The moves run the code in `src/TreeMaker.Core`:

1. **Check the polygons** (`ActivePaths`, `POST /api/polygons`). TreeMaker's universal-molecule construction needs the tight pairs (active paths) to divide the leaves' convex hull into polygons. Each polygon must be convex, bounded by tight paths, and empty of leaves. The panel lists what's missing: open boundary pieces, crossing paths, non-convex polygons, leaves inside a polygon, and uncovered area. The sheet marks what still needs closing:
   - Valid polygons are shaded.
   - Invalid polygons are hatched, with a tag saying why (a leaf inside, not convex, not closed), and a ring marks any leaf inside one.
   - Hull outline that no polygon covers yet is hatched too.
   - Hull sides that aren't tight paths yet are dashed red.

   A key under the live sheet explains the marks, with a line such as "To close before a crease pattern: 3 hull sides to make tight, 1 polygon not valid".
2. **Strain the edges** (`PolygonCompletion`, `POST /api/complete`): one of the three ways to close the polygons, beside adding stubs and solving again. There are two ways to run it, and you pick one:
   - **Find the smallest strain** (recommended): finds the smallest bound for you (below).
   - **Strain within these bounds**: uses the σ_min and σ_max you type.

   The leaves and the scale stay fixed. The edge lengths change (strain σₑ within your bounds) so the pairs of a triangulation that keeps the existing tight pairs become exactly tight, and every other pair still fits. Boundary pairs come first, since the polygons cannot cover the hull without them. A second solve then uses the least total strain.

   Each edge gets its own strain, but by default every edge shares the same bounds and costs the same. Under **Per-edge room and cost** you can change that for single edges, and both ways of straining honour it (closing spec P:8 and D:7):
   - **Lock** keeps an edge's length (room 0).
   - **Room ×** multiplies the bounds for that edge: 2 lets it strain twice as far as the others, 0.5 half as far. In **Find the smallest strain**, the bound found is the one for an edge with room 1.
   - **Cost** weighs the edge's strain in the least-strain solves, so an edge with cost 3 is strained only where a cheaper one can't do the job.

   The step keeps only the edges you changed, and they are listed in its settings once it is frozen. σ is a relative change of length, ℓₑ(1 + σₑ). A strain below −1 would give a negative length, so shrinking stops at −0.99. Stretching has no upper limit beyond the σ_max you set.

3. **Build the crease pattern** (`CreasePatternBuilder`, `POST /api/creases`). This fills every polygon with Lang's universal molecule. Each polygon shrinks, with all sides moving inward at the same rate and the corners sliding along their bisectors, which traces the **ridge** creases. It stops when two corners meet or when a shortened diagonal becomes tight. In the second case it splits along that diagonal (a **gusset**) and repeats on each piece. **Hinge** creases run perpendicular to each side at every internal tree node along its path. The creases are drawn on the sheet. **Download .fold** gives a FOLD file that Origami Simulator and other tools can open; **Download .svg** gives a drawing styled by crease type.
4. **The folded base** (`folded.js`). Every facet is mapped to its folded position: it lies over one tree edge, at its height above the axis. The base is drawn in 3D: drag to turn it, or pick a view from above, from the side, or three-quarter. Seen from above it is the tree's stick figure. The builder also checks the fold: every vertex must fold to one point from all its facets, and every facet must keep its shape. The result of that check is shown with the pattern.

5. **Pleat the flaps** (optional, in step 3). This lowers the base to a chosen height H, in grid units. Each facet is cut along the elevation contours z = H, 2H, 3H, …, and the contours fold valley, mountain, valley, … in turn, so every flap collapses into a band of height H. A contour changes from mountain to valley where it crosses a ridge, as a pleat over a fold must. H = 1 gives pleats one grid unit apart, as in box pleating. The pleat creases carry their mountain or valley assignment into the FOLD file.

Each closing solve in the search is a MILP, and the server gives it no time limit of its own. The search makes several of them, so on a big tree it could run for minutes with no sign of life. Now:
- Each closing solve gets the step's **time limit per closing solve** (20 s by default).
- The search shows where it is, with the time so far, beside its buttons, and **Cancel** stops it after the solve in progress.
- Every outcome is recorded as the step's result: closed, still open, no strain possible (with the server's reason), cancelled, failed, or no strain needed.

If **Build the crease pattern** stays greyed out, the polygons aren't valid yet. **Find the smallest strain** first solves two linear programs. One finds the smallest strain bound ±s that makes the hull's boundary pairs tight. Valid polygons need those pairs tight, so this is a lower bound, and when no strain manages it the button says so at once. The other finds the smallest bound that makes the whole triangulation tight, which is an upper bound. If tightening the boundary already gives valid polygons, that bound is the answer. Otherwise the button bisects between the two bounds with the closing MILP, to within 0.01. It then closes the polygons at the bound found.

**Add stubs** (`stubs.js`), a step of its own that can add as many stubs as you like, splits open polygons the TreeMaker way. A stub is a new short leaf edge hung from a joint of the tree, with its leaf inside the polygon. Its leaf goes on a grid point X, so the layout stays a grid layout. Hung from joint v, at the layout's scale m, the longest stub that keeps every pair feasible is ℓ = min over leaves a of (|X − P_a| / m − d(v, a)), and the leaves that reach that minimum are tight to it.
- It works on the live step's tree and sheet. The tree editor is locked against edits: the proposed stub is a dashed edge, and clicking a joint hangs the stub there. On the sheet, the open region is outlined and the stub is drawn with its circle and its tight paths. Clicking a grid point inside the region moves the stub there.
- **Ranked proposals.** For the chosen region, the step lists the three best stubs over every joint and free grid point. Each shows the leaves it is tight to, and how much longer it would need to be to reach the next ones ("nearly to 3 +0.12"): that is what a strain step would have to make up. The ranking is TreeMaker's idea of a good stub. First come stubs whose three nearest leaves surround them, so they split the polygon. Then come those closest to being tight to all three, and then the longest. The region with the best stub of all opens first.
- **Add the best stub to each open region** adds the best stub that splits a polygon, checks the polygons again, and repeats. It stops at six stubs, or as soon as the next stub would neither split a polygon nor make one valid.
- **Add this stub** adds the leaf `s1`, `s2`, … to the tree and to the layout, at the same scale. The polygons are checked again, ready for the next stub. **Remove** takes the last stub out again.
- **After stubs, no solve is needed.** Every stub already fits at the layout's scale, so the layout stays feasible. A grid point seldom makes three leaves tight at once, though, so **Strain the edges** is the suggested next step: it tightens what is left. **Solve just the stubs** is offered too, but with every other leaf held it can at best keep the scale.

The spec has stubs only as an open problem so far.

Not yet built: the mountain and valley assignment (which way each crease folds) and the layer order. The FOLD export marks folds as unassigned. Origami Simulator needs the mountain and valley assignment to animate the folding. The current pattern requires every pair on the outer boundary of the leaves to be tight; TreeMaker can also handle boundary pairs that aren't tight.

Whether a layout can be closed with small strains depends on which optimal layout the solver returns. Two layouts of the running example with the same m* need up to ±0.3 and ±0.5. Letting the leaves move while closing the polygons, which is a strain MILP with equality rows, would be the next improvement.

## Presets

**Load a preset** lists the same trees in every solver.

- **Grid size.** Each preset sets its own grid size N: the largest tested N at which every solver that offers the preset solves it within the 60 s limit.
- **Symmetry.** Every bilateral preset loads the conditions it would be folded with (Pure MILP spec, Sections 7.3 and 7.4): left–right mirror pairs for its paired flaps, and the symmetry axis for its unpaired ones. They show in **Leaf conditions** and can be removed there.

  | Preset | Mirror pairs | On the symmetry axis |
  |---|---|---|
  | Bird-base–like | 1 ↔ 2, 3 ↔ 4, 5 ↔ 6 | — |
  | Centipedes | Lk ↔ Rk; for the full centipede also the antennae and the tail flaps | — |
  | Beetle | antennae, legs L1–L3 ↔ R1–R3 | abdomen (abd) |
  | Deer with antlers | ears, antler tines t1 ↔ t3 and t2 ↔ t4, fore and hind legs | snout (snt), tail |
  | Dragon with wings | horns, wing fingers wL1–wL3 ↔ wR1–wR3, fore and hind legs | snout (snt), tail |
  | Scorpion | pincer fingers pL1, pL2 ↔ pR1, pR2, legs L1–L4 ↔ R1–R4 | stinger (stg) |

  The star, caterpillar and running-example presets have none.
- **Greyed out.** A preset a solver cannot solve in reasonable time at any useful grid size is greyed out there, marked *too slow here; use the Scalable MILP*. The Tree node offers every preset.

Times are to the 1% gap, at the preset's N. "off" means greyed out in that solver. The base model column covers Pure MILP and Symmetry-Breaking MILP; the optimized column covers Optimized MILP and Lattice-Hull MILP, which offer the same presets.

| Preset | Leaves | Grid N | Base model | Optimized | Scalable |
|---|---|---|---|---|---|
| Running example | 4 | 8 | 28 s | 0.1 s | under 1 s |
| Star, 4 legs | 4 | 6 | 6 s | 0.1 s | under 1 s |
| Star, 5 legs | 5 | 16 | off | 8 s | under 1 s |
| Bird-base–like (centipede, 3 leg pairs) | 6 | 8 | off | 46 s ¹ | under 1 s |
| Caterpillar | 6 | 10 | off | 25 s | under 1 s |
| Centipede, 2 leg pairs (mirrored) | 4 | 12 | 6 s | 0.3 s | under 1 s |
| Centipede, 4 leg pairs (mirrored) | 8 | 12 | off | 35 s | under 1 s |
| Centipede, 5 leg pairs (mirrored) | 10 | 8 | off | 23 s | under 1 s |
| Centipede, 6 leg pairs (mirrored) | 12 | 8 | off | 13 s | under 1 s |
| Centipede, 8 leg pairs (mirrored) | 16 | 13 | off | off | under 1 s |
| Beetle (mirrored) | 9 | 12 | off | off | under 1 s ¹ |
| Deer with antlers (mirrored) | 12 | 12 | off | off | under 1 s ¹ |
| Dragon with wings (mirrored) | 14 | 14 | off | off | about 1 s ¹ |
| Scorpion (mirrored) | 13 | 14 | off | off | under 1 s ¹ |
| Centipede with antennae and tail (mirrored) | 18 | 16 | off | off | about 1 s |
| Random, 25 / 50 / 100 leaves | 25 to 100 | about 3.2·√leaves | not listed | not listed | 1 to 3 s |

¹ Timed before these presets loaded their mirror pairs and axis conditions. The conditions fix leaves and roughly halve the free ones, so they should only make the solves faster, but they can lower the best scale; the times and grid sizes have not been re-measured.

The base and optimized times come from Python prototypes of their algorithms, with HiGHS standing in for SCIP. The prototypes swept N = 4, 6, 8, … for the optimized search, and N = 4, 5, 6, … for the base model. They are not timings of the C# solvers.

- **Base model.** The model proves an optimum within 60 s only for 4-leaf trees. Every tree with 5 or more leaves ran out of time even at N = 4.
- **Mirror pairs.** They roughly halve the free leaves. That is what lets the optimized search solve the 4-, 5- and 6-pair centipedes.
- **Too coarse to be useful.** The optimized search solves the 8-pair centipede, the beetle and the deer only at N = 4, so they are off there.
- **Not yet timed.** Symmetry breaking in the base model and the Lattice-Hull node (the optimized search without symmetry breaking) have no separate timings; they use the presets of their families.
- **Scalable MILP.** The scalable times are from the scalable prototype, which ignores mirror pairs. The C# pipeline applies them.

## Tree and layout files

- **Open…** and **Save tree** are in the tree step, above the drawing. **Save layout** is under the sheet. **Open…** in the session's sidebar and **Open a file…** on the map read any of the three kinds.
- A tree file holds the tree, grid size, leaf conditions and mirror pairs.
- A layout file holds a solved layout with its tree, scale and edge lengths. Opening it starts a new session from it.
- A session file holds the whole session.
- The formats are in `docs/FILE-FORMATS.md`, and their JSON Schemas are in `schemas/`.

## Starting a new solve

**Solve** clears everything left on the page from the previous solve as soon as you press it: the sheet, the polygons and creases, the folded base, the tables and the traces. Any answer still arriving for the old layout is dropped. Moving to another part of the app clears the page the same way; the session keeps the results.

## Defaults

The exact solvers default to a **1% relative gap** and a **60 s time limit**. Scalable MILP has no gap, because it proves no optimum; it has a 60 s limit for all four stages. See each library's README for what the gap means there, and how to get the exact optimum.
