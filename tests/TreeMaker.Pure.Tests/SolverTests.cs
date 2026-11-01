using TreeMaker.Core;

namespace TreeMaker.Pure.Tests;

/// <summary>
/// End-to-end solves with SCIP. Expected optima were computed independently with HiGHS on the same model.
/// </summary>
public class SolverTests
{
    private const int Digits = 4;

    private static SolveResult SolveOk(ProblemSpec spec)
    {
        var result = PureMilpSolver.Solve(spec);
        Assert.Equal(SolveStatus.Optimal, result.Status);
        Assert.True(result.HasLayout);
        Assert.Empty(result.Violations);
        return result;
    }

    [Theory]
    [InlineData(8, 0.949334)]
    [InlineData(9, 1.054093)]
    [InlineData(10, 1.196703)]
    public void Scale_optimum(int n, double expected)
    {
        var result = SolveOk(RunningExample.Spec(n));
        Assert.Equal(expected, result.Scale!.Value, Digits);
        Assert.Equal(expected / n, result.TreeMakerScale!.Value, Digits);
        Assert.Contains(result.Pairs, p => p.Tight);
    }

    [Fact]
    public void Built_model_matches_prediction()
    {
        var spec = RunningExample.Spec();
        var result = SolveOk(spec);
        Assert.Equal(ModelSize.Predict(spec), result.Model);
    }

    [Theory]
    [InlineData(Stage.Edge)]
    [InlineData(Stage.Strain)]
    public void Built_model_matches_prediction_for_add_ons(Stage stage)
    {
        var spec = RunningExample.Spec() with
        {
            Stage = stage,
            StretchSet = new[] { RunningExample.EdgeV3 },
            FixedScale = 1.0,
            TargetScale = 1.2,
        };
        var result = SolveOk(spec);
        Assert.Equal(ModelSize.Predict(spec), result.Model);
    }

    [Fact]
    public void Scaling_lengths_divides_the_scale()
    {
        var spec = new ProblemSpec { Tree = RunningExample.Tree(1.5), GridSize = 9 };
        var result = SolveOk(spec);
        Assert.Equal(1.054093 / 1.5, result.Scale!.Value, Digits);
    }

    [Fact]
    public void Edge_optimization_runs_scale_first_and_stretches_v3()
    {
        var spec = RunningExample.Spec(stage: Stage.Edge) with { StretchSet = new[] { RunningExample.EdgeV3 } };
        var result = SolveOk(spec);
        Assert.NotNull(result.StageOne);
        Assert.Equal(1.054093, result.StageOne!.Scale!.Value, Digits);
        Assert.Equal(1.054093, result.Scale!.Value, Digits);
        Assert.Equal(0.320392, result.Stretch!.Value, Digits);
        var v3 = result.EdgeLengths[RunningExample.EdgeV3];
        Assert.Equal(2 * (1 + 0.320392), v3.NewLength, Digits);
        Assert.All(result.EdgeLengths.Where(e => e.Edge != RunningExample.EdgeV3), e => Assert.Equal(0, e.Strain));
    }

    [Fact]
    public void Edge_optimization_with_a_smaller_fixed_scale_stretches_at_least_as_much()
    {
        var spec = RunningExample.Spec(stage: Stage.Edge) with
        {
            StretchSet = new[] { RunningExample.EdgeV3 },
            FixedScale = 1.0,
        };
        var result = SolveOk(spec);
        Assert.Null(result.StageOne);
        Assert.True(result.Stretch >= 0.320392 - 1e-6);
    }

    [Fact]
    public void Strain_total_at_target_1_2()
    {
        var spec = RunningExample.Spec(stage: Stage.Strain) with { TargetScale = 1.2 };
        var result = SolveOk(spec);
        Assert.Equal(0.281435, result.TotalStrain!.Value, Digits);
        Assert.Equal(0.281435, result.Objective!.Value, Digits);
        Assert.All(result.EdgeLengths, e => Assert.InRange(e.Strain, -0.5 - 1e-9, 0.5 + 1e-9));
    }

