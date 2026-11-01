// End-to-end UI check against tools/mock_api.py on port 5099: map → Pure MILP → solve → close → creases → fold →
// map → Optimized MILP (starts from the workbench layout) → Lattice-Hull and Symmetry-Breaking flags → reload.
// Usage: node tools/ui_flow.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';   // where the screenshots go
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGE ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  const posts = []; p.on('request', (r) => { if (r.method() === 'POST') posts.push([r.url().replace(/^.*\/api/, '/api'), r.postData()]); });
  const log = {};
  await p.goto('http://127.0.0.1:5099/'); await p.waitForTimeout(800);
  await p.click('a[href="#/pure"] >> nth=0'); await p.waitForTimeout(900);
  log.pureTitle = await p.textContent('#nodeTitle');
  log.pureBlocks = await p.evaluate(() => [...document.querySelectorAll('aside [data-nodes]')].filter((b) => !b.hidden).map((b) => b.querySelector('h2')?.textContent ?? b.className));
  await p.screenshot({ path: `${out}/pure-before.png` });
  await p.click('#solve');
  await p.waitForFunction(() => !document.getElementById('metricsCard').hidden && !document.getElementById('solve').disabled, null, { timeout: 15000 });
  await p.waitForTimeout(800);
  log.afterSolve = await p.evaluate(() => ({ status: document.getElementById('status').textContent, shelf: document.getElementById('shelf').innerText.replace(/\n/g, ' '), next: document.getElementById('flowStrip').innerText.replace(/\n/g, ' '), crease: document.getElementById('creaseSummary').textContent, wb: !!workbench.layout }));
  await p.screenshot({ path: `${out}/pure-after.png`, fullPage: true });
  // Step 1
  await p.click('#flowStrip a[href="#/close"]'); await p.waitForTimeout(1200);
  log.close = await p.evaluate(() => ({ title: document.getElementById('nodeTitle').textContent, held: document.getElementById('heldSummary').innerText.replace(/\n/g, ' | '), crease: document.getElementById('creaseSummary').textContent, buildVisible: getComputedStyle(document.querySelector('.crease-build')).display }));
  await p.click('#findStrain');
  await p.waitForFunction(() => workbench.closure?.completion?.after?.valid, null, { timeout: 10000 });
  await p.waitForTimeout(500);
  log.closed = await p.evaluate(() => ({ shelf: document.getElementById('shelf').innerText.replace(/\n/g, ' '), next: document.getElementById('flowStrip').innerText.replace(/\n/g, ' ') }));
  await p.screenshot({ path: `${out}/close.png`, fullPage: true });
  await p.click('#flowStrip a[href="#/creases"]'); await p.waitForTimeout(1200);
  log.creases = await p.evaluate(() => ({ disabled: document.getElementById('buildCreases').disabled, closeVisible: getComputedStyle(document.querySelector('.crease-complete')).display, view: creaseReadiness._state.view }));
  await p.click('#buildCreases'); await p.waitForFunction(() => workbench.creases?.result?.built, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.click('#flowStrip a[href="#/fold"]'); await p.waitForTimeout(1200);
  log.fold = await p.evaluate(() => ({ fold: !document.getElementById('foldCard').hidden, crease: getComputedStyle(document.getElementById('creaseCard')).display, need: !document.getElementById('needCard').hidden }));
  await p.screenshot({ path: `${out}/fold.png`, fullPage: true });
  // Back to the map, then the optimized solver with the held layout.
  await p.click('#backToMap'); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/map-held.png`, fullPage: true });
  log.mapBadges = await p.evaluate(() => [...document.querySelectorAll('.map-badge')].map((t) => t.textContent));
  await p.click('a[href="#/optimized"] >> nth=0'); await p.waitForTimeout(1400);
  log.opt = await p.evaluate(() => ({ startRow: !document.getElementById('startRow').hidden, note: document.getElementById('startNote').textContent, status: document.getElementById('status').textContent, sheet: document.querySelectorAll('#layoutView .leaf').length, creases: !!creaseReadiness._state.creases }));
  await p.click('#solve');
  await p.waitForFunction(() => !document.getElementById('solve').disabled && !document.getElementById('metricsCard').hidden, null, { timeout: 15000 });
  await p.waitForTimeout(500);
  const solvePost = posts.filter(([u]) => u === '/api/optimized/solve').pop();
  log.optSolve = { hasStart: !!JSON.parse(solvePost[1]).startLayout, sym: JSON.parse(solvePost[1]).options.symmetryBreaking, wbNode: await p.evaluate(() => workbench.layout.node), closure: await p.evaluate(() => workbench.closure) };
  // Lattice-hull: symmetry locked off.
  await p.goto('http://127.0.0.1:5099/#/hull'); await p.waitForTimeout(1200);
  log.hull = await p.evaluate(() => ({ sym: document.getElementById('optSymmetry').checked, disabled: document.getElementById('optSymmetry').disabled }));
  await p.click('#solve'); await p.waitForTimeout(1500);
  const hp = posts.filter(([u]) => u === '/api/optimized/solve').pop();
  log.hullSym = JSON.parse(hp[1]).options.symmetryBreaking;
  // Sym node sends symmetryBreaking.
  await p.goto('http://127.0.0.1:5099/#/sym'); await p.waitForTimeout(1200);
  await p.click('#solve'); await p.waitForTimeout(1500);
  const sp = posts.filter(([u]) => u === '/api/pure/solve').pop();
  log.symFlag = JSON.parse(sp[1]).symmetryBreaking;
  // Tree node and preset availability.
  await p.goto('http://127.0.0.1:5099/#/tree'); await p.waitForTimeout(900);
  log.tree = await p.evaluate(() => ({ pick: document.querySelectorAll('.pick-item').length, solve: document.getElementById('solve').hidden }));
  await p.screenshot({ path: `${out}/tree.png` });
  await p.goto('http://127.0.0.1:5099/#/pure'); await p.waitForTimeout(600);
  log.purePresets = await p.evaluate(() => [...document.getElementById('preset').options].filter((o) => o.disabled).length);
  // Reload keeps the workbench.
  await p.reload(); await p.waitForTimeout(1200);
  log.reload = await p.evaluate(() => ({ node: document.body.dataset.node, layout: !!workbench.layout, tree: workbench.tree.edges.length }));
  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
})();
