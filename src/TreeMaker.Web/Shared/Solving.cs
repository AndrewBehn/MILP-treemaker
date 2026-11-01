namespace TreeMaker.Web;

/// <summary>Runs one solve at a time for every solver variant and turns failures into HTTP answers.</summary>
public static class Solving
{
    /// <summary>Starts <paramref name="solve"/> on the thread pool under the shared <see cref="SolveCoordinator"/>.</summary>
    public static async Task<IResult> Run<T>(SolveCoordinator coordinator, Func<CancellationToken, T> solve)
    {
        var token = coordinator.TryBegin();
        if (token is null)
        {
            return Results.Conflict(new { error = "A solve is already running." });
        }
        try
        {
            var result = await Task.Run(() => solve(token.Value));
            return Results.Ok(result);
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
    }

    /// <summary>Runs a request handler that only fails on bad input.</summary>
    public static IResult Checked(Func<object> handler)
    {
        try
        {
            return Results.Ok(handler());
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Runs a slower request handler off the request thread.</summary>
    public static async Task<IResult> CheckedAsync(Func<object> handler)
    {
        try
        {
            return Results.Ok(await Task.Run(handler));
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return Results.Problem(ex.Message);
        }
    }
}
