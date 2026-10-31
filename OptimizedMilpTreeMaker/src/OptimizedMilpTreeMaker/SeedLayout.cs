using PureMilpTreeMaker;

namespace OptimizedMilpTreeMaker;

/// <summary>
/// A cheap starting layout, standing in for the rounded TreeMaker layout of base Section 9 (which needs a continuous,
/// nonlinear solve). Leaves go around the sheet's border in the tree's depth-first order, which is where TreeMaker
/// puts them, at evenly spaced grid points; the best of several rotations is kept. Its exact scale is a known-feasible
/// lower bound for the bisection, and the layout centres the first leaf windows.
/// </summary>
public static class SeedLayout
{
    /// <summary>The seed layout by vertex id, or null when the border has fewer grid points than there are leaves.</summary>
    public static Dictionary<int, (int X, int Y)>? Create(Definitions definitions)
    {
        var tree = definitions.Tree;
        int n = definitions.GridSize;
        int leaves = tree.Leaves.Count;
        int border = 4 * n;
        if (n < 1 || leaves > border)
        {
            return null;
        }

        var order = DepthFirstLeaves(tree);
        var ring = Border(n);
        double step = (double)border / leaves;
        Dictionary<int, (int X, int Y)>? best = null;
        double bestScale = -1;
        int tries = Math.Max(1, (int)Math.Ceiling(step));
        for (int shift = 0; shift < tries; shift++)
        {
            var layout = new Dictionary<int, (int X, int Y)>();
            for (int k = 0; k < leaves; k++)
            {
                int at = (shift + (int)Math.Floor(k * step)) % border;
                layout[order[k]] = ring[at];
            }
            double scale = Scale(definitions, layout);
            if (scale > bestScale)
            {
                bestScale = scale;
                best = layout;
            }
        }
        return best;
    }

    /// <summary>The exact scale of a layout: min over pairs of ‖uᵢ − uⱼ‖₂ / ℓᵢⱼ.</summary>
    public static double Scale(Definitions definitions, IReadOnlyDictionary<int, (int X, int Y)> layout)
    {
        double best = double.PositiveInfinity;
        foreach (var pair in definitions.Tree.Pairs)
        {
            var (xi, yi) = layout[pair.I];
            var (xj, yj) = layout[pair.J];
            double d = Math.Sqrt((double)(xi - xj) * (xi - xj) + (double)(yi - yj) * (yi - yj));
            best = Math.Min(best, d / definitions.PathLength(pair));
        }
        return best;
    }

    private static List<int> DepthFirstLeaves(Tree tree)
    {
        var adjacency = new List<int>[tree.VertexCount];
        for (int v = 0; v < tree.VertexCount; v++) adjacency[v] = new List<int>();
        foreach (var e in tree.Edges)
        {
            adjacency[e.U].Add(e.V);
            adjacency[e.V].Add(e.U);
        }
        var order = new List<int>();
        var seen = new bool[tree.VertexCount];
        var stack = new Stack<int>();
        int start = tree.Leaves[0];
        stack.Push(start);
        while (stack.Count > 0)
        {
            int v = stack.Pop();
            if (seen[v]) continue;
            seen[v] = true;
            if (tree.IsLeaf(v)) order.Add(v);
            for (int k = adjacency[v].Count - 1; k >= 0; k--)
            {
                if (!seen[adjacency[v][k]]) stack.Push(adjacency[v][k]);
            }
        }
        return order;
    }

    /// <summary>The 4N border points of [0, N]², counter-clockwise from (0, 0).</summary>
    private static List<(int X, int Y)> Border(int n)
    {
        var ring = new List<(int, int)>(4 * n);
        for (int x = 0; x < n; x++) ring.Add((x, 0));
        for (int y = 0; y < n; y++) ring.Add((n, y));
        for (int x = n; x > 0; x--) ring.Add((x, n));
        for (int y = n; y > 0; y--) ring.Add((0, y));
        return ring;
    }
}
