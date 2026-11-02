# TreeMaker MILP: instructions for Claude

Read `docs/CONTEXT.md` first. It has the project history, current state, known gaps and links to the specification documents.

## Standing instructions from the owner

- **Language and stack.** Build everything in C# / .NET 10 by default. The apps are ASP.NET Core minimal APIs serving a static `wwwroot`, with Google OR-Tools 9.* (SCIP, GLOP, CP-SAT) and xUnit tests.
- **Target browser.** The UIs only need to run in Chrome on macOS.
- **One app, one map.** `src/TreeMaker.Web` is the only web project (port 5080), and `dotnet run` at the repository root runs it (the root `TreeMaker.csproj` is the entry point; there is no solution file). Its first screen is a map of the specs and the steps after them, drawn like the document graph; every node opens the part of the app that implements it, and **← Map** goes back.
  - Every spec has a node, and every node names its spec and section (`src/TreeMaker.Web/wwwroot/nodes.js`). A new spec doc gets a node; a new solver gets an API group under `/api/<group>/` and an entry in `solvers.js`.
  - Every node is a part of **the session**: its box opens the session's live step, adds that step when the live step allows it, or shows the latest step of that kind.
  - Bump the `?v=` query on the script and style URLs in `index.html` when the front-end changes.
- **The session.** The work view is one document (`workflow.js`), from the tree (always step 1) to the crease pattern. Every step holds its settings, input and output (shown as tree widgets) and names its spec. Only the last step is live: its settings are the app's controls for that kind of step, and earlier steps are frozen, with no controls. The moves offered next depend on the live step's kind and output. "Go back to this result" deletes the steps after a step, so its result is live again, and scrolls to the next moves; "Delete this and below" deletes a step and every later one, and the step before it becomes live. Neither asks for confirmation. Solves can be cancelled. The whole document saves as a `treemaker-session` file. There is no workbench in the interface (`workbench.js` is internal, memory-only state for the drawing code). **The session document is the only thing kept between visits**: a new session or an opened file starts from default settings and takes nothing from another session. A new step runs at once with its default settings (except Add stubs, which waits for a pick); the user re-runs it with other settings if needed. Keep the page quiet: one result line per step, secondary information folded under a toggle. A new move belongs in the session as a new step kind.
- **Solve clears old state.** Pressing Solve, or moving to another node, clears every result on the page (sheet, polygons, creases, folded base, tables, traces), and drops in-flight answers. The session keeps the results.
- **Presets.** Every solver lists the same presets. Each preset sets a grid size that the solvers offering it solve within 60 s, and every bilateral preset loads its mirror pairs and axis conditions (`PRESET_SYMMETRY` in `app.js`; README, "Presets"). A preset that a solver cannot solve in reasonable time is greyed out there (`presets` in `nodes.js`). See the table in `README.md`.
- **Files.** Tree, layout and session files follow `schemas/*.schema.json` (`docs/FILE-FORMATS.md`). A change to any format bumps its `version` and keeps reading version 1.
- **Deliverables.** Code changes are committed to git in this repository. Do not hand over zip files unless asked.

## Specification documents

- The specs are Claude Docs artifacts in the owner's account (links in `docs/CONTEXT.md`). They are model and algorithm specifications, not application guides.
- Follow the *Model and Algorithm Spec Style Guide*:
  - P:, D:, C:/M: and A: labels run in order of appearance.
  - Definitions used in more than one place go under **Shared definitions**.
  - A definition used in one place goes at that place.
  - Keep every **Used in:** line current.
- When a spec moves or renumbers a label or section, update the references in code comments too (`grep -rn "Section 11\|D:[0-9]"`).
- **The app carries the specs.** `src/TreeMaker.Web/wwwroot/specs/` holds a packaged copy of every doc, shown by the app's docs page (`docs.html`, opened in its own tab so reading stays apart from the workbench). After editing a spec, refresh its copy before delivering:
  1. Export it: Claude Docs `export` with format `markdown` (container and tab in `docs/CONTEXT.md`).
  2. If it has figures, read its tab node (the XML lists the figures in order) and then every figure node (`<embed ref='node/…'>`). With many figures, have a subagent make the reads; its transcript is scanned too.
  3. Run `python3 tools/extract_spec_exports.py <session transcript .jsonl>`. It compiles the figures to `figures/<key>/NN.svg` (needs Node and the TypeScript compiler), writes `<key>.md` with ```` ```math ```` blocks and links to those files, and updates `manifest.json`. It warns when a doc's figures are missing or out of step. GitHub and the app's docs page show the same files, so one run keeps both views current.
  4. A new doc also needs its title in `SPECS` and its tab in `TABS` in that script, and a `DOCS` entry in `nodes.js`.
- **Document graph.** After any change that adds or removes a reference between documents, or adds, renames or deletes a document, update the graph artifact (the `/doc-graph` skill describes how).
- **The map follows the graph.** The app's map draws the same references between specs (`SPEC_EDGES` in `src/TreeMaker.Web/wwwroot/nodes.js`) and links every node to its doc (`DOCS`). Change them together with the graph.

## Working notes

- The repo layout and how to run each app are in `README.md`.
- Port: 5080 for the one app.
- Front-end checks without .NET: `python3 tools/mock_api.py 5099 src/TreeMaker.Web/wwwroot`, then `node tools/ui_flow.js`, `node tools/ui_reader.js`, `node tools/ui_session.js` and `node tools/ui_scroll.js` (Playwright). `ui_scroll.js` fails if any action inside a step moves the page.
- From the root, `dotnet build` builds all nine projects, `dotnet run` runs the app and `dotnet test` runs the four test projects (through `TreeMaker.csproj`).
- **Where code goes.** `src/TreeMaker.Core` holds everything more than one solver or the app uses (tree, problem, layout checks, symmetry breaking, polygons, closing, creases); each solver library (`src/TreeMaker.Pure`, `.Optimized`, `.Scalable`) holds only its own model and search, and depends on Core (Optimized and Scalable also on Pure, for the base model's size and comparison). Request shapes shared by the solvers' endpoints are in `src/TreeMaker.Web/Shared/Contracts.cs`. Don't copy code between solvers: move it into Core.
- The C# was written without a compiler in the original session. Expect a first build to surface small API mismatches, most likely in the OR-Tools CP-SAT calls in `src/TreeMaker.Scalable/WindowModel.cs`.
