using TreeMaker.Pure;

namespace TreeMaker.Core.Tests;

public class DefinitionTests
{
    [Fact]
    public void Tree_finds_leaves_and_pairs()
    {
        var tree = RunningExample.Tree();
        Assert.Equal(new[] { "1", "2", "3", "4" }, tree.Leaves.Select(tree.Name).OrderBy(s => s));
        Assert.Equal(6, tree.Pairs.Count);
        Assert.Equal(6, tree.VertexCount);
    }

    [Theory]
    [InlineData("1", "2", 5)]
    [InlineData("1", "3", 8)]
    [InlineData("1", "4", 10)]
    [InlineData("2", "3", 7)]
    [InlineData("2", "4", 9)]
    [InlineData("3", "4", 6)]
    public void Path_lengths_match_the_doc(string a, string b, double expected)
    {
        var tree = RunningExample.Tree();
        var defs = new Definitions(tree, 9);
        Assert.Equal(expected, defs.PathLength(tree.Id(a), tree.Id(b)), 12);
    }

    [Fact]
    public void Scale_bound_is_sqrt2_N_over_lmax()
    {
        var defs = new Definitions(RunningExample.Tree(), 9);
        Assert.Equal(10, defs.MaxPathLength, 12);
        Assert.Equal(5, defs.MinPathLength, 12);
        Assert.Equal(Math.Sqrt(2) * 9 / 10, defs.ScaleUpperBound, 12);
        Assert.Equal(360, defs.SelectorsPerPair);   // (2N + 1)² − 1
    }

    [Theory]
    [InlineData("1", "2", 0)]
    [InlineData("1", "3", 2)]
    [InlineData("2", "3", 2)]
    [InlineData("3", "4", 2)]
    [InlineData("1", "4", 0)]
    public void Stretchable_length_counts_stretch_set_edges_on_the_path(string a, string b, double expected)
    {
        var tree = RunningExample.Tree();
        var defs = new Definitions(tree, 9);
        var pair = tree.Normalize(tree.Id(a), tree.Id(b));
        Assert.Equal(expected, defs.StretchableLength(pair, new HashSet<int> { RunningExample.EdgeV3 }), 12);
    }

    [Theory]
    [InlineData("a", "a", 1)]
    [InlineData("a", "b", 0)]
    [InlineData("a", "b", -1)]
    public void Tree_rejects_bad_edges(string u, string v, double length)
    {
        Assert.Throws<ArgumentException>(() => Tree.FromEdges(new[] { (u, v, length), ("b", "c", 1.0) }));
    }

    [Fact]
    public void Tree_rejects_a_cycle()
    {
        Assert.Throws<ArgumentException>(() => Tree.FromEdges(new[]
        {
            ("a", "b", 1.0), ("b", "c", 1.0), ("c", "a", 1.0), ("x", "y", 1.0),
        }));
    }

    [Fact]
    public void Predicted_size_for_the_running_example_at_N9()
    {
        var m = ModelSize.Predict(RunningExample.Spec());
        Assert.Equal(2160, m.BinaryVariables);     // 6 pairs × 360 offsets
        Assert.Equal(8, m.IntegerVariables);       // x, y for 4 leaves
        Assert.Equal(1, m.ContinuousVariables);    // m
        Assert.Equal(2169, m.Variables);
        Assert.Equal(24, m.Constraints);           // C:2, C:3x, C:3y, C:4 per pair
        Assert.Equal(8454, m.Nonzeros);
    }
}
