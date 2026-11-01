#!/usr/bin/env node
// Renders the specs' figures to standalone SVG files, the one copy that both GitHub and the app's docs page show.
//
// The figures in the spec documents are small JSX components (`export default () => <svg …/>`), some wrapped in a
// `claude.Visualize` data component. Markdown export drops them, so tools/extract_spec_exports.py collects their
// source and calls this script with a JSON file:
//     { "<docKey>": [ { "id": "…", "caption": "…", "code": "export default () => …" }, … ], … }
// For each doc it writes <out>/figures/<docKey>/01.svg, 02.svg, … in document order (replacing what was there), so
// the n-th "[embedded content: …]" placeholder of the doc becomes a link to the n-th file.
//
// The figures were drawn for the live docs' theme (`var(--cds-…)` colours). An SVG shown as an image can't see a
// page's CSS, so each colour is written in from PALETTE below. Each file also gets its size (from its viewBox), a
// font and a paper-coloured background, so it reads the same on GitHub (light or dark) as in the app.
//
// JSX is compiled with the TypeScript compiler (any copy: `npm i -g typescript`, or set TYPESCRIPT=/path/to/typescript).
// Components run once with stub hooks, so a figure with controls is drawn in its initial state.
"use strict";
const fs = require("fs");
const path = require("path");

function loadTypeScript() {
  const tries = [process.env.TYPESCRIPT, "typescript",
    "/opt/node-tools/node_modules/typescript", "/opt/npm-tools/node_modules/typescript"].filter(Boolean);
  try { tries.push(path.join(require("child_process").execSync("npm root -g").toString().trim(), "typescript")); } catch { /* no npm */ }
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error("The TypeScript compiler is needed to compile the figures: npm i -g typescript (or set TYPESCRIPT).");
}

// ───── A tiny JSX runtime that renders to a string ─────

const Fragment = Symbol("Fragment");
const h = (type, props, ...children) => ({ type, props: props ?? {}, children });

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "col", "area", "wbr"]);
const KEEP_CAMEL = new Set(["viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "patternUnits",
  "patternContentUnits", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "pathLength", "textLength",
  "lengthAdjust", "startOffset", "spreadMethod", "stdDeviation", "baseFrequency", "numOctaves", "kernelMatrix",
  "clipPathUnits", "maskUnits", "maskContentUnits", "filterUnits", "primitiveUnits", "attributeName", "repeatCount"]);
const RENAME = { className: "class", htmlFor: "for", xlinkHref: "href" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

function attrName(k) {
  if (RENAME[k]) return RENAME[k];
  if (KEEP_CAMEL.has(k) || k.startsWith("data-") || k.startsWith("aria-")) return k;
  return kebab(k);
}

function styleText(style) {
  return Object.entries(style)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => `${k.startsWith("--") ? k : kebab(k)}:${typeof v === "number" && v !== 0 && !/opacity|weight|zIndex|flex|lineHeight/i.test(k) ? v + "px" : v}`)
    .join(";");
}

function render(node) {
  if (node == null || node === false || node === true) return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node === "string" || typeof node === "number") return esc(node);
  if (typeof node !== "object" || !("type" in node)) return "";
  const { type, props } = node;
  const children = node.children.length ? node.children : props.children != null ? [props.children] : [];
  if (type === Fragment) return render(children);
  if (typeof type === "function") return render(type({ ...props, children: children.length === 1 ? children[0] : children }));
  let attrs = "";
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "key" || k === "ref" || k === "dangerouslySetInnerHTML" || /^on[A-Z]/.test(k)) continue;
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") { attrs += ` style="${escAttr(styleText(v))}"`; continue; }
    if (typeof v === "function" || typeof v === "object") continue;
    attrs += v === true ? ` ${attrName(k)}` : ` ${attrName(k)}="${escAttr(v)}"`;
  }
  if (props.dangerouslySetInnerHTML) return `<${type}${attrs}>${props.dangerouslySetInnerHTML.__html}</${type}>`;
  if (VOID.has(type)) return `<${type}${attrs}>`;
  return `<${type}${attrs}>${render(children)}</${type}>`;
}

// ───── Stubs for React hooks and the Visualize data component ─────

