
namespace TreeMaker.Core.Tests;

/// <summary>Step 3 (universal molecule) and the folded base. Expected counts were checked with a Python prototype.</summary>
public class CreasePatternTests
{
    private static (ProblemSpec Spec, LeafPlacement[] Layout) Setup(IEnumerable<(string, string, double)> edges, int n,
        params (string Leaf, int X, int Y)[] at)
    {
        var tree = Tree.FromEdges(edges);
        return (new ProblemSpec { Tree = tree, GridSize = n }, ActivePaths.Place(tree, at));
    }

    private static Dictionary<CreaseKind, int> Count(CreasePatternResult r) =>
        r.Creases.GroupBy(c => c.Kind).ToDictionary(g => g.Key, g => g.Count());

    [Fact]
    public void Rabbit_ear_molecule()
    {
        // A 6-8-10 triangle with legs equal to its tangent lengths: 2, 6, 4.
        var (spec, layout) = Setup(new[] { ("A", "c", 2.0), ("B", "c", 6.0), ("C", "c", 4.0) }, 8,
            ("A", 0, 0), ("B", 8, 0), ("C", 0, 6));
        var r = CreasePatternBuilder.Build(spec, layout, 1.0);
        Assert.True(r.Built, string.Join(" ", r.Messages));
        Assert.Empty(r.Problems);
        Assert.Equal(6, r.Facets.Count);
        var k = Count(r);
        Assert.Equal(3, k[CreaseKind.Axial]);
        Assert.Equal(3, k[CreaseKind.Ridge]);
        Assert.Equal(3, k[CreaseKind.Hinge]);
        Assert.Equal(2.0, r.MaxElevation, 9);   // the inradius of a 6-8-10 triangle
    }

