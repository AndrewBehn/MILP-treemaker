// UI check of the session (workflow.js) against tools/mock_api.py on port 5099: solve, then in the document add a
// stub, solve just the stubs (with Cancel shown while it runs), close automatically, build the crease pattern,
// save the session, continue and redo from a step, and open the saved file again.
// Usage: node tools/ui_session.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const out = process.argv[2] ?? '.';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.stack)); p.on('console', m => { if (m.type()==='error' && !/TUNNEL/.test(m.text())) errs.push(m.text()); });
  const log = {};
  const steps = () => p.evaluate(() => workflowDoc.steps.map(s => s.title));
  const waitIdle = () => p.waitForFunction(() => !workflowDoc.running, null, { timeout: 20000 });
  await p.goto('http://127.0.0.1:5099/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.click('a[href="#/pure"] >> nth=0'); await p.waitForTimeout(900);
  await p.click('#solve');
  await p.waitForFunction(() => !document.getElementById('metricsCard').hidden && !document.getElementById('solve').disabled, null, { timeout: 15000 });
  await p.click('#flowStrip a[href="#/close"]'); await p.waitForTimeout(2000);
  log.s1 = await steps();
  log.liveInDoc = await p.evaluate(() => document.querySelector('.duo').parentElement.id);
  await p.screenshot({ path: `${out}/doc-1.png`, fullPage: true });
  // stub
  await p.click('.move-tab[data-move="stub"]'); await p.waitForTimeout(400);
  log.stubbing = await p.evaluate(() => document.body.dataset.stubbing);
  await p.click('#addStub'); await waitIdle(); await p.waitForTimeout(1500);
  log.s2 = await steps();
  // solve just stubs
  await p.click('.move-tab[data-move="solve"]'); await p.selectOption('#docSolver', 'pure');
  await p.check('input[name="solveWhich"][value="stubs"]');
  await p.click('#docRunSolve'); await p.waitForTimeout(150);
  log.runningShown = await p.evaluate(() => !!document.getElementById('doc-running') && !!document.querySelector('#doc-running button'));
  await waitIdle(); await p.waitForTimeout(1500);
  log.s3 = await steps();
  log.warnHiddenForStubs = await p.evaluate(() => document.getElementById('solveWarning').hidden);
  await p.check('input[name="solveWhich"][value="all"]');
  log.warnShownForAll = await p.evaluate(() => !document.getElementById('solveWarning').hidden);
  // close automatically
  await p.click('.move-tab[data-move="close"]'); await p.click('#docAuto'); await waitIdle(); await p.waitForTimeout(1500);
  log.s4 = await steps();
  // creases
  await p.click('.move-tab[data-move="creases"]'); await p.waitForTimeout(300);
  log.buildEnabled = await p.evaluate(() => !document.getElementById('docBuild').disabled);
  if (log.buildEnabled) { await p.click('#docBuild'); await waitIdle(); await p.waitForTimeout(1500); }
  log.s5 = await steps();
  log.widgets = await p.evaluate(() => document.querySelectorAll('.doc-step .state-widget .w-tree').length);
  await p.screenshot({ path: `${out}/doc-full.png`, fullPage: true });
  // save
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#docSave')]);
  const file = `${out}/saved.session.json`; await dl.saveAs(file);
  // continue from step 2
  await p.click('#doc-step-1 >> text=Continue from here'); await p.waitForTimeout(1800);
  log.afterContinue = await steps();
  log.wbLeaves = await p.evaluate(() => workbench.layout.points.length);
  // redo step 2
  await p.click('#doc-step-1 >> text=Redo from here'); await p.waitForTimeout(1800);
  log.afterRedo = await steps();
  // open the saved file
  await p.setInputFiles('#fileInput', file); await p.waitForTimeout(2500);
  log.afterOpen = await steps();
  const want = { s5: 5, afterContinue: 2, afterRedo: 1, afterOpen: 5 };
  for (const [k, n] of Object.entries(want)) if (log[k].length !== n) errs.push(`FAIL ${k}: ${log[k].length} steps, expected ${n}`);
  if (!log.runningShown || !log.warnShownForAll || !log.warnHiddenForStubs) errs.push('FAIL running step or warning');
  console.log(JSON.stringify({ ...log, errs }, null, 1));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
