using System.Diagnostics;
using Google.OrTools.LinearSolver;
using PureMilpTreeMaker;

namespace ScalableMilpTreeMaker;

/// <summary>
/// Stage 1: TreeMaker's scale optimization off the grid, by sequential linear programming.
///
/// At the current layout u, every pair's distance is bounded below by its projection on the current direction
/// d̂ᵢⱼ = (uᵢ − uⱼ)/‖uᵢ − uⱼ‖: ‖vᵢ − vⱼ‖ ≥ d̂ᵢⱼ · (vᵢ − vⱼ). So the linear program
///     maximize m  subject to  d̂ᵢⱼ · (vᵢ − vⱼ) ≥ m · ℓᵢⱼ  for every pair,  v in the sheet and in a trust box around u
/// is an inner approximation: its answer v is a real layout whose true scale is at least the LP's m. Each step can
/// only improve the scale. When a step does not improve it, the trust box shrinks; when it does, the box grows.
/// The fixed points are the KKT points of the max-min problem, so the result is a local optimum, not a global one.
/// </summary>
public static class ContinuousLayout
{
    public sealed record Result(Dictionary<int, (double X, double Y)> Layout, double Scale, int LinearPrograms, int Improvements);

    /// <summary>Runs SLP from one start. <paramref name="rounds"/> receives one entry per LP.</summary>
    public static Result Improve(ProblemSpec spec, Definitions definitions, Placement.Conditions conditions,
        Dictionary<int, (double X, double Y)> start, int maxPrograms, List<StageRound> rounds, CancellationToken token,
        TimeSpan? budget = null)
    {
        var tree = spec.Tree;
        int n = spec.GridSize;
        var leaves = tree.Leaves;
        var u = new Dictionary<int, (double X, double Y)>(start);
        double radius = n / 4.0;
        double m = Scale(definitions, u);
        int programs = 0, improvements = 0;
        var clock = Stopwatch.StartNew();

        while (programs < maxPrograms && radius >= 1e-3 && !token.IsCancellationRequested
               && (budget is null || clock.Elapsed < budget))
        {
            var step = Stopwatch.StartNew();
            using var solver = Solver.CreateSolver("GLOP") ?? throw new InvalidOperationException("GLOP is not available.");
            var x = new Dictionary<int, Variable>();
            var y = new Dictionary<int, Variable>();
            foreach (int v in leaves)
            {
                var (x0, x1, y0, y1) = conditions.Box(v);
                var (ux, uy) = u[v];
                x[v] = solver.MakeNumVar(Math.Max(x0, Math.Min(x1, ux - radius)), Math.Min(x1, Math.Max(x0, ux + radius)), $"x{v}");
                y[v] = solver.MakeNumVar(Math.Max(y0, Math.Min(y1, uy - radius)), Math.Min(y1, Math.Max(y0, uy + radius)), $"y{v}");
            }
            var scale = solver.MakeNumVar(0, double.PositiveInfinity, "m");
            int rows = 0;
            foreach (var pair in tree.Pairs)
            {
                var (xi, yi) = u[pair.I];
                var (xj, yj) = u[pair.J];
                double dx = xi - xj, dy = yi - yj, d = Math.Sqrt(dx * dx + dy * dy);
                if (d < 1e-9) { dx = 1; dy = 0; d = 1; }   // coincident: push apart along x
                dx /= d; dy /= d;
                var row = solver.MakeConstraint(0, double.PositiveInfinity, $"p{rows++}");
                row.SetCoefficient(x[pair.I], dx);
                row.SetCoefficient(x[pair.J], -dx);
                row.SetCoefficient(y[pair.I], dy);
                row.SetCoefficient(y[pair.J], -dy);
                row.SetCoefficient(scale, -definitions.PathLength(pair));
            }
            foreach (var (a, b) in conditions.Mirrors)
            {
                var sx = solver.MakeConstraint(n, n, $"mx{a}");
                sx.SetCoefficient(x[a], 1);
                sx.SetCoefficient(x[b], 1);
                var sy = solver.MakeConstraint(0, 0, $"my{a}");
                sy.SetCoefficient(y[a], 1);
                sy.SetCoefficient(y[b], -1);
            }
            solver.Objective().SetCoefficient(scale, 1);
            solver.Objective().SetMaximization();
            var status = solver.Solve();
            programs++;
            if (status != Solver.ResultStatus.OPTIMAL)
            {
                rounds.Add(Round(status.ToString(), m, leaves.Count, rows, step));
                if (programs == 1 && conditions.Mirrors.Count > 0)
                {
                    break;   // the start breaks a mirror pair and cannot reach it in one box; leave it to Stage 2
                }
                radius /= 2;
                continue;
            }
            var next = leaves.ToDictionary(v => v, v => (x[v].SolutionValue(), y[v].SolutionValue()));
            double mNext = Scale(definitions, next);
            bool better = mNext > m * (1 + 1e-9) + 1e-12;
            rounds.Add(Round(better ? "Improved" : "Stalled", mNext, leaves.Count, rows, step));
            if (better)
            {
                u = next;
                m = mNext;
                improvements++;
                radius = Math.Min(n / 2.0, radius * 1.5);
            }
            else
            {
                radius /= 2;
            }
        }
        return new Result(u, m, programs, improvements);

        static StageRound Round(string outcome, double m, int leaves, int rows, Stopwatch sw) => new()
        {
            Stage = 1,
            Kind = "LP",
            Scale = m,
            Outcome = outcome,
            Variables = 2 * leaves + 1,
            Constraints = rows,
            FreeLeaves = leaves,
            Milliseconds = sw.Elapsed.TotalMilliseconds,
        };
    }

