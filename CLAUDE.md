# TreeMaker MILP: instructions for Claude

Read `docs/CONTEXT.md` first. It has the project history, current state, known gaps and links to the specification documents.

## Standing instructions from the owner

- **Language and stack.** Build everything in C# / .NET 10 by default. The apps are ASP.NET Core minimal APIs serving a static `wwwroot`, with Google OR-Tools 9.* (SCIP, GLOP, CP-SAT) and xUnit tests.
- **Target browser.** The UIs only need to run in Chrome on macOS.
- **One app, one map.** `TreeMaker.Web` is the only web project (port 5080). Its first screen is a map of the specs and the steps after them, drawn like the document graph; every node opens the part of the app that implements it, and **← Map** goes back.
  - Every spec has a node, and every node names its spec and section (`TreeMaker.Web/wwwroot/nodes.js`). A new spec doc gets a node; a new solver gets an API group under `/api/<group>/` and an entry in `solvers.js`.
  - The workbench (`workbench.js`) carries the tree, the layout, the closed polygons and the crease pattern between nodes, in `localStorage`. A new result replaces its slot and clears the later slots. Every node starts from what the workbench holds.
  - Bump the `?v=` query on the script and style URLs in `index.html` when the front-end changes.
- **Solve clears old state.** Pressing Solve, or moving to another node, clears every result on the page (sheet, polygons, creases, folded base, tables, traces), and drops in-flight answers. The workbench keeps the results.
- **Presets.** Every solver lists the same presets. Each preset sets a grid size that the solvers offering it solve within 60 s, and the centipede presets load left–right mirror pairs. A preset that a solver cannot solve in reasonable time is greyed out there (`presets` in `nodes.js`). See the table in `README.md`.
- **Files.** Tree and layout files follow `schemas/*.schema.json` (`docs/FILE-FORMATS.md`). A change to either format bumps its `version` and keeps reading version 1.
- **Deliverables.** Code changes are committed to git in this repository. Do not hand over zip files unless asked.

## Specification documents

- The specs are Claude Docs artifacts in the owner's account (links in `docs/CONTEXT.md`). They are model and algorithm specifications, not application guides.
- Follow the *Model and Algorithm Spec Style Guide*:
  - P:, D:, C:/M: and A: labels run in order of appearance.
  - Definitions used in more than one place go under **Shared definitions**.
  - A definition used in one place goes at that place.
  - Keep every **Used in:** line current.
- When a spec moves or renumbers a label or section, update the references in code comments too (`grep -rn "Section 11\|D:[0-9]"`).
- **The app carries the specs.** `TreeMaker.Web/wwwroot/specs/` holds a packaged copy of every doc, shown in the in-app reader. After editing a spec, refresh its copy before delivering:
  1. Export it: Claude Docs `export` with format `markdown` (container and tab in `docs/CONTEXT.md`).
  2. If it has figures, read its tab node (the XML lists the figures in order) and then every figure node (`<embed ref='node/…'>`). With many figures, have a subagent make the reads; its transcript is scanned too.
  3. Run `python3 tools/extract_spec_exports.py <session transcript .jsonl>`. It writes `<key>.md`, compiles the figures to `<key>.figures.json` (needs Node and the TypeScript compiler) and updates `manifest.json`, and warns when a doc's figures are missing or out of step.
  4. A new doc also needs its title in `SPECS` and its tab in `TABS` in that script, and a `DOCS` entry in `nodes.js`.
- **Document graph.** After any change that adds or removes a reference between documents, or adds, renames or deletes a document, update the graph artifact (the `/doc-graph` skill describes how).
- **The map follows the graph.** The app's map draws the same references between specs (`SPEC_EDGES` in `TreeMaker.Web/wwwroot/nodes.js`) and links every node to its doc (`DOCS`). Change them together with the graph.

## Working notes

- The repo layout and how to run each app are in `README.md`.
- Port: 5080 for the one app.
- Front-end checks without .NET: `python3 tools/mock_api.py 5099 TreeMaker.Web/wwwroot`, then `node tools/ui_flow.js` and `node tools/ui_reader.js` (Playwright).
- `dotnet test TreeMaker.sln` runs the three test projects (the solution has seven projects).
- The C# was written without a compiler in the original session. Expect a first build to surface small API mismatches, most likely in the OR-Tools CP-SAT calls in `ScalableMilpTreeMaker/src/ScalableMilpTreeMaker/WindowModel.cs` and in the new `TreeMaker.Web` project.
