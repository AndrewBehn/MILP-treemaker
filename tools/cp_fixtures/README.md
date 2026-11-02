# Crease-pattern test corpus

Real crease patterns for testing the crease-pattern page (`cp.html`). `node tools/ui_cp_corpus.js <mock port>` opens each
one as it is, then opens each SVG again as a PNG rendered in the page, and checks the results against `expected.json`.
Add `--report` for a line per reading.

## Where the files come from, and their licences

Every file is copied unchanged from one of two MIT-licensed repositories. Their licence texts are kept beside the files
(`LICENSE-OrigamiSimulator.txt`, `LICENSE-fold.txt`), as the MIT licence requires.

| Files | Source | Licence |
|---|---|---|
| `*.svg` | [amandaghassaei/OrigamiSimulator](https://github.com/amandaghassaei/OrigamiSimulator), `assets/` (commit 903ef27, 13 Oct 2026) | MIT, © 2018 Amanda Ghassaei |
| `*.fold` | [edemaine/fold](https://github.com/edemaine/fold), `examples/` (commit 824f9fa, 23 Oct 2023) | MIT, © 2016 Erik Demaine, Jason Ku, Robert Lang |

Only traditional models, generic bases and simple geometric patterns were taken: the bird, boat, frog, open-sink,
pinwheel, square and waterbomb bases, the traditional crane (3D and flat), the paper airplane, a single vertex, a map
fold, a brochure fold, a single square twist, the Miura-ori and the waterbomb tessellation, and the FOLD examples.

Left out on purpose, although the repositories' code is MIT-licensed: every pattern credited to a designer (Origami
Simulator's `lang*`, `huffman*`, `resch*`, `MoosersTrainRigid-Gardner` and similar). A designer keeps the copyright in
their crease pattern whatever licence the repository that carries a copy uses, so those stay out of this repository.

## What the files test

Origami Simulator's colours: red mountain, blue valley, yellow a flat line (a facet of a part-folded face), black the
border (which need not be a square: `singlesquaretwist.svg`). Its files are drawn by hand in Illustrator and are a little
off: lines stop short of each other or run past, and angles are out by up to half a degree.

Expected failures, each for a reason in the pattern itself:

- `frogBase.svg` is drawn approximately (reference points at 0.35 of the side), 1.4° out at 8 vertices.
- `traditionalCrane.svg` is a 3D model with its wings, neck and tail part-folded, so it is not flat-foldable.
- `simple.fold` and `squaretwist.fold` are folded forms (3D), not crease patterns: the page says so.

Known limits of tracing images (`pngLimit` in `expected.json`; reported, not failed):

- `flat_crane.svg`: the fans at two corners have creases too short and close to trace.
- `miura-ori.svg`: its zigzag is 2.5° off straight, about a stroke's width at 900 px, and some columns trace straight.
