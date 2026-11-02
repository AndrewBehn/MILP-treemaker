namespace TreeMaker.Core;

/// <summary>
/// Per-edge straining (P:8 and D:7 of the Polygon Closing TreeMaker spec): how much room each edge has, relative to the step's
/// bounds, and what straining it costs. Edge e may take σₑ ∈ [max(rₑσ_min, −0.99), rₑσ_max] (rₑ = 0 locks it), and the
/// least-strain objectives weigh |σₑ| by cₑ. With every rₑ = cₑ = 1 (the default) all edges share the bounds and cost
/// alike, as before.
/// </summary>
public sealed record EdgeStrain
{
    /// <summary>The room rₑ ≥ 0 of each edge, by edge index: a factor on the step's strain bounds. 0 locks the edge.</summary>
    public IReadOnlyList<double>? Room { get; init; }

    /// <summary>The cost cₑ ≥ 0 of straining each edge, by edge index, in the least-strain objectives.</summary>
    public IReadOnlyList<double>? Cost { get; init; }

    /// <summary>The lowest strain an edge can take: σₑ &gt; −1 keeps every length positive.</summary>
    public const double Floor = -0.99;

    public static readonly EdgeStrain Uniform = new();

    public double RoomOf(int edge) => Room is { } r ? r[edge] : 1;
    public double CostOf(int edge) => Cost is { } c ? c[edge] : 1;
    public bool Locked(int edge) => RoomOf(edge) == 0;

    /// <summary>Edge e's bounds within the step's bounds [σ_min, σ_max].</summary>
    public (double Lo, double Hi) Bounds(int edge, double strainMin, double strainMax)
    {
        double r = RoomOf(edge);
        return (Math.Max(r * strainMin, Floor), r * strainMax);
    }

    /// <summary>Throws when the lists do not give one finite, non-negative value per edge.</summary>
    public void Validate(int edges)
    {
        Check(Room, "room");
        Check(Cost, "cost");
        void Check(IReadOnlyList<double>? values, string what)
        {
            if (values is null) return;
            if (values.Count != edges) throw new ArgumentException($"There must be one edge {what} per edge ({edges}), not {values.Count}.");
            if (values.Any(v => !double.IsFinite(v) || v < 0)) throw new ArgumentException($"Every edge {what} must be a number ≥ 0.");
        }
    }

    /// <summary>Whether this is the default: every edge with room 1 and cost 1.</summary>
    public bool IsUniform => (Room is null || Room.All(v => v == 1)) && (Cost is null || Cost.All(v => v == 1));

    /// <summary>The settings from a request's lists (null or empty lists mean the default).</summary>
    public static EdgeStrain From(IReadOnlyList<double>? room, IReadOnlyList<double>? cost, int edges)
    {
        var s = new EdgeStrain { Room = room is { Count: > 0 } ? room : null, Cost = cost is { Count: > 0 } ? cost : null };
        s.Validate(edges);
        return s;
    }
}
