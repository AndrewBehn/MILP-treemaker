using PureMilpTreeMaker;

namespace PureMilpTreeMaker.Tests;

/// <summary>Layout files: checking an imported layout, and starting a solve from one.</summary>
public class LayoutImportTests
{
    private static ProblemSpec Star4(int n = 4) => new()
    {
        Tree = Tree.FromEdges(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) }),
        GridSize = n,
    };

    private static readonly (string, int, int)[] Corners = { ("1", 0, 0), ("2", 4, 0), ("3", 4, 4), ("4", 0, 4) };

    [Fact]
    public void CornersOfTheSquareBaseEvaluateExactly()
    {
        var e = LayoutImport.Evaluate(Star4(), Corners, null, null);
        Assert.Equal(2.0, e.Scale, 9);
        Assert.Equal(4, e.Pairs.Count(p => p.Tight));
        Assert.Empty(e.Violations);
        Assert.Empty(e.EdgeLengths);
        Assert.True(ActivePaths.Analyze(e.Layout, e.Pairs).Valid);
    }

    [Fact]
    public void ATooLargeScaleFallsBackToTheExactScale()
    {
        var e = LayoutImport.Evaluate(Star4(), Corners, 2.5, null);
        Assert.Equal(2.0, e.Scale, 9);
        Assert.Contains(e.Messages, m => m.Contains("larger than this layout allows"));
        var smaller = LayoutImport.Evaluate(Star4(), Corners, 1.5, null);
        Assert.Equal(1.5, smaller.Scale, 9);
    }

    [Fact]
    public void SavedEdgeLengthsAreReportedAsStrains()
    {
        var e = LayoutImport.Evaluate(Star4(), Corners, null, new[] { 1.0, 1.0, 1.0, 2.0 });
        Assert.Equal(4, e.EdgeLengths.Count);
        Assert.Equal(1.0, e.EdgeLengths[3].Strain, 9);
        Assert.Equal(4.0 / 3.0, e.Scale, 9);   // the pairs with leaf 4 (length 3) set the scale
    }

    [Fact]
    public void BadLayoutsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => LayoutImport.Evaluate(Star4(), new[] { ("1", 0, 0), ("2", 0, 0), ("3", 4, 4), ("4", 0, 4) }, null, null));
        Assert.Throws<ArgumentException>(() => LayoutImport.Evaluate(Star4(), new[] { ("1", 0, 0), ("2", 4, 0), ("3", 4, 4) }, null, null));
        Assert.Throws<ArgumentException>(() => LayoutImport.Evaluate(Star4(), new[] { ("1", 0, 0), ("2", 5, 0), ("3", 4, 4), ("4", 0, 4) }, null, null));
        Assert.Throws<ArgumentException>(() => LayoutImport.Evaluate(Star4(), Corners, null, new[] { 1.0, 1.0 }));
    }

    [Fact]
    public void AStartLayoutMustFitTheGrid()
    {
        var tree = Star4().Tree;
        var outside = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 9, 0), ("3", 4, 4), ("4", 0, 4) });
        Assert.Throws<ArgumentException>(() => (Star4() with { StartLayout = outside }).Validate());
    }

    [Fact]
    public void TheBaseModelSolvesFromAStartLayout()
    {
        var spec = Star4() with
        {
            StartLayout = ActivePaths.Place(Star4().Tree, Corners),
            Solver = new SolverSettings { TimeLimit = TimeSpan.FromSeconds(30) },
        };
        var result = PureMilpSolver.Solve(spec);
        Assert.Equal(2.0, result.Scale!.Value, 6);
        Assert.Contains(result.Messages, m => m.Contains("imported layout"));
    }
}
