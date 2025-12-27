/**
 * Ports (interfaces) used by the pure workflow handler.
 * Implementations live in adapters packages.
 *
 * NOTE: Port interfaces are defined in @quantbot/core to break circular dependency.
 * Re-export from core for backward compatibility.
 */

export type { SliceExporter, SliceAnalyzer, SliceValidator } from '@quantbot/core';
