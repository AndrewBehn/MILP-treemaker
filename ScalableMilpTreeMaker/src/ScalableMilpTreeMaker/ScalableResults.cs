using PureMilpTreeMaker;

namespace ScalableMilpTreeMaker;

/// <summary>Settings for the four stages. Defaults suit 25 to 100 leaves on grids of 16 to 40.</summary>
public sealed record ScalableOptions
{
    /// <summary>Stage 1: how many starting layouts the continuous solve tries (the border seed, then jittered copies).</summary>
    public int Multistarts { get; init; } = 4;

    /// <summary>Stage 1: the most linear programs per start.</summary>
    public int MaxLinearPrograms { get; init; } = 200;

    /// <summary>Stage 2: half-width of every leaf's window around its rounded continuous position.</summary>
    public int RepairHalfWidth { get; init; } = 1;

    /// <summary>Stage 3: run large neighbourhood search after the repair.</summary>
    public bool NeighbourhoodSearch { get; init; } = true;

    /// <summary>Stage 3: half-width for the leaves that collide at the next scale (their neighbours get 1).</summary>
    public int NeighbourhoodHalfWidth { get; init; } = 3;

    /// <summary>Stage 3: also try freeing whole subtrees (the optional subtree decomposition).</summary>
    public bool SubtreeNeighbourhoods { get; init; } = true;

    /// <summary>Stage 4: at the final scale, choose the layout (leaves within 1 of where they are) with the most tight pairs.</summary>
    public bool MaximizeTightPairs { get; init; } = true;

    /// <summary>Stage 4: close the polygons with edge strains while each leaf may still move by one grid step.</summary>
    public bool CloseWithMovingLeaves { get; init; } = true;

    /// <summary>Strain bounds for closing.</summary>
    public double StrainMin { get; init; } = -0.3;
    public double StrainMax { get; init; } = 0.3;

    /// <summary>Seed for the jittered starts and for random trees.</summary>
    public int RandomSeed { get; init; } = 1;
}

/// <summary>One solve inside a stage (a linear program, a CP-SAT window model, or the closing MILP).</summary>
public sealed record StageRound
{
    public int Stage { get; init; }
    public required string Kind { get; init; }

    /// <summary>The scale this solve tried (Stages 2 and 3), or the scale it held fixed (Stage 4).</summary>
    public double Scale { get; init; }

    /// <summary>"Layout", "No layout", "Improved", "Stalled", "Optimal", "Feasible", "Stopped", …</summary>
    public required string Outcome { get; init; }
    public int Variables { get; init; }
    public int Constraints { get; init; }

    /// <summary>Leaves that could move in this solve.</summary>
    public int FreeLeaves { get; init; }
    public double Milliseconds { get; init; }
}

/// <summary>What one stage achieved.</summary>
public sealed record StageSummary
{
    public int Stage { get; init; }
    public required string Name { get; init; }

    /// <summary>Scale at the end of the stage (continuous for Stage 1, on the grid afterwards).</summary>
    public double? Scale { get; init; }
    public int Solves { get; init; }
    public int LargestSolve { get; init; }
    public double Milliseconds { get; init; }
    public required string Note { get; init; }
}

/// <summary>Everything the scalable solver reports.</summary>
public sealed record ScalableResult
{
    public required SolveStatus Status { get; init; }

    /// <summary>The exact scale of the returned grid layout: min ‖uᵢ − uⱼ‖ / ℓᵢⱼ over all pairs.</summary>
    public double? Scale { get; init; }
    public double? TreeMakerScale { get; init; }

    /// <summary>A proved upper bound: m̄ = √2·N / ℓmax. The pipeline proves nothing tighter.</summary>
    public double UpperBound { get; init; }

    /// <summary>The best continuous layout's scale (a local optimum of the relaxation off the grid; not a bound).</summary>
    public double? ContinuousScale { get; init; }

    public IReadOnlyList<LeafPlacement> Layout { get; init; } = Array.Empty<LeafPlacement>();

    /// <summary>The continuous layout, for drawing beside the grid one.</summary>
    public IReadOnlyList<ContinuousPoint> ContinuousLayout { get; init; } = Array.Empty<ContinuousPoint>();
    public IReadOnlyList<PairReport> Pairs { get; init; } = Array.Empty<PairReport>();

    /// <summary>Strained edge lengths when Stage 4 closed the polygons; empty otherwise.</summary>
    public IReadOnlyList<EdgeReport> EdgeLengths { get; init; } = Array.Empty<EdgeReport>();
    public IReadOnlyList<string> Violations { get; init; } = Array.Empty<string>();

    public List<StageSummary> Stages { get; init; } = new();
    public List<StageRound> Rounds { get; init; } = new();

    public int TightBefore { get; init; }
    public int TightAfter { get; init; }

    /// <summary>True when the tight paths at the returned lengths divide the leaves' hull into valid polygons.</summary>
    public bool PolygonsValid { get; init; }
    public int TotalSolves => Rounds.Count;
    public int LargestSolve => Rounds.Select(r => r.Variables).DefaultIfEmpty(0).Max();
    public double Milliseconds { get; init; }

    /// <summary>The base model's size, for comparison (one solve).</summary>
    public required ModelMetrics BaseModel { get; init; }
    public IReadOnlyList<string> Messages { get; init; } = Array.Empty<string>();
}

/// <summary>A leaf's position in the continuous layout.</summary>
public sealed record ContinuousPoint(string Leaf, double X, double Y);

/// <summary>What is known before solving.</summary>
public sealed record ScalableAnalysis
{
    public int Leaves { get; init; }
    public int Pairs { get; init; }
    public int Edges { get; init; }
    public double ScaleUpperBound { get; init; }

    /// <summary>Stage 1: variables and rows of each linear program.</summary>
    public int LpVariables { get; init; }
    public int LpRows { get; init; }

    /// <summary>Stage 2: Booleans in one repair model ((2h + 1)² per leaf at most).</summary>
    public int RepairBooleans { get; init; }
    public int RepairWindowPoints { get; init; }

    /// <summary>The base model, for comparison.</summary>
    public required ModelMetrics BaseModel { get; init; }
}
