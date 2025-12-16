/**
 * Address Extraction and Validation Module
 *
 * Two-pass validation system:
 * - Pass 1: Extraction-time (fast, deterministic, no network)
 * - Pass 2: Pre-persist (authoritative syntactic validation)
 * - Pass 3: Semantic (optional, at OHLCV fetch time - not in this module)
 */

export * from './extract-candidates.js';
export * from './validate.js';

