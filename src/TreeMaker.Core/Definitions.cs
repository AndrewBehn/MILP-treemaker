namespace TreeMaker.Core;

/// <summary>A candidate offset δ = (Dx, Dy) ∈ Δ_N with its table length D(δ) (D:2).</summary>
public readonly record struct Offset(int Dx, int Dy, double Length);

/// <summary>
/// The quantities of Section 5, computed once from the parameters before solving:
/// D:1 path lengths ℓᵢⱼ and ℓmax, D:2 the offset lookup table D over Δ_N, D:3 the scale bound m̄,
/// and D:4 the stretchable path lengths sᵢⱼ used by edge optimization.
/// </summary>
public sealed class Definitions
{
    private readonly Dictionary<LeafPair, double> _pathLength = new();

    public Definitions(Tree tree, int gridSize)
    {
        ArgumentNullException.ThrowIfNull(tree);
        if (gridSize < 1)
        {
            throw new ArgumentException("The grid size N must be at least 1 (P:3).");
        }

        Tree = tree;
        GridSize = gridSize;

        foreach (var pair in tree.Pairs)
        {
            _pathLength[pair] = tree.PathEdges(pair.I, pair.J).Sum(e => tree.Edges[e].Length);
        }
        MaxPathLength = _pathLength.Values.Max();
        MinPathLength = _pathLength.Values.Min();

        var offsets = new List<Offset>((2 * gridSize + 1) * (2 * gridSize + 1) - 1);
        for (int dx = -gridSize; dx <= gridSize; dx++)
        {
            for (int dy = -gridSize; dy <= gridSize; dy++)
            {
                if (dx != 0 || dy != 0)
                {
                    offsets.Add(new Offset(dx, dy, Math.Sqrt((double)dx * dx + (double)dy * dy)));
                }
            }
        }
        CandidateOffsets = offsets.AsReadOnly();
        ScaleUpperBound = Math.Sqrt(2.0) * gridSize / MaxPathLength;
    }

    public Tree Tree { get; }

    /// <summary>N (P:3).</summary>
    public int GridSize { get; }

    /// <summary>Δ_N = {−N, …, N}² \ {(0, 0)} with D(δ) = ‖δ‖₂ (Section 3 and D:2).</summary>
    public IReadOnlyList<Offset> CandidateOffsets { get; }

    /// <summary>|Δ_N| = (2N + 1)² − 1, the number of offset selectors per pair.</summary>
    public int SelectorsPerPair => CandidateOffsets.Count;

    /// <summary>ℓmax (D:1).</summary>
    public double MaxPathLength { get; }

    /// <summary>ℓ_min, the shortest leaf path (used by the Section 9 bound).</summary>
    public double MinPathLength { get; }

    /// <summary>m̄ = √2·N / ℓmax (D:3).</summary>
    public double ScaleUpperBound { get; }

    /// <summary>ℓᵢⱼ = d(i, j) (D:1).</summary>
    public double PathLength(LeafPair pair) => _pathLength[pair];

    /// <summary>ℓᵢⱼ = d(i, j) for any order of the two leaves.</summary>
    public double PathLength(int i, int j) => _pathLength[Tree.Normalize(i, j)];

    /// <summary>sᵢⱼ = Σ ℓₑ over the edges of path(i, j) that lie in the stretch set S (D:4).</summary>
    public double StretchableLength(LeafPair pair, IReadOnlySet<int> stretchSet) =>
        Tree.PathEdges(pair.I, pair.J).Where(stretchSet.Contains).Sum(e => Tree.Edges[e].Length);

    /// <summary>The worst-case relative loss √2 / (N·m_TM·ℓ_min) of Section 9, for a known TreeMaker scale.</summary>
    public double RelativeLossBound(double treeMakerScale) =>
        Math.Sqrt(2.0) / (GridSize * treeMakerScale * MinPathLength);
}
