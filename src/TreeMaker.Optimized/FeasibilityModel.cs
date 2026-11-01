using Google.OrTools.LinearSolver;
using TreeMaker.Core;

namespace TreeMaker.Optimized;

/// <summary>A leaf window W = [x̲, x̄] × [y̲, ȳ] (P:5).</summary>
public readonly record struct Window(int MinX, int MaxX, int MinY, int MaxY);

/// <summary>Size of one feasibility model as built.</summary>
public sealed record FeasibilitySize
{
    public int Binaries { get; init; }
    public int Integers { get; init; }
    public int Rows { get; init; }
    public long Nonzeros { get; init; }
    public int ActivePairs { get; init; }
    public int Facets { get; init; }
}

/// <summary>
/// The feasibility model at a trial scale: Feas(m) (Sections 3–4) when every pair is active with its full hull and
/// windows cover the sheet, and the restricted model R(m; A, Q, W) of Section 6 otherwise. It has no objective.
/// </summary>
internal sealed class FeasibilityModel : IDisposable
{
    private FeasibilityModel(Solver solver) => Solver = solver;

    public Solver Solver { get; }
    public Variable[] X { get; private set; } = Array.Empty<Variable>();
    public Variable[] Y { get; private set; } = Array.Empty<Variable>();

    /// <summary>The facet selectors z of each modelled pair, with the facets they belong to.</summary>
    public Dictionary<int, (Facet[] Facets, Variable[] Z)> Selectors { get; } = new();

    public FeasibilitySize Size { get; private set; } = new();

    /// <summary>Set when the model is infeasible before solving (an empty window or a pair with no usable facet).</summary>
    public string? TriviallyInfeasible { get; private set; }

    /// <summary>
    /// Builds the model.
    /// </summary>
    /// <param name="spec">The problem (tree, grid, conditions, mirror pairs).</param>
    /// <param name="symmetry">C:2 and C:3.</param>
    /// <param name="pairFacets">For each active pair index, the facets of its (inner) polygon.</param>
    /// <param name="windows">Leaf windows by leaf index, or null for the whole sheet.</param>
    public static FeasibilityModel Build(ProblemSpec spec, SymmetryBreaking symmetry,
        IReadOnlyDictionary<int, IReadOnlyList<Facet>> pairFacets, Window[]? windows)
    {
        var solver = Solver.CreateSolver("SCIP")
            ?? throw new InvalidOperationException("The SCIP backend of OR-Tools is not available on this machine.");
        var model = new FeasibilityModel(solver);
        try
        {
            model.Populate(spec, symmetry, pairFacets, windows);
        }
        catch
        {
            model.Dispose();
            throw;
        }
        return model;
    }

