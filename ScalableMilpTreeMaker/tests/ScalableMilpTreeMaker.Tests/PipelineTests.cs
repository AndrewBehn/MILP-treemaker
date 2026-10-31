using PureMilpTreeMaker;
using ScalableMilpTreeMaker;

namespace ScalableMilpTreeMaker.Tests;

public class PipelineTests
{
    private static ProblemSpec Spec(IEnumerable<(string, string, double)> edges, int n, double seconds = 30,
        IReadOnlyList<LeafCondition>? conditions = null, IReadOnlyList<MirrorPair>? mirrors = null) => new()
    {
        Tree = Tree.FromEdges(edges),
        GridSize = n,
        Stage = Stage.Scale,
        LeafConditions = conditions ?? Array.Empty<LeafCondition>(),
        MirrorPairs = mirrors ?? Array.Empty<MirrorPair>(),
        Solver = new SolverSettings { TimeLimit = TimeSpan.FromSeconds(seconds) },
    };

    private static readonly (string, string, double)[] Star4 = { ("1", "c", 1), ("2", "c", 1), ("3", "c", 1), ("4", "c", 1) };

    private static readonly (string, string, double)[] Running =
        { ("1", "u", 3), ("2", "u", 2), ("u", "v", 3), ("v", "3", 2), ("v", "4", 4) };

    [Fact]
    public void ForbiddenLimitAllowsExactlyTightOffsets()
    {
        Assert.Equal(24, Placement.ForbiddenLimit(5));          // 3-4-5: distance 5 is allowed, 24 is not
        Assert.Equal(4, Placement.ForbiddenLimit(Math.Sqrt(4.5)));
        Assert.True(Placement.IsTight(25, 5));
        Assert.False(Placement.IsTight(26, 5));
    }

    [Fact]
    public void CandidatesAreGridLengthsOverPathLengthsInRange()
    {
        var definitions = new Definitions(Tree.FromEdges(Running), 9);
        var candidates = Placement.Candidates(definitions, 0.5, 1.5);
        Assert.NotEmpty(candidates);
        Assert.All(candidates, c => Assert.InRange(c, 0.5 * (1 - 1e-12), 1.5 * (1 + 1e-12)));
        Assert.Equal(candidates.OrderBy(c => c), candidates);
        var lengths = definitions.Tree.Pairs.Select(definitions.PathLength).Distinct().ToArray();
        Assert.All(candidates, c => Assert.Contains(lengths, l =>
        {
            double s = c * l * c * l;
            return Math.Abs(s - Math.Round(s)) < 1e-6;
        }));
    }

    [Fact]
    public void ContinuousStageFindsTheSquareBaseCorners()
    {
        var spec = Spec(Star4, 4);
        var definitions = new Definitions(spec.Tree, 4);
        var conditions = new Placement.Conditions(spec);
        var start = ContinuousLayout.Starts(spec, conditions, 1, 1).First();
        var result = ContinuousLayout.Improve(spec, definitions, conditions, start, 50, new List<StageRound>(), CancellationToken.None);
        Assert.True(result.Scale >= 2 - 1e-6, $"continuous scale {result.Scale}");
    }

    [Fact]
    public void SquareBaseComesOutExactWithValidPolygons()
    {
        var result = ScalableSolver.Solve(Spec(Star4, 4));
        Assert.Equal(SolveStatus.Feasible, result.Status);
        Assert.NotNull(result.Scale);
        Assert.Equal(2.0, result.Scale!.Value, 6);
        Assert.Empty(result.Violations);
        Assert.True(result.PolygonsValid);
        Assert.Equal(4, result.Stages.Count);
    }

    [Fact]
    public void RunningExampleGivesAFeasibleLayout()
    {
        var result = ScalableSolver.Solve(Spec(Running, 9));
        Assert.NotNull(result.Scale);
        Assert.Empty(result.Violations);
        Assert.True(result.Scale <= result.UpperBound + 1e-9);
        // The grid layout is exact: its scale is min D/ℓ over the pairs.
        var definitions = new Definitions(Tree.FromEdges(Running), 9);
        double exact = LayoutAnalysis.ExactScale(definitions, result.Layout, result.EdgeLengths.Count > 0 ? result.EdgeLengths.Select(e => e.NewLength).ToArray() : null);
        Assert.True(exact >= result.Scale!.Value - 1e-9);
    }

