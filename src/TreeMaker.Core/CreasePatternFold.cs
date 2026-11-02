namespace TreeMaker.Core;

/// <summary>The kind of a line in a crease pattern read from a file or an image.</summary>
public enum LineKind { M, V, U, F, B }

/// <summary>One line of a crease pattern, in any units: mountain, valley, unassigned crease, flat (not folded) or border.</summary>
public sealed record CpLine(PointD A, PointD B, LineKind Kind);

/// <summary>A point in the plane.</summary>
public readonly record struct PointD(double X, double Y);

/// <summary>One face of the crease pattern: on the paper and folded flat (null when no crease path reaches it).</summary>
public sealed record CpFace(IReadOnlyList<PointD> Paper, IReadOnlyList<PointD>? Folded, bool Flipped);

/// <summary>The local flat-foldability checks at an inner vertex. Maekawa is null unless every crease there is M or V.</summary>
public sealed record CpVertexCheck(double X, double Y, int Degree, bool Kawasaki, bool? Maekawa);

/// <summary>The outcome of <see cref="CreasePatternFold.Fold"/>, in units of the sheet (its longer side is 1).</summary>
public sealed record CpFoldResult
{
    public bool Foldable { get; init; }
    public IReadOnlyList<CpFace> Faces { get; init; } = Array.Empty<CpFace>();
    public IReadOnlyList<CpLine> Edges { get; init; } = Array.Empty<CpLine>();
    public IReadOnlyList<CpVertexCheck> Vertices { get; init; } = Array.Empty<CpVertexCheck>();

    /// <summary>Creases across which a face is reached two ways with different maps: where no flat fold exists.</summary>
    public IReadOnlyList<CpLine> Clashes { get; init; } = Array.Empty<CpLine>();
    public double SheetWidth { get; init; }
    public double SheetHeight { get; init; }
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Folds any crease pattern flat (the crease-pattern page, cp.html): the folded shape of every face, by reflecting
/// across creases from a root face, and Kawasaki's and Maekawa's tests at every inner vertex. It reads only lines,
/// so it works for a pattern from a file or traced from an image, not only for the patterns the tree method builds
/// (<see cref="CreasePatternBuilder"/>). Layer order is not computed: the folded faces are drawn see-through.
/// tools/cp_fold.py is its Python twin for the front-end checks; keep the two in step.
///   1. Scale to the sheet: the border's bounding box (or every line's when there is no border) has longer side 1.
///   2. Split every line where it meets another, merge points closer than 1e-3, drop repeats and dangling pieces.
///   3. Trace the faces of the planar graph.
///   4. From the face under the centre, cross each crease (M, V, U) by reflecting across its line and each flat line
///      (F) without folding; a face reached two ways with different maps means no flat fold exists.
///   5. At each inner vertex: Kawasaki (alternate angles sum to π) and, when every crease is M or V, Maekawa.
/// </summary>
public static class CreasePatternFold
{
    private const double Eps = 1e-3;

    private static int Rank(LineKind k) => k switch { LineKind.M or LineKind.V => 0, LineKind.U => 1, LineKind.F => 2, _ => 3 };

