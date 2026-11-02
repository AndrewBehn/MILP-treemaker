using System.Diagnostics;
using Google.OrTools.LinearSolver;

namespace TreeMaker.Core;

/// <summary>What the strain LPs found (see <see cref="StrainNeeded"/>).</summary>
public sealed record StrainNeededResult
{
    public bool AlreadyValid { get; init; }

    /// <summary>The smallest s that makes every boundary pair tight; null when no strain does, so no strain can close the polygons.</summary>
    public double? BoundaryStrain { get; init; }

    /// <summary>Whether the polygons are valid at the boundary LP's strains; then <see cref="BoundaryStrain"/> is the strain needed.</summary>
    public bool BoundaryValid { get; init; }

    /// <summary>The smallest s that makes every triangulation pair tight (always valid polygons); null when none does.</summary>
    public double? TriangulationStrain { get; init; }

    /// <summary>When <see cref="BoundaryValid"/>: the pairs tight at the boundary LP's strains. Closing with exactly these
    /// as targets reproduces its valid polygons (the closing MILP left to choose its own targets may not).</summary>
    public IReadOnlyList<LeafPairName> TightTargets { get; init; } = Array.Empty<LeafPairName>();
    public int Solves { get; init; }
    public double Milliseconds { get; init; }
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
}

/// <summary>
/// A:3 of the Polygon Closing TreeMaker spec (model LP(K), rows M:5–M:8); the search around it is that spec's A:4,
/// run by the page (polygons.js, findStrain).
/// "Find the strain needed", as linear programs. With the leaves and the scale m₀ fixed, the smallest bound s that lets
/// strains σₑ make a set T of pairs exactly tight, while every other pair still fits, is the LP
///     minimize s   subject to   m₀(ℓᵢⱼ + Σ ℓₑσₑ) = D   for (i, j) ∈ T,
///                               m₀(ℓᵢⱼ + Σ ℓₑσₑ) ≤ D   for every other pair,
///                               −rₑs ≤ σₑ ≤ rₑs,  σₑ ≥ −0.99,
/// where rₑ is edge e's room (D:7; 1 for every edge by default, 0 for a locked edge), so s is the bound on an edge with
/// room 1.
/// Valid polygons need every pair on the hull's boundary tight, so the first LP, with T = the boundary pairs, gives a
/// lower bound on the strain needed, and proves at once that no strain helps when it is infeasible. If the polygons are
/// valid at its solution, that bound is the answer. Otherwise the second LP, with T = the whole triangulation (all
/// faces triangles, so always valid), gives an upper bound when it is feasible. The UI then searches between the two
/// with the closing MILP (<see cref="PolygonCompletion"/>), which may close the polygons with fewer tight pairs.
/// </summary>
public static class StrainNeeded
{
    public static StrainNeededResult Find(ProblemSpec spec, IReadOnlyList<LeafPlacement> layout, double scale,
        IReadOnlyList<double>? startLengths = null, CancellationToken token = default, EdgeStrain? edgeStrain = null)
    {
        var room = edgeStrain ?? EdgeStrain.Uniform;
        ArgumentNullException.ThrowIfNull(spec);
        if (!(scale > 0)) throw new ArgumentException("The scale must be positive.");
        var clock = Stopwatch.StartNew();
        var tree = spec.Tree;
        var defs = new Definitions(tree, spec.GridSize);
        var lengths = (startLengths ?? tree.Edges.Select(e => e.Length).ToArray()).ToArray();
        if (lengths.Length != tree.Edges.Count) throw new ArgumentException("There must be one starting length per edge.");
        room.Validate(tree.Edges.Count);

        var points = layout.ToDictionary(p => p.Leaf, p => (X: (long)p.X, Y: (long)p.Y), StringComparer.Ordinal);
        var before = ActivePaths.Analyze(layout, LayoutAnalysis.Pairs(defs, layout, scale, lengths));
        if (before.Valid)
        {
            return new StrainNeededResult
            {
                AlreadyValid = true, BoundaryStrain = 0, BoundaryValid = true, TriangulationStrain = 0,
                Milliseconds = clock.Elapsed.TotalMilliseconds, Messages = new[] { "The polygons are already valid; no strain is needed." },
            };
        }

        var index = tree.Pairs.Select((p, k) => (Key: Key(tree.Name(p.I), tree.Name(p.J)), k)).ToDictionary(x => x.Key, x => x.k);
        var distance = tree.Pairs.Select(p =>
        {
            var a = points[tree.Name(p.I)];
            var b = points[tree.Name(p.J)];
            return Math.Sqrt((double)((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y)));
        }).ToArray();
        var triangulation = ActivePaths.GreedyTriangulation(points, before.TightPairs);
        var boundary = triangulation.Where(t => ActivePaths.OnHullBoundary(points, before.HullLeaves, t.A, t.B))
            .Select(t => index[Key(t.A, t.B)]).Distinct().ToArray();
        var all = triangulation.Select(t => index[Key(t.A, t.B)]).Distinct().ToArray();

        int solves = 1;
        var sb = Solve(tree, lengths, scale, distance, boundary, room, out var strains);
        bool boundaryValid = false;
        double? st = null;
        IReadOnlyList<LeafPairName> tightTargets = Array.Empty<LeafPairName>();
        if (sb is not null)
        {
            var newLengths = lengths.Select((l, e) => l * (1 + strains[e])).ToArray();
            var atBoundary = ActivePaths.Analyze(layout, LayoutAnalysis.Pairs(defs, layout, scale, newLengths));
            boundaryValid = atBoundary.Valid;
            if (boundaryValid) tightTargets = atBoundary.TightPairs;
            if (!boundaryValid)
            {
                token.ThrowIfCancellationRequested();
                st = Solve(tree, lengths, scale, distance, all, room, out _);
                solves++;
            }
        }

        var messages = new List<string>();
        if (sb is null)
        {
            messages.Add("No strain can make the hull's boundary pairs all tight with every other pair still fitting, " +
                "so no strain closes the polygons with the leaves where they are. " +
                (room.IsUniform ? "Try another layout or grid size." : "Give the locked or tight edges more room, or try another layout or grid size."));
        }
        else if (boundaryValid)
        {
            messages.Add($"Making the {boundary.Length} boundary pairs tight needs strains within ±{sb:0.####}, and gives valid polygons.");
        }
        else
        {
            messages.Add($"The boundary pairs need at least ±{sb:0.####}, but tightening them alone leaves a polygon invalid." +
                (st is double t ? $" Making the whole triangulation tight needs ±{t:0.####}." : " The whole triangulation cannot be made tight."));
        }
        return new StrainNeededResult
        {
            BoundaryStrain = sb, BoundaryValid = boundaryValid, TriangulationStrain = st, TightTargets = tightTargets, Solves = solves,
            Milliseconds = clock.Elapsed.TotalMilliseconds, Messages = messages,
        };
    }

