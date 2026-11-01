using TreeMaker.Optimized;
using TreeMaker.Core;
using TreeMaker.Pure;

namespace TreeMaker.Web.Optimized;

/// <summary>
/// Bisection over candidate scales with lattice-hull feasibility models (map nodes "Optimized MILP" and, with
/// symmetry breaking switched off, "Lattice-Hull MILP"). Mapped under /api/optimized.
/// </summary>
public static class OptimizedEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        // Everything that is known before solving: candidates, test count, and model sizes.
        api.MapPost("/analyze", (ProblemDto problem) => Solving.Checked(() =>
        {
            var spec = problem.ToSpec();
            var defs = new Definitions(spec.Tree, spec.GridSize);
            var cache = new HullCache(spec.GridSize);
            var symmetry = problem.Options.SymmetryBreaking ? SymmetryBreaking.Create(spec) : SymmetryBreaking.None(spec.GridSize);
            var candidates = CandidateScales.Compute(defs);

            double? seedScale = null;
            FeasibilityEstimate? atSeed = null;
            if (problem.Options.UseSeed && spec.LeafConditions.Count == 0 && spec.MirrorPairs.Count == 0
                && SeedLayout.Create(defs) is { } seed)
            {
                seedScale = SeedLayout.Scale(defs, seed);
                atSeed = OptimizedSolver.EstimateFeasibility(spec, defs, symmetry, cache, seedScale.Value);
            }

            return new AnalysisDto
            {
                Leaves = spec.Tree.Leaves.Count,
                Pairs = spec.Tree.Pairs.Count,
                ScaleUpperBound = defs.ScaleUpperBound,
                CandidateCount = candidates.Count,
                DistinctSquaredLengths = CandidateScales.SquaredLengths(spec.GridSize).Count,
                DistinctPathLengths = spec.Tree.Pairs.Select(defs.PathLength).Distinct().Count(),
                MaxTests = candidates.Count <= 1 ? candidates.Count : (int)Math.Ceiling(Math.Log2(candidates.Count)),
                SeedScale = seedScale,
                WorstCaseBinaries = OptimizedSolver.WorstCaseBinaries(defs, cache),
                AtSeed = atSeed,
                BaseModel = ModelSize.Predict(spec),
                Symmetry = new SymmetryReport(
                    symmetry.Anchor is int a ? spec.Tree.Name(a) : null,
                    symmetry.SiblingGroups.Select(g => (IReadOnlyList<string>)g.Select(spec.Tree.Name).ToArray()).ToArray(),
                    symmetry.Note),
            };
        }));

        api.MapPost("/solve", async (ProblemDto problem, SolveCoordinator coordinator) =>
        {
            ProblemSpec spec;
            try
            {
                spec = problem.ToSpec();
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            return await Solving.Run(coordinator, token => OptimizedSolver.Solve(spec, problem.Options, token));
        });

        api.MapPost("/layout", (ImportLayoutRequest<ProblemDto> request) => Solving.Checked(() =>
        {
            var spec = (request.Problem with { StartLayout = null }).ToSpec();
            var e = LayoutImport.Evaluate(spec, request.Layout.Select(p => (p.Leaf, p.X, p.Y)), request.Scale, request.EdgeLengths);
            return new OptimizedResult
            {
                Status = SolveStatus.Feasible,
                Scale = e.Scale,
                TreeMakerScale = e.Scale / spec.GridSize,
                UpperBound = null,
                Layout = e.Layout,
                Pairs = e.Pairs,
                EdgeLengths = e.EdgeLengths,
                Violations = e.Violations,
                BaseModel = ModelSize.Predict(spec),
                Symmetry = new SymmetryReport(null, Array.Empty<IReadOnlyList<string>>(), null),
                Messages = e.Messages,
            };
        }));
    }
}
