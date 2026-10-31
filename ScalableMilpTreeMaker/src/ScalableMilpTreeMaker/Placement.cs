using PureMilpTreeMaker;

namespace ScalableMilpTreeMaker;

/// <summary>Grid helpers shared by the stages: leaf conditions, spacing limits, exact scales and candidate scales.</summary>
public static class Placement
{
    /// <summary>
    /// The largest squared distance that is too close for a pair whose required distance is <paramref name="radius"/>:
    /// a grid offset (dx, dy) collides when dx² + dy² ≤ this. Exactly-on-the-circle offsets are allowed (tight).
    /// </summary>
    public static long ForbiddenLimit(double radius)
    {
        double r2 = radius * radius;
        double near = Math.Round(r2);
        if (Math.Abs(r2 - near) <= 1e-9 * Math.Max(1, r2))
        {
            return Math.Max(0, (long)near - 1);
        }
        return Math.Max(0, (long)Math.Floor(r2));
    }

    /// <summary>True when a pair at squared distance <paramref name="d2"/> is exactly at its required distance.</summary>
    public static bool IsTight(long d2, double radius) =>
        Math.Abs(d2 - radius * radius) <= 1e-9 * Math.Max(1, radius * radius);

    /// <summary>The leaf conditions by vertex id, and the mirror partner of each mirrored leaf.</summary>
    public sealed class Conditions
    {
        private readonly Dictionary<int, LeafCondition> _byVertex = new();
        private readonly int _n;

        public Conditions(ProblemSpec spec)
        {
            _n = spec.GridSize;
            foreach (var c in spec.LeafConditions)
            {
                _byVertex[spec.Tree.Id(c.Leaf)] = c;
            }
            foreach (var m in spec.MirrorPairs)
            {
                int a = spec.Tree.Id(m.A), b = spec.Tree.Id(m.B);
                Mirrors.Add((a, b));
            }
        }

        /// <summary>Mirror pairs (book symmetry: x_a + x_b = N, y_a = y_b), by vertex id.</summary>
        public List<(int A, int B)> Mirrors { get; } = new();

        /// <summary>Whether leaf <paramref name="vertex"/> may sit at grid point (x, y).</summary>
        public bool Allows(int vertex, int x, int y)
        {
            if (x < 0 || y < 0 || x > _n || y > _n) return false;
            if (!_byVertex.TryGetValue(vertex, out var c)) return true;
            return c.Kind switch
            {
                LeafConditionKind.LeftEdge => x == 0,
                LeafConditionKind.RightEdge => x == _n,
                LeafConditionKind.BottomEdge => y == 0,
                LeafConditionKind.TopEdge => y == _n,
                LeafConditionKind.BottomLeftCorner => x == 0 && y == 0,
                LeafConditionKind.BottomRightCorner => x == _n && y == 0,
                LeafConditionKind.TopLeftCorner => x == 0 && y == _n,
                LeafConditionKind.TopRightCorner => x == _n && y == _n,
                LeafConditionKind.OnSymmetryAxis => 2 * x == _n,
                LeafConditionKind.Fixed => x == c.X && y == c.Y,
                _ => true,
            };
        }

        /// <summary>Box bounds [x0, x1] × [y0, y1] for the continuous stage.</summary>
        public (double X0, double X1, double Y0, double Y1) Box(int vertex)
        {
            double n = _n;
            if (!_byVertex.TryGetValue(vertex, out var c)) return (0, n, 0, n);
            return c.Kind switch
            {
                LeafConditionKind.LeftEdge => (0, 0, 0, n),
                LeafConditionKind.RightEdge => (n, n, 0, n),
                LeafConditionKind.BottomEdge => (0, n, 0, 0),
                LeafConditionKind.TopEdge => (0, n, n, n),
                LeafConditionKind.BottomLeftCorner => (0, 0, 0, 0),
                LeafConditionKind.BottomRightCorner => (n, n, 0, 0),
                LeafConditionKind.TopLeftCorner => (0, 0, n, n),
                LeafConditionKind.TopRightCorner => (n, n, n, n),
                LeafConditionKind.OnSymmetryAxis => (n / 2, n / 2, 0, n),
                LeafConditionKind.Fixed => (c.X!.Value, c.X!.Value, c.Y!.Value, c.Y!.Value),
                _ => (0, n, 0, n),
            };
        }

