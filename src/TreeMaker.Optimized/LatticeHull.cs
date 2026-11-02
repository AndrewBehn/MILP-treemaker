using TreeMaker.Core;

namespace TreeMaker.Optimized;

/// <summary>A lattice point, used for grid offsets δ = uᵢ − uⱼ.</summary>
public readonly record struct Point(int X, int Y)
{
    public long SquaredLength => (long)X * X + (long)Y * Y;
}

/// <summary>
/// One side of a convex lattice polygon, the half-plane aᵀδ ≤ b with a ∈ ℤ², gcd(a₁, a₂) = 1, b ∈ ℤ (hulls D:1).
/// </summary>
public readonly record struct Facet(int A1, int A2, long B)
{
    /// <summary>‖a‖₁.</summary>
    public long L1 => Math.Abs((long)A1) + Math.Abs((long)A2);

    public long Dot(int dx, int dy) => (long)A1 * dx + (long)A2 * dy;

    /// <summary>True when a lattice offset lies strictly beyond this facet, i.e. aᵀδ ≥ b + 1.</summary>
    public bool IsBeyond(int dx, int dy) => Dot(dx, dy) >= B + 1;

    /// <summary>True when some offset in {−N, …, N}² lies strictly beyond this facet (a crossable facet).</summary>
    public bool IsCrossable(int gridSize) => L1 * gridSize > B;
}

/// <summary>
/// Forbidden offsets F(r) and their lattice hull P(r) = conv F(r) (hulls D:1).
/// </summary>
public static class LatticeHull
{
    private static readonly (int X, int Y)[] Directions =
    {
        (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1),
    };

    /// <summary>
    /// The largest squared length that is still too short at radius <paramref name="radius"/>: an offset δ is
    /// forbidden (‖δ‖₂ &lt; r) exactly when δ₁² + δ₂² ≤ this limit. Radii that are square roots of integers, which is
    /// what every candidate scale produces for its tight pair, are recognized despite rounding, so the tight offset
    /// itself is allowed.
    /// </summary>
    public static long ForbiddenLimit(double radius)
    {
        double r2 = radius * radius;
        double nearest = Math.Round(r2);
        if (Math.Abs(r2 - nearest) <= 1e-9 * Math.Max(1, r2))
        {
            return Math.Max(0, (long)nearest - 1);
        }
        return Math.Max(0, (long)Math.Floor(r2));
    }

    /// <summary>F(r) for the limit of <see cref="ForbiddenLimit"/>: the offsets in {−N, …, N}² with squared length ≤ limit.</summary>
    public static List<Point> ForbiddenPoints(long limit, int gridSize)
    {
        var points = new List<Point>();
        int reach = (int)Math.Min(gridSize, Math.Floor(Math.Sqrt(limit)) + 1);
        for (int x = -reach; x <= reach; x++)
        {
            for (int y = -reach; y <= reach; y++)
            {
                if ((long)x * x + (long)y * y <= limit && Math.Abs(x) <= gridSize && Math.Abs(y) <= gridSize)
                {
                    points.Add(new Point(x, y));
                }
            }
        }
        return points;
    }

    /// <summary>Is the offset forbidden at this limit?</summary>
    public static bool IsForbidden(int dx, int dy, long limit) => (long)dx * dx + (long)dy * dy <= limit;

    /// <summary>
    /// The facets of conv(<paramref name="points"/>), each with integer coefficients. A hull of fewer than three
    /// vertices (only the origin) is described by its bounding box.
    /// </summary>
    public static List<Facet> Facets(IEnumerable<Point> points)
    {
        var sorted = points.Distinct().OrderBy(p => p.X).ThenBy(p => p.Y).ToList();
        if (sorted.Count == 0)
        {
            throw new ArgumentException("A hull needs at least one point.");
        }

        var vertices = ConvexHull(sorted);
        if (vertices.Count < 3)
        {
            int minX = sorted.Min(p => p.X), maxX = sorted.Max(p => p.X);
            int minY = sorted.Min(p => p.Y), maxY = sorted.Max(p => p.Y);
            return new List<Facet> { new(1, 0, maxX), new(-1, 0, -minX), new(0, 1, maxY), new(0, -1, -minY) };
        }

        var facets = new List<Facet>(vertices.Count);
        for (int k = 0; k < vertices.Count; k++)
        {
            var p = vertices[k];
            var q = vertices[(k + 1) % vertices.Count];
            int dx = q.X - p.X, dy = q.Y - p.Y;
            int g = Gcd(Math.Abs(dx), Math.Abs(dy));
            // Vertices are counter-clockwise, so (dy, −dx) points outward.
            int a1 = dy / g, a2 = -dx / g;
            facets.Add(new Facet(a1, a2, (long)a1 * p.X + (long)a2 * p.Y));
        }
        return facets;
    }

