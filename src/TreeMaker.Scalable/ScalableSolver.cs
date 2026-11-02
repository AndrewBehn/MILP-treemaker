using System.Diagnostics;
using TreeMaker.Core;
using TreeMaker.Pure;

namespace TreeMaker.Scalable;

/// <summary>
/// The four-stage pipeline for 25 to 100 leaves:
///   1. Continuous TreeMaker layout by sequential LP (GLOP), from several starts.
///   2. Round it to the grid and repair it: the largest candidate scale at which a CP-SAT window model (every leaf
///      within h of its rounded point) has a layout, found by bisection.
///   3. Large neighbourhood search: aim at a slightly larger scale, free the leaves that collide there (wide windows)
///      and their neighbours (narrow windows), hold the rest, and re-solve; or free a whole subtree.
///   4. Foldability-aware finish: at the final scale, the layout within one step of the current one with the most
///      tight pairs (boundary pairs first); then close the polygons with strains while the leaves may still move.
/// None of the stages proves optimality; the only proved bound is m̄.
/// </summary>
public static class ScalableSolver
{
    public static ScalableResult Solve(ProblemSpec spec, ScalableOptions? options = null, CancellationToken token = default)
    {
        ArgumentNullException.ThrowIfNull(spec);
        options ??= new ScalableOptions();
        spec.Validate();
        var clock = Stopwatch.StartNew();
        var tree = spec.Tree;
        var definitions = new Definitions(tree, spec.GridSize);
        var conditions = new Placement.Conditions(spec);
        var rounds = new List<StageRound>();
        var stages = new List<StageSummary>();
        var messages = new List<string>();
        var limit = spec.Solver.TimeLimit ?? TimeSpan.FromSeconds(60);
        var deadline = clock.Elapsed + limit;
        TimeSpan Left() => deadline - clock.Elapsed;
        int? threads = spec.Solver.Threads;

        if (tree.Leaves.Count < 2)
        {
            throw new ArgumentException("The tree needs at least two leaves.");
        }

        // ───── Stage 1: continuous (or the imported starting layout in its place) ─────
        var s1 = Stopwatch.StartNew();
        ContinuousLayout.Result? best = null;
        int starts = 0;
        bool fromStart = false;
        if (spec.StartLayout is { } imported)
        {
            var points = imported.ToDictionary(q => q.Vertex, q => ((double)q.X, (double)q.Y));
            double importedScale = ContinuousLayout.Scale(definitions, points);
            if (importedScale > 0)
            {
                best = new ContinuousLayout.Result(points, importedScale, 0, 0);
                fromStart = true;
                messages.Add($"Began from the starting layout (scale {importedScale:0.######}); Stage 1 was skipped.");
            }
            else
            {
                messages.Add("The starting layout has two leaves on one point, so Stage 1 ran from the usual starts.");
            }
        }
        if (!fromStart)
        {
            foreach (var start in ContinuousLayout.Starts(spec, conditions, Math.Max(1, options.Multistarts), options.RandomSeed))
            {
                if (starts > 0 && (token.IsCancellationRequested || Left() < limit * 0.75)) break;
                var r = ContinuousLayout.Improve(spec, definitions, conditions, start, options.MaxLinearPrograms, rounds, token, limit * 0.2);
                starts++;
                if (best is null || r.Scale > best.Scale) best = r;
            }
        }
        var continuous = best!;
        stages.Add(new StageSummary
        {
            Stage = 1,
            Name = "Continuous layout",
            Scale = continuous.Scale,
            Solves = rounds.Count(r => r.Stage == 1),
            LargestSolve = rounds.Where(r => r.Stage == 1).Select(r => r.Variables).DefaultIfEmpty(0).Max(),
            Milliseconds = s1.Elapsed.TotalMilliseconds,
            Note = fromStart
                ? $"Skipped: the starting layout (m = {continuous.Scale:0.####}) takes its place."
                : $"Best of {starts} start(s): m = {continuous.Scale:0.####} off the grid, a local optimum.",
        });

        // ───── Stage 2: round and repair ─────
        var s2 = Stopwatch.StartNew();
        var centres = tree.Leaves.ToDictionary(v => v, v => conditions.Nearest(v, continuous.Layout[v].X, continuous.Layout[v].Y));
        foreach (var (a, b) in conditions.Mirrors)
        {
            var (ax, ay) = centres[a];
            if (conditions.Allows(b, spec.GridSize - ax, ay)) centres[b] = (spec.GridSize - ax, ay);
        }
        int h = Math.Max(1, options.RepairHalfWidth);
        var widths = tree.Leaves.ToDictionary(v => v, _ => h);
        Dictionary<int, (int X, int Y)>? layout = null;
        double? scale = null;
        // From an imported layout the ladder reaches a little above its scale, since the windows may improve it.
        double top = Math.Min(fromStart ? 1.25 * continuous.Scale : continuous.Scale, definitions.ScaleUpperBound);
        var ladder = Placement.Candidates(definitions, 0.5 * top, top);
        int lo = -1, hi = ladder.Count - 1;   // invariant: a layout is known at ladder[lo] (or none yet), none above hi
        while (lo < hi && !token.IsCancellationRequested && Left() > TimeSpan.Zero)
        {
            int mid = (lo + hi + 1) / 2;
            var outcome = WindowModel.Solve(spec, definitions, conditions, ladder[mid], centres, widths, null,
                Min(Left(), Seconds(options.WindowSeconds, 20)), threads, token);
            rounds.Add(Round(2, "Repair window", ladder[mid], outcome));
            if (outcome.Layout is { } found)
            {
                lo = mid;
                layout = found;
            }
            else if (outcome.Status == "No layout")
            {
                hi = mid - 1;
            }
            else
            {
                break;   // stopped or out of time: keep what is known
            }
        }
        if (layout is null)
        {
            // Below the ladder: widen the windows once and take any layout at half the continuous scale.
            widths = tree.Leaves.ToDictionary(v => v, _ => h + 2);
            var outcome = WindowModel.Solve(spec, definitions, conditions, 0.5 * top * (1 - 1e-9), centres, widths, null,
                Min(Left(), Seconds(options.WindowSeconds, 20)), threads, token);
            rounds.Add(Round(2, "Repair window", 0.5 * top, outcome));
            layout = outcome.Layout;
        }
        if (layout is null)
        {
            return Finish(SolveStatus.NoSolutionFound, null, Array.Empty<double>(), false, 0, 0,
                "No grid layout was found near the continuous one. Try a larger grid N, or fewer leaf conditions.");
        }
        scale = LayoutAnalysis.ExactScale(definitions, layout);
        stages.Add(new StageSummary
        {
            Stage = 2,
            Name = "Round and repair",
            Scale = scale,
            Solves = rounds.Count(r => r.Stage == 2),
            LargestSolve = rounds.Where(r => r.Stage == 2).Select(r => r.Variables).DefaultIfEmpty(0).Max(),
            Milliseconds = s2.Elapsed.TotalMilliseconds,
            Note = $"Windows of half-width {h}: m = {scale:0.####}, {scale / continuous.Scale:0.0%} of the continuous scale.",
        });

        // ───── Stage 3: large neighbourhood search ─────
        var s3 = Stopwatch.StartNew();
        if (options.NeighbourhoodSearch)
        {
            var subtrees = options.SubtreeNeighbourhoods ? Subtrees(tree) : new List<HashSet<int>>();
            double step = 0.02;
            int failures = 0, subtreeTurn = 0;
            while (!token.IsCancellationRequested && Left() > TimeSpan.FromSeconds(1) && failures < 4)
            {
                double current = scale!.Value;
                var above = Placement.Candidates(definitions, current * (1 + 1e-12), Math.Min(definitions.ScaleUpperBound, current * (1 + step)));
                above.RemoveAll(c => c <= current * (1 + 1e-12));
                if (above.Count == 0)
                {
                    if (current * (1 + step) >= definitions.ScaleUpperBound) break;
                    step *= 2;
                    continue;
                }
                double target = above[^1];
                var bad = Placement.Colliding(definitions, layout, target);
                Dictionary<int, int> free;
                string kind;
                if (failures % 2 == 1 && subtrees.Count > 0)
                {
                    // Free the smallest subtree that holds a colliding leaf, rotating through the candidates.
                    var choices = subtrees.Where(s => s.Overlaps(bad)).OrderBy(s => s.Count).ToList();
                    var pick = choices.Count > 0 ? choices[subtreeTurn++ % choices.Count] : subtrees[subtreeTurn++ % subtrees.Count];
                    free = tree.Leaves.ToDictionary(v => v, v => pick.Contains(v) ? 2 : 0);
                    kind = "Subtree window";
                }
                else
                {
                    free = tree.Leaves.ToDictionary(v => v, _ => 0);
                    foreach (int v in bad) free[v] = options.NeighbourhoodHalfWidth;
                    foreach (int v in tree.Leaves)
                    {
                        if (free[v] > 0) continue;
                        foreach (int b in bad)
                        {
                            double d = Math.Sqrt(Sq(layout[v].X - layout[b].X) + Sq(layout[v].Y - layout[b].Y));
                            if (d <= 1.5 * target * definitions.PathLength(v, b)) { free[v] = 1; break; }
                        }
                    }
                    kind = "Collision window";
                }
                var outcome = WindowModel.Solve(spec, definitions, conditions, target, layout, free, null,
                    Min(Left(), Seconds(options.NeighbourhoodSeconds, 10)), threads, token);
                rounds.Add(Round(3, kind, target, outcome));
                if (outcome.Layout is { } better)
                {
                    layout = better;
                    scale = LayoutAnalysis.ExactScale(definitions, layout);
                    failures = 0;
                    step = Math.Min(0.08, step * 1.5);
                }
                else
                {
                    failures++;
                    if (failures % 2 == 0) step = Math.Max(1e-6, step / 3);
                }
            }
        }
        stages.Add(new StageSummary
        {
            Stage = 3,
            Name = "Neighbourhood search",
            Scale = scale,
            Solves = rounds.Count(r => r.Stage == 3),
            LargestSolve = rounds.Where(r => r.Stage == 3).Select(r => r.Variables).DefaultIfEmpty(0).Max(),
            Milliseconds = s3.Elapsed.TotalMilliseconds,
            Note = options.NeighbourhoodSearch
                ? $"m = {scale:0.####}, {scale / continuous.Scale:0.0%} of the continuous scale, after {rounds.Count(r => r.Stage == 3 && r.Outcome == "Layout")} improvement(s)."
                : "Off.",
        });

        // ───── Stage 4: tight pairs, then closing ─────
        var s4 = Stopwatch.StartNew();
        double m = scale!.Value;
        var lengths = tree.Edges.Select(e => e.Length).ToArray();
        int tightBefore = MovingClosure.Report(definitions, layout, m, lengths).TightPairs.Count;
        if (options.MaximizeTightPairs && !token.IsCancellationRequested && Left() > TimeSpan.FromSeconds(1))
        {
            var report = MovingClosure.Report(definitions, layout, m, lengths);
            var points = tree.Leaves.ToDictionary(v => tree.Name(v), v => ((long)layout[v].X, (long)layout[v].Y), StringComparer.Ordinal);
            var triangulation = ActivePaths.GreedyTriangulation(points, report.TightPairs);
            var targets = triangulation.Select(t =>
            {
                var p = tree.Normalize(tree.Id(t.A), tree.Id(t.B));
                bool boundary = ActivePaths.OnHullBoundary(points, report.HullLeaves, t.A, t.B);
                return new WindowModel.Target(p.I, p.J, boundary ? triangulation.Count + 1 : 1);
            }).ToList();
            var outcome = WindowModel.Solve(spec, definitions, conditions, m * (1 - 1e-12), layout,
                tree.Leaves.ToDictionary(v => v, _ => 1), targets, Min(Left(), Seconds(options.WindowSeconds, 20)), threads, token);
            rounds.Add(Round(4, "Most tight pairs", m, outcome));
            if (outcome.Layout is { } tighter && LayoutAnalysis.ExactScale(definitions, tighter) >= m * (1 - 1e-9))
            {
                var after = MovingClosure.Report(definitions, tighter, m, lengths);
                if (after.TightPairs.Count >= report.TightPairs.Count) layout = tighter;
            }
        }
        int tightAfter = MovingClosure.Report(definitions, layout, m, lengths).TightPairs.Count;
        bool valid = MovingClosure.Report(definitions, layout, m, lengths).Valid;
        double[] strains = new double[tree.Edges.Count];
        if (options.CloseWithMovingLeaves && !valid && !token.IsCancellationRequested && Left() > TimeSpan.FromSeconds(1))
        {
            var closed = MovingClosure.Close(spec, definitions, conditions, layout, m, 1, options.StrainMin, options.StrainMax,
                3, Min(Left(), Seconds(options.WindowSeconds, 20)), rounds, token);
            layout = closed.Layout;
            lengths = closed.Lengths;
            strains = closed.Strains;
            valid = closed.Valid;
        }
        stages.Add(new StageSummary
        {
            Stage = 4,
            Name = "Foldability finish",
            Scale = m,
            Solves = rounds.Count(r => r.Stage == 4),
            LargestSolve = rounds.Where(r => r.Stage == 4).Select(r => r.Variables).DefaultIfEmpty(0).Max(),
            Milliseconds = s4.Elapsed.TotalMilliseconds,
            Note = $"Tight pairs {tightBefore} → {tightAfter}" + (strains.Any(s => s != 0)
                ? $"; closing changed edge lengths by up to {strains.Max(Math.Abs):0.0%}"
                : "") + (valid ? "; the polygons are valid." : "; the polygons are not all valid yet."),
        });

        return Finish(SolveStatus.Feasible, layout, lengths, valid, tightBefore, tightAfter, null);

        ScalableResult Finish(SolveStatus status, Dictionary<int, (int X, int Y)>? final, IReadOnlyList<double> finalLengths,
            bool polygonsValid, int before, int after, string? failure)
        {
            if (failure is not null) messages.Add(failure);
            if (token.IsCancellationRequested) messages.Add("Stopped early: this is the best layout found so far.");
            else if (Left() <= TimeSpan.Zero) messages.Add("The time limit ended the search: this is the best layout found so far.");
            var placements = final is null ? Array.Empty<LeafPlacement>() : MovingClosure.Placements(tree, final);
            // The scale is the one Stage 3 reached; strained lengths can only keep or raise min D/ℓ' at that scale.
            double? reported = final is null ? null : scale;
            var lengthsUsed = finalLengths.Count > 0 ? finalLengths : tree.Edges.Select(e => e.Length).ToArray();
            bool strained = final is not null && lengthsUsed.Select((l, e) => Math.Abs(l - tree.Edges[e].Length) > 1e-12).Any(b => b);
            if (final is not null)
            {
                messages.Add(fromStart
                    ? $"The grid layout reaches m = {reported:0.######}, from the starting layout's {continuous.Scale:0.######}. The only proved bound is m̄ = {definitions.ScaleUpperBound:0.######}."
                    : $"The grid layout reaches m = {reported:0.######}; the continuous layout reached {continuous.Scale:0.######} " +
                      $"(a local optimum off the grid, not a bound). The only proved bound is m̄ = {definitions.ScaleUpperBound:0.######}.");
                if (polygonsValid) messages.Add("The tight paths divide the leaves' hull into valid polygons: Build the crease pattern is ready.");
                else messages.Add("The polygons are not all valid yet. Try Find the strain needed below, a larger strain range, or a different N.");
            }
            return new ScalableResult
            {
                Status = status,
                Scale = reported,
                TreeMakerScale = reported / spec.GridSize,
                UpperBound = definitions.ScaleUpperBound,
                ContinuousScale = continuous.Scale,
                Layout = placements,
                ContinuousLayout = tree.Leaves.Select(v => new ContinuousPoint(tree.Name(v), continuous.Layout[v].X, continuous.Layout[v].Y)).ToArray(),
                Pairs = final is null ? Array.Empty<PairReport>() : LayoutAnalysis.Pairs(definitions, placements, reported!.Value, strained ? lengthsUsed : null),
                EdgeLengths = strained
                    ? tree.Edges.Select(e => new EdgeReport(e.Index, tree.EdgeLabel(e.Index), e.Length, lengthsUsed[e.Index] / e.Length - 1, lengthsUsed[e.Index])).ToArray()
                    : Array.Empty<EdgeReport>(),
                Violations = final is null ? Array.Empty<string>() : LayoutAnalysis.Violations(spec with { Stage = Stage.Scale }, placements, reported!.Value, strained ? lengthsUsed : null),
                Stages = stages,
                Rounds = rounds,
                TightBefore = before,
                TightAfter = after,
                PolygonsValid = polygonsValid,
                Milliseconds = clock.Elapsed.TotalMilliseconds,
                BaseModel = ModelSize.Predict(spec with { Stage = Stage.Scale }),
                Messages = messages,
            };
        }
    }

