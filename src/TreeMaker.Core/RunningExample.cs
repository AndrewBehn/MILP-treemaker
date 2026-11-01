namespace TreeMaker.Core;

/// <summary>
/// The running example of the specs: leaves 1–4 and internal vertices u and v, on a 9 × 9 grid unless stated.
/// One copy for the tests of every project and for the app's example tree.
/// </summary>
public static class RunningExample
{
    /// <summary>The edges in order (edge index = position): 0 = 1–u, 1 = 2–u, 2 = u–v, 3 = v–3, 4 = v–4.</summary>
    public static IReadOnlyList<(string From, string To, double Length)> Edges { get; } = new[]
    {
        ("1", "u", 3.0),
        ("2", "u", 2.0),
        ("u", "v", 3.0),
        ("v", "3", 2.0),
        ("v", "4", 4.0),
    };

    /// <summary>The index of edge v–3, the stretch set of the example's edge optimization.</summary>
    public const int EdgeV3 = 3;

    /// <summary>The tree, with every edge length multiplied by <paramref name="factor"/>.</summary>
    public static Tree Tree(double factor = 1) =>
        global::TreeMaker.Core.Tree.FromEdges(Edges.Select(e => (e.From, e.To, e.Length * factor)));

    /// <summary>The problem at grid size <paramref name="gridSize"/> and stage <paramref name="stage"/>.</summary>
    public static ProblemSpec Spec(int gridSize = 9, Stage stage = Stage.Scale) => new()
    {
        Tree = Tree(),
        GridSize = gridSize,
        Stage = stage,
    };
}