    private void Populate(ProblemSpec spec, SymmetryBreaking symmetry,
        IReadOnlyDictionary<int, IReadOnlyList<Facet>> pairFacets, Window[]? windows)
    {
        var tree = spec.Tree;
        int n = spec.GridSize;
        int leaves = tree.Leaves.Count;
        int rows = 0, binaries = 0, facetCount = 0, activePairs = 0;
        long nonzeros = 0;

        // Bounds: the sheet (base C:1), the leaf windows (C:4), position conditions, and C:2's half-sheet bounds.
        var lo = new (int X, int Y)[leaves];
        var hi = new (int X, int Y)[leaves];
        for (int k = 0; k < leaves; k++)
        {
            lo[k] = (0, 0);
            hi[k] = (n, n);
            if (windows is not null)
            {
                lo[k] = (Math.Max(0, windows[k].MinX), Math.Max(0, windows[k].MinY));
                hi[k] = (Math.Min(n, windows[k].MaxX), Math.Min(n, windows[k].MaxY));
            }
        }
        foreach (var c in spec.LeafConditions)
        {
            int k = tree.LeafIndex(tree.Id(c.Leaf));
            void FixX(int v) { lo[k].X = Math.Max(lo[k].X, v); hi[k].X = Math.Min(hi[k].X, v); }
            void FixY(int v) { lo[k].Y = Math.Max(lo[k].Y, v); hi[k].Y = Math.Min(hi[k].Y, v); }
            switch (c.Kind)
            {
                case LeafConditionKind.LeftEdge: FixX(0); break;
                case LeafConditionKind.RightEdge: FixX(n); break;
                case LeafConditionKind.BottomEdge: FixY(0); break;
                case LeafConditionKind.TopEdge: FixY(n); break;
                case LeafConditionKind.BottomLeftCorner: FixX(0); FixY(0); break;
                case LeafConditionKind.BottomRightCorner: FixX(n); FixY(0); break;
                case LeafConditionKind.TopLeftCorner: FixX(0); FixY(n); break;
                case LeafConditionKind.TopRightCorner: FixX(n); FixY(n); break;
                case LeafConditionKind.OnSymmetryAxis: FixX(n / 2); break;
                case LeafConditionKind.Fixed: FixX(c.X!.Value); FixY(c.Y!.Value); break;
            }
        }
        if (symmetry.Anchor is int anchor)
        {
            int k = tree.LeafIndex(anchor);
            hi[k] = (Math.Min(hi[k].X, n / 2), Math.Min(hi[k].Y, n / 2));
        }
        for (int k = 0; k < leaves; k++)
        {
            if (lo[k].X > hi[k].X || lo[k].Y > hi[k].Y)
            {
                TriviallyInfeasible = $"Leaf {tree.Name(tree.Leaves[k])} has no grid point left in its window.";
            }
        }

        X = new Variable[leaves];
        Y = new Variable[leaves];
        for (int k = 0; k < leaves; k++)
        {
            string name = tree.Name(tree.Leaves[k]);
            X[k] = Solver.MakeIntVar(lo[k].X, Math.Max(lo[k].X, hi[k].X), $"x[{name}]");
            Y[k] = Solver.MakeIntVar(lo[k].Y, Math.Max(lo[k].Y, hi[k].Y), $"y[{name}]");
        }

        // C:1 / C:5: each modelled pair lies beyond at least one facet of its polygon.
        foreach (var (p, facets) in pairFacets)
        {
            var pair = tree.Pairs[p];
            int i = tree.LeafIndex(pair.I), j = tree.LeafIndex(pair.J);

            var usable = new List<(Facet F, long M)>();
            bool alwaysSatisfied = false;
            foreach (var f in facets)
            {
                // The range of aᵀ(uᵢ − uⱼ) over the two leaves' boxes (D:2 on the full sheet, D:5 in windows).
                long min = RangeMin(f.A1, lo[i].X, hi[i].X, lo[j].X, hi[j].X) + RangeMin(f.A2, lo[i].Y, hi[i].Y, lo[j].Y, hi[j].Y);
                long max = -RangeMin(-f.A1, lo[i].X, hi[i].X, lo[j].X, hi[j].X) - RangeMin(-f.A2, lo[i].Y, hi[i].Y, lo[j].Y, hi[j].Y);
                if (max < f.B + 1) continue;           // cannot be crossed here
                if (min >= f.B + 1) { alwaysSatisfied = true; break; }   // always crossed: the pair holds
                usable.Add((f, f.B + 1 - min));
            }
            if (alwaysSatisfied) continue;
            if (usable.Count == 0)
            {
                TriviallyInfeasible ??= $"Leaves {tree.Name(pair.I)} and {tree.Name(pair.J)} cannot be far enough apart.";
                continue;
            }

            activePairs++;
            var z = new Variable[usable.Count];
            var any = Solver.MakeConstraint(1, double.PositiveInfinity, $"any[{p}]");
            rows++;
            for (int k = 0; k < usable.Count; k++)
            {
                var (f, m) = usable[k];
                z[k] = Solver.MakeBoolVar($"z[{p},{k}]");
                binaries++;
                facetCount++;
                // aᵀ(uᵢ − uⱼ) ≥ b + 1 − M(1 − z)  ⇔  aᵀuᵢ − aᵀuⱼ − M·z ≥ b + 1 − M.
                var row = Solver.MakeConstraint(f.B + 1 - m, double.PositiveInfinity, $"facet[{p},{k}]");
                rows++;
                if (f.A1 != 0) { row.SetCoefficient(X[i], f.A1); row.SetCoefficient(X[j], -f.A1); nonzeros += 2; }
                if (f.A2 != 0) { row.SetCoefficient(Y[i], f.A2); row.SetCoefficient(Y[j], -f.A2); nonzeros += 2; }
                row.SetCoefficient(z[k], -m);
                any.SetCoefficient(z[k], 1);
                nonzeros += 2;
            }
            Selectors[p] = (usable.Select(u => u.F).ToArray(), z);
        }

        // C:2 (the y ≤ x part; 2x ≤ N and 2y ≤ N are bounds above) and C:3.
        if (symmetry.Anchor is int a)
        {
            int k = tree.LeafIndex(a);
            var row = Solver.MakeConstraint(double.NegativeInfinity, 0, "C2");
            row.SetCoefficient(Y[k], 1);
            row.SetCoefficient(X[k], -1);
            rows++;
            nonzeros += 2;
        }
        foreach (var (sa, sb) in symmetry.SiblingOrder)
        {
            int ka = tree.LeafIndex(sa), kb = tree.LeafIndex(sb);
            var row = Solver.MakeConstraint(double.NegativeInfinity, 0, $"C3[{tree.Name(sa)},{tree.Name(sb)}]");
            row.SetCoefficient(X[ka], n + 1);
            row.SetCoefficient(Y[ka], 1);
            row.SetCoefficient(X[kb], -(n + 1));
            row.SetCoefficient(Y[kb], -1);
            rows++;
            nonzeros += 4;
        }

        // Mirror pairs, as in the base model.
        foreach (var mirror in spec.MirrorPairs)
        {
            int ka = tree.LeafIndex(tree.Id(mirror.A)), kb = tree.LeafIndex(tree.Id(mirror.B));
            var sum = Solver.MakeConstraint(n, n, $"mirror-x[{mirror.A},{mirror.B}]");
            sum.SetCoefficient(X[ka], 1);
            sum.SetCoefficient(X[kb], 1);
            var level = Solver.MakeConstraint(0, 0, $"mirror-y[{mirror.A},{mirror.B}]");
            level.SetCoefficient(Y[ka], 1);
            level.SetCoefficient(Y[kb], -1);
            rows += 2;
            nonzeros += 4;
        }

        Size = new FeasibilitySize
        {
            Binaries = binaries,
            Integers = 2 * leaves,
            Rows = rows,
            Nonzeros = nonzeros,
            ActivePairs = activePairs,
            Facets = facetCount,
        };
    }

