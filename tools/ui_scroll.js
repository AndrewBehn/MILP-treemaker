// UI check that no action inside a step moves the page (against tools/mock_api.py on port 5099). Each action is
// done with its control scrolled to the middle of the screen; afterwards the control (or, if it is gone, the live
// step's frame) must be where it was, within a few pixels. Only "Delete this and below", choosing a next step and the
// step cards scroll on purpose, so they are not checked here.
// Usage: node tools/ui_scroll.js [screenshot dir] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:5099/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  const results = [];
  const top = (sel) => p.evaluate((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().top : null; }, sel);
  const idle = () => p.waitForFunction(() => !workflowDoc.running && !document.getElementById('solve').disabled, null, { timeout: 20000 });
  // Does `action` on the control `sel` leave `anchor` (default: the control) where it was?
  async function steady(name, sel, action, { anchor = sel, wait = 1200 } = {}) {
    await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
    await p.waitForTimeout(250);
    const y0 = await p.evaluate(() => window.scrollY), t0 = await top(anchor) ?? await top('#finalStep');
    await action();
    await p.waitForTimeout(wait);
    const y1 = await p.evaluate(() => window.scrollY), t1 = await top(anchor) ?? await top('#finalStep');
    const moved = Math.round(t1 - t0);
    results.push({ name, scrolled: Math.round(y1 - y0), moved });
    if (Math.abs(moved) > 6) errs.push(`FAIL ${name}: the control moved ${moved}px (page scrolled ${Math.round(y1 - y0)}px)`);
  }
  const vertexBox = async (v) => {
    const g = p.locator(`#treeView .vertex-group[data-vertex="${v}"] .vertex-hit`);
    return g.boundingBox();
  };

  await p.goto(base); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.click('a.map-node-link[href="#/tree"]'); await p.waitForTimeout(1200);

  // ── Step 1, the tree ──
  await steady('preset', '#preset', () => p.selectOption('#preset', 'star5'));
  await steady('grid N', '#gridSize', async () => { await p.fill('#gridSize', '10'); });
  await steady('leaf circles toggle', '#treeCircles', () => p.click('#treeCircles'));
  await steady('tidy', '#tidyTree', () => p.click('#tidyTree'));
  await steady('leaf menu: open', '#treeView', async () => { const bb = await vertexBox('1'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }, { anchor: '#treeView' });
  await steady('leaf menu: pin a corner', '#treeView', () => p.click('.leaf-menu .lm-pin.p0'), { anchor: '#treeView' });
  await steady('leaf menu: mirror pick', '#treeView', async () => {
    let bb = await vertexBox('2'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(300);
    await p.click('.leaf-menu >> text=Mirror with another leaf…'); await p.waitForTimeout(200);
    bb = await vertexBox('3'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  }, { anchor: '#treeView' });
  await steady('rename (double-click)', '#treeView', async () => {
    const bb = await vertexBox('4'); await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(200);
    await p.keyboard.press('Escape');
  }, { anchor: '#treeView' });
  await steady('edit a length', '#treeView', async () => {
    await p.click('#treeView .length-tag >> nth=0'); await p.waitForTimeout(200); await p.keyboard.type('2'); await p.keyboard.press('Enter');
  }, { anchor: '#treeView' });
  await steady('edge table: open', '.edge-table summary', () => p.click('.edge-table summary'));
  await steady('edge table: add edge', '#addEdge', () => p.click('#addEdge'), { anchor: '.edge-table summary' });   // the new row grows below the summary
  await p.evaluate(() => { const r = document.querySelectorAll('#edgeRows tr'); r[r.length - 1]?.querySelector('button')?.click(); });
  await p.click('.edge-table summary');

  // ── Step 2, a solve ──
  await p.click('#pickList a[href="#/pure"]'); await p.waitForTimeout(1500);
  await steady('solve', '#solve', async () => { await p.click('#solve'); await idle(); }, { wait: 1500 });
  await steady('layer: every pair', '.layer:has(#showAllPairs)', () => p.click('.layer:has(#showAllPairs)'));
  await steady('layer: leaf circles', '.layer:has(#showCircles)', () => p.click('.layer:has(#showCircles)'));
  await steady('point at a leaf on the sheet', '#layoutView', async () => { const bb = await p.locator('#layoutView .leaf >> nth=0').boundingBox(); await p.mouse.move(bb.x + 3, bb.y + 3); }, { anchor: '#layoutView' });
  await steady('click a leaf on the sheet', '#layoutView', async () => { const bb = await p.locator('#layoutView .leaf >> nth=0').boundingBox(); await p.mouse.click(bb.x + 3, bb.y + 3); }, { anchor: '#layoutView' });
  await steady('solve again (re-run the live step)', '#solve', async () => { await p.click('#solve'); await idle(); }, { wait: 1500 });

  // ── Step 3, stubs ──
  await p.click('#nextMoves button:has-text("Add stubs")'); await p.waitForTimeout(1500);
  await steady('stub: region chip', '#stubRegions .stub-region:first-child', () => p.click('#stubRegions .stub-region:first-child'), { anchor: '#stubRegions' });
  await steady('stub: proposal', '#stubFacts .stub-option:nth-child(2)', () => p.click('#stubFacts .stub-option:nth-child(2)'), { anchor: '#stubFacts' });
  await steady('stub: click the sheet', '#layoutView', async () => { const bb = await p.locator('#layoutView').boundingBox(); await p.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.45); }, { anchor: '#layoutView' });
  await steady('stub: click a joint', '#treeView', async () => { const j = await p.evaluate(() => document.querySelector('#treeView .vertex-group.pickable, #treeView .vertex-group.pick-from')?.dataset.vertex); if (j) { const bb = await vertexBox(j); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); } }, { anchor: '#treeView' });
  await steady('stub: add', '#addStub', async () => { await p.click('#addStub'); await idle(); }, { wait: 1800 });
  await steady('stub: remove', '#removeStub', async () => { await p.click('#removeStub'); }, { anchor: '#addStub', wait: 1800 });
  await steady('stub: add again', '#addStub', async () => { await p.click('#addStub'); await idle(); }, { wait: 1800 });

  // ── Step 4, straining ──
  await p.click('#nextMoves button:has-text("Strain the edges")'); await p.waitForTimeout(1500);
  await steady('strain within bounds (too tight)', '#docBounds', async () => { await p.fill('#docStrainMax', '0.1'); await p.click('#docBounds'); await idle(); }, { wait: 1800 });
  await steady('find the smallest strain', '#docAuto', async () => { await p.click('#docAuto'); await idle(); }, { wait: 1800 });

  // ── Step 5, creases ──
  await p.click('#nextMoves button:has-text("Build the crease pattern")'); await p.waitForTimeout(1500);
  await steady('pleat toggle', '#docPleatOn', () => p.click('#docPleatOn'));
  await steady('build the crease pattern', '#docBuild', async () => { await p.click('#docBuild'); await idle(); }, { wait: 1800 });

  console.log(JSON.stringify({ results, errs }, null, 1));
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
