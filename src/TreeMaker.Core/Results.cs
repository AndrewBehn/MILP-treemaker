namespace TreeMaker.Core;

/// <summary>How a solve ended.</summary>
public enum SolveStatus
{
    /// <summary>Proved optimal within the relative gap.</summary>
    Optimal,

    /// <summary>A layout was found but optimality was not proved (time limit or interruption).</summary>
    Feasible,

    /// <summary>No layout satisfies the model.</summary>
    Infeasible,

    /// <summary>The solve stopped before any layout was found.</summary>
    NoSolutionFound,

    /// <summary>The solver reported an error, or the SCIP backend is unavailable.</summary>
    Error,
}

/// <summary>A leaf's grid point uᵢ = (X, Y).</summary>
public sealed record LeafPlacement(string Leaf, int Vertex, int X, int Y);

/// <summary>One leaf pair's spacing at the solution.</summary>
/// <param name="A">First leaf name.</param>
/// <param name="B">Second leaf name.</param>
/// <param name="PathLength">ℓᵢⱼ from the input tree.</param>
/// <param name="EffectiveLength">The path length the spacing row uses: ℓᵢⱼ, ℓᵢⱼ + σ·sᵢⱼ, or the strained sum.</param>
/// <param name="Dx">Offset δᵢⱼ, x component (uᵢ − uⱼ).</param>
/// <param name="Dy">Offset δᵢⱼ, y component.</param>
/// <param name="Distance">D(δᵢⱼ), the Euclidean grid distance.</param>
/// <param name="Required">The required minimum: scale × effective length.</param>
/// <param name="Slack">Distance − Required.</param>
/// <param name="Tight">True when the pair is exactly at its minimum (an active path).</param>
public sealed record PairReport(
    string A, string B, double PathLength, double EffectiveLength,
    int Dx, int Dy, double Distance, double Required, double Slack, bool Tight);

/// <summary>An edge's length before and after the stage.</summary>
/// <param name="Edge">Edge index.</param>
/// <param name="Label">"u–v" label.</param>
/// <param name="Length">Input length ℓₑ.</param>
/// <param name="Strain">σₑ (the common stretch for stretch-set edges in edge optimization; 0 otherwise).</param>
/// <param name="NewLength">ℓₑ(1 + σₑ).</param>
public sealed record EdgeReport(int Edge, string Label, double Length, double Strain, double NewLength);

/// <summary>Size of the MILP as built.</summary>
public sealed record ModelMetrics
{
    public int Variables { get; init; }
    public int BinaryVariables { get; init; }
    public int IntegerVariables { get; init; }
    public int ContinuousVariables { get; init; }
    public int Constraints { get; init; }
    public long Nonzeros { get; init; }
    public int LeafCount { get; init; }
    public int PairCount { get; init; }
    public int SelectorsPerPair { get; init; }
    public int CandidateOffsets { get; init; }
    public double ScaleUpperBound { get; init; }
}

/// <summary>Timing and search effort of one solve.</summary>
public sealed record SolveMetrics
{
    public TimeSpan BuildTime { get; init; }
    public TimeSpan SolveTime { get; init; }
    public long Nodes { get; init; }
    public long Iterations { get; init; }
}

/// <summary>The outcome of solving one <see cref="ProblemSpec"/>.</summary>
public sealed record SolveResult
{
    public required Stage Stage { get; init; }
    public required SolveStatus Status { get; init; }
    public string SolverName { get; init; } = "SCIP";

    /// <summary>The objective value (m, σ, or total/largest strain).</summary>
    public double? Objective { get; init; }

    /// <summary>The solver's best proved bound on the objective.</summary>
    public double? BestBound { get; init; }

    /// <summary>|objective − bound| / |objective|.</summary>
    public double? RelativeGap { get; init; }

    /// <summary>
    /// The scale of the layout: m* for the scale stage (recomputed exactly from the layout), or m₀ for the
    /// edge and strain stages.
    /// </summary>
    public double? Scale { get; init; }

    /// <summary>The scale in TreeMaker's unit-square units, Scale / N (Section 1).</summary>
    public double? TreeMakerScale { get; init; }

    /// <summary>The common stretch σ of edge optimization.</summary>
    public double? Stretch { get; init; }

    /// <summary>Total absolute strain Σ|σₑ| (strain stage).</summary>
    public double? TotalStrain { get; init; }

    /// <summary>Largest absolute strain max|σₑ| (strain stage).</summary>
    public double? LargestStrain { get; init; }

    public IReadOnlyList<LeafPlacement> Layout { get; init; } = Array.Empty<LeafPlacement>();
    public IReadOnlyList<PairReport> Pairs { get; init; } = Array.Empty<PairReport>();
    public IReadOnlyList<EdgeReport> EdgeLengths { get; init; } = Array.Empty<EdgeReport>();

    /// <summary>Problems an independent check found in the layout; empty for a valid layout.</summary>
    public IReadOnlyList<string> Violations { get; init; } = Array.Empty<string>();

    public ModelMetrics Model { get; init; } = new();
    public SolveMetrics Metrics { get; init; } = new();

    /// <summary>The scale-stage solve run first to obtain m₀ for edge optimization, when one was needed.</summary>
    public SolveResult? StageOne { get; init; }

    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();

    /// <summary>True when the result carries a layout.</summary>
    public bool HasLayout => Layout.Count > 0;
}
