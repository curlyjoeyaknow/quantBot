#!/usr/bin/env ts-node
import { config } from 'dotenv';
// Override existing env vars to ensure .env file takes precedence
config({ override: true });

import path from 'path';
import { promises as fs } from 'fs';
import { runSimulationConfig, loadSimulationConfig } from '@quantbot/simulation';

type CachePolicy = 'prefer-cache' | 'refresh' | 'cache-only';

interface CliOptions {
  configPath: string;
  maxConcurrency?: number;
  dryRun?: boolean;
  failFast?: boolean;
  cachePolicy?: CachePolicy;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {};

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];

    // Handle --key=value format
    if (arg.includes('=')) {
      const [key, value] = arg.split('=', 2);
      arg = key;

      switch (key) {
        case '--config':
        case '-c':
          options.configPath = value;
          continue;
        case '--maxConcurrency':
        case '-j':
          options.maxConcurrency = Number(value);
          continue;
        case '--cache-policy':
          if (!['prefer-cache', 'refresh', 'cache-only'].includes(value)) {
            throw new Error(`Invalid cache policy: ${value}`);
          }
          options.cachePolicy = value as CachePolicy;
          continue;
        default:
          throw new Error(`Unknown flag ${key}`);
      }
    }

    // Handle --key value format
    if (!arg.startsWith('--') && !arg.startsWith('-')) continue;
    const next = argv[i + 1];

    switch (arg) {
      case '--config':
      case '-c':
        if (!next) throw new Error('--config requires a file path');
        options.configPath = next;
        i++;
        break;
      case '--maxConcurrency':
      case '-j':
        if (!next) throw new Error('--maxConcurrency requires a number');
        options.maxConcurrency = Number(next);
        i++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--fail-fast':
        options.failFast = true;
        break;
      case '--no-fail-fast':
        options.failFast = false;
        break;
      case '--cache-policy':
        if (!next) throw new Error('--cache-policy requires a value');
        if (!['prefer-cache', 'refresh', 'cache-only'].includes(next)) {
          throw new Error(`Invalid cache policy: ${next}`);
        }
        options.cachePolicy = next as CachePolicy;
        i++;
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }

  if (!options.configPath) {
    throw new Error('Missing required --config path');
  }

  return options as CliOptions;
}

async function loadConfigFromFile(configPath: string) {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  try {
    const raw = JSON.parse(content);
    return loadSimulationConfig(raw);
  } catch (error) {
    throw new Error(`Failed to parse config ${configPath}: ${(error as Error).message}`);
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = await loadConfigFromFile(cli.configPath);

  // Ensure all required RunOptions fields are present
  const defaultRunOptions = {
    maxConcurrency: 4,
    cachePolicy: 'prefer-cache' as const,
    dryRun: false,
    failFast: true,
    progressInterval: 100,
  };

  config.global.run = {
    ...defaultRunOptions,
    ...config.global.run,
    ...(cli.maxConcurrency ? { maxConcurrency: cli.maxConcurrency } : {}),
    ...(cli.dryRun ? { dryRun: true } : {}),
    ...(typeof cli.failFast === 'boolean' ? { failFast: cli.failFast } : {}),
    ...(cli.cachePolicy ? { cachePolicy: cli.cachePolicy } : {}),
  };

  const summaries = await runSimulationConfig(config);

  console.log('\n=== Simulation Summary ===');
  for (const summary of summaries) {
    console.log(
      `${summary.scenarioName}: ${summary.successes}/${summary.totalTargets} succeeded, ${summary.failures} failed`
    );
  }
}

main().catch((error) => {
  console.error('Simulation engine failed:', error);
  process.exitCode = 1;
});
