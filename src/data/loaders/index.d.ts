/**
 * Data Loader Factory
 *
 * Provides access to all data loaders and factory methods
 */
import { DataLoader, LoadParams, LoadResult } from './types';
export * from './types';
/**
 * Get a loader that can handle the given source
 */
export declare function getLoader(source: string): DataLoader | null;
/**
 * Load data using the appropriate loader
 */
export declare function loadData(params: LoadParams): Promise<LoadResult[]>;
/**
 * Register a new loader
 */
export declare function registerLoader(loader: DataLoader): void;
//# sourceMappingURL=index.d.ts.map