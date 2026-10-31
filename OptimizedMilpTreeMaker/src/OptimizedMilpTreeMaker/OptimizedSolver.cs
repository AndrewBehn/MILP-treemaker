using System.Diagnostics;
using Google.OrTools.LinearSolver;
using PureMilpTreeMaker;

namespace OptimizedMilpTreeMaker;

/// <summary>
/// The combined algorithm of Section 7.1: bisection over candidate scales (Section 5), each test a feasibility
/// question answered with lattice-hull models (Section 3) under symmetry breaking (Section 4), built up
/// incrementally (Section 6).
/// </summary>
public static class OptimizedSolver
{
    /// <summary>Largest number of rounds in one phase; the loop always ends sooner in practice (Section 6.11).</summary>
    private const int RoundLimit = 5000;

    public static OptimizedResult Solve(ProblemSpec spec, OptimizedOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(spec);
        options ??= new OptimizedOptions();
        spec = spec with { Stage = Stage.Scale };
        spec.Validate();
        if (options.WindowHalfWidth < 0) throw new ArgumentException("The window half-width h must be at least 0.");
        if (!(options.RelativeGap >= 0)) throw new ArgumentException("The relative gap must be at least 0.");

        var clock = Stopwatch.StartNew();
        var run = new Run(spec, options, cancellationToken);
        var result = run.Execute();
        clock.Stop();

        SolveResult? baseSolve = null;
        if (options.CompareWithBase && !cancellationToken.IsCancellationRequested)
        {
            var baseSpec = spec with
            {
                Solver = spec.Solver with { RelativeGap = Math.Max(options.RelativeGap, 1e-7) },
            };
            baseSolve = PureMilpSolver.Solve(baseSpec, cancellationToken);
        }
        return result with { Milliseconds = clock.Elapsed.TotalMilliseconds, BaseSolve = baseSolve };
    }

    /// <summary>The size of the full Feas(m) at a scale: every pair, its crossable hull facets, C:2, C:3, mirrors.</summary>
    public static FeasibilityEstimate EstimateFeasibility(ProblemSpec spec, Definitions definitions,
        SymmetryBreaking symmetry, HullCache cache, double scale)
    {
        int binaries = 0, rows = 0;
        long nonzeros = 0;
        foreach (var pair in definitions.Tree.Pairs)
        {
            var facets = cache.Crossable(LatticeHull.ForbiddenLimit(scale * definitions.PathLength(pair)));
            binaries += facets.Count;
            rows += facets.Count + 1;
            foreach (var f in facets)
            {
                nonzeros += (f.A1 != 0 ? 2 : 0) + (f.A2 != 0 ? 2 : 0) + 2;
            }
        }
        if (symmetry.Anchor is not null) { rows += 1; nonzeros += 2; }
        rows += symmetry.SiblingOrder.Count;
        nonzeros += 4L * symmetry.SiblingOrder.Count;
        rows += 2 * spec.MirrorPairs.Count;
        nonzeros += 4L * spec.MirrorPairs.Count;
        return new FeasibilityEstimate(scale, binaries, rows, nonzeros);
    }

    /// <summary>The worst case over all scales up to m̄ of Σ facets, the "at most" binary count of Feas(m).</summary>
    public static int WorstCaseBinaries(Definitions definitions, HullCache cache)
    {
        var squared = CandidateScales.SquaredLengths(definitions.GridSize);
        int total = 0;
        foreach (var pair in definitions.Tree.Pairs)
        {
            long top = LatticeHull.ForbiddenLimit(definitions.ScaleUpperBound * definitions.PathLength(pair));
            int worst = cache.Crossable(top).Count;
            foreach (long s in squared)
            {
                if (s - 1 > top) break;
                worst = Math.Max(worst, cache.Crossable(s - 1).Count);
            }
            total += worst;
        }
        return total;
    }

    private sealed class Run
    {
        private readonly ProblemSpec _spec;
        private readonly OptimizedOptions _options;
        private readonly CancellationToken _token;
        private readonly Tree _tree;
        private readonly Definitions _defs;
        private readonly HullCache _hulls;
        private readonly SymmetryBreaking _symmetry;
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly List<string> _messages = new();

        // Section 6 state, carried between tests (Section 6.10).
        private readonly HashSet<int> _active = new();
        private readonly Dictionary<int, HashSet<Point>> _inner = new();
        private (int X, int Y)[]? _center;        // by leaf index
        private bool _activeInitialized;

