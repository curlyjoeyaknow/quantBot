/**
 * CSV Data Loader
 *
 * Loads trading call data from CSV files
 */
import { DataLoader, LoadParams, LoadResult } from './types';
export declare class CsvDataLoader implements DataLoader {
    readonly name = "csv-loader";
    load(params: LoadParams): Promise<LoadResult[]>;
    canLoad(source: string): boolean;
}
//# sourceMappingURL=csv-loader.d.ts.map