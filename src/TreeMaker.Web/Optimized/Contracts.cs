using TreeMaker.Optimized;
using TreeMaker.Core;

namespace TreeMaker.Web.Optimized;

/// <summary>The optimized search's problem as the UI sends it: the shared fields plus the optimizations to use.</summary>
public sealed record ProblemDto : ProblemDtoBase
{
    public OptimizedOptions Options { get; init; } = new();

    public override ProblemSpec ToSpec() => Finish(BaseSpec());
}

/// <summary>What is known before solving.</summary>
public sealed record AnalysisDto
{
    public int Leaves { get; init; }
    public int Pairs { get; init; }
    public double ScaleUpperBound { get; init; }
    public int CandidateCount { get; init; }
    public int DistinctSquaredLengths { get; init; }
    public int DistinctPathLengths { get; init; }
    public int MaxTests { get; init; }
    public double? SeedScale { get; init; }

    /// <summary>Feas(m) binaries in the worst case over every scale up to m̄.</summary>
    public int WorstCaseBinaries { get; init; }

    /// <summary>The full Feas(m) at the seed scale (the first trial is near it).</summary>
    public FeasibilityEstimate? AtSeed { get; init; }

    /// <summary>The base model's exact size, for comparison.</summary>
    public required ModelMetrics BaseModel { get; init; }
    public required SymmetryReport Symmetry { get; init; }
}
