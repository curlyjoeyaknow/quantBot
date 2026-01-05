"""
Summary statistics and caller aggregation.

Provides functions to compute overall metrics and per-caller leaderboards
for both baseline and TP/SL backtests.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Any, Dict, List, Optional

from .helpers import fmt_value


# =============================================================================
# Baseline Summary
# =============================================================================

def summarize_baseline(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compute overall summary metrics for baseline backtest results.

    Args:
        rows: List of per-alert result dicts

    Returns:
        Summary dict with aggregated metrics
    """
    ok = [r for r in rows if r.get("status") == "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = r.get(field)
            if v is not None and isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def pct_hit(field: str) -> float:
        if not ok:
            return 0.0
        return sum(1 for r in ok if r.get(field) is not None) / len(ok)

    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]

    ath = take("ath_mult")
    t2x = take("time_to_2x_s")
    t3x = take("time_to_3x_s")
    t4x = take("time_to_4x_s")

    dd_initial = take("dd_initial")
    dd_overall = take("dd_overall")
    dd_after_2x = take("dd_after_2x")
    dd_after_ath = take("dd_after_ath")

    peak_pnl = take("peak_pnl_pct")
    ret_end = take("ret_end_pct")

    return {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(rows) - len(ok),

        "median_ath_mult": med(ath),
        "p25_ath_mult": percentile(ath, 0.25),
        "p75_ath_mult": percentile(ath, 0.75),

        "pct_hit_2x": pct_hit("time_to_2x_s"),
        "pct_hit_3x": pct_hit("time_to_3x_s"),
        "pct_hit_4x": pct_hit("time_to_4x_s"),
        "pct_hit_5x": pct_hit("time_to_5x_s"),
        "pct_hit_10x": pct_hit("time_to_10x_s"),

        "median_time_to_2x_s": med(t2x),
        "median_time_to_3x_s": med(t3x),
        "median_time_to_4x_s": med(t4x),

        "median_dd_initial": med(dd_initial),
        "median_dd_overall": med(dd_overall),
        "median_dd_after_2x": med(dd_after_2x),
        "median_dd_after_ath": med(dd_after_ath),

        "median_peak_pnl_pct": med(peak_pnl),
        "median_ret_end_pct": med(ret_end),
    }


# =============================================================================
# TP/SL Summary
# =============================================================================

