/**
 * ClickHouse Data Loader
 *
 * Loads trading call data from ClickHouse database
 */
import { DataLoader, LoadParams, LoadResult } from './types';
export declare class ClickHouseDataLoader implements DataLoader {
    readonly name = "clickhouse-loader";
    load(params: LoadParams): Promise<LoadResult[]>;
    canLoad(source: string): boolean;
    private transformResults;
}
//# sourceMappingURL=clickhouse-loader.d.ts.map