using TreeMaker.Core;

namespace TreeMaker.Optimized.Tests;

/// <summary>End-to-end: the optimized search must find the base model's m* (checked with HiGHS) under every option set.</summary>
public class SolverTests
{
    public static IEnumerable<object[]> OptionSets()
    {
        var all = new OptimizedOptions();
        yield return new object[] { "all on", all };
        yield return new object[] { "hulls and search only", all with { SymmetryBreaking = false, PairGeneration = false, FacetGeneration = false, LeafWindows = false, UseSeed = false } };
        yield return new object[] { "no symmetry", all with { SymmetryBreaking = false } };
        yield return new object[] { "pairs only", all with { FacetGeneration = false, LeafWindows = false } };
        yield return new object[] { "facets only", all with { PairGeneration = false, LeafWindows = false } };
        yield return new object[] { "windows only", all with { PairGeneration = false, FacetGeneration = false } };
        yield return new object[] { "tight windows", all with { WindowHalfWidth = 0 } };
        yield return new object[] { "no seed", all with { UseSeed = false } };
    }

    [Theory]
    [MemberData(nameof(OptionSets))]
    public void Finds_the_base_optimum_at_N9(string name, OptimizedOptions options)
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec(), options);
        Assert.True(result.Status == SolveStatus.Optimal, name);
        Assert.Equal(1.054093, result.Scale!.Value, 5);
        Assert.Empty(result.Violations);
        Assert.Equal(result.Scale!.Value, result.UpperBound!.Value, 9);
        Assert.InRange(result.Tests.Count, 1, result.MaxTests + 1);
    }

    [Theory]
    [InlineData(8, 0.949334)]
    [InlineData(10, 1.196703)]
    public void Finds_the_base_optimum_at_other_grid_sizes(int n, double expected)
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec(n));
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.Equal(expected, result.Scale!.Value, 5);
        Assert.Empty(result.Violations);
    }

    [Fact]
    public void Every_solve_is_far_smaller_than_the_base_model()
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec());
        Assert.Equal(2160, result.BaseModel.BinaryVariables);
        Assert.InRange(result.MaxBinariesPerSolve, 1, 120);   // at most 6 pairs × 20 facets
        Assert.True(result.TotalBinaries < 2160);
    }

    [Fact]
    public void Symmetry_breaking_puts_the_anchor_in_the_fundamental_domain()
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec());
        var anchor = result.Layout.Single(p => p.Leaf == result.Symmetry.Anchor);
        Assert.True(2 * anchor.X <= 9 && 2 * anchor.Y <= 9 && anchor.Y <= anchor.X);
    }

    [Fact]
    public void Star_with_equal_legs_uses_the_corners()
    {
        var star = Tree.FromEdges(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) });
        var result = OptimizedSolver.Solve(new ProblemSpec { Tree = star, GridSize = 9 });
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.Equal(4.5, result.Scale!.Value, 6);
        Assert.Null(result.Symmetry.Anchor);
    }

    [Fact]
    public void Corner_condition_keeps_the_optimum_and_turns_off_the_anchor()
    {
        var spec = RunningExample.Spec() with
        {
            LeafConditions = new[] { new LeafCondition("1", LeafConditionKind.BottomLeftCorner) },
        };
        var result = OptimizedSolver.Solve(spec);
        Assert.Equal(1.054093, result.Scale!.Value, 5);
        Assert.Null(result.Symmetry.Anchor);
        var leaf1 = result.Layout.Single(p => p.Leaf == "1");
        Assert.Equal((0, 0), (leaf1.X, leaf1.Y));
    }

    [Fact]
    public void Mirror_pair_is_respected()
    {
        var spec = RunningExample.Spec(10) with { MirrorPairs = new[] { new MirrorPair("1", "2") } };
        var result = OptimizedSolver.Solve(spec);
        Assert.Empty(result.Violations);
        Assert.True(result.Scale <= 1.196703 + 1e-6);
    }

    [Fact]
    public void Relative_gap_stops_early_with_a_proved_interval()
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec(), new OptimizedOptions { RelativeGap = 0.05 });
        Assert.True(result.Scale <= 1.054093 + 1e-6);
        Assert.True(result.UpperBound >= 1.054093 - 1e-6);
        Assert.True(result.UpperBound / result.Scale - 1 <= 0.05 + 1e-12);
    }

    [Fact]
    public void Agrees_with_the_base_model_when_asked_to_compare()
    {
        var result = OptimizedSolver.Solve(RunningExample.Spec(), new OptimizedOptions { CompareWithBase = true });
        Assert.NotNull(result.BaseSolve);
        Assert.Equal(result.BaseSolve!.Scale!.Value, result.Scale!.Value, 6);
    }

    [Fact]
    public void Too_many_leaves_for_the_grid_is_infeasible()
    {
        var star = Tree.FromEdges(Enumerable.Range(1, 5).Select(k => (k.ToString(), "c", 1.0)));
        var result = OptimizedSolver.Solve(new ProblemSpec { Tree = star, GridSize = 1 });
        Assert.Equal(SolveStatus.Infeasible, result.Status);
    }
}

public class StartLayoutTests
{
    [Fact]
    public void TheOptimizedSearchStartsFromAnImportedLayout()
    {
        var spec = RunningExample.Spec(9);
        var first = OptimizedSolver.Solve(spec);
        var again = OptimizedSolver.Solve(spec with { StartLayout = first.Layout });
        Assert.Equal(first.Scale!.Value, again.Scale!.Value, 9);
        Assert.Contains(again.Messages, m => m.Contains("starting layout"));
        Assert.True(again.Tests.Count <= first.Tests.Count);
    }
}