def summarize_tp_sl(
    rows: List[Dict[str, Any]],
    sl_mult: float = 0.5,
    risk_per_trade: float = 0.02,
) -> Dict[str, Any]:
    """
    Compute overall summary metrics for TP/SL backtest results.

    Args:
        rows: List of per-alert result dicts
        sl_mult: Stop-loss multiplier used (e.g., 0.5 for -50%)
        risk_per_trade: Maximum risk per trade as fraction of portfolio (e.g., 0.02 for 2%)

    Returns:
        Summary dict with aggregated metrics including TP/SL stats and risk-adjusted returns
    """
    ok = [r for r in rows if r.get("status") == "ok"]
    missing = [r for r in rows if r.get("status") != "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = r.get(field)
            if v is None:
                continue
            if isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def fmt_med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    ath = take("ath_mult")
    dd_initial = take("dd_initial")
    dd = take("dd_overall")
    ret_end = take("ret_end")
    peak_pnl = take("peak_pnl_pct")
    t2x = [float(r["time_to_2x_s"]) for r in ok if r.get("time_to_2x_s") is not None]
    t4x = [float(r["time_to_4x_s"]) for r in ok if r.get("time_to_4x_s") is not None]
    dd_after_2x = take("dd_after_2x")
    dd_after_3x = take("dd_after_3x")

    def fmt_pct_hit(field: str) -> float:
        if not ok:
            return 0.0
        hit = sum(1 for r in ok if r.get(field) is not None)
        return hit / len(ok)

    tp_sl_returns = take("tp_sl_ret")
    wins = [r for r in ok if r.get("tp_sl_ret", 0) > 0]
    losses = [r for r in ok if r.get("tp_sl_ret", 0) < 0]

    # Raw returns (100% position size per trade)
    total_return_pct = sum(tp_sl_returns) * 100 if tp_sl_returns else 0.0
    avg_return_pct = (sum(tp_sl_returns) / len(tp_sl_returns) * 100) if tp_sl_returns else 0.0

    win_rate = len(wins) / len(ok) if ok else 0.0
    avg_win = (sum(r.get("tp_sl_ret", 0) for r in wins) / len(wins) * 100) if wins else 0.0
    avg_loss = (sum(r.get("tp_sl_ret", 0) for r in losses) / len(losses) * 100) if losses else 0.0

    gross_profit = sum(r.get("tp_sl_ret", 0) for r in wins)
    gross_loss = abs(sum(r.get("tp_sl_ret", 0) for r in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    expectancy_pct = avg_return_pct

    # ==========================================================================
    # Risk-adjusted returns (position sized based on SL and risk limit)
    # ==========================================================================
    #
    # Position sizing formula:
    #   position_size = risk_per_trade / max_loss_fraction
    #   max_loss_fraction = 1 - sl_mult (e.g., for sl_mult=0.5, max loss = 50%)
    #
    # Example: 2% risk, 50% SL → position_size = 0.02 / 0.50 = 4% of portfolio
    #
    # Risk-adjusted return per trade = raw_return × position_size
    # This gives portfolio-level returns, not position-level returns.
    #
    # Note: We do NOT compound - each trade is sized based on starting portfolio.
    # ==========================================================================

    max_loss_fraction = 1.0 - sl_mult  # e.g., 1.0 - 0.5 = 0.5 (50% loss)
    if max_loss_fraction <= 0:
        max_loss_fraction = 0.5  # Fallback if sl_mult >= 1

    position_size = risk_per_trade / max_loss_fraction

    # Risk-adjusted returns (portfolio-level, non-compounding)
    risk_adj_returns = [ret * position_size for ret in tp_sl_returns]
    risk_adj_total_return_pct = sum(risk_adj_returns) * 100 if risk_adj_returns else 0.0
    risk_adj_avg_return_pct = (sum(risk_adj_returns) / len(risk_adj_returns) * 100) if risk_adj_returns else 0.0

    # Risk-adjusted win/loss
    risk_adj_wins = [ret * position_size for ret in tp_sl_returns if ret > 0]
    risk_adj_losses = [ret * position_size for ret in tp_sl_returns if ret < 0]
    risk_adj_avg_win_pct = (sum(risk_adj_wins) / len(risk_adj_wins) * 100) if risk_adj_wins else 0.0
    risk_adj_avg_loss_pct = (sum(risk_adj_losses) / len(risk_adj_losses) * 100) if risk_adj_losses else 0.0

    # ==========================================================================
    # R-Multiple calculations (the KEY metric for position sizing)
    # ==========================================================================
    #
    # R = risk unit = what you risk per trade (e.g., 2% of portfolio)
    #
    # For TP/SL strategy:
    #   R_per_win = (tp_mult - 1) / (1 - sl_mult)
    #   R_per_loss = -1 (by definition)
    #
    # Example: TP=3x, SL=0.5x
    #   R_per_win = (3-1) / (1-0.5) = 2 / 0.5 = 4R
    #   R_per_loss = -1R
    #
    # Expectancy_R = (win_rate × R_per_win) + (loss_rate × -1)
    # Total_R = expectancy_R × n_trades
    # ==========================================================================

    # We need tp_mult to calculate R - extract from the actual returns
    # For wins: tp_sl_ret = tp_mult - 1 (minus fees)
    # For losses: tp_sl_ret ≈ sl_mult - 1 (minus fees)
    
    # Calculate R multiples from actual returns
    r_multiples = []
    for ret in tp_sl_returns:
        # Convert return to R-multiple
        # R = return / max_loss_fraction
        r_mult = ret / max_loss_fraction
        r_multiples.append(r_mult)
    
    total_r = sum(r_multiples) if r_multiples else 0.0
    avg_r = (total_r / len(r_multiples)) if r_multiples else 0.0
    
    # Separate winners and losers in R terms
    r_wins = [r for r in r_multiples if r > 0]
    r_losses = [r for r in r_multiples if r <= 0]
    avg_r_win = (sum(r_wins) / len(r_wins)) if r_wins else 0.0
    avg_r_loss = (sum(r_losses) / len(r_losses)) if r_losses else 0.0
    
    # R-based profit factor
    sum_r_wins = sum(r_wins) if r_wins else 0.0
    sum_r_losses = abs(sum(r_losses)) if r_losses else 0.0
    r_profit_factor = sum_r_wins / sum_r_losses if sum_r_losses > 0 else (float("inf") if sum_r_wins > 0 else 0.0)

    # Percentiles for ATH (for objective function tail bonus)
    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]
    
    p75_ath = percentile(ath, 0.75)
    p95_ath = percentile(ath, 0.95)
    
    # DD before 2x (for objective function penalty)
    # dd_pre2x = drawdown from entry before hitting 2x
    # We use dd_initial as proxy (drawdown from initial entry)
    dd_pre2x = take("dd_pre2x") if any(r.get("dd_pre2x") is not None for r in ok) else dd_initial
    dd_pre2x_median = fmt_med(dd_pre2x) if dd_pre2x else fmt_med(dd_initial)
    
    # Time to 2x in minutes (for objective function timing boost)
    time_to_2x_median_min = (fmt_med(t2x) / 60.0) if t2x and fmt_med(t2x) else None
    
    return {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(missing),
        "median_ath_mult": fmt_med(ath),
        "median_time_to_2x_s": fmt_med(t2x),
        "median_time_to_4x_s": fmt_med(t4x),
        "median_dd_initial": fmt_med(dd_initial),
        "median_dd_overall": fmt_med(dd),
        "median_dd_after_2x": fmt_med(dd_after_2x),
        "median_dd_after_3x": fmt_med(dd_after_3x),
        "median_peak_pnl_pct": fmt_med(peak_pnl),
        "median_ret_end": fmt_med(ret_end),
        "pct_hit_2x": fmt_pct_hit("time_to_2x_s"),
        "pct_hit_4x": fmt_pct_hit("time_to_4x_s"),
        # Objective function metrics
        "dd_pre2x_median": dd_pre2x_median,
        "time_to_2x_median_min": time_to_2x_median_min,
        "p75_ath": p75_ath,
        "p95_ath": p95_ath,
        # Raw returns (100% position size)
        "tp_sl_total_return_pct": total_return_pct,
        "tp_sl_avg_return_pct": avg_return_pct,
        "tp_sl_win_rate": win_rate,
        "tp_sl_avg_win_pct": avg_win,
        "tp_sl_avg_loss_pct": avg_loss,
        "tp_sl_profit_factor": profit_factor,
        "tp_sl_expectancy_pct": expectancy_pct,
        # Risk-adjusted returns (position sized for risk limit)
        "risk_per_trade_pct": risk_per_trade * 100,
        "position_size_pct": position_size * 100,
        "risk_adj_total_return_pct": risk_adj_total_return_pct,
        "risk_adj_avg_return_pct": risk_adj_avg_return_pct,
        "risk_adj_avg_win_pct": risk_adj_avg_win_pct,
        "risk_adj_avg_loss_pct": risk_adj_avg_loss_pct,
        # R-multiple metrics (the KEY for position sizing)
        "total_r": total_r,
        "avg_r": avg_r,
        "avg_r_win": avg_r_win,
        "avg_r_loss": avg_r_loss,
        "r_profit_factor": r_profit_factor,
    }


# =============================================================================
# Caller Aggregation
# =============================================================================

def aggregate_by_caller(
    rows: List[Dict[str, Any]],
    min_trades: int = 5,
    sl_mult: float = 0.5,
    risk_per_trade: float = 0.02,
) -> List[Dict[str, Any]]:
    """
    Aggregate backtest results by caller for leaderboard.

    Args:
        rows: List of per-alert result dicts
        min_trades: Minimum trades to include a caller
        sl_mult: Stop-loss multiplier used (for risk-adjusted calculations)
        risk_per_trade: Maximum risk per trade as fraction of portfolio

    Returns:
        List of caller summary dicts, sorted by risk-adjusted total return
    """
    ok = [r for r in rows if r.get("status") == "ok" and (r.get("caller") or "").strip()]

    by_caller: Dict[str, List[Dict[str, Any]]] = {}
    for r in ok:
        caller = (r.get("caller") or "").strip()
        by_caller.setdefault(caller, []).append(r)

    def take(rlist: List[Dict[str, Any]], field: str) -> List[float]:
        xs = []
        for r in rlist:
            v = r.get(field)
            if v is not None and isinstance(v, (int, float)) and not math.isnan(v):
                xs.append(float(v))
        return xs

    def med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def percentile(xs: List[float], p: float) -> Optional[float]:
        if not xs:
            return None
        s = sorted(xs)
        idx = int(len(s) * p)
        return s[min(idx, len(s) - 1)]

    def pct_hit(rlist: List[Dict[str, Any]], field: str) -> float:
        if not rlist:
            return 0.0
        return sum(1 for r in rlist if r.get(field) is not None) / len(rlist)

    # Calculate position size for risk-adjusted returns
    max_loss_fraction = 1.0 - sl_mult
    if max_loss_fraction <= 0:
        max_loss_fraction = 0.5
    position_size = risk_per_trade / max_loss_fraction

    results: List[Dict[str, Any]] = []
    for caller, rlist in by_caller.items():
        if len(rlist) < int(min_trades):
            continue

        ath = take(rlist, "ath_mult")
        dd_initial = take(rlist, "dd_initial")
        dd_overall = take(rlist, "dd_overall")
        # Granular DD tier metrics
        dd_pre_1_2x = take(rlist, "dd_pre_1_2x")
        dd_pre_1_5x = take(rlist, "dd_pre_1_5x")
        dd_pre2x = take(rlist, "dd_pre2x")
        dd_band_1_2x_to_1_5x = take(rlist, "dd_band_1_2x_to_1_5x")
        dd_band_1_5x_to_2x = take(rlist, "dd_band_1_5x_to_2x")
        dd_after_2x = take(rlist, "dd_after_2x")
        dd_after_3x = take(rlist, "dd_after_3x")
        dd_after_ath = take(rlist, "dd_after_ath")
        peak_pnl = take(rlist, "peak_pnl_pct")
        ret_end = take(rlist, "ret_end_pct")
        # Granular time to tier metrics
        t_1_2x = take(rlist, "time_to_1_2x_s")
        t_1_5x = take(rlist, "time_to_1_5x_s")
        t2x = take(rlist, "time_to_2x_s")

        # Compute dd_pre2x_or_horizon: for each alert, use dd_pre2x if 2x was hit,
        # otherwise use dd_overall (the horizon DD). This ensures all alerts contribute.
        dd_pre2x_or_horizon: List[float] = []
        for r in rlist:
            if r.get("dd_pre2x") is not None:
                v = r.get("dd_pre2x")
                if isinstance(v, (int, float)) and not math.isnan(v):
                    dd_pre2x_or_horizon.append(float(v))
            elif r.get("dd_overall") is not None:
                v = r.get("dd_overall")
                if isinstance(v, (int, float)) and not math.isnan(v):
                    dd_pre2x_or_horizon.append(float(v))

        # TP/SL returns for this caller
        tp_sl_returns = take(rlist, "tp_sl_ret")
        wins = [r for r in rlist if (r.get("tp_sl_ret") or 0) > 0]
        losses = [r for r in rlist if (r.get("tp_sl_ret") or 0) < 0]

        # Raw TP/SL stats
        total_return = sum(tp_sl_returns) if tp_sl_returns else 0.0
        avg_return = (total_return / len(tp_sl_returns)) if tp_sl_returns else 0.0
        win_rate = len(wins) / len(rlist) if rlist else 0.0
        avg_win = (sum(r.get("tp_sl_ret", 0) for r in wins) / len(wins)) if wins else 0.0
        avg_loss = (sum(r.get("tp_sl_ret", 0) for r in losses) / len(losses)) if losses else 0.0

        gross_profit = sum(r.get("tp_sl_ret", 0) for r in wins)
        gross_loss = abs(sum(r.get("tp_sl_ret", 0) for r in losses))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

        # Risk-adjusted returns
        risk_adj_total = total_return * position_size
        risk_adj_avg = avg_return * position_size

        results.append({
            "caller": caller,
            "n": len(rlist),
            "median_ath": med(ath),
            "p25_ath": percentile(ath, 0.25),
            "p75_ath": percentile(ath, 0.75),
            "p95_ath": percentile(ath, 0.95),
            "hit2x_pct": pct_hit(rlist, "time_to_2x_s") * 100,
            "hit3x_pct": pct_hit(rlist, "time_to_3x_s") * 100,
            "hit4x_pct": pct_hit(rlist, "time_to_4x_s") * 100,
            "hit5x_pct": pct_hit(rlist, "time_to_5x_s") * 100,
            "hit10x_pct": pct_hit(rlist, "time_to_10x_s") * 100,
            # Time to tier metrics (granular)
            "median_t_1_2x_min": (med(t_1_2x) / 60.0) if med(t_1_2x) is not None else None,
            "median_t_1_5x_min": (med(t_1_5x) / 60.0) if med(t_1_5x) is not None else None,
            "median_t2x_hrs": (med(t2x) / 3600.0) if med(t2x) is not None else None,
            # Hit rates for granular tiers
            "hit_1_2x_pct": pct_hit(rlist, "time_to_1_2x_s") * 100,
            "hit_1_5x_pct": pct_hit(rlist, "time_to_1_5x_s") * 100,
            # DD metrics (granular tiers)
            "median_dd_initial_pct": (med(dd_initial) * 100.0) if med(dd_initial) is not None else None,
            "median_dd_overall_pct": (med(dd_overall) * 100.0) if med(dd_overall) is not None else None,
            # DD before each tier (from entry price)
            "median_dd_pre_1_2x_pct": (med(dd_pre_1_2x) * 100.0) if med(dd_pre_1_2x) is not None else None,
            "median_dd_pre_1_5x_pct": (med(dd_pre_1_5x) * 100.0) if med(dd_pre_1_5x) is not None else None,
            "median_dd_pre2x_pct": (med(dd_pre2x) * 100.0) if med(dd_pre2x) is not None else None,
            "median_dd_pre2x_or_horizon_pct": (med(dd_pre2x_or_horizon) * 100.0) if med(dd_pre2x_or_horizon) is not None else None,
            # DD in tier bands (from tier's price level)
            "median_dd_band_1_2x_to_1_5x_pct": (med(dd_band_1_2x_to_1_5x) * 100.0) if med(dd_band_1_2x_to_1_5x) is not None else None,
            "median_dd_band_1_5x_to_2x_pct": (med(dd_band_1_5x_to_2x) * 100.0) if med(dd_band_1_5x_to_2x) is not None else None,
            "median_dd_after_2x_pct": (med(dd_after_2x) * 100.0) if med(dd_after_2x) is not None else None,
            "median_dd_after_3x_pct": (med(dd_after_3x) * 100.0) if med(dd_after_3x) is not None else None,
            "median_dd_after_ath_pct": (med(dd_after_ath) * 100.0) if med(dd_after_ath) is not None else None,
            "worst_dd_pct": (min(dd_overall) * 100.0) if dd_overall else None,
            "median_peak_pnl_pct": med(peak_pnl),
            "median_ret_end_pct": med(ret_end),
            # TP/SL raw stats
            "tp_sl_total_return_pct": total_return * 100,
            "tp_sl_avg_return_pct": avg_return * 100,
            "tp_sl_win_rate": win_rate * 100,
            "tp_sl_avg_win_pct": avg_win * 100,
            "tp_sl_avg_loss_pct": avg_loss * 100,
            "tp_sl_profit_factor": profit_factor,
            # Risk-adjusted returns
            "risk_adj_total_return_pct": risk_adj_total * 100,
            "risk_adj_avg_return_pct": risk_adj_avg * 100,
        })

    # Sort by risk-adjusted total return (most profitable callers first)
    results.sort(key=lambda x: (x.get("risk_adj_total_return_pct") or 0.0), reverse=True)
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results


def print_caller_leaderboard(
    callers: List[Dict[str, Any]],
    limit: int = 30,
    show_risk_adjusted: bool = True,
) -> None:
    """
    Print a formatted caller leaderboard table.

    Args:
        callers: List of caller summary dicts
        limit: Max callers to show
        show_risk_adjusted: Whether to show risk-adjusted returns columns
    """
    import sys

    if not callers:
        print("No callers with enough trades.", file=sys.stderr)
        return

    # Base headers
    headers = [
        ("rank", "int"),
        ("caller", "str"),
        ("n", "int"),
    ]

    # Add risk-adjusted columns if available
    if show_risk_adjusted and callers and "risk_adj_total_return_pct" in callers[0]:
        headers.extend([
            ("risk_adj_total_return_pct", "pct"),
            ("tp_sl_win_rate", "pct"),
            ("tp_sl_profit_factor", "num"),
        ])

    headers.extend([
        ("median_ath", "x"),
        ("hit2x_pct", "pct"),
        ("hit4x_pct", "pct"),
        ("median_dd_overall_pct", "pct"),
    ])

    col_widths: Dict[str, int] = {k: max(len(k), 8) for k, _ in headers}

    for r in callers[:limit]:
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()
                col_widths[key] = max(col_widths[key], min(24, len(v)))
            else:
                txt = fmt_value(r.get(key), kind)
                col_widths[key] = max(col_widths[key], len(txt))

    line = "  ".join(k.ljust(col_widths[k]) for k, _ in headers)
    print(line)
    print("-" * len(line))

    for r in callers[:limit]:
        parts = []
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()[: col_widths[key]]
                parts.append(v.ljust(col_widths[key]))
            else:
                txt = fmt_value(r.get(key), kind)
                parts.append(txt.rjust(col_widths[key]))
        print("  ".join(parts))


def print_caller_returns_table(
    callers: List[Dict[str, Any]],
    limit: int = 30,
) -> None:
    """
    Print a detailed per-caller returns table.

    Args:
        callers: List of caller summary dicts
        limit: Max callers to show
    """
    import sys

    if not callers:
        print("No callers with enough trades.", file=sys.stderr)
        return

    headers = [
        ("rank", "int"),
        ("caller", "str"),
        ("n", "int"),
        ("risk_adj_total_return_pct", "pct"),
        ("risk_adj_avg_return_pct", "pct"),
        ("tp_sl_win_rate", "pct"),
        ("tp_sl_avg_win_pct", "pct"),
        ("tp_sl_avg_loss_pct", "pct"),
        ("tp_sl_profit_factor", "num"),
    ]

    col_widths: Dict[str, int] = {k: max(len(k), 8) for k, _ in headers}

    for r in callers[:limit]:
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()
                col_widths[key] = max(col_widths[key], min(24, len(v)))
            else:
                txt = fmt_value(r.get(key), kind)
                col_widths[key] = max(col_widths[key], len(txt))

    line = "  ".join(k.ljust(col_widths[k]) for k, _ in headers)
    print(line)
    print("-" * len(line))

    for r in callers[:limit]:
        parts = []
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()[: col_widths[key]]
                parts.append(v.ljust(col_widths[key]))
            else:
                txt = fmt_value(r.get(key), kind)
                parts.append(txt.rjust(col_widths[key]))
        print("  ".join(parts))

