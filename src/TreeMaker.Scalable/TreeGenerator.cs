using TreeMaker.Core;

namespace TreeMaker.Scalable;

/// <summary>Random trees of a given size, for trying the pipeline at 25 to 100 leaves (the UI's larger presets).</summary>
public static class TreeGenerator
{
    /// <summary>
    /// A random tree with exactly <paramref name="leaves"/> leaves named 1, 2, …, and internal nodes a, b, …, aa, ….
    /// Every internal node branches (it gets two children when created), so there are no dead ends.
    /// Flap lengths are 1 to 3 and internal edges 1 to 2: whole numbers when <paramref name="wholeLengths"/>,
    /// otherwise two decimals.
    /// </summary>
    public static List<(string From, string To, double Length)> Random(int leaves, int seed, bool wholeLengths = true)
    {
        if (leaves < 2) throw new ArgumentException("A tree needs at least two leaves.");
        var random = new Random(seed);
        double Length(double lo, double hi) => wholeLengths
            ? random.Next((int)lo, (int)hi + 1)
            : Math.Round(lo + random.NextDouble() * (hi - lo), 2);

        var edges = new List<(string, string, double)>();
        var internalNodes = new List<string>();
        int leafCount = 0, internalCount = 0;
        string NewInternal() => InternalName(internalCount++);
        string NewLeaf() => (++leafCount).ToString(System.Globalization.CultureInfo.InvariantCulture);

        string root = NewInternal();
        internalNodes.Add(root);
        edges.Add((root, NewLeaf(), Length(1, 3)));
        edges.Add((root, NewLeaf(), Length(1, 3)));
        while (leafCount < leaves)
        {
            string parent = internalNodes[random.Next(internalNodes.Count)];
            if (leafCount + 2 <= leaves && random.NextDouble() < 0.35)
            {
                string branch = NewInternal();
                internalNodes.Add(branch);
                edges.Add((parent, branch, Length(1, 2)));
                edges.Add((branch, NewLeaf(), Length(1, 3)));
                edges.Add((branch, NewLeaf(), Length(1, 3)));
            }
            else
            {
                edges.Add((parent, NewLeaf(), Length(1, 3)));
            }
        }
        // A root with only its two first leaves would be a degree-2 joint; that is still a valid tree.
        return edges;
    }

    /// <summary>A grid size that usually fits: about 3.2·√leaves, at least 9.</summary>
    public static int SuggestedGrid(int leaves) => Math.Max(9, (int)Math.Round(3.2 * Math.Sqrt(leaves)));

    private static string InternalName(int k)
    {
        var name = "";
        k++;
        while (k > 0)
        {
            k--;
            name = (char)('a' + k % 26) + name;
            k /= 26;
        }
        return name;
    }
}
