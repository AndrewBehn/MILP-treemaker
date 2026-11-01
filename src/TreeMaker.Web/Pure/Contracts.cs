using TreeMaker.Core;

namespace TreeMaker.Web.Pure;

/// <summary>The base model's problem as the UI sends it: the shared fields plus the stage and its settings.</summary>
public sealed record ProblemDto : ProblemDtoBase
{
    public Stage Stage { get; init; } = Stage.Scale;
    public double? FixedScale { get; init; }
    public double? TargetScale { get; init; }
    public double? StrainMin { get; init; }
    public double? StrainMax { get; init; }
    public StrainObjective StrainObjective { get; init; } = StrainObjective.TotalAbsolute;
    public double? RelativeGap { get; init; }

    /// <summary>Adds C:5 and C:6 of the Symmetry-Breaking MILP doc (the map's Symmetry-Breaking node).</summary>
    public bool SymmetryBreaking { get; init; }

    public override ProblemSpec ToSpec()
    {
        var spec = BaseSpec();
        return Finish(spec with
        {
            Stage = Stage,
            StretchSet = Edges.Select((e, i) => (e, i)).Where(t => t.e.Stretch).Select(t => t.i).ToArray(),
            FixedScale = FixedScale,
            TargetScale = TargetScale ?? 0,
            StrainMin = StrainMin ?? -0.5,
            StrainMax = StrainMax ?? 0.5,
            StrainObjective = StrainObjective,
            SymmetryBreaking = SymmetryBreaking,
            Solver = spec.Solver with { RelativeGap = RelativeGap ?? 1e-7 },
        });
    }

    /// <summary>The running example of the doc (<see cref="global::TreeMaker.Core.RunningExample"/>), with v–3 in the stretch set and target scale 1.2.</summary>
    public static ProblemDto RunningExample() => new()
    {
        Edges = global::TreeMaker.Core.RunningExample.Edges
            .Select((e, i) => new EdgeDto(e.From, e.To, e.Length, Stretch: i == global::TreeMaker.Core.RunningExample.EdgeV3))
            .ToList(),
        GridSize = 9,
        TargetScale = 1.2,
    };
}

/// <summary>What the UI shows before solving: the definitions of Section 5 and the predicted model size.</summary>
public sealed record AnalysisDto(
    IReadOnlyList<string> Leaves,
    IReadOnlyList<string> InternalVertices,
    IReadOnlyList<PairLengthDto> Pairs,
    double MaxPathLength,
    double MinPathLength,
    double ScaleUpperBound,
    ModelMetrics PredictedModel);

/// <summary>A leaf pair and its path length ℓᵢⱼ.</summary>
public sealed record PairLengthDto(string A, string B, double PathLength, double StretchableLength);

/// <summary>A solve result in UI-friendly units (milliseconds instead of <see cref="TimeSpan"/>).</summary>
public sealed record SolveResponse
{
    public required SolveResult Result { get; init; }
    public double BuildMilliseconds { get; init; }
    public double SolveMilliseconds { get; init; }
    public double TotalMilliseconds { get; init; }
    public double? StageOneMilliseconds { get; init; }

    public static SolveResponse From(SolveResult result, TimeSpan total) => new()
    {
        Result = result,
        BuildMilliseconds = result.Metrics.BuildTime.TotalMilliseconds,
        SolveMilliseconds = result.Metrics.SolveTime.TotalMilliseconds,
        TotalMilliseconds = total.TotalMilliseconds,
        StageOneMilliseconds = result.StageOne is { } s
            ? (s.Metrics.BuildTime + s.Metrics.SolveTime).TotalMilliseconds
            : null,
    };
}
