namespace PureMilpTreeMaker.Tests;

/// <summary>The running example of the doc: leaves 1–4, internal vertices u and v.</summary>
internal static class RunningExample
{
    // Edge indices follow this order: 0 = 1–u, 1 = 2–u, 2 = u–v, 3 = v–3, 4 = v–4.
    public static Tree Tree(double factor = 1) => PureMilpTreeMaker.Tree.FromEdges(new[]
    {
        ("1", "u", 3 * factor),
        ("2", "u", 2 * factor),
        ("u", "v", 3 * factor),
        ("v", "3", 2 * factor),
        ("v", "4", 4 * factor),
    });

    public const int EdgeV3 = 3;

    public static ProblemSpec Spec(int gridSize = 9, Stage stage = Stage.Scale) => new()
    {
        Tree = Tree(),
        GridSize = gridSize,
        Stage = stage,
    };
}
