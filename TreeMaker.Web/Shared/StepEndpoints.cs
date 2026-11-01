using PureMilpTreeMaker;
using TreeMaker.Web.Pure;

namespace TreeMaker.Web;

/// <summary>
/// The steps after a layout, shared by every solver: check the polygons, close them, build the crease pattern and the
/// folded base (map nodes "Close the polygons", "Crease pattern" and "Folded base"). They read only the tree, the grid
/// and the layout, so they take the base model's request shape; other variants' fields are ignored.
/// </summary>
public static class StepEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        // Step 1: do the tight paths divide the leaves' hull into valid polygons?
        api.MapPost("/polygons", (PolygonRequest request) => Solving.Checked(() =>
        {
            var spec = (request.Problem with { Stage = Stage.Scale, StartLayout = null }).ToSpec();
            var layout = ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
            var defs = new Definitions(spec.Tree, spec.GridSize);
            if (request.EdgeLengths is { } lengths && lengths.Count != spec.Tree.Edges.Count)
            {
                throw new ArgumentException("There must be one edge length per edge.");
            }
            var pairs = LayoutAnalysis.Pairs(defs, layout, request.Scale, request.EdgeLengths);
            return ActivePaths.Analyze(layout, pairs);
        }));

        // Step 2: change edge lengths so chosen pairs become tight and close the polygons, with the leaves held in place.
        api.MapPost("/complete", (PolygonRequest request) => Solving.CheckedAsync(() =>
        {
            var spec = (request.Problem with { Stage = Stage.Scale, StartLayout = null }).ToSpec();
            var layout = ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
            var options = new CompletionOptions
            {
                StrainMin = request.StrainMin ?? -0.3,
                StrainMax = request.StrainMax ?? 0.3,
                Targets = request.Targets ?? new List<LeafPairName>(),
                TimeLimit = spec.Solver.TimeLimit,
            };
            return PolygonCompletion.Complete(spec, layout, request.Scale, request.EdgeLengths, options);
        }));

        // "Find the strain needed": the smallest symmetric strain bound that closes the polygons, as one or two LPs.
        api.MapPost("/strain-needed", (PolygonRequest request) => Solving.CheckedAsync(() =>
        {
            var spec = (request.Problem with { Stage = Stage.Scale, StartLayout = null }).ToSpec();
            var layout = ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
            return StrainNeeded.Find(spec, layout, request.Scale, request.EdgeLengths);
        }));

        // Step 3: the crease pattern (universal molecules) and the folded base, for a layout whose polygons are valid.
        api.MapPost("/creases", (PolygonRequest request) => Solving.CheckedAsync(() =>
        {
            var spec = (request.Problem with { Stage = Stage.Scale, StartLayout = null }).ToSpec();
            var layout = ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
            return CreasePatternBuilder.Build(spec, layout, request.Scale, request.EdgeLengths,
                request.PleatHeight is > 0 ? request.PleatHeight : null);
        }));
    }
}
