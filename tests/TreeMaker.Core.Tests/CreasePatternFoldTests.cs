namespace TreeMaker.Core.Tests;

/// <summary>Folding any crease pattern flat (CreasePatternFold), the same cases as tools/cp_fold.py.</summary>
public class CreasePatternFoldTests
{
    private static CpLine L(double ax, double ay, double bx, double by, LineKind k) => new(new PointD(ax, ay), new PointD(bx, by), k);

    private static List<CpLine> Square(double s = 1) => new()
    {
        L(0, 0, s, 0, LineKind.B), L(s, 0, s, s, LineKind.B), L(s, s, 0, s, LineKind.B), L(0, s, 0, 0, LineKind.B),
    };

    [Fact]
    public void OneValleyFoldGivesTwoFacesOnTopOfEachOther()
    {
        var r = CreasePatternFold.Fold(Square().Append(L(0, 0.5, 1, 0.5, LineKind.V)).ToList());
        Assert.True(r.Foldable, string.Join(" ", r.Messages));
        Assert.Equal(2, r.Faces.Count);
        Assert.Single(r.Faces, f => f.Flipped);
        // Folded, both faces lie on one half of the sheet.
        var ys = r.Faces.SelectMany(f => f.Folded!).Select(p => p.Y).ToList();
        Assert.True(ys.Max() - ys.Min() < 0.5 + 1e-9);
    }

    [Fact]
    public void QuartersPassKawasakiAndMaekawa()
    {
        var lines = Square(200);   // any units: scaled to the sheet
        lines.AddRange(new[] { L(0, 100, 100, 100, LineKind.V), L(100, 100, 200, 100, LineKind.M), L(100, 0, 100, 200, LineKind.M) });
        var r = CreasePatternFold.Fold(lines);
        Assert.True(r.Foldable);
        Assert.Equal(4, r.Faces.Count);
        var v = Assert.Single(r.Vertices);
        Assert.Equal(4, v.Degree);
        Assert.True(v.Kawasaki);
        Assert.True(v.Maekawa);
        Assert.Equal(1, r.SheetWidth, 9);
    }

    [Fact]
    public void ThreeCreasesAtAPointDoNotFoldFlat()
    {
        var lines = Square();
        lines.AddRange(new[] { L(0.5, 0.5, 0, 0, LineKind.V), L(0.5, 0.5, 1, 0, LineKind.V), L(0.5, 0.5, 0.5, 1, LineKind.M) });
        var r = CreasePatternFold.Fold(lines);
        Assert.False(r.Foldable);
        Assert.NotEmpty(r.Clashes);
        Assert.Contains(r.Vertices, c => !c.Kawasaki);
    }

    [Fact]
    public void AnEightRayVertexFoldsToAQuarter()
    {
        var lines = Square();
        lines.AddRange(new[]
        {
            L(0, 0, 1, 1, LineKind.V), L(1, 0, 0, 1, LineKind.V), L(0, 0.5, 1, 0.5, LineKind.M),
            L(0.5, 0, 0.5, 0.5, LineKind.M), L(0.5, 0.5, 0.5, 1, LineKind.V),
        });
        var r = CreasePatternFold.Fold(lines);
        Assert.True(r.Foldable, string.Join(" ", r.Messages));
        Assert.Equal(8, r.Faces.Count);
        var all = r.Faces.SelectMany(f => f.Folded!).ToList();
        Assert.True(all.Max(p => p.X) - all.Min(p => p.X) <= 0.5 + 1e-9);
        Assert.True(all.Max(p => p.Y) - all.Min(p => p.Y) <= 0.5 + 1e-9);
    }

    [Fact]
    public void ATracedPatternNeedsAnAngleTolerance()
    {
        // Quarters with the centre traced 0.3° off: exact checks fail it, a 1° tolerance passes it.
        double off = Math.Tan(0.3 * Math.PI / 180) * 0.5;
        var lines = Square();
        lines.AddRange(new[] { L(0, 0.5, 0.5, 0.5, LineKind.V), L(0.5, 0.5, 1, 0.5 + off, LineKind.M), L(0.5, 0, 0.5, 1, LineKind.M) });
        Assert.False(CreasePatternFold.Fold(lines).Foldable);
        Assert.True(CreasePatternFold.Fold(lines, toleranceDegrees: 1).Foldable);
    }

    [Fact]
    public void WithoutABorderTheBoundingBoxIsTheSheet()
    {
        var r = CreasePatternFold.Fold(new[] { L(0, 0, 1, 1, LineKind.U), L(0, 1, 1, 0, LineKind.U) });
        Assert.Contains(r.Messages, m => m.Contains("bounding box"));
        Assert.Equal(4, r.Faces.Count);
        Assert.True(r.Foldable);
    }

    [Fact]
    public void PinwheelBaseWithCoordinatesToThreeDecimalsFolds()
    {
        // tools/cp_fixtures/pinwheelBase.svg (Origami Simulator, MIT): drawn in Illustrator, its coordinates rounded to
        // 0.001 in a 1553-unit sheet. Composing reflections grows that rounding past an exact test of the maps.
        var lines = new List<CpLine>
        {
            L(515.823, 521.176, 2068.766, 521.176, LineKind.B), L(515.823, 2074.117, 2068.766, 2074.117, LineKind.B),
            L(515.824, 2074.117, 515.823, 521.176, LineKind.B), L(2068.766, 2074.117, 2068.766, 521.176, LineKind.B),
            L(904.059, 1685.882, 1680.529, 1685.882, LineKind.M), L(904.059, 909.411, 1680.529, 909.411, LineKind.M),
            L(515.823, 521.176, 904.059, 909.411, LineKind.M), L(2068.766, 1297.646, 1680.529, 909.411, LineKind.V),
            L(2068.766, 521.176, 1680.529, 909.411, LineKind.M), L(2068.766, 2074.117, 1680.529, 1685.882, LineKind.M),
            L(515.823, 2074.117, 904.059, 1685.882, LineKind.M), L(515.823, 1297.646, 904.059, 1685.882, LineKind.V),
            L(904.059, 909.411, 904.059, 1685.882, LineKind.M), L(1680.529, 909.411, 1680.529, 1685.882, LineKind.M),
            L(904.059, 909.411, 1292.294, 521.176, LineKind.V), L(1680.529, 1685.882, 1292.294, 2074.117, LineKind.V),
        };
        var r = CreasePatternFold.Fold(lines);
        Assert.True(r.Foldable, string.Join(" ", r.Messages));
        Assert.Equal(9, r.Faces.Count);
    }
}
