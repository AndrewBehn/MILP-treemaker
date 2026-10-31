using System.Diagnostics;
using Google.OrTools.LinearSolver;

namespace PureMilpTreeMaker;

/// <summary>Settings for <see cref="PolygonCompletion"/>.</summary>
public sealed record CompletionOptions
{
    /// <summary>Lowest strain σ_min on any edge (−1 &lt; σ_min ≤ 0).</summary>
    public double StrainMin { get; init; } = -0.3;

    /// <summary>Highest strain σ_max on any edge (≥ 0).</summary>
    public double StrainMax { get; init; } = 0.3;

    /// <summary>
    /// The pairs to make tight. When empty, a triangulation of the leaf points that keeps the pairs already tight is
    /// used, so every polygon left is a triangle or a convex merger of triangles.
    /// </summary>
    public IReadOnlyList<LeafPairName> Targets { get; init; } = Array.Empty<LeafPairName>();

    public TimeSpan? TimeLimit { get; init; }
}

/// <summary>One pair the completion tried to make tight.</summary>
public sealed record CompletionTarget(string A, string B, bool OnBoundary, bool TightBefore, bool TightAfter, double Distance, double RequiredBefore, double RequiredAfter);

/// <summary>The outcome of <see cref="PolygonCompletion.Complete"/>.</summary>
public sealed record CompletionResult
{
    public required SolveStatus Status { get; init; }
    public double Scale { get; init; }
    public IReadOnlyList<CompletionTarget> Targets { get; init; } = Array.Empty<CompletionTarget>();
    public int MadeTight { get; init; }
    public int BoundaryTargets { get; init; }
    public int BoundaryMadeTight { get; init; }

    /// <summary>Edge lengths before and after, as strains relative to the starting lengths.</summary>
    public IReadOnlyList<EdgeReport> EdgeLengths { get; init; } = Array.Empty<EdgeReport>();
    public double TotalStrain { get; init; }
    public double LargestStrain { get; init; }

    public IReadOnlyList<PairReport> Pairs { get; init; } = Array.Empty<PairReport>();
    public required ActivePathReport Before { get; init; }
    public ActivePathReport? After { get; init; }
    public IReadOnlyList<string> Violations { get; init; } = Array.Empty<string>();

