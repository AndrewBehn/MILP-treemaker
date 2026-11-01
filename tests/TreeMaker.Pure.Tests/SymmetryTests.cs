using TreeMaker.Core;

namespace TreeMaker.Pure.Tests;

/// <summary>The Symmetry-Breaking MILP doc: the base model with C:5 (anchor) and C:6 (sibling order) added.</summary>
public class SymmetryTests
{
    private static ProblemSpec Star(int legs, int n) => new()
    {
        Tree = Tree.FromEdges(Enumerable.Range(1, legs).Select(k => (k.ToString(), "c", 1.0))),
        GridSize = n,
        SymmetryBreaking = true,
    };

    [Theory]
    [InlineData(8, 0.949334)]
    [InlineData(9, 1.054093)]
    public void Same_optimum_as_the_base_model(int n, double expected)
    {
        var result = PureMilpSolver.Solve(RunningExample.Spec(n) with { SymmetryBreaking = true });
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.Empty(result.Violations);
        Assert.Equal(expected, result.Scale!.Value, 4);
    }

    [Fact]
    public void Siblings_come_out_in_order_and_the_model_matches_the_prediction()
    {
        var spec = Star(4, 4);
        var result = PureMilpSolver.Solve(spec);
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.Equal(2.0, result.Scale!.Value, 6);
        Assert.Equal(ModelSize.Predict(spec), result.Model);
        // All four legs are interchangeable siblings: no anchor, and C:6 orders them by (N + 1)·x + y.
        var keys = result.Layout.OrderBy(p => int.Parse(p.Leaf)).Select(p => 5 * p.X + p.Y).ToArray();
        Assert.Equal(keys.OrderBy(k => k), keys);
        Assert.Contains(result.Messages, m => m.StartsWith("Symmetry breaking"));
    }

    [Fact]
    public void The_anchor_lies_in_the_fundamental_domain()
    {
        var spec = RunningExample.Spec(9) with { SymmetryBreaking = true };
        var symmetry = SymmetryBreaking.Create(spec);
        Assert.NotNull(symmetry.Anchor);
        var result = PureMilpSolver.Solve(spec);
        var anchor = result.Layout.Single(p => p.Vertex == symmetry.Anchor);
        Assert.True(anchor.Y <= anchor.X && 2 * anchor.X <= 9, $"anchor at ({anchor.X}, {anchor.Y})");
    }

    [Fact]
    public void A_start_layout_outside_the_domain_is_mapped_into_it()
    {
        var tree = Tree.FromEdges(new[] { ("a", "c", 1.0), ("b", "c", 2.0) });
        var spec = new ProblemSpec
        {
            Tree = tree,
            GridSize = 6,
            SymmetryBreaking = true,
            StartLayout = ActivePaths.Place(tree, new[] { ("a", 6, 6), ("b", 0, 0) }),
        };
        var result = PureMilpSolver.Solve(spec);
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.Contains(result.Messages, m => m.Contains("fundamental domain"));
    }
}
