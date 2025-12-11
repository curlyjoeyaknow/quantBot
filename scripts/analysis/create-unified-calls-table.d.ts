/**
 * Create a unified caller-free SQLite table containing all calls from all callers
 */
import { Database } from 'sqlite3';
declare const UNIFIED_DB_PATH: string;
/**
 * Initialize unified calls database
 */
declare function initUnifiedDatabase(): Promise<Database>;
export { initUnifiedDatabase, UNIFIED_DB_PATH };
//# sourceMappingURL=create-unified-calls-table.d.ts.map