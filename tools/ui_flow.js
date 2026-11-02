// End-to-end UI check of the map and the solvers against tools/mock_api.py on port 5099. Every map box opens the
// session (workflow.js): its live step, a new step that the live step allows, or an earlier step of that kind.
//   map → Pure MILP (adds a solve step after the tree) → solve → strain and creases from the map → back to step 2 →
//   Optimized MILP (a solve step that starts from the layout) → Lattice-Hull and Symmetry-Breaking flags → reload.
// The full path through stubs, closing and going back is tools/ui_session.js.
// Usage: node tools/ui_flow.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
const base = 'http://127.0.0.1:5099/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  const posts = [];
  p.on('request', (r) => { if (r.method() === 'POST') posts.push([r.url().replace(/^.*\/api/, '/api'), r.postData()]); });
  const log = {};
  const check = (name, ok) => { log[name] = ok; if (!ok) errs.push('FAIL ' + name); };
  const steps = () => p.evaluate(() => workflowDoc.steps.map((s) => `${s.kind}:${s.node}${s.output ? '' : '(open)'}`));
  const solved = () => p.waitForFunction(() => !document.getElementById('solve').disabled && workflowDoc.last().output, null, { timeout: 20000 });
  const box = (id) => p.click(`a.map-node-link[href="#/${id}"]`);

  await p.goto(base); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/map.png` });
  await box('pure'); await p.waitForTimeout(1200);
  log.pure = { steps: await steps(), title: await p.textContent('#nodeTitle') };
  check('mapSolverAddsSolveStep', log.pure.steps.join() === 'tree:tree,solve:pure(open)');
  await p.click('#solve'); await solved(); await p.waitForTimeout(800);
  log.afterSolve = await steps();
  await p.screenshot({ path: `${out}/pure-after.png`, fullPage: true });

  // Straining and the crease pattern from the map boxes.
  await p.click('#backToMap'); await p.waitForTimeout(800);
  log.mapBadges = await p.evaluate(() => [...document.querySelectorAll('.map-badge')].map((t) => t.textContent));
  log.mapSession = await p.evaluate(() => document.getElementById('benchCards').innerText.replace(/\n/g, ' | '));
  await box('close'); await p.waitForTimeout(1400);
  await p.click('#docAuto');
  await p.waitForFunction(() => !workflowDoc.running && workflowDoc.last().output, null, { timeout: 20000 }); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/close.png`, fullPage: true });
  await p.goto(`${base}#/creases`); await p.waitForTimeout(1400);
  log.creasesOpen = await steps();
  await p.click('#docBuild');
  await p.waitForFunction(() => !workflowDoc.running && workflowDoc.last().output, null, { timeout: 20000 }); await p.waitForTimeout(1200);
  log.fold = await p.evaluate(() => ({ fold: !document.getElementById('foldCard').hidden, crease: getComputedStyle(document.getElementById('creaseCard')).display }));
  check('foldShown', log.fold.fold && log.fold.crease === 'none');
  await p.screenshot({ path: `${out}/fold.png`, fullPage: true });
  log.afterCreases = await steps();

  // Back to step 2, then each other solver from the map: a new solve step that starts from that layout.
  const backTo2 = async () => { await p.click('#doc-step-1 .go-back'); await p.click('#doc-step-1 .go-back'); await p.waitForTimeout(1500); };
  await backTo2();
  check('backToStep2', (await steps()).length === 2);
  await p.goto(`${base}#/optimized`); await p.waitForTimeout(1400);
  log.opt = { steps: await steps(), startRow: await p.evaluate(() => !document.getElementById('startRow').hidden) };
  check('optimizedAddsStep', log.opt.steps.at(-1) === 'solve:optimized(open)');
  await p.click('#solve'); await solved(); await p.waitForTimeout(500);
  const solvePost = posts.filter(([u]) => u === '/api/optimized/solve').pop();
  log.optSolve = { hasStart: !!JSON.parse(solvePost[1]).startLayout, sym: JSON.parse(solvePost[1]).options.symmetryBreaking };
  check('optimizedStartsFromLayout', log.optSolve.hasStart && log.optSolve.sym === true);
  // The same layout again is no progress: the next step is blocked.
  log.sameLayout = await p.evaluate(() => ({ progress: document.getElementById('finalStep').dataset.progress, moves: document.querySelectorAll('#nextMoves .next-move').length }));
  await backTo2();
  await p.goto(`${base}#/hull`); await p.waitForTimeout(1200);
  log.hull = await p.evaluate(() => ({ sym: document.getElementById('optSymmetry').checked, disabled: document.getElementById('optSymmetry').disabled, node: document.body.dataset.node }));
  await p.click('#solve'); await solved(); await p.waitForTimeout(500);
  log.hullSym = JSON.parse(posts.filter(([u]) => u === '/api/optimized/solve').pop()[1]).options.symmetryBreaking;
  check('hullSymmetryOff', log.hull.disabled && log.hullSym === false);
  await backTo2();
  await p.goto(`${base}#/sym`); await p.waitForTimeout(1200);
  await p.click('#solve'); await solved(); await p.waitForTimeout(500);
  log.symFlag = JSON.parse(posts.filter(([u]) => u === '/api/pure/solve').pop()[1]).symmetryBreaking;
  check('symFlag', log.symFlag === true);

  // The tree box now shows step 1, frozen.
  await p.goto(`${base}#/tree`); await p.waitForTimeout(1200);
  log.treeBox = await p.evaluate(() => ({ node: document.body.dataset.node, frozenTree: !!document.querySelector('#doc-step-0') }));
  check('treeBoxShowsStep1', log.treeBox.frozenTree && log.treeBox.node === 'sym');

  // Reload keeps the session.
  const before = await steps();
  await p.reload(); await p.waitForTimeout(1500);
  log.reload = { same: JSON.stringify(await steps()) === JSON.stringify(before), node: await p.evaluate(() => document.body.dataset.node) };
  check('reloadKeepsSession', log.reload.same);
  log.final = before;
  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