    /// <param name="toleranceDegrees">How far from exact the angles may be, for patterns traced from an image; exact
    /// (10⁻⁴ rad for Kawasaki, 10⁻⁶ between two maps of a face) when null.</param>
    public static CpFoldResult Fold(IReadOnlyList<CpLine> lines, double? toleranceDegrees = null)
    {
        ArgumentNullException.ThrowIfNull(lines);
        double angleTol = toleranceDegrees is > 0 ? Math.Max(1e-4, toleranceDegrees.Value * Math.PI / 180) : 1e-4;
        // Coordinates in files carry a few digits, and composing reflections grows their error: maps agree to 4 · angleTol.
        double mapTol = 4 * angleTol;
        var messages = new List<string>();
        if (lines.Count == 0) return new CpFoldResult { Messages = new[] { "There are no lines." } };

        // 1. Scale to the sheet.
        var border = lines.Where(l => l.Kind == LineKind.B).ToList();
        var pts = (border.Count > 0 ? border : lines).SelectMany(l => new[] { l.A, l.B }).ToList();
        double x0 = pts.Min(p => p.X), x1 = pts.Max(p => p.X), y0 = pts.Min(p => p.Y), y1 = pts.Max(p => p.Y);
        double size = Math.Max(x1 - x0, y1 - y0);
        if (!(size > 0)) return new CpFoldResult { Messages = new[] { "The lines have no extent." } };
        PointD Norm(PointD p) => new((p.X - x0) / size, (p.Y - y0) / size);
        var segs = lines.Select(l => new CpLine(Norm(l.A), Norm(l.B), l.Kind)).ToList();
        double w = (x1 - x0) / size, h = (y1 - y0) / size;
        if (border.Count == 0)
        {
            var c = new[] { new PointD(0, 0), new PointD(w, 0), new PointD(w, h), new PointD(0, h) };
            for (int i = 0; i < 4; i++) segs.Add(new CpLine(c[i], c[(i + 1) % 4], LineKind.B));
            messages.Add("No border was marked: the bounding box of the lines is taken as the sheet.");
        }
        segs = segs.Where(s => Dist(s.A, s.B) > Eps).ToList();

        // 2. Split at every crossing and touching point; merge close points.
        var cuts = segs.Select(_ => new List<double> { 0, 1 }).ToList();
        for (int i = 0; i < segs.Count; i++)
        {
            for (int j = i + 1; j < segs.Count; j++)
            {
                foreach (var (t, u) in Meet(segs[i], segs[j]))
                {
                    cuts[i].Add(t);
                    cuts[j].Add(u);
                }
            }
        }
        var verts = new List<PointD>();
        var grid = new Dictionary<(long, long), int>();
        int Vid(PointD p)
        {
            long kx = (long)Math.Round(p.X / Eps), ky = (long)Math.Round(p.Y / Eps);
            for (int dx = -1; dx <= 1; dx++)
            {
                for (int dy = -1; dy <= 1; dy++)
                {
                    if (grid.TryGetValue((kx + dx, ky + dy), out int k) && Dist(verts[k], p) <= Eps) return k;
                }
            }
            grid[(kx, ky)] = verts.Count;
            verts.Add(p);
            return verts.Count - 1;
        }
        var edges = new Dictionary<(int, int), LineKind>();
        for (int i = 0; i < segs.Count; i++)
        {
            var s = segs[i];
            var ids = new List<int>();
            foreach (double t in cuts[i].Where(t => t >= -1e-12 && t <= 1 + 1e-12).Select(t => Math.Round(t, 12)).Distinct().OrderBy(t => t))
            {
                int v = Vid(new PointD(s.A.X + t * (s.B.X - s.A.X), s.A.Y + t * (s.B.Y - s.A.Y)));
                if (ids.Count == 0 || ids[^1] != v) ids.Add(v);
            }
            for (int k = 0; k + 1 < ids.Count; k++)
            {
                var key = (Math.Min(ids[k], ids[k + 1]), Math.Max(ids[k], ids[k + 1]));
                if (!edges.TryGetValue(key, out var old) || Rank(s.Kind) < Rank(old)) edges[key] = s.Kind;
            }
        }
        int dropped = 0;
        while (true)
        {
            var deg = new Dictionary<int, int>();
            foreach (var (u, v) in edges.Keys)
            {
                deg[u] = deg.GetValueOrDefault(u) + 1;
                deg[v] = deg.GetValueOrDefault(v) + 1;
            }
            var loose = edges.Keys.Where(e => deg[e.Item1] == 1 || deg[e.Item2] == 1).ToList();
            if (loose.Count == 0) break;
            foreach (var e in loose) edges.Remove(e);
            dropped += loose.Count;
        }
        if (dropped > 0) messages.Add($"{dropped} loose line piece{(dropped == 1 ? "" : "s")} with an open end were left out.");
        if (edges.Count == 0)
        {
            messages.Add("No closed faces.");
            return new CpFoldResult { Messages = messages };
        }
        LineKind KindOf(int u, int v) => edges[(Math.Min(u, v), Math.Max(u, v))];

        // 3. Faces: at each vertex sort the neighbours by angle; from u→v turn to the next edge clockwise at v.
        var nbrs = new Dictionary<int, List<int>>();
        foreach (var (u, v) in edges.Keys)
        {
            (nbrs.TryGetValue(u, out var a) ? a : nbrs[u] = new List<int>()).Add(v);
            (nbrs.TryGetValue(v, out var b) ? b : nbrs[v] = new List<int>()).Add(u);
        }
        double Ang(int u, int v) => Math.Atan2(verts[v].Y - verts[u].Y, verts[v].X - verts[u].X);
        foreach (var (u, list) in nbrs) list.Sort((p, q) => Ang(u, p).CompareTo(Ang(u, q)));
        var seen = new HashSet<(int, int)>();
        var faces = new List<List<int>>();
        foreach (var (u0, list) in nbrs)
        {
            foreach (int v0 in list)
            {
                if (seen.Contains((u0, v0))) continue;
                var cyc = new List<int>();
                int a = u0, b = v0;
                while (seen.Add((a, b)))
                {
                    cyc.Add(a);
                    var nb = nbrs[b];
                    int i = nb.IndexOf(a);
                    (a, b) = (b, nb[(i - 1 + nb.Count) % nb.Count]);
                }
                if (Area(cyc.Select(k => verts[k]).ToList()) > Eps * Eps) faces.Add(cyc);
            }
        }
        var faceOf = new Dictionary<(int, int), int>();
        for (int f = 0; f < faces.Count; f++)
        {
            var cyc = faces[f];
            for (int i = 0; i < cyc.Count; i++) faceOf[(cyc[i], cyc[(i + 1) % cyc.Count])] = f;
        }

        // 4. Fold from the face under the centre, else the largest.
        var centre = new PointD(verts.Average(p => p.X), verts.Average(p => p.Y));
        int root = Enumerable.Range(0, faces.Count).Cast<int?>()
            .FirstOrDefault(f => Inside(centre, faces[f!.Value].Select(k => verts[k]).ToList())) ?? -1;
        if (root < 0) root = Enumerable.Range(0, faces.Count).MaxBy(f => Area(faces[f].Select(k => verts[k]).ToList()));
        var map = new Dictionary<int, Affine> { [root] = Affine.Identity };
        var queue = new Queue<int>();
        queue.Enqueue(root);
        var clashes = new List<CpLine>();
        while (queue.Count > 0)
        {
            int f = queue.Dequeue();
            var cyc = faces[f];
            for (int i = 0; i < cyc.Count; i++)
            {
                int u = cyc[i], v = cyc[(i + 1) % cyc.Count];
                var kind = KindOf(u, v);
                if (kind == LineKind.B || !faceOf.TryGetValue((v, u), out int g)) continue;
                var m = kind == LineKind.F ? map[f] : map[f].After(Affine.Reflection(verts[u], verts[v]));
                if (!map.TryGetValue(g, out var known))
                {
                    map[g] = m;
                    queue.Enqueue(g);
                }
                else if (!known.Near(m, mapTol))
                {
                    clashes.Add(new CpLine(verts[u], verts[v], kind));
                }
            }
        }
        if (map.Count < faces.Count) messages.Add($"{faces.Count - map.Count} face(s) are not connected to the rest by creases.");

        // 5. Vertex checks.
        var onBorder = new HashSet<int>(edges.Where(e => e.Value == LineKind.B).SelectMany(e => new[] { e.Key.Item1, e.Key.Item2 }));
        var checks = new List<CpVertexCheck>();
        foreach (var (u, list) in nbrs)
        {
            if (onBorder.Contains(u)) continue;
            var folds = list.Where(v => KindOf(u, v) != LineKind.F).ToList();
            if (folds.Count == 0) continue;
            var a = folds.Select(v => Ang(u, v)).ToList();
            double alt = 0;
            for (int i = 0; i < a.Count; i++)
            {
                double sector = ((a[(i + 1) % a.Count] - a[i]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                if (sector == 0) sector = 2 * Math.PI;
                alt += i % 2 == 0 ? sector : -sector;
            }
            bool kawasaki = a.Count % 2 == 0 && Math.Abs(alt) < angleTol;
            var kinds = folds.Select(v => KindOf(u, v)).ToList();
            bool? maekawa = kinds.All(k => k is LineKind.M or LineKind.V)
                ? Math.Abs(kinds.Count(k => k == LineKind.M) - kinds.Count(k => k == LineKind.V)) == 2
                : null;
            checks.Add(new CpVertexCheck(verts[u].X, verts[u].Y, folds.Count, kawasaki, maekawa));
        }
        int badK = checks.Count(c => !c.Kawasaki), badM = checks.Count(c => c.Maekawa == false);
        if (clashes.Count > 0) messages.Add($"The faces do not fold to one flat shape: {clashes.Count} crease(s) map a face two ways.");
        if (badK > 0) messages.Add($"{badK} vertex/vertices fail Kawasaki's theorem (alternate angles must sum to 180°).");
        if (badM > 0) messages.Add($"{badM} vertex/vertices fail Maekawa's theorem (mountains and valleys must differ by 2).");
        bool foldable = clashes.Count == 0 && badK == 0 && map.Count == faces.Count;
        if (foldable)
        {
            bool assigned = checks.Count > 0 && badM == 0 && checks.All(c => c.Maekawa is not null);
            messages.Add($"Folds flat: {faces.Count} faces." + (assigned ? " Mountain and valley assignments pass Maekawa." : ""));
        }

        var faceOut = faces.Select((cyc, f) =>
        {
            var paper = cyc.Select(k => verts[k]).ToList();
            bool has = map.TryGetValue(f, out var m);
            return new CpFace(paper, has ? paper.Select(m.Apply).ToList() : null, has && m.Determinant < 0);
        }).ToList();
        return new CpFoldResult
        {
            Foldable = foldable,
            Faces = faceOut,
            Edges = edges.Select(e => new CpLine(verts[e.Key.Item1], verts[e.Key.Item2], e.Value)).ToList(),
            Vertices = checks,
            Clashes = clashes,
            SheetWidth = w,
            SheetHeight = h,
            Messages = messages,
        };
    }

    /// <summary>Where two segments meet, as parameters along each (several for collinear overlaps).</summary>
    private static IEnumerable<(double T, double U)> Meet(CpLine s, CpLine t)
    {
        double d1x = s.B.X - s.A.X, d1y = s.B.Y - s.A.Y, d2x = t.B.X - t.A.X, d2y = t.B.Y - t.A.Y;
        double l1 = Math.Sqrt(d1x * d1x + d1y * d1y), l2 = Math.Sqrt(d2x * d2x + d2y * d2y);
        double den = d1x * d2y - d1y * d2x;
        double rx = t.A.X - s.A.X, ry = t.A.Y - s.A.Y;
        if (Math.Abs(den) / (l1 * l2) < 1e-9)
        {
            if (Math.Abs(rx * d1y - ry * d1x) / l1 > Eps) yield break;   // parallel, not collinear
            foreach (var (e, u) in new[] { (t.A, 0.0), (t.B, 1.0) })
            {
                double p = ((e.X - s.A.X) * d1x + (e.Y - s.A.Y) * d1y) / (l1 * l1);
                if (p > -Eps / l1 && p < 1 + Eps / l1) yield return (Math.Clamp(p, 0, 1), u);
            }
            foreach (var (e, p) in new[] { (s.A, 0.0), (s.B, 1.0) })
            {
                double u = ((e.X - t.A.X) * d2x + (e.Y - t.A.Y) * d2y) / (l2 * l2);
                if (u > -Eps / l2 && u < 1 + Eps / l2) yield return (p, Math.Clamp(u, 0, 1));
            }
            yield break;
        }
        double tt = (rx * d2y - ry * d2x) / den, uu = (rx * d1y - ry * d1x) / den;
        if (tt >= -Eps / l1 && tt <= 1 + Eps / l1 && uu >= -Eps / l2 && uu <= 1 + Eps / l2)
        {
            yield return (Math.Clamp(tt, 0, 1), Math.Clamp(uu, 0, 1));
        }
    }

    private static double Dist(PointD a, PointD b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));

    private static double Area(IReadOnlyList<PointD> p)
    {
        double s = 0;
        for (int i = 0; i < p.Count; i++) s += p[i].X * p[(i + 1) % p.Count].Y - p[(i + 1) % p.Count].X * p[i].Y;
        return s / 2;
    }

    private static bool Inside(PointD q, IReadOnlyList<PointD> poly)
    {
        bool c = false;
        for (int i = 0; i < poly.Count; i++)
        {
            var a = poly[i];
            var b = poly[(i + 1) % poly.Count];
            if ((a.Y > q.Y) != (b.Y > q.Y) && q.X < a.X + (q.Y - a.Y) * (b.X - a.X) / (b.Y - a.Y)) c = !c;
        }
        return c;
    }

    /// <summary>x' = m00 x + m01 y + m02, y' = m10 x + m11 y + m12.</summary>
    private readonly record struct Affine(double M00, double M01, double M02, double M10, double M11, double M12)
    {
        public static Affine Identity => new(1, 0, 0, 0, 1, 0);

        /// <summary>The reflection across the line through a and b.</summary>
        public static Affine Reflection(PointD a, PointD b)
        {
            double dx = b.X - a.X, dy = b.Y - a.Y, l2 = dx * dx + dy * dy;
            double c = (dx * dx - dy * dy) / l2, s = 2 * dx * dy / l2;
            return new Affine(c, s, a.X - c * a.X - s * a.Y, s, -c, a.Y - s * a.X + c * a.Y);
        }

        /// <summary>This map applied after n (this ∘ n).</summary>
        public Affine After(Affine n) => new(
            M00 * n.M00 + M01 * n.M10, M00 * n.M01 + M01 * n.M11, M00 * n.M02 + M01 * n.M12 + M02,
            M10 * n.M00 + M11 * n.M10, M10 * n.M01 + M11 * n.M11, M10 * n.M02 + M11 * n.M12 + M12);

        public PointD Apply(PointD p) => new(M00 * p.X + M01 * p.Y + M02, M10 * p.X + M11 * p.Y + M12);

        public double Determinant => M00 * M11 - M01 * M10;

        public bool Near(Affine o, double tol) =>
            Math.Abs(M00 - o.M00) <= tol && Math.Abs(M01 - o.M01) <= tol && Math.Abs(M02 - o.M02) <= tol &&
            Math.Abs(M10 - o.M10) <= tol && Math.Abs(M11 - o.M11) <= tol && Math.Abs(M12 - o.M12) <= tol;
    }
}
