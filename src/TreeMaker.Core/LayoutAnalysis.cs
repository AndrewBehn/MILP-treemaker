namespace TreeMaker.Core;

/// <summary>
/// Independent checks and reports computed from a layout alone, with exact Euclidean distances and no
/// solver values: the pair spacing table, the exact scale of a layout, and constraint violations.
/// </summary>
public static class LayoutAnalysis
{
    /// <summary>Relative tolerance for treating a pair as tight or a constraint as met.</summary>
    public const double Tolerance = 1e-6;

    /// <summary>
    /// Relative tolerance for reporting a spacing violation. It is looser than <see cref="Tolerance"/> because
    /// SCIP meets rows to a relative feasibility tolerance of about 1e-6, and σ comes back as a float.
    /// </summary>
    public const double ViolationTolerance = 1e-5;

    /// <summary>The largest scale at which <paramref name="layout"/> satisfies every pair: min D(δᵢⱼ)/ℓᵢⱼ (Section 8).</summary>
    public static double ExactScale(Definitions definitions, IReadOnlyList<LeafPlacement> layout,
        IReadOnlyList<double>? edgeLengths = null) =>
        ExactScale(definitions, Positions(layout), edgeLengths);

    /// <summary>The same, for a layout given as grid points by vertex id (the scalable pipeline's working form).</summary>
    public static double ExactScale(Definitions definitions, IReadOnlyDictionary<int, (int X, int Y)> position,
        IReadOnlyList<double>? edgeLengths = null)
    {
        double best = double.PositiveInfinity;
        foreach (var pair in definitions.Tree.Pairs)
        {
            double d = Distance(position[pair.I], position[pair.J]);
            best = Math.Min(best, d / EffectiveLength(definitions, pair, edgeLengths));
        }
        return best;
    }

    /// <summary>Per-pair spacing at scale <paramref name="scale"/>, with edges at <paramref name="edgeLengths"/> (input lengths when null).</summary>
    public static IReadOnlyList<PairReport> Pairs(Definitions definitions, IReadOnlyList<LeafPlacement> layout,
        double scale, IReadOnlyList<double>? edgeLengths = null)
    {
        var tree = definitions.Tree;
        var position = Positions(layout);
        var reports = new List<PairReport>(tree.Pairs.Count);
        foreach (var pair in tree.Pairs)
        {
            var (xi, yi) = position[pair.I];
            var (xj, yj) = position[pair.J];
            double length = EffectiveLength(definitions, pair, edgeLengths);
            double d = Distance((xi, yi), (xj, yj));
            double required = scale * length;
            double slack = d - required;
            reports.Add(new PairReport(
                tree.Name(pair.I), tree.Name(pair.J), definitions.PathLength(pair), length,
                xi - xj, yi - yj, d, required, slack, Math.Abs(slack) <= Tolerance * Math.Max(1, d)));
        }
        return reports;
    }

    /// <summary>
    /// Checks a layout against C:1 (grid points), distinct positions, the spacing rows at the given scale and
    /// edge lengths, and the optional position conditions. Returns an empty list when everything holds.
    /// </summary>
    public static IReadOnlyList<string> Violations(ProblemSpec spec, IReadOnlyList<LeafPlacement> layout,
        double scale, IReadOnlyList<double>? edgeLengths = null)
    {
        var tree = spec.Tree;
        int n = spec.GridSize;
        var issues = new List<string>();
        var position = new Dictionary<int, (int X, int Y)>();

        foreach (var p in layout)
        {
            if (p.X < 0 || p.Y < 0 || p.X > n || p.Y > n)
            {
                issues.Add($"Leaf {p.Leaf} at ({p.X}, {p.Y}) is off the {n} × {n} grid.");
            }
            position[p.Vertex] = (p.X, p.Y);
        }
        foreach (int leaf in tree.Leaves)
        {
            if (!position.ContainsKey(leaf))
            {
                issues.Add($"Leaf {tree.Name(leaf)} has no position.");
            }
        }
        if (issues.Count > 0)
        {
            return issues;
        }

        var definitions = new Definitions(tree, n);
        foreach (var r in Pairs(definitions, layout, scale, edgeLengths))
        {
            if (r.Dx == 0 && r.Dy == 0)
            {
                issues.Add($"Leaves {r.A} and {r.B} share a grid point.");
            }
            else if (r.Slack < -ViolationTolerance * Math.Max(1, r.Distance))
            {
                issues.Add($"Pair {r.A}–{r.B} is {r.Distance:0.####} apart but needs {r.Required:0.####}.");
            }
        }

        foreach (var c in spec.LeafConditions)
        {
            var (x, y) = position[tree.Id(c.Leaf)];
            bool ok = c.Kind switch
            {
                LeafConditionKind.LeftEdge => x == 0,
                LeafConditionKind.RightEdge => x == n,
                LeafConditionKind.BottomEdge => y == 0,
                LeafConditionKind.TopEdge => y == n,
                LeafConditionKind.BottomLeftCorner => x == 0 && y == 0,
                LeafConditionKind.BottomRightCorner => x == n && y == 0,
                LeafConditionKind.TopLeftCorner => x == 0 && y == n,
                LeafConditionKind.TopRightCorner => x == n && y == n,
                LeafConditionKind.OnSymmetryAxis => 2 * x == n,
                LeafConditionKind.Fixed => x == c.X && y == c.Y,
                _ => true,
            };
            if (!ok)
            {
                issues.Add($"Leaf {c.Leaf} at ({x}, {y}) breaks its {c.Kind} condition.");
            }
        }

        foreach (var m in spec.MirrorPairs)
        {
            var a = position[tree.Id(m.A)];
            var b = position[tree.Id(m.B)];
            if (a.X + b.X != n || a.Y != b.Y)
            {
                issues.Add($"Leaves {m.A} and {m.B} are not mirrored about x = N/2.");
            }
        }

        return issues;
    }

    private static double EffectiveLength(Definitions definitions, LeafPair pair, IReadOnlyList<double>? edgeLengths) =>
        edgeLengths is null
            ? definitions.PathLength(pair)
            : definitions.Tree.PathEdges(pair.I, pair.J).Sum(e => edgeLengths[e]);

    private static Dictionary<int, (int X, int Y)> Positions(IReadOnlyList<LeafPlacement> layout) =>
        layout.ToDictionary(p => p.Vertex, p => (p.X, p.Y));

    private static double Distance((int X, int Y) a, (int X, int Y) b)
    {
        double dx = a.X - b.X;
        double dy = a.Y - b.Y;
        return Math.Sqrt(dx * dx + dy * dy);
    }
}
