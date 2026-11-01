// UI check of the packaged specs against tools/mock_api.py on port 5099: the map's Spec pill opens the reader beside
// the map; the list; a doc with its figures, maths and cross-links; a solver's header links; the reader stays open
// while a solve runs and keeps the results; links between docs; Escape closes; no network beyond the app.
// Usage: node tools/ui_reader.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  const offsite = [];
  p.on('request', (r) => { if (!/^http:\/\/127\.0\.0\.1:5099\//.test(r.url())) offsite.push(r.url()); });
  const log = {};
  const check = (name, ok) => { log[name] = ok; if (!ok) errs.push('FAIL ' + name); };

  await p.goto('http://127.0.0.1:5099/'); await p.waitForTimeout(800);
  // The Spec pill on the Pure MILP box: reader opens beside the map, at the cited section.
  await p.click('a.map-spec >> nth=0'); await p.waitForTimeout(1500);
  log.hashAfterPill = await p.evaluate(() => location.hash);
  check('readerOpenOnMap', await p.evaluate(() => !document.getElementById('reader').hidden && !document.getElementById('mapView').hidden));
  log.readerTitle = await p.textContent('#readerTitle');
  await p.screenshot({ path: `${out}/reader-map.png` });

  // The list of specs.
  await p.click('#readerList'); await p.waitForTimeout(500);
  log.listCards = await p.evaluate(() => [...document.querySelectorAll('.spec-card-title')].map((a) => a.textContent));
  check('sevenSpecs', log.listCards.length === 7);
  await p.screenshot({ path: `${out}/reader-list.png` });

  // The Pure MILP doc: figures drawn, maths typeset, labels anchored and linked.
  await p.click('.spec-card-title >> nth=0'); await p.waitForTimeout(1500);
  log.pure = await p.evaluate(() => ({
    figures: document.querySelectorAll('#readerBody figure.drawn svg').length,
    undrawn: document.querySelectorAll('#readerBody figure:not(.drawn)').length,
    katex: document.querySelectorAll('#readerBody .math .katex').length,
    tex: document.querySelectorAll('#readerBody .math').length,
    anchors: ['spec-sec-7', 'spec-C-4', 'spec-D-2', 'spec-P-1'].filter((id) => document.getElementById(id)),
    xrefs: document.querySelectorAll('#readerBody a.xref').length,
    chips: [...document.querySelectorAll('#readerBody .app-chip')].map((a) => a.textContent).slice(0, 6),
  }));
  check('pureFigures', log.pure.figures === 20 && log.pure.undrawn === 0);
  check('pureMaths', log.pure.katex === log.pure.tex && log.pure.tex > 20);
  await p.evaluate(() => document.querySelector('#spec-D-1').scrollIntoView());
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/reader-figure.png` });

  // A cross-reference inside the doc moves to the label.
  await p.evaluate(() => [...document.querySelectorAll('#readerBody a.xref')].find((a) => a.textContent === 'C:4').click());
  await p.waitForTimeout(800);
  log.afterXref = await p.evaluate(() => ({ hash: location.hash, hit: document.querySelector('#readerBody .hit')?.textContent.slice(0, 40) }));

  // An "In the app" chip goes to the solver and keeps the doc open beside it.
  await p.click('#readerBody .spec-impl .app-chip >> nth=0'); await p.waitForTimeout(1200);
  log.solverWithDoc = await p.evaluate(() => ({ hash: location.hash, node: document.body.dataset.node, reader: !document.getElementById('reader').hidden, title: document.getElementById('readerTitle').textContent }));
  check('chipKeepsDoc', log.solverWithDoc.reader && log.solverWithDoc.node === 'pure');

  // Solve with the reader open; then move the reader: the results stay.
  await p.click('#solve');
  await p.waitForFunction(() => !document.getElementById('metricsCard').hidden && !document.getElementById('solve').disabled, null, { timeout: 15000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/reader-solver.png` });
  await p.evaluate(() => document.querySelector('#nodeSpec a.xref')?.click());
  await p.waitForTimeout(900);
  check('resultsKept', await p.evaluate(() => !document.getElementById('metricsCard').hidden));
  log.headerLink = await p.evaluate(() => ({ hash: location.hash, hit: document.querySelector('#readerBody .hit')?.textContent.slice(0, 50) }));

  // Sidebar refs open the reader too.
  const ref = await p.$('aside .ref');
  if (ref) { await ref.click(); await p.waitForTimeout(700); log.sidebarRef = await p.evaluate(() => location.hash); }

  // A link to another doc stays in the app.
  await p.goto('http://127.0.0.1:5099/#/optimized?read=optimized'); await p.waitForTimeout(1500);
  log.optimized = await p.evaluate(() => ({
    figures: document.querySelectorAll('#readerBody figure.drawn').length,
    otherLinks: [...document.querySelectorAll('#readerBody a.xref.other')].map((a) => a.getAttribute('href')).slice(0, 3),
    docLinks: [...document.querySelectorAll('#readerBody a.doc-link')].map((a) => a.getAttribute('href')),
  }));
  await p.evaluate(() => document.querySelector('#readerBody a.xref.other')?.click());
  await p.waitForTimeout(1200);
  log.afterOther = await p.evaluate(() => ({ title: document.getElementById('readerTitle').textContent, hash: location.hash }));
  check('crossDoc', /Pure/.test(log.afterOther.title));

  // Every doc renders without leaving placeholders it has figures for.
  log.docs = {};
  for (const key of ['pure', 'sym', 'hull', 'optimized', 'scalable', 'closing', 'crease']) {
    await p.goto(`http://127.0.0.1:5099/#/?read=${key}`); await p.waitForTimeout(900);
    log.docs[key] = await p.evaluate(() => ({ figs: document.querySelectorAll('#readerBody figure.drawn').length, missing: document.querySelectorAll('#readerBody figure:not(.drawn)').length, len: document.getElementById('readerBody').innerText.length }));
  }
  await p.goto('http://127.0.0.1:5099/#/scalable?read=scalable:A-4'); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/reader-scalable.png` });

  // Escape closes, and Back reopens.
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  check('escCloses', await p.evaluate(() => document.getElementById('reader').hidden));
  await p.goBack(); await p.waitForTimeout(900);
  check('backReopens', await p.evaluate(() => !document.getElementById('reader').hidden));

  log.offsite = offsite;
  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
