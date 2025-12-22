import { readFileSync } from 'node:fs';
import type { ExitOverlay } from '@quantbot/simulation';

type Overlay = ExitOverlay;
export type OverlaySet = { id: string; overlays: Overlay[] };

function isOverlayArray(x: unknown): x is Overlay[] {
  return (
    Array.isArray(x) && x.length > 0 && typeof x[0] === 'object' && x[0] !== null && 'kind' in x[0]
  );
}

function isOverlaySetArray(x: unknown): x is OverlaySet[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((s) => s && typeof s === 'object' && Array.isArray((s as any).overlays))
  );
}

/**
 * Accepts either:
 *  - an array of overlays: [ {...}, {...} ]   -> becomes one set: set-0
 *  - an array of overlay sets: [ {id, overlays:[...]}, ... ]
 *  - an object wrapper: { sets: [...] }
 */
export function loadOverlaySetsFromFile(filePath: string): OverlaySet[] {
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  // Wrapper: { sets: [...] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).sets)) {
    const sets = (parsed as any).sets;
    if (!isOverlaySetArray(sets)) {
      throw new Error(
        `Invalid overlays file shape: { sets: ... } but sets are not valid overlay sets`
      );
    }
    return sets;
  }

  // Array of overlay sets
  if (isOverlaySetArray(parsed)) {
    return parsed;
  }

  // Array of overlays -> single set
  if (isOverlayArray(parsed)) {
    return [{ id: 'set-0', overlays: parsed as Overlay[] }];
  }

  throw new Error(
    `Invalid overlays file shape. Expected one of: Overlay[], OverlaySet[], or { sets: OverlaySet[] }`
  );
}
