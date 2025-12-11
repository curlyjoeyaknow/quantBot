/**
 * Data Loader Factory
 * 
 * Provides access to all data loaders and factory methods
 */

import { DataLoader, LoadParams, LoadResult } from './types';
import { CsvDataLoader } from './csv-loader';

// Export types
export * from './types';

import { ClickHouseDataLoader } from './clickhouse-loader';
import { CallerDataLoader } from './caller-loader';

// Available loaders
const loaders: DataLoader[] = [
  new CsvDataLoader(),
  new ClickHouseDataLoader(),
  new CallerDataLoader(),
];

/**
 * Get a loader that can handle the given source
 */
export function getLoader(source: string): DataLoader | null {
  return loaders.find(loader => loader.canLoad(source)) || null;
}

/**
 * Load data using the appropriate loader
 */
export async function loadData(params: LoadParams): Promise<LoadResult[]> {
  const loader = getLoader(params.source);
  if (!loader) {
    throw new Error(`No loader found for source: ${params.source}`);
  }
  return loader.load(params);
}

/**
 * Register a new loader
 */
export function registerLoader(loader: DataLoader): void {
  loaders.push(loader);
}

