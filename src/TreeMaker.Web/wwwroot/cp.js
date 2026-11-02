// The crease-pattern page (cp.html): read a crease pattern from an SVG, a FOLD file or an image, let the user check
// the lines, and fold it flat with the server's CreasePatternFold (POST /api/cp/fold). It is a side tool: it shares
// no state with the session and keeps nothing between visits.
//   lines = [{ a: {x, y}, b: {x, y}, kind: "M" | "V" | "U" | "F" | "B" }] in the source's own units, y down.
"use strict";

const cp = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const KINDS = ["M", "V", "U", "F"];   // the click cycle; after F a line is removed
  let lastFound = null, lines = [], image = null, imageBox = null, fromImage = false, snapGrid = 0, lastFile = null, swapped = false;

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs ?? {})) el.setAttribute(k, v);
    parent?.append(el);
    return el;
  }

  // ───── Reading files ─────

  async function readFile(file) {
    const name = file.name.toLowerCase();
    lastFile = file;
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
    $("cpReadOptions").hidden = false;
    if (swapped) lines = swapKinds(lines);
    const count = (k) => lines.filter((l) => l.kind === k).length;
    const styled = lines.filter((l) => l.style).length;
    note(`${file.name}: ${lines.length} lines — ${count("M")} mountain, ${count("V")} valley, ${count("U")} unassigned, ${count("F")} flat, ${count("B")} border.`
      + (styled ? ` ${styled} assigned by line style (solid ${swapped ? "valley" : "mountain"}, dashed ${swapped ? "mountain" : "valley"}).` : "")
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
        const dashed = !!style.strokeDasharray && style.strokeDasharray !== "none" && !/^0(px)?$/.test(style.strokeDasharray);
        const kind = kindOf(el, style.stroke, dashed);
        const colour = kind !== "SOLID" && !(useStyle() && dashed && kind === "V" && !colourOf(style.stroke));
        const add = (p, q, k = kind) => out.push({ a: map(el, p[0], p[1]), b: map(el, q[0], q[1]), kind: k, dashed, colour });
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
    return markBorder(joinEnds(out));
  }

  /**
   * Drawn files are often a little off: lines that should meet stop just short or run just past. Ends closer than
   * 0.3% of the sheet become one point, and an end that close to another line moves onto it. Exact files are
   * unchanged.
   */
  function joinEnds(ls) {
    const xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
    const tol = 0.003 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (!(tol > 0)) return ls;
    const ends = ls.flatMap((l) => [l.a, l.b]);
    const parent = ends.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (Math.abs(ends[i].x - ends[j].x) < tol && Math.abs(ends[i].y - ends[j].y) < tol
        && Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) < tol) parent[root(i)] = root(j);
    }
    const groups = new Map();
    ends.forEach((p, i) => { const r = root(i); (groups.get(r) ?? groups.set(r, []).get(r)).push(p); });
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const cx = g.reduce((s, p) => s + p.x, 0) / g.length, cy = g.reduce((s, p) => s + p.y, 0) / g.length;
      for (const p of g) { p.x = cx; p.y = cy; }
    }
    // An end near the inside of another line (a T-junction drawn a little short or long) moves onto that line.
    for (const l of ls) for (const p of [l.a, l.b]) {
      let best = null;
      for (const m of ls) {
        if (m === l) continue;
        const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = ((p.x - m.a.x) * dx + (p.y - m.a.y) * dy) / l2;
        if (t <= 0 || t >= 1) continue;
        const qx = m.a.x + t * dx, qy = m.a.y + t * dy, d = Math.hypot(qx - p.x, qy - p.y);
        if (d > 1e-9 * tol && d < tol && Math.hypot(qx - m.a.x, qy - m.a.y) > tol && Math.hypot(qx - m.b.x, qy - m.b.y) > tol
          && (!best || d < best.d)) best = { d, x: qx, y: qy };
      }
      if (best) { p.x = best.x; p.y = best.y; }
    }
    return ls.filter((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) > tol);
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
  function kindOf(el, stroke, dashed) {
    const t = (el.querySelector("title")?.textContent ?? el.getAttribute("class") ?? "").toLowerCase();
    if (/mountain/.test(t)) return "M";
    if (/valley/.test(t)) return "V";
    if (/border|boundary|edge of/.test(t)) return "B";
    if (/\bflat\b|aux/.test(t)) return "F";
    const byColour = colourOf(stroke);
    if (byColour) return byColour;
    // A line with no colour of its own: its style says which fold it is, when that is asked for.
    if (useStyle()) return dashed ? "V" : "SOLID";
    return "U";
  }

  /** The fold a CSS stroke colour gives, or null. */
  function colourOf(stroke) {
    const m = stroke.match(/\d+(\.\d+)?/g)?.map(Number);
    return m && m.length >= 3 ? colourKind(m[0], m[1], m[2], true) : null;
  }

  /** Whether line style assigns folds: solid lines mountains, dashed lines valleys (before any swap). */
  const useStyle = () => $("cpStyle").checked;

  /** Mountains become valleys and valleys mountains: the same pattern folded from the paper's other side. */
  const swapKinds = (ls) => ls.map((l) => ({ ...l, kind: l.kind === "M" ? "V" : l.kind === "V" ? "M" : l.kind }));

  /**
   * A stroke's fold from its colour, in the convention most crease-pattern editors share (ORIPA, Origami Simulator):
   * red mountain, blue valley, yellow or (in vector files) grey a flat line, green a cut (read as border), magenta a
   * crease with no fold given. Black and anything else have no colour of their own (null).
   */
  function colourKind(r, g, b, vector = false) {
    if (r > 140 && b > 120 && g < 0.6 * Math.min(r, b)) return "U";
    if (r > 140 && r > g * 1.6 && r > b * 1.6) return "M";
    if (b > 120 && b > r * 1.4 && b > g * 1.05) return "V";
    if (r > 150 && g > 150 && b < 0.7 * Math.min(r, g)) return "F";
    if (g > 110 && g > r * 1.4 && g > b * 1.4) return "B";
    // Grey: only in vector files, since in an image the soft edges of every dark line are grey too.
    if (vector && Math.max(r, g, b) - Math.min(r, g, b) < 30 && r + g + b > 300 && r + g + b < 690) return "F";
    return null;
  }

  /**
   * Lines that lie along the outline (the bounding box) are the border, unless already a fold. In a pattern whose
   * folds are coloured, a solid dark line is the border (or a cut) wherever it lies, as the colour editors draw it:
   * the sheet need not be a square.
   */
  function markBorder(ls) {
    if (ls.some((l) => l.colour && (l.kind === "M" || l.kind === "V"))) {
      for (const l of ls) if (l.kind === "SOLID") l.kind = "B";
    }
    if (ls.some((l) => l.kind === "B")) {
      for (const l of ls) if (l.kind === "SOLID") { l.kind = "M"; l.style = "solid"; }
      return ls;
    }
    const xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const tol = 0.004 * Math.max(x1 - x0, y1 - y0);
    const along = (v, w, c) => Math.abs(v - c) < tol && Math.abs(w - c) < tol;
    for (const l of ls) {
      if (l.kind !== "U" && l.kind !== "SOLID") continue;
      if (along(l.a.x, l.b.x, x0) || along(l.a.x, l.b.x, x1) || along(l.a.y, l.b.y, y0) || along(l.a.y, l.b.y, y1)) l.kind = "B";
    }
    // A solid line that is not the outline is a mountain.
    for (const l of ls) if (l.kind === "SOLID") { l.kind = "M"; l.style = "solid"; }
    for (const l of ls) if (l.kind === "V" && l.dashed) l.style = "dashed";
    return ls;
  }

  /** FOLD: vertices_coords, edges_vertices and edges_assignment (C, a cut, is read as border). */
  function readFold(f) {
    // A FOLD file may hold a folded form, with the crease pattern in one of its frames (or not at all).
    const classes = (fr) => [].concat(fr.frame_classes ?? []);
    const flat = (fr) => Array.isArray(fr.vertices_coords) && fr.vertices_coords.every((p) => !p[2]);
    const isCp = (fr) => Array.isArray(fr.vertices_coords) && !classes(fr).includes("foldedForm") && flat(fr);
    if (!isCp(f)) {
      const cp = (f.file_frames ?? []).find((fr) => isCp(fr) && Array.isArray(fr.edges_vertices));
      if (cp) f = cp;
      else if (Array.isArray(f.vertices_coords)) throw new Error("this FOLD file holds a folded form (its vertices are not all in one plane, or it says foldedForm), not a crease pattern");
    }
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
    const max = 1000;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const classes = { M: [], V: [], F: [], B: [], U: [], D: [] };
    const ink = new Uint8Array(W * H);   // each pixel's class, 1 + its index in classes (0: paper)
    const codes = Object.keys(classes);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = 4 * (y * W + x), r = px[i], g = px[i + 1], b = px[i + 2];
      const c = colourKind(r, g, b) ?? ((r + g + b) / 3 < 120 ? "D" : null);
      if (c) { classes[c].push(x, y); ink[y * W + x] = 1 + codes.indexOf(c); }
    }
    const minLen = Math.max(12, 0.03 * Math.max(W, H));
    const found = [];
    for (const [c, pts] of Object.entries(classes)) {
      // Dark lines take their fold from their style when asked: dashed valleys, solid mountains (or the outline).
      for (const s of houghSegments(pts, W, H, minLen, c === "D", ink, 1 + codes.indexOf(c))) found.push({ ...s, colour: c !== "D", kind: c !== "D" ? c : !useStyle() ? "U" : s.dashed ? "V" : "SOLID" });
    }
    imageBox = { w: W, h: H, scale: 1 / k };
    lastFound = found;
    const snapped = snap(found, W, H, { ink, W, H });
    return markBorder(snapped);
  }

  /** styled: whether the strokes' style matters (dark lines, read as solid or dashed). */
  function houghSegments(pts, W, H, minLen, styled = true, ink = null, code = 0) {
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
      const near = [], wide = [];
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
            const off = Math.abs(x * c + y * s - rho);
            if (off <= 2) near.push([(x - x0) * dx + (y - y0) * dy, i]);
            else if (off <= 5) wide.push(i);
          }
        }
      }
      near.sort((p, q) => p[0] - q[0]);
      // (any: whether this peak gave a line)
      // The ink along the line, as strokes: stretches whose pixels follow each other with gaps of at most a few
      // pixels (a crossing line leaves such a gap). A stroke at least solidMin long is solid; a shorter one is a
      // dash. Consecutive strokes of one kind, with gaps up to a dash's gap, make one line, so a dashed line is read
      // as one line and a line that changes from solid to dashed is read as two.
      const small = 5, gapMax = Math.max(8, 0.035 * Math.max(W, H)), solidMin = Math.max(30, 0.045 * Math.max(W, H));
      const strokes = [];
      for (let j = 0, from = 0; j < near.length; j++) {
        if (j === near.length - 1 || near[j + 1][0] - near[j][0] > small) {
          strokes.push({ from, to: j, t0: near[from][0], t1: near[j][0] });
          from = j + 1;
        }
      }
      // In a colour class every stroke is solid: dashes say nothing there, and a crossing must not split a line.
      for (const st of strokes) st.solid = !styled || st.t1 - st.t0 >= solidMin;
      // Where lines cross, the ink of the others fills a dashed line's gaps for a short way and looks solid: a
      // short solid stroke whose neighbours (within a dash's gap) are all dashes is a dash too.
      for (let changed = true; changed;) {
        changed = false;
        strokes.forEach((st, k) => {
          if (!st.solid || st.t1 - st.t0 >= 2.5 * solidMin) return;
          const nb = [strokes[k - 1], strokes[k + 1]].filter((o) => o && Math.min(Math.abs(o.t0 - st.t1), Math.abs(st.t0 - o.t1)) <= gapMax);
          if (nb.length && nb.every((o) => !o.solid)) { st.solid = false; changed = true; }
        });
      }
      // And a line crossed by another of its own class is cut there: a short piece whose every neighbour, across a
      // gap no wider than a crossing, is solid is part of that solid line (a dash has a dash beside it).
      const crossGap = 2 * 5 + 4;
      strokes.forEach((st, k) => {
        if (st.solid) return;
        const nb = [strokes[k - 1], strokes[k + 1]].filter((o) => o && Math.min(Math.abs(o.t0 - st.t1), Math.abs(st.t0 - o.t1)) <= gapMax);
        if (nb.length && nb.every((o) => o.solid && Math.min(Math.abs(o.t0 - st.t1), Math.abs(st.t0 - o.t1)) <= crossGap)) st.solid = true;
      });
      let any = false;
      const emit = (group) => {
        const first = group[0], lastS = group.at(-1);
        const len = lastS.t1 - first.t0;
        const dashed = !first.solid;
        if (len < minLen || (dashed && group.length < 2)) return;
        any = true;
        // The Hough line is only as exact as its bins (half a degree): fit the line to its own pixels instead, by
        // least squares, twice (the second time without pixels of other lines that cross it), for subpixel ends.
        // The Hough line is only as exact as its bins (half a degree): fit the line to its own pixels instead, by
        // least squares, twice (the second time without pixels of other lines that cross it), for subpixel ends.
        // A solid line whose pixels bend away from the fit by about a pixel is two lines meeting at a slight
        // angle (a zigzag, as in a Miura-ori): it is split where it bends most, and each part is fitted again.
        const tp = [];
        for (const st of group) for (let j = st.from; j <= st.to; j++) tp.push(near[j]);
        const inked = group.filter((st) => st.solid).reduce((n, st) => n + st.to - st.from + 1, 0), runs = group.filter((st) => st.solid).reduce((n, st) => n + st.t1 - st.t0, 0);
        const width = runs > 0 ? inked / runs : null;
        const orient = (f) => (f.ux * dx + f.uy * dy < 0 ? { px: f.px, py: f.py, ux: -f.ux, uy: -f.uy } : f);
        const piece = (ta, tb, depth) => {
          const part = tp.filter(([t]) => t >= ta - 0.5 && t <= tb + 0.5);
          let idx = part.map(([, i]) => i);
          let line = { px: x0, py: y0, ux: dx, uy: dy };
          const f0 = fitLine(pts, idx);
          if (f0) line = orient(f0);
          if (!dashed && depth < 6 && tb - ta > 1.5 * minLen) {
            const bin = 6, sums = new Map();
            for (const [t, i] of part) {
              const r = (pts[2 * i] - line.px) * line.uy - (pts[2 * i + 1] - line.py) * line.ux, k = Math.floor((t - ta) / bin);
              const e = sums.get(k) ?? sums.set(k, [0, 0]).get(k); e[0] += r; e[1]++;
            }
            let worst = null;
            for (const [k, [sum, n]] of sums) {
              const tm = ta + (k + 0.5) * bin;
              if (n >= 3 && tm - ta > 0.5 * minLen && tb - tm > 0.5 * minLen && (!worst || Math.abs(sum / n) > Math.abs(worst.r))) worst = { r: sum / n, t: tm };
            }
            if (worst && Math.abs(worst.r) > 0.9) { piece(ta, worst.t, depth + 1); piece(worst.t, tb, depth + 1); return; }
          }
          for (let pass = 0; pass < 2; pass++) {
            idx = idx.filter((i) => Math.abs((pts[2 * i] - line.px) * line.uy - (pts[2 * i + 1] - line.py) * line.ux) <= 1.2);
            const f = fitLine(pts, idx);
            if (!f) break;
            line = orient(f);
          }
          const along = (t) => { const x = x0 + dx * t, y = y0 + dy * t, u = (x - line.px) * line.ux + (y - line.py) * line.uy; return { x: line.px + u * line.ux, y: line.py + u * line.uy }; };
          out.push({ a: along(ta), b: along(tb), dashed, width });
        };
        piece(first.t0, lastS.t1, 0);
        for (const st of group) for (let j = st.from; j <= st.to; j++) { const i = near[j][1]; if (alive[i]) { alive[i] = 0; vote(i, -1); } }
        // A thick line's far edge would be found again as a second line: take all ink within a line's width too.
        for (const i of wide) {
          if (!alive[i]) continue;
          const x = pts[2 * i], y = pts[2 * i + 1], t = (x - x0) * dx + (y - y0) * dy;
          if (t >= first.t0 - 2 && t <= lastS.t1 + 2) { alive[i] = 0; vote(i, -1); }
        }
      };
      // The share of the stretch [ta, tb] of this line that has ink of its own colour within a pixel of it.
      const inkAlong = (ta, tb) => {
        if (!ink) return 0;
        let hit = 0, all = 0;
        for (let t = ta + 1; t < tb; t += 1) {
          all++;
          const x = Math.round(x0 + dx * t), y = Math.round(y0 + dy * t);
          let on = false;
          for (let ox = -1; ox <= 1 && !on; ox++) for (let oy = -1; oy <= 1 && !on; oy++) {
            const xx = x + ox, yy = y + oy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && ink[yy * W + xx] === code) on = true;
          }
          if (on) hit++;
        }
        return all ? hit / all : 1;
      };
      let group = [];
      for (const st of strokes) {
        const prev = group.at(-1);
        // Dashes join across a dash's gap. Solid strokes join across a crossing: a narrow gap, or one along which
        // this line's own colour runs on (a line of its colour, taken first, crossed it). Across blank paper or
        // along a line of another colour, the line has ended.
        const gap = prev ? st.t0 - prev.t1 : 0;
        const joins = prev && st.solid === prev.solid && (st.solid ? gap <= crossGap || (gap <= 2 * gapMax && inkAlong(prev.t1, st.t0) >= 0.6) : gap <= gapMax);
        if (prev && !joins) { emit(group); group = []; }
        group.push(st);
      }
      if (group.length) emit(group);
      if (!any) acc[bi] = 0;   // a peak with no long run: forget it
    }
    return out;
  }

  /** The total least-squares line through the pixels idx of pts: a point on it and its unit direction. */
  function fitLine(pts, idx) {
    if (idx.length < 3) return null;
    let mx = 0, my = 0;
    for (const i of idx) { mx += pts[2 * i]; my += pts[2 * i + 1]; }
    mx /= idx.length; my /= idx.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const i of idx) { const x = pts[2 * i] - mx, y = pts[2 * i + 1] - my; sxx += x * x; sxy += x * y; syy += y * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: mx, py: my, ux: Math.cos(th), uy: Math.sin(th) };
  }

  /** Joins and snaps traced lines: angles to 22.5°, ends to each other, to lines they nearly touch, and to a grid. */
  /** mask: the image's ink ({ ink, W, H }), when known: an end runs on to a crossing along ink. */
  function snap(found, W, H, mask = null) {
    if (!found.length) return [];
    const xs = found.flatMap((l) => [l.a.x, l.b.x]), ys = found.flatMap((l) => [l.a.y, l.b.y]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    const tol = (Number($("cpJoin").value) || 1.5) / 100 * size;
    const N = Math.max(0, Math.round(Number($("cpGrid").value) || 0));   // empty or "auto": found below
    let ls = found.map((l) => ({ a: { ...l.a }, b: { ...l.b }, kind: l.kind, dashed: !!l.dashed, colour: !!l.colour }));
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
    // Tracing stops a line short where another crosses or meets it (the other's ink is taken first): an end
    // within reach of another line is carried along its own line to the crossing.
    {
      const meet = (l, m) => {
        const d1x = l.b.x - l.a.x, d1y = l.b.y - l.a.y, d2x = m.b.x - m.a.x, d2y = m.b.y - m.a.y;
        const den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 0.05 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) return null;   // nearly parallel
        const t = ((m.a.x - l.a.x) * d2y - (m.a.y - l.a.y) * d2x) / den, u = ((m.a.x - l.a.x) * d1y - (m.a.y - l.a.y) * d1x) / den;
        const lenM = Math.hypot(d2x, d2y);
        if (u < -tol / lenM || u > 1 + tol / lenM) return null;   // the crossing must lie on the other line
        return { t, p: { x: l.a.x + t * d1x, y: l.a.y + t * d1y } };
      };
      // A line stops short of a crossing by about the other line's width: the reach is a few widths, and never more
      // than the joining distance allows (in a dense pattern the next crossing may be only a little further on).
      const widths = found.map((l) => l.width).filter((w) => w > 0).sort((a, b) => a - b);
      const width = widths.length ? widths[widths.length >> 1] : 3;
      const reach = Math.min(2.5 * tol, 3 * width + 4);
      // Where many lines meet (the tip of a fan), the first lines traced take the ink near the point, and the others
      // stop well short of it: an end runs on further, up to 4 joining distances, where there is ink all the way.
      const inked = (p, q) => {
        if (!mask) return false;
        const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y));
        let hit = 0;
        for (let j = 1; j <= n; j++) {
          const x = Math.round(p.x + (q.x - p.x) * j / n), y = Math.round(p.y + (q.y - p.y) * j / n);
          let on = false;
          for (let ox = -1; ox <= 1 && !on; ox++) for (let oy = -1; oy <= 1 && !on; oy++) {
            const xx = x + ox, yy = y + oy;
            if (xx >= 0 && yy >= 0 && xx < mask.W && yy < mask.H && mask.ink[yy * mask.W + xx]) on = true;
          }
          if (on) hit++;
        }
        return n > 0 && hit / n >= 0.9;
      };
      for (const l of ls) {
        const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
        for (const [end, sign] of [[l.a, 0], [l.b, 1]]) {
          let best = null;
          for (const m of ls) {
            if (m === l) continue;
            const r = meet(l, m);
            if (!r) continue;
            const along = (sign ? r.t - 1 : -r.t) * len;   // how far beyond this end (negative: inside)
            if (along > -tol && (along < reach || (along < 4 * tol && inked(end, r.p))) && (!best || Math.abs(along) < Math.abs(best.along))) best = { along, p: r.p };
          }
          if (best) { end.x = best.p.x; end.y = best.p.y; }
        }
      }
    }
    // Each line as traced (and turned), before its ends move: where its ends meet others is worked out from these.
    const geo = ls.map((l) => { const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, n = Math.hypot(dx, dy) || 1; return { x: l.a.x, y: l.a.y, ux: dx / n, uy: dy / n }; });
    for (const l of ls) for (const p of [l.a, l.b]) toBox(p);
    // Ends that are close together become one point: where their lines cross, in the least-squares sense, so the
    // lines keep their angles; their centre when the lines are (nearly) parallel.
    const ends = ls.flatMap((l) => [l.a, l.b]);
    const parent = ends.map((_, i) => i);
    const findRoot = (i) => (parent[i] === i ? i : (parent[i] = findRoot(parent[i])));
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      if (Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y) < tol) parent[findRoot(i)] = findRoot(j);
    }
    const groups = new Map();
    ends.forEach((p, i) => { const r = findRoot(i); (groups.get(r) ?? groups.set(r, []).get(r)).push(p); });
    const members = new Map();
    ends.forEach((_, i) => { const r = findRoot(i); (members.get(r) ?? members.set(r, []).get(r)).push(i >> 1); });
    for (const [r, g] of groups) {
      const cx = g.reduce((s, p) => s + p.x, 0) / g.length, cy = g.reduce((s, p) => s + p.y, 0) / g.length;
      let to = { x: cx, y: cy };
      const own = [...new Set(members.get(r))].map((k) => geo[k]);
      if (own.length >= 2) {
        let a = 0, b = 0, c = 0, e = 0, f = 0;   // Σ (I − u uᵀ) p = Σ (I − u uᵀ) q over the lines through the point
        for (const q of own) {
          const m00 = 1 - q.ux * q.ux, m01 = -q.ux * q.uy, m11 = 1 - q.uy * q.uy;
          a += m00; b += m01; c += m11; e += m00 * q.x + m01 * q.y; f += m01 * q.x + m11 * q.y;
        }
        const det = a * c - b * b;
        if (det > 0.02 * own.length * own.length) {
          const p = { x: (c * e - b * f) / det, y: (a * f - b * e) / det };
          if (Math.hypot(p.x - cx, p.y - cy) < 2 * tol) to = p;
        }
      }
      for (const p of g) { p.x = to.x; p.y = to.y; }
    }
    // A grid: the one given, or (auto) the coarsest N up to 64 that every end sits on.
    let grid = N;
    if ($("cpGrid").value.trim() === "" || $("cpGrid").value.trim().toLowerCase() === "auto") {
      grid = 0;
      // Every end must sit within an eighth of a cell of a grid point (and within half the joining distance): a
      // fine enough grid would fit any points, but not that closely. Cells must be wider than a few strokes.
      const widths = found.map((l) => l.width).filter((w) => w > 0).sort((a, b) => a - b);
      const width = widths.length ? widths[widths.length >> 1] : 3;
      for (let n = 1; n <= 128 && size / n > 4 * width && !grid; n++) {
        const fit = Math.min(tol / 2, size / n / 8);
        if (ends.every((p) => { const gx = Math.round((p.x - box.x0) / size * n), gy = Math.round((p.y - box.y0) / size * n);
          return Math.hypot(box.x0 + gx * size / n - p.x, box.y0 + gy * size / n - p.y) < fit; })) grid = n;
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
    // Collinear overlapping pieces of the same kind become one line, and a line lying along a longer one of the
    // same kind (a thick line traced twice) is dropped.
    return dropShadows(mergeCollinear(ls, tol / 3), 1.5 * tol);
  }

  function dropShadows(ls, tol) {
    const len = (l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
    const dist = (p, m) => {
      const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - m.a.x) * dx + (p.y - m.a.y) * dy) / l2));
      return Math.hypot(m.a.x + t * dx - p.x, m.a.y + t * dy - p.y);
    };
    return ls.filter((l) => !ls.some((m) => m !== l && m.kind === l.kind && len(m) >= len(l) && (len(m) > len(l) || m !== ls.find((x) => x.kind === l.kind && len(x) === len(l)))
      && dist(l.a, m) < tol && dist(l.b, m) < tol && dist({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 }, m) < tol));
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
      out.push({ a: { x: l.a.x + ux * lo, y: l.a.y + uy * lo }, b: { x: l.a.x + ux * hi, y: l.a.y + uy * hi }, kind: l.kind, dashed: l.dashed, colour: l.colour });
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
      const r = await fetch("api/cp/fold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, toleranceDegrees: Number($("cpTol").value) || 1 }) });
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
      // Swapped mountains and valleys fold the same shape from the paper's other side: the base is seen mirrored,
      // with the paper's front and back exchanged.
      const g = svgEl("g", swapped ? { transform: `translate(${2 * x0 + w} 0) scale(-1 1)` } : {}, svg);
      for (const f of r.faces) {
        if (!f.folded) continue;
        svgEl("polygon", { points: f.folded.map((p) => `${p.x},${p.y}`).join(" "), class: "cp-face" + (f.flipped !== swapped ? " back" : ""), "stroke-width": sw }, g);
      }
    }
    $("cpVerdict").textContent = (r.foldable ? "Folds flat." : "Does not fold flat as drawn.") + (swapped ? " Mountains and valleys swapped: seen from the other side." : "");
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
    $("cpTol").addEventListener("change", () => { if (lines.length && !fromImage) fold(); });
    $("cpShowImage").addEventListener("change", draw);
    $("cpRetrace").addEventListener("click", () => { if (lastFile) readFile(lastFile); });
    $("cpStyle").addEventListener("change", () => { if (lastFile) readFile(lastFile); });
    $("cpSwap").addEventListener("change", () => {
      swapped = $("cpSwap").checked;
      lines = swapKinds(lines);
      draw();
      if (lastResult) fold(); else clearFolded();
    });
    draw();
  }

  return { init, readFile, get lines() { return lines; }, fold, debugTrace: (img) => trace(img), debugSnap: (f, W, H) => snap(f, W, H), get debugFound() { return lastFound; } };
})();

cp.init();