    [Fact]
    public void Square_base_from_four_equal_legs()
    {
        var (spec, layout) = Setup(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) }, 9,
            ("1", 0, 0), ("2", 9, 0), ("3", 9, 9), ("4", 0, 9));
        var r = CreasePatternBuilder.Build(spec, layout, 4.5);
        Assert.True(r.Built, string.Join(" ", r.Messages));
        Assert.Empty(r.Problems);
        Assert.Equal(8, r.Facets.Count);
        var k = Count(r);
        Assert.Equal(4, k[CreaseKind.Axial]);
        Assert.Equal(4, k[CreaseKind.Ridge]);
        Assert.Equal(4, k[CreaseKind.Hinge]);
        Assert.Equal(4.5, r.MaxElevation, 9);
        // Every facet lies over a leg and keeps its shape: each spans the whole leg (0 to 4.5 along it).
        Assert.All(r.Facets, f => Assert.Equal(4.5, f.Along.Max() - f.Along.Min(), 9));
    }

    [Fact]
    public void Running_example_after_closing_has_a_gusset_and_folds_cleanly()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var layout = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 6, 0), ("3", 0, 9), ("4", 9, 9) });
        double scale = LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout);
        var closed = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions { StrainMin = -0.5, StrainMax = 0.5 });
        Assert.True(closed.After!.Valid);
        Assert.Equal(1.724004, closed.TotalStrain, 4);

        var r = CreasePatternBuilder.Build(spec, layout, scale, closed.EdgeLengths.Select(e => e.NewLength).ToArray());
        Assert.True(r.Built, string.Join(" ", r.Messages));
        Assert.Empty(r.Problems);
        Assert.Equal(26, r.Facets.Count);
        Assert.Equal(1, r.MaxDepth);
        var k = Count(r);
        Assert.Equal(4, k[CreaseKind.Axial]);
        Assert.Equal(1, k[CreaseKind.Gusset]);   // shared by the two pieces it splits, kept once
        Assert.Equal(16, k[CreaseKind.Hinge]);
        Assert.Equal(10, k[CreaseKind.Ridge]);
    }

    [Fact]
    public void Result_serializes_as_the_web_api_sends_it()
    {
        var (spec, layout) = Setup(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) }, 9,
            ("1", 0, 0), ("2", 9, 0), ("3", 9, 9), ("4", 0, 9));
        var r = CreasePatternBuilder.Build(spec, layout, 4.5);
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        options.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals;
        string json = System.Text.Json.JsonSerializer.Serialize(r, options);
        Assert.Contains("\"kind\":\"Ridge\"", json);
        Assert.Contains("\"x\":", json);
        Assert.DoesNotContain("\"unit\"", json);
    }

    [Fact]
    public void Completion_and_polygon_results_serialize_too()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var layout = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 6, 0), ("3", 0, 9), ("4", 9, 9) });
        double scale = LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout);
        var closed = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions { StrainMin = -0.5, StrainMax = 0.5 });
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        options.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        options.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals;
        Assert.Contains("\"valid\":true", System.Text.Json.JsonSerializer.Serialize(closed, options));
    }

    [Theory]
    [InlineData(1.0, 40, 16)]
    [InlineData(2.0, 24, 8)]
    public void Pleating_the_square_base_brings_it_down_to_the_pleat_height(double h, int facets, int perKind)
    {
        var (spec, layout) = Setup(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) }, 9,
            ("1", 0, 0), ("2", 9, 0), ("3", 9, 9), ("4", 0, 9));
        var r = CreasePatternBuilder.Build(spec, layout, 4.5, pleatHeight: h);
        Assert.True(r.Built);
        Assert.Empty(r.Problems);
        Assert.Equal(4.5, r.MaxElevation, 9);
        Assert.Equal(h, r.FoldedHeight, 9);
        Assert.Equal(facets, r.Facets.Count);
        var pleats = r.Creases.Where(c => c.Kind == CreaseKind.Pleat).ToList();
        Assert.Equal(perKind, pleats.Count(c => c.Assignment == "M"));
        Assert.Equal(perKind, pleats.Count(c => c.Assignment == "V"));
        Assert.All(r.Facets, f => Assert.All(f.Height, z => Assert.InRange(z, -1e-9, h + 1e-9)));
    }

    [Theory]
    [InlineData(0.0, 0.0)]
    [InlineData(0.5, 0.5)]
    [InlineData(1.0, 1.0)]
    [InlineData(1.5, 0.5)]
    [InlineData(2.0, 0.0)]
    [InlineData(3.25, 0.75)]
    public void Pleated_height_is_a_triangle_wave(double z, double expected)
    {
        Assert.Equal(expected, CreasePatternBuilder.PleatedHeight(z, 1.0), 12);
    }

    [Fact]
    public void An_open_layout_is_not_built()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var layout = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 6, 0), ("3", 0, 9), ("4", 9, 9) });
        double scale = LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout);
        var r = CreasePatternBuilder.Build(spec, layout, scale);
        Assert.False(r.Built);
        Assert.Empty(r.Facets);
    }

    [Fact]
    public void Square_is_closed_without_touching_its_diagonal()
    {
        var (spec, layout) = Setup(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) }, 9,
            ("1", 0, 0), ("2", 9, 0), ("3", 9, 9), ("4", 0, 9));
        var closed = PolygonCompletion.Complete(spec, layout, 4.5);
        Assert.True(closed.After!.Valid);
        Assert.Equal(0, closed.TotalStrain, 9);
        Assert.Single(closed.After.Polygons);
    }

    [Fact]
    public void Tree_geometry_walks_through_internal_nodes()
    {
        var tree = RunningExample.Tree();
        var g = new TreeGeometry(tree, tree.Edges.Select(e => e.Length).ToArray());
        var leaf1 = TreePoint.AtNode(tree.Id("1"));
        var leaf4 = TreePoint.AtNode(tree.Id("4"));
        Assert.Equal(10, g.Distance(leaf1, leaf4), 12);
        Assert.Equal(new[] { 3.0, 6.0 }, g.InnerNodes(leaf1, leaf4));   // u at 3, v at 6
        var mid = g.Walk(leaf1, leaf4, 4.5);                               // halfway along u–v
        Assert.Equal(4.5, g.Distance(leaf1, mid), 12);
        Assert.Equal(5.5, g.Distance(mid, leaf4), 12);
    }
}
