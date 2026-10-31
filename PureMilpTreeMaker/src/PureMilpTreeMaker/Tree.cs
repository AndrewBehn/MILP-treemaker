namespace PureMilpTreeMaker;

/// <summary>An undirected edge of the tree with its positive length ℓₑ in tree units (P:2).</summary>
/// <param name="Index">Position of the edge in <see cref="Tree.Edges"/>.</param>
/// <param name="U">One end vertex.</param>
/// <param name="V">The other end vertex.</param>
/// <param name="Length">ℓₑ &gt; 0; need not be an integer.</param>
public readonly record struct TreeEdge(int Index, int U, int V, double Length);

/// <summary>An unordered pair of distinct leaves {i, j} ∈ 𝒫, stored with I &lt; J (leaf order).</summary>
/// <param name="I">Leaf vertex with the smaller leaf index.</param>
/// <param name="J">Leaf vertex with the larger leaf index.</param>
public readonly record struct LeafPair(int I, int J);

/// <summary>
/// The input tree T = (V, E) of P:1 with the edge lengths of P:2. Vertices are numbered 0..|V|−1 in the
/// order their names first appear. Leaves are the vertices of degree 1 (Section 3, "Leaves").
/// </summary>
public sealed class Tree
{
    private readonly string[] _names;
    private readonly Dictionary<string, int> _ids;
    private readonly List<(int To, int Edge)>[] _adjacency;
    private readonly Dictionary<LeafPair, int[]> _pathEdges = new();
    private readonly int[] _leafIndex;

    private Tree(string[] names, Dictionary<string, int> ids, List<TreeEdge> edges)
    {
        int n = names.Length;
        if (n < 2)
        {
            throw new ArgumentException("A tree needs at least two vertices.");
        }
        if (edges.Count != n - 1)
        {
            throw new ArgumentException($"A tree on {n} vertices has {n - 1} edges, but {edges.Count} were given.");
        }

        _names = names;
        _ids = ids;
        _adjacency = new List<(int, int)>[n];
        for (int v = 0; v < n; v++)
        {
            _adjacency[v] = new List<(int, int)>();
        }

        var seen = new HashSet<(int, int)>();
        foreach (var e in edges)
        {
            if (!seen.Add((Math.Min(e.U, e.V), Math.Max(e.U, e.V))))
            {
                throw new ArgumentException($"Duplicate edge {names[e.U]}–{names[e.V]}.");
            }
            _adjacency[e.U].Add((e.V, e.Index));
            _adjacency[e.V].Add((e.U, e.Index));
        }

        Edges = edges.AsReadOnly();
        if (Reachable(0) != n)
        {
            throw new ArgumentException("The edges do not form a connected tree.");
        }

        Leaves = Enumerable.Range(0, n).Where(v => _adjacency[v].Count == 1).ToArray();
        if (Leaves.Count < 2)
        {
            throw new ArgumentException("The tree needs at least two leaves.");
        }

        _leafIndex = Enumerable.Repeat(-1, n).ToArray();
        for (int k = 0; k < Leaves.Count; k++)
        {
            _leafIndex[Leaves[k]] = k;
        }

        var pairs = new List<LeafPair>();
        for (int a = 0; a < Leaves.Count; a++)
        {
            for (int b = a + 1; b < Leaves.Count; b++)
            {
                var pair = new LeafPair(Leaves[a], Leaves[b]);
                pairs.Add(pair);
                _pathEdges[pair] = FindPath(pair.I, pair.J);
            }
        }
        Pairs = pairs.AsReadOnly();
    }

    /// <summary>Number of vertices |V|.</summary>
    public int VertexCount => _names.Length;

    /// <summary>The edge set E, indexed by <see cref="TreeEdge.Index"/>.</summary>
    public IReadOnlyList<TreeEdge> Edges { get; }

    /// <summary>The leaves L, in increasing vertex order; n = |L|.</summary>
    public IReadOnlyList<int> Leaves { get; }

    /// <summary>The leaf pairs 𝒫, in lexicographic leaf order.</summary>
    public IReadOnlyList<LeafPair> Pairs { get; }

