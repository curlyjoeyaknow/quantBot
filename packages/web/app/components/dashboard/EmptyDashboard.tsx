'use client';

export function EmptyDashboard() {
  return (
    <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-6">
      <h2 className="text-xl font-semibold mb-2">No Data Available</h2>
      <p className="text-muted-foreground mb-4">
        The dashboard is empty because there's no call data in the database.
      </p>
      <div className="space-y-2 text-sm">
        <p className="font-medium">To populate the dashboard:</p>
        <ol className="list-decimal list-inside space-y-1 ml-4">
          <li>
            <strong>Ingest Telegram calls:</strong>
            <br />
            <code className="bg-muted px-2 py-1 rounded text-xs">
              pnpm quantbot ingestion telegram --file path/to/messages.html --caller-name YourCaller
            </code>
          </li>
          <li>
            <strong>Fetch OHLCV data:</strong>
            <br />
            <code className="bg-muted px-2 py-1 rounded text-xs">
              pnpm quantbot ingestion ohlcv --from 2024-01-01
            </code>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground mt-4">
          Note: The analytics engine looks for calls in <code>data/tele.duckdb</code> (or the database specified by <code>DUCKDB_PATH</code>).
        </p>
      </div>
    </div>
  );
}

