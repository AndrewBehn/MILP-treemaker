using System.Text.Json.Serialization;

namespace PureMilpTreeMaker;

/// <summary>A point or vector in the plane of the paper (grid units).</summary>
public readonly record struct Vec2(double X, double Y)
{
    public static Vec2 operator +(Vec2 a, Vec2 b) => new(a.X + b.X, a.Y + b.Y);
    public static Vec2 operator -(Vec2 a, Vec2 b) => new(a.X - b.X, a.Y - b.Y);
    public static Vec2 operator *(double k, Vec2 a) => new(k * a.X, k * a.Y);
    public static Vec2 operator /(Vec2 a, double k) => new(a.X / k, a.Y / k);
    public double Dot(Vec2 b) => X * b.X + Y * b.Y;

    // Computed helpers are not data: without [JsonIgnore], serializing a Vec2 would follow Unit → Unit → … forever.
    [JsonIgnore] public double Length => Math.Sqrt(X * X + Y * Y);
    [JsonIgnore] public Vec2 Unit => this / Length;

    /// <summary>Rotated 90° counter-clockwise.</summary>
    [JsonIgnore] public Vec2 Perp => new(-Y, X);
}

/// <summary>A point of the tree: a node, or a point inside an edge at <see cref="Offset"/> (tree units) from its first node.</summary>
public readonly record struct TreePoint(int Node, int Edge, double Offset)
{
    [JsonIgnore] public bool IsNode => Edge < 0;
    public static TreePoint AtNode(int node) => new(node, -1, 0);
    public static TreePoint OnEdge(int edge, double offset) => new(-1, edge, offset);
}

/// <summary>What a crease does in the folded base (TreeMaker's crease kinds).</summary>
public enum CreaseKind
{
    /// <summary>A side of a top-level polygon: a tight path, which lies on the base's axis.</summary>
    Axial,

    /// <summary>The track of a polygon corner as the polygon shrinks: the top of a flap.</summary>
    Ridge,

    /// <summary>Perpendicular to a polygon side at an internal tree node: where flaps hinge.</summary>
    Hinge,

    /// <summary>A diagonal that became tight while the polygon shrank; the polygon splits along it.</summary>
    Gusset,

    /// <summary>A line between two coplanar facets (the edge of an inset polygon); not folded.</summary>
    Flat,

    /// <summary>
    /// An elevation contour at a multiple of the pleat height, folded valley and mountain in turn so the flaps
    /// collapse to that height (see <see cref="CreasePatternBuilder.Build"/>).
    /// </summary>
    Pleat,
}

/// <summary>One crease segment on the paper; <paramref name="Assignment"/> is "M" or "V" where it is known (pleats).</summary>
public sealed record Crease(Vec2 A, Vec2 B, CreaseKind Kind, string? Assignment = null);

/// <summary>
/// One facet: a convex piece of paper between creases, lying over a single tree edge in the folded base.
/// <see cref="Along"/>[k] is how far vertex k sits along that edge from its first node (paper units), and
/// <see cref="Elevation"/>[k] is its height above the axis in the unpleated base, and <see cref="Height"/>[k] its height
/// once the flaps are pleated (the same as the elevation when there is no pleating).
/// </summary>
public sealed record Facet(IReadOnlyList<Vec2> Paper, int Edge, IReadOnlyList<double> Along, IReadOnlyList<double> Elevation,
    IReadOnlyList<double> Height, int Depth);

/// <summary>The crease pattern of a layout and the folded form of its base.</summary>
public sealed record CreasePatternResult
{
    public bool Built { get; init; }
    public IReadOnlyList<Crease> Creases { get; init; } = Array.Empty<Crease>();
    public IReadOnlyList<Facet> Facets { get; init; } = Array.Empty<Facet>();

    /// <summary>Tree edges as built (paper units: the scale times each edge's length).</summary>
    public IReadOnlyList<double> EdgePaperLengths { get; init; } = Array.Empty<double>();

    /// <summary>The highest elevation in the base (the tallest ridge).</summary>
    public double MaxElevation { get; init; }

    /// <summary>The pleat height H when the flaps are pleated; null otherwise.</summary>
    public double? PleatHeight { get; init; }

    /// <summary>The height of the folded base: the tallest ridge, or at most H when pleated.</summary>
    public double FoldedHeight { get; init; }

