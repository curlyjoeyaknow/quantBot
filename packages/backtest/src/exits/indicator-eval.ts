import type { Candle } from '@quantbot/core';
import type { IndicatorExitSpec, IndicatorRule } from './exit-plan.js';
import {
  closeSeries,
  hl2Series,
  ema,
  rsi,
  ichimokuTenkanKijun,
  volumeZScore,
  crossed,
  crossedLevel,
} from '../indicators/series.js';

// Re-export simulation's signal evaluator for advanced signal-based exits
export { evaluateSignalGroup } from '../sim/signals/evaluator.js';
export type { SignalCondition, SignalGroup, IndicatorName } from '../sim/types/signals.js';

// Re-export signal presets
export {
  getSignalPreset,
  listSignalPresets,
  getSignalPresetsByCategory,
  registerSignalPreset,
  combineSignalPresets,
} from '../sim/signals/presets.js';

export function buildIndicatorExitSignal(candles: Candle[], spec: IndicatorExitSpec): boolean[] {
  const mode = spec.mode ?? 'ANY';
  const n = candles.length;
  const out = new Array<boolean>(n).fill(false);

  if (!spec.enabled || spec.rules.length === 0) return out;

  // Precompute series lazily as needed
  const cache: Record<string, any> = {};

  const ruleSignal = (rule: IndicatorRule): boolean[] => {
    const sig = new Array<boolean>(n).fill(false);

    if (rule.type === 'ichimoku_cross') {
      const key = `ichimoku_${rule.tenkan}_${rule.kijun}`;
      if (!cache[key]) cache[key] = ichimokuTenkanKijun(candles, rule.tenkan, rule.kijun);
      const { tenkan, kijun } = cache[key] as ReturnType<typeof ichimokuTenkanKijun>;

      for (let i = 1; i < n; i++) {
        sig[i] = crossed(tenkan[i - 1], kijun[i - 1], tenkan[i], kijun[i], rule.direction);
      }
      return sig;
    }

    if (rule.type === 'ema_cross') {
      const source = 'close';
      const srcKey = `src_${source}`;
      if (!cache[srcKey]) cache[srcKey] = closeSeries(candles);
      const values = cache[srcKey] as number[];

      const kFast = `ema_${rule.fast}`;
      const kSlow = `ema_${rule.slow}`;
      if (!cache[kFast]) cache[kFast] = ema(values, rule.fast);
      if (!cache[kSlow]) cache[kSlow] = ema(values, rule.slow);

      const fast = cache[kFast] as Array<number | null>;
      const slow = cache[kSlow] as Array<number | null>;

      for (let i = 1; i < n; i++)
        sig[i] = crossed(fast[i - 1], slow[i - 1], fast[i], slow[i], rule.direction);
      return sig;
    }

    if (rule.type === 'rsi_cross') {
      const source = 'close';
      const srcKey = `src_${source}`;
      if (!cache[srcKey]) cache[srcKey] = closeSeries(candles);
      const values = cache[srcKey] as number[];

      const k = `rsi_${rule.period}`;
      if (!cache[k]) cache[k] = rsi(values, rule.period);
      const rs = cache[k] as Array<number | null>;

      for (let i = 1; i < n; i++)
        sig[i] = crossedLevel(rs[i - 1], rs[i], rule.level, rule.direction);
      return sig;
    }

    if (rule.type === 'volume_spike') {
      const k = `volz_${rule.window}`;
      if (!cache[k]) cache[k] = volumeZScore(candles, rule.window);
      const z = cache[k] as Array<number | null>;
      for (let i = 0; i < n; i++) {
        const val = z[i];
        sig[i] = val !== null && val !== undefined && val >= rule.z;
      }
      return sig;
    }

    return sig;
  };

  const signals = spec.rules.map(ruleSignal);

  for (let i = 0; i < n; i++) {
    out[i] = mode === 'ALL' ? signals.every((s) => s[i]) : signals.some((s) => s[i]);
  }

  return out;
}
