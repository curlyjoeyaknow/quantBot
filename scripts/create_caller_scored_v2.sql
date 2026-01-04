-- Creates baseline.caller_scored_v2
-- Scoring philosophy: "who delivers fast 2x with controlled pre-2x pain"
-- Not "who got lucky tails"
--
-- Key design choices:
-- 1. Risk penalty uses median_dd_pre2x_or_horizon (not just dd_pre2x)
--    Because dd_pre2x is undefined for non-2x alerts. If you only punish dd_pre2x,
--    callers who rarely hit 2x dodge the risk penalty entirely.
-- 2. Penalty is exponential after 30% drawdown magnitude
--    31-35% hurts a bit, 40% hurts a lot, 60% is basically disqualification.
--
-- === Tunables ===
-- Risk penalty:
--   - threshold at 30% DD magnitude
--   - exponential rate 15 makes 60% essentially impossible
-- Timing boost:
--   - exp(-t/60m) -> fast gets big boost, slow decays
-- Synergy:
--   - big bump for hit2x >= 50% AND dd <= 30%
-- Tail:
--   - rewards fat right tail without letting it dominate

CREATE SCHEMA IF NOT EXISTS baseline;

-- The view uses dynamic computation for p95_ath since some older databases may not have it.
-- We compute p95_ath from alert_results_f directly in the view for maximum compatibility.

CREATE OR REPLACE VIEW baseline.caller_scored_v2 AS
WITH caller_ath_stats AS (
  -- Compute p75 and p95 ATH directly from alert_results_f for reliability
  SELECT
    run_id,
    caller,
    quantile_cont(ath_mult, 0.75) AS p75_ath_computed,
    quantile_cont(ath_mult, 0.95) AS p95_ath_computed
  FROM baseline.alert_results_f
  WHERE status = 'ok' AND caller IS NOT NULL AND caller <> ''
  GROUP BY run_id, caller
),
src AS (
  SELECT
    s.run_id,
    s.caller,
    s.n,

    s.median_ath,
    COALESCE(a.p75_ath_computed, s.p75_ath, s.median_ath * 1.3) AS p75_ath,
    COALESCE(a.p95_ath_computed, s.p75_ath * 1.3, s.median_ath * 1.8) AS p95_ath,

    s.hit2x_pct,
    s.hit3x_pct,
    s.hit4x_pct,
    s.hit5x_pct,

    s.median_t2x_hrs,

    -- Prefer "pre2x_or_horizon" because it exists even when 2x is never hit.
    COALESCE(s.median_dd_pre2x_or_horizon_pct, s.median_dd_pre2x_pct, s.median_dd_overall_pct) AS risk_dd_pct,
    s.median_dd_pre2x_pct,
    s.median_dd_pre2x_or_horizon_pct

  FROM baseline.caller_stats_f s
  LEFT JOIN caller_ath_stats a ON s.run_id = a.run_id AND s.caller = a.caller
),
feat AS (
  SELECT
    *,
    -- Convert dd pct (-63.8) -> magnitude as decimal (0.638)
    GREATEST(0.0, -COALESCE(risk_dd_pct, 0.0) / 100.0) AS risk_mag,

    -- Convert median_t2x_hrs to minutes for nicer intuition
    CASE
      WHEN median_t2x_hrs IS NULL THEN NULL
      ELSE median_t2x_hrs * 60.0
    END AS median_t2x_min,

    -- Base upside: median edge times hit-rate
    (GREATEST(COALESCE(median_ath, 1.0) - 1.0, 0.0) * (COALESCE(hit2x_pct, 0.0) / 100.0)) AS base_upside,

    -- Tail bonus: reward p75 & p95 above median (fat right tail)
    (0.15 * GREATEST(COALESCE(p75_ath, median_ath) - COALESCE(median_ath, 1.0), 0.0))
    + (0.10 * GREATEST(COALESCE(p95_ath, p75_ath) - COALESCE(p75_ath, median_ath), 0.0)) AS tail_bonus,

    -- Fast 2x boost in [0..1], only when median_t2x exists
    CASE
      WHEN median_t2x_hrs IS NULL THEN 0.0
      ELSE exp(-(median_t2x_hrs * 60.0) / 60.0)  -- exp(-t_minutes/60)
    END AS fast2x_signal,

    -- Confidence shrink so small-ish samples don't dominate
    sqrt(n * 1.0 / (n + 50.0)) AS confidence

  FROM src
),
pen AS (
  SELECT
    *,
    -- Exponential penalty once risk_mag exceeds 30%
    -- At 40%: exp(15*(0.10)) - 1  ≈ 3.48
    -- At 60%: exp(15*(0.30)) - 1  ≈ 89
    CASE
      WHEN risk_mag <= 0.30 THEN 0.0
      ELSE exp(15.0 * (risk_mag - 0.30)) - 1.0
    END AS risk_penalty,

    -- Synergy bonus: your "obvious huge boost" condition
    CASE
      WHEN COALESCE(hit2x_pct, 0.0) >= 50.0 AND risk_mag <= 0.30 THEN 0.60
      ELSE 0.0
    END AS discipline_bonus
  FROM feat
),
score AS (
  SELECT
    *,
    -- Timing multiplier: max ~ +80% lift when ultra-fast, fades with time
    (1.0 + 0.80 * fast2x_signal) AS timing_mult,

    -- Final score:
    -- Upside (base + tails) * timing_mult + discipline_bonus - BIG exponential risk penalty
    confidence
      * (
          ((base_upside + tail_bonus) * (1.0 + 0.80 * fast2x_signal))
          + discipline_bonus
          - (1.00 * risk_penalty)
        ) AS score_v2

  FROM pen
)
SELECT
  run_id,
  caller,
  n,

  median_ath,
  p75_ath,
  p95_ath,

  hit2x_pct,
  hit3x_pct,
  hit4x_pct,
  hit5x_pct,

  median_t2x_hrs,
  median_t2x_min,

  median_dd_pre2x_pct,
  median_dd_pre2x_or_horizon_pct,
  risk_dd_pct,
  risk_mag,

  base_upside,
  tail_bonus,
  fast2x_signal,
  discipline_bonus,
  risk_penalty,
  confidence,

  score_v2