    /// <summary>The deepest level of polygon splitting (0 when no gussets were needed).</summary>
    public int MaxDepth { get; init; }

    /// <summary>Results of the self-check: empty when every vertex folds to one point and every facet keeps its shape.</summary>
    public IReadOnlyList<string> Problems { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
    public double Milliseconds { get; init; }
}

/// <summary>
/// Step 3: Lang's universal molecule, built in every polygon of a valid tight-path network, and the folded base.
/// <para>
/// Each polygon shrinks: every side moves inward by the same distance h, so corner i slides along its bisector at speed
/// rᵢ (rᵢ·n = 1 for each adjacent side's inward normal n), and the reduced tree path between corners i and j shortens by
/// h(cᵢ + cⱼ), where c is the cotangent of half the corner's angle. h stops at the first event: two adjacent corners
/// meet, or a reduced path between non-adjacent corners becomes exactly tight. The band between each side and its inset
/// is cut into facets by hinge creases at every internal tree node along the side's path; the corner tracks are ridges.
/// With one or two distinct inset corners the molecule is finished; otherwise the inset polygon splits along its newly
/// tight diagonals (gussets) and each piece is built the same way, one level up.
/// </para>
/// <para>
/// Folding: in the band of a side, a paper point maps to elevation e + (distance to the side) and to the tree point at
/// (its projection on the side) / m along the side's path. The builder checks that every vertex folds to a single point
/// from all its facets, that each facet lies over one tree edge, and that each facet keeps its shape.
/// </para>
/// </summary>
public static class CreasePatternBuilder
{
    private const double Tol = 1e-7;