    /// <summary>Builds a tree from named edges (P:1, P:2). Lengths must be positive and finite.</summary>
    public static Tree FromEdges(IEnumerable<(string U, string V, double Length)> edges)
    {
        ArgumentNullException.ThrowIfNull(edges);

        var names = new List<string>();
        var ids = new Dictionary<string, int>(StringComparer.Ordinal);
        var list = new List<TreeEdge>();

        int IdOf(string name)
        {
            if (!ids.TryGetValue(name, out int id))
            {
                id = names.Count;
                ids[name] = id;
                names.Add(name);
            }
            return id;
        }

        foreach (var (u, v, length) in edges)
        {
            var a = u?.Trim() ?? "";
            var b = v?.Trim() ?? "";
            if (a.Length == 0 || b.Length == 0)
            {
                throw new ArgumentException("Vertex names must be non-empty.");
            }
            if (a == b)
            {
                throw new ArgumentException($"Self-loop at {a}.");
            }
            if (!(length > 0) || double.IsInfinity(length))
            {
                throw new ArgumentException($"Edge {a}–{b} has length {length}; lengths must be positive (P:2).");
            }
            list.Add(new TreeEdge(list.Count, IdOf(a), IdOf(b), length));
        }

        return new Tree(names.ToArray(), ids, list);
    }

    /// <summary>The name of vertex v.</summary>
    public string Name(int v) => _names[v];

    /// <summary>The vertex id of a named vertex.</summary>
    public int Id(string name) =>
        _ids.TryGetValue(name, out int id) ? id : throw new KeyNotFoundException($"No vertex named '{name}'.");

    /// <summary>True when the tree has a vertex with this name.</summary>
    public bool Contains(string name) => _ids.ContainsKey(name);

    /// <summary>deg(v).</summary>
    public int Degree(int v) => _adjacency[v].Count;

    /// <summary>True when v is a leaf.</summary>
    public bool IsLeaf(int v) => _leafIndex[v] >= 0;

    /// <summary>The position of leaf v in <see cref="Leaves"/>, or −1 for an internal vertex.</summary>
    public int LeafIndex(int v) => _leafIndex[v];

    /// <summary>The edge indices of path(i, j) for a leaf pair (any order of i and j).</summary>
    public IReadOnlyList<int> PathEdges(int i, int j) => _pathEdges[Normalize(i, j)];

    /// <summary>The unordered pair {i, j} in the stored orientation (I has the smaller leaf index).</summary>
    public LeafPair Normalize(int i, int j)
    {
        if (!IsLeaf(i) || !IsLeaf(j) || i == j)
        {
            throw new ArgumentException("A leaf pair needs two distinct leaves.");
        }
        return _leafIndex[i] < _leafIndex[j] ? new LeafPair(i, j) : new LeafPair(j, i);
    }

    /// <summary>The edge index joining u and v; throws if they are not adjacent.</summary>
    public int EdgeBetween(int u, int v)
    {
        foreach (var (to, edge) in _adjacency[u])
        {
            if (to == v)
            {
                return edge;
            }
        }
        throw new ArgumentException($"{Name(u)} and {Name(v)} are not adjacent.");
    }

    /// <summary>A short label for an edge, such as "v–3".</summary>
    public string EdgeLabel(int edge) => $"{Name(Edges[edge].U)}–{Name(Edges[edge].V)}";

    private int Reachable(int source)
    {
        var visited = new bool[_names.Length];
        var stack = new Stack<int>();
        stack.Push(source);
        visited[source] = true;
        int count = 1;
        while (stack.Count > 0)
        {
            int v = stack.Pop();
            foreach (var (to, _) in _adjacency[v])
            {
                if (!visited[to])
                {
                    visited[to] = true;
                    count++;
                    stack.Push(to);
                }
            }
        }
        return count;
    }

    private int[] FindPath(int from, int to)
    {
        int n = _names.Length;
        var viaEdge = Enumerable.Repeat(-1, n).ToArray();
        var parent = Enumerable.Repeat(-1, n).ToArray();
        var visited = new bool[n];
        var stack = new Stack<int>();
        stack.Push(from);
        visited[from] = true;
        while (stack.Count > 0)
        {
            int v = stack.Pop();
            if (v == to)
            {
                break;
            }
            foreach (var (next, edge) in _adjacency[v])
            {
                if (!visited[next])
                {
                    visited[next] = true;
                    parent[next] = v;
                    viaEdge[next] = edge;
                    stack.Push(next);
                }
            }
        }

        var path = new List<int>();
        for (int v = to; v != from; v = parent[v])
        {
            path.Add(viaEdge[v]);
        }
        path.Reverse();
        return path.ToArray();
    }
}
