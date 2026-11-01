namespace TreeMaker.Core;

/// <summary>Which model of the Pure MILP doc to solve.</summary>
public enum Stage
{
    /// <summary>Scale optimization: C:1–C:4, maximize m (Sections 6–8).</summary>
    Scale,

    /// <summary>Edge optimization: C:1–C:3 and C:5 at fixed scale m₀, maximize the common stretch σ (Section 11.2).</summary>
    Edge,

    /// <summary>Strain optimization: C:1–C:3, C:6, and C:7 at a target scale m₀, minimize strain (Section 11.3).</summary>
    Strain,
}

/// <summary>How strain optimization measures distortion (Section 11.3).</summary>
public enum StrainObjective
{
    /// <summary>Minimize Σ aₑ, the total absolute strain (the doc's objective).</summary>
    TotalAbsolute,

    /// <summary>Minimize a_max with a_max ≥ aₑ for every edge, which spreads distortion evenly.</summary>
    LargestAbsolute,
}

/// <summary>Optional TreeMaker position conditions for a single leaf (Section 7, "Optional TreeMaker conditions").</summary>
public enum LeafConditionKind
{
    LeftEdge,
    RightEdge,
    BottomEdge,
    TopEdge,
    BottomLeftCorner,
    BottomRightCorner,
    TopLeftCorner,
    TopRightCorner,

    /// <summary>On the vertical symmetry axis: 2xᵢ = N (N must be even).</summary>
    OnSymmetryAxis,

    /// <summary>At a given grid point (X, Y).</summary>
    Fixed,
}

/// <summary>A position condition on one leaf.</summary>
/// <param name="Leaf">The leaf's vertex name.</param>
/// <param name="Kind">The condition.</param>
/// <param name="X">The x coordinate for <see cref="LeafConditionKind.Fixed"/>.</param>
/// <param name="Y">The y coordinate for <see cref="LeafConditionKind.Fixed"/>.</param>
public sealed record LeafCondition(string Leaf, LeafConditionKind Kind, int? X = null, int? Y = null);

/// <summary>A mirrored pair under book symmetry about the vertical axis: x_a + x_b = N and y_a = y_b.</summary>
public sealed record MirrorPair(string A, string B);

/// <summary>Solver controls passed through to SCIP.</summary>
public sealed record SolverSettings
{
    /// <summary>Wall-clock limit per solve; null means no limit.</summary>
    public TimeSpan? TimeLimit { get; init; }

    /// <summary>Relative MIP gap at which SCIP stops. The default keeps results exact for testing.</summary>
    public double RelativeGap { get; init; } = 1e-7;

    /// <summary>Thread count, when the solver supports setting it.</summary>
    public int? Threads { get; init; }

    /// <summary>Print SCIP's log to the console.</summary>
    public bool LogToConsole { get; init; }
}

/// <summary>Everything needed to build and solve one model of the Pure MILP doc.</summary>
public sealed record ProblemSpec
{
    /// <summary>The tree T with its edge lengths (P:1, P:2).</summary>
    public required Tree Tree { get; init; }

    /// <summary>The grid size N (P:3).</summary>
    public required int GridSize { get; init; }

    /// <summary>Which model to solve.</summary>
    public Stage Stage { get; init; } = Stage.Scale;

    /// <summary>Optional position conditions on individual leaves.</summary>
    public IReadOnlyList<LeafCondition> LeafConditions { get; init; } = Array.Empty<LeafCondition>();

    /// <summary>Optional mirrored pairs under book symmetry.</summary>
    public IReadOnlyList<MirrorPair> MirrorPairs { get; init; } = Array.Empty<MirrorPair>();

    /// <summary>The stretch set S, as edge indices (P:5, edge optimization).</summary>
    public IReadOnlyCollection<int> StretchSet { get; init; } = Array.Empty<int>();

    /// <summary>
    /// The fixed scale m₀ for edge optimization (P:4). When null, the scale stage is solved first and its
    /// optimum m* is used, with its layout as the starting solution.
    /// </summary>
    public double? FixedScale { get; init; }

    /// <summary>The target scale m₀ for strain optimization (P:4).</summary>
    public double TargetScale { get; init; }

    /// <summary>Lower strain bound σ_min, with −1 &lt; σ_min ≤ 0 (P:6).</summary>
    public double StrainMin { get; init; } = -0.5;

    /// <summary>Upper strain bound σ_max ≥ 0 (P:6).</summary>
    public double StrainMax { get; init; } = 0.5;

