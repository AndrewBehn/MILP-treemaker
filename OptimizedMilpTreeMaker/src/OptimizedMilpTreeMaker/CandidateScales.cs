using PureMilpTreeMaker;

namespace OptimizedMilpTreeMaker;

/// <summary>
/// D:3: every lookup-table distance divided by a pair's path length, up to m̄. The optimum m* is one of them
/// (Section 5.4), so bisection over this sorted list finds it.
/// </summary>
public static class CandidateScales
{
    /// <summary>The distinct squared lengths dx² + dy² of nonzero offsets on the N × N sheet.</summary>
    public static IReadOnlyList<long> SquaredLengths(int gridSize)
    {
        var set = new HashSet<long>();
        for (int x = 0; x <= gridSize; x++)
        {
            for (int y = x; y <= gridSize; y++)
            {
                if (x != 0 || y != 0)
                {
                    set.Add((long)x * x + (long)y * y);
                }
            }
        }
        return set.OrderBy(s => s).ToArray();
    }

    /// <summary>The sorted, de-duplicated candidate scales c₁ &lt; c₂ &lt; … &lt; c_K.</summary>
    public static IReadOnlyList<double> Compute(Definitions definitions)
    {
        double bound = definitions.ScaleUpperBound * (1 + 1e-12);
        var lengths = definitions.Tree.Pairs.Select(definitions.PathLength).Distinct().ToArray();
        var values = new List<double>();
        foreach (long s in SquaredLengths(definitions.GridSize))
        {
            double d = Math.Sqrt(s);
            foreach (double l in lengths)
            {
                double c = d / l;
                if (c <= bound)
                {
                    values.Add(c);
                }
            }
        }
        values.Sort();
        var distinct = new List<double>(values.Count);
        foreach (double v in values)
        {
            if (distinct.Count == 0 || v - distinct[^1] > 1e-12 * v)
            {
                distinct.Add(v);
            }
        }
        return distinct;
    }

    /// <summary>The index of the largest candidate ≤ <paramref name="scale"/>, or −1.</summary>
    public static int IndexAtOrBelow(IReadOnlyList<double> candidates, double scale)
    {
        int lo = 0, hi = candidates.Count - 1, found = -1;
        double limit = scale * (1 + 1e-12);
        while (lo <= hi)
        {
            int mid = (lo + hi) / 2;
            if (candidates[mid] <= limit) { found = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return found;
    }
}
