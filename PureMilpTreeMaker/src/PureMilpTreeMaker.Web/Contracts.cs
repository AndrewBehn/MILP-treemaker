namespace PureMilpTreeMaker.Web;

/// <summary>One tree edge as the UI sends it.</summary>
public sealed record EdgeDto(string From, string To, double Length, bool Stretch = false);

/// <summary>A leaf position condition as the UI sends it.</summary>
public sealed record LeafConditionDto(string Leaf, LeafConditionKind Kind, int? X = null, int? Y = null);

/// <summary>A mirrored leaf pair as the UI sends it.</summary>
public sealed record MirrorPairDto(string A, string B);

/// <summary>The full problem as the UI sends it.</summary>
public sealed record ProblemDto
{
    public List<EdgeDto> Edges { get; init; } = new();
    public int GridSize { get; init; } = 9;
    public Stage Stage { get; init; } = Stage.Scale;
    public List<LeafConditionDto> LeafConditions { get; init; } = new();
    public List<MirrorPairDto> MirrorPairs { get; init; } = new();
    public double? FixedScale { get; init; }
    public double? TargetScale { get; init; }
    public double? StrainMin { get; init; }
    public double? StrainMax { get; init; }
    public StrainObjective StrainObjective { get; init; } = StrainObjective.TotalAbsolute;
    public double? TimeLimitSeconds { get; init; }
    public double? RelativeGap { get; init; }
    public int? Threads { get; init; }

    /// <summary>A layout to start the solve from, such as an imported layout file; omitted to start fresh.</summary>
    public List<LayoutPointDto>? StartLayout { get; init; }

    /// <summary>Builds the library's <see cref="ProblemSpec"/>; throws <see cref="ArgumentException"/> on bad input.</summary>
    public ProblemSpec ToSpec()
    {
        if (Edges.Count == 0)
        {
            throw new ArgumentException("Add at least one edge.");
        }
        var tree = Tree.FromEdges(Edges.Select(e => (e.From, e.To, e.Length)));
        var spec = new ProblemSpec
        {
            Tree = tree,
            GridSize = GridSize,
            Stage = Stage,
            LeafConditions = LeafConditions.Select(c => new LeafCondition(c.Leaf, c.Kind, c.X, c.Y)).ToArray(),
            MirrorPairs = MirrorPairs.Select(m => new MirrorPair(m.A, m.B)).ToArray(),
            StretchSet = Edges.Select((e, i) => (e, i)).Where(t => t.e.Stretch).Select(t => t.i).ToArray(),
            FixedScale = FixedScale,
            TargetScale = TargetScale ?? 0,
            StrainMin = StrainMin ?? -0.5,
            StrainMax = StrainMax ?? 0.5,
            StrainObjective = StrainObjective,
            Solver = new SolverSettings
            {
                TimeLimit = TimeLimitSeconds is > 0 ? TimeSpan.FromSeconds(TimeLimitSeconds.Value) : null,
                RelativeGap = RelativeGap ?? 1e-7,
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

    /// <summary>The running example of the doc: four leaves, internal vertices u and v, on a 9 × 9 grid.</summary>
    public static ProblemDto RunningExample() => new()
    {
        Edges = new()
        {
            new("1", "u", 3), new("2", "u", 2), new("u", "v", 3), new("v", "3", 2, Stretch: true), new("v", "4", 4),
        },
        GridSize = 9,
        TargetScale = 1.2,
    };
}

/// <summary>What the UI shows before solving: the definitions of Section 5 and the predicted model size.</summary>
public sealed record AnalysisDto(
    IReadOnlyList<string> Leaves,
    IReadOnlyList<string> InternalVertices,
    IReadOnlyList<PairLengthDto> Pairs,
    double MaxPathLength,
    double MinPathLength,
    double ScaleUpperBound,
    ModelMetrics PredictedModel);

/// <summary>A leaf pair and its path length ℓᵢⱼ.</summary>
public sealed record PairLengthDto(string A, string B, double PathLength, double StretchableLength);

/// <summary>A solve result in UI-friendly units (milliseconds instead of <see cref="TimeSpan"/>).</summary>
public sealed record SolveResponse
{
    public required SolveResult Result { get; init; }
    public double BuildMilliseconds { get; init; }
    public double SolveMilliseconds { get; init; }
    public double TotalMilliseconds { get; init; }
    public double? StageOneMilliseconds { get; init; }

    public static SolveResponse From(SolveResult result, TimeSpan total) => new()
    {
        Result = result,
        BuildMilliseconds = result.Metrics.BuildTime.TotalMilliseconds,
        SolveMilliseconds = result.Metrics.SolveTime.TotalMilliseconds,
        TotalMilliseconds = total.TotalMilliseconds,
        StageOneMilliseconds = result.StageOne is { } s
            ? (s.Metrics.BuildTime + s.Metrics.SolveTime).TotalMilliseconds
            : null,
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
