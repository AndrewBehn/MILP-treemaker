// UI check of the session (workflow.js) against tools/mock_api.py on port 5099. One document from a tree to a crease
// pattern: step 1 the tree (live, then frozen), a solve, a stub, a solve of just the stubs, closing, the crease
// pattern; only the last step is live; "Go back to this step" drops the later ones; the session saves and reopens.
// Usage: node tools/ui_session.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
const base = 'http://127.0.0.1:5099/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.stack));
  p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  const log = {};
  const check = (name, ok) => { if (!ok) errs.push('FAIL ' + name); };
  const steps = () => p.evaluate(() => workflowDoc.steps.map((s) => `${s.kind}:${s.node}${s.output ? '' : '(open)'}`));
  const idle = () => p.waitForFunction(() => !workflowDoc.running && !document.getElementById('solve').disabled, null, { timeout: 20000 });
  const next = async (label) => { await p.click(`#nextMoves button:has-text("${label}")`); await p.waitForTimeout(1500); };

  await p.goto(base); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.click('a.map-node-link[href="#/tree"]'); await p.waitForTimeout(1200);
  log.s1 = await steps();
  log.treeLive = await p.evaluate(() => ({ chips: getComputedStyle(document.querySelector('.drag-chip')).display, pick: !document.getElementById('pickCard').hidden, items: document.querySelectorAll('#pickList .pick-item').length }));
  check('tree live with solver picks', log.treeLive.chips !== 'none' && log.treeLive.pick && log.treeLive.items === 5);

  await p.click('#pickList a[href="#/pure"]'); await p.waitForTimeout(1500);
  log.s2 = await steps();
  log.treeFrozen = await p.evaluate(() => ({ chips: getComputedStyle(document.querySelector('.drag-chip')).display, frozen: document.querySelectorAll('#docSteps .doc-step').length, spec: !!document.querySelector('#doc-step-0 .doc-spec a') }));
  check('tree frozen once solved', log.treeFrozen.chips === 'none' && log.treeFrozen.frozen === 1);
  await p.click('#solve'); await idle(); await p.waitForTimeout(1500);
  log.afterSolve = await steps();
  log.moves = await p.evaluate(() => [...document.querySelectorAll('#nextMoves .next-move button')].map((b) => b.textContent));
  await p.screenshot({ path: `${out}/session-solve.png`, fullPage: true });

  await next('Add a stub');
  await p.click('#addStub'); await p.waitForFunction(() => !workflowDoc.running && workflowDoc.last().output, null, { timeout: 20000 }); await p.waitForTimeout(1500);
  log.afterStub = await steps();
  log.stubMoves = await p.evaluate(() => [...document.querySelectorAll('#nextMoves .next-move.suggested button')].map((b) => b.textContent));
  check('after a stub, solving just the stubs is suggested', log.stubMoves.includes('Solve just the stubs'));

  await next('Solve just the stubs');
  log.which = await p.evaluate(() => ({ shown: !document.getElementById('whichBlock').hidden, value: document.querySelector('input[name="solveWhich"]:checked').value, warn: !document.getElementById('solveWarning').hidden }));
  check('which leaves: stubs', log.which.shown && log.which.value === 'stubs' && !log.which.warn);
  await p.click('#solve'); await idle(); await p.waitForTimeout(1500);
  log.afterStubSolve = await steps();

  await next('Close the polygons');
  await p.click('#docAuto'); await p.waitForFunction(() => !workflowDoc.running && workflowDoc.last().output, null, { timeout: 20000 }); await p.waitForTimeout(1500);
  log.afterClose = await steps();

  await next('Build the crease pattern');
  await p.click('#docBuild'); await p.waitForFunction(() => !workflowDoc.running && workflowDoc.last().output, null, { timeout: 20000 }); await p.waitForTimeout(1500);
  log.afterCreases = await steps();
  log.end = await p.evaluate(() => ({ intro: document.getElementById('nextIntro').textContent, fold: !document.getElementById('foldCard').hidden, frozenInputs: document.querySelectorAll('#docSteps input, #docSteps select').length }));
  check('six steps to the crease pattern', log.afterCreases.length === 6 && !log.afterCreases.some((s) => s.includes('(open)')));
  check('frozen steps have no controls', log.end.frozenInputs === 0);
  await p.screenshot({ path: `${out}/session-full.png`, fullPage: true });

  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#docSave')]);
  const file = `${out}/saved.session.json`;
  await dl.saveAs(file);

  await p.click('#doc-step-2 .go-back'); await p.click('#doc-step-2 .go-back'); await p.waitForTimeout(1800);
  log.afterGoBack = await steps();
  check('go back to step 3', log.afterGoBack.length === 3);
  log.backLive = await p.evaluate(() => ({ hash: location.hash, stubbing: document.body.dataset.stubbing }));

  await p.setInputFiles('#fileInput', file); await p.waitForTimeout(2500);
  log.afterOpen = await steps();
  check('reopened', log.afterOpen.length === 6);
  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
