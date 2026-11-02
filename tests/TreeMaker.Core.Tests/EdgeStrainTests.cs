namespace TreeMaker.Core.Tests;

/// <summary>Per-edge room and cost (strain D:3, TreeMaker foundations: strain) in the closing MILP and the strain LPs.</summary>
public class EdgeStrainTests
{
    private static (ProblemSpec Spec, LeafPlacement[] Layout, double Scale) RunningExampleAtOptimum()
    {
        var tree = RunningExample.Tree();
        var spec = new ProblemSpec { Tree = tree, GridSize = 9 };
        var at = new Dictionary<string, (int X, int Y)> { ["1"] = (0, 0), ["2"] = (6, 0), ["3"] = (0, 9), ["4"] = (9, 9) };
        var layout = tree.Leaves.Select(v => new LeafPlacement(tree.Name(v), v, at[tree.Name(v)].X, at[tree.Name(v)].Y)).ToArray();
        return (spec, layout, LayoutAnalysis.ExactScale(new Definitions(tree, 9), layout));
    }

    private static double[] Fill(int n, double v) => Enumerable.Repeat(v, n).ToArray();

    [Fact]
    public void UniformSettingsChangeNothing()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        int n = spec.Tree.Edges.Count;
        var plain = StrainNeeded.Find(spec, layout, scale);
        var ones = StrainNeeded.Find(spec, layout, scale, edgeStrain: new EdgeStrain { Room = Fill(n, 1), Cost = Fill(n, 1) });
        Assert.Equal(plain.BoundaryStrain!.Value, ones.BoundaryStrain!.Value, 6);
        // The boundary LP reports a strain per edge, at most the bound in size: what the page suggests room from.
        Assert.Equal(n, plain.BoundaryStrains.Count);
        Assert.All(plain.BoundaryStrains, v => Assert.True(Math.Abs(v) <= plain.BoundaryStrain.Value + 1e-6));
        Assert.Contains(plain.BoundaryStrains, v => Math.Abs(v) > 1e-6);
    }

    [Fact]
    public void ALockedEdgeKeepsItsLength()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        int n = spec.Tree.Edges.Count;
        var plain = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions { StrainMin = -0.6, StrainMax = 0.6 });
        int busiest = plain.EdgeLengths.OrderByDescending(e => Math.Abs(e.Strain)).First().Edge;
        Assert.NotEqual(0, plain.EdgeLengths[busiest].Strain);

        var room = Fill(n, 1);
        room[busiest] = 0;
        var locked = PolygonCompletion.Complete(spec, layout, scale, options: new CompletionOptions
        {
            StrainMin = -0.6, StrainMax = 0.6, Edges = new EdgeStrain { Room = room },
        });
        Assert.Equal(0, locked.EdgeLengths[busiest].Strain);
        Assert.All(locked.EdgeLengths, e => Assert.InRange(e.Strain, -0.6 - 1e-6, 0.6 + 1e-6));
    }

    [Fact]
    public void RoomScalesTheBoundAndTheLpBound()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        int n = spec.Tree.Edges.Count;
        var plain = StrainNeeded.Find(spec, layout, scale);
        // Doubling every edge's room halves the bound s the LP needs (each edge may take 2s).
        var doubled = StrainNeeded.Find(spec, layout, scale, edgeStrain: new EdgeStrain { Room = Fill(n, 2) });
        Assert.Equal(plain.BoundaryStrain!.Value / 2, doubled.BoundaryStrain!.Value, 5);
    }

    [Fact]
    public void BadSettingsAreRefused()
    {
        var (spec, layout, scale) = RunningExampleAtOptimum();
        int n = spec.Tree.Edges.Count;
        Assert.Throws<ArgumentException>(() => StrainNeeded.Find(spec, layout, scale, edgeStrain: new EdgeStrain { Room = Fill(n - 1, 1) }));
        Assert.Throws<ArgumentException>(() => PolygonCompletion.Complete(spec, layout, scale,
            options: new CompletionOptions { Edges = new EdgeStrain { Cost = Fill(n, -1) } }));
    }
}
