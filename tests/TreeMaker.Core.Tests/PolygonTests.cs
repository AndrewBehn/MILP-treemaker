
namespace TreeMaker.Core.Tests;

/// <summary>Steps 1 and 2 toward a crease pattern. Expected values were checked with a Python prototype.</summary>
public class PolygonTests
{
    private static IReadOnlyDictionary<string, (long X, long Y)> Points(params (string Name, long X, long Y)[] p) =>
        p.ToDictionary(x => x.Name, x => (x.X, x.Y));

    private static LeafPairName[] Pairs(params string[] ab) => ab.Select(s => s.Split('-')).Select(s => new LeafPairName(s[0], s[1])).ToArray();

    [Fact]
    public void Square_of_tight_paths_is_one_valid_polygon()
    {
        var report = ActivePaths.Analyze(
            Points(("1", 0, 0), ("2", 9, 0), ("3", 0, 9), ("4", 9, 9)),
            Pairs("1-2", "2-4", "4-3", "3-1"));
        Assert.True(report.Valid, string.Join(" ", report.Issues));
        var polygon = Assert.Single(report.Polygons);
        Assert.Equal(4, polygon.Leaves.Count);
        Assert.True(polygon.Convex);
        Assert.Equal(81, report.CoveredArea, 9);
        Assert.Equal(81, report.HullArea, 9);
    }

    [Fact]
    public void One_tight_pair_leaves_the_boundary_open()
    {
        var report = ActivePaths.Analyze(
            Points(("1", 0, 0), ("2", 6, 0), ("3", 0, 9), ("4", 9, 9)),
            Pairs("2-4"));
        Assert.False(report.Valid);
        Assert.Empty(report.Polygons);
        Assert.Equal(3, report.MissingBoundary.Count);
    }

    [Fact]
    public void Crossing_tight_paths_are_reported()
    {
        var report = ActivePaths.Analyze(
            Points(("1", 0, 0), ("2", 4, 0), ("3", 0, 4), ("4", 4, 4)),
            Pairs("1-2", "2-4", "4-3", "3-1", "1-4", "2-3"));
        Assert.False(report.Valid);
        Assert.Contains(report.Issues, i => i.Contains("cross"));
    }

    [Fact]
    public void A_leaf_inside_a_polygon_is_reported()
    {
        var report = ActivePaths.Analyze(
            Points(("1", 0, 0), ("2", 8, 0), ("3", 0, 8), ("4", 2, 2)),
            Pairs("1-2", "2-3", "3-1"));
        Assert.False(report.Valid);
        Assert.Equal(new[] { "4" }, Assert.Single(report.Polygons).LeavesInside);
    }

    [Fact]
    public void Triangles_from_a_triangulation_are_valid()
    {
        var points = Points(("1", 0, 0), ("2", 8, 0), ("3", 0, 8), ("4", 3, 3));
        var triangulation = ActivePaths.GreedyTriangulation(points, Array.Empty<LeafPairName>());
        Assert.Equal(6, triangulation.Count);   // 3 hull edges + 3 spokes to the inner leaf
        var report = ActivePaths.Analyze(points, triangulation);
        Assert.True(report.Valid, string.Join(" ", report.Issues));
        Assert.Equal(3, report.Polygons.Count);
    }

    [Fact]
    public void A_leaf_on_a_tight_path_splits_it()
    {
        var report = ActivePaths.Analyze(
            Points(("1", 0, 0), ("2", 8, 0), ("3", 0, 8), ("4", 4, 0)),
            Pairs("1-2", "2-3", "3-1"));
        Assert.True(report.Valid, string.Join(" ", report.Issues));
        Assert.Equal(4, Assert.Single(report.Polygons).Leaves.Count);
    }

    private static (ProblemSpec Spec, LeafPlacement[] Layout, double Scale) RunningExampleAtOptimum()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var at = new Dictionary<string, (int X, int Y)> { ["1"] = (0, 0), ["2"] = (6, 0), ["3"] = (0, 9), ["4"] = (9, 9) };
        var layout = tree.Leaves.Select(v => new LeafPlacement(tree.Name(v), v, at[tree.Name(v)].X, at[tree.Name(v)].Y)).ToArray();
        return (spec, layout, LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout));
    }

    [Fact]
    public void Running_example_completes_into_a_valid_polygon_with_wide_bounds()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        Assert.Equal(1.054093, scale, 5);
        var result = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions { StrainMin = -0.5, StrainMax = 0.5 });
        Assert.False(result.Before.Valid);
        Assert.True(result.After!.Valid, string.Join(" ", result.After.Issues));
        Assert.Equal(4, result.BoundaryTargets);
        Assert.Equal(4, result.BoundaryMadeTight);
        Assert.Empty(result.Violations);
        Assert.All(result.EdgeLengths, e => Assert.InRange(e.Strain, -0.5 - 1e-9, 0.5 + 1e-9));
    }

    [Fact]
    public void Narrow_bounds_close_only_part_of_the_boundary()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        var result = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions { StrainMin = -0.3, StrainMax = 0.3 });
        Assert.False(result.After!.Valid);
        Assert.Equal(3, result.BoundaryMadeTight);
        Assert.Empty(result.Violations);
        Assert.Equal(0.269187, result.TotalStrain, 4);
    }

    [Fact]
    public void Explicit_targets_are_respected()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        var result = PolygonCompletion.Complete(spec, layout, scale,
            options: new CompletionOptions { Targets = Pairs("1-2") });
        var target = Assert.Single(result.Targets);
        Assert.True(target.TightAfter);
        Assert.Empty(result.Violations);
    }
}