        /// <summary>The grid point nearest (x, y) that this leaf may use.</summary>
        public (int X, int Y) Nearest(int vertex, double x, double y)
        {
            var (x0, x1, y0, y1) = Box(vertex);
            int rx = (int)Math.Round(Math.Clamp(x, x0, x1)), ry = (int)Math.Round(Math.Clamp(y, y0, y1));
            if (Allows(vertex, rx, ry)) return (rx, ry);
            // Only odd N with an axis condition could get here, and Validate forbids that; search outward anyway.
            for (int r = 1; r <= _n; r++)
                for (int dx = -r; dx <= r; dx++)
                    for (int dy = -r; dy <= r; dy++)
                        if (Allows(vertex, rx + dx, ry + dy)) return (rx + dx, ry + dy);
            return (rx, ry);
        }
    }

    /// <summary>The exact scale of a grid layout (by vertex id), with optional edge lengths.</summary>
    public static double ExactScale(Definitions definitions, IReadOnlyDictionary<int, (int X, int Y)> layout)
    {
        double best = double.PositiveInfinity;
        foreach (var pair in definitions.Tree.Pairs)
        {
            var (xi, yi) = layout[pair.I];
            var (xj, yj) = layout[pair.J];
            best = Math.Min(best, Math.Sqrt((double)(xi - xj) * (xi - xj) + (double)(yi - yj) * (yi - yj)) / definitions.PathLength(pair));
        }
        return best;
    }

    /// <summary>Leaves (vertex ids) in some pair that is too close at <paramref name="scale"/>.</summary>
    public static HashSet<int> Colliding(Definitions definitions, IReadOnlyDictionary<int, (int X, int Y)> layout, double scale)
    {
        var bad = new HashSet<int>();
        foreach (var pair in definitions.Tree.Pairs)
        {
            var (xi, yi) = layout[pair.I];
            var (xj, yj) = layout[pair.J];
            long d2 = (long)(xi - xj) * (xi - xj) + (long)(yi - yj) * (yi - yj);
            if (d2 <= ForbiddenLimit(scale * definitions.PathLength(pair)))
            {
                bad.Add(pair.I);
                bad.Add(pair.J);
            }
        }
        return bad;
    }

    /// <summary>
    /// Every candidate scale √s / ℓ in [lo, hi]: s a squared grid length (dx² + dy², 0 ≤ dx, dy ≤ N) and ℓ a path
    /// length. The optimum on the grid is always one of these, because some pair is tight there.
    /// </summary>
    public static List<double> Candidates(Definitions definitions, double lo, double hi)
    {
        int n = definitions.GridSize;
        var squares = new SortedSet<long>();
        for (long x = 0; x <= n; x++)
            for (long y = x; y <= n; y++)
                if (x + y > 0) squares.Add(x * x + y * y);
        var sorted = squares.ToArray();
        var lengths = definitions.Tree.Pairs.Select(definitions.PathLength).Distinct().ToArray();
        var output = new List<double>();
        foreach (double l in lengths)
        {
            double s0 = lo * l * lo * l, s1 = hi * l * hi * l;
            int k = Array.BinarySearch(sorted, (long)Math.Floor(s0));
            if (k < 0) k = ~k;
            for (; k < sorted.Length && sorted[k] <= s1 + 1e-9; k++)
            {
                double c = Math.Sqrt(sorted[k]) / l;
                if (c >= lo * (1 - 1e-12) && c <= hi * (1 + 1e-12)) output.Add(c);
            }
        }
        output.Sort();
        // Merge values equal to rounding.
        var merged = new List<double>(output.Count);
        foreach (double c in output)
        {
            if (merged.Count == 0 || c > merged[^1] * (1 + 1e-12)) merged.Add(c);
        }
        return merged;
    }

    /// <summary>The tree's leaves in depth-first order from the first leaf (the order TreeMaker puts round the border).</summary>
    public static List<int> DepthFirstLeaves(Tree tree)
    {
        var adjacency = new Dictionary<int, List<int>>();
        foreach (var e in tree.Edges)
        {
            (adjacency.TryGetValue(e.U, out var a) ? a : adjacency[e.U] = new()).Add(e.V);
            (adjacency.TryGetValue(e.V, out var b) ? b : adjacency[e.V] = new()).Add(e.U);
        }
        var order = new List<int>();
        var seen = new HashSet<int>();
        var stack = new Stack<int>();
        stack.Push(tree.Leaves[0]);
        while (stack.Count > 0)
        {
            int v = stack.Pop();
            if (!seen.Add(v)) continue;
            if (tree.IsLeaf(v)) order.Add(v);
            for (int k = adjacency[v].Count - 1; k >= 0; k--)
            {
                if (!seen.Contains(adjacency[v][k])) stack.Push(adjacency[v][k]);
            }
        }
        return order;
    }
}