    /// <summary>min ‖uᵢ − uⱼ‖ / ℓᵢⱼ for a continuous layout.</summary>
    public static double Scale(Definitions definitions, IReadOnlyDictionary<int, (double X, double Y)> u)
    {
        double best = double.PositiveInfinity;
        foreach (var pair in definitions.Tree.Pairs)
        {
            var (xi, yi) = u[pair.I];
            var (xj, yj) = u[pair.J];
            best = Math.Min(best, Math.Sqrt((xi - xj) * (xi - xj) + (yi - yj) * (yi - yj)) / definitions.PathLength(pair));
        }
        return best;
    }

    /// <summary>
    /// Starting layouts: leaves evenly around the border in depth-first order (where TreeMaker puts them), then the
    /// same start jittered. Every start is moved inside the leaf conditions.
    /// </summary>
    public static IEnumerable<Dictionary<int, (double X, double Y)>> Starts(ProblemSpec spec, Placement.Conditions conditions, int count, int seed)
    {
        int n = spec.GridSize;
        var order = Placement.DepthFirstLeaves(spec.Tree);
        var random = new Random(seed);
        double perimeter = 4.0 * n;
        for (int s = 0; s < count; s++)
        {
            var start = new Dictionary<int, (double X, double Y)>();
            double shift = s == 0 ? 0 : random.NextDouble() * perimeter / order.Count;
            for (int k = 0; k < order.Count; k++)
            {
                double t = (perimeter * k / order.Count + shift) % perimeter;
                (double X, double Y) p = t < n ? (t, 0.0) : t < 2 * n ? ((double)n, t - n) : t < 3 * n ? (3.0 * n - t, (double)n) : (0.0, 4.0 * n - t);
                if (s > 0)
                {
                    p = (p.X + Gaussian(random) * n / 10, p.Y + Gaussian(random) * n / 10);
                }
                var (x0, x1, y0, y1) = conditions.Box(order[k]);
                start[order[k]] = (Math.Clamp(p.X, x0, x1), Math.Clamp(p.Y, y0, y1));
            }
            foreach (var (a, b) in conditions.Mirrors)
            {
                var (ax, ay) = start[a];
                start[b] = (n - ax, ay);
            }
            yield return start;
        }
    }

    private static double Gaussian(Random random)
    {
        double u1 = 1 - random.NextDouble(), u2 = random.NextDouble();
        return Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2);
    }
}
