// The crease-pattern page (cp.html) against tools/mock_api.py, whose /api/cp/fold is tools/cp_fold.py.
// Opens a waterbomb-like pattern as SVG, FOLD and PNG (made here with an SVG→canvas render, so no files are needed)
// and a pattern that cannot fold, and checks the verdicts; also that the map links to the page.
// Usage: node tools/ui_cp.js [port, 5099] (needs Playwright with Chromium).
const { chromium } = require('playwright');
const port = process.argv[2] ?? '5099';
const base = `http://127.0.0.1:${port}/`;

const L = [[[0, 0], [1, 1], 'V'], [[1, 0], [0, 1], 'V'], [[0, .5], [1, .5], 'M'], [[.5, 0], [.5, .5], 'M'], [[.5, .5], [.5, 1], 'V']];
// A degree-4 vertex off any grid, its rays to the border at 0°, 60°, 150° and 270° (sectors 60, 90, 120, 90: Kawasaki holds).
const OFF = (() => {
  const v = [0.37, 0.58], out = [];
  for (const [deg, k] of [[0, 'M'], [60, 'M'], [150, 'V'], [270, 'M']]) {
    const dx = Math.cos(deg * Math.PI / 180), dy = Math.sin(deg * Math.PI / 180);
    const ts = [dx > 0 ? (1 - v[0]) / dx : dx < 0 ? -v[0] / dx : Infinity, dy > 0 ? (1 - v[1]) / dy : dy < 0 ? -v[1] / dy : Infinity];
    const t = Math.min(...ts);
    out.push([v, [v[0] + t * dx, v[1] + t * dy], k]);
  }
  return out;
})();
const BAD = [[[.5, .5], [0, 0], 'V'], [[.5, .5], [1, 0], 'V'], [[.5, .5], [.5, 1], 'M']];
const col = { M: '#d0202a', V: '#1f4ed0' };
// Black and white: mountains solid, valleys dashed (the dashes 8 long with gaps of 5, in a 200-unit sheet).
const monoOf = (ls, w = 2) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 220 220"><g transform="translate(5,5)"><rect x="0" y="0" width="200" height="200" fill="#fff" stroke="#000" stroke-width="${w}"/>`
  + ls.map(([a, b, k]) => `<line x1="${a[0] * 200}" y1="${a[1] * 200}" x2="${b[0] * 200}" y2="${b[1] * 200}" stroke="#222" stroke-width="${w}"${k === 'V' ? ' stroke-dasharray="8 5"' : ''}/>`).join('') + '</g></svg>';
const svgOf = (ls, w = 2) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 220 220"><g transform="translate(5,5)"><rect x="0" y="0" width="200" height="200" fill="#fff" stroke="#000" stroke-width="${w}"/>`
  + ls.map(([a, b, k]) => `<line x1="${a[0] * 200}" y1="${a[1] * 200}" x2="${b[0] * 200}" y2="${b[1] * 200}" stroke="${col[k]}" stroke-width="${w}"/>`).join('') + '</g></svg>';
function foldOf(ls) {
  const V = [], E = [], A = [];
  const id = (p) => { let k = V.findIndex((q) => q[0] === p[0] && q[1] === p[1]); if (k < 0) { V.push(p); k = V.length - 1; } return k; };
  for (const [a, b, k] of [...ls, [[0, 0], [1, 0], 'B'], [[1, 0], [1, 1], 'B'], [[1, 1], [0, 1], 'B'], [[0, 1], [0, 0], 'B']]) { E.push([id(a), id(b)]); A.push(k); }
  return JSON.stringify({ file_spec: 1.1, vertices_coords: V, edges_vertices: E, edges_assignment: A });
}

