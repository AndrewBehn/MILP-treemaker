namespace OptimizedMilpTreeMaker.Web;

/// <summary>Allows one solve at a time and lets the UI interrupt it.</summary>
public sealed class SolveCoordinator
{
    private readonly object _gate = new();
    private CancellationTokenSource? _current;

    /// <summary>Starts a solve and returns its token, or null when another solve is running.</summary>
    public CancellationToken? TryBegin()
    {
        lock (_gate)
        {
            if (_current is not null)
            {
                return null;
            }
            _current = new CancellationTokenSource();
            return _current.Token;
        }
    }

    /// <summary>Marks the running solve as finished.</summary>
    public void End()
    {
        lock (_gate)
        {
            _current?.Dispose();
            _current = null;
        }
    }

    /// <summary>Interrupts the running solve; returns false when nothing is running.</summary>
    public bool Cancel()
    {
        lock (_gate)
        {
            if (_current is null)
            {
                return false;
            }
            _current.Cancel();
            return true;
        }
    }
}
