#!/usr/bin/env python3
"""Copy the spec documents into the app as packaged Markdown.

The specs are Claude Docs artifacts. Exporting one to Markdown (the Docs `export` tool, format "markdown") returns
the file inline as base64, and the session transcript records that result. This script scans one or more transcript
JSONL files (or plain .md files), keeps the newest export of each spec, and writes

    TreeMaker.Web/wwwroot/specs/<key>.md
    TreeMaker.Web/wwwroot/specs/manifest.json

Usage:
    python3 tools/extract_spec_exports.py [--out DIR] SOURCE [SOURCE ...]

A SOURCE is a transcript .jsonl (searched for export results) or a .md file named like the doc title
("Pure MILP TreeMaker.md"). After editing a spec: export it to Markdown, then re-run this script (see CLAUDE.md).
"""
import argparse
import base64
import datetime as dt
import json
import os
import re
import sys

# Doc title (the start of the exported file name) -> key used by the app (DOCS in wwwroot/nodes.js).
SPECS = {
    "Pure MILP TreeMaker": ("pure", "https://claude.ai/artifact/1L1y2Ey5CzUT8AzfJ2sev4"),
    "Symmetry-Breaking MILP TreeMaker": ("sym", "https://claude.ai/artifact/4bhD37EK1NQy66fV4zhTaN"),
    "Lattice-Hull MILP TreeMaker": ("hull", "https://claude.ai/artifact/NwmqiYzpRCSneZiobahka6"),
    "Optimized MILP TreeMaker": ("optimized", "https://claude.ai/artifact/LxhWqnKYWWuTrdmJ3hrKdq"),
    "Scalable MILP TreeMaker": ("scalable", "https://claude.ai/artifact/Qz1WL7RZDpnMwKYdVT2G29"),
    "Polygon Closing TreeMaker": ("closing", "https://claude.ai/artifact/FtbYLxEKTVszvyrLtcniK4"),
    "Crease Pattern TreeMaker": ("crease", "https://claude.ai/artifact/1B22HTcwzUwAjaMqyfdTXp"),
}


def spec_for(name):
    stem = name[:-3] if name.endswith(".md") else name
    for title, (key, url) in SPECS.items():
        if stem == title or stem.startswith(title + ":"):
            return title, key, url
    return None


def walk(value):
    """Yield every dict nested in a JSON value (tool results are sometimes JSON inside strings)."""
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v)
    elif isinstance(value, str) and '"bytes_b64"' in value:
        start = value.find("{")
        if start >= 0:
            try:
                yield from walk(json.loads(value[start:]))
            except ValueError:
                # Results may be wrapped in text; find the JSON object holding the export.
                for m in re.finditer(r'\{"verdict"', value):
                    try:
                        obj, _ = json.JSONDecoder().raw_decode(value[m.start():])
                        yield from walk(obj)
                    except ValueError:
                        pass


def exports_in_transcript(path):
    with open(path, encoding="utf-8") as f:
        for order, line in enumerate(f):
            if "bytes_b64" not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            stamp = entry.get("timestamp", "")
            for obj in walk(entry):
                data = obj.get("data") if isinstance(obj.get("data"), dict) else None
                if not data or "bytes_b64" not in data:
                    continue
                if data.get("format") != "markdown":
                    continue
                yield {
                    "name": data.get("name", ""),
                    "rev": obj.get("rev"),
                    "text": base64.b64decode(data["bytes_b64"]).decode("utf-8"),
                    "when": stamp,
                    "order": order,
                }


# Tab node of each doc (docs/CONTEXT.md) -> key. A doc read of the tab returns its XML, which lists the figures
# (`<embed ref='node/<id>' caption='…'/>`) in order; a read of each figure node returns its JSX source.
TABS = {
    "a3a74054-0357": "pure", "fa0cae2e-1113": "sym", "7ffee6c7-7758": "hull", "c4592889-1f69": "optimized",
    "d64e2319-db8f": "scalable", "c45537c5-97f5": "closing", "6a9c70bb-7945": "crease",
}


def transcript_files(path):
    """A transcript and the transcripts of the subagents it started (<stem>/subagents/*.jsonl)."""
    yield path
    sub = os.path.join(path[:-len(".jsonl")], "subagents")
    if path.endswith(".jsonl") and os.path.isdir(sub):
        for name in sorted(os.listdir(sub)):
            if name.endswith(".jsonl"):
                yield os.path.join(sub, name)


def result_text(block):
    """The text of a tool result, following "Output has been saved to <file>" to the saved file."""
    content = block.get("content")
    text = content if isinstance(content, str) else "".join(
        c.get("text", "") for c in content or [] if isinstance(c, dict))
    m = re.search(r"saved to (/\S+?\.txt)", text)
    if m and os.path.exists(m.group(1)):
        with open(m.group(1), encoding="utf-8") as f:
            saved = f.read()
        try:
            parts = json.loads(saved)
        except ValueError:
            parts = None
        # Saved as a list of content blocks, or as the plain result text.
        text = ("".join(p.get("text", "") for p in parts if isinstance(p, dict))
                if isinstance(parts, list) else saved)
    return text