    [Fact]
    public void WindowModelProvesACollisionInfeasible()
    {
        var spec = Spec(new[] { ("1", "c", 1.0), ("2", "c", 1.0) }, 4);
        var definitions = new Definitions(spec.Tree, 4);
        int a = spec.Tree.Id("1"), b = spec.Tree.Id("2");
        var centres = new Dictionary<int, (int X, int Y)> { [a] = (0, 0), [b] = (1, 0) };
        var fixedWindows = new Dictionary<int, int> { [a] = 0, [b] = 0 };
        var none = WindowModel.Solve(spec, definitions, new Placement.Conditions(spec), 1.0, centres, fixedWindows, null,
            TimeSpan.FromSeconds(5), null, CancellationToken.None);
        Assert.Equal("No layout", none.Status);

        var widened = new Dictionary<int, int> { [a] = 1, [b] = 2 };
        var some = WindowModel.Solve(spec, definitions, new Placement.Conditions(spec), 1.0, centres, widened, null,
            TimeSpan.FromSeconds(5), null, CancellationToken.None);
        Assert.NotNull(some.Layout);
        var (x1, y1) = some.Layout![a];
        var (x2, y2) = some.Layout[b];
        Assert.True((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2) >= 4);
    }

    [Fact]
    public void LeafConditionsAndMirrorsAreKept()
    {
        var spec = Spec(Star4, 8, 20,
            new[] { new LeafCondition("1", LeafConditionKind.BottomLeftCorner) },
            new[] { new MirrorPair("3", "4") });
        var result = ScalableSolver.Solve(spec);
        Assert.Empty(result.Violations);
        var at = result.Layout.ToDictionary(p => p.Leaf);
        Assert.Equal((0, 0), (at["1"].X, at["1"].Y));
        Assert.Equal(8, at["3"].X + at["4"].X);
        Assert.Equal(at["3"].Y, at["4"].Y);
    }

    [Theory]
    [InlineData(25)]
    [InlineData(50)]
    public void RandomTreesGetANearContinuousGridLayout(int leaves)
    {
        var edges = TreeGenerator.Random(leaves, 7);
        int n = TreeGenerator.SuggestedGrid(leaves);
        var result = ScalableSolver.Solve(Spec(edges, n, 45));
        Assert.NotNull(result.Scale);
        Assert.Empty(result.Violations);
        Assert.True(result.Scale >= 0.85 * result.ContinuousScale!.Value,
            $"grid {result.Scale} vs continuous {result.ContinuousScale}");
        // No CP-SAT model should be anywhere near the base model's size.
        Assert.True(result.LargestSolve < result.BaseModel.BinaryVariables / 50);
    }

    [Fact]
    public void GeneratedTreesHaveTheAskedNumberOfLeaves()
    {
        foreach (int leaves in new[] { 2, 3, 25, 100 })
        {
            var tree = Tree.FromEdges(TreeGenerator.Random(leaves, leaves));
            Assert.Equal(leaves, tree.Leaves.Count);
            Assert.Equal(tree.VertexCount - 1, tree.Edges.Count);
        }
        Assert.Equal(16, TreeGenerator.SuggestedGrid(25));
        Assert.Equal(32, TreeGenerator.SuggestedGrid(100));
    }

    [Fact]
    public void SubtreesAreProperAndDistinct()
    {
        var tree = Tree.FromEdges(Running);
        var subtrees = ScalableSolver.Subtrees(tree);
        Assert.Contains(subtrees, s => s.SetEquals(new[] { tree.Id("1"), tree.Id("2") }));
        Assert.Contains(subtrees, s => s.SetEquals(new[] { tree.Id("3"), tree.Id("4") }));
        Assert.All(subtrees, s => Assert.InRange(s.Count, 2, 2));
    }
}

public class StartLayoutTests
{
    [Fact]
    public void TheScalablePipelineStartsFromAnImportedLayout()
    {
        var tree = Tree.FromEdges(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) });
        var start = ActivePaths.Place(tree, new[] { ("1", 0, 0), ("2", 4, 0), ("3", 4, 4), ("4", 0, 4) });
        var result = ScalableSolver.Solve(new ProblemSpec
        {
            Tree = tree,
            GridSize = 4,
            StartLayout = start,
            Solver = new SolverSettings { TimeLimit = TimeSpan.FromSeconds(20) },
        });
        Assert.Equal(2.0, result.Scale!.Value, 6);
        Assert.Contains(result.Stages, s => s.Stage == 1 && s.Note.StartsWith("Skipped"));
        Assert.DoesNotContain(result.Rounds, r => r.Stage == 1);
    }
}
