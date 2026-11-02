// Refine solution: a feasible (not optimal) solve offers it first; it re-runs the same solver and settings from that layout.
// Usage: node tools/ui_refine.js (needs tools/mock_api.py on port 5099, whose Scalable solve answers Feasible).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  const posts=[]; p.on('request', r=>{ if(r.method()==='POST') posts.push([r.url().replace(/^.*\/api/,'/api'), r.postData()]); });
  const base='http://127.0.0.1:5099/';
  await p.goto(base); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.goto(base+'#/scalable'); await p.waitForFunction(() => workflowDoc.last().output, null, {timeout:20000}); await p.waitForTimeout(1200);
  const moves = await p.evaluate(() => [...document.querySelectorAll('#nextMoves .next-move')].map((c) => c.querySelector('button').textContent + (c.classList.contains('suggested') ? '*' : '')));
  // Change a setting, so we can see the refine step keeps the refined step's settings, not the page's.
  const starts = await p.evaluate(() => workflowDoc.last().params.controls.optStarts);
  await p.click('#nextMoves .next-move:first-child button');
  await p.waitForFunction(() => workflowDoc.steps.length === 3 && workflowDoc.last().output, null, {timeout:20000}); await p.waitForTimeout(800);
  const req = JSON.parse(posts.filter(([u]) => u === '/api/scalable/solve').pop()[1]);
  const st = await p.evaluate(() => ({ title: document.querySelector('#docOutline li:last-child .sc-title').textContent, params: workflowDoc.last().params.refine }));
  const ok = moves[0] === "Refine solution*" && !!req.startLayout && st.title === "Refine with Scalable MILP" && !errs.length;
  console.log(JSON.stringify({ moves, starts, hasStart: !!req.startLayout, multistarts: req.options.multistarts, st, errs, ok }, null, 1));
  process.exitCode = ok ? 0 : 1;
  await b.close();
})();
