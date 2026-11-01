namespace PureMilpTreeMaker;

/// <summary>An imported layout, checked against the tree: its scale, pair spacing, edge lengths and any violations.</summary>
public sealed record LayoutEvaluation(
    double Scale,
    double ExactScale,
    IReadOnlyList<LeafPlacement> Layout,
    IReadOnlyList<PairReport> Pairs,
    IReadOnlyList<EdgeReport> EdgeLengths,
    IReadOnlyList<string> Violations,
    IReadOnlyList<string> Messages);

/// <summary>
/// Checks a layout read from a layout file (schemas/treemaker-layout.schema.json) so the apps can show it as if they
/// had just solved it, and offer it as the starting point of the next solve.
/// </summary>
public static class LayoutImport
{
    /// <param name="spec">The problem the layout belongs to (its tree, grid and conditions).</param>
    /// <param name="points">Every leaf's grid point.</param>
    /// <param name="scale">The scale saved with the layout; the layout's exact scale is used when it is missing or too large.</param>
    /// <param name="edgeLengths">The edge lengths the layout was solved or closed with, by edge index; the tree's when null.</param>
    public static LayoutEvaluation Evaluate(ProblemSpec spec, IEnumerable<(string Leaf, int X, int Y)> points,
        double? scale, IReadOnlyList<double>? edgeLengths)
    {
        ArgumentNullException.ThrowIfNull(spec);
        var tree = spec.Tree;
        var layout = ActivePaths.Place(tree, points);
        foreach (var p in layout)
        {
            if (p.X < 0 || p.Y < 0 || p.X > spec.GridSize || p.Y > spec.GridSize)
            {
                throw new ArgumentException($"Leaf {p.Leaf} is at ({p.X}, {p.Y}), outside the {spec.GridSize} × {spec.GridSize} grid.");
            }
        }
        if (edgeLengths is { } given)
        {
            if (given.Count != tree.Edges.Count)
            {
                throw new ArgumentException($"The layout has {given.Count} edge lengths, but the tree has {tree.Edges.Count} edges.");
            }
            if (given.Any(l => !(l > 0) || double.IsInfinity(l)))
            {
                throw new ArgumentException("Every edge length must be a positive number.");
            }
        }
        var lengths = edgeLengths?.ToArray();
        bool strained = lengths is not null && lengths.Select((l, e) => Math.Abs(l - tree.Edges[e].Length) > 1e-12).Any(b => b);
        if (!strained) lengths = null;

        var definitions = new Definitions(tree, spec.GridSize);
        double exact = LayoutAnalysis.ExactScale(definitions, layout, lengths);
        if (!(exact > 0))
        {
            throw new ArgumentException("Two leaves share a grid point, so the layout has no positive scale.");
        }

        var messages = new List<string>();
        double use = exact;
        if (scale is double s && s > 0)
        {
            if (s <= exact * (1 + 1e-9))
            {
                use = s;
            }
            else
            {
                messages.Add($"The given scale {s:0.######} is larger than this layout allows; using its exact scale {exact:0.######}.");
            }
        }
        messages.Add($"Layout read back from the workbench or a file: {layout.Length} leaves on a {spec.GridSize} × {spec.GridSize} grid at scale m = {use:0.######}" +
            (strained ? ", with the edge lengths saved with it." : "."));

        var pairs = LayoutAnalysis.Pairs(definitions, layout, use, lengths);
        var violations = LayoutAnalysis.Violations(spec with { Stage = Stage.Scale }, layout, use, lengths);
        var edges = lengths is null
            ? Array.Empty<EdgeReport>()
            : tree.Edges.Select(e => new EdgeReport(e.Index, tree.EdgeLabel(e.Index), e.Length, lengths[e.Index] / e.Length - 1, lengths[e.Index])).ToArray();
        return new LayoutEvaluation(use, exact, layout, pairs, edges, violations, messages);
    }
}