FROM score;

-- Also create a convenience view for the leaderboard with all metrics
-- This version also computes p95 dynamically
CREATE OR REPLACE VIEW baseline.caller_leaderboard_v2 AS
WITH caller_ath_stats AS (
  SELECT
    run_id,
    caller,
    quantile_cont(ath_mult, 0.95) AS p95_ath_computed
  FROM baseline.alert_results_f
  WHERE status = 'ok' AND caller IS NOT NULL AND caller <> ''
  GROUP BY run_id, caller
)
SELECT
  s.run_id,
  s.caller,
  s.n,
  s.median_ath,
  s.p75_ath,
  COALESCE(a.p95_ath_computed, s.p75_ath * 1.3) AS p95_ath,
  s.hit2x_pct,
  s.hit3x_pct,
  s.hit4x_pct,
  s.hit5x_pct,
  s.median_t2x_hrs,
  s.median_dd_pre2x_pct,
  s.median_dd_pre2x_or_horizon_pct,
  s.median_dd_initial_pct,
  s.median_dd_overall_pct,
  s.median_dd_after_2x_pct,
  s.median_dd_after_3x_pct,
  s.median_dd_after_ath_pct,
  s.worst_dd_pct,
  s.median_peak_pnl_pct,
  s.median_ret_end_pct
FROM baseline.caller_stats_f s
LEFT JOIN caller_ath_stats a ON s.run_id = a.run_id AND s.caller = a.caller
ORDER BY s.run_id, s.median_ath DESC;
