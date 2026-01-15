
/**
 * Scan artifacts directory and list all backtest runs
 *
 * @param artifactsBaseDir - Base artifacts directory (default: process.cwd()/artifacts/backtest)
 */
export async function scanBacktestRuns(artifactsBaseDir?: string): Promise<string[]> {
  const baseDir = artifactsBaseDir || join(process.cwd(), 'artifacts', 'backtest');

  if (!existsSync(baseDir)) {
    return [];
  }

  const entries = await readdir(baseDir, { withFileTypes: true });
  const runIds: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const runId = entry.name;
        runIds.push(runId);
      }
    }
  }

  return runIds.sort((a, b) => b.localeCompare(a)); // Most recent first
}

/**
 * Get summaries for all runs
 *
 * @param artifactsBaseDir - Base artifacts directory
 * @returns Array of run summaries
 */
export async function getAllRunSummaries(
  artifactsBaseDir?: string
      console.warn(
        `Warning: Could not read run ${runId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return summaries;
}