    /// <summary>The crossable facets of P(r) on the N × N sheet, K(r) of hulls D:1.</summary>
    public static List<Facet> CrossableFacets(long limit, int gridSize) =>
        Facets(ForbiddenPoints(limit, gridSize)).Where(f => f.IsCrossable(gridSize)).ToList();

    /// <summary>The vertices of conv(points), counter-clockwise, without collinear points (Andrew's monotone chain).</summary>
    public static List<Point> ConvexHull(IReadOnlyList<Point> sortedDistinct)
    {
        if (sortedDistinct.Count < 3)
        {
            return sortedDistinct.ToList();
        }
        var lower = new List<Point>();
        foreach (var p in sortedDistinct)
        {
            while (lower.Count >= 2 && Cross(lower[^2], lower[^1], p) <= 0) lower.RemoveAt(lower.Count - 1);
            lower.Add(p);
        }
        var upper = new List<Point>();
        for (int k = sortedDistinct.Count - 1; k >= 0; k--)
        {
            var p = sortedDistinct[k];
            while (upper.Count >= 2 && Cross(upper[^2], upper[^1], p) <= 0) upper.RemoveAt(upper.Count - 1);
            upper.Add(p);
        }
        lower.RemoveAt(lower.Count - 1);
        upper.RemoveAt(upper.Count - 1);
        lower.AddRange(upper);
        return lower;
    }

    /// <summary>
    /// The starting inner-polygon points of lattice-hull Section 8.5 (hulls P:2): the origin and the forbidden points farthest along the
    /// four axis and four diagonal directions, so the inner polygon has at most 8 facets.
    /// </summary>
    public static List<Point> StartingPoints(long limit, int gridSize)
    {
        var forbidden = ForbiddenPoints(limit, gridSize);
        var chosen = new HashSet<Point> { new(0, 0) };
        foreach (var (ux, uy) in Directions)
        {
            Point best = new(0, 0);
            long bestDot = long.MinValue, bestOff = long.MaxValue;
            foreach (var p in forbidden)
            {
                long dot = (long)ux * p.X + (long)uy * p.Y;
                long off = Math.Abs((long)uy * p.X - (long)ux * p.Y);   // distance from the direction's line, scaled
                if (dot > bestDot || (dot == bestDot && off < bestOff))
                {
                    best = p;
                    bestDot = dot;
                    bestOff = off;
                }
            }
            chosen.Add(best);
        }
        return chosen.ToList();
    }

    /// <summary>The 8 images of an offset under the symmetries of the square.</summary>
    public static IEnumerable<Point> Images(int dx, int dy)
    {
        yield return new(dx, dy);
        yield return new(-dx, dy);
        yield return new(dx, -dy);
        yield return new(-dx, -dy);
        yield return new(dy, dx);
        yield return new(-dy, dx);
        yield return new(dy, -dx);
        yield return new(-dy, -dx);
    }

    private static long Cross(Point o, Point a, Point b) =>
        (long)(a.X - o.X) * (b.Y - o.Y) - (long)(a.Y - o.Y) * (b.X - o.X);

    private static int Gcd(int a, int b)
    {
        while (b != 0) (a, b) = (b, a % b);
        return a == 0 ? 1 : a;
    }
}

/// <summary>Caches K(r) by forbidden limit, since many pairs and trial scales share a hull (lattice-hull Section 10).</summary>
public sealed class HullCache
{
    private readonly Dictionary<long, IReadOnlyList<Facet>> _facets = new();
    private readonly Dictionary<long, IReadOnlyList<Point>> _starting = new();

    public HullCache(int gridSize) => GridSize = gridSize;

    public int GridSize { get; }

    public IReadOnlyList<Facet> Crossable(long limit)
    {
        if (!_facets.TryGetValue(limit, out var facets))
        {
            facets = LatticeHull.CrossableFacets(limit, GridSize);
            _facets[limit] = facets;
        }
        return facets;
    }

    public IReadOnlyList<Point> Starting(long limit)
    {
        if (!_starting.TryGetValue(limit, out var points))
        {
            points = LatticeHull.StartingPoints(limit, GridSize);
            _starting[limit] = points;
        }
        return points;
    }

    /// <summary>The hull's vertices for display.</summary>
    public IReadOnlyList<Point> Vertices(long limit)
    {
        var sorted = LatticeHull.ForbiddenPoints(limit, GridSize).Distinct()
            .OrderBy(p => p.X).ThenBy(p => p.Y).ToList();
        return LatticeHull.ConvexHull(sorted);
    }
}