    public int Variables { get; init; }
    public int Binaries { get; init; }
    public int Constraints { get; init; }
    public double Milliseconds { get; init; }
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Step 2 toward a crease pattern: with the leaves held where they are and the scale fixed at m₀, change edge lengths
/// (strain σₑ, as in Section 11.3) so that chosen pairs become exactly tight, which closes the network of tight paths into
/// polygons. Every other pair must still fit. Two solves: first make as many targets tight as possible, counting each
/// pair on the hull's boundary above all interior pairs together (the polygons cannot cover the hull without them);
/// then, keeping that, use the least total strain.
/// </summary>
public static class PolygonCompletion
{
    public static CompletionResult Complete(ProblemSpec spec, IReadOnlyList<LeafPlacement> layout, double scale,
        IReadOnlyList<double>? startLengths = null, CompletionOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(spec);
        ArgumentNullException.ThrowIfNull(layout);
        options ??= new CompletionOptions();
        if (!(options.StrainMin > -1) || options.StrainMin > 0 || options.StrainMax < 0)
        {
            throw new ArgumentException("Strain bounds must satisfy −1 < σ_min ≤ 0 ≤ σ_max.");
        }
        if (!(scale > 0)) throw new ArgumentException("The scale must be positive.");

        var clock = Stopwatch.StartNew();
        var tree = spec.Tree;
        var defs = new Definitions(tree, spec.GridSize);
        var lengths = (startLengths ?? tree.Edges.Select(e => e.Length).ToArray()).ToArray();
        if (lengths.Length != tree.Edges.Count) throw new ArgumentException("There must be one starting length per edge.");
        if (layout.Count != tree.Leaves.Count) throw new ArgumentException("The layout must place every leaf.");

        var points = layout.ToDictionary(p => p.Leaf, p => (X: (long)p.X, Y: (long)p.Y), StringComparer.Ordinal);
        var pairsBefore = LayoutAnalysis.Pairs(defs, layout, scale, lengths);
        var before = ActivePaths.Analyze(layout, pairsBefore);

        var targets = options.Targets.Count > 0
            ? options.Targets
            : ActivePaths.GreedyTriangulation(points, before.TightPairs);
        var pairIndex = tree.Pairs.Select((p, k) => (Key: Key(tree.Name(p.I), tree.Name(p.J)), k))
            .ToDictionary(x => x.Key, x => x.k);
        foreach (var t in targets)
        {
            if (!pairIndex.ContainsKey(Key(t.A, t.B))) throw new ArgumentException($"{t.A}–{t.B} is not a pair of leaves.");
        }
        var targetIdx = targets.Select(t => pairIndex[Key(t.A, t.B)]).Distinct().ToArray();
        var boundary = targetIdx.Select(k =>
        {
            var p = tree.Pairs[k];
            return ActivePaths.OnHullBoundary(points, before.HullLeaves, tree.Name(p.I), tree.Name(p.J));
        }).ToArray();
        double[] weights = boundary.Select(b => b ? targetIdx.Length + 1.0 : 1.0).ToArray();

        var distance = tree.Pairs.Select(p =>
        {
            var a = points[tree.Name(p.I)];
            var b = points[tree.Name(p.J)];
            return Math.Sqrt((double)((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y)));
        }).ToArray();

        // Try the outer boundary alone first: when closing it already gives valid polygons, no inner pair needs
        // to change (a square of four tight sides is a finished polygon, for example).
        if (options.Targets.Count == 0 && boundary.Any(b => b) && boundary.Any(b => !b))
        {
            var outer = targetIdx.Where((_, i) => boundary[i]).ToArray();
            var outerWeights = outer.Select(_ => 1.0).ToArray();
            var a1 = SolveOnce(tree, lengths, scale, distance, outer, outerWeights, options, null, cancellationToken);
            if ((a1.Status is SolveStatus.Optimal or SolveStatus.Feasible) && Math.Round(a1.WeightedTight) == outer.Length)
            {
                var a2 = SolveOnce(tree, lengths, scale, distance, outer, outerWeights, options, a1.WeightedTight - 0.5, cancellationToken);
                var pick = a2.Status is SolveStatus.Optimal or SolveStatus.Feasible ? a2 : a1;
                var trial = lengths.Select((l, e) => l * (1 + (Math.Abs(pick.Strains[e]) < 1e-9 ? 0 : pick.Strains[e]))).ToArray();
                var trialReport = ActivePaths.Analyze(layout, LayoutAnalysis.Pairs(defs, layout, scale, trial));
                if (trialReport.Valid)
                {
                    targetIdx = outer;
                    boundary = outer.Select(_ => true).ToArray();
                    weights = outerWeights;
                }
            }
        }

        // Pass 1: the most targets tight. Pass 2: with that kept, the least total strain.
        var first = SolveOnce(tree, lengths, scale, distance, targetIdx, weights, options, null, cancellationToken);
        if (first.Status is not (SolveStatus.Optimal or SolveStatus.Feasible))
        {
            return new CompletionResult
            {
                Status = first.Status,
                Scale = scale,
                Before = before,
                Messages = new[] { first.Status == SolveStatus.Infeasible
                    ? "No strains within the bounds keep every pair apart; widen the bounds."
                    : "The completion solve stopped before finding strains." },
                Milliseconds = clock.Elapsed.TotalMilliseconds,
            };
        }
        double kept = first.WeightedTight;
        var second = SolveOnce(tree, lengths, scale, distance, targetIdx, weights, options, kept - 0.5, cancellationToken);
        var final = second.Status is SolveStatus.Optimal or SolveStatus.Feasible ? second : first;

        var strains = final.Strains.Select(s => Math.Abs(s) < 1e-9 ? 0 : s).ToArray();
        var newLengths = lengths.Select((l, e) => l * (1 + strains[e])).ToArray();
        var pairsAfter = LayoutAnalysis.Pairs(defs, layout, scale, newLengths);
        var after = ActivePaths.Analyze(layout, pairsAfter);
        var violations = LayoutAnalysis.Violations(spec, layout, scale, newLengths);

        var targetReports = targetIdx.Select((k, i) => new CompletionTarget(
            tree.Name(tree.Pairs[k].I), tree.Name(tree.Pairs[k].J), boundary[i],
            pairsBefore[k].Tight, pairsAfter[k].Tight, distance[k], pairsBefore[k].Required, pairsAfter[k].Required)).ToArray();

        var messages = new List<string>();
        int boundaryTotal = boundary.Count(b => b);
        int boundaryTight = targetReports.Count(t => t.OnBoundary && t.TightAfter);
        if (after.Valid)
        {
            messages.Add($"The tight paths now divide the leaves' hull into {after.Polygons.Count} valid polygon(s).");
        }
        else if (boundaryTight < boundaryTotal)
        {
            messages.Add($"Only {boundaryTight} of the {boundaryTotal} boundary pairs could be made tight within strain " +
                $"{options.StrainMin:0.##}…{options.StrainMax:+0.##;-0.##;0}. Widen the bounds, or re-solve the layout.");
        }
        else
        {
            messages.Add("The boundary is closed, but some polygons are still not valid; see the issues.");
        }

        return new CompletionResult
        {
            Status = final.Status,
            Scale = scale,
            Targets = targetReports,
            MadeTight = targetReports.Count(t => t.TightAfter),
            BoundaryTargets = boundaryTotal,
            BoundaryMadeTight = boundaryTight,
            EdgeLengths = tree.Edges.Select(e => new EdgeReport(e.Index, tree.EdgeLabel(e.Index), lengths[e.Index], strains[e.Index], newLengths[e.Index])).ToArray(),
            TotalStrain = strains.Sum(s => Math.Abs(s)),
            LargestStrain = strains.Length == 0 ? 0 : strains.Max(s => Math.Abs(s)),
            Pairs = pairsAfter,
            Before = before,
            After = after,
            Violations = violations,
            Variables = final.Variables,
            Binaries = final.Binaries,
            Constraints = final.Constraints,
            Milliseconds = clock.Elapsed.TotalMilliseconds,
            Messages = messages,
        };
    }

