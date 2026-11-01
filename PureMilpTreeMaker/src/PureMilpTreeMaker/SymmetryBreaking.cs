namespace PureMilpTreeMaker;

/// <summary>
/// Symmetry breaking, shared by two specs. The Symmetry-Breaking MILP doc adds it to the base model: the anchor leaf
/// (P:4) in the fundamental domain (C:5) and interchangeable siblings 𝒯 in order (C:6). The Optimized MILP doc uses
/// the same constraints in its feasibility models, where they are C:2 and C:3 (Section 4). This class finds 𝒯 and the
/// anchor, and maps any layout to the equivalent one those constraints allow.
/// </summary>
public sealed class SymmetryBreaking
{
    private SymmetryBreaking(int gridSize, int? anchor, IReadOnlyList<IReadOnlyList<int>> groups, string? note)
    {
        GridSize = gridSize;
        Anchor = anchor;
        SiblingGroups = groups;
        Note = note;
        SiblingOrder = groups.SelectMany(g => g.Zip(g.Skip(1), (a, b) => (a, b))).ToArray();
    }

    public int GridSize { get; }

    /// <summary>The anchor leaf (a vertex id), or null when C:2 does not apply.</summary>
    public int? Anchor { get; }

    /// <summary>Groups of interchangeable siblings (vertex ids, in increasing order); each has at least two leaves.</summary>
    public IReadOnlyList<IReadOnlyList<int>> SiblingGroups { get; }

    /// <summary>𝒯 as consecutive ordered pairs (a, b) within each group; C:3 orders each pair.</summary>
    public IReadOnlyList<(int A, int B)> SiblingOrder { get; }

    /// <summary>Why part of the symmetry breaking was left out, if it was.</summary>
    public string? Note { get; }

    /// <summary>
    /// Finds 𝒯 and r*. The sheet's symmetries are only valid without position conditions or mirror pairs, so those
    /// switch C:2 off; leaves that carry a condition or a mirror pair are not interchangeable, so they leave 𝒯.
    /// </summary>
    public static SymmetryBreaking Create(ProblemSpec spec)
    {
        var tree = spec.Tree;
        var constrained = new HashSet<int>();
        foreach (var c in spec.LeafConditions) constrained.Add(tree.Id(c.Leaf));
        foreach (var m in spec.MirrorPairs)
        {
            constrained.Add(tree.Id(m.A));
            constrained.Add(tree.Id(m.B));
        }

        // Group leaves by (parent, edge length).
        var groups = new Dictionary<(int Parent, double Length), List<int>>();
        foreach (int leaf in tree.Leaves)
        {
            if (constrained.Contains(leaf)) continue;
            var edge = tree.Edges.First(e => e.U == leaf || e.V == leaf);
            int parent = edge.U == leaf ? edge.V : edge.U;
            var key = (parent, edge.Length);
            if (!groups.TryGetValue(key, out var list)) groups[key] = list = new List<int>();
            list.Add(leaf);
        }
        var siblingGroups = groups.Values.Where(g => g.Count >= 2)
            .Select(g => (IReadOnlyList<int>)g.OrderBy(v => v).ToArray())
            .ToArray();

        int? anchor = null;
        string? note = null;
        if (spec.LeafConditions.Count > 0 || spec.MirrorPairs.Count > 0)
        {
            note = "Position conditions or mirror pairs fix the sheet's orientation, so the anchor constraint is off.";
        }
        else
        {
            var inGroups = new HashSet<int>(siblingGroups.SelectMany(g => g));
            var free = tree.Leaves.Where(l => !inGroups.Contains(l)).ToArray();
            if (free.Length > 0)
            {
                anchor = free[0];
            }
            else
            {
                note = "Every leaf has an interchangeable sibling, so there is no anchor leaf and the anchor constraint is off.";
            }
        }
        return new SymmetryBreaking(spec.GridSize, anchor, siblingGroups, note);
    }

    /// <summary>A switched-off instance: no 𝒯 and no anchor.</summary>
    public static SymmetryBreaking None(int gridSize) =>
        new(gridSize, null, Array.Empty<IReadOnlyList<int>>(), null);

    /// <summary>Is (x, y) in the fundamental domain 0 ≤ y ≤ x ≤ N/2 (Optimized C:2, Symmetry-Breaking C:5)?</summary>
    public bool InDomain(int x, int y) => 2 * x <= GridSize && 2 * y <= GridSize && y <= x;

    /// <summary>
    /// Maps a layout (by vertex id) to an equivalent one that satisfies C:2 and C:3: a symmetry of the square that puts
    /// the anchor in the fundamental domain, then sibling positions sorted (Section 6.9).
    /// </summary>
    public Dictionary<int, (int X, int Y)> Canonicalize(IReadOnlyDictionary<int, (int X, int Y)> layout)
    {
        int n = GridSize;
        var result = layout.ToDictionary(kv => kv.Key, kv => kv.Value);
        if (Anchor is int anchor && result.TryGetValue(anchor, out var a))
        {
            Func<(int X, int Y), (int X, int Y)>? chosen = null;
            foreach (var g in Symmetries(n))
            {
                var image = g(a);
                if (InDomain(image.X, image.Y)) { chosen = g; break; }
            }
            if (chosen is not null)
            {
                foreach (var key in result.Keys.ToArray()) result[key] = chosen(result[key]);
            }
        }
        foreach (var group in SiblingGroups)
        {
            var positions = group.Where(result.ContainsKey).Select(v => result[v])
                .OrderBy(p => Key(p.X, p.Y)).ToArray();
            var members = group.Where(result.ContainsKey).ToArray();
            for (int k = 0; k < members.Length; k++) result[members[k]] = positions[k];
        }
        return result;
    }

    /// <summary>The lexicographic key (N + 1)·x + y of the sibling order (Optimized C:3, Symmetry-Breaking C:6).</summary>
    public long Key(int x, int y) => (long)(GridSize + 1) * x + y;

    /// <summary>The 8 symmetries of the square [0, N]², identity first.</summary>
    public static IEnumerable<Func<(int X, int Y), (int X, int Y)>> Symmetries(int n)
    {
        yield return p => (p.X, p.Y);
        yield return p => (n - p.X, p.Y);
        yield return p => (p.X, n - p.Y);
        yield return p => (n - p.X, n - p.Y);
        yield return p => (p.Y, p.X);
        yield return p => (n - p.Y, p.X);
        yield return p => (p.Y, n - p.X);
        yield return p => (n - p.Y, n - p.X);
    }
}
