#!/usr/bin/env ts-node
/**
 * Database Migration: Add entry_mcap Column
 *
 * Adds entry_mcap column to caller_alerts table if it doesn't exist
 */
declare function addMcapColumn(): Promise<void>;
export { addMcapColumn };
//# sourceMappingURL=migrate-db-add-mcap-column.d.ts.map