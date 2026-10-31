using System.Diagnostics;
using System.Text.Json.Serialization;
using PureMilpTreeMaker;
using PureMilpTreeMaker.Web;

var builder = WebApplication.CreateBuilder(args);

// Without launch settings or ASPNETCORE_URLS, listen on a fixed local port.
if (string.IsNullOrEmpty(builder.Configuration["urls"]) &&
    string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://localhost:5080");
}

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    options.SerializerOptions.NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals;
});
builder.Services.AddSingleton<SolveCoordinator>();

var app = builder.Build();
app.UseDefaultFiles();
// Always revalidate the page and its scripts, so a browser never mixes a cached older app.js with a newer page.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Context.Response.Headers.Pragma = "no-cache";
    },
});

// The running example, to populate the editor.
app.MapGet("/api/example", () => ProblemDto.RunningExample());

// Definitions D:1–D:4 and the predicted model size, without solving.
app.MapPost("/api/analyze", (ProblemDto problem) =>
{
    try
    {
        var spec = problem.ToSpec();
        var tree = spec.Tree;
        var definitions = new Definitions(tree, spec.GridSize);
        var stretch = new HashSet<int>(spec.StretchSet);
        return Results.Ok(new AnalysisDto(
            tree.Leaves.Select(tree.Name).ToArray(),
            Enumerable.Range(0, tree.VertexCount).Where(v => !tree.IsLeaf(v)).Select(tree.Name).ToArray(),
            tree.Pairs.Select(p => new PairLengthDto(
                tree.Name(p.I), tree.Name(p.J), definitions.PathLength(p), definitions.StretchableLength(p, stretch))).ToArray(),
            definitions.MaxPathLength,
            definitions.MinPathLength,
            definitions.ScaleUpperBound,
            ModelSize.Predict(spec)));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

// Build and solve in this process. One solve runs at a time; a second request gets 409.
app.MapPost("/api/solve", async (ProblemDto problem, SolveCoordinator coordinator) =>
{
    ProblemSpec spec;
    try
    {
        spec = problem.ToSpec();
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }

    var token = coordinator.TryBegin();
    if (token is null)
    {
        return Results.Conflict(new { error = "A solve is already running." });
    }

    try
    {
        var clock = Stopwatch.StartNew();
        var result = await Task.Run(() => PureMilpSolver.Solve(spec, token.Value));
        return Results.Ok(SolveResponse.From(result, clock.Elapsed));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (OperationCanceledException)
    {
        return Results.Ok(new { cancelled = true });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
    finally
    {
        coordinator.End();
    }
});

// Interrupt the running solve; SCIP returns its best layout so far.
app.MapPost("/api/cancel", (SolveCoordinator coordinator) => Results.Ok(new { cancelled = coordinator.Cancel() }));

// Step 1 toward a crease pattern: do the tight paths divide the leaves' hull into valid polygons?
app.MapPost("/api/polygons", (PolygonRequest request) =>
{
    try
    {
        var spec = (request.Problem with { Stage = Stage.Scale }).ToSpec();
        var layout = PureMilpTreeMaker.ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
        var defs = new PureMilpTreeMaker.Definitions(spec.Tree, spec.GridSize);
        if (request.EdgeLengths is { } lengths && lengths.Count != spec.Tree.Edges.Count)
        {
            throw new ArgumentException("There must be one edge length per edge.");
        }
        var pairs = PureMilpTreeMaker.LayoutAnalysis.Pairs(defs, layout, request.Scale, request.EdgeLengths);
        return Results.Ok(PureMilpTreeMaker.ActivePaths.Analyze(layout, pairs));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

// Step 2: change edge lengths so chosen pairs become tight and close the polygons, with the leaves held in place.
app.MapPost("/api/complete", async (PolygonRequest request) =>
{
    try
    {
        var spec = (request.Problem with { Stage = Stage.Scale }).ToSpec();
        var layout = PureMilpTreeMaker.ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
        var options = new PureMilpTreeMaker.CompletionOptions
        {
            StrainMin = request.StrainMin ?? -0.3,
            StrainMax = request.StrainMax ?? 0.3,
            Targets = request.Targets ?? new List<PureMilpTreeMaker.LeafPairName>(),
            TimeLimit = spec.Solver.TimeLimit,
        };
        var result = await Task.Run(() => PureMilpTreeMaker.PolygonCompletion.Complete(
            spec, layout, request.Scale, request.EdgeLengths, options));
        return Results.Ok(result);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

// Step 3: the crease pattern (universal molecules) and the folded base, for a layout whose polygons are valid.
app.MapPost("/api/creases", async (PolygonRequest request) =>
{
    try
    {
        var spec = (request.Problem with { Stage = Stage.Scale }).ToSpec();
        var layout = PureMilpTreeMaker.ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
        var result = await Task.Run(() => PureMilpTreeMaker.CreasePatternBuilder.Build(
            spec, layout, request.Scale, request.EdgeLengths, request.PleatHeight is > 0 ? request.PleatHeight : null));
        return Results.Ok(result);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

// "Find the strain needed": the smallest symmetric strain bound that closes the polygons, as one or two LPs.
app.MapPost("/api/strain-needed", async (PolygonRequest request) =>
{
    try
    {
        var spec = request.Problem.ToSpec();
        var layout = PureMilpTreeMaker.ActivePaths.Place(spec.Tree, request.Layout.Select(p => (p.Leaf, p.X, p.Y)));
        var result = await Task.Run(() => PureMilpTreeMaker.StrainNeeded.Find(spec, layout, request.Scale, request.EdgeLengths));
        return Results.Ok(result);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

// Show a layout read from a layout file as if it had just been solved: exact scale, pair spacing, violations.
app.MapPost("/api/layout", (ImportLayoutRequest request) =>
{
    try
    {
        var spec = (request.Problem with { StartLayout = null }).ToSpec();
        var e = PureMilpTreeMaker.LayoutImport.Evaluate(spec, request.Layout.Select(p => (p.Leaf, p.X, p.Y)), request.Scale, request.EdgeLengths);
        var result = new SolveResult
        {
            Stage = Stage.Scale,
            Status = SolveStatus.Feasible,
            SolverName = "Imported file",
            Objective = e.Scale,
            Scale = e.Scale,
            TreeMakerScale = e.Scale / spec.GridSize,
            Layout = e.Layout,
            Pairs = e.Pairs,
            EdgeLengths = e.EdgeLengths,
            Violations = e.Violations,
            Model = ModelSize.Predict(spec with { Stage = Stage.Scale }),
            Messages = e.Messages,
        };
        return Results.Ok(SolveResponse.From(result, TimeSpan.Zero));
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    foreach (var url in app.Urls)
    {
        Console.WriteLine($"Pure MILP TreeMaker is running at {url}");
    }
});

app.Run();
