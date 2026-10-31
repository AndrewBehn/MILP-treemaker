using PureMilpTreeMaker;

namespace PureMilpTreeMaker.Tests;

/// <summary>Find the strain needed, as LPs (StrainNeeded), checked against the closing MILP.</summary>
public class StrainNeededTests
{
    private static (ProblemSpec Spec, LeafPlacement[] Layout, double Scale) RunningExampleAtOptimum()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var at = new Dictionary<string, (int X, int Y)> { ["1"] = (0, 0), ["2"] = (6, 0), ["3"] = (0, 9), ["4"] = (9, 9) };
        var layout = tree.Leaves.Select(v => new LeafPlacement(tree.Name(v), v, at[tree.Name(v)].X, at[tree.Name(v)].Y)).ToArray();
        return (spec, layout, LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout));
    }

    [Fact]
    public void TheRunningExampleNeedsAbout045()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        var need = StrainNeeded.Find(spec, layout, scale);
        Assert.True(need.BoundaryValid);
        Assert.Equal(0.448683, need.BoundaryStrain!.Value, 5);   // between ±0.3 (does not close) and ±0.5 (closes)
        Assert.Equal(4, need.TightTargets.Count);

        // Closing at that bound with those targets reproduces valid polygons.
        double b = Math.Ceiling(need.BoundaryStrain.Value * 1000 + 1e-9) / 1000;
        var closed = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions
        {
            StrainMin = -b, StrainMax = b, Targets = need.TightTargets,
        });
        Assert.True(closed.After!.Valid, string.Join(" ", closed.After.Issues));
    }

    [Fact]
    public void AValidLayoutNeedsNoStrain()
    {
        var tree = Tree.FromEdges(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) });
        var layout = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 4, 0), ("3", 4, 4), ("4", 0, 4) });
        var need = StrainNeeded.Find(new ProblemSpec { Tree = tree, GridSize = 4 }, layout, 2.0);
        Assert.True(need.AlreadyValid);
        Assert.Equal(0, need.BoundaryStrain);
    }
}
