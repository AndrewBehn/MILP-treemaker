namespace PureMilpTreeMaker;

/// <summary>Model size predicted from the parameters alone, without building the MILP (Section 10's counts).</summary>
public static class ModelSize
{
    /// <summary>The variable, row, and nonzero counts that <see cref="PureMilpModel.Build"/> will produce for <paramref name="spec"/>.</summary>
    public static ModelMetrics Predict(ProblemSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        var tree = spec.Tree;
        var definitions = new Definitions(tree, spec.GridSize);
        int n = spec.GridSize;
        int pairs = tree.Pairs.Count;
        int selectors = definitions.SelectorsPerPair;
        int edges = tree.Edges.Count;

        // Offsets with a nonzero x component (and, by symmetry, a nonzero y component): 2N·(2N + 1).
        long nonzeroComponent = 2L * n * (2L * n + 1);

        int continuous;
        int rows = 4 * pairs + 2 * spec.MirrorPairs.Count;
        long nonzeros = pairs * (selectors + 2 * (2 + nonzeroComponent) + selectors) + 4L * spec.MirrorPairs.Count;

        switch (spec.Stage)
        {
            case Stage.Scale:
                continuous = 1;
                nonzeros += pairs; // −ℓᵢⱼ·m in every C:4 row
                break;

            case Stage.Edge:
                continuous = 1;
                var stretchSet = new HashSet<int>(spec.StretchSet);
                nonzeros += tree.Pairs.Count(p => definitions.StretchableLength(p, stretchSet) > 0);
                break;

            default:
                bool largest = spec.StrainObjective == StrainObjective.LargestAbsolute;
                continuous = 2 * edges + (largest ? 1 : 0);
                rows += 2 * edges + (largest ? edges : 0);
                nonzeros += tree.Pairs.Sum(p => (long)tree.PathEdges(p.I, p.J).Count);
                nonzeros += 4L * edges + (largest ? 2L * edges : 0);
                break;
        }

        int binaries = pairs * selectors;
        int integers = 2 * tree.Leaves.Count;
        return new ModelMetrics
        {
            Variables = binaries + integers + continuous,
            BinaryVariables = binaries,
            IntegerVariables = integers,
            ContinuousVariables = continuous,
            Constraints = rows,
            Nonzeros = nonzeros,
            LeafCount = tree.Leaves.Count,
            PairCount = pairs,
            SelectorsPerPair = selectors,
            CandidateOffsets = selectors,
            ScaleUpperBound = definitions.ScaleUpperBound,
        };
    }
}