function makeEnv(flags) {
  const React = {
    createElement: h, Fragment,
    useState: (init) => { flags.interactive = true; return [typeof init === "function" ? init() : init, () => {}]; },
    useReducer: (_, init, fn) => { flags.interactive = true; return [fn ? fn(init) : init, () => {}]; },
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (v) => ({ current: v ?? null }),
    useEffect: () => {}, useLayoutEffect: () => {}, useId: () => "fig", useContext: () => undefined,
  };
  // <claude.Visualize sources={{name: {kind: 'data', data: [...]}}}>{({name, datum}) => …}</claude.Visualize>
  const Visualize = ({ sources = {}, children }) => {
    const args = { datum: () => ({}) };
    for (const [k, s] of Object.entries(sources)) args[k] = s && "data" in s ? s.data : s;
    const fn = Array.isArray(children) ? children.find((c) => typeof c === "function") : children;
    return typeof fn === "function" ? fn(args) : children;
  };
  const claude = new Proxy({ Visualize }, { get: (t, k) => t[k] ?? (({ children }) => children) });
  return { React, claude };
}

function compile(ts, code) {
  return ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "React.createElement", jsxFragmentFactory: "React.Fragment",
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function renderFigure(ts, code) {
  const flags = { interactive: false };
  const { React, claude } = makeEnv(flags);
  const js = compile(ts, code);
  const module = { exports: {} };
  const require = (name) => {
    if (name === "react") return { ...React, default: React };
    throw new Error(`figure imports ${name}`);
  };
  new Function("React", "claude", "module", "exports", "require", ...Object.keys(React), js)(
    React, claude, module, module.exports, require, ...Object.values(React));
  const Comp = module.exports.default ?? module.exports;
  const html = render(h(Comp, {}));
  return { html, interactive: flags.interactive };
}

/** The theme colours the figures use, as the app draws them (see --ink, --beni and friends in styles.css). */
const PALETTE = {
  "--cds-text-primary": "#1f2328",
  "--cds-text-secondary": "#5d636b",
  "--cds-chart-axis": "#8a9097",
  "--cds-chart-grid": "#e3e6e1",
  "--cds-chart-muted": "#b5bab3",
  "--cds-chart-reference": "#6b7178",
  "--cds-chart-reference-tint": "rgba(107, 113, 120, 0.10)",
  "--cds-chart-categorical-1": "#c2304a",
  "--cds-chart-categorical-2": "#2f6fa8",
  "--cds-chart-status-good": "#23704a",
  "--cds-chart-status-warning": "#b7791f",
  "--cds-chart-status-critical": "#b3261e",
};
const PAPER = "#fdfdfb";
const FONT = "Archivo, -apple-system, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";

/** A rendered figure as a standalone SVG file: colours written in, size, font, background. */
function standalone(html) {
  const unknown = new Set();
  let svg = html.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
    if (PALETTE[name]) return PALETTE[name];
    unknown.add(name);
    return fallback ?? "#1f2328";
  });
  if (unknown.size) throw new Error(`colours not in PALETTE: ${[...unknown].join(", ")}`);
  const open = svg.match(/^<svg\b[^>]*>/);
  if (!open) throw new Error("not an <svg> figure");
  const vb = open[0].match(/viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
  let attrs = ' xmlns="http://www.w3.org/2000/svg"';
  if (vb && !/\swidth=/.test(open[0])) attrs += ` width="${vb[3]}" height="${vb[4]}"`;
  if (!/font-family=/.test(open[0])) attrs += ` font-family="${FONT}"`;
  const background = vb ? `<rect x="${vb[1]}" y="${vb[2]}" width="${vb[3]}" height="${vb[4]}" fill="${PAPER}"/>` : "";
  svg = open[0].replace(/^<svg/, "<svg" + attrs) + background + svg.slice(open[0].length);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg + "\n";
}

function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error("usage: render_spec_figures.js figures-src.json OUTDIR"); process.exit(2); }
  const ts = loadTypeScript();
  const all = JSON.parse(fs.readFileSync(src, "utf8"));
  let failed = 0;
  for (const [doc, figs] of Object.entries(all)) {
    const figures = figs.map((f, i) => {
      try {
        const r = renderFigure(ts, f.code);
        if (!/<svg|<table|<div/.test(r.html)) throw new Error("rendered nothing");
        return { id: f.id, caption: f.caption, ...r };
      } catch (e) {
        failed++;
        console.error(`${doc} figure ${i + 1} (${f.id}): ${e.message}`);
        return { id: f.id, caption: f.caption, html: null, interactive: false };
      }
    });
    const dir = path.join(out, "figures", doc);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    let written = 0;
    figures.forEach((f, i) => {
      if (!f.html) return;
      try {
        fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(2, "0")}.svg`), standalone(f.html));
        written++;
      } catch (e) {
        failed++;
        console.error(`${doc} figure ${i + 1} (${f.id}): ${e.message}`);
      }
    });
    console.log(`${doc.padEnd(10)} ${written}/${figures.length} figures`);
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { renderFigure, standalone, loadTypeScript, PALETTE };
