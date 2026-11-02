using System.Text.Json.Serialization;
using TreeMaker.Web;

// TreeMaker: one app for every solver spec and the steps after it. The page opens on a map of the specs and steps;
// each node opens the matching part of the app. The API is grouped the same way:
//   /api/example, /api/random, /api/cancel        shared
//   /api/pure/*        base model (Pure MILP; Symmetry-Breaking MILP with symmetryBreaking: true)
//   /api/optimized/*   lattice hulls and bisection (Optimized MILP; Lattice-Hull MILP with symmetry breaking off)
//   /api/scalable/*    the four-stage pipeline (Scalable MILP)
//   /api/polygons, /api/complete, /api/strain-needed, /api/creases   the steps after any solver
//   /api/cp/fold       the crease-pattern page: fold any crease pattern flat
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
// Always revalidate the page and its scripts, so a browser never mixes a cached older script with a newer page.
// The packaged specs are Markdown (wwwroot/specs/*.md), which the default content-type table may not list.
var contentTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
contentTypes.Mappings[".md"] = "text/markdown; charset=utf-8";
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = contentTypes,
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Context.Response.Headers.Pragma = "no-cache";
    },
});

var api = app.MapGroup("/api");

// The running example of the specs, to populate the editor.
api.MapGet("/example", () => TreeMaker.Web.Pure.ProblemDto.RunningExample());

// A random tree for trying 25 to 100 leaves, on its suggested grid.
api.MapGet("/random", (int? leaves, int? seed, bool? whole) =>
    TreeMaker.Web.Scalable.ProblemDto.Random(Math.Clamp(leaves ?? 50, 2, 200), seed ?? 1, whole ?? true));

// Interrupt the running solve, whichever solver it is; the solvers return their best layout so far.
api.MapPost("/cancel", (SolveCoordinator coordinator) => Results.Ok(new { cancelled = coordinator.Cancel() }));

TreeMaker.Web.Pure.PureEndpoints.Map(api.MapGroup("/pure"));
TreeMaker.Web.Optimized.OptimizedEndpoints.Map(api.MapGroup("/optimized"));
TreeMaker.Web.Scalable.ScalableEndpoints.Map(api.MapGroup("/scalable"));
StepEndpoints.Map(api);
// A side tool: fold any crease pattern from a file or an image (cp.html).
CreasePatternEndpoints.Map(api.MapGroup("/cp"));

app.Lifetime.ApplicationStarted.Register(() =>
{
    foreach (var url in app.Urls)
    {
        Console.WriteLine($"TreeMaker is running at {url}");
    }
});

app.Run();
