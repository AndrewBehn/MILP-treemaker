using System.Diagnostics;
using Google.OrTools.LinearSolver;
using PureMilpTreeMaker;

namespace ScalableMilpTreeMaker;

/// <summary>
/// Stage 4, second half: close the polygons with edge strains while every leaf may still move inside a small window.
///
/// The shared "Close the polygons" step (PolygonCompletion) holds the leaves fixed; past about 20 leaves that rarely
/// closes, because a pair on the boundary that is far from tight cannot be made tight by strains alone without
/// pushing some other pair too close. Here the leaf positions are variables too: y[i,a] picks leaf i's point a in
/// its window, σₑ is edge e's strain, and t[p] says target pair p is exactly tight. With ℓ'ᵢⱼ = Σₑ ℓₑ(1 + σₑ):
///     fit:    m·ℓ'ᵢⱼ ≤ Σ_b d(a,b)·y[j,b] + M·(1 − y[i,a])                    for every pair that could collide, every a
///     tight:  m·ℓ'ᵢⱼ ≥ Σ_b d(a,b)·y[j,b] − M·(1 − y[i,a]) − M·(1 − t[p])     for every target, every a
/// and the objective is Σ w[p]·t[p] − ε·Σ|σₑ|, boundary pairs weighted above all interior ones. The targets are a
/// triangulation of the current points that keeps the pairs already tight. It is solved with SCIP, for a few rounds
/// (re-triangulating after the leaves move), and stops as soon as the polygons are valid.
/// </summary>
public static class MovingClosure
{
    public sealed record Result(
        Dictionary<int, (int X, int Y)> Layout, double[] Lengths, double[] Strains, bool Valid, int Rounds,
        ActivePathReport Report);

