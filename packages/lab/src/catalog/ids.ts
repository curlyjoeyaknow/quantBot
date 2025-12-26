import crypto from 'node:crypto';

export function sha(v: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
}

export function tokenSetId(tokens: string[]): string {
  return sha([...tokens].sort());
}

export function sliceId(args: {
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokenSetId: string;
  schemaHash: string;
}): string {
  return sha(args);
}

export function featuresId(args: { sliceId: string; featureSetId: string }): string {
  return sha(args);
}

export function simId(args: {
  featuresId: string;
  strategyHash: string;
  riskHash: string;
  windowId?: string;
  engineVersion: string;
}): string {
  return sha(args);
}