    /// <param name="pleatHeight">
    /// When set, the flaps are pleated down to this height: every facet is cut along the elevation contours z = kH, and
    /// contour k is a valley or a mountain by (−1)ᵏ times the facet's orientation, so its folded height becomes the
    /// triangle wave H − |(z mod 2H) − H|. A contour changes fold where it crosses a ridge, as a pleat over a fold must.
    /// </param>
    public static CreasePatternResult Build(ProblemSpec spec, IReadOnlyList<LeafPlacement> layout, double scale,
        IReadOnlyList<double>? edgeLengths = null, double? pleatHeight = null)
    {
        if (pleatHeight is double ph && !(ph > 0)) throw new ArgumentException("The pleat height must be positive.");
        ArgumentNullException.ThrowIfNull(spec);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var tree = spec.Tree;
        var lengths = (edgeLengths ?? tree.Edges.Select(e => e.Length).ToArray()).ToArray();
        if (lengths.Length != tree.Edges.Count) throw new ArgumentException("There must be one length per edge.");
        if (!(scale > 0)) throw new ArgumentException("The scale must be positive.");

        var defs = new Definitions(tree, spec.GridSize);
        var pairs = LayoutAnalysis.Pairs(defs, layout, scale, lengths);
        var report = ActivePaths.Analyze(layout, pairs);
        if (!report.Valid)
        {
            return new CreasePatternResult
            {
                Built = false,
                Messages = new[] { "The tight paths do not yet form valid polygons; close the polygons first." }
                    .Concat(report.Issues).ToArray(),
            };
        }

        var geometry = new TreeGeometry(tree, lengths);
        var builder = new Molecules(geometry, scale);
        var position = layout.ToDictionary(p => p.Leaf, p => new Vec2(p.X, p.Y), StringComparer.Ordinal);
        foreach (var polygon in report.Polygons)
        {
            var ring = polygon.Leaves.Select(l => (Pos: position[l], Tree: TreePoint.AtNode(tree.Id(l)))).ToList();
            builder.Molecule(ring, Enumerable.Repeat(CreaseKind.Axial, ring.Count).ToList(), 0, 0);
        }

        var facets = new List<Facet>();
        var pleats = new List<Crease>();
        var problems = new List<string>(builder.Notes);
        var seen = new List<(Vec2 P, TreePoint T, double Z)>();
        foreach (var raw in builder.RawFacets)
        {
            var folded = raw.Paper.Select(p => builder.Fold(raw.Band, p)).ToArray();
            int edge = -1;
            for (int k = 0; k < tree.Edges.Count && edge < 0; k++)
            {
                if (folded.All(f => geometry.PositionOnEdge(f.T, k) is not null)) edge = k;
            }
            if (edge < 0)
            {
                problems.Add("A facet spans more than one tree edge.");
                continue;
            }
            var along = folded.Select(f => scale * geometry.PositionOnEdge(f.T, edge)!.Value).ToArray();
            var elevation = folded.Select(f => f.Z).ToArray();
            for (int a = 0; a < raw.Paper.Count; a++)
            {
                for (int b = a + 1; b < raw.Paper.Count; b++)
                {
                    double paper = (raw.Paper[a] - raw.Paper[b]).Length;
                    double fold = Math.Sqrt((along[a] - along[b]) * (along[a] - along[b]) + (elevation[a] - elevation[b]) * (elevation[a] - elevation[b]));
                    if (Math.Abs(paper - fold) > 1e-6 * Math.Max(1, paper)) problems.Add($"A facet is distorted: {paper:0.######} vs {fold:0.######}.");
                }
                var match = seen.FindIndex(s => (s.P - raw.Paper[a]).Length < 1e-6);
                if (match < 0) seen.Add((raw.Paper[a], folded[a].T, folded[a].Z));
                else if (geometry.Distance(seen[match].T, folded[a].T) > 1e-6 || Math.Abs(seen[match].Z - folded[a].Z) > 1e-6)
                {
                    problems.Add($"The vertex ({raw.Paper[a].X:0.###}, {raw.Paper[a].Y:0.###}) folds to two places.");
                }
            }
            if (pleatHeight is double H)
            {
                Pleat(raw, edge, along, elevation, H, facets, pleats);
            }
            else
            {
                facets.Add(new Facet(raw.Paper, edge, along, elevation, elevation, raw.Depth));
            }
        }

        var messages = new List<string>
        {
            $"{report.Polygons.Count} polygon(s), {facets.Count} facets.",
        };
        if (problems.Count == 0) messages.Add("Self-check passed: every vertex folds to one point and every facet keeps its shape.");
        if (pleatHeight is double pleated)
        {
            messages.Add($"Pleated to {pleated:0.###} grid units with {pleats.Count} alternating valley and mountain folds " +
                $"(the base was {facets.SelectMany(f => f.Elevation).DefaultIfEmpty(0).Max():0.###} tall).");
        }

        // Sides shared by two polygons are built twice; keep one copy of each crease.
        var creases = new List<Crease>();
        foreach (var crease in builder.Creases.Concat(pleats))
        {
            bool duplicate = creases.Any(c =>
                ((c.A - crease.A).Length < 1e-7 && (c.B - crease.B).Length < 1e-7) ||
                ((c.A - crease.B).Length < 1e-7 && (c.B - crease.A).Length < 1e-7));
            if (!duplicate) creases.Add(crease);
        }

        return new CreasePatternResult
        {
            Built = true,
            Creases = creases,
            Facets = facets,
            EdgePaperLengths = lengths.Select(l => scale * l).ToArray(),
            MaxElevation = facets.SelectMany(f => f.Elevation).DefaultIfEmpty(0).Max(),
            PleatHeight = pleatHeight,
            FoldedHeight = facets.SelectMany(f => f.Height).DefaultIfEmpty(0).Max(),
            MaxDepth = facets.Select(f => f.Depth).DefaultIfEmpty(0).Max(),
            Problems = problems.Distinct().ToArray(),
            Messages = messages,
            Milliseconds = clock.Elapsed.TotalMilliseconds,
        };
    }

    private sealed record Band(Vec2 Origin, Vec2 U, Vec2 N, TreePoint From, TreePoint To, double Elevation);

    /// <summary>H − |(z mod 2H) − H|: the height of elevation z after pleating to height H.</summary>
    public static double PleatedHeight(double z, double h)
    {
        double r = z % (2 * h);
        if (r < 0) r += 2 * h;
        return h - Math.Abs(r - h);
    }

