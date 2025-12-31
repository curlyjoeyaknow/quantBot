/**
 * Pure Simulator Engine
 *
 * Takes strategy JSON + candles[] → outputs summary + trades + events/frames
 *
 * This is a pure function with no I/O, no DB, no network dependencies.
 * All outputs are JSON-serializable for replay and storage.
 */

import { randomUUID } from 'crypto';
import type {
  Candle,
  Event,
  Trade,
  ReplayFrame,
  SimulationSummary,
  SimulationResult,
} from './sim_types.js';
import { validateStrategy, type StrategyConfig } from './strategy_validate.js';
import { rsi, ema } from './indicators.js';

function feeSlipMultBuy(feeBps: number, slipBps: number): number {
  return 1.0 + (feeBps + slipBps) / 10000.0;
}

function feeSlipMultSell(feeBps: number, slipBps: number): number {
  return 1.0 - (feeBps + slipBps) / 10000.0;
}

function decisionPrice(candle: Candle, fillModel: string): number {
  return fillModel === 'close' ? candle.c : candle.o;
}

function entrySignal(strategy: StrategyConfig, closes: number[]): boolean[] {
  const entry = strategy.entry;
  const n = closes.length;

  if (entry.mode === 'immediate') {
    return new Array(n).fill(true);
  }

  if (entry.mode !== 'signal') {
    throw new Error(`unsupported entry.mode: ${entry.mode}`);
  }

  const sig = entry.signal;
  if (!sig) {
    throw new Error('entry.signal is required when mode is "signal"');
  }

  if (sig.type === 'rsi_below') {
    if (!sig.period || !sig.value) {
      throw new Error('rsi_below signal requires period and value');
    }
    const r = rsi(closes, sig.period);
    return r.map((x) => x !== null && x < sig.value!);
  }

  if (sig.type === 'ema_cross') {
    if (!sig.fast || !sig.slow) {
      throw new Error('ema_cross signal requires fast and slow periods');
    }
    const ef = ema(closes, sig.fast);
    const es = ema(closes, sig.slow);
    const out: boolean[] = new Array(n).fill(false);
    const direction = sig.direction || 'bull';

    for (let i = 1; i < n; i++) {
      const efPrev = ef[i - 1];
      const esPrev = es[i - 1];
      const efCurr = ef[i];
      const esCurr = es[i];
      if (efPrev === null || esPrev === null || efCurr === null || esCurr === null) {
        continue;
      }
      const prev = efPrev - esPrev;
      const curr = efCurr - esCurr;
      if (direction === 'bull') {
        out[i] = prev <= 0 && curr > 0;
      } else {
        out[i] = prev >= 0 && curr < 0;
      }
    }
    return out;
  }

  throw new Error(`unsupported entry.signal.type: ${sig.type}`);
}

/**
 * Pure simulator function
 *
 * @param token - Token identifier (mint address)
 * @param candles - Array of OHLCV candles
 * @param strategy - Strategy configuration (validated)
 * @returns Simulation result with summary, trades, events, and replay frames
 */
