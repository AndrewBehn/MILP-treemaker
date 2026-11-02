using TreeMaker.Core;

namespace TreeMaker.Web;

/// <summary>A crease pattern's lines, as the crease-pattern page (cp.html) reads them from a file or an image.</summary>
public sealed record CpFoldRequest
{
    public List<CpLine> Lines { get; init; } = new();

    /// <summary>How far from exact the angles may be, in degrees (traced images); exact when omitted.</summary>
    public double? ToleranceDegrees { get; init; }
}

/// <summary>
/// The crease-pattern page, a side tool beside the session: fold any crease pattern flat (/api/cp/fold). It shares
/// nothing with the session and holds no state; it reads lines and returns the folded faces and the checks.
/// </summary>
public static class CreasePatternEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapPost("/fold", (CpFoldRequest request) => Solving.Checked(() =>
        {
            if (request.Lines.Count > 20000) throw new ArgumentException("At most 20,000 lines.");
            return CreasePatternFold.Fold(request.Lines, request.ToleranceDegrees is > 0 and <= 10 ? request.ToleranceDegrees : null);
        }));
    }
}