    /// <summary>Cuts a facet along the contours z = kH and records each contour as a valley or mountain.</summary>
    private static void Pleat(RawFacet raw, int edge, double[] along, double[] elevation, double h, List<Facet> facets, List<Crease> pleats)
    {
        int n = raw.Paper.Count;
        // Orientation: does the paper run along the tree edge in the same direction as along the band's side?
        var s = raw.Paper.Select(p => (p - raw.Band.Origin).Dot(raw.Band.U)).ToArray();
        int a = 0, b = 0;
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                if (Math.Abs(s[i] - s[j]) > Math.Abs(s[a] - s[b])) { a = i; b = j; }
        int orientation = (along[b] - along[a]) * (s[b] - s[a]) > 0 ? 1 : -1;

        var vertices = Enumerable.Range(0, n).Select(i => (P: raw.Paper[i], A: along[i], Z: elevation[i])).ToList();
        double zMin = elevation.Min(), zMax = elevation.Max();
        var levels = new List<double>();
        for (int k = (int)Math.Floor(zMin / h) + 1; k * h < zMax - 1e-9; k++)
        {
            if (k * h > zMin + 1e-9) levels.Add(k * h);
        }

        var bounds = new List<double?> { null };
        bounds.AddRange(levels.Select(z => (double?)z));
        bounds.Add(null);
        for (int t = 0; t + 1 < bounds.Count; t++)
        {
            var piece = vertices;
            if (bounds[t] is double lo) piece = ClipZ(piece, v => v.Z >= lo - 1e-12, lo);
            if (bounds[t + 1] is double hi && piece.Count > 0) piece = ClipZ(piece, v => v.Z <= hi + 1e-12, hi);
            piece = DedupeZ(piece);
            if (piece.Count < 3) continue;
            facets.Add(new Facet(piece.Select(v => v.P).ToArray(), edge, piece.Select(v => v.A).ToArray(),
                piece.Select(v => v.Z).ToArray(), piece.Select(v => PleatedHeight(v.Z, h)).ToArray(), raw.Depth));
        }
        foreach (double z0 in levels)
        {
            var on = ClipZ(vertices, v => v.Z >= z0 - 1e-12, z0).Where(v => Math.Abs(v.Z - z0) < 1e-9).ToList();
            if (on.Count < 2) continue;
            int k = (int)Math.Round(z0 / h);
            string assignment = orientation * (k % 2 == 0 ? 1 : -1) > 0 ? "V" : "M";
            pleats.Add(new Crease(on[0].P, on[^1].P, CreaseKind.Pleat, assignment));
        }
    }

    private static List<(Vec2 P, double A, double Z)> ClipZ(List<(Vec2 P, double A, double Z)> polygon,
        Func<(Vec2 P, double A, double Z), bool> keep, double level)
    {
        var result = new List<(Vec2 P, double A, double Z)>();
        for (int i = 0; i < polygon.Count; i++)
        {
            var p = polygon[i];
            var q = polygon[(i + 1) % polygon.Count];
            bool kp = keep(p), kq = keep(q);
            if (kp) result.Add(p);
            if (kp != kq)
            {
                double t = (level - p.Z) / (q.Z - p.Z);
                result.Add((p.P + t * (q.P - p.P), p.A + t * (q.A - p.A), level));
            }
        }
        return result;
    }

    private static List<(Vec2 P, double A, double Z)> DedupeZ(List<(Vec2 P, double A, double Z)> points)
    {
        var result = new List<(Vec2 P, double A, double Z)>();
        foreach (var p in points) if (result.Count == 0 || (p.P - result[^1].P).Length > 1e-10) result.Add(p);
        if (result.Count > 1 && (result[0].P - result[^1].P).Length <= 1e-10) result.RemoveAt(result.Count - 1);
        return result;
    }
    private sealed record RawFacet(IReadOnlyList<Vec2> Paper, Band Band, int Depth);

    private sealed class Molecules
    {
        private readonly TreeGeometry _tree;
        private readonly double _m;

        public Molecules(TreeGeometry tree, double scale)
        {
            _tree = tree;
            _m = scale;
        }

        public List<Crease> Creases { get; } = new();
        public List<RawFacet> RawFacets { get; } = new();
        public List<string> Notes { get; } = new();

        public (TreePoint T, double Z) Fold(Band band, Vec2 x)
        {
            var rel = x - band.Origin;
            double s = Math.Max(0, rel.Dot(band.U));
            return (_tree.Walk(band.From, band.To, s / _m), band.Elevation + rel.Dot(band.N));
        }

