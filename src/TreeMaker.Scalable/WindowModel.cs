using System.Diagnostics;
using System.Globalization;
using Google.OrTools.Sat;
using TreeMaker.Core;

namespace TreeMaker.Scalable;

/// <summary>
/// Stages 2 to 4: the windowed table model, solved with CP-SAT.
///
/// Every leaf i gets a window Wᵢ of grid points (a box of half-width hᵢ around a centre, filtered by its leaf
/// condition), and one Boolean y[i,a] per point a ∈ Wᵢ, with exactly one true. A pair (i, j) is a table: the
/// combinations (a, b) closer than m·ℓᵢⱼ are forbidden, written as "y[i,a] ⇒ no too-close y[j,b]". Pairs whose
/// windows are too far apart to collide are left out altogether, which is what keeps the model small: at 100
/// leaves only a few hundred of the 4,950 pairs ever need a table.
///
/// With an objective, a target pair p gets a Boolean t[p] and the rows "t[p] ∧ y[i,a] ⇒ some y[j,b] at exactly
/// distance m·ℓᵢⱼ"; the model then maximizes Σ w[p]·t[p] (Stage 4).
/// </summary>
public static class WindowModel
{
    public sealed record Target(int I, int J, long Weight);

    public sealed record Outcome(
        Dictionary<int, (int X, int Y)>? Layout, string Status, int Booleans, int Constraints, int TablePairs,
        int FreeLeaves, long? Objective, double Milliseconds);