    [Fact]
    public void Strain_largest_at_target_1_2()
    {
        var spec = RunningExample.Spec(stage: Stage.Strain) with
        {
            TargetScale = 1.2,
            StrainObjective = StrainObjective.LargestAbsolute,
        };
        var result = SolveOk(spec);
        Assert.Equal(0.12159, result.LargestStrain!.Value, Digits);
    }

    [Fact]
    public void Strain_is_zero_when_the_target_is_reachable()
    {
        var spec = RunningExample.Spec(stage: Stage.Strain) with { TargetScale = 1.0 };
        var result = SolveOk(spec);
        Assert.Equal(0, result.TotalStrain!.Value, 6);
    }

    [Fact]
    public void Corner_condition_keeps_the_optimum()
    {
        var spec = RunningExample.Spec() with
        {
            LeafConditions = new[] { new LeafCondition("1", LeafConditionKind.BottomLeftCorner) },
        };
        var result = SolveOk(spec);
        Assert.Equal(1.054093, result.Scale!.Value, Digits);
        var leaf1 = result.Layout.Single(p => p.Leaf == "1");
        Assert.Equal((0, 0), (leaf1.X, leaf1.Y));
    }

    [Fact]
    public void Fixed_leaf_is_placed_where_asked()
    {
        var spec = RunningExample.Spec() with
        {
            LeafConditions = new[] { new LeafCondition("3", LeafConditionKind.Fixed, 4, 4) },
        };
        var result = SolveOk(spec);
        var leaf3 = result.Layout.Single(p => p.Leaf == "3");
        Assert.Equal((4, 4), (leaf3.X, leaf3.Y));
        Assert.True(result.Scale <= 1.054093 + 1e-6);
    }

    [Fact]
    public void Mirror_pair_is_symmetric()
    {
        var spec = RunningExample.Spec(10) with { MirrorPairs = new[] { new MirrorPair("1", "2") } };
        var result = SolveOk(spec);
        var a = result.Layout.Single(p => p.Leaf == "1");
        var b = result.Layout.Single(p => p.Leaf == "2");
        Assert.Equal(10, a.X + b.X);
        Assert.Equal(a.Y, b.Y);
        Assert.True(result.Scale <= 1.196703 + 1e-6);
    }

    [Fact]
    public void Validation_rejects_bad_specs()
    {
        Assert.Throws<ArgumentException>(() => PureMilpSolver.Solve(RunningExample.Spec(stage: Stage.Edge)));
        Assert.Throws<ArgumentException>(() => PureMilpSolver.Solve(RunningExample.Spec(stage: Stage.Strain)));
        Assert.Throws<ArgumentException>(() => PureMilpSolver.Solve(RunningExample.Spec(9) with
        {
            LeafConditions = new[] { new LeafCondition("1", LeafConditionKind.OnSymmetryAxis) },
        }));
        Assert.Throws<ArgumentException>(() => PureMilpSolver.Solve(RunningExample.Spec() with
        {
            LeafConditions = new[] { new LeafCondition("u", LeafConditionKind.LeftEdge) },
        }));
    }

    [Fact]
    public void Cancellation_before_start_throws()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        Assert.Throws<OperationCanceledException>(() => PureMilpSolver.Solve(RunningExample.Spec(), cts.Token));
    }

    [Fact]
    public void Cancellation_during_solve_returns_the_best_layout_so_far()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
        SolveResult result;
        try
        {
            result = PureMilpSolver.Solve(RunningExample.Spec(24), cts.Token);
        }
        catch (OperationCanceledException)
        {
            return;   // Cancelled while the model was still being built; nothing to check.
        }
        Assert.Contains(result.Status, new[] { SolveStatus.Optimal, SolveStatus.Feasible, SolveStatus.NoSolutionFound });
        if (result.HasLayout)
        {
            Assert.Empty(result.Violations);
        }
    }
}