        public void Molecule(List<(Vec2 Pos, TreePoint Tree)> ring, List<CreaseKind> kinds, double elevation, int depth)
        {
            int n = ring.Count;
            if (depth > 64) { Notes.Add("Polygon splitting went too deep."); return; }
            var q = ring.Select(corner => corner.Pos).ToArray();
            var tau = ring.Select(corner => corner.Tree).ToArray();
            double size = Enumerable.Range(0, n).Max(i => (q[(i + 1) % n] - q[i]).Length);

            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double side = (q[j] - q[i]).Length;
                double path = _m * _tree.Distance(tau[i], tau[j]);
                if (Math.Abs(side - path) > 1e-6 * Math.Max(1, side)) Notes.Add($"A polygon side is not tight ({side:0.######} vs {path:0.######}).");
            }

            // Bisector speeds and cotangents of the half angles.
            var r = new Vec2[n];
            var c = new double[n];
            for (int i = 0; i < n; i++)
            {
                var toPrev = (q[(i - 1 + n) % n] - q[i]).Unit;
                var toNext = (q[(i + 1) % n] - q[i]).Unit;
                var normal = toNext.Perp;
                var sum = toPrev + toNext;
                var bisector = sum.Length < 1e-12 ? normal : sum.Unit;
                r[i] = bisector / bisector.Dot(normal);
                c[i] = r[i].Dot(toNext);
            }

            // The first event.
            double h = double.PositiveInfinity;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double w = c[i] + c[j];
                if (w > 1e-12) h = Math.Min(h, (q[j] - q[i]).Length / w);
            }
            for (int i = 0; i < n; i++)
            {
                for (int j = i + 2; j < n; j++)
                {
                    if (i == 0 && j == n - 1) continue;
                    double L = _m * _tree.Distance(tau[i], tau[j]);
                    var u = q[i] - q[j];
                    var v = r[i] - r[j];
                    double w = c[i] + c[j];
                    double a = v.Dot(v) - w * w, b = u.Dot(v) + L * w, cc = u.Dot(u) - L * L;
                    foreach (double h1 in Roots(a, b, cc))
                    {
                        if (h1 > 1e-9 * Math.Max(1, size) && L - h1 * w > -1e-9) h = Math.Min(h, h1);
                    }
                }
            }
            if (double.IsInfinity(h)) { Notes.Add("A polygon has no inset event."); return; }

            var p = Enumerable.Range(0, n).Select(i => q[i] + h * r[i]).ToArray();
            var tauInset = new TreePoint[n];
            for (int i = 0; i < n; i++)
            {
                var forward = _tree.Walk(tau[i], tau[(i + 1) % n], h * c[i] / _m);
                var backward = _tree.Walk(tau[i], tau[(i - 1 + n) % n], h * c[i] / _m);
                if (_tree.Distance(forward, backward) > 1e-6) Notes.Add("An inset corner maps to two tree points.");
                tauInset[i] = forward;
            }

            // Distinct inset corners, in ring order.
            var ids = new int[n];
            var distinct = new List<(Vec2 Pos, TreePoint Tree)>();
            for (int i = 0; i < n; i++)
            {
                int found = distinct.FindIndex(d => (d.Pos - p[i]).Length <= Tol * Math.Max(1, h));
                if (found < 0) { found = distinct.Count; distinct.Add((p[i], tauInset[i])); }
                ids[i] = found;
            }

            // Bands, hinges, sides and ridges.
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                double L = (q[j] - q[i]).Length;
                if (L < 1e-12) continue;
                var u = (q[j] - q[i]) / L;
                var nrm = u.Perp;
                var band = new Band(q[i], u, nrm, tau[i], tau[j], elevation);
                var local = Dedupe(new[] { q[i], q[j], p[j], p[i] }.Select(pt => new Vec2((pt - q[i]).Dot(u), (pt - q[i]).Dot(nrm))).ToList());
                var cuts = _tree.InnerNodes(tau[i], tau[j]).Select(d => _m * d).ToList();
                var bounds = new List<double?> { null };
                bounds.AddRange(cuts.Select(x => (double?)x));
                bounds.Add(null);
                for (int k = 0; k + 1 < bounds.Count; k++)
                {
                    var piece = ClipX(local, bounds[k], bounds[k + 1]);
                    if (piece.Count >= 3 && Math.Abs(TwiceArea(piece)) > 1e-12)
                    {
                        RawFacets.Add(new RawFacet(piece.Select(pt => q[i] + pt.X * u + pt.Y * nrm).ToArray(), band, depth));
                    }
                }
                foreach (double x in cuts)
                {
                    double top = TopAt(local, x);
                    if (top > 1e-12) Creases.Add(new Crease(q[i] + x * u, q[i] + x * u + top * nrm, CreaseKind.Hinge));
                }
                Creases.Add(new Crease(q[i], q[j], kinds[i]));
            }
            for (int i = 0; i < n; i++)
            {
                if ((p[i] - q[i]).Length > 1e-12) Creases.Add(new Crease(q[i], p[i], CreaseKind.Ridge));
            }