        public Run(ProblemSpec spec, OptimizedOptions options, CancellationToken token)
        {
            _spec = spec;
            _options = options;
            _token = token;
            _tree = spec.Tree;
            _defs = new Definitions(spec.Tree, spec.GridSize);
            _hulls = new HullCache(spec.GridSize);
            _symmetry = options.SymmetryBreaking ? SymmetryBreaking.Create(spec) : SymmetryBreaking.None(spec.GridSize);
        }

        public OptimizedResult Execute()
        {
            var candidates = CandidateScales.Compute(_defs);
            int maxTests = candidates.Count <= 1 ? candidates.Count : (int)Math.Ceiling(Math.Log2(candidates.Count));
            if (_symmetry.Note is not null) _messages.Add(_symmetry.Note);

            // Level 0: the seed layout gives a known-feasible lower end and the first window centre (Section 5.3).
            double? seedScale = null;
            int lo = -1;
            if (_spec.StartLayout is { } start)
            {
                // An imported layout: the first window centre, and a known lower end when it meets every condition.
                var canonical = _symmetry.Canonicalize(start.ToDictionary(p => p.Vertex, p => (p.X, p.Y)));
                var placements = _tree.Leaves.Select(v => new LeafPlacement(_tree.Name(v), v, canonical[v].X, canonical[v].Y)).ToArray();
                double startScale = SeedLayout.Scale(_defs, canonical);
                _center = ToLeafArray(canonical);
                if (startScale > 0 && LayoutAnalysis.Violations(_spec, placements, startScale).Count == 0)
                {
                    seedScale = startScale;
                    lo = CandidateScales.IndexAtOrBelow(candidates, startScale);
                    _messages.Add($"Started from the imported layout, at its scale {startScale:0.######}.");
                }
                else
                {
                    _messages.Add("Started the first window around the imported layout; it breaks a condition, so its scale is not used as a lower bound.");
                }
            }
            else if (_options.UseSeed)
            {
                if (_spec.LeafConditions.Count > 0 || _spec.MirrorPairs.Count > 0)
                {
                    _messages.Add("The border seed ignores position conditions and mirror pairs, so it was not used.");
                }
                else if (SeedLayout.Create(_defs) is { } seed)
                {
                    var canonical = _symmetry.Canonicalize(seed);
                    seedScale = SeedLayout.Scale(_defs, canonical);
                    lo = CandidateScales.IndexAtOrBelow(candidates, seedScale.Value);
                    _center = ToLeafArray(canonical);
                }
            }

            var best = _center;
            int hi = candidates.Count - 1;
            var tests = new List<TestTrace>();
            bool stopped = false;
            bool withinGap = false;

            // Level 1: bisection. Everything above hi is infeasible; lo is feasible (or −1 when nothing is known yet).
            while (lo < hi)
            {
                if (lo >= 0 && candidates[hi] / candidates[lo] - 1 <= _options.RelativeGap)
                {
                    withinGap = true;
                    break;
                }
                int mid = (int)Math.Ceiling((lo + hi) / 2.0);
                if (mid == lo) mid = lo + 1;
                var test = Test(tests.Count + 1, mid, candidates[mid], out var layout);
                tests.Add(test);
                if (test.Answer == "Yes")
                {
                    lo = mid;
                    best = layout;
                    _center = layout;
                }
                else if (test.Answer == "No")
                {
                    hi = mid - 1;
                }
                else
                {
                    stopped = true;
                    break;
                }
            }

            var report = new SymmetryReport(
                _symmetry.Anchor is int anchor ? _tree.Name(anchor) : null,
                _symmetry.SiblingGroups.Select(g => (IReadOnlyList<string>)g.Select(_tree.Name).ToArray()).ToArray(),
                _symmetry.Note);
            var baseModel = ModelSize.Predict(_spec);

            if (best is null || lo < 0)
            {
                return new OptimizedResult
                {
                    Status = stopped ? SolveStatus.NoSolutionFound : SolveStatus.Infeasible,
                    CandidateCount = candidates.Count,
                    Candidates = candidates.Count <= 5000 ? candidates : Array.Empty<double>(),
                    MaxTests = maxTests,
                    SeedScale = seedScale,
                    Tests = tests,
                    BaseModel = baseModel,
                    Symmetry = report,
                    UpperBound = hi >= 0 ? candidates[hi] : null,
                    Messages = _messages.Append(stopped
                        ? "Stopped before any layout was found."
                        : "No candidate scale has a layout: the conditions cannot all be met on this grid.").ToArray(),
                };
            }

            var placements = _tree.Leaves
                .Select(v => new LeafPlacement(_tree.Name(v), v, best[_tree.LeafIndex(v)].X, best[_tree.LeafIndex(v)].Y))
                .ToArray();
            double scale = LayoutAnalysis.ExactScale(_defs, placements);
            if (stopped)
            {
                _messages.Add($"Stopped early: m* lies between {scale:0.######} and {candidates[hi]:0.######}.");
            }
            else if (withinGap)
            {
                _messages.Add($"Stopped within the {_options.RelativeGap:0.####%} relative gap: m* lies between " +
                    $"{scale:0.######} and {candidates[hi]:0.######}. Set the gap to 0 for the exact optimum.");
            }

            var pairs = LayoutAnalysis.Pairs(_defs, placements, scale);
            var hulls = _tree.Pairs.Select((pair, p) =>
            {
                long limit = LatticeHull.ForbiddenLimit(scale * _defs.PathLength(pair));
                var a = best[_tree.LeafIndex(pair.I)];
                var b = best[_tree.LeafIndex(pair.J)];
                return new PairHull(_tree.Name(pair.I), _tree.Name(pair.J), scale * _defs.PathLength(pair), limit,
                    _hulls.Vertices(limit), _hulls.Crossable(limit).Count, a.X - b.X, a.Y - b.Y, pairs[p].Tight);
            }).ToArray();

            return new OptimizedResult
            {
                Status = stopped || (withinGap && lo < hi) ? SolveStatus.Feasible : SolveStatus.Optimal,
                Scale = scale,
                TreeMakerScale = scale / _spec.GridSize,
                UpperBound = candidates[Math.Max(lo, hi)],
                Layout = placements,
                Pairs = pairs,
                Hulls = hulls,
                Violations = LayoutAnalysis.Violations(_spec, placements, scale),
                CandidateCount = candidates.Count,
                Candidates = candidates.Count <= 5000 ? candidates : Array.Empty<double>(),
                MaxTests = maxTests,
                SeedScale = seedScale,
                Tests = tests,
                FullModelAtOptimum = EstimateFeasibility(_spec, _defs, _symmetry, _hulls, scale),
                BaseModel = baseModel,
                Symmetry = report,
                Messages = _messages,
            };
        }

