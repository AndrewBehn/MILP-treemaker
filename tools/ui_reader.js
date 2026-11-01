// UI check of the docs tab against tools/mock_api.py on port 5099. The specs open in their own tab (docs.html),
// apart from the working app: the map's Spec tags, a node's header links and the sidebar's section labels all open
// the one docs tab; its "Run it" tags open the app's tab; the app keeps its results throughout. Also checks every
// doc's figures and maths, links between docs, the list of specs, links from before the split (`#/x?read=…`), and
// the bilateral drawing of the centipede presets.
// Usage: node tools/ui_reader.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
const base = 'http://127.0.0.1:5099/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  };
  const log = {};
  const check = (name, ok) => { log[name] = ok; if (!ok) errs.push('FAIL ' + name); };

  const app = await ctx.newPage(); watch(app);
  await app.goto(base); await app.waitForTimeout(800);
  check('noReaderInApp', await app.evaluate(() => !document.getElementById('reader')));

  // A Spec tag on the map opens a new tab with the doc at the node's section.
  const [docs] = await Promise.all([ctx.waitForEvent('page'), app.click('a.map-spec >> nth=0')]);
  watch(docs);
  await docs.waitForLoadState(); await docs.waitForTimeout(1500);
  log.docsUrl = docs.url();
  log.pure = await docs.evaluate(() => ({
    figures: document.querySelectorAll('#readerBody figure.drawn svg').length,
    undrawn: document.querySelectorAll('#readerBody figure:not(.drawn)').length,
    katex: document.querySelectorAll('#readerBody .math .katex').length,
    tex: document.querySelectorAll('#readerBody .math').length,
    specs: document.querySelectorAll('#specNav li').length,
    contents: document.querySelectorAll('#readerToc li').length,
    hit: document.querySelector('#readerBody .hit')?.textContent.slice(0, 40),
  }));
  check('docsTab', /docs\.html#\/pure/.test(log.docsUrl));
  check('pureFigures', log.pure.figures === 20 && log.pure.undrawn === 0);
  check('pureMaths', log.pure.katex === log.pure.tex && log.pure.tex > 20);
  await docs.screenshot({ path: `${out}/docs-tab.png` });

  // Another Spec tag reuses the same tab.
  const tabs = ctx.pages().length;
  await app.click('a.map-spec >> nth=3'); await app.waitForTimeout(1500);
  check('oneDocsTab', ctx.pages().length === tabs && /docs\.html#\/hull/.test(docs.url()));

  // The map box opens the part of the app; a solve; header and sidebar links go to the docs tab, results stay.
  await app.click('a[href="#/pure"] >> nth=0'); await app.waitForTimeout(900);
  check('boxOpensApp', await app.evaluate(() => document.body.dataset.node === 'pure'));
  await app.click('#solve');
  await app.waitForFunction(() => !document.getElementById('metricsCard').hidden && !document.getElementById('solve').disabled, null, { timeout: 15000 });
  await app.click('#nodeSpec a.xref >> nth=0'); await app.waitForTimeout(1200);
  log.headerLink = docs.url();
  check('headerLinkToDocsTab', /docs\.html#\/pure:/.test(docs.url()) && ctx.pages().length === tabs);
  await app.click('aside .ref >> nth=0'); await app.waitForTimeout(1200);
  log.sidebarRef = docs.url();
  check('resultsKept', await app.evaluate(() => !document.getElementById('metricsCard').hidden && location.hash === '#/pure'));
  await app.screenshot({ path: `${out}/app-tab.png` });

  // From a doc, a "Run it" tag opens that part of the app in the app's tab.
  await docs.goto(`${base}docs.html#/optimized`); await docs.waitForTimeout(1200);
  await docs.click('.spec-impl .app-chip >> nth=0'); await app.waitForTimeout(1200);
  check('chipToAppTab', ctx.pages().length === tabs && await app.evaluate(() => document.body.dataset.node === 'optimized'));

  // Links between docs stay in the docs tab.
  await docs.evaluate(() => document.querySelector('#readerBody a.xref.other')?.click()); await docs.waitForTimeout(1000);
  check('crossDoc', /docs\.html#\/pure:/.test(docs.url()));

  // Every doc renders, with every figure drawn.
  log.docs = {};
  for (const key of ['pure', 'sym', 'hull', 'optimized', 'scalable', 'closing', 'crease']) {
    await docs.goto(`${base}docs.html#/${key}`); await docs.waitForTimeout(900);
    log.docs[key] = await docs.evaluate(() => ({ figs: document.querySelectorAll('#readerBody figure.drawn').length, missing: document.querySelectorAll('#readerBody figure:not(.drawn)').length, len: document.getElementById('readerBody').innerText.length }));
    if (log.docs[key].missing || log.docs[key].len < 5000) errs.push('FAIL doc ' + key);
  }
  await docs.goto(`${base}docs.html#/`); await docs.waitForTimeout(800);
  check('specList', await docs.evaluate(() => document.querySelectorAll('.spec-card').length === 7));
  await docs.screenshot({ path: `${out}/docs-list.png` });

  // A link from before the split opens the passage in the docs tab and keeps the node in the app.
  await app.goto(`${base}#/scalable?read=scalable:A-4`); await app.waitForTimeout(1500);
  check('oldLink', app.url().endsWith('#/scalable') && /docs\.html#\/scalable:A-4/.test(docs.url()));

  // The centipede presets: body on a vertical line, each leg opposite its partner.
  await app.goto(`${base}#/scalable`); await app.waitForTimeout(800);   // the solver that offers every preset
  for (const preset of ['centipede4', 'centipede']) {
    await app.selectOption('#preset', preset); await app.waitForTimeout(800);
    const sym = await app.evaluate(() => {
      const pos = treeUi.pos;
      const bodyX = new Set([...pos].filter(([v]) => /^[bg]\d+$/.test(v)).map(([, p]) => p[0].toFixed(4)));
      const pairs = state.mirrors.map(({ a, b }) => [pos.get(a), pos.get(b)]);
      const axis = Number([...bodyX][0]);
      const mirrored = pairs.every(([p, q]) => Math.abs((p[0] + q[0]) / 2 - axis) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6 && p[0] < axis);
      return { straightBody: bodyX.size === 1, mirrored, pairs: pairs.length };
    });
    log[preset] = sym;
    check(`${preset}Bilateral`, sym.straightBody && sym.mirrored && sym.pairs > 0);
    await app.screenshot({ path: `${out}/${preset}.png` });
  }

  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