    /// <summary>Seeds the solver with a layout (leaf index → point), choosing one crossed facet per pair.</summary>
    public void SetHint(Tree tree, IReadOnlyList<(int X, int Y)> layout)
    {
        var vars = new List<Variable>();
        var values = new List<double>();
        for (int k = 0; k < X.Length; k++)
        {
            vars.Add(X[k]); values.Add(layout[k].X);
            vars.Add(Y[k]); values.Add(layout[k].Y);
        }
        foreach (var (p, (facets, z)) in Selectors)
        {
            var pair = tree.Pairs[p];
            var a = layout[tree.LeafIndex(pair.I)];
            var b = layout[tree.LeafIndex(pair.J)];
            bool set = false;
            for (int k = 0; k < facets.Length; k++)
            {
                bool on = !set && facets[k].IsBeyond(a.X - b.X, a.Y - b.Y);
                set |= on;
                vars.Add(z[k]);
                values.Add(on ? 1 : 0);
            }
        }
        Solver.SetHint(vars.ToArray(), values.ToArray());
    }

    public void Dispose() => Solver.Dispose();

    /// <summary>min over xᵢ ∈ [loI, hiI], xⱼ ∈ [loJ, hiJ] of a·(xᵢ − xⱼ).</summary>
    private static long RangeMin(int a, int loI, int hiI, int loJ, int hiJ) =>
        a >= 0 ? (long)a * (loI - hiJ) : (long)a * (hiI - loJ);
}