def docs_reads(path):
    """(order, ref id, parsed result) for every Claude Docs read of a node in a transcript and its subagents."""
    order = 0
    for f in transcript_files(path):
        uses = {}
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                if "Claude_Docs" not in line and "tool_result" not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                content = entry.get("message", {}).get("content")
                if not isinstance(content, list):
                    continue
                for b in content:
                    if b.get("type") == "tool_use" and b.get("name", "").endswith("Claude_Docs__read"):
                        uses[b["id"]] = b.get("input", {})
                    elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                        ref = (uses[b["tool_use_id"]].get("ref") or {})
                        if ref.get("object") != "node":
                            continue
                        text = result_text(b)
                        i = text.find('{"verdict"')
                        if i < 0:
                            continue
                        try:
                            obj, _ = json.JSONDecoder().raw_decode(text[i:])
                        except ValueError:
                            continue
                        order += 1
                        yield order, ref.get("id"), obj


def collect_figures(sources):
    """{key: [{id, caption, code}]} for every doc whose figure list and every figure's source were read."""
    lists, codes = {}, {}
    for src in sources:
        if not src.endswith(".jsonl"):
            continue
        for _, ref, obj in docs_reads(src):
            xml = (obj.get("data") or {}).get("xml")
            if xml and ref in TABS:
                lists[TABS[ref]] = [
                    (m.group(2), html_unescape(m.group(1)))
                    for m in re.finditer(r"<embed\b[^>]*?caption='([^']*)'[^>]*?ref='node/([^']+)'", xml)]
            code = (obj.get("value") or {}).get("code")
            if code:
                codes[ref] = code
    out = {}
    for key, embeds in lists.items():
        missing = [i for i, _ in embeds if i not in codes]
        if missing:
            print(f"{key}: figure source not read for {', '.join(missing)}", file=sys.stderr)
            continue
        out[key] = [{"id": i, "caption": c, "code": codes[i]} for i, c in embeds]
    return out


def html_unescape(s):
    import html
    return html.unescape(s)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_out = os.path.join(here, "..", "TreeMaker.Web", "wwwroot", "specs")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=default_out)
    ap.add_argument("sources", nargs="+")
    args = ap.parse_args()

    best = {}
    for src in args.sources:
        if src.endswith(".md"):
            found = spec_for(os.path.basename(src))
            if not found:
                print(f"skip {src}: not a known spec title", file=sys.stderr)
                continue
            with open(src, encoding="utf-8") as f:
                candidates = [{"name": os.path.basename(src), "rev": None, "text": f.read(),
                               "when": dt.datetime.fromtimestamp(os.path.getmtime(src), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                               "order": 1 << 30}]
        else:
            candidates = list(exports_in_transcript(src))
        for c in candidates:
            found = spec_for(c["name"])
            if not found:
                continue
            title, key, url = found
            prev = best.get(key)
            # Newest wins: a higher rev, or the later entry when revs are equal or missing.
            newer = prev is None or (c["rev"] or 0, c["order"]) >= (prev["rev"] or 0, prev["order"])
            if newer:
                best[key] = dict(c, title=title, key=key, url=url)

    os.makedirs(args.out, exist_ok=True)
    manifest_path = os.path.join(args.out, "manifest.json")
    manifest = {"specs": {}}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
    for key, spec in sorted(best.items()):
        with open(os.path.join(args.out, key + ".md"), "w", encoding="utf-8") as f:
            f.write(spec["text"])
        manifest["specs"][key] = {
            "title": spec["title"], "url": spec["url"], "rev": spec["rev"],
            "exportedAt": spec["when"] or dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat() + "Z",
            "file": key + ".md",
        }
        print(f"{key:10s} rev {spec['rev']}  {len(spec['text']):6d} chars  {spec['title']}")
    # Figures: compile each doc's JSX figures to static SVG (tools/render_spec_figures.js), in placeholder order.
    figures = collect_figures(args.sources)
    if figures:
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(figures, tmp)
        renderer = os.path.join(here, "render_spec_figures.js")
        subprocess.run(["node", renderer, tmp.name, args.out], check=False)
        os.unlink(tmp.name)
    for key, entry in manifest["specs"].items():
        md_path = os.path.join(args.out, entry["file"])
        fig_path = os.path.join(args.out, key + ".figures.json")
        with open(md_path, encoding="utf-8") as f:
            placeholders = f.read().count("&#91;embedded content:")
        if os.path.exists(fig_path):
            with open(fig_path, encoding="utf-8") as f:
                count = len(json.load(f)["figures"])
            if count != placeholders:
                print(f"{key}: {placeholders} figure placeholders but {count} figures; re-read the doc's figures",
                      file=sys.stderr)
            entry["figures"] = key + ".figures.json"
        elif placeholders:
            print(f"{key}: {placeholders} figures not packaged (read the doc tab and each figure node first)",
                  file=sys.stderr)
            entry.pop("figures", None)
    manifest["packagedAt"] =dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).replace(microsecond=0).isoformat() + "Z"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    missing = [k for _, (k, _) in SPECS.items() if k not in manifest["specs"]]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
