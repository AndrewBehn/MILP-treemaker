using TreeMaker.Core;
using TreeMaker.Pure;
using TreeMaker.Scalable;

namespace TreeMaker.Web.Scalable;

/// <summary>The four-stage pipeline of the Scalable MILP doc (map node "Scalable MILP"). Mapped under /api/scalable.</summary>
public static class ScalableEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        // Everything that is known before solving: the size of each stage's models.
        api.MapPost("/analyze", (ProblemDto problem) => Solving.Checked(() => ScalableSolver.Analyze(problem.ToSpec(), problem.Options)));

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
            return await Solving.Run(coordinator, token => ScalableSolver.Solve(spec, problem.Options, token));
        });

        api.MapPost("/layout", (ImportLayoutRequest<ProblemDto> request) => Solving.Checked(() =>
        {
            var spec = (request.Problem with { StartLayout = null }).ToSpec();
            var e = LayoutImport.Evaluate(spec, request.Layout.Select(p => (p.Leaf, p.X, p.Y)), request.Scale, request.EdgeLengths);
            var defs = new Definitions(spec.Tree, spec.GridSize);
            return new ScalableResult
            {
                Status = SolveStatus.Feasible,
                Scale = e.Scale,
                TreeMakerScale = e.Scale / spec.GridSize,
                UpperBound = defs.ScaleUpperBound,
                Layout = e.Layout,
                Pairs = e.Pairs,
                EdgeLengths = e.EdgeLengths,
                Violations = e.Violations,
                PolygonsValid = ActivePaths.Analyze(e.Layout, e.Pairs).Valid,
                BaseModel = ModelSize.Predict(spec with { Stage = Stage.Scale }),
                Messages = e.Messages,
            };
        }));
    }
}