(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  const log = {};
  const check = (name, ok) => { log[name] = ok; if (!ok) errs.push('FAIL ' + name); };

  await p.goto(base); await p.waitForTimeout(600);
  check('mapLinksToPage', (await p.getAttribute('#mapCp', 'href')) === 'cp.html');

  await p.goto(base + 'cp.html'); await p.waitForTimeout(500);
  // A PNG of the pattern, rendered in the page from its SVG (lines 4 px wide at 600 px).
  const png = await p.evaluate(async (svg) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await img.decode();
    const c = document.createElement('canvas'); c.width = 660; c.height = 660;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 660, 660); g.drawImage(img, 0, 0, 660, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, svgOf(L, 1.3));
  const open = async (name, mime, buffer) => {
    await p.setInputFiles('#cpFile', { name, mimeType: mime, buffer });
    await p.waitForTimeout(900);
  };
  const state = () => p.evaluate(() => ({ lines: cp.lines.length, kinds: cp.lines.map((l) => l.kind).sort().join(''), verdict: document.getElementById('cpVerdict').textContent, faces: document.querySelectorAll('#cpFolded polygon').length, note: document.getElementById('cpReadNote').textContent }));

  await open('waterbomb.svg', 'image/svg+xml', Buffer.from(svgOf(L)));
  log.svg = await state();
  check('svgFolds', log.svg.verdict === 'Folds flat.' && log.svg.faces === 8 && log.svg.kinds.includes('MM') && log.svg.kinds.includes('VVV'));

  await open('waterbomb.fold', 'application/json', Buffer.from(foldOf(L)));
  log.fold = await state();
  check('foldFolds', log.fold.verdict === 'Folds flat.' && log.fold.faces === 8);

  await open('waterbomb.png', 'image/png', Buffer.from(png, 'base64'));
  log.png = await state();
  await p.click('#cpFold'); await p.waitForTimeout(900);
  log.pngFolded = await state();
  check('pngTracesAndFolds', log.pngFolded.verdict === 'Folds flat.' && log.pngFolded.faces === 8);

  // Off the grid: the ends are joined by projection onto the lines they nearly touch.
  const png2 = await p.evaluate(async (svg) => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = 660; c.height = 660;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 660, 660); g.drawImage(img, 0, 0, 660, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, svgOf(OFF, 1.3));
  await open('offgrid.png', 'image/png', Buffer.from(png2, 'base64'));
  await p.click('#cpFold'); await p.waitForTimeout(900);
  log.offgrid = await state();
  check('offGridTracesAndFolds', log.offgrid.verdict === 'Folds flat.' && log.offgrid.faces === 4);
  await p.screenshot({ path: '/tmp/claude-0/cp-png.png' });

  await open('bad.svg', 'image/svg+xml', Buffer.from(svgOf(BAD)));
  log.bad = await state();
  check('badDoesNotFold', log.bad.verdict.startsWith('Does not fold') && (await p.$$('#cpLines .cp-bad')).length >= 1);

  // Clicking a line changes its kind.
  const before = await p.evaluate(() => cp.lines.map((l) => l.kind).join(''));
  await p.evaluate(() => { const hit = [...document.querySelectorAll('#cpLines .cp-hit')].find((h, i) => cp.lines[i]?.kind !== 'B'); hit.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  check('clickChangesKind', before !== (await p.evaluate(() => cp.lines.map((l) => l.kind).join(''))));

  // Black and white, by line style: as an SVG (stroke-dasharray), then as a traced image.
  const kindsOf = (ls) => ls.map(([, , k]) => k).concat(['B', 'B', 'B', 'B']).sort().join('');
  await open('mono.svg', 'image/svg+xml', Buffer.from(monoOf(L)));
  log.monoSvg = await state();
  check('monoSvgByStyle', log.monoSvg.kinds === kindsOf(L) && log.monoSvg.verdict === 'Folds flat.');
  const monoPng = await p.evaluate(async (svg) => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = 660; c.height = 660;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 660, 660); g.drawImage(img, 0, 0, 660, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, monoOf(L, 1.3));
  await open('mono.png', 'image/png', Buffer.from(monoPng, 'base64'));
  log.monoPng = await state();
  check('monoPngByStyle', log.monoPng.kinds === kindsOf(L));
  await p.click('#cpFold'); await p.waitForTimeout(900);
  log.monoPngFolded = await state();
  check('monoPngFolds', log.monoPngFolded.verdict === 'Folds flat.' && log.monoPngFolded.faces === 8);
  await p.screenshot({ path: '/tmp/claude-0/cp-mono.png' });

  // An accordion of seven pleats, alternating solid and dashed, at one eighth of the sheet apart.
  const ACC = [1, 2, 3, 4, 5, 6, 7].map((k) => [[k / 8, 0], [k / 8, 1], k % 2 ? 'M' : 'V']);
  const accPng = await p.evaluate(async (svg) => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = 660; c.height = 660;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 660, 660); g.drawImage(img, 0, 0, 660, 660);
    return c.toDataURL('image/png').split(',')[1];
  }, monoOf(ACC, 1.3));
  await open('accordion.png', 'image/png', Buffer.from(accPng, 'base64'));
  await p.click('#cpFold'); await p.waitForTimeout(900);
  log.accordion = await state();
  check('accordionByStyle', log.accordion.kinds === kindsOf(ACC) && log.accordion.verdict === 'Folds flat.' && log.accordion.faces === 8);

  // Swapping mountains and valleys: every assignment exchanged, the base seen from the other side (mirrored).
  const beforeSwap = (await state()).kinds;
  await p.check('#cpSwap'); await p.waitForTimeout(900);
  log.swapped = await state();
  const swapKinds = (k) => k.split('').map((c) => (c === 'M' ? 'V' : c === 'V' ? 'M' : c)).sort().join('');
  check('swapExchangesKinds', log.swapped.kinds === swapKinds(beforeSwap) && log.swapped.verdict.startsWith('Folds flat.') && /swapped/.test(log.swapped.verdict)
    && await p.evaluate(() => !!document.querySelector('#cpFolded g[transform*="scale(-1"]')));
  await p.uncheck('#cpSwap'); await p.waitForTimeout(900);
  check('swapBack', (await state()).kinds === beforeSwap);
  // With the style rule off, black lines are plain creases.
  await p.uncheck('#cpStyle'); await p.waitForTimeout(1200);
  check('styleOff', !/[MV]/.test((await state()).kinds));

  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