            if (distinct.Count == 1) return;
            if (distinct.Count == 2)
            {
                Creases.Add(new Crease(distinct[0].Pos, distinct[1].Pos, CreaseKind.Ridge));
                return;
            }

            var order = new List<int>();
            foreach (int k in ids) if (order.Count == 0 || order[^1] != k) order.Add(k);
            if (order.Count > 1 && order[0] == order[^1]) order.RemoveAt(order.Count - 1);
            var insetRing = order.Select(k => distinct[k].Pos).ToList();
            if (Math.Abs(TwiceArea(insetRing)) < 1e-9 * Math.Max(1, h * h))
            {
                for (int k = 0; k + 1 < order.Count; k++) Creases.Add(new Crease(distinct[order[k]].Pos, distinct[order[k + 1]].Pos, CreaseKind.Ridge));
                return;
            }

            // Split the inset polygon along its newly tight diagonals.
            var segments = new Dictionary<(int, int), CreaseKind>();
            int K = order.Count;
            for (int a = 0; a < K; a++) segments[Key(order[a], order[(a + 1) % K])] = CreaseKind.Flat;
            for (int a = 0; a < K; a++)
            {
                for (int b = a + 2; b < K; b++)
                {
                    if (a == 0 && b == K - 1) continue;
                    if (order[a] == order[b]) continue;   // a pinched ring meets itself at one inset node: not a diagonal
                    var A = distinct[order[a]];
                    var B = distinct[order[b]];
                    if (Math.Abs((A.Pos - B.Pos).Length - _m * _tree.Distance(A.Tree, B.Tree)) <= Tol * Math.Max(1, h))
                    {
                        segments[Key(order[a], order[b])] = CreaseKind.Gusset;
                    }
                }
            }
            foreach (var face in Faces(order.Distinct().ToDictionary(k => k, k => distinct[k].Pos), segments.Keys))
            {
                var subRing = face.Select(k => distinct[k]).ToList();
                var subKinds = Enumerable.Range(0, face.Count).Select(t => segments[Key(face[t], face[(t + 1) % face.Count])]).ToList();
                Molecule(subRing, subKinds, elevation + h, depth + 1);
            }
        }

        private static (int, int) Key(int a, int b) => a < b ? (a, b) : (b, a);
    }

    private static IEnumerable<double> Roots(double a, double b, double c)
    {
        // a h² + 2 b h + c = 0
        if (Math.Abs(a) < 1e-12)
        {
            if (Math.Abs(b) > 1e-12) yield return -c / (2 * b);
            yield break;
        }
        double disc = b * b - a * c;
        if (disc < -1e-12) yield break;
        double sq = Math.Sqrt(Math.Max(0, disc));
        yield return (-b + sq) / a;
        yield return (-b - sq) / a;
    }

    private static List<Vec2> Dedupe(List<Vec2> points)
    {
        var result = new List<Vec2>();
        foreach (var p in points) if (result.Count == 0 || (p - result[^1]).Length > 1e-10) result.Add(p);
        if (result.Count > 1 && (result[0] - result[^1]).Length <= 1e-10) result.RemoveAt(result.Count - 1);
        return result;
    }

    /// <summary>Clips a convex polygon to lo ≤ x ≤ hi (either bound may be absent).</summary>
    private static List<Vec2> ClipX(List<Vec2> polygon, double? lo, double? hi)
    {
        var p = polygon;
        if (lo is double l) p = Clip(p, a => a.X >= l - 1e-12, (a, b) => a + ((l - a.X) / (b.X - a.X)) * (b - a));
        if (hi is double h && p.Count > 0) p = Clip(p, a => a.X <= h + 1e-12, (a, b) => a + ((h - a.X) / (b.X - a.X)) * (b - a));
        return Dedupe(p);
    }

    private static List<Vec2> Clip(List<Vec2> p, Func<Vec2, bool> keep, Func<Vec2, Vec2, Vec2> cut)
    {
        var result = new List<Vec2>();
        for (int i = 0; i < p.Count; i++)
        {
            var a = p[i];
            var b = p[(i + 1) % p.Count];
            bool ka = keep(a), kb = keep(b);
            if (ka) result.Add(a);
            if (ka != kb) result.Add(cut(a, b));
        }
        return result;
    }

    /// <summary>The highest point of a convex polygon above the vertical line at x.</summary>
    private static double TopAt(List<Vec2> polygon, double x)
    {
        double top = 0;
        for (int i = 0; i < polygon.Count; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Count];
            if ((a.X - x) * (b.X - x) <= 0 && Math.Abs(b.X - a.X) > 1e-12)
            {
                top = Math.Max(top, a.Y + (x - a.X) / (b.X - a.X) * (b.Y - a.Y));
            }
            else if (Math.Abs(a.X - x) <= 1e-12)
            {
                top = Math.Max(top, a.Y);
            }
        }
        return top;
    }

    private static double TwiceArea(IReadOnlyList<Vec2> p)
    {
        double s = 0;
        for (int i = 0; i < p.Count; i++)
        {
            var a = p[i];
            var b = p[(i + 1) % p.Count];
            s += a.X * b.Y - b.X * a.Y;
        }
        return s;
    }

    /// <summary>Bounded faces of a plane graph, counter-clockwise.</summary>
    private static List<List<int>> Faces(Dictionary<int, Vec2> points, IEnumerable<(int, int)> segments)
    {
        var neighbours = points.Keys.ToDictionary(k => k, _ => new List<int>());
        foreach (var (a, b) in segments)
        {
            neighbours[a].Add(b);
            neighbours[b].Add(a);
        }
        foreach (var (v, list) in neighbours)
        {
            var o = points[v];
            list.Sort((x, y) => Math.Atan2(points[x].Y - o.Y, points[x].X - o.X).CompareTo(Math.Atan2(points[y].Y - o.Y, points[y].X - o.X)));
        }
        var seen = new HashSet<(int, int)>();
        var faces = new List<List<int>>();
        foreach (var start in neighbours.Keys)
        {
            foreach (var next in neighbours[start])
            {
                if (seen.Contains((start, next))) continue;
                var cycle = new List<int>();
                int u = start, v = next;
                while (seen.Add((u, v)))
                {
                    cycle.Add(u);
                    var around = neighbours[v];
                    int at = around.IndexOf(u);
                    int w = around[(at - 1 + around.Count) % around.Count];
                    (u, v) = (v, w);
                }
                if (TwiceArea(cycle.Select(k => points[k]).ToList()) > 1e-12) faces.Add(cycle);
            }
        }
        return faces;
    }
}

