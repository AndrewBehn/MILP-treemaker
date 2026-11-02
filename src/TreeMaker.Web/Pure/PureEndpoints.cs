using System.Diagnostics;
using TreeMaker.Core;
using TreeMaker.Pure;

namespace TreeMaker.Web.Pure;

/// <summary>
/// The base model of the Pure MILP doc, solved with SCIP (map nodes "Pure MILP" and, with
/// <see cref="ProblemDto.SymmetryBreaking"/> set, "Symmetry-Breaking MILP"). Mapped under /api/pure.
/// </summary>
public static class PureEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        // Definitions (sheet D:1, offsets D:2, sheet D:3, base D:1) and the predicted model size, without solving.
        api.MapPost("/analyze", (ProblemDto problem) => Solving.Checked(() =>
        {
            var spec = problem.ToSpec();
            var tree = spec.Tree;
            var definitions = new Definitions(tree, spec.GridSize);
            var stretch = new HashSet<int>(spec.StretchSet);
            return new AnalysisDto(
                tree.Leaves.Select(tree.Name).ToArray(),
                Enumerable.Range(0, tree.VertexCount).Where(v => !tree.IsLeaf(v)).Select(tree.Name).ToArray(),
                tree.Pairs.Select(p => new PairLengthDto(
                    tree.Name(p.I), tree.Name(p.J), definitions.PathLength(p), definitions.StretchableLength(p, stretch))).ToArray(),
                definitions.MaxPathLength,
                definitions.MinPathLength,
                definitions.ScaleUpperBound,
                ModelSize.Predict(spec));
        }));

        // Build and solve in this process. One solve runs at a time (any variant); a second request gets 409.
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
            var clock = Stopwatch.StartNew();
            return await Solving.Run(coordinator, token => SolveResponse.From(PureMilpSolver.Solve(spec, token), clock.Elapsed));
        });

        // A layout from the workbench or a layout file, shown as if just solved: exact scale, pair spacing, violations.
        api.MapPost("/layout", (ImportLayoutRequest<ProblemDto> request) => Solving.Checked(() =>
        {
            var spec = (request.Problem with { StartLayout = null }).ToSpec();
            var e = LayoutImport.Evaluate(spec, request.Layout.Select(p => (p.Leaf, p.X, p.Y)), request.Scale, request.EdgeLengths);
            var result = new SolveResult
            {
                Stage = Stage.Scale,
                Status = SolveStatus.Feasible,
                SolverName = "Workbench layout",
                Objective = e.Scale,
                Scale = e.Scale,
                TreeMakerScale = e.Scale / spec.GridSize,
                Layout = e.Layout,
                Pairs = e.Pairs,
                EdgeLengths = e.EdgeLengths,
                Violations = e.Violations,
                Model = ModelSize.Predict(spec with { Stage = Stage.Scale }),
                Messages = e.Messages,
            };
            return SolveResponse.From(result, TimeSpan.Zero);
        }));
    }
}
