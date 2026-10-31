using Google.OrTools.LinearSolver;

namespace PureMilpTreeMaker;

/// <summary>
/// One MILP of the Pure MILP doc, built on SCIP through OR-Tools' linear-solver API.
/// Variables follow Section 6 (and 11.2/11.3); constraints follow Section 7 (and 11.2/11.3).
/// </summary>
public sealed class PureMilpModel : IDisposable
{
    private int _binaries;
    private int _integers;
    private int _continuous;
    private long _nonzeros;

    private PureMilpModel(ProblemSpec spec, Definitions definitions, Solver solver, double fixedScale)
    {
        Spec = spec;
        Definitions = definitions;
        Solver = solver;
        FixedScale = fixedScale;
    }

    public ProblemSpec Spec { get; }
    public Definitions Definitions { get; }
    public Solver Solver { get; }

    /// <summary>m₀ for the edge and strain stages; 0 for the scale stage.</summary>
    public double FixedScale { get; }

    /// <summary>xᵢ, by leaf index.</summary>
    public Variable[] X { get; private set; } = Array.Empty<Variable>();

    /// <summary>yᵢ, by leaf index.</summary>
    public Variable[] Y { get; private set; } = Array.Empty<Variable>();

    /// <summary>w_ijδ, by pair index then candidate-offset index.</summary>
    public Variable[][] W { get; private set; } = Array.Empty<Variable[]>();

    /// <summary>m, in the scale stage.</summary>
    public Variable? Scale { get; private set; }

    /// <summary>σ, the common stretch, in the edge stage.</summary>
    public Variable? Stretch { get; private set; }

    /// <summary>σₑ, by edge index, in the strain stage.</summary>
    public Variable[]? Strain { get; private set; }

    /// <summary>aₑ ≥ |σₑ|, by edge index, in the strain stage.</summary>
    public Variable[]? StrainMagnitude { get; private set; }

    /// <summary>a_max, when minimizing the largest strain.</summary>
    public Variable? LargestStrain { get; private set; }

    /// <summary>Builds the model for <paramref name="spec"/>. <paramref name="fixedScale"/> is m₀ (ignored by the scale stage).</summary>
    public static PureMilpModel Build(ProblemSpec spec, Definitions definitions, double fixedScale = 0)
    {
        ArgumentNullException.ThrowIfNull(spec);
        ArgumentNullException.ThrowIfNull(definitions);

        var solver = Solver.CreateSolver("SCIP")
            ?? throw new InvalidOperationException("The SCIP backend of OR-Tools is not available on this machine.");

        var model = new PureMilpModel(spec, definitions, solver, fixedScale);
        try
        {
            model.AddVariables();
            model.AddSelectionAndLinking();
            model.AddSpacing();
            model.AddConditions();
            model.SetObjective();
        }
        catch
        {
            model.Dispose();
            throw;
        }
        return model;
    }

    /// <summary>The model's size as built.</summary>
    public ModelMetrics Metrics => new()
    {
        Variables = _binaries + _integers + _continuous,
        BinaryVariables = _binaries,
        IntegerVariables = _integers,
        ContinuousVariables = _continuous,
        Constraints = Solver.NumConstraints(),
        Nonzeros = _nonzeros,
        LeafCount = Spec.Tree.Leaves.Count,
        PairCount = Spec.Tree.Pairs.Count,
        SelectorsPerPair = Definitions.SelectorsPerPair,
        CandidateOffsets = Definitions.SelectorsPerPair,
        ScaleUpperBound = Definitions.ScaleUpperBound,
    };

    /// <summary>Seeds the solver with a known layout (for example the stage-one layout in edge optimization).</summary>
    public void SetHint(IReadOnlyList<LeafPlacement> layout)
    {
        var tree = Spec.Tree;
        var position = layout.ToDictionary(p => p.Vertex, p => (p.X, p.Y));
        var vars = new List<Variable>();
        var values = new List<double>();

        foreach (int leaf in tree.Leaves)
        {
            var (x, y) = position[leaf];
            int k = tree.LeafIndex(leaf);
            vars.Add(X[k]);
            values.Add(x);
            vars.Add(Y[k]);
            values.Add(y);
        }

        var offsets = Definitions.CandidateOffsets;
        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            var pair = tree.Pairs[p];
            int dx = position[pair.I].X - position[pair.J].X;
            int dy = position[pair.I].Y - position[pair.J].Y;
            for (int k = 0; k < offsets.Count; k++)
            {
                vars.Add(W[p][k]);
                values.Add(offsets[k].Dx == dx && offsets[k].Dy == dy ? 1 : 0);
            }
        }

