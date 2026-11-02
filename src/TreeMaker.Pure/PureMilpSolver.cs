using System.Diagnostics;
using Google.OrTools.LinearSolver;
using TreeMaker.Core;

namespace TreeMaker.Pure;

/// <summary>Builds and solves the models of the Pure MILP doc with SCIP.</summary>
public static class PureMilpSolver
{
    /// <summary>
    /// Solves <paramref name="spec"/>. Edge optimization without a fixed scale first solves the scale stage and
    /// uses its optimum m* as m₀, seeding the second solve with the stage-one layout (Section 8.2).
    /// Cancelling <paramref name="cancellationToken"/> interrupts SCIP; the best layout found so far is returned.
    /// </summary>
    public static SolveResult Solve(ProblemSpec spec, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(spec);
        spec.Validate();
        var definitions = new Definitions(spec.Tree, spec.GridSize);

        switch (spec.Stage)
        {
            case Stage.Scale:
                return SolveOne(spec, definitions, 0, hint: spec.StartLayout, stageOne: null, cancellationToken);

            case Stage.Edge when spec.FixedScale is double fixedScale:
                return SolveOne(spec, definitions, fixedScale, hint: spec.StartLayout, stageOne: null, cancellationToken);

            case Stage.Edge:
                var first = SolveOne(spec with { Stage = Stage.Scale }, definitions, 0, spec.StartLayout, null, cancellationToken);
                if (!first.HasLayout || first.Scale is not double mStar)
                {
                    return new SolveResult
                    {
                        Stage = Stage.Edge,
                        Status = first.Status,
                        StageOne = first,
                        Model = first.Model,
                        Messages = new[] { "The scale stage found no layout, so there is no m₀ for edge optimization." },
                    };
                }
                if (cancellationToken.IsCancellationRequested)
                {
                    // Interrupted during the scale stage: report what it found rather than nothing.
                    return first with
                    {
                        Messages = first.Messages
                            .Append("Interrupted during the scale stage; edge optimization did not run.")
                            .ToArray(),
                    };
                }
                return SolveOne(spec, definitions, mStar, first.Layout, first, cancellationToken);

            default:
                return SolveOne(spec, definitions, spec.TargetScale, hint: spec.StartLayout, stageOne: null, cancellationToken);
        }
    }

    private static SolveResult SolveOne(ProblemSpec spec, Definitions definitions, double fixedScale,
        IReadOnlyList<LeafPlacement>? hint, SolveResult? stageOne, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var buildClock = Stopwatch.StartNew();
        using var model = PureMilpModel.Build(spec, definitions, fixedScale);
        buildClock.Stop();
        cancellationToken.ThrowIfCancellationRequested();

        var solver = model.Solver;
        var messages = new List<string>();
        if (model.Symmetry is { } symmetry)
        {
            messages.Add(DescribeSymmetry(spec.Tree, symmetry));
            if (hint is not null)
            {
                // The hint must satisfy conditions C:6 and C:7, so map it to its equivalent layout first.
                bool imported = ReferenceEquals(hint, spec.StartLayout);
                var canonical = symmetry.Canonicalize(hint.ToDictionary(p => p.Vertex, p => (p.X, p.Y)));
                hint = hint.Select(p => p with { X = canonical[p.Vertex].X, Y = canonical[p.Vertex].Y }).ToArray();
                if (imported)
                {
                    messages.Add("The starting layout (the workbench layout or a layout file) was turned and reflected into the fundamental domain and passed to SCIP as a solution hint.");
                }
            }
        }
        if (hint is not null)
        {
            model.SetHint(hint);
            if (ReferenceEquals(hint, spec.StartLayout))
            {
                messages.Add("The starting layout (the workbench layout or a layout file) was passed to SCIP as a solution hint.");
            }
        }
        if (spec.Solver.TimeLimit is TimeSpan limit)
        {
            solver.SetTimeLimit((long)Math.Max(1, limit.TotalMilliseconds));
        }
        if (spec.Solver.Threads is int threads)
        {
            solver.SetNumThreads(threads);
        }
        if (spec.Solver.LogToConsole)
        {
            solver.EnableOutput();
        }

        using var parameters = new MPSolverParameters();
        parameters.SetDoubleParam(MPSolverParameters.DoubleParam.RELATIVE_MIP_GAP, spec.Solver.RelativeGap);

        var solveClock = Stopwatch.StartNew();
        Solver.ResultStatus raw;
        using (cancellationToken.Register(() => solver.InterruptSolve()))
        {
            raw = solver.Solve(parameters);
        }
        solveClock.Stop();
        if (cancellationToken.IsCancellationRequested)
        {
            messages.Add("The solve was interrupted.");
        }

        var status = raw switch
        {
            Solver.ResultStatus.OPTIMAL => SolveStatus.Optimal,
            Solver.ResultStatus.FEASIBLE => SolveStatus.Feasible,
            Solver.ResultStatus.INFEASIBLE => SolveStatus.Infeasible,
            Solver.ResultStatus.NOT_SOLVED => SolveStatus.NoSolutionFound,
            _ => SolveStatus.Error,
        };
        if (status == SolveStatus.Error)
        {
            messages.Add($"SCIP returned {raw}.");
        }

        var result = new SolveResult
        {
            Stage = spec.Stage,
            Status = status,
            Model = model.Metrics,
            Metrics = new SolveMetrics
            {
                BuildTime = buildClock.Elapsed,
                SolveTime = solveClock.Elapsed,
                Nodes = solver.Nodes(),
                Iterations = solver.Iterations(),
            },
            StageOne = stageOne,
            Messages = messages,
        };

        if (status is not (SolveStatus.Optimal or SolveStatus.Feasible))
        {
            return result;
        }

        return WithSolution(result, spec, definitions, model, fixedScale);
    }