    /// <summary>
    /// Finds a layout at scale <paramref name="scale"/> with every leaf inside its window, or proves there is none
    /// (status "No layout"). With <paramref name="targets"/>, maximizes the weight of exactly tight targets.
    /// </summary>
    public static Outcome Solve(ProblemSpec spec, Definitions definitions, Placement.Conditions conditions, double scale,
        IReadOnlyDictionary<int, (int X, int Y)> centres, IReadOnlyDictionary<int, int> halfWidth,
        IReadOnlyList<Target>? targets, TimeSpan timeLimit, int? threads, CancellationToken token)
    {
        var clock = Stopwatch.StartNew();
        var tree = spec.Tree;
        int n = spec.GridSize;

        // Windows.
        var options = new Dictionary<int, (int X, int Y)[]>();
        int free = 0;
        foreach (int v in tree.Leaves)
        {
            var (cx, cy) = centres[v];
            int h = halfWidth.TryGetValue(v, out int hv) ? hv : 0;
            if (h > 0) free++;
            var list = new List<(int, int)>();
            for (int x = Math.Max(0, cx - h); x <= Math.Min(n, cx + h); x++)
                for (int y = Math.Max(0, cy - h); y <= Math.Min(n, cy + h); y++)
                    if (conditions.Allows(v, x, y)) list.Add((x, y));
            if (list.Count == 0)
            {
                return new Outcome(null, "No layout", 0, 0, 0, free, null, clock.Elapsed.TotalMilliseconds);
            }
            options[v] = list.ToArray();
        }

        var model = new CpModel();
        var lit = new Dictionary<int, BoolVar[]>();
        int booleans = 0, constraints = 0, tables = 0;
        foreach (int v in tree.Leaves)
        {
            lit[v] = options[v].Select((p, a) => model.NewBoolVar($"y{v}_{a}")).ToArray();
            booleans += lit[v].Length;
            model.AddExactlyOne(lit[v]);
            constraints++;
        }

        // Spacing tables.
        foreach (var pair in tree.Pairs)
        {
            int i = pair.I, j = pair.J;
            long limit = Placement.ForbiddenLimit(scale * definitions.PathLength(pair));
            if (BoxDistance2(centres[i], halfWidth, i, centres[j], j) > limit) continue;
            var oi = options[i];
            var oj = options[j];
            bool any = false;
            for (int a = 0; a < oi.Length; a++)
            {
                var bad = new List<ILiteral>();
                for (int b = 0; b < oj.Length; b++)
                {
                    long dx = oi[a].X - oj[b].X, dy = oi[a].Y - oj[b].Y;
                    if (dx * dx + dy * dy <= limit) bad.Add(lit[j][b].Not());
                }
                if (bad.Count == 0) continue;
                any = true;
                if (bad.Count == oj.Length)
                {
                    model.AddBoolOr(new ILiteral[] { lit[i][a].Not() });   // a is impossible for i
                }
                else
                {
                    model.AddBoolAnd(bad).OnlyEnforceIf(lit[i][a]);
                }
                constraints++;
            }
            if (any) tables++;
        }

        // Book symmetry.
        foreach (var (a, b) in conditions.Mirrors)
        {
            var ob = options[b];
            for (int k = 0; k < options[a].Length; k++)
            {
                var (x, y) = options[a][k];
                var partners = Enumerable.Range(0, ob.Length).Where(q => ob[q].X == n - x && ob[q].Y == y).Select(q => (ILiteral)lit[b][q]).ToList();
                if (partners.Count == 0) model.AddBoolOr(new ILiteral[] { lit[a][k].Not() });
                else model.AddBoolOr(partners).OnlyEnforceIf(lit[a][k]);
                constraints++;
            }
        }

        // Stage 4 objective: exactly tight targets.
        var tight = new List<(BoolVar T, long W)>();
        if (targets is { Count: > 0 })
        {
            foreach (var target in targets)
            {
                var t = model.NewBoolVar($"t{target.I}_{target.J}");
                booleans++;
                double r = scale * definitions.PathLength(target.I, target.J);
                var oi = options[target.I];
                var oj = options[target.J];
                for (int a = 0; a < oi.Length; a++)
                {
                    var hits = new List<ILiteral>();
                    for (int b = 0; b < oj.Length; b++)
                    {
                        long dx = oi[a].X - oj[b].X, dy = oi[a].Y - oj[b].Y;
                        if (Placement.IsTight(dx * dx + dy * dy, r)) hits.Add(lit[target.J][b]);
                    }
                    if (hits.Count == 0) model.AddBoolOr(new ILiteral[] { t.Not(), lit[target.I][a].Not() });
                    else model.AddBoolOr(hits).OnlyEnforceIf(new ILiteral[] { t, lit[target.I][a] });
                    constraints++;
                }
                tight.Add((t, target.Weight));
            }
            var objective = LinearExpr.NewBuilder();
            foreach (var (t, w) in tight) objective.AddTerm(t, w);
            model.Maximize(objective);
            // Start from the current layout (the centres), which is feasible at this scale.
            foreach (int v in tree.Leaves)
            {
                for (int a = 0; a < options[v].Length; a++)
                {
                    model.AddHint(lit[v][a], options[v][a] == centres[v] ? 1L : 0L);
                }
            }
        }

        var solver = new CpSolver();
        string parameters = string.Create(CultureInfo.InvariantCulture,
            $"max_time_in_seconds:{Math.Max(0.1, timeLimit.TotalSeconds):0.###}");
        if (threads is > 0) parameters += $" num_workers:{threads}";
        solver.StringParameters = parameters;
        CpSolverStatus status;
        using (token.Register(() => solver.StopSearch()))
        {
            status = solver.Solve(model);
        }

        string text = status switch
        {
            CpSolverStatus.Optimal => targets is { Count: > 0 } ? "Optimal" : "Layout",
            CpSolverStatus.Feasible => targets is { Count: > 0 } ? "Feasible" : "Layout",
            CpSolverStatus.Infeasible => "No layout",
            _ => token.IsCancellationRequested ? "Stopped" : "Unknown",
        };
        Dictionary<int, (int X, int Y)>? layout = null;
        long? value = null;
        if (status is CpSolverStatus.Optimal or CpSolverStatus.Feasible)
        {
            layout = new Dictionary<int, (int X, int Y)>();
            foreach (int v in tree.Leaves)
            {
                int a = Array.FindIndex(lit[v], l => solver.BooleanValue(l));
                layout[v] = options[v][Math.Max(0, a)];
            }
            if (tight.Count > 0) value = tight.Sum(t => solver.BooleanValue(t.T) ? t.W : 0);
        }
        return new Outcome(layout, text, booleans, constraints, tables, free, value, clock.Elapsed.TotalMilliseconds);
    }

    /// <summary>The smallest squared distance two leaves' window boxes allow.</summary>
    private static long BoxDistance2((int X, int Y) ci, IReadOnlyDictionary<int, int> h, int i, (int X, int Y) cj, int j)
    {
        int hi = h.TryGetValue(i, out int a) ? a : 0, hj = h.TryGetValue(j, out int b) ? b : 0;
        long gx = Math.Max(0, Math.Abs(ci.X - cj.X) - hi - hj);
        long gy = Math.Max(0, Math.Abs(ci.Y - cj.Y) - hi - hj);
        return gx * gx + gy * gy;
    }
}
