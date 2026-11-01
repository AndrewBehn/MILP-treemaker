using TreeMaker.Scalable;
using TreeMaker.Core;

namespace TreeMaker.Web.Scalable;

/// <summary>The scalable pipeline's problem as the UI sends it: the shared fields plus the stages and their settings.</summary>
public sealed record ProblemDto : ProblemDtoBase
{
    public ScalableOptions Options { get; init; } = new();

    public override ProblemSpec ToSpec() => Finish(BaseSpec());

    /// <summary>A random tree from <see cref="TreeGenerator"/>, on its suggested grid.</summary>
    public static ProblemDto Random(int leaves, int seed, bool wholeLengths) => new()
    {
        Edges = TreeGenerator.Random(leaves, seed, wholeLengths).Select(e => new EdgeDto(e.From, e.To, e.Length)).ToList(),
        GridSize = TreeGenerator.SuggestedGrid(leaves),
    };
}
