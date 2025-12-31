export const DEFAULT_COVERAGE_TIMEOUT_MS = 900_000;
export const DEFAULT_DETAILED_COVERAGE_TIMEOUT_MS = 1_800_000;
export const DEFAULT_SURGICAL_COVERAGE_TIMEOUT_MS = 300_000;

export type CoverageTimeoutOptions = {
  specTimeoutMs?: number;
  envVar: string;
  defaultMs: number;
};

export function resolveCoverageTimeoutMs({
  specTimeoutMs,
  envVar,
  defaultMs,
}: CoverageTimeoutOptions): number {
  if (specTimeoutMs && specTimeoutMs > 0) {
    return specTimeoutMs;
  }

  const envValue = Number(process.env[envVar]);
  if (envValue > 0) {
    return envValue;
  }

  return defaultMs;
}

export function getCoverageTimeoutMs(specTimeoutMs?: number): number {
  return resolveCoverageTimeoutMs({
    specTimeoutMs,
    envVar: 'OHLCV_COVERAGE_TIMEOUT_MS',
    defaultMs: DEFAULT_COVERAGE_TIMEOUT_MS,
  });
}

export function getDetailedCoverageTimeoutMs(specTimeoutMs?: number): number {
  return resolveCoverageTimeoutMs({
    specTimeoutMs,
    envVar: 'OHLCV_DETAILED_COVERAGE_TIMEOUT_MS',
    defaultMs: DEFAULT_DETAILED_COVERAGE_TIMEOUT_MS,
  });
}

export function getSurgicalCoverageTimeoutMs(): number {
  return resolveCoverageTimeoutMs({
    envVar: 'OHLCV_COVERAGE_TIMEOUT_MS',
    defaultMs: DEFAULT_SURGICAL_COVERAGE_TIMEOUT_MS,
  });
}
