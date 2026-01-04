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

def summarize_tp_sl(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compute overall summary metrics for TP/SL backtest results.

    Args:
        rows: List of per-alert result dicts

    Returns:
        Summary dict with aggregated metrics including TP/SL stats
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

    total_return_pct = sum(tp_sl_returns) * 100 if tp_sl_returns else 0.0
    avg_return_pct = (sum(tp_sl_returns) / len(tp_sl_returns) * 100) if tp_sl_returns else 0.0

    win_rate = len(wins) / len(ok) if ok else 0.0
    avg_win = (sum(r.get("tp_sl_ret", 0) for r in wins) / len(wins) * 100) if wins else 0.0
    avg_loss = (sum(r.get("tp_sl_ret", 0) for r in losses) / len(losses) * 100) if losses else 0.0

    gross_profit = sum(r.get("tp_sl_ret", 0) for r in wins)
    gross_loss = abs(sum(r.get("tp_sl_ret", 0) for r in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    expectancy_pct = avg_return_pct

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
        "tp_sl_total_return_pct": total_return_pct,
        "tp_sl_avg_return_pct": avg_return_pct,
        "tp_sl_win_rate": win_rate,
        "tp_sl_avg_win_pct": avg_win,
        "tp_sl_avg_loss_pct": avg_loss,
        "tp_sl_profit_factor": profit_factor,
        "tp_sl_expectancy_pct": expectancy_pct,
    }


# =============================================================================
# Caller Aggregation
# =============================================================================

def aggregate_by_caller(
    rows: List[Dict[str, Any]],
    min_trades: int = 5,
) -> List[Dict[str, Any]]:
    """
    Aggregate backtest results by caller for leaderboard.

    Args:
        rows: List of per-alert result dicts
        min_trades: Minimum trades to include a caller

    Returns:
        List of caller summary dicts, sorted by median ATH
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

    results: List[Dict[str, Any]] = []
    for caller, rlist in by_caller.items():
        if len(rlist) < int(min_trades):
            continue

        ath = take(rlist, "ath_mult")
        dd_initial = take(rlist, "dd_initial")
        dd_overall = take(rlist, "dd_overall")
        dd_after_2x = take(rlist, "dd_after_2x")
        dd_after_ath = take(rlist, "dd_after_ath")
        peak_pnl = take(rlist, "peak_pnl_pct")
        ret_end = take(rlist, "ret_end_pct")
        t2x = take(rlist, "time_to_2x_s")

        results.append({
            "caller": caller,
            "n": len(rlist),
            "median_ath": med(ath),
            "p25_ath": percentile(ath, 0.25),
            "p75_ath": percentile(ath, 0.75),
            "hit2x_pct": pct_hit(rlist, "time_to_2x_s") * 100,
            "hit3x_pct": pct_hit(rlist, "time_to_3x_s") * 100,
            "hit4x_pct": pct_hit(rlist, "time_to_4x_s") * 100,
            "hit5x_pct": pct_hit(rlist, "time_to_5x_s") * 100,
            "hit10x_pct": pct_hit(rlist, "time_to_10x_s") * 100,
            "median_t2x_hrs": (med(t2x) / 3600.0) if med(t2x) is not None else None,
            "median_dd_initial_pct": (med(dd_initial) * 100.0) if med(dd_initial) is not None else None,
            "median_dd_overall_pct": (med(dd_overall) * 100.0) if med(dd_overall) is not None else None,
            "median_dd_after_2x_pct": (med(dd_after_2x) * 100.0) if med(dd_after_2x) is not None else None,
            "median_dd_after_ath_pct": (med(dd_after_ath) * 100.0) if med(dd_after_ath) is not None else None,
            "worst_dd_pct": (min(dd_overall) * 100.0) if dd_overall else None,
            "median_peak_pnl_pct": med(peak_pnl),
            "median_ret_end_pct": med(ret_end),
        })

    results.sort(key=lambda x: (x.get("median_ath") or 0.0), reverse=True)
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results


def print_caller_leaderboard(
    callers: List[Dict[str, Any]],
    limit: int = 30,
) -> None:
    """
    Print a formatted caller leaderboard table.

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
        ("median_ath", "x"),
        ("hit2x_pct", "pct"),
        ("hit3x_pct", "pct"),
        ("hit4x_pct", "pct"),
        ("median_t2x_hrs", "hrs"),
        ("median_dd_initial_pct", "pct"),
        ("median_dd_overall_pct", "pct"),
        ("median_peak_pnl_pct", "pct"),
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