/// <summary>Distances and walks between points of a tree whose edges have the given lengths.</summary>
public sealed class TreeGeometry
{
    private readonly Tree _tree;
    private readonly double[] _length;
    private readonly double[,] _dist;
    private readonly int[,] _via;      // _via[a, b] = edge leaving a on the path to b

    public TreeGeometry(Tree tree, IReadOnlyList<double> lengths)
    {
        _tree = tree;
        _length = lengths.ToArray();
        int n = tree.VertexCount;
        _dist = new double[n, n];
        _via = new int[n, n];
        var adjacency = Enumerable.Range(0, n).Select(_ => new List<(int To, int Edge)>()).ToArray();
        foreach (var e in tree.Edges)
        {
            adjacency[e.U].Add((e.V, e.Index));
            adjacency[e.V].Add((e.U, e.Index));
        }
        for (int s = 0; s < n; s++)
        {
            var seen = new bool[n];
            var stack = new Stack<int>();
            seen[s] = true;
            _via[s, s] = -1;
            stack.Push(s);
            while (stack.Count > 0)
            {
                int x = stack.Pop();
                foreach (var (y, k) in adjacency[x])
                {
                    if (seen[y]) continue;
                    seen[y] = true;
                    _dist[s, y] = _dist[s, x] + _length[k];
                    _via[s, y] = x == s ? k : _via[s, x];
                    stack.Push(y);
                }
            }
        }
    }