        Solver.SetHint(vars.ToArray(), values.ToArray());
    }

    public void Dispose() => Solver.Dispose();

    private void AddVariables()
    {
        var tree = Spec.Tree;
        int n = Spec.GridSize;

        // Leaf coordinates (Section 6); C:1 is their integrality and bounds.
        X = new Variable[tree.Leaves.Count];
        Y = new Variable[tree.Leaves.Count];
        for (int k = 0; k < tree.Leaves.Count; k++)
        {
            string name = tree.Name(tree.Leaves[k]);
            X[k] = IntVar(0, n, $"x[{name}]");
            Y[k] = IntVar(0, n, $"y[{name}]");
        }

        // Offset selectors w_ijδ (Section 6).
        var offsets = Definitions.CandidateOffsets;
        W = new Variable[tree.Pairs.Count][];
        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            W[p] = new Variable[offsets.Count];
            for (int k = 0; k < offsets.Count; k++)
            {
                W[p][k] = BoolVar($"w[{p},{offsets[k].Dx},{offsets[k].Dy}]");
            }
        }

        switch (Spec.Stage)
        {
            case Stage.Scale:
                Scale = NumVar(0, Definitions.ScaleUpperBound, "m");
                break;

            case Stage.Edge:
                Stretch = NumVar(0, StretchUpperBound(), "sigma");
                break;

            case Stage.Strain:
                int edges = tree.Edges.Count;
                double magnitudeBound = Math.Max(-Spec.StrainMin, Spec.StrainMax);
                Strain = new Variable[edges];
                StrainMagnitude = new Variable[edges];
                for (int e = 0; e < edges; e++)
                {
                    Strain[e] = NumVar(Spec.StrainMin, Spec.StrainMax, $"sigma[{tree.EdgeLabel(e)}]");
                    StrainMagnitude[e] = NumVar(0, magnitudeBound, $"a[{tree.EdgeLabel(e)}]");
                }
                if (Spec.StrainObjective == StrainObjective.LargestAbsolute)
                {
                    LargestStrain = NumVar(0, magnitudeBound, "a_max");
                }
                break;
        }
    }

    // C:2 offset selection and C:3 offset linking (Section 7).
    private void AddSelectionAndLinking()
    {
        var tree = Spec.Tree;
        var offsets = Definitions.CandidateOffsets;
        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            var pair = tree.Pairs[p];
            int i = tree.LeafIndex(pair.I);
            int j = tree.LeafIndex(pair.J);

            var select = Row(1, 1, $"C2[{p}]");
            var linkX = Row(0, 0, $"C3x[{p}]");
            var linkY = Row(0, 0, $"C3y[{p}]");
            Add(linkX, X[i], 1);
            Add(linkX, X[j], -1);
            Add(linkY, Y[i], 1);
            Add(linkY, Y[j], -1);
            for (int k = 0; k < offsets.Count; k++)
            {
                Add(select, W[p][k], 1);
                Add(linkX, W[p][k], -offsets[k].Dx);
                Add(linkY, W[p][k], -offsets[k].Dy);
            }
        }
    }

    // C:4 (scale), C:5 (edge), or C:6 (strain): the spacing row of each pair.
    private void AddSpacing()
    {
        var tree = Spec.Tree;
        var offsets = Definitions.CandidateOffsets;
        var stretchSet = new HashSet<int>(Spec.StretchSet);
        double m0 = FixedScale;

        for (int p = 0; p < tree.Pairs.Count; p++)
        {
            var pair = tree.Pairs[p];
            double l = Definitions.PathLength(pair);
            Constraint row;

            switch (Spec.Stage)
            {
                case Stage.Scale:
                    // C:4: m·ℓᵢⱼ ≤ Σ D(δ) w  ⇔  Σ D(δ) w − ℓᵢⱼ·m ≥ 0.
                    row = Row(0, double.PositiveInfinity, $"C4[{p}]");
                    Add(row, Scale!, -l);
                    break;

                case Stage.Edge:
                    // C:5: m₀(ℓᵢⱼ + σ·sᵢⱼ) ≤ Σ D(δ) w  ⇔  Σ D(δ) w − m₀·sᵢⱼ·σ ≥ m₀·ℓᵢⱼ.
                    row = Row(m0 * l, double.PositiveInfinity, $"C5[{p}]");
                    Add(row, Stretch!, -m0 * Definitions.StretchableLength(pair, stretchSet));
                    break;

                default:
                    // C:6: m₀(ℓᵢⱼ + Σₑ ℓₑσₑ) ≤ Σ D(δ) w  ⇔  Σ D(δ) w − m₀ Σₑ ℓₑσₑ ≥ m₀·ℓᵢⱼ.
                    row = Row(m0 * l, double.PositiveInfinity, $"C6[{p}]");
                    foreach (int e in tree.PathEdges(pair.I, pair.J))
                    {
                        Add(row, Strain![e], -m0 * tree.Edges[e].Length);
                    }
                    break;
            }

            for (int k = 0; k < offsets.Count; k++)
            {
                Add(row, W[p][k], offsets[k].Length);
            }
        }

        if (Spec.Stage == Stage.Strain)
        {
            // C:7: aₑ ≥ σₑ and aₑ ≥ −σₑ.
            for (int e = 0; e < tree.Edges.Count; e++)
            {
                var above = Row(0, double.PositiveInfinity, $"C7+[{e}]");
                Add(above, StrainMagnitude![e], 1);
                Add(above, Strain![e], -1);
                var below = Row(0, double.PositiveInfinity, $"C7-[{e}]");
                Add(below, StrainMagnitude[e], 1);
                Add(below, Strain[e], 1);
                if (LargestStrain is not null)
                {
                    var max = Row(0, double.PositiveInfinity, $"amax[{e}]");
                    Add(max, LargestStrain, 1);
                    Add(max, StrainMagnitude[e], -1);
                }
            }
        }
    }

    // Optional TreeMaker conditions (Section 7), expressed as bounds or linear rows.
    private void AddConditions()
    {
        var tree = Spec.Tree;
        int n = Spec.GridSize;

        foreach (var c in Spec.LeafConditions)
        {
            int k = tree.LeafIndex(tree.Id(c.Leaf));
            var (x, y) = (X[k], Y[k]);
            switch (c.Kind)
            {
                case LeafConditionKind.LeftEdge: Fix(x, 0); break;
                case LeafConditionKind.RightEdge: Fix(x, n); break;
                case LeafConditionKind.BottomEdge: Fix(y, 0); break;
                case LeafConditionKind.TopEdge: Fix(y, n); break;
                case LeafConditionKind.BottomLeftCorner: Fix(x, 0); Fix(y, 0); break;
                case LeafConditionKind.BottomRightCorner: Fix(x, n); Fix(y, 0); break;
                case LeafConditionKind.TopLeftCorner: Fix(x, 0); Fix(y, n); break;
                case LeafConditionKind.TopRightCorner: Fix(x, n); Fix(y, n); break;
                case LeafConditionKind.OnSymmetryAxis: Fix(x, n / 2); break;
                case LeafConditionKind.Fixed: Fix(x, c.X!.Value); Fix(y, c.Y!.Value); break;
            }
        }

        foreach (var mirror in Spec.MirrorPairs)
        {
            int a = tree.LeafIndex(tree.Id(mirror.A));
            int b = tree.LeafIndex(tree.Id(mirror.B));
            var sum = Row(n, n, $"mirror-x[{mirror.A},{mirror.B}]");
            Add(sum, X[a], 1);
            Add(sum, X[b], 1);
            var level = Row(0, 0, $"mirror-y[{mirror.A},{mirror.B}]");
            Add(level, Y[a], 1);
            Add(level, Y[b], -1);
        }
    }

    // Objective: max m (Section 8), max σ (11.2), or min Σ aₑ / min a_max (11.3).
    private void SetObjective()
    {
        var objective = Solver.Objective();
        switch (Spec.Stage)
        {
            case Stage.Scale:
                objective.SetCoefficient(Scale!, 1);
                objective.SetMaximization();
                break;

            case Stage.Edge:
                objective.SetCoefficient(Stretch!, 1);
                objective.SetMaximization();
                break;

            default:
                if (LargestStrain is not null)
                {
                    objective.SetCoefficient(LargestStrain, 1);
                }
                else
                {
                    foreach (var a in StrainMagnitude!)
                    {
                        objective.SetCoefficient(a, 1);
                    }
                }
                objective.SetMinimization();
                break;
        }
    }

    // σ cannot push any stretched pair past the sheet's diagonal: m₀(ℓᵢⱼ + σ·sᵢⱼ) ≤ √2·N.
    private double StretchUpperBound()
    {
        var stretchSet = new HashSet<int>(Spec.StretchSet);
        double diagonal = Math.Sqrt(2.0) * Spec.GridSize;
        double bound = double.PositiveInfinity;
        foreach (var pair in Spec.Tree.Pairs)
        {
            double s = Definitions.StretchableLength(pair, stretchSet);
            if (s > 0)
            {
                bound = Math.Min(bound, (diagonal / FixedScale - Definitions.PathLength(pair)) / s);
            }
        }
        if (double.IsPositiveInfinity(bound))
        {
            throw new ArgumentException("No leaf path crosses the stretch set, so σ is unbounded; choose edges on a leaf path.");
        }
        return Math.Max(0, bound);
    }

    private Variable IntVar(double lb, double ub, string name)
    {
        _integers++;
        return Solver.MakeIntVar(lb, ub, name);
    }

    private Variable BoolVar(string name)
    {
        _binaries++;
        return Solver.MakeBoolVar(name);
    }

    private Variable NumVar(double lb, double ub, string name)
    {
        _continuous++;
        return Solver.MakeNumVar(lb, ub, name);
    }

    private Constraint Row(double lb, double ub, string name) => Solver.MakeConstraint(lb, ub, name);

    private void Add(Constraint row, Variable v, double coefficient)
    {
        if (coefficient != 0)
        {
            row.SetCoefficient(v, coefficient);
            _nonzeros++;
        }
    }

    private static void Fix(Variable v, double value) => v.SetBounds(value, value);
}
