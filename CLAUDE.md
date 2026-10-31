# TreeMaker MILP: instructions for Claude

Read `docs/CONTEXT.md` first. It has the project history, current state, known gaps and links to the specification documents.

## Standing instructions from the owner

- **Language and stack.** Build everything in C# / .NET 10 by default. The apps are ASP.NET Core minimal APIs serving a static `wwwroot`, with Google OR-Tools 9.* (SCIP, GLOP, CP-SAT) and xUnit tests.
- **Target browser.** The UIs only need to run in Chrome on macOS.
- **Three apps, one look.** The UIs of the three apps (`PureMilpTreeMaker`, `OptimizedMilpTreeMaker`, `ScalableMilpTreeMaker`) stay as similar as possible.
  - `tree-editor.js`, `polygons.js`, `folded.js` and `files.js` are byte-identical across the three `wwwroot` folders. Edit one, then copy it to the others.
  - Only `app.js`, `index.html` and the tail of `styles.css` differ per app.
  - Bump the `?v=` query on the script and style URLs in each `index.html` when the front-end changes.
- **Solve clears old state.** Pressing Solve clears every result from the previous solve (sheet, polygons, creases, folded base, tables, traces), and drops in-flight answers.
- **Presets.** Every app lists the same presets. Each preset sets a grid size that the apps offering it solve within 60 s, and the centipede presets load left–right mirror pairs. A preset that an app cannot solve in reasonable time is greyed out there (`disabled`, labelled *scalable app only*). See the table in `README.md`.
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
- **Document graph.** After any change that adds or removes a reference between documents, or adds, renames or deletes a document, update the graph artifact (the `/doc-graph` skill describes how).

## Working notes

- The repo layout and how to run each app are in `README.md`.
- Ports: base 5080, optimized 5081, scalable 5082.
- `dotnet test TreeMaker.sln` runs all nine projects' tests.
- The C# was written without a compiler in the original session. Expect a first build to surface small API mismatches, most likely in the OR-Tools CP-SAT calls in `ScalableMilpTreeMaker/src/ScalableMilpTreeMaker/WindowModel.cs`.