        // Level 2: one test at a trial scale (Section 6.9).
        private TestTrace Test(int number, int index, double m, out (int X, int Y)[]? layout)
        {
            var started = _clock.Elapsed;
            var phases = new List<PhaseTrace>();
            layout = null;
            var limits = _tree.Pairs.Select(p => LatticeHull.ForbiddenLimit(m * _defs.PathLength(p))).ToArray();
            string answer;

            bool incremental = _options.PairGeneration || _options.FacetGeneration || _options.LeafWindows;
            if (!incremental)
            {
                // Without Section 6, a test is one solve of the full Feas(m).
                var all = Enumerable.Range(0, _tree.Pairs.Count)
                    .ToDictionary(p => p, p => _hulls.Crossable(limits[p]));
                var round = SolveRound(1, m, all, null, out var found);
                var phase = new PhaseTrace { Windowed = false, Outcome = Verdict(round), Rounds = { round } };
                phases.Add(phase);
                answer = phase.Outcome;
                if (found is not null) layout = found;
                if (answer == "Stopped") answer = "Unknown";
            }
            else
            {
                PrepareState(m, limits);
                answer = "Unknown";
                if (_options.LeafWindows && _center is not null)
                {
                    var windowed = Loop(m, limits, Windows(_center), out var found);
                    phases.Add(windowed);
                    if (windowed.Outcome == "Yes") { answer = "Yes"; layout = found; }
                    else if (windowed.Outcome == "Stopped") answer = "Unknown";
                }
                if (answer == "Unknown" && !phases.Any(p => p.Outcome == "Stopped"))
                {
                    var full = Loop(m, limits, null, out var found);
                    phases.Add(full);
                    answer = full.Outcome switch { "Yes" => "Yes", "No" => "No", _ => "Unknown" };
                    if (answer == "Yes") layout = found;
                }
            }

            return new TestTrace
            {
                Test = number,
                CandidateIndex = index,
                Scale = m,
                Answer = answer,
                Phases = phases,
                Milliseconds = (_clock.Elapsed - started).TotalMilliseconds,
            };
        }