    /// <summary>Sizes known before solving.</summary>
    public static ScalableAnalysis Analyze(ProblemSpec spec, ScalableOptions? options = null)
    {
        options ??= new ScalableOptions();
        var definitions = new Definitions(spec.Tree, spec.GridSize);
        int h = Math.Max(1, options.RepairHalfWidth);
        int window = (2 * h + 1) * (2 * h + 1);
        return new ScalableAnalysis
        {
            Leaves = spec.Tree.Leaves.Count,
            Pairs = spec.Tree.Pairs.Count,
            Edges = spec.Tree.Edges.Count,
            ScaleUpperBound = definitions.ScaleUpperBound,
            LpVariables = 2 * spec.Tree.Leaves.Count + 1,
            LpRows = spec.Tree.Pairs.Count + 2 * spec.MirrorPairs.Count,
            RepairWindowPoints = window,
            RepairBooleans = spec.Tree.Leaves.Count * window,
            BaseModel = ModelSize.Predict(spec with { Stage = Stage.Scale }),
        };
    }

    private static StageRound Round(int stage, string kind, double scale, WindowModel.Outcome o) => new()
    {
        Stage = stage,
        Kind = kind,
        Scale = scale,
        Outcome = o.Status,
        Variables = o.Booleans,
        Constraints = o.Constraints,
        FreeLeaves = o.FreeLeaves,
        Milliseconds = o.Milliseconds,
    };