    public static Result Close(ProblemSpec spec, Definitions definitions, Placement.Conditions conditions,
        Dictionary<int, (int X, int Y)> start, double scale, int halfWidth, double strainMin, double strainMax,
        int maxRounds, TimeSpan timeLimit, List<StageRound> rounds, CancellationToken token)
    {
        var tree = spec.Tree;
        int n = spec.GridSize;
        int edgeCount = tree.Edges.Count;
        var lengths = tree.Edges.Select(e => e.Length).ToArray();
        var original = lengths.ToArray();
        var layout = new Dictionary<int, (int X, int Y)>(start);
        var report = Report(definitions, layout, scale, lengths);
        if (report.Valid || token.IsCancellationRequested)
        {
            return new Result(layout, lengths, new double[edgeCount], report.Valid, 0, report);
        }
        double m = scale;
        var budget = Stopwatch.StartNew();

        for (int round = 1; round <= maxRounds && !token.IsCancellationRequested; round++)
        {
            if (timeLimit - budget.Elapsed < TimeSpan.FromSeconds(1)) break;
            var left = (timeLimit - budget.Elapsed) / (maxRounds - round + 1);   // share what is left among the rounds
            var clock = Stopwatch.StartNew();
            var points = Points(tree, layout);
            var targets = ActivePaths.GreedyTriangulation(points, report.TightPairs);
            var hull = report.HullLeaves;
            var targetIds = targets.Select(t => tree.Normalize(tree.Id(t.A), tree.Id(t.B))).ToArray();
            var weight = targets.Select(t => ActivePaths.OnHullBoundary(points, hull, t.A, t.B) ? targets.Count + 1.0 : 1.0).ToArray();
            var targetIndex = new Dictionary<LeafPair, int>();
            for (int k = 0; k < targetIds.Length; k++) targetIndex[targetIds[k]] = k;

            using var solver = Solver.CreateSolver("SCIP") ?? throw new InvalidOperationException("SCIP is not available.");
            var options = new Dictionary<int, (int X, int Y)[]>();
            var y = new Dictionary<int, Variable[]>();
            int variables = 0, rows = 0;
            foreach (int v in tree.Leaves)
            {
                var (cx, cy) = layout[v];
                var list = new List<(int, int)>();
                for (int x = cx - halfWidth; x <= cx + halfWidth; x++)
                    for (int yy = cy - halfWidth; yy <= cy + halfWidth; yy++)
                        if (conditions.Allows(v, x, yy)) list.Add((x, yy));
                options[v] = list.ToArray();
                y[v] = list.Select((_, a) => solver.MakeBoolVar($"y{v}_{a}")).ToArray();
                variables += y[v].Length;
                var one = solver.MakeConstraint(1, 1, $"one{v}");
                foreach (var b in y[v]) one.SetCoefficient(b, 1);
                rows++;
            }
            // Strain bounds are on the original lengths, so later rounds get what is left of them.
            var lo = Enumerable.Range(0, edgeCount).Select(e => Math.Min(0, (1 + strainMin) * original[e] / lengths[e] - 1)).ToArray();
            var hi = Enumerable.Range(0, edgeCount).Select(e => Math.Max(0, (1 + strainMax) * original[e] / lengths[e] - 1)).ToArray();
            double magnitude = Math.Max(lo.Max(v => -v), hi.Max());
            var sigma = Enumerable.Range(0, edgeCount).Select(e => solver.MakeNumVar(lo[e], hi[e], $"s{e}")).ToArray();
            var abs = Enumerable.Range(0, edgeCount).Select(e => solver.MakeNumVar(0, magnitude, $"a{e}")).ToArray();
            var t = targetIds.Select((_, k) => solver.MakeBoolVar($"t{k}")).ToArray();
            variables += 2 * edgeCount + t.Length;
            for (int e = 0; e < edgeCount; e++)
            {
                var up = solver.MakeConstraint(0, double.PositiveInfinity, $"a+{e}");
                up.SetCoefficient(abs[e], 1);
                up.SetCoefficient(sigma[e], -1);
                var down = solver.MakeConstraint(0, double.PositiveInfinity, $"a-{e}");
                down.SetCoefficient(abs[e], 1);
                down.SetCoefficient(sigma[e], 1);
                rows += 2;
            }

            foreach (var pair in tree.Pairs)
            {
                var path = tree.PathEdges(pair.I, pair.J);
                double ell = path.Sum(e => lengths[e]);
                var oi = options[pair.I];
                var oj = options[pair.J];
                double dmin = double.PositiveInfinity, dmax = 0;
                var d = new double[oi.Length, oj.Length];
                for (int a = 0; a < oi.Length; a++)
                    for (int b = 0; b < oj.Length; b++)
                    {
                        double dx = oi[a].X - oj[b].X, dy = oi[a].Y - oj[b].Y;
                        d[a, b] = Math.Sqrt(dx * dx + dy * dy);
                        dmin = Math.Min(dmin, d[a, b]);
                        dmax = Math.Max(dmax, d[a, b]);
                    }
                bool isTarget = targetIndex.TryGetValue(pair, out int k);
                double most = m * path.Sum(e => lengths[e] * (1 + hi[e]));
                if (dmin > most + 1e-9 && !isTarget) continue;   // can never be too close
                for (int a = 0; a < oi.Length; a++)
                {
                    // fit: m·ℓ + Σ m·ℓₑ·σₑ − Σ_b d(a,b)·y[j,b] + M·y[i,a] ≤ M − ... rearranged with M = most.
                    var fit = solver.MakeConstraint(double.NegativeInfinity, most - m * ell, $"f{rows}");
                    foreach (int e in path) fit.SetCoefficient(sigma[e], m * lengths[e]);
                    for (int b = 0; b < oj.Length; b++) fit.SetCoefficient(y[pair.J][b], -d[a, b]);
                    fit.SetCoefficient(y[pair.I][a], most);
                    rows++;
                    if (isTarget)
                    {
                        double big = dmax + 1;
                        var tight = solver.MakeConstraint(-2 * big - m * ell, double.PositiveInfinity, $"t{rows}");
                        foreach (int e in path) tight.SetCoefficient(sigma[e], m * lengths[e]);
                        for (int b = 0; b < oj.Length; b++) tight.SetCoefficient(y[pair.J][b], -d[a, b]);
                        tight.SetCoefficient(y[pair.I][a], -big);
                        tight.SetCoefficient(t[k], -big);
                        rows++;
                    }
                }
            }

            foreach (var (a, b) in conditions.Mirrors)
            {
                // x_a + x_b = N and y_a = y_b, written on the window points.
                var sx = solver.MakeConstraint(n, n, $"mx{a}");
                var sy = solver.MakeConstraint(0, 0, $"my{a}");
                for (int q = 0; q < options[a].Length; q++) { sx.SetCoefficient(y[a][q], options[a][q].X); sy.SetCoefficient(y[a][q], options[a][q].Y); }
                for (int q = 0; q < options[b].Length; q++) { sx.SetCoefficient(y[b][q], options[b][q].X); sy.SetCoefficient(y[b][q], -options[b][q].Y); }
                rows += 2;
            }

            double epsilon = 0.5 / Math.Max(1, edgeCount * magnitude);
            var objective = solver.Objective();
            for (int k = 0; k < t.Length; k++) objective.SetCoefficient(t[k], weight[k]);
            foreach (var a in abs) objective.SetCoefficient(a, -epsilon);
            objective.SetMaximization();

            // Start from the current points with no strain.
            var hintVars = new List<Variable>();
            var hintValues = new List<double>();
            foreach (int v in tree.Leaves)
                for (int q = 0; q < options[v].Length; q++) { hintVars.Add(y[v][q]); hintValues.Add(options[v][q] == layout[v] ? 1 : 0); }
            foreach (var s in sigma) { hintVars.Add(s); hintValues.Add(0); }
            solver.SetHint(hintVars.ToArray(), hintValues.ToArray());
            solver.SetTimeLimit((long)Math.Max(1000, left.TotalMilliseconds * 0.8));

            Solver.ResultStatus status;
            using (token.Register(() => solver.InterruptSolve()))
            {
                status = solver.Solve();
            }
            bool solved = status is Solver.ResultStatus.OPTIMAL or Solver.ResultStatus.FEASIBLE;
            string outcome = solved ? "Closing" : token.IsCancellationRequested ? "Stopped" : status.ToString();
            if (!solved)
            {
                rounds.Add(new StageRound { Stage = 4, Kind = "Closing MILP", Scale = m, Outcome = outcome, Variables = variables, Constraints = rows, FreeLeaves = tree.Leaves.Count, Milliseconds = clock.Elapsed.TotalMilliseconds });
                break;
            }
            var next = new Dictionary<int, (int X, int Y)>();
            foreach (int v in tree.Leaves)
            {
                int a = Array.FindIndex(y[v], b => b.SolutionValue() > 0.5);
                next[v] = options[v][Math.Max(0, a)];
            }
            var newLengths = Enumerable.Range(0, edgeCount).Select(e => lengths[e] * (1 + Clean(sigma[e].SolutionValue()))).ToArray();
            var nextReport = Report(definitions, next, m, newLengths);

            // Polish: with the new points fixed, solve for strains again without the position big-M rows, which
            // makes the chosen pairs tight to LP precision instead of to the MILP's tolerance.
            var chosen = Enumerable.Range(0, t.Length).Where(k => t[k].SolutionValue() > 0.5).Select(k => targets[k]).ToList();
            if (chosen.Count > 0)
            {
                var polish = PolygonCompletion.Complete(spec with { Stage = Stage.Scale }, Placements(tree, next), m, lengths,
                    new CompletionOptions { StrainMin = lo.Max(), StrainMax = hi.Min(), Targets = chosen, TimeLimit = left * 0.2 }, token);
                if (polish.After is { } after && polish.Violations.Count == 0 &&
                    (after.Valid || after.TightPairs.Count >= nextReport.TightPairs.Count))
                {
                    newLengths = polish.EdgeLengths.Select(e => e.NewLength).ToArray();
                    nextReport = after;
                }
            }
            bool fits = LayoutAnalysis.Violations(spec with { Stage = Stage.Scale }, Placements(tree, next), m, newLengths).Count == 0;
            rounds.Add(new StageRound
            {
                Stage = 4,
                Kind = "Closing MILP",
                Scale = m,
                Outcome = !fits ? "Rejected (a pair too close)" : nextReport.Valid ? "Polygons closed" : $"{nextReport.MissingBoundary.Count} boundary gap(s) left",
                Variables = variables,
                Constraints = rows,
                FreeLeaves = tree.Leaves.Count,
                Milliseconds = clock.Elapsed.TotalMilliseconds,
            });
            if (!fits) break;
            layout = next;
            lengths = newLengths;
            report = nextReport;
            if (report.Valid) break;
        }
        var strains = Enumerable.Range(0, edgeCount).Select(e => lengths[e] / original[e] - 1).ToArray();
        return new Result(layout, lengths, strains, report.Valid, rounds.Count(r => r.Stage == 4 && r.Kind == "Closing MILP"), report);
    }

    private static double Clean(double s) => Math.Abs(s) < 1e-9 ? 0 : s;

    public static ActivePathReport Report(Definitions definitions, IReadOnlyDictionary<int, (int X, int Y)> layout, double scale, IReadOnlyList<double> lengths)
    {
        var placements = Placements(definitions.Tree, layout);
        var pairs = LayoutAnalysis.Pairs(definitions, placements, scale, lengths);
        return ActivePaths.Analyze(placements, pairs);
    }

    public static LeafPlacement[] Placements(Tree tree, IReadOnlyDictionary<int, (int X, int Y)> layout) =>
        tree.Leaves.Select(v => new LeafPlacement(tree.Name(v), v, layout[v].X, layout[v].Y)).ToArray();

    private static Dictionary<string, (long X, long Y)> Points(Tree tree, IReadOnlyDictionary<int, (int X, int Y)> layout) =>
        tree.Leaves.ToDictionary(v => tree.Name(v), v => ((long)layout[v].X, (long)layout[v].Y), StringComparer.Ordinal);
}
