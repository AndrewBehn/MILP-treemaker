using TreeMaker.Core;

namespace TreeMaker.Optimized.Tests;

/// <summary>Lattice hulls (hulls D:1) and candidate scales (offsets D:3): the building blocks. Expected values were computed independently in Python.</summary>
public class HullTests
{
    [Theory]
    [InlineData(5.0, 24)]          // r² = 25 exactly: (5, 0) is allowed, (4, 2) with 20 is not
    [InlineData(4.9999999999, 24)] // a candidate radius with rounding noise
    [InlineData(4.5, 20)]
    [InlineData(0.5, 0)]           // only the origin is forbidden
    public void Forbidden_limit_handles_exact_radii(double radius, long expected)
    {
        Assert.Equal(expected, LatticeHull.ForbiddenLimit(radius));
    }

    [Fact]
    public void Radius_five_has_eight_facets_and_5_1_crosses_exactly_one()
    {
        var facets = LatticeHull.CrossableFacets(LatticeHull.ForbiddenLimit(5), 9);
        Assert.Equal(8, facets.Count);
        Assert.Equal(1, facets.Count(f => f.IsBeyond(5, 1)));
        Assert.All(facets, f => Assert.Equal(1, Gcd(f.A1, f.A2)));
    }

    [Fact]
    public void Hull_test_is_exact_for_every_radius_on_the_9_grid()
    {
        const int n = 9;
        for (long limit = 0; limit < 170; limit++)
        {
            var facets = LatticeHull.CrossableFacets(limit, n);
            for (int x = -n; x <= n; x++)
            {
                for (int y = -n; y <= n; y++)
                {
                    bool outside = facets.Any(f => f.IsBeyond(x, y));
                    Assert.True(outside == !LatticeHull.IsForbidden(x, y, limit), $"limit {limit}, offset ({x}, {y})");
                }
            }
        }
    }

    [Theory]
    [InlineData(9, 20)]
    [InlineData(16, 28)]
    [InlineData(32, 48)]
    public void Worst_case_facets_per_pair_match_the_doc(int n, int expected)
    {
        int worst = CandidateScales.SquaredLengths(n).Max(s => LatticeHull.CrossableFacets(s - 1, n).Count);
        Assert.Equal(expected, worst);
    }

    [Fact]
    public void Starting_points_give_at_most_eight_facets_inside_the_hull()
    {
        long limit = LatticeHull.ForbiddenLimit(5);
        var start = LatticeHull.StartingPoints(limit, 9);
        Assert.Contains(new Point(0, 0), start);
        Assert.All(start, p => Assert.True(LatticeHull.IsForbidden(p.X, p.Y, limit)));
        Assert.InRange(LatticeHull.Facets(start).Count, 4, 8);
    }

    [Fact]
    public void Candidate_scales_for_the_running_example()
    {
        var defs = new Definitions(RunningExample.Tree(), 9);
        var candidates = CandidateScales.Compute(defs);
        Assert.Equal(50, CandidateScales.SquaredLengths(9).Count);
        Assert.Equal(192, candidates.Count);
        Assert.Contains(candidates, c => Math.Abs(c - 1.0540925533894598) < 1e-12);
        Assert.True(candidates.SequenceEqual(candidates.OrderBy(c => c)));
        Assert.True(candidates[^1] <= defs.ScaleUpperBound + 1e-12);
    }

    [Fact]
    public void Symmetry_maps_any_anchor_position_into_the_domain()
    {
        var spec = new ProblemSpec { Tree = RunningExample.Tree(), GridSize = 9 };
        var symmetry = SymmetryBreaking.Create(spec);
        Assert.NotNull(symmetry.Anchor);
        Assert.Empty(symmetry.SiblingGroups);
        for (int x = 0; x <= 9; x++)
        {
            for (int y = 0; y <= 9; y++)
            {
                var layout = new Dictionary<int, (int X, int Y)> { [symmetry.Anchor!.Value] = (x, y) };
                var (cx, cy) = symmetry.Canonicalize(layout)[symmetry.Anchor.Value];
                Assert.True(symmetry.InDomain(cx, cy), $"({x}, {y}) → ({cx}, {cy})");
            }
        }
    }

    [Fact]
    public void Equal_legs_of_a_star_are_all_siblings_with_no_anchor()
    {
        var star = Tree.FromEdges(new[] { ("1", "c", 1.0), ("2", "c", 1.0), ("3", "c", 1.0), ("4", "c", 1.0) });
        var symmetry = SymmetryBreaking.Create(new ProblemSpec { Tree = star, GridSize = 9 });
        Assert.Null(symmetry.Anchor);
        Assert.Single(symmetry.SiblingGroups);
        Assert.Equal(3, symmetry.SiblingOrder.Count);
    }

    private static int Gcd(int a, int b)
    {
        a = Math.Abs(a);
        b = Math.Abs(b);
        while (b != 0) (a, b) = (b, a % b);
        return a;
    }
}
