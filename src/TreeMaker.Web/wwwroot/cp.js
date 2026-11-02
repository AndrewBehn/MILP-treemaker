// The crease-pattern page (cp.html): read a crease pattern from an SVG, a FOLD file or an image, let the user check
// the lines, and fold it flat with the server's CreasePatternFold (POST /api/cp/fold). It is a side tool: it shares
// no state with the session and keeps nothing between visits.
//   lines = [{ a: {x, y}, b: {x, y}, kind: "M" | "V" | "U" | "F" | "B" }] in the source's own units, y down.
"use strict";

const cp = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const KINDS = ["M", "V", "U", "F"];   // the click cycle; after F a line is removed
  let lines = [], image = null, imageBox = null, fromImage = false, snapGrid = 0;

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
    parent?.append(el);
    return el;
  }

  // ───── Reading files ─────

  async function readFile(file) {
    const name = file.name.toLowerCase();
    fromImage = false;
    image = null;
    try {
      if (name.endsWith(".svg") || file.type === "image/svg+xml") lines = readSvg(await file.text());
      else if (name.endsWith(".fold") || name.endsWith(".json")) lines = readFold(JSON.parse(await file.text()));
      else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) {
        fromImage = true;
        image = await loadImage(file);
        lines = trace(image);
      } else throw new Error("Open an .svg, .fold, .png or .jpg file.");
    } catch (e) {
      lines = [];
      note(`Could not read ${file.name}: ${e.message}`, "bad");
      draw(); clearFolded();
      return;
    }
    $("cpImageOptions").hidden = !fromImage;
    const count = (k) => lines.filter((l) => l.kind === k).length;
    note(`${file.name}: ${lines.length} lines — ${count("M")} mountain, ${count("V")} valley, ${count("U")} unassigned, ${count("F")} flat, ${count("B")} border.`
      + (fromImage ? ` Traced from the image${snapGrid ? `, ends snapped to a ${snapGrid} × ${snapGrid} grid` : ""}: check them, click to fix, then Fold.` : ""));
    draw();
    clearFolded();
    if (!fromImage && lines.length) fold();
  }

  /** SVG: every stroked line, polyline, polygon, rect and straight path, mapped through its transforms. */
  function readSvg(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    if (doc.querySelector("parsererror")) throw new Error("not a valid SVG");
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden";
    const svg = document.importNode(doc.documentElement, true);
    host.append(svg);
    document.body.append(host);
    const out = [];
    try {
      const root = svg.getScreenCTM?.();
      const inv = root ? root.inverse() : null;
      const map = (el, x, y) => {
        const m = el.getScreenCTM?.();
        if (!m || !inv) return { x, y };
        const p = new DOMPoint(x, y).matrixTransform(m).matrixTransform(inv);
        return { x: p.x, y: p.y };
      };
      const shapes = [...svg.querySelectorAll("line, polyline, polygon, rect, path")];
      let biggestRect = null, biggestArea = 0;
      for (const el of shapes) if (el.tagName.toLowerCase() === "rect") {
        const a = Number(el.getAttribute("width")) * Number(el.getAttribute("height"));
        if (a > biggestArea) { biggestArea = a; biggestRect = el; }
      }
      for (const el of shapes) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.stroke === "none" || !style.stroke) continue;
        const kind = kindOf(el, style.stroke);
        const add = (p, q, k = kind) => out.push({ a: map(el, p[0], p[1]), b: map(el, q[0], q[1]), kind: k });
        const tag = el.tagName.toLowerCase();
        const num = (n) => Number(el.getAttribute(n) ?? 0);
        if (tag === "line") add([num("x1"), num("y1")], [num("x2"), num("y2")]);
        else if (tag === "rect") {
          const x = num("x"), y = num("y"), w = num("width"), h = num("height");
          const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          for (let i = 0; i < 4; i++) add(c[i], c[(i + 1) % 4], el === biggestRect ? "B" : kind);
        } else if (tag === "polyline" || tag === "polygon") {
          const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
          const p = []; for (let i = 0; i + 1 < v.length; i += 2) p.push([v[i], v[i + 1]]);
          for (let i = 0; i + 1 < p.length; i++) add(p[i], p[i + 1]);
          if (tag === "polygon" && p.length > 2) add(p.at(-1), p[0]);
        } else if (tag === "path") {
          for (const [p, q] of pathSegments(el.getAttribute("d") ?? "")) add(p, q);
        }
      }
    } finally { host.remove(); }
    if (!out.length) throw new Error("no stroked lines found");
    return markBorder(out);
  }

  /** The straight pieces of a path (M, L, H, V, Z, upper or lower case); curves are skipped. */
  function pathSegments(d) {
    const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
    const out = [];
    let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
    const n = () => Number(tok[i++]);
    while (i < tok.length) {
      if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "M") { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; sx = x; sy = y; cmd = rel ? "l" : "L"; }
      else if (C === "L") { const a = n(), b = n(); const nx = rel ? x + a : a, ny = rel ? y + b : b; out.push([[x, y], [nx, ny]]); x = nx; y = ny; }
      else if (C === "H") { const a = n(); const nx = rel ? x + a : a; out.push([[x, y], [nx, y]]); x = nx; }
      else if (C === "V") { const b = n(); const ny = rel ? y + b : b; out.push([[x, y], [x, ny]]); y = ny; }
      else if (C === "Z") { if (x !== sx || y !== sy) out.push([[x, y], [sx, sy]]); x = sx; y = sy; }
      else { // a curve or arc: skip its numbers, keep its end point
        const counts = { C: 6, S: 4, Q: 4, T: 2, A: 7 };
        const k = counts[C] ?? 0;
        if (!k) { i++; continue; }
        const v = []; for (let j = 0; j < k; j++) v.push(n());
        x = rel ? x + v[k - 2] : v[k - 2]; y = rel ? y + v[k - 1] : v[k - 1];
      }
    }
    return out;
  }

  /** A stroke's kind from its colour (red mountain, blue valley, anything else a crease), or a title saying so. */
  function kindOf(el, stroke) {
    const t = (el.querySelector("title")?.textContent ?? el.getAttribute("class") ?? "").toLowerCase();
    if (/mountain/.test(t)) return "M";
    if (/valley/.test(t)) return "V";
    if (/border|boundary|edge of/.test(t)) return "B";
    if (/\bflat\b|aux/.test(t)) return "F";
    const m = stroke.match(/\d+(\.\d+)?/g)?.map(Number);
    if (!m || m.length < 3) return "U";
    return colourKind(m[0], m[1], m[2]) ?? "U";
  }

  function colourKind(r, g, b) {
    if (r > 140 && r > g * 1.6 && r > b * 1.6) return "M";
    if (b > 120 && b > r * 1.4 && b > g * 1.05) return "V";
    return null;
  }

  /** Lines that lie along the outline (the bounding box) are the border, unless already a fold. */
  function markBorder(ls) {
    if (ls.some((l) => l.kind === "B")) return ls;
    const xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const tol = 0.004 * Math.max(x1 - x0, y1 - y0);
    const along = (v, w, c) => Math.abs(v - c) < tol && Math.abs(w - c) < tol;
    for (const l of ls) {
      if (l.kind !== "U") continue;
      if (along(l.a.x, l.b.x, x0) || along(l.a.x, l.b.x, x1) || along(l.a.y, l.b.y, y0) || along(l.a.y, l.b.y, y1)) l.kind = "B";
    }
    return ls;
  }

  /** FOLD: vertices_coords, edges_vertices and edges_assignment (C, a cut, is read as border). */
  function readFold(f) {
    const v = f.vertices_coords, e = f.edges_vertices;
    if (!Array.isArray(v) || !Array.isArray(e)) throw new Error("a FOLD file needs vertices_coords and edges_vertices");
    const as = f.edges_assignment ?? [];
    return e.map(([i, j], k) => {
      const a = (as[k] ?? "U").toUpperCase();
      return { a: { x: v[i][0], y: v[i][1] }, b: { x: v[j][0], y: v[j][1] }, kind: a === "C" ? "B" : "MVUFB".includes(a) ? a : "U" };
    });
  }

  // ───── Tracing an image ─────

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("the image could not be opened"));
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Finds the straight lines of a crease pattern image: the pixels are sorted into red, blue and dark, a Hough
   * transform finds lines in each, the pixels along each line are split into runs, and the runs' ends are joined
   * and snapped (to 22.5° angles and to a grid, when asked).
   */
  function trace(img) {
    const max = 720;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const classes = { M: [], V: [], D: [] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = 4 * (y * W + x), r = px[i], g = px[i + 1], b = px[i + 2];
      const c = colourKind(r, g, b) ?? ((r + g + b) / 3 < 120 ? "D" : null);
      if (c) classes[c].push(x, y);
    }
    const minLen = Math.max(12, 0.03 * Math.max(W, H));
    const found = [];
    for (const [c, pts] of Object.entries(classes)) {
      for (const s of houghSegments(pts, W, H, minLen)) found.push({ ...s, kind: c === "D" ? "U" : c });
    }
    imageBox = { w: W, h: H, scale: 1 / k };
    const snapped = snap(found, W, H);
    return markBorder(snapped);
  }

  function houghSegments(pts, W, H, minLen) {
    const n = pts.length / 2;
    if (n < minLen) return [];
    const T = 360, diag = Math.ceil(Math.hypot(W, H)), R = 2 * diag + 1;
    const cos = new Float64Array(T), sin = new Float64Array(T);
    for (let t = 0; t < T; t++) { cos[t] = Math.cos((t * Math.PI) / T); sin[t] = Math.sin((t * Math.PI) / T); }
    const acc = new Int32Array(T * R);
    const alive = new Uint8Array(n).fill(1);
    const vote = (i, d) => { const x = pts[2 * i], y = pts[2 * i + 1]; for (let t = 0; t < T; t++) acc[t * R + Math.round(x * cos[t] + y * sin[t]) + diag] += d; };
    for (let i = 0; i < n; i++) vote(i, 1);
    // A grid of pixels by cell, to find the pixels near a line quickly.
    const cell = 8, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const buckets = Array.from({ length: gw * gh }, () => []);
    for (let i = 0; i < n; i++) buckets[Math.floor(pts[2 * i + 1] / cell) * gw + Math.floor(pts[2 * i] / cell)].push(i);
    const out = [];
    for (let iter = 0; iter < 600; iter++) {
      let best = 0, bi = -1;
      for (let j = 0; j < acc.length; j++) if (acc[j] > best) { best = acc[j]; bi = j; }
      if (best < minLen) break;
      const t = Math.floor(bi / R), rho = (bi % R) - diag;
      const c = cos[t], s = sin[t];
      // The pixels within 2 px of the line, by position along it.
      const near = [];
      const x0 = c * rho, y0 = s * rho, dx = -s, dy = c;
      const steps = Math.ceil(diag * 2 / cell) + 2;
      const seen = new Set();
      for (let q = -steps; q <= steps; q++) {
        const cx = Math.floor((x0 + dx * q * cell / 2) / cell), cy = Math.floor((y0 + dy * q * cell / 2) / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const gx = cx + ox, gy = cy + oy;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
          const key = gy * gw + gx;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const i of buckets[key]) {
            if (!alive[i]) continue;
            const x = pts[2 * i], y = pts[2 * i + 1];
            if (Math.abs(x * c + y * s - rho) <= 2) near.push([(x - x0) * dx + (y - y0) * dy, i]);
          }
        }
      }
      near.sort((p, q) => p[0] - q[0]);
      let start = 0, any = false;
      const gap = Math.max(4, minLen / 3);
      const flush = (from, to) => {
        const len = near[to][0] - near[from][0];
        if (len < minLen || to - from + 1 < minLen * 0.5) return;
        any = true;
        out.push({ a: { x: x0 + dx * near[from][0], y: y0 + dy * near[from][0] }, b: { x: x0 + dx * near[to][0], y: y0 + dy * near[to][0] } });
        for (let j = from; j <= to; j++) { const i = near[j][1]; if (alive[i]) { alive[i] = 0; vote(i, -1); } }
      };
      for (let j = 1; j <= near.length; j++) {
        if (j === near.length || near[j][0] - near[j - 1][0] > gap) { if (j - 1 >= start) flush(start, j - 1); start = j; }
      }
      if (!any) acc[bi] = 0;   // a peak with no long run: forget it
    }
    return out;
  }

  /** Joins and snaps traced lines: angles to 22.5°, ends to each other, to lines they nearly touch, and to a grid. */
  function snap(found, W, H) {
    if (!found.length) return [];
    const xs = found.flatMap((l) => [l.a.x, l.b.x]), ys = found.flatMap((l) => [l.a.y, l.b.y]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    const tol = (Number($("cpJoin").value) || 1.5) / 100 * size;
    const N = Math.max(0, Math.round(Number($("cpGrid").value) || 0));   // empty or "auto": found below
    let ls = found.map((l) => ({ a: { ...l.a }, b: { ...l.b }, kind: l.kind }));
    if ($("cpAngles").checked) {
      for (const l of ls) {
        const mx = (l.a.x + l.b.x) / 2, my = (l.a.y + l.b.y) / 2, len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) / 2;
        const step = Math.PI / 8, raw = Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
        const t = Math.round(raw / step) * step;
        if (Math.abs(t - raw) > 2 * Math.PI / 180) continue;   // only lines already within 2° of a multiple of 22.5°
        l.a = { x: mx - Math.cos(t) * len, y: my - Math.sin(t) * len };
        l.b = { x: mx + Math.cos(t) * len, y: my + Math.sin(t) * len };
      }
    }
    // Ends to the sheet's outline.
    const toBox = (p) => {
      if (Math.abs(p.x - box.x0) < tol) p.x = box.x0; if (Math.abs(p.x - box.x1) < tol) p.x = box.x1;
      if (Math.abs(p.y - box.y0) < tol) p.y = box.y0; if (Math.abs(p.y - box.y1) < tol) p.y = box.y1;
    };
    for (const l of ls) for (const p of [l.a, l.b]) toBox(p);
    // Ends that are close together become one point (their centre).
    const ends = ls.flatMap((l) => [l.a, l.b]);
    const parent = ends.map((_, i) => i);
    const findRoot = (i) => (parent[i] === i ? i : (parent[i] = findRoot(parent[i])));
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) < tol) parent[findRoot(i)] = findRoot(j);
    }
    const groups = new Map();
    ends.forEach((p, i) => { const r = findRoot(i); (groups.get(r) ?? groups.set(r, []).get(r)).push(p); });
    for (const g of groups.values()) {
      const cx = g.reduce((s, p) => s + p.x, 0) / g.length, cy = g.reduce((s, p) => s + p.y, 0) / g.length;
      for (const p of g) { p.x = cx; p.y = cy; }
    }
    // A grid: the one given, or (auto) the coarsest N up to 64 that every end sits on.
    let grid = N;
    if ($("cpGrid").value.trim() === "" || $("cpGrid").value.trim().toLowerCase() === "auto") {
      grid = 0;
      // Only grids much coarser than the tolerance: a fine enough grid fits any points.
      for (let n = 1; n <= 64 && size / n > 4 * tol && !grid; n++) {
        if (ends.every((p) => { const gx = Math.round((p.x - box.x0) / size * n), gy = Math.round((p.y - box.y0) / size * n);
          return Math.hypot(box.x0 + gx * size / n - p.x, box.y0 + gy * size / n - p.y) < tol / 2; })) grid = n;
      }
    }
    if (grid) {
      for (const p of ends) {
        p.x = box.x0 + Math.round((p.x - box.x0) / size * grid) * size / grid;
        p.y = box.y0 + Math.round((p.y - box.y0) / size * grid) * size / grid;
      }
    } else {
      // Without a grid, an end near another line moves onto it, or onto the crossing of the two nearest lines.
      const dist = (p, m) => {
        const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((p.x - m.a.x) * dx + (p.y - m.a.y) * dy) / l2));
        return { d: Math.hypot(m.a.x + t * dx - p.x, m.a.y + t * dy - p.y), q: { x: m.a.x + t * dx, y: m.a.y + t * dy } };
      };
      const lineMeet = (l, m) => {
        const d1x = l.b.x - l.a.x, d1y = l.b.y - l.a.y, d2x = m.b.x - m.a.x, d2y = m.b.y - m.a.y;
        const den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 1e-6 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) return null;
        const t = ((m.a.x - l.a.x) * d2y - (m.a.y - l.a.y) * d2x) / den;
        return { x: l.a.x + t * d1x, y: l.a.y + t * d1y };
      };
      for (const g of groups.values()) {
        const p = g[0];
        const near = ls.filter((m) => !g.includes(m.a) && !g.includes(m.b)).map((m) => ({ m, ...dist(p, m) }))
          .filter((x) => x.d < tol).sort((a, b) => a.d - b.d);
        let to = null;
        if (near.length >= 2) to = lineMeet(near[0].m, near[1].m);
        if (!to && near.length) to = near[0].q;
        if (to && Math.hypot(to.x - p.x, to.y - p.y) < tol) for (const e of g) { e.x = to.x; e.y = to.y; }
      }
    }
    snapGrid = grid;
    ls = ls.filter((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) > tol);
    // Collinear overlapping pieces of the same kind become one line.
    return mergeCollinear(ls, tol / 3);
  }

  function nearSeg(q, m, tol) {
    const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l2 = dx * dx + dy * dy;
    const t = ((q.x - m.a.x) * dx + (q.y - m.a.y) * dy) / l2;
    return t > -tol / Math.sqrt(l2) && t < 1 + tol / Math.sqrt(l2);
  }

  function mergeCollinear(ls, tol) {
    const out = [];
    const used = new Array(ls.length).fill(false);
    for (let i = 0; i < ls.length; i++) {
      if (used[i]) continue;
      const l = ls[i];
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      let lo = 0, hi = len;
      for (let j = i + 1; j < ls.length; j++) {
        if (used[j] || ls[j].kind !== l.kind) continue;
        const m = ls[j];
        const off = (p) => Math.abs((p.x - l.a.x) * uy - (p.y - l.a.y) * ux);
        if (off(m.a) > tol || off(m.b) > tol) continue;
        const ta = (m.a.x - l.a.x) * ux + (m.a.y - l.a.y) * uy, tb = (m.b.x - l.a.x) * ux + (m.b.y - l.a.y) * uy;
        if (Math.max(ta, tb) < lo - tol || Math.min(ta, tb) > hi + tol) continue;
        lo = Math.min(lo, ta, tb); hi = Math.max(hi, ta, tb); used[j] = true;
      }
      out.push({ a: { x: l.a.x + ux * lo, y: l.a.y + uy * lo }, b: { x: l.a.x + ux * hi, y: l.a.y + uy * hi }, kind: l.kind });
    }
    return out;
  }

  // ───── Drawing ─────

  function frame() {
    const pts = lines.flatMap((l) => [l.a, l.b]);
    if (!pts.length) return { x0: 0, y0: 0, size: 1 };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x0, y0, size: Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1 };
  }

  function draw() {
    const svg = $("cpLines");
    svg.replaceChildren();
    const f = frame();
    const P = (p) => ({ x: (p.x - f.x0) / f.size, y: (p.y - f.y0) / f.size });
    if (image && fromImage && $("cpShowImage").checked) {
      // The image sits under the lines, in the traced pixels' frame.
      const href = image.src;
      svgEl("image", { href, x: -f.x0 / f.size, y: -f.y0 / f.size, width: imageBox.w / f.size, height: imageBox.h / f.size, opacity: 0.35, preserveAspectRatio: "none" }, svg);
    }
    const g = svgEl("g", {}, svg);
    lines.forEach((l, i) => {
      const a = P(l.a), b = P(l.b);
      const el = svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "cp-line k-" + l.kind }, g);
      const hit = svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "cp-hit" }, g);
      const t = svgEl("title", {}, hit);
      t.textContent = { M: "Mountain", V: "Valley", U: "Crease (unassigned)", F: "Flat (not folded)", B: "Border" }[l.kind] + " · click to change";
      hit.addEventListener("click", () => {
        if (l.kind === "B") return;
        const next = KINDS.indexOf(l.kind) + 1;
        if (next >= KINDS.length) lines.splice(i, 1); else l.kind = KINDS[next];
        draw(); clearFolded();
      });
      void el;
    });
    for (const v of lastResult?.vertices ?? []) {
      if (v.kawasaki && v.maekawa !== false) continue;
      svgEl("circle", { cx: v.x, cy: v.y, r: 0.018, class: "cp-bad" }, svg);
    }
    $("cpFold").disabled = !lines.length;
    $("cpLineCount").textContent = lines.length ? `${lines.length} lines` : "";
  }

  let lastResult = null;
  function clearFolded() {
    lastResult = null;
    $("cpFolded").replaceChildren();
    $("cpVerdict").textContent = "";
    $("cpVerdict").className = "cp-verdict";
    $("cpMessages").replaceChildren();
  }

  async function fold() {
    $("cpFold").disabled = true;
    $("cpVerdict").textContent = "Folding…";
    try {
      const r = await fetch("api/cp/fold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, ...(fromImage ? { toleranceDegrees: Number($("cpTol").value) || 1 } : {}) }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? data.title ?? r.statusText);
      lastResult = data;
      showFolded(data);
      draw();
    } catch (e) {
      $("cpVerdict").textContent = `Could not fold: ${e.message}`;
      $("cpVerdict").className = "cp-verdict bad";
    } finally { $("cpFold").disabled = !lines.length; }
  }

  function showFolded(r) {
    const svg = $("cpFolded");
    svg.replaceChildren();
    const pts = r.faces.flatMap((f) => f.folded ?? []);
    if (pts.length) {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0, pad = 0.06 * Math.max(w, h, 1e-6);
      svg.setAttribute("viewBox", `${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`);
      const sw = 0.004 * Math.max(w, h);
      for (const f of r.faces) {
        if (!f.folded) continue;
        svgEl("polygon", { points: f.folded.map((p) => `${p.x},${p.y}`).join(" "), class: "cp-face" + (f.flipped ? " back" : ""), "stroke-width": sw }, svg);
      }
    }
    $("cpVerdict").textContent = r.foldable ? "Folds flat." : "Does not fold flat as drawn.";
    $("cpVerdict").className = "cp-verdict " + (r.foldable ? "good" : "bad");
    $("cpMessages").replaceChildren(...(r.messages ?? []).map((m) => { const li = document.createElement("li"); li.textContent = m; return li; }));
  }

  function note(text, kind = "") {
    $("cpReadNote").textContent = text;
    $("cpReadNote").className = "btn-note " + kind;
  }

  function init() {
    $("cpFile").addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) readFile(f); });
    const drop = $("cpDrop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); });
    $("cpFold").addEventListener("click", fold);
    $("cpShowImage").addEventListener("change", draw);
    $("cpRetrace").addEventListener("click", () => { if (image) { lines = trace(image); note(`Traced again: ${lines.length} lines.`); draw(); clearFolded(); } });
    draw();
  }

  return { init, readFile, get lines() { return lines; }, fold, debugTrace: (img) => trace(img) };
})();

cp.init();
