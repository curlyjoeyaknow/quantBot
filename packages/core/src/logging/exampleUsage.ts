/**
 * Example usage of NdjsonLogger
 *
 * Run with:
 *   pnpm -w tsx packages/core/src/logging/exampleUsage.ts
 *
 * Then check output:
 *   tail -n 5 ~/.cache/quantbot/artifacts/runs-YYYY-MM-DD.ndjson
 */

import { NdjsonLogger } from './ndjsonLogger.js';

async function main() {
  const logger = new NdjsonLogger({ filename: 'runs.ndjson' });

  logger.log('run_start', { runId: 'abc123', strategy: 'tenkan-kijun' });
  logger.log('event', { msg: 'hello', foo: 42 });
  logger.log('run_end', { runId: 'abc123', status: 'ok' });

  await logger.close();

   
  console.log('Wrote:', logger.path());
}

main().catch((e) => {
   
  console.error(e);
  process.exit(1);
});
