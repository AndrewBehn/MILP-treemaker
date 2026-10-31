using PureMilpTreeMaker;

namespace ScalableMilpTreeMaker.Web;

public sealed record EdgeDto(string From, string To, double Length, bool Stretch = false);
public sealed record LeafConditionDto(string Leaf, LeafConditionKind Kind, int? X = null, int? Y = null);
public sealed record MirrorPairDto(string A, string B);

/// <summary>The problem and the optimizations to use, as the UI sends them.</summary>
public sealed record ProblemDto
{
    public List<EdgeDto> Edges { get; init; } = new();
    public int GridSize { get; init; } = 9;
    public List<LeafConditionDto> LeafConditions { get; init; } = new();
    public List<MirrorPairDto> MirrorPairs { get; init; } = new();
    public double? TimeLimitSeconds { get; init; }
    public int? Threads { get; init; }

    /// <summary>A layout to start the solve from, such as an imported layout file; omitted to start fresh.</summary>
    public List<LayoutPointDto>? StartLayout { get; init; }
    public ScalableMilpTreeMaker.ScalableOptions Options { get; init; } = new();

    public ProblemSpec ToSpec()
    {
        if (Edges.Count == 0) throw new ArgumentException("Add at least one edge.");
        var tree = Tree.FromEdges(Edges.Select(e => (e.From, e.To, e.Length)));
        var spec = new ProblemSpec
        {
            Tree = tree,
            GridSize = GridSize,
            Stage = Stage.Scale,
            LeafConditions = LeafConditions.Select(c => new LeafCondition(c.Leaf, c.Kind, c.X, c.Y)).ToArray(),
            MirrorPairs = MirrorPairs.Select(m => new MirrorPair(m.A, m.B)).ToArray(),
            Solver = new SolverSettings
            {
                TimeLimit = TimeLimitSeconds is > 0 ? TimeSpan.FromSeconds(TimeLimitSeconds.Value) : null,
                Threads = Threads,
            },
        };
        if (StartLayout is { Count: > 0 } start)
        {
            spec = spec with { StartLayout = ActivePaths.Place(tree, start.Select(p => (p.Leaf, p.X, p.Y))) };
        }
        spec.Validate();
        return spec;
    }

    public static ProblemDto RunningExample() => new()
    {
        Edges = new()
        {
            new("1", "u", 3), new("2", "u", 2), new("u", "v", 3), new("v", "3", 2), new("v", "4", 4),
        },
        GridSize = 9,
    };

    /// <summary>A random tree from <see cref="ScalableMilpTreeMaker.TreeGenerator"/>, on its suggested grid.</summary>
    public static ProblemDto Random(int leaves, int seed, bool wholeLengths) => new()
    {
        Edges = ScalableMilpTreeMaker.TreeGenerator.Random(leaves, seed, wholeLengths).Select(e => new EdgeDto(e.From, e.To, e.Length)).ToList(),
        GridSize = ScalableMilpTreeMaker.TreeGenerator.SuggestedGrid(leaves),
    };
}

/// <summary>A leaf's grid point, as the UI sends it.</summary>
public sealed record LayoutPointDto(string Leaf, int X, int Y);

/// <summary>A solved layout to analyze for polygons, or to complete into polygons (steps 1 and 2 toward a crease pattern).</summary>
public sealed record PolygonRequest
{
    public required ProblemDto Problem { get; init; }
    public List<LayoutPointDto> Layout { get; init; } = new();
    public double Scale { get; init; }

    /// <summary>The edge lengths the layout was solved with, by edge index; the tree's lengths when omitted.</summary>
    public List<double>? EdgeLengths { get; init; }
    public double? StrainMin { get; init; }
    public double? StrainMax { get; init; }

    /// <summary>Pleat the flaps down to this height (grid units) when building the crease pattern; no pleating when omitted.</summary>
    public double? PleatHeight { get; init; }

    /// <summary>Pairs to make tight; a triangulation when omitted.</summary>
    public List<PureMilpTreeMaker.LeafPairName>? Targets { get; init; }
}

/// <summary>A layout read from a layout file, to show as if just solved (schemas/treemaker-layout.schema.json).</summary>
public sealed record ImportLayoutRequest
{
    public required ProblemDto Problem { get; init; }
    public List<LayoutPointDto> Layout { get; init; } = new();

    /// <summary>The scale saved with the layout; its exact scale when omitted.</summary>
    public double? Scale { get; init; }

    /// <summary>The edge lengths the layout was solved or closed with, by edge index; the tree's when omitted.</summary>
    public List<double>? EdgeLengths { get; init; }
}
