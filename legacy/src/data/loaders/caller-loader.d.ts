/**
 * Caller Data Loader
 *
 * Loads trading call data from caller tracking database
 */
import { DataLoader, LoadParams, LoadResult } from './types';
export declare class CallerDataLoader implements DataLoader {
    readonly name = "caller-loader";
    load(params: LoadParams): Promise<LoadResult[]>;
    canLoad(source: string): boolean;
}
//# sourceMappingURL=caller-loader.d.ts.map