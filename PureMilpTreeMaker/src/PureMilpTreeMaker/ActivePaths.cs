namespace PureMilpTreeMaker;

/// <summary>Two leaves, by name.</summary>
public sealed record LeafPairName(string A, string B);

/// <summary>One bounded face of the network of tight paths.</summary>
/// <param name="Leaves">The leaves around the face, counter-clockwise.</param>
/// <param name="Convex">True when every corner turns left or goes straight.</param>
/// <param name="LeavesInside">Leaves strictly inside the face; a crease pattern needs none.</param>
/// <param name="Area">The face's area in grid units².</param>
/// <param name="Valid">Convex, simple (no tight path dangling into it), and empty.</param>
public sealed record PolygonFace(IReadOnlyList<string> Leaves, bool Convex, IReadOnlyList<string> LeavesInside, double Area, bool Valid);

/// <summary>
/// Whether a layout's tight paths (TreeMaker's active paths) divide the leaves' convex hull into polygons a crease
/// pattern can be built in: convex, bounded by tight paths, and with no leaf inside.
/// </summary>
public sealed record ActivePathReport
{
    /// <summary>Pairs at exactly their minimum distance.</summary>
    public IReadOnlyList<LeafPairName> TightPairs { get; init; } = Array.Empty<LeafPairName>();

    /// <summary>The network's segments: tight paths, split where a leaf lies on them.</summary>
    public IReadOnlyList<LeafPairName> Segments { get; init; } = Array.Empty<LeafPairName>();

    /// <summary>The bounded faces of the network.</summary>
    public IReadOnlyList<PolygonFace> Polygons { get; init; } = Array.Empty<PolygonFace>();

    /// <summary>The leaves on the convex hull, counter-clockwise.</summary>
    public IReadOnlyList<string> HullLeaves { get; init; } = Array.Empty<string>();

    /// <summary>Pieces of the hull boundary between consecutive leaves that are not tight paths.</summary>
    public IReadOnlyList<LeafPairName> MissingBoundary { get; init; } = Array.Empty<LeafPairName>();

    public double CoveredArea { get; init; }
    public double HullArea { get; init; }

    /// <summary>Everything that stops a crease pattern, in plain words.</summary>
    public IReadOnlyList<string> Issues { get; init; } = Array.Empty<string>();

    /// <summary>True when the polygons tile the hull and every one is valid.</summary>
    public bool Valid { get; init; }
}

/// <summary>
/// Builds the <see cref="ActivePathReport"/> of a layout, with exact integer geometry: A:1 of the Polygon Closing
/// TreeMaker spec (the valid subdivision is its D:4, the greedy triangulation its D:5).
/// </summary>
public static class ActivePaths
{
    /// <summary>Turns named grid points into placements for <paramref name="tree"/>; every leaf must appear once.</summary>
    public static LeafPlacement[] Place(Tree tree, IEnumerable<(string Leaf, int X, int Y)> points)
    {
        var byName = new Dictionary<string, (int X, int Y)>(StringComparer.Ordinal);
        foreach (var (leaf, x, y) in points)
        {
            if (!tree.Contains(leaf) || !tree.IsLeaf(tree.Id(leaf))) throw new ArgumentException($"'{leaf}' is not a leaf of the tree.");
            if (!byName.TryAdd(leaf, (x, y))) throw new ArgumentException($"Leaf {leaf} is placed twice.");
        }
        return tree.Leaves.Select(v =>
        {
            string name = tree.Name(v);
            if (!byName.TryGetValue(name, out var at)) throw new ArgumentException($"Leaf {name} has no position.");
            return new LeafPlacement(name, v, at.X, at.Y);
        }).ToArray();
    }

    /// <summary>Analyzes a layout whose pair spacing has already been measured (see <see cref="LayoutAnalysis.Pairs"/>).</summary>
    public static ActivePathReport Analyze(IReadOnlyList<LeafPlacement> layout, IReadOnlyList<PairReport> pairs)
    {
        var points = layout.ToDictionary(p => p.Leaf, p => (X: (long)p.X, Y: (long)p.Y), StringComparer.Ordinal);
        var tight = pairs.Where(p => p.Tight).Select(p => new LeafPairName(p.A, p.B)).ToArray();
        return Analyze(points, tight);
    }