    private sealed record Pass(SolveStatus Status, double[] Strains, double WeightedTight, int Variables, int Binaries, int Constraints);

    private static Pass SolveOnce(Tree tree, double[] lengths, double m0, double[] distance, int[] targets, double[] weights,
        CompletionOptions options, double? keepWeightedTight, CancellationToken token)
    {
        using var solver = Solver.CreateSolver("SCIP")
            ?? throw new InvalidOperationException("The SCIP backend of OR-Tools is not available on this machine.");
        int edges = lengths.Length;
        double magnitude = Math.Max(-options.StrainMin, options.StrainMax);
        var sigma = Enumerable.Range(0, edges).Select(e => solver.MakeNumVar(options.StrainMin, options.StrainMax, $"sigma[{e}]")).ToArray();
        var abs = Enumerable.Range(0, edges).Select(e => solver.MakeNumVar(0, magnitude, $"a[{e}]")).ToArray();
        var tight = targets.Select((_, i) => solver.MakeBoolVar($"t[{i}]")).ToArray();

        // Every pair still fits: m₀(ℓᵢⱼ + Σ ℓₑσₑ) ≤ D.
        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            var path = tree.PathEdges(tree.Pairs[p].I, tree.Pairs[p].J);
            double ell = path.Sum(e => lengths[e]);
            var row = solver.MakeConstraint(double.NegativeInfinity, distance[p] - m0 * ell, $"fit[{p}]");
            foreach (int e in path) row.SetCoefficient(sigma[e], m0 * lengths[e]);
        }
        // Targets: tight when tᵢ = 1, i.e. m₀(ℓᵢⱼ + Σ ℓₑσₑ) ≥ D − D(1 − tᵢ).
        for (int i = 0; i < targets.Length; i++)
        {
            int p = targets[i];
            var path = tree.PathEdges(tree.Pairs[p].I, tree.Pairs[p].J);
            double ell = path.Sum(e => lengths[e]);
            var row = solver.MakeConstraint(-m0 * ell, double.PositiveInfinity, $"tight[{p}]");
            foreach (int e in path) row.SetCoefficient(sigma[e], m0 * lengths[e]);
            row.SetCoefficient(tight[i], -distance[p]);
        }
        // aₑ ≥ |σₑ|.
        for (int e = 0; e < edges; e++)
        {
            var up = solver.MakeConstraint(0, double.PositiveInfinity, $"a+[{e}]");
            up.SetCoefficient(abs[e], 1);
            up.SetCoefficient(sigma[e], -1);
            var down = solver.MakeConstraint(0, double.PositiveInfinity, $"a-[{e}]");
            down.SetCoefficient(abs[e], 1);
            down.SetCoefficient(sigma[e], 1);
        }

        var objective = solver.Objective();
        if (keepWeightedTight is double keep)
        {
            var row = solver.MakeConstraint(keep, double.PositiveInfinity, "keep");
            for (int i = 0; i < targets.Length; i++) row.SetCoefficient(tight[i], weights[i]);
            foreach (var a in abs) objective.SetCoefficient(a, 1);
            objective.SetMinimization();
        }
        else
        {
            for (int i = 0; i < targets.Length; i++) objective.SetCoefficient(tight[i], weights[i]);
            objective.SetMaximization();
        }
        if (options.TimeLimit is TimeSpan limit) solver.SetTimeLimit((long)Math.Max(1, limit.TotalMilliseconds));

        Solver.ResultStatus raw;
        using (token.Register(() => solver.InterruptSolve()))
        {
            raw = solver.Solve();
        }
        var status = raw switch
        {
            Solver.ResultStatus.OPTIMAL => SolveStatus.Optimal,
            Solver.ResultStatus.FEASIBLE => SolveStatus.Feasible,
            Solver.ResultStatus.INFEASIBLE => SolveStatus.Infeasible,
            Solver.ResultStatus.NOT_SOLVED => SolveStatus.NoSolutionFound,
            _ => SolveStatus.Error,
        };
        if (status is not (SolveStatus.Optimal or SolveStatus.Feasible))
        {
            return new Pass(status, Array.Empty<double>(), 0, 0, 0, 0);
        }
        double weighted = 0;
        for (int i = 0; i < targets.Length; i++) weighted += weights[i] * Math.Round(tight[i].SolutionValue());
        return new Pass(status, sigma.Select(s => s.SolutionValue()).ToArray(), weighted,
            solver.NumVariables(), targets.Length, solver.NumConstraints());
    }

    private static (string, string) Key(string a, string b) =>
        string.CompareOrdinal(a, b) <= 0 ? (a, b) : (b, a);
}