        private static string Verdict(RoundTrace round) => round.Outcome switch
        {
            "Layout" => "Yes",
            "Stopped" => "Stopped",
            _ => "No",
        };

        // Section 6.7 and 6.10: set up or carry A and Q for a new trial scale.
        private void PrepareState(double m, long[] limits)
        {
            int pairs = _tree.Pairs.Count;
            if (!_options.PairGeneration)
            {
                for (int p = 0; p < pairs; p++) _active.Add(p);
            }
            else if (!_activeInitialized)
            {
                // Pairs tight or nearly tight in the centre layout, plus every pair of leaves sharing a parent.
                if (_center is not null)
                {
                    for (int p = 0; p < pairs; p++)
                    {
                        var pair = _tree.Pairs[p];
                        var a = _center[_tree.LeafIndex(pair.I)];
                        var b = _center[_tree.LeafIndex(pair.J)];
                        double d = Math.Sqrt((double)(a.X - b.X) * (a.X - b.X) + (double)(a.Y - b.Y) * (a.Y - b.Y));
                        if (d <= (1 + _options.NearlyTight) * m * _defs.PathLength(pair)) _active.Add(p);
                    }
                }
                var parent = _tree.Leaves.ToDictionary(l => l, l =>
                {
                    var e = _tree.Edges.First(x => x.U == l || x.V == l);
                    return e.U == l ? e.V : e.U;
                });
                for (int p = 0; p < pairs; p++)
                {
                    if (parent[_tree.Pairs[p].I] == parent[_tree.Pairs[p].J]) _active.Add(p);
                }
            }
            _activeInitialized = true;

            if (_options.FacetGeneration)
            {
                foreach (int p in _active.ToArray())
                {
                    var set = _inner.TryGetValue(p, out var existing) ? existing : (_inner[p] = new HashSet<Point>());
                    // Points that are long enough at this scale no longer belong (Section 6.10).
                    set.RemoveWhere(q => !LatticeHull.IsForbidden(q.X, q.Y, limits[p]));
                    foreach (var q in _hulls.Starting(limits[p])) set.Add(q);
                }
            }
        }

        // Level 3: the generation loop (Section 6.8).
        private PhaseTrace Loop(double m, long[] limits, Window[]? windows, out (int X, int Y)[]? layout)
        {
            layout = null;
            var rounds = new List<RoundTrace>();
            for (int r = 1; r <= RoundLimit; r++)
            {
                var facets = new Dictionary<int, IReadOnlyList<Facet>>();
                foreach (int p in _active)
                {
                    facets[p] = _options.FacetGeneration
                        ? LatticeHull.Facets(_inner[p]).Where(f => f.IsCrossable(_spec.GridSize)).ToList()
                        : _hulls.Crossable(limits[p]);
                }

                var round = SolveRound(r, m, facets, windows, out var found);
                if (round.Outcome == "Stopped")
                {
                    rounds.Add(round);
                    return new PhaseTrace { Windowed = windows is not null, Outcome = "Stopped", Rounds = rounds };
                }
                if (found is null)
                {
                    rounds.Add(round);
                    return new PhaseTrace { Windowed = windows is not null, Outcome = windows is null ? "No" : "Failed", Rounds = rounds };
                }

                // Check every pair against its true minimum (no solve).
                int addedPairs = 0, addedPoints = 0;
                for (int p = 0; p < _tree.Pairs.Count; p++)
                {
                    var pair = _tree.Pairs[p];
                    var a = found[_tree.LeafIndex(pair.I)];
                    var b = found[_tree.LeafIndex(pair.J)];
                    int dx = a.X - b.X, dy = a.Y - b.Y;
                    if (!LatticeHull.IsForbidden(dx, dy, limits[p])) continue;

                    if (_active.Add(p))
                    {
                        addedPairs++;
                        if (_options.FacetGeneration)
                        {
                            var set = new HashSet<Point>(_hulls.Starting(limits[p]));
                            foreach (var q in LatticeHull.Images(dx, dy)) set.Add(q);
                            _inner[p] = set;
                        }
                    }
                    else if (_options.FacetGeneration)
                    {
                        foreach (var q in LatticeHull.Images(dx, dy))
                        {
                            if (_inner[p].Add(q)) addedPoints++;
                        }
                    }
                    else
                    {
                        // A full hull cannot be violated; reaching here would be a modelling error.
                        throw new InvalidOperationException($"Pair {_tree.Name(pair.I)}–{_tree.Name(pair.J)} broke its full hull.");
                    }
                }

                rounds.Add(round with { AddedPairs = addedPairs, AddedPoints = addedPoints });
                if (addedPairs == 0 && addedPoints == 0)
                {
                    layout = found;
                    return new PhaseTrace { Windowed = windows is not null, Outcome = "Yes", Rounds = rounds };
                }
            }
            _messages.Add("A generation loop hit its round limit.");
            return new PhaseTrace { Windowed = windows is not null, Outcome = "Stopped", Rounds = rounds };
        }

