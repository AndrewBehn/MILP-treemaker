using TreeMaker.Core;

namespace TreeMaker.Optimized;

/// <summary>Which of the document's optimizations to use. Lattice hulls (Section 3) and scale search (Section 5) are always on.</summary>
public sealed record OptimizedOptions
{
    /// <summary>Section 4: anchor in the fundamental domain (C:2) and sibling order (C:3).</summary>
    public bool SymmetryBreaking { get; init; } = true;

    /// <summary>Section 6: start with likely-tight pairs and add the others only when a layout breaks them.</summary>
    public bool PairGeneration { get; init; } = true;

    /// <summary>Section 6: start each pair with an inner polygon of at most 8 facets and grow it from violations.</summary>
    public bool FacetGeneration { get; init; } = true;

    /// <summary>Section 6: first try each test with every leaf confined to a box around the last layout.</summary>
    public bool LeafWindows { get; init; } = true;

    /// <summary>Half-width h of each leaf window (Section 6.7).</summary>
    public int WindowHalfWidth { get; init; } = 2;

    /// <summary>A pair starts active when its distance is within this fraction of its minimum (Section 6.7).</summary>
    public double NearlyTight { get; init; } = 0.15;

    /// <summary>Start from the border seed layout (in place of the rounded TreeMaker layout of base Section 9).</summary>
    public bool UseSeed { get; init; } = true;

    /// <summary>
    /// Stop the bisection once the proved interval is this tight: (smallest candidate not ruled out) / (best layout's
    /// scale) − 1 ≤ gap. 0 runs it to the exact m*. The base model comparison uses the same relative gap.
    /// </summary>
    public double RelativeGap { get; init; }

    /// <summary>Also solve the base model, to compare time and check m*.</summary>
    public bool CompareWithBase { get; init; }
}

/// <summary>One solve of a feasibility model.</summary>
public sealed record RoundTrace
{
    public int Round { get; init; }
    public bool Windowed { get; init; }
    public required FeasibilitySize Size { get; init; }

    /// <summary>"Layout", "No layout", "Trivially infeasible", or "Stopped".</summary>
    public required string Outcome { get; init; }

    /// <summary>Pairs that were too close and were made active.</summary>
    public int AddedPairs { get; init; }

    /// <summary>Forbidden points added to inner polygons.</summary>
    public int AddedPoints { get; init; }
    public double Milliseconds { get; init; }
    public long Nodes { get; init; }
}

/// <summary>One phase of a bisection test (Section 6.9).</summary>
public sealed record PhaseTrace
{
    public bool Windowed { get; init; }

    /// <summary>"Yes", "No", "Failed" (windowed phase only), or "Stopped".</summary>
    public required string Outcome { get; init; }
    public List<RoundTrace> Rounds { get; init; } = new();
}

/// <summary>One bisection test: does a layout exist at this trial scale?</summary>
public sealed record TestTrace
{
    public int Test { get; init; }
    public int CandidateIndex { get; init; }
    public double Scale { get; init; }

    /// <summary>"Yes", "No", or "Unknown" when the time limit or a cancel stopped it.</summary>
    public required string Answer { get; init; }
    public List<PhaseTrace> Phases { get; init; } = new();
    public double Milliseconds { get; init; }
    public int Solves => Phases.Sum(p => p.Rounds.Count(r => r.Outcome != "Trivially infeasible"));
    public int MaxBinaries => Phases.SelectMany(p => p.Rounds).Select(r => r.Size.Binaries).DefaultIfEmpty(0).Max();
}

/// <summary>A pair's lattice hull at the optimum, for display (Section 3, D:1).</summary>
public sealed record PairHull(
    string A, string B, double Radius, long Limit, IReadOnlyList<Point> Vertices, int CrossableFacets, int Dx, int Dy, bool Tight);

/// <summary>The interchangeable siblings and anchor found for Section 4.</summary>
public sealed record SymmetryReport(string? Anchor, IReadOnlyList<IReadOnlyList<string>> SiblingGroups, string? Note);

/// <summary>Size of the full Feas(m) at one scale, computed without solving.</summary>
public sealed record FeasibilityEstimate(double Scale, int Binaries, int Rows, long Nonzeros);

/// <summary>Everything the optimized solver reports.</summary>
public sealed record OptimizedResult
{
    public required SolveStatus Status { get; init; }

    /// <summary>m*, the exact scale of the returned layout.</summary>
    public double? Scale { get; init; }
    public double? TreeMakerScale { get; init; }

    /// <summary>The smallest candidate not yet ruled out; equals m* when the search finished.</summary>
    public double? UpperBound { get; init; }

    public IReadOnlyList<LeafPlacement> Layout { get; init; } = Array.Empty<LeafPlacement>();
    public IReadOnlyList<PairReport> Pairs { get; init; } = Array.Empty<PairReport>();
    public IReadOnlyList<PairHull> Hulls { get; init; } = Array.Empty<PairHull>();

    /// <summary>Edge lengths that differ from the tree's (an imported, closed layout); empty after a solve.</summary>
    public IReadOnlyList<EdgeReport> EdgeLengths { get; init; } = Array.Empty<EdgeReport>();
    public IReadOnlyList<string> Violations { get; init; } = Array.Empty<string>();

    public int CandidateCount { get; init; }
    public IReadOnlyList<double> Candidates { get; init; } = Array.Empty<double>();
    public int MaxTests { get; init; }
    public double? SeedScale { get; init; }
    public List<TestTrace> Tests { get; init; } = new();

    public int TotalSolves => Tests.Sum(t => t.Solves);
    public long TotalBinaries => Tests.SelectMany(t => t.Phases).SelectMany(p => p.Rounds).Sum(r => (long)r.Size.Binaries);
    public int MaxBinariesPerSolve => Tests.Select(t => t.MaxBinaries).DefaultIfEmpty(0).Max();
    public double Milliseconds { get; init; }

    /// <summary>The full Feas(m*) (all pairs, full hulls, whole sheet), for comparison with the base model.</summary>
    public FeasibilityEstimate? FullModelAtOptimum { get; init; }

    /// <summary>The base model's size (one solve).</summary>
    public required ModelMetrics BaseModel { get; init; }

    /// <summary>The base model solved directly, when asked for.</summary>
    public SolveResult? BaseSolve { get; init; }

    public required SymmetryReport Symmetry { get; init; }
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
}
