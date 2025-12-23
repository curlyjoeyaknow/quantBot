import { readFileSync } from 'node:fs';
import { ValidationError } from '@quantbot/utils';
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
    x.every((s) => {
      if (!s || typeof s !== 'object') return false;
      const obj = s as Record<string, unknown>;
      return Array.isArray(obj.overlays);
    })
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
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.sets)) {
      const sets = obj.sets;
      if (!isOverlaySetArray(sets)) {
        throw new ValidationError(
          `Invalid overlays file shape: { sets: ... } but sets are not valid overlay sets`,
          { filePath, parsedType: typeof parsed }
        );
      }
      return sets;
    }
  }

  // Array of overlay sets
  if (isOverlaySetArray(parsed)) {
    return parsed;
  }

  // Array of overlays -> single set
  if (isOverlayArray(parsed)) {
    return [{ id: 'set-0', overlays: parsed as Overlay[] }];
  }

  throw new ValidationError(
    `Invalid overlays file shape. Expected one of: Overlay[], OverlaySet[], or { sets: OverlaySet[] }`,
    { filePath, parsedType: typeof parsed }
  );
}