        // Level 4: one single solve.
        private RoundTrace SolveRound(int number, double m, IReadOnlyDictionary<int, IReadOnlyList<Facet>> facets,
            Window[]? windows, out (int X, int Y)[]? layout)
        {
            layout = null;
            var started = _clock.Elapsed;
            if (_token.IsCancellationRequested || TimeLeft() <= TimeSpan.Zero)
            {
                return new RoundTrace { Round = number, Windowed = windows is not null, Size = new FeasibilitySize(), Outcome = "Stopped" };
            }

            using var model = FeasibilityModel.Build(_spec, _symmetry, facets, windows);
            if (model.TriviallyInfeasible is not null)
            {
                return new RoundTrace
                {
                    Round = number, Windowed = windows is not null, Size = model.Size, Outcome = "Trivially infeasible",
                    Milliseconds = (_clock.Elapsed - started).TotalMilliseconds,
                };
            }

            var solver = model.Solver;
            if (_center is not null) model.SetHint(_tree, _center);
            var left = TimeLeft();
            if (left != TimeSpan.MaxValue) solver.SetTimeLimit((long)Math.Max(1, left.TotalMilliseconds));
            if (_spec.Solver.Threads is int threads) solver.SetNumThreads(threads);
            if (_spec.Solver.LogToConsole) solver.EnableOutput();

            Solver.ResultStatus status;
            using (_token.Register(() => solver.InterruptSolve()))
            {
                status = solver.Solve();
            }

            string outcome;
            if (status is Solver.ResultStatus.OPTIMAL or Solver.ResultStatus.FEASIBLE)
            {
                outcome = "Layout";
                layout = new (int X, int Y)[model.X.Length];
                for (int k = 0; k < model.X.Length; k++)
                {
                    layout[k] = ((int)Math.Round(model.X[k].SolutionValue()), (int)Math.Round(model.Y[k].SolutionValue()));
                }
            }
            else if (status == Solver.ResultStatus.INFEASIBLE)
            {
                outcome = "No layout";
            }
            else if (status == Solver.ResultStatus.NOT_SOLVED)
            {
                outcome = "Stopped";
            }
            else
            {
                throw new InvalidOperationException($"SCIP returned {status} at trial scale {m}.");
            }

            return new RoundTrace
            {
                Round = number,
                Windowed = windows is not null,
                Size = model.Size,
                Outcome = outcome,
                Milliseconds = (_clock.Elapsed - started).TotalMilliseconds,
                Nodes = solver.Nodes(),
            };
        }

        private TimeSpan TimeLeft() =>
            _spec.Solver.TimeLimit is TimeSpan limit ? limit - _clock.Elapsed : TimeSpan.MaxValue;

        private Window[] Windows((int X, int Y)[] center)
        {
            int h = _options.WindowHalfWidth, n = _spec.GridSize;
            return center.Select(c => new Window(
                Math.Max(0, c.X - h), Math.Min(n, c.X + h), Math.Max(0, c.Y - h), Math.Min(n, c.Y + h))).ToArray();
        }

        private (int X, int Y)[] ToLeafArray(IReadOnlyDictionary<int, (int X, int Y)> byVertex)
        {
            var result = new (int X, int Y)[_tree.Leaves.Count];
            foreach (int leaf in _tree.Leaves) result[_tree.LeafIndex(leaf)] = byVertex[leaf];
            return result;
        }
    }
}
