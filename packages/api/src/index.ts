/**
 * @quantbot/api
 *
 * This file acts as a backward compatibility shim.
 * The API package has been merged into @quantbot/cli.
 * 
 * To start the API server, use: `quantbot serve`
 * 
 * API functionality is available via @quantbot/cli/server
 */

// Re-export server functionality from CLI
export { createApiServer } from '@quantbot/cli/server';
export type { ApiServerConfig } from '@quantbot/cli/server';