    /// <summary>Analyzes leaf points and a set of tight pairs.</summary>
    public static ActivePathReport Analyze(IReadOnlyDictionary<string, (long X, long Y)> points, IReadOnlyList<LeafPairName> tight)
    {
        var issues = new List<string>();
        var names = points.Keys.OrderBy(n => n, StringComparer.Ordinal).ToArray();

        // Segments: split each tight path at any leaf lying on it.
        var segments = new HashSet<(string, string)>();
        foreach (var t in tight)
        {
            var a = points[t.A];
            var b = points[t.B];
            var chain = names.Where(n => n != t.A && n != t.B && OnSegment(points[n], a, b))
                .OrderBy(n => Dist2(a, points[n])).Prepend(t.A).Append(t.B).ToArray();
            for (int k = 0; k + 1 < chain.Length; k++) segments.Add(Key(chain[k], chain[k + 1]));
        }
        var segmentList = segments.OrderBy(s => s.Item1, StringComparer.Ordinal).ThenBy(s => s.Item2, StringComparer.Ordinal).ToArray();

        for (int i = 0; i < segmentList.Length; i++)
        {
            for (int j = i + 1; j < segmentList.Length; j++)
            {
                var (a, b) = segmentList[i];
                var (c, d) = segmentList[j];
                if (ProperlyCross(points[a], points[b], points[c], points[d]))
                {
                    issues.Add($"The tight paths {a}–{b} and {c}–{d} cross.");
                }
            }
        }

        // Bounded faces, by walking half-edges with the face on the left.
        var neighbours = names.ToDictionary(n => n, _ => new List<string>(), StringComparer.Ordinal);
        foreach (var (a, b) in segmentList)
        {
            neighbours[a].Add(b);
            neighbours[b].Add(a);
        }
        foreach (var (v, list) in neighbours)
        {
            var p = points[v];
            list.Sort((u, w) => Math.Atan2(points[u].Y - p.Y, points[u].X - p.X)
                .CompareTo(Math.Atan2(points[w].Y - p.Y, points[w].X - p.X)));
        }
        var visited = new HashSet<(string, string)>();
        var polygons = new List<PolygonFace>();
        long coveredTwice = 0;
        foreach (var start in names)
        {
            foreach (var next in neighbours[start])
            {
                if (visited.Contains((start, next))) continue;
                var cycle = new List<string>();
                string u = start, v = next;
                while (visited.Add((u, v)))
                {
                    cycle.Add(u);
                    var around = neighbours[v];
                    int at = around.IndexOf(u);
                    string w = around[(at - 1 + around.Count) % around.Count];
                    (u, v) = (v, w);
                }
                long twice = TwiceArea(cycle.Select(n => points[n]).ToArray());
                if (twice <= 0) continue;   // the outer face, or a stray segment's two sides
                coveredTwice += twice;

                bool simple = cycle.Distinct().Count() == cycle.Count;
                bool convex = true;
                for (int k = 0; k < cycle.Count; k++)
                {
                    var p0 = points[cycle[k]];
                    var p1 = points[cycle[(k + 1) % cycle.Count]];
                    var p2 = points[cycle[(k + 2) % cycle.Count]];
                    if (Cross(p0, p1, p2) < 0) convex = false;
                }
                var polygon = cycle.Select(n => points[n]).ToArray();
                var inside = names.Where(n => !cycle.Contains(n) && StrictlyInside(points[n], polygon)).ToArray();
                bool valid = simple && convex && inside.Length == 0;
                polygons.Add(new PolygonFace(cycle, convex && simple, inside, twice / 2.0, valid));

                string label = string.Join("–", cycle);
                if (!simple) issues.Add($"A tight path dangles into the polygon {label}.");
                else if (!convex) issues.Add($"The polygon {label} is not convex.");
                if (inside.Length > 0) issues.Add($"Leaf {string.Join(", ", inside)} lies inside the polygon {label}.");
            }
        }

        // The hull and the parts of its boundary that are not tight.
        var hull = ConvexHull(names.Select(n => (Name: n, P: points[n])).ToList());
        var missing = new List<LeafPairName>();
        long hullTwice = TwiceArea(hull.Select(h => h.P).ToArray());
        for (int k = 0; k < hull.Count && hull.Count >= 2; k++)
        {
            var p = hull[k].P;
            var q = hull[(k + 1) % hull.Count].P;
            var along = names.Where(n => points[n] == p || points[n] == q || OnSegment(points[n], p, q))
                .OrderBy(n => Dist2(p, points[n])).ToArray();
            for (int j = 0; j + 1 < along.Length; j++)
            {
                if (!segments.Contains(Key(along[j], along[j + 1])))
                {
                    missing.Add(new LeafPairName(along[j], along[j + 1]));
                }
            }
            if (hull.Count == 2) break;
        }
        if (missing.Count > 0)
        {
            issues.Add("The outer boundary is not all tight: " +
                string.Join(", ", missing.Select(m => $"{m.A}–{m.B}")) + ".");
        }
        if (hullTwice > 0 && coveredTwice != hullTwice && missing.Count == 0)
        {
            issues.Add($"The polygons cover {coveredTwice / 2.0:0.##} of the hull's {hullTwice / 2.0:0.##} square units.");
        }
        if (hullTwice == 0)
        {
            issues.Add("The leaves are collinear, so they span no polygon.");
        }

        bool validAll = hullTwice > 0 && issues.Count == 0 && coveredTwice == hullTwice && polygons.All(p => p.Valid);
        return new ActivePathReport
        {
            TightPairs = tight,
            Segments = segmentList.Select(s => new LeafPairName(s.Item1, s.Item2)).ToArray(),
            Polygons = polygons,
            HullLeaves = hull.Select(h => h.Name).ToArray(),
            MissingBoundary = missing,
            CoveredArea = coveredTwice / 2.0,
            HullArea = hullTwice / 2.0,
            Issues = issues,
            Valid = validAll,
        };
    }

    /// <summary>
    /// A triangulation of the leaf points that keeps every given segment: shortest pairs first, skipping any that
    /// would cross a segment already taken or pass through a leaf.
    /// </summary>
    public static IReadOnlyList<LeafPairName> GreedyTriangulation(IReadOnlyDictionary<string, (long X, long Y)> points,
        IEnumerable<LeafPairName> keep)
    {
        var names = points.Keys.OrderBy(n => n, StringComparer.Ordinal).ToArray();
        var chosen = new List<(string A, string B)>();
        var set = new HashSet<(string, string)>();
        foreach (var k in keep)
        {
            if (set.Add(Key(k.A, k.B))) chosen.Add(Key(k.A, k.B));
        }
        var candidates = new List<(string A, string B, long D2)>();
        for (int i = 0; i < names.Length; i++)
        {
            for (int j = i + 1; j < names.Length; j++)
            {
                candidates.Add((names[i], names[j], Dist2(points[names[i]], points[names[j]])));
            }
        }
        foreach (var (a, b, _) in candidates.OrderBy(c => c.D2).ThenBy(c => c.A, StringComparer.Ordinal).ThenBy(c => c.B, StringComparer.Ordinal))
        {
            var key = Key(a, b);
            if (set.Contains(key)) continue;
            var pa = points[a];
            var pb = points[b];
            if (names.Any(n => n != a && n != b && OnSegment(points[n], pa, pb))) continue;
            if (chosen.Any(c => ProperlyCross(pa, pb, points[c.A], points[c.B]))) continue;
            set.Add(key);
            chosen.Add(key);
        }
        return chosen.Select(c => new LeafPairName(c.A, c.B)).ToArray();
    }

    /// <summary>Do two leaves lie consecutively on the convex hull's boundary?</summary>
    public static bool OnHullBoundary(IReadOnlyDictionary<string, (long X, long Y)> points, IReadOnlyList<string> hull, string a, string b)
    {
        var pa = points[a];
        var pb = points[b];
        for (int k = 0; k < hull.Count; k++)
        {
            var p = points[hull[k]];
            var q = points[hull[(k + 1) % hull.Count]];
            bool aOn = pa == p || pa == q || OnSegment(pa, p, q);
            bool bOn = pb == p || pb == q || OnSegment(pb, p, q);
            if (aOn && bOn) return true;
        }
        return false;
    }

    private static (string, string) Key(string a, string b) =>
        string.CompareOrdinal(a, b) <= 0 ? (a, b) : (b, a);

    private static long Cross((long X, long Y) o, (long X, long Y) a, (long X, long Y) b) =>
        (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);

    private static long Dist2((long X, long Y) a, (long X, long Y) b) =>
        (a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y);

    /// <summary>Is p strictly between a and b on the segment ab?</summary>
    private static bool OnSegment((long X, long Y) p, (long X, long Y) a, (long X, long Y) b) =>
        p != a && p != b && Cross(a, b, p) == 0 &&
        Math.Min(a.X, b.X) <= p.X && p.X <= Math.Max(a.X, b.X) &&
        Math.Min(a.Y, b.Y) <= p.Y && p.Y <= Math.Max(a.Y, b.Y);

    /// <summary>Do segments ab and cd cross at a single interior point of both?</summary>
    private static bool ProperlyCross((long X, long Y) a, (long X, long Y) b, (long X, long Y) c, (long X, long Y) d)
    {
        if (a == c || a == d || b == c || b == d) return false;
        long d1 = Cross(c, d, a), d2 = Cross(c, d, b), d3 = Cross(a, b, c), d4 = Cross(a, b, d);
        return d1 != 0 && d2 != 0 && d3 != 0 && d4 != 0 && (d1 > 0) != (d2 > 0) && (d3 > 0) != (d4 > 0);
    }

    private static long TwiceArea(IReadOnlyList<(long X, long Y)> polygon)
    {
        long sum = 0;
        for (int k = 0; k < polygon.Count; k++)
        {
            var p = polygon[k];
            var q = polygon[(k + 1) % polygon.Count];
            sum += p.X * q.Y - q.X * p.Y;
        }
        return sum;
    }

    /// <summary>Strictly inside a counter-clockwise polygon (winding number), not on its boundary.</summary>
    private static bool StrictlyInside((long X, long Y) p, IReadOnlyList<(long X, long Y)> polygon)
    {
        int winding = 0;
        for (int k = 0; k < polygon.Count; k++)
        {
            var a = polygon[k];
            var b = polygon[(k + 1) % polygon.Count];
            if (p == a || OnSegment(p, a, b)) return false;
            if (a.Y <= p.Y && p.Y < b.Y && Cross(a, b, p) > 0) winding++;
            else if (b.Y <= p.Y && p.Y < a.Y && Cross(a, b, p) < 0) winding--;
        }
        return winding != 0;
    }

    private static List<(string Name, (long X, long Y) P)> ConvexHull(List<(string Name, (long X, long Y) P)> items)
    {
        var sorted = items.GroupBy(i => i.P).Select(g => g.First())
            .OrderBy(i => i.P.X).ThenBy(i => i.P.Y).ToList();
        if (sorted.Count <= 2) return sorted;
        var lower = new List<(string Name, (long X, long Y) P)>();
        foreach (var item in sorted)
        {
            while (lower.Count >= 2 && Cross(lower[^2].P, lower[^1].P, item.P) <= 0) lower.RemoveAt(lower.Count - 1);
            lower.Add(item);
        }
        var upper = new List<(string Name, (long X, long Y) P)>();
        for (int k = sorted.Count - 1; k >= 0; k--)
        {
            var item = sorted[k];
            while (upper.Count >= 2 && Cross(upper[^2].P, upper[^1].P, item.P) <= 0) upper.RemoveAt(upper.Count - 1);
            upper.Add(item);
        }
        lower.RemoveAt(lower.Count - 1);
        upper.RemoveAt(upper.Count - 1);
        lower.AddRange(upper);
        return lower;
    }
}