    private static double Sq(double v) => v * v;

    private static TimeSpan Min(TimeSpan a, TimeSpan b) => a < b ? (a < TimeSpan.Zero ? TimeSpan.Zero : a) : b;

    /// <summary>A per-solve cap from the options, in seconds; the default when it is missing or not positive.</summary>
    private static TimeSpan Seconds(double seconds, double fallback) =>
        TimeSpan.FromSeconds(double.IsFinite(seconds) && seconds > 0 ? seconds : fallback);

    /// <summary>The leaf sets of every subtree hanging off an internal edge, with between 2 and half the leaves.</summary>
    internal static List<HashSet<int>> Subtrees(Tree tree)
    {
        var adjacency = new Dictionary<int, List<int>>();
        foreach (var e in tree.Edges)
        {
            if (!adjacency.TryGetValue(e.U, out var a)) adjacency[e.U] = a = new List<int>();
            if (!adjacency.TryGetValue(e.V, out var b)) adjacency[e.V] = b = new List<int>();
            a.Add(e.V);
            b.Add(e.U);
        }
        var output = new List<HashSet<int>>();
        int total = tree.Leaves.Count;
        foreach (var e in tree.Edges)
        {
            foreach (var (from, into) in new[] { (e.U, e.V), (e.V, e.U) })
            {
                var leaves = new HashSet<int>();
                var seen = new HashSet<int> { from };
                var stack = new Stack<int>();
                stack.Push(into);
                while (stack.Count > 0)
                {
                    int v = stack.Pop();
                    if (!seen.Add(v)) continue;
                    if (tree.IsLeaf(v)) leaves.Add(v);
                    foreach (int w in adjacency[v]) if (!seen.Contains(w)) stack.Push(w);
                }
                if (leaves.Count >= 2 && leaves.Count <= Math.Max(2, total / 2) && !output.Any(s => s.SetEquals(leaves)))
                {
                    output.Add(leaves);
                }
            }
        }
        return output;
    }
}