    public TreePoint Normalize(TreePoint p)
    {
        if (p.IsNode) return p;
        var e = _tree.Edges[p.Edge];
        double tol = 1e-9 * Math.Max(1, _length[p.Edge]);
        if (p.Offset <= tol) return TreePoint.AtNode(e.U);
        if (p.Offset >= _length[p.Edge] - tol) return TreePoint.AtNode(e.V);
        return p;
    }

    private IEnumerable<(int Node, double D)> Exits(TreePoint p)
    {
        if (p.IsNode) { yield return (p.Node, 0); yield break; }
        var e = _tree.Edges[p.Edge];
        yield return (e.U, p.Offset);
        yield return (e.V, _length[p.Edge] - p.Offset);
    }

    public double Distance(TreePoint p, TreePoint q)
    {
        p = Normalize(p);
        q = Normalize(q);
        if (!p.IsNode && !q.IsNode && p.Edge == q.Edge) return Math.Abs(p.Offset - q.Offset);
        double best = double.PositiveInfinity;
        foreach (var (a, da) in Exits(p))
            foreach (var (b, db) in Exits(q))
                best = Math.Min(best, da + _dist[a, b] + db);
        return best;
    }

    /// <summary>The path from p to q as (edge, from offset, to offset) pieces.</summary>
    public List<(int Edge, double From, double To)> Path(TreePoint p, TreePoint q)
    {
        p = Normalize(p);
        q = Normalize(q);
        var pieces = new List<(int, double, double)>();
        if (p == q) return pieces;
        if (!p.IsNode && !q.IsNode && p.Edge == q.Edge)
        {
            pieces.Add((p.Edge, p.Offset, q.Offset));
            return pieces;
        }
        (double Total, int A, int B) best = (double.PositiveInfinity, -1, -1);
        foreach (var (a, da) in Exits(p))
            foreach (var (b, db) in Exits(q))
                if (da + _dist[a, b] + db < best.Total - 1e-12) best = (da + _dist[a, b] + db, a, b);
        if (!p.IsNode)
        {
            var e = _tree.Edges[p.Edge];
            pieces.Add((p.Edge, p.Offset, best.A == e.U ? 0 : _length[p.Edge]));
        }
        int x = best.A;
        while (x != best.B)
        {
            int k = _via[x, best.B];
            var e = _tree.Edges[k];
            int y = e.U == x ? e.V : e.U;
            pieces.Add(e.U == x ? (k, 0, _length[k]) : (k, _length[k], 0));
            x = y;
        }
        if (!q.IsNode)
        {
            var e = _tree.Edges[q.Edge];
            pieces.Add((q.Edge, best.B == e.U ? 0 : _length[q.Edge], q.Offset));
        }
        return pieces.Where(pc => Math.Abs(pc.Item3 - pc.Item2) > 1e-12).ToList();
    }

    /// <summary>The point at tree distance s from p toward q.</summary>
    public TreePoint Walk(TreePoint p, TreePoint q, double s)
    {
        if (s <= 0) return Normalize(p);
        foreach (var (k, a, b) in Path(p, q))
        {
            double seg = Math.Abs(b - a);
            if (s <= seg + 1e-12)
            {
                double t = a + (b > a ? s : -s);
                return Normalize(TreePoint.OnEdge(k, Math.Clamp(t, 0, _length[k])));
            }
            s -= seg;
        }
        return Normalize(q);
    }

    /// <summary>Distances from p of the tree nodes strictly between p and q.</summary>
    public List<double> InnerNodes(TreePoint p, TreePoint q)
    {
        var result = new List<double>();
        double total = Distance(p, q), acc = 0;
        foreach (var (_, a, b) in Path(p, q))
        {
            acc += Math.Abs(b - a);
            if (Math.Abs(acc - total) > 1e-9) result.Add(acc);
        }
        return result;
    }

    /// <summary>How far p lies along edge k from its first node (tree units), or null when p is not on edge k.</summary>
    public double? PositionOnEdge(TreePoint p, int k)
    {
        p = Normalize(p);
        var e = _tree.Edges[k];
        if (p.IsNode) return p.Node == e.U ? 0 : p.Node == e.V ? _length[k] : null;
        return p.Edge == k ? p.Offset : null;
    }
}