export function simulateToken(
  token: string,
  candles: Candle[],
  strategy: StrategyConfig
): SimulationResult {
  validateStrategy(strategy);

  if (candles.length === 0) {
    return {
      summary: { token, trades: 0, win_rate: 0.0, avg_pnl_pct: 0.0 },
      trades: [],
      events: [],
      frames: [],
    };
  }

  const execution = strategy.execution;
  const fillModel = execution.fill_model;
  const feeBps = execution.fee_bps || 0;
  const slipBps = execution.slippage_bps || 0;
  const buyMult = feeSlipMultBuy(feeBps, slipBps);
  const sellMult = feeSlipMultSell(feeBps, slipBps);

  const exits = strategy.exits || {};
  const stops = strategy.stops || {};

  const targets = (exits.targets || []).sort((a, b) => a.profit_pct - b.profit_pct);
  const trailing = exits.trailing || {};
  const trailingEnabled = trailing.enabled || false;
  const trailPct = trailing.trail_pct || 0;
  const trailActivate = trailing.activate_profit_pct || 0;

  const timeExit = exits.time_exit || {};
  const timeExitEnabled = timeExit.enabled || false;
  const maxCandlesInTrade = timeExit.max_candles_in_trade || 0;

  const stopLossPct = stops.stop_loss_pct || 0;
  const beAfterFirst = stops.break_even_after_first_target || false;

  const closes = candles.map((c) => c.c);
  const signalTrue = entrySignal(strategy, closes);

  const delay = strategy.entry.delay || { mode: 'none' };
  const delayMode = delay.mode;
  const delayN = delayMode === 'candles' ? delay.n || 0 : 0;

  const events: Event[] = [];
  const trades: Trade[] = [];
  const frames: ReplayFrame[] = [];

  // Position state (single position v1)
  let inPos = false;
  let entryIdx: number | null = null;
  let entryTs: string | null = null;
  let entryPrice = 0.0;
  let sizeLeft = 0.0; // percent 0..100
  let stopPrice: number | null = null;
  let trailingActive = false;
  let highWatermark: number | null = null;
  let firstTargetHit = false;
  let nextTargetI = 0;
  let scheduledEntryIdx: number | null = null;
  let hasEntered = false; // Track if we've entered at least once (prevent re-entry after exit)

  function emit(i: number, etype: Event['type'], data: Record<string, unknown>): void {
    events.push({
      ts: candles[i].ts,
      candle_index: i,
      type: etype,
      data,
    });
  }

  function posSnapshot(i: number): ReplayFrame['position'] {
    if (!inPos) {
      return {
        is_open: false,
        size_pct: 0.0,
        avg_price: null,
        stop_price: null,
        unrealized_pnl_pct: null,
      };
    }
    const px = decisionPrice(candles[i], fillModel);
    const unrl = ((px - entryPrice) / entryPrice) * 100.0;
    return {
      is_open: true,
      size_pct: sizeLeft,
      avg_price: entryPrice,
      stop_price: stopPrice,
      unrealized_pnl_pct: unrl,
    };
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // --- ENTRY scheduling / triggering ---
    // Only allow entry if we haven't entered yet (prevent re-entry after exit)
    if (!inPos && !hasEntered) {
      if (scheduledEntryIdx === null) {
        if (signalTrue[i]) {
          emit(i, 'ENTRY_SIGNAL_TRUE', { reason: 'signal_true' });
          if (delayMode === 'candles' && delayN > 0) {
            scheduledEntryIdx = i + delayN;
          } else {
            scheduledEntryIdx = i;
          }
        }
      }
      // Execute scheduled entry
      if (scheduledEntryIdx !== null && i === scheduledEntryIdx && i < candles.length) {
        // For immediate entry, use open price (entry happens at start of candle)
        // For signal-based entry, use decision price (close or open based on fill_model)
        const entryPriceRaw =
          strategy.entry.mode === 'immediate' ? c.o : decisionPrice(c, fillModel);
        const fill = entryPriceRaw * buyMult;
        inPos = true;
        entryIdx = i;
        entryTs = c.ts;
        entryPrice = fill;
        sizeLeft = 100.0;
        firstTargetHit = false;
        nextTargetI = 0;
        trailingActive = false;
        highWatermark = null;
        stopPrice = stopLossPct > 0 ? entryPrice * (1.0 - stopLossPct / 100.0) : null;
        hasEntered = true; // Mark that we've entered
        emit(i, 'ENTRY_FILLED', { price: fill, size_pct: 100.0 });
        if (stopPrice !== null) {
          emit(i, 'STOP_SET', { stop_price: stopPrice });
        }
        scheduledEntryIdx = null;

        // Check stop loss immediately after entry on same candle (conservative_long: L checked before H)
        if (stopPrice !== null && c.l <= stopPrice) {
          const stopFill = stopPrice * sellMult;
          emit(i, 'STOP_HIT', { stop_price: stopPrice, fill_price: stopFill });
          emit(i, 'EXIT_FULL', { reason: 'stop' });
          const pnl = ((stopFill - entryPrice) / entryPrice) * 100.0;
          trades.push({
            trade_id: `trade_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
            token,
            entry_ts: entryTs!,
            exit_ts: c.ts,
            entry_price: entryPrice,
            exit_price: stopFill,
            pnl_pct: pnl,
            exit_reason: 'stop',
            size_pct_initial: 100.0,
          });
          inPos = false;
          sizeLeft = 0.0;
          // Build frame and continue to next candle
          frames.push({
            seq: i,
            candle: { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v },
            events: events
              .filter((e) => e.candle_index === i)
              .map((e) => ({ ts: e.ts, type: e.type, data: e.data })),
            position: {
              is_open: false,
              size_pct: 0.0,
              avg_price: null,
              stop_price: null,
              unrealized_pnl_pct: null,
            },
          });
          continue; // Move to next candle
        }
      }
    }

    // --- if in position, process exits deterministically within candle ---
    if (inPos) {
      if (entryIdx === null || entryTs === null) {
        throw new Error('Position state inconsistent: inPos but entryIdx/entryTs is null');
      }

      // Update trailing activation & watermark using candle high (h)
      // Activation: based on profit at candle high relative to entry
      const profitAtHigh = ((c.h - entryPrice) / entryPrice) * 100.0;
      if (trailingEnabled && !trailingActive && profitAtHigh >= trailActivate) {
        trailingActive = true;
        highWatermark = c.h;
        // initialize trail stop
        let tstop = highWatermark * (1.0 - trailPct / 100.0);
        // respect break-even move if already enabled
        if (beAfterFirst && firstTargetHit) {
          tstop = Math.max(tstop, entryPrice);
        }
        stopPrice = stopPrice === null ? tstop : Math.max(stopPrice, tstop);
        emit(i, 'STOP_MOVED', { stop_price: stopPrice, reason: 'trailing_activated' });
      }

      if (trailingActive) {
        if (highWatermark === null) {
          throw new Error('Trailing active but highWatermark is null');
        }
        if (c.h > highWatermark) {
          highWatermark = c.h;
          let tstop = highWatermark * (1.0 - trailPct / 100.0);
          if (beAfterFirst && firstTargetHit) {
            tstop = Math.max(tstop, entryPrice);
          }
          stopPrice = stopPrice === null ? tstop : Math.max(stopPrice, tstop);
          emit(i, 'STOP_MOVED', { stop_price: stopPrice, reason: 'trail_update' });
        }
      }

      // --- Intra-candle ordering (conservative_long): STOP via L, then TARGETS via H, then TIME EXIT ---
      // STOP check (must be first, before targets)
      if (stopPrice !== null && c.l <= stopPrice) {
        // fill at stop_price (simplified), apply sell mult
        const fill = stopPrice * sellMult;
        emit(i, 'STOP_HIT', { stop_price: stopPrice, fill_price: fill });
        emit(i, 'EXIT_FULL', { reason: 'stop' });
        // finalize trade
        const pnl = ((fill - entryPrice) / entryPrice) * 100.0;
        trades.push({
          trade_id: `trade_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          token,
          entry_ts: entryTs!,
          exit_ts: c.ts,
          entry_price: entryPrice,
          exit_price: fill,
          pnl_pct: pnl,
          exit_reason: 'stop',
          size_pct_initial: 100.0,
        });
        // reset position
        inPos = false;
        sizeLeft = 0.0;
        // Skip remaining checks for this candle (stop takes precedence)
        frames.push({
          seq: i,
          candle: { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v },
          events: events
            .filter((e) => e.candle_index === i)
            .map((e) => ({ ts: e.ts, type: e.type, data: e.data })),
          position: {
            is_open: false,
            size_pct: 0.0,
            avg_price: null,
            stop_price: null,
            unrealized_pnl_pct: null,
          },
        });
        continue; // Move to next candle
      }

      // TARGETS check (only if still in position)
      if (inPos && nextTargetI < targets.length) {
        while (nextTargetI < targets.length) {
          const t = targets[nextTargetI];
          const tProfit = t.profit_pct;
          const tSize = t.size_pct;
          const tPrice = entryPrice * (1.0 + tProfit / 100.0);

          if (c.h >= tPrice && sizeLeft > 0) {
            emit(i, 'TARGET_HIT', { target_index: nextTargetI, target_price: tPrice });
            const exitSize = Math.min(tSize, sizeLeft);
            const fill = tPrice * sellMult;
            emit(i, 'PARTIAL_EXIT', {
              size_pct: exitSize,
              fill_price: fill,
              reason: `target_${nextTargetI}`,
            });
            sizeLeft -= exitSize;
            if (!firstTargetHit) {
              firstTargetHit = true;
              if (beAfterFirst && stopPrice !== null) {
                const newStop = Math.max(stopPrice, entryPrice);
                if (newStop !== stopPrice) {
                  stopPrice = newStop;
                  emit(i, 'STOP_MOVED', {
                    stop_price: stopPrice,
                    reason: 'break_even_after_first_target',
                  });
                }
              }
            }
            nextTargetI++;
            continue;
          }
          break;
        }
      }

      // If position fully exited by targets
      if (inPos && sizeLeft <= 0.000001) {
        // treat as full exit at last target fill price approximated by decision price
        emit(i, 'EXIT_FULL', { reason: 'targets_done' });
        // choose last fill as entry_price*(1+profit of last target) * sell_mult
        const lastProfit =
          targets.length > 0
            ? targets[Math.min(targets.length - 1, Math.max(0, nextTargetI - 1))].profit_pct
            : 0.0;
        const fill = entryPrice * (1.0 + lastProfit / 100.0) * sellMult;
        const pnl = ((fill - entryPrice) / entryPrice) * 100.0;
        trades.push({
          trade_id: `trade_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          token,
          entry_ts: entryTs!,
          exit_ts: c.ts,
          entry_price: entryPrice,
          exit_price: fill,
          pnl_pct: pnl,
          exit_reason: 'targets_done',
          size_pct_initial: 100.0,
        });
        inPos = false;
        sizeLeft = 0.0;
        // Skip remaining checks for this candle
        frames.push({
          seq: i,
          candle: { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v },
          events: events
            .filter((e) => e.candle_index === i)
            .map((e) => ({ ts: e.ts, type: e.type, data: e.data })),
          position: {
            is_open: false,
            size_pct: 0.0,
            avg_price: null,
            stop_price: null,
            unrealized_pnl_pct: null,
          },
        });
        continue; // Move to next candle
      }

      // TIME EXIT (end of candle)
      if (inPos && timeExitEnabled && entryIdx !== null) {
        const age = i - entryIdx;
        if (age >= maxCandlesInTrade) {
          const fill = decisionPrice(c, fillModel) * sellMult;
          emit(i, 'EXIT_FULL', { reason: 'time_exit' });
          const pnl = ((fill - entryPrice) / entryPrice) * 100.0;
          trades.push({
            trade_id: `trade_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
            token,
            entry_ts: entryTs!,
            exit_ts: c.ts,
            entry_price: entryPrice,
            exit_price: fill,
            pnl_pct: pnl,
            exit_reason: 'time_exit',
            size_pct_initial: 100.0,
          });
          inPos = false;
          sizeLeft = 0.0;
          // Skip remaining checks for this candle
          frames.push({
            seq: i,
            candle: { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v },
            events: events
              .filter((e) => e.candle_index === i)
              .map((e) => ({ ts: e.ts, type: e.type, data: e.data })),
            position: {
              is_open: false,
              size_pct: 0.0,
              avg_price: null,
              stop_price: null,
              unrealized_pnl_pct: null,
            },
          });
          continue; // Move to next candle
        }
      }
    }

    // Build replay frame for this candle (only if we didn't exit this candle)
    // Collect events for this candle only
    const evsHere = events.filter((e) => e.candle_index === i);
    frames.push({
      seq: i,
      candle: { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v },
      events: evsHere.map((e) => ({ ts: e.ts, type: e.type, data: e.data })),
      position: posSnapshot(i),
    });
  }

  // End-of-data forced exit
  if (inPos) {
    const lastI = candles.length - 1;
    const c = candles[lastI];
    const fill = decisionPrice(c, fillModel) * sellMult;
    emit(lastI, 'EXIT_FULL', { reason: 'end_of_data' });
    const pnl = ((fill - entryPrice) / entryPrice) * 100.0;
    trades.push({
      trade_id: `trade_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      token,
      entry_ts: entryTs || candles[entryIdx || 0].ts,
      exit_ts: c.ts,
      entry_price: entryPrice,
      exit_price: fill,
      pnl_pct: pnl,
      exit_reason: 'end_of_data',
      size_pct_initial: 100.0,
    });
    // also update final frame events list
    const lastFrameEvents = events.filter((e) => e.candle_index === lastI);
    frames[lastI].events = lastFrameEvents.map((e) => ({ ts: e.ts, type: e.type, data: e.data }));
    frames[lastI].position = {
      is_open: false,
      size_pct: 0.0,
      avg_price: null,
      stop_price: null,
      unrealized_pnl_pct: null,
    };
  }

  // Summary
  const wins = trades.filter((t) => t.pnl_pct > 0).length;
  const summary: SimulationSummary = {
    token,
    trades: trades.length,
    win_rate: trades.length > 0 ? wins / trades.length : 0.0,
    avg_pnl_pct:
      trades.length > 0 ? trades.reduce((sum, t) => sum + t.pnl_pct, 0) / trades.length : 0.0,
  };

  return { summary, trades, events, frames };
}