    /// <summary>The strain objective (Section 11.3).</summary>
    public StrainObjective StrainObjective { get; init; } = StrainObjective.TotalAbsolute;

    /// <summary>Solver controls.</summary>
    public SolverSettings Solver { get; init; } = new();

    /// <summary>
    /// A layout to start from, for example one imported from a layout file. The base model passes it to SCIP as a
    /// solution hint; the optimized search uses it as its seed; the scalable pipeline repairs and improves around it.
    /// </summary>
    public IReadOnlyList<LeafPlacement>? StartLayout { get; init; }

    /// <summary>
    /// Adds the symmetry breaking of the Symmetry-Breaking MILP doc to the base model: the anchor leaf in the
    /// fundamental domain (C:5) and interchangeable siblings in order (C:6). The optimum m* does not change.
    /// </summary>
    public bool SymmetryBreaking { get; init; }

    /// <summary>Checks the parameters that do not depend on solving; throws <see cref="ArgumentException"/> on error.</summary>
    public void Validate()
    {
        ArgumentNullException.ThrowIfNull(Tree);
        if (GridSize < 1)
        {
            throw new ArgumentException("The grid size N must be at least 1 (P:3).");
        }

        var conditioned = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in LeafConditions)
        {
            RequireLeaf(c.Leaf);
            if (!conditioned.Add(c.Leaf))
            {
                throw new ArgumentException($"Leaf {c.Leaf} has more than one position condition.");
            }
            if (c.Kind == LeafConditionKind.Fixed)
            {
                if (c.X is not int x || c.Y is not int y || x < 0 || y < 0 || x > GridSize || y > GridSize)
                {
                    throw new ArgumentException($"Leaf {c.Leaf} is fixed outside the grid {{0, …, {GridSize}}}².");
                }
            }
            if (c.Kind == LeafConditionKind.OnSymmetryAxis && GridSize % 2 != 0)
            {
                throw new ArgumentException("A leaf on the symmetry axis needs an even grid size N.");
            }
        }

        foreach (var p in MirrorPairs)
        {
            RequireLeaf(p.A);
            RequireLeaf(p.B);
            if (p.A == p.B)
            {
                throw new ArgumentException($"Mirror pair {p.A}–{p.B} needs two different leaves.");
            }
        }

        switch (Stage)
        {
            case Stage.Edge:
                if (StretchSet.Count == 0)
                {
                    throw new ArgumentException("Edge optimization needs a non-empty stretch set S (P:5).");
                }
                foreach (int e in StretchSet)
                {
                    if (e < 0 || e >= Tree.Edges.Count)
                    {
                        throw new ArgumentException($"Stretch-set edge index {e} is not an edge of the tree.");
                    }
                }
                if (FixedScale is double m0 && !(m0 > 0))
                {
                    throw new ArgumentException("The fixed scale m₀ must be positive (P:4).");
                }
                break;

            case Stage.Strain:
                if (!(TargetScale > 0) || double.IsInfinity(TargetScale))
                {
                    throw new ArgumentException("Strain optimization needs a positive target scale m₀ (P:4).");
                }
                if (!(StrainMin > -1) || StrainMin > 0 || StrainMax < 0)
                {
                    throw new ArgumentException("Strain bounds must satisfy −1 < σ_min ≤ 0 ≤ σ_max (P:6).");
                }
                break;
        }

        if (StartLayout is { } start)
        {
            var seen = new HashSet<int>();
            foreach (var p in start)
            {
                if (!Tree.Contains(p.Leaf) || !Tree.IsLeaf(Tree.Id(p.Leaf)) || !seen.Add(Tree.Id(p.Leaf)))
                {
                    throw new ArgumentException($"The starting layout places '{p.Leaf}', which is not a leaf, or places it twice.");
                }
                if (p.X < 0 || p.Y < 0 || p.X > GridSize || p.Y > GridSize)
                {
                    throw new ArgumentException($"The starting layout puts leaf {p.Leaf} at ({p.X}, {p.Y}), outside the {GridSize} × {GridSize} grid.");
                }
            }
            if (seen.Count != Tree.Leaves.Count)
            {
                throw new ArgumentException("The starting layout must place every leaf of the tree.");
            }
        }
    }

    private void RequireLeaf(string name)
    {
        if (!Tree.Contains(name) || !Tree.IsLeaf(Tree.Id(name)))
        {
            throw new ArgumentException($"'{name}' is not a leaf of the tree.");
        }
    }
}