    /// <summary>The LP's optimal s, or null when it is infeasible.</summary>
    private static double? Solve(Tree tree, double[] lengths, double m0, double[] distance, int[] targets, EdgeStrain room, out double[] strains)
    {
        using var solver = Solver.CreateSolver("GLOP") ?? throw new InvalidOperationException("GLOP is not available.");
        int edges = lengths.Length;
        var s = solver.MakeNumVar(0, double.PositiveInfinity, "s");
        var sigma = Enumerable.Range(0, edges).Select(e => room.Locked(e)
            ? solver.MakeNumVar(0, 0, $"sigma[{e}]")
            : solver.MakeNumVar(EdgeStrain.Floor, double.PositiveInfinity, $"sigma[{e}]")).ToArray();
        var abs = Enumerable.Range(0, edges).Select(e => solver.MakeNumVar(0, double.PositiveInfinity, $"a[{e}]")).ToArray();
        var isTarget = new HashSet<int>(targets);
        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            var path = tree.PathEdges(tree.Pairs[p].I, tree.Pairs[p].J);
            double ell = path.Sum(e => lengths[e]);
            double rhs = distance[p] - m0 * ell;
            var row = isTarget.Contains(p)
                ? solver.MakeConstraint(rhs, rhs, $"tight[{p}]")
                : solver.MakeConstraint(double.NegativeInfinity, rhs, $"fit[{p}]");
            foreach (int e in path) row.SetCoefficient(sigma[e], m0 * lengths[e]);
        }
        for (int e = 0; e < edges; e++)
        {
            // −rₑs ≤ σₑ ≤ rₑs (a locked edge is fixed at 0 above), and aₑ ≥ |σₑ| for the tie-break.
            double r = room.RoomOf(e);
            if (r > 0)
            {
                var up = solver.MakeConstraint(0, double.PositiveInfinity, $"s+[{e}]");
                up.SetCoefficient(s, r);
                up.SetCoefficient(sigma[e], -1);
                var down = solver.MakeConstraint(0, double.PositiveInfinity, $"s-[{e}]");
                down.SetCoefficient(s, r);
                down.SetCoefficient(sigma[e], 1);
            }
            var ap = solver.MakeConstraint(0, double.PositiveInfinity, $"a+[{e}]");
            ap.SetCoefficient(abs[e], 1);
            ap.SetCoefficient(sigma[e], -1);
            var an = solver.MakeConstraint(0, double.PositiveInfinity, $"a-[{e}]");
            an.SetCoefficient(abs[e], 1);
            an.SetCoefficient(sigma[e], 1);
        }
        // The largest strain first; among equal ones, the least total weighed by cost (small enough never to trade against s).
        var objective = solver.Objective();
        objective.SetCoefficient(s, 1);
        double costScale = Math.Max(1, Enumerable.Range(0, edges).Sum(e => room.CostOf(e)));
        for (int e = 0; e < edges; e++) objective.SetCoefficient(abs[e], 1e-4 * room.CostOf(e) / costScale);
        objective.SetMinimization();
        var status = solver.Solve();
        if (status != Solver.ResultStatus.OPTIMAL)
        {
            strains = Array.Empty<double>();
            return null;
        }
        strains = sigma.Select(v => Math.Abs(v.SolutionValue()) < 1e-9 ? 0 : v.SolutionValue()).ToArray();
        return s.SolutionValue();
    }

    private static (string, string) Key(string a, string b) =>
        string.CompareOrdinal(a, b) <= 0 ? (a, b) : (b, a);
}