    private static SolveResult WithSolution(SolveResult result, ProblemSpec spec, Definitions definitions,
        PureMilpModel model, double fixedScale)
    {
        var tree = spec.Tree;
        var layout = tree.Leaves
            .Select(leaf =>
            {
                int k = tree.LeafIndex(leaf);
                return new LeafPlacement(tree.Name(leaf), leaf,
                    (int)Math.Round(model.X[k].SolutionValue()), (int)Math.Round(model.Y[k].SolutionValue()));
            })
            .ToArray();

        var objective = model.Solver.Objective();
        double value = objective.Value();
        double bound = objective.BestBound();
        double? gap = double.IsFinite(bound) ? Math.Abs(value - bound) / Math.Max(1e-12, Math.Abs(value)) : null;

        var strains = new double[tree.Edges.Count];
        double? stretch = null;
        double? total = null;
        double? largest = null;
        double scale;

        switch (spec.Stage)
        {
            case Stage.Scale:
                // Report the layout's exact scale rather than the solver's floating-point m.
                scale = LayoutAnalysis.ExactScale(definitions, layout);
                break;

            case Stage.Edge:
                scale = fixedScale;
                stretch = Math.Max(0, model.Stretch!.SolutionValue());
                foreach (int e in spec.StretchSet)
                {
                    strains[e] = stretch.Value;
                }
                break;

            default:
                scale = fixedScale;
                for (int e = 0; e < strains.Length; e++)
                {
                    strains[e] = CleanZero(model.Strain![e].SolutionValue());
                }
                total = strains.Sum(s => Math.Abs(s));
                largest = strains.Max(s => Math.Abs(s));
                break;
        }

        var lengths = tree.Edges.Select(e => e.Length * (1 + strains[e.Index])).ToArray();
        var edgeReports = tree.Edges
            .Select(e => new EdgeReport(e.Index, tree.EdgeLabel(e.Index), e.Length, strains[e.Index], lengths[e.Index]))
            .ToArray();

        // The scale stage checks the input lengths; edge and strain check the stretched or strained lengths.
        var checkLengths = spec.Stage == Stage.Scale ? null : lengths;

        var messages = result.Messages.ToList();
        if (gap is double g && g > 1e-9 && result.Status == SolveStatus.Optimal)
        {
            messages.Add($"SCIP stopped within the {spec.Solver.RelativeGap:0.####%} relative gap ({g:0.####%} reached), " +
                $"so the objective is within that gap of optimal rather than proved optimal; the best bound is {bound:0.######}.");
        }

        return result with
        {
            Messages = messages,
            Objective = value,
            BestBound = double.IsFinite(bound) ? bound : null,
            RelativeGap = gap,
            Scale = scale,
            TreeMakerScale = scale / spec.GridSize,
            Stretch = stretch,
            TotalStrain = total,
            LargestStrain = largest,
            Layout = layout,
            Pairs = LayoutAnalysis.Pairs(definitions, layout, scale, checkLengths),
            EdgeLengths = edgeReports,
            Violations = LayoutAnalysis.Violations(spec, layout, scale, checkLengths),
        };
    }

    private static double CleanZero(double v) => Math.Abs(v) < 1e-9 ? 0 : v;

    /// <summary>One line on the symmetry breaking in the model (Symmetry-Breaking MILP doc; conditions C:6 and C:7).</summary>
    private static string DescribeSymmetry(Tree tree, SymmetryBreaking symmetry)
    {
        var parts = new List<string>
        {
            symmetry.Anchor is int a
                ? $"Symmetry breaking: anchor leaf {tree.Name(a)} in the fundamental domain 0 ≤ y ≤ x ≤ N/2 (conditions C:6)."
                : "Symmetry breaking: no anchor leaf.",
        };
        if (symmetry.SiblingGroups.Count > 0)
        {
            parts.Add("Interchangeable siblings in order (conditions C:7): " +
                string.Join("; ", symmetry.SiblingGroups.Select(g => string.Join(" ≤ ", g.Select(tree.Name)))) + ".");
        }
        if (symmetry.Note is { } note) parts.Add(note);
        return string.Join(" ", parts);
    }
}
