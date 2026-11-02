"""Folds a crease pattern flat: the Python twin of src/TreeMaker.Core/CreasePatternFold.cs, used by tools/mock_api.py
so the crease-pattern page (wwwroot/cp.html) can be checked without .NET. Keep the two in step.

fold(segments) takes [{"a": {"x", "y"}, "b": {"x", "y"}, "kind": "M" | "V" | "U" | "F" | "B"}] in any units and
returns the planar graph, every face on the paper and folded flat, the vertex checks and a verdict:
  1. Scale to the sheet (the border's bounding box, or every line's when there is no border) as the unit square.
  2. Split every line where it meets another, merge points closer than eps, drop repeats and dangling lines.
  3. Trace the faces of the planar graph.
  4. Fold: from the face under the sheet's centre, cross every crease (M, V, U) by reflecting across its line, and
     every flat line (F) without folding. A face reached two ways with different maps means no flat fold exists.
  5. At every inner vertex: Kawasaki (alternate angles sum to pi) and, when every crease there is assigned, Maekawa.
"""
import math

ORDER = {"M": 0, "V": 0, "U": 1, "F": 2, "B": 3}   # which kind wins when two lines overlap


def fold(segments, eps_rel=1e-6, tolerance_degrees=None):
    """tolerance_degrees: how far from exact the angles may be (traced images); exact (1e-4 rad) when None."""
    atol = max(1e-4, math.radians(tolerance_degrees)) if tolerance_degrees else 1e-4
    mtol = 4 * atol   # coordinates in files carry a few digits, and composing reflections grows their error
    segs = []
    for s in segments:
        a, b = (float(s["a"]["x"]), float(s["a"]["y"])), (float(s["b"]["x"]), float(s["b"]["y"]))
        k = (s.get("kind") or "U").upper()[:1]
        if k not in ORDER: k = "U"
        segs.append((a, b, k))
    if not segs:
        return dict(foldable=False, faces=[], edges=[], vertices=[], messages=["There are no lines."])
    border = [s for s in segs if s[2] == "B"]
    pts = [p for s in (border or segs) for p in s[:2]]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    size = max(x1 - x0, y1 - y0)
    if size <= 0:
        return dict(foldable=False, faces=[], edges=[], vertices=[], messages=["The lines have no extent."])
    norm = lambda p: ((p[0] - x0) / size, (p[1] - y0) / size)
    segs = [(norm(a), norm(b), k) for a, b, k in segs]
    messages = []
    if not border:
        w, h = (x1 - x0) / size, (y1 - y0) / size
        corners = [(0, 0), (w, 0), (w, h), (0, h)]
        segs += [(corners[i], corners[(i + 1) % 4], "B") for i in range(4)]
        messages.append("No border was marked: the bounding box of the lines is taken as the sheet.")
    eps = eps_rel * 1e3   # in the unit square, points closer than 1e-3 are one point
    segs = [s for s in segs if math.dist(s[0], s[1]) > eps]

    # 2. Split at every crossing and touching point.
    cuts = [[0.0, 1.0] for _ in segs]
    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            for t, u in _meet(segs[i], segs[j], eps):
                cuts[i].append(t); cuts[j].append(u)
    verts, index = [], {}

    def vid(p):
        key = (round(p[0] / eps), round(p[1] / eps))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                k = index.get((key[0] + dx, key[1] + dy))
                if k is not None and math.dist(verts[k], p) <= eps:
                    return k
        index[key] = len(verts); verts.append(p)
        return len(verts) - 1

    edges = {}
    for (a, b, k), ts in zip(segs, cuts):
        ts = sorted(set(round(t, 12) for t in ts if -1e-12 <= t <= 1 + 1e-12))
        ids = []
        for t in ts:
            v = vid((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            if not ids or ids[-1] != v: ids.append(v)
        for u, v in zip(ids, ids[1:]):
            key = (min(u, v), max(u, v))
            if key not in edges or ORDER[k] < ORDER[edges[key]]: edges[key] = k
    # Dangling lines: keep removing edges at vertices of degree 1.
    dropped = 0
    while True:
        deg = {}
        for u, v in edges: deg[u] = deg.get(u, 0) + 1; deg[v] = deg.get(v, 0) + 1
        loose = [e for e in edges if deg[e[0]] == 1 or deg[e[1]] == 1]
        if not loose: break
        for e in loose: del edges[e]
        dropped += len(loose)
    if dropped: messages.append(f"{dropped} loose line piece{'s' if dropped != 1 else ''} with an open end were left out.")
    if not edges:
        return dict(foldable=False, faces=[], edges=[], vertices=[], messages=messages + ["No closed faces."])

    # 3. Faces: at each vertex sort the edges by angle; from u->v turn to the next edge clockwise at v.
    out = {}
    for u, v in edges:
        out.setdefault(u, []).append(v); out.setdefault(v, []).append(u)
    ang = lambda u, v: math.atan2(verts[v][1] - verts[u][1], verts[v][0] - verts[u][0])
    for u in out: out[u].sort(key=lambda v: ang(u, v))
    seen, faces = set(), []
    for u in out:
        for v in out[u]:
            if (u, v) in seen: continue
            cyc, a, b = [], u, v
            while (a, b) not in seen:
                seen.add((a, b)); cyc.append(a)
                nb = out[b]; i = nb.index(a)
                a, b = b, nb[(i - 1) % len(nb)]
            area = _area([verts[k] for k in cyc])
            if area > eps * eps: faces.append(cyc)
    face_of = {}
    for f, cyc in enumerate(faces):
        for i in range(len(cyc)): face_of[(cyc[i], cyc[(i + 1) % len(cyc)])] = f

    # 4. Fold from the face under the centre (else the largest).
    cx = sum(p[0] for p in verts) / len(verts); cy = sum(p[1] for p in verts) / len(verts)
    root = next((f for f, c in enumerate(faces) if _inside((cx, cy), [verts[k] for k in c])), None)
    if root is None: root = max(range(len(faces)), key=lambda f: _area([verts[k] for k in faces[f]]))
    T = {root: (1, 0, 0, 0, 1, 0)}
    queue, clash = [root], []
    while queue:
        f = queue.pop(0); cyc = faces[f]
        for i in range(len(cyc)):
            u, v = cyc[i], cyc[(i + 1) % len(cyc)]
            g = face_of.get((v, u))
            k = edges[(min(u, v), max(u, v))]
            if g is None or k == "B": continue
            m = T[f] if k == "F" else _compose(T[f], _reflect(verts[u], verts[v]))
            if g not in T: T[g] = m; queue.append(g)
            elif max(abs(p - q) for p, q in zip(T[g], m)) > mtol:
                clash.append((u, v))
    if len(T) < len(faces): messages.append(f"{len(faces) - len(T)} face(s) are not connected to the rest by creases.")

    # 5. Vertex checks.
    on_border = set()
    for (u, v), k in edges.items():
        if k == "B": on_border.update((u, v))
    vchecks = []
    for u, nb in out.items():
        if u in on_border: continue
        folds = [v for v in nb if edges[(min(u, v), max(u, v))] != "F"]
        if not folds: continue
        a = [ang(u, v) for v in folds]   # already sorted by angle
        sectors = [((a[(i + 1) % len(a)] - a[i]) % (2 * math.pi)) or 2 * math.pi for i in range(len(a))]
        kaw = len(a) % 2 == 0 and abs(sum(s * (1 if i % 2 == 0 else -1) for i, s in enumerate(sectors))) < atol
        kinds = [edges[(min(u, v), max(u, v))] for v in folds]
        mae = None
        if all(k in "MV" for k in kinds):
            mae = abs(kinds.count("M") - kinds.count("V")) == 2
        vchecks.append(dict(x=verts[u][0], y=verts[u][1], degree=len(folds), kawasaki=kaw, maekawa=mae))
    bad_k = [c for c in vchecks if not c["kawasaki"]]
    bad_m = [c for c in vchecks if c["maekawa"] is False]
    if clash: messages.append(f"The faces do not fold to one flat shape: {len(clash)} crease(s) map a face two ways.")
    if bad_k: messages.append(f"{len(bad_k)} vertex/vertices fail Kawasaki's theorem (alternate angles must sum to 180°).")
    if bad_m: messages.append(f"{len(bad_m)} vertex/vertices fail Maekawa's theorem (mountains and valleys must differ by 2).")
    foldable = not clash and not bad_k and len(T) == len(faces)
    if foldable: messages.append(f"Folds flat: {len(faces)} faces." + (" Mountain and valley assignments pass Maekawa." if vchecks and not bad_m and all(c["maekawa"] is not None for c in vchecks) else ""))

    face_out = []
    for f, cyc in enumerate(faces):
        paper = [dict(x=verts[k][0], y=verts[k][1]) for k in cyc]
        m = T.get(f)
        folded = [dict(x=m[0] * p["x"] + m[1] * p["y"] + m[2], y=m[3] * p["x"] + m[4] * p["y"] + m[5]) for p in paper] if m else None
        face_out.append(dict(paper=paper, folded=folded, flipped=bool(m and m[0] * m[4] - m[1] * m[3] < 0)))
    return dict(foldable=foldable, faces=face_out,
                edges=[dict(a=dict(x=verts[u][0], y=verts[u][1]), b=dict(x=verts[v][0], y=verts[v][1]), kind=k) for (u, v), k in edges.items()],
                vertices=vchecks, clashes=[dict(a=dict(x=verts[u][0], y=verts[u][1]), b=dict(x=verts[v][0], y=verts[v][1])) for u, v in clash],
                sheet=dict(width=(x1 - x0) / size, height=(y1 - y0) / size), messages=messages)


def _meet(s, t, eps):
    (p, q, _), (r, w, _) = s, t
    d1 = (q[0] - p[0], q[1] - p[1]); d2 = (w[0] - r[0], w[1] - r[1])
    den = d1[0] * d2[1] - d1[1] * d2[0]
    l1, l2 = math.hypot(*d1), math.hypot(*d2)
    res = []
    if abs(den) < 1e-12 * l1 * l2 or abs(den) / (l1 * l2) < 1e-9:
        # Parallel: if collinear, each endpoint lying on the other splits it.
        if abs((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / l1 > eps: return res
        for e in (r, w):
            t = ((e[0] - p[0]) * d1[0] + (e[1] - p[1]) * d1[1]) / (l1 * l1)
            if -eps / l1 < t < 1 + eps / l1: res.append((min(1, max(0, t)), 0.0 if e is r else 1.0))
        for e in (p, q):
            u = ((e[0] - r[0]) * d2[0] + (e[1] - r[1]) * d2[1]) / (l2 * l2)
            if -eps / l2 < u < 1 + eps / l2: res.append((0.0 if e is p else 1.0, min(1, max(0, u))))
        return res
    t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den
    u = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den
    if -eps / l1 <= t <= 1 + eps / l1 and -eps / l2 <= u <= 1 + eps / l2:
        res.append((min(1, max(0, t)), min(1, max(0, u))))
    return res


def _area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def _inside(p, poly):
    c = False
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]): c = not c
    return c


def _reflect(a, b):
    """The reflection across the line through a and b, as (m00, m01, m02, m10, m11, m12)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    c, s = (dx * dx - dy * dy) / l2, 2 * dx * dy / l2
    return (c, s, a[0] - c * a[0] - s * a[1], s, -c, a[1] - s * a[0] + c * a[1])


def _compose(m, n):
    """m after n."""
    return (m[0] * n[0] + m[1] * n[3], m[0] * n[1] + m[1] * n[4], m[0] * n[2] + m[1] * n[5] + m[2],
            m[3] * n[0] + m[4] * n[3], m[3] * n[1] + m[4] * n[4], m[3] * n[2] + m[4] * n[5] + m[5])


if __name__ == "__main__":
    S = lambda a, b, k: dict(a=dict(x=a[0], y=a[1]), b=dict(x=b[0], y=b[1]), kind=k)
    sq = [S((0, 0), (1, 0), "B"), S((1, 0), (1, 1), "B"), S((1, 1), (0, 1), "B"), S((0, 1), (0, 0), "B")]
    # One valley fold.
    r = fold(sq + [S((0, .5), (1, .5), "V")]); print(r["foldable"], len(r["faces"]), r["messages"])
    # Folded in quarters: 3 M and 1 V at the centre.
    r = fold(sq + [S((0, .5), (.5, .5), "V"), S((.5, .5), (1, .5), "M"), S((.5, 0), (.5, 1), "M")])
    print(r["foldable"], len(r["faces"]), r["vertices"], r["messages"])
    # Not flat-foldable: three creases at a point.
    r = fold(sq + [S((.5, .5), (0, 0), "V"), S((.5, .5), (1, 0), "V"), S((.5, .5), (.5, 1), "M")])
    print(r["foldable"], r["messages"])
    # Waterbomb-like 8-ray vertex: diagonals and midlines (all unassigned) is flat-foldable.
    r = fold(sq + [S((0, 0), (1, 1), "V"), S((1, 0), (0, 1), "V"), S((0, .5), (1, .5), "M"), S((.5, 0), (.5, .5), "M"), S((.5, .5), (.5, 1), "V")])
    print(r["foldable"], len(r["faces"]), r["vertices"][0], r["messages"])
    xs = [p["x"] for f in r["faces"] for p in f["folded"]]; ys = [p["y"] for f in r["faces"] for p in f["folded"]]
    print("folded bounds", min(xs), max(xs), min(ys), max(ys))
