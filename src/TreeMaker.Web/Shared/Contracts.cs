using TreeMaker.Core;

namespace TreeMaker.Web;

// Request shapes shared by every solver and step. Each solver's ProblemDto (Pure/, Optimized/, Scalable/) adds its
// own options to ProblemDtoBase; the steps after a layout read only the tree, the grid and the leaf conditions.

/// <summary>One tree edge as the UI sends it.</summary>
public sealed record EdgeDto(string From, string To, double Length, bool Stretch = false);

/// <summary>A leaf position condition as the UI sends it.</summary>
public sealed record LeafConditionDto(string Leaf, LeafConditionKind Kind, int? X = null, int? Y = null);

/// <summary>A mirrored leaf pair as the UI sends it.</summary>
public sealed record MirrorPairDto(string A, string B);

/// <summary>A leaf's grid point, as the UI sends it.</summary>
public sealed record LayoutPointDto(string Leaf, int X, int Y);

/// <summary>What every problem the UI sends has: the tree, the grid, the leaf conditions and the solve limits.</summary>
public abstract record ProblemDtoBase
{
    public List<EdgeDto> Edges { get; init; } = new();
    public int GridSize { get; init; } = 9;
    public List<LeafConditionDto> LeafConditions { get; init; } = new();
    public List<MirrorPairDto> MirrorPairs { get; init; } = new();
    public double? TimeLimitSeconds { get; init; }
    public int? Threads { get; init; }

    /// <summary>A layout to start the solve from, such as an imported layout file; omitted to start fresh.</summary>
    public List<LayoutPointDto>? StartLayout { get; init; }

    /// <summary>Builds the library's <see cref="ProblemSpec"/>; throws <see cref="ArgumentException"/> on bad input.</summary>
    public abstract ProblemSpec ToSpec();

    /// <summary>The spec every solver starts from: the tree, the grid, the conditions, the scale stage and the limits.</summary>
    protected ProblemSpec BaseSpec()
    {
        if (Edges.Count == 0)
        {
            throw new ArgumentException("Add at least one edge.");
        }
        return new ProblemSpec
        {
            Tree = Tree.FromEdges(Edges.Select(e => (e.From, e.To, e.Length))),
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
    }

    /// <summary>Adds the starting layout, if any, and validates the finished spec.</summary>
    protected ProblemSpec Finish(ProblemSpec spec)
    {
        if (StartLayout is { Count: > 0 } start)
        {
            spec = spec with { StartLayout = ActivePaths.Place(spec.Tree, start.Select(p => (p.Leaf, p.X, p.Y))) };
        }
        spec.Validate();
        return spec;
    }
}

/// <summary>A problem with no solver options: what the steps after a layout read (any solver's problem fits it).</summary>
public sealed record TreeProblemDto : ProblemDtoBase
{
    public override ProblemSpec ToSpec() => Finish(BaseSpec());
}

/// <summary>A solved layout to analyze for polygons, or to complete into polygons (steps 1 and 2 toward a crease pattern).</summary>
public sealed record PolygonRequest
{
    public required TreeProblemDto Problem { get; init; }
    public List<LayoutPointDto> Layout { get; init; } = new();
    public double Scale { get; init; }

    /// <summary>The edge lengths the layout was solved with, by edge index; the tree's lengths when omitted.</summary>
    public List<double>? EdgeLengths { get; init; }
    public double? StrainMin { get; init; }
    public double? StrainMax { get; init; }

    /// <summary>Per-edge room rₑ ≥ 0, by edge index: a factor on the strain bounds; 0 locks the edge. All 1 when omitted.</summary>
    public List<double>? EdgeRoom { get; init; }

    /// <summary>Per-edge cost cₑ ≥ 0 of straining, by edge index, in the least-strain objectives. All 1 when omitted.</summary>
    public List<double>? EdgeCost { get; init; }

    /// <summary>Pleat the flaps down to this height (grid units) when building the crease pattern; no pleating when omitted.</summary>
    public double? PleatHeight { get; init; }

    /// <summary>Pairs to make tight; a triangulation when omitted.</summary>
    public List<LeafPairName>? Targets { get; init; }
}

/// <summary>A layout from the workbench or a layout file, to show as if just solved (schemas/treemaker-layout.schema.json).</summary>
public sealed record ImportLayoutRequest<TProblem> where TProblem : ProblemDtoBase
{
    public required TProblem Problem { get; init; }
    public List<LayoutPointDto> Layout { get; init; } = new();

    /// <summary>The scale saved with the layout; its exact scale when omitted.</summary>
    public double? Scale { get; init; }

    /// <summary>The edge lengths the layout was solved or closed with, by edge index; the tree's when omitted.</summary>
    public List<double>? EdgeLengths { get; init; }
}
