// The crease-pattern page (cp.html) against a corpus of real crease patterns in tools/cp_fixtures/ (see its README for
// where each came from and its licence). Opens every file as it is (SVG or FOLD), then every SVG again as a PNG rendered
// in the page, and checks that each one folds flat with the same lines either way.
// Usage: node tools/ui_cp_corpus.js [port, 5099] [--report] (needs Playwright with Chromium and tools/mock_api.py).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const port = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '5099';
const report = process.argv.includes('--report');
const base = `http://127.0.0.1:${port}/`;
const dir = path.join(__dirname, 'cp_fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  await p.goto(base + 'cp.html'); await p.waitForTimeout(500);

  const state = () => p.evaluate(() => {
    const n = (k) => cp.lines.filter((l) => l.kind === k).length;
    return { lines: cp.lines.length, M: n('M'), V: n('V'), F: n('F'), U: n('U'), B: n('B'), verdict: document.getElementById('cpVerdict').textContent, faces: document.querySelectorAll('#cpFolded polygon').length };
  });
  const open = async (name, mime, buffer, fold) => {
    await p.setInputFiles('#cpFile', { name, mimeType: mime, buffer });
    await p.waitForTimeout(700);
    if (fold && await p.isEnabled('#cpFold')) { await p.click('#cpFold'); await p.waitForTimeout(900); }
    return state();
  };
  // An SVG drawn into a canvas, cropped to its lines and about 900 px on its long side, as an exported or scanned
  // image would be: every stroke is drawn about 3 px wide, since many files use hairlines.
  const rasterize = (svg) => p.evaluate(async (svg) => {
    const ls = cp.lines;
    const xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
    const m = 0.04 * size, w = Math.max(...xs) - x0 + 2 * m, h = Math.max(...ys) - y0 + 2 * m;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    root.setAttribute('viewBox', `${x0 - m} ${y0 - m} ${w} ${h}`);
    const W = Math.round(900 * w / Math.max(w, h)), H = Math.round(900 * h / Math.max(w, h));
    root.setAttribute('width', W); root.setAttribute('height', H);
    root.removeAttribute('x'); root.removeAttribute('y');
    const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = `line, path, polyline, polygon, rect { stroke-width: ${(3.2 * Math.max(w, h) / 900).toFixed(3)}px !important; opacity: 1 !important; }`;
    root.prepend(st);
    const text = new XMLSerializer().serializeToString(doc);
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
    await img.decode();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    return c.toDataURL('image/png').split(',')[1];
  }, svg);

  const rows = [], limits = [];
  for (const [file, want] of Object.entries(expected)) {
    const buf = fs.readFileSync(path.join(dir, file));
    const isSvg = file.endsWith('.svg');
    const vec = await open(file, isSvg ? 'image/svg+xml' : 'application/json', buf, false);
    rows.push({ file, how: isSvg ? 'svg' : 'fold', ...vec });
    if (report) console.log(JSON.stringify(rows.at(-1)));
    const folds = vec.verdict === 'Folds flat.';
    const ok = want.read === false ? vec.lines === 0 : folds === (want.folds !== false) && (want.faces == null || vec.faces === want.faces);
    if (!ok) errs.push(`FAIL ${file}: ${vec.verdict || 'not read'} (${vec.faces} faces, want ${want.read === false ? 'not read' : (want.folds !== false ? 'folds' : 'does not fold') + (want.faces ? ', ' + want.faces + ' faces' : '')})`);
    if (isSvg && want.png !== false && want.read !== false) {
      const png = await rasterize(buf.toString('utf8'));
      if (process.env.CP_PNG_DIR) fs.writeFileSync(path.join(process.env.CP_PNG_DIR, file.replace('.svg', '.png')), Buffer.from(png, 'base64'));
      const ras = await open(file.replace('.svg', '.png'), 'image/png', Buffer.from(png, 'base64'), true);
      rows.push({ file, how: 'png', ...ras });
      if (report) console.log(JSON.stringify(rows.at(-1)));
      // Vector files often draw one crease as several pieces, so the image is compared by its faces, not its lines.
      // A pattern that does not fold need only not fold as an image too.
      const good = (ras.verdict === 'Folds flat.') === folds && (!folds || ras.faces === vec.faces);
      if (!good && want.pngLimit) limits.push(`${file} as PNG (known limit: ${want.pngLimit}): ${ras.verdict} (${ras.faces} faces, ${vec.faces} from the file)`);
      else if (!good) errs.push(`FAIL ${file} as PNG: ${ras.verdict} (${ras.faces} faces, ${vec.faces} from the file)`);
      else if (want.pngLimit) limits.push(`${file} as PNG now folds: drop its pngLimit`);
    }
  }
  if (report) console.table(rows.map((r) => ({ file: r.file, how: r.how, lines: r.lines, M: r.M, V: r.V, F: r.F, U: r.U, B: r.B, faces: r.faces, verdict: r.verdict.slice(0, 60) })));
  await browser.close();
  if (limits.length) console.log(limits.join('\n'));
  console.log(errs.length ? errs.join('\n') : `ui_cp_corpus OK (${rows.length} readings of ${Object.keys(expected).length} patterns${limits.length ? `, ${limits.length} known limits` : ''})`);
  process.exit(errs.length ? 1 : 0);
})();
