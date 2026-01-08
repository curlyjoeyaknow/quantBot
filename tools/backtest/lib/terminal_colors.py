"""
Terminal color utilities for rich CLI output.

Provides:
- ANSI color codes for positive/negative values
- Sparkline generation for inline charts
- Histogram rendering for distributions
"""

from __future__ import annotations

import sys
from typing import List, Optional, Tuple

# =============================================================================
# ANSI COLOR CODES
# =============================================================================

class Colors:
    """ANSI escape codes for terminal colors."""
    
    # Reset
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    
    # Standard colors
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"
    GRAY = "\033[90m"
    
    # Bright colors
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    
    # Background
    BG_RED = "\033[41m"
    BG_GREEN = "\033[42m"
    BG_YELLOW = "\033[43m"
    
    @classmethod
    def is_tty(cls) -> bool:
        """Check if stdout is a terminal (supports colors)."""
        return hasattr(sys.stderr, 'isatty') and sys.stderr.isatty()


def color_enabled() -> bool:
    """Check if colors should be used."""
    return Colors.is_tty()


def c(text: str, color: str) -> str:
    """Wrap text in color codes if terminal supports it."""
    if not color_enabled():
        return text
    return f"{color}{text}{Colors.RESET}"


def bold(text: str) -> str:
    """Make text bold."""
    return c(text, Colors.BOLD)


def dim(text: str) -> str:
    """Make text dim/gray."""
    return c(text, Colors.DIM)


def red(text: str) -> str:
    """Red text (for negative/bad values)."""
    return c(text, Colors.BRIGHT_RED)


def green(text: str) -> str:
    """Green text (for positive/good values)."""
    return c(text, Colors.BRIGHT_GREEN)


def yellow(text: str) -> str:
    """Yellow text (for warnings/neutral)."""
    return c(text, Colors.BRIGHT_YELLOW)


def cyan(text: str) -> str:
    """Cyan text (for info)."""
    return c(text, Colors.CYAN)


def magenta(text: str) -> str:
    """Magenta text (for highlights)."""
    return c(text, Colors.MAGENTA)


# =============================================================================
# VALUE COLORING
# =============================================================================

def color_value(value: float, fmt: str = "+.1f", threshold: float = 0.0) -> str:
    """
    Format and color a value based on whether it's positive or negative.
    
    Args:
        value: The numeric value
        fmt: Format string (e.g., "+.1f", ".2f")
        threshold: Value below which to show as red (default 0)
    
    Returns:
        Colored formatted string
    """
    formatted = f"{value:{fmt}}"
    if value > threshold:
        return green(formatted)
    elif value < threshold:
        return red(formatted)
    else:
        return yellow(formatted)


def color_ratio(value: float, good_threshold: float = 0.40, bad_threshold: float = 0.20) -> str:
    """
    Color a ratio value (green if good, yellow if ok, red if bad).
    
    Args:
        value: Ratio value
        good_threshold: Above this is green
        bad_threshold: Below this is red
    """
    formatted = f"{value:.2f}"
    if value >= good_threshold:
        return green(formatted)
    elif value >= bad_threshold:
        return yellow(formatted)
    else:
        return red(formatted)


def color_pct(value: float, good_threshold: float = 0.50, bad_threshold: float = 0.30) -> str:
    """
    Color a percentage value.
    
    Args:
        value: Percentage as decimal (0.50 = 50%)
        good_threshold: Above this is green
        bad_threshold: Below this is red
    """
    formatted = f"{value:.0%}"
    if value >= good_threshold:
        return green(formatted)
    elif value >= bad_threshold:
        return yellow(formatted)
    else:
        return red(formatted)


def color_dd_category(category: str) -> str:
    """Color DD category based on severity."""
    cat_colors = {
        "clean": Colors.BRIGHT_GREEN,
        "acceptable": Colors.YELLOW,
        "risky": Colors.BRIGHT_YELLOW,
        "disqualified": Colors.BRIGHT_RED,
        "nuclear": Colors.BG_RED + Colors.WHITE,
    }
    color = cat_colors.get(category, Colors.WHITE)
    # Abbreviate for display
    abbrev = category[:4]
    return c(abbrev, color)


def gate_symbol(passed: bool) -> str:
    """Return colored gate pass/fail symbol."""
    if passed:
        return green("✓")
    else:
        return red("✗")


# =============================================================================
# SPARKLINES
# =============================================================================

# Unicode block characters for sparklines (1/8 to 8/8 height)
SPARK_BLOCKS = " ▁▂▃▄▅▆▇█"


def sparkline(values: List[float], width: int = 10) -> str:
    """
    Generate a sparkline from a list of values.
    
    Args:
        values: List of numeric values
        width: Target width (will sample if more values)
    
    Returns:
        Unicode sparkline string
    
    Example:
        >>> sparkline([1, 3, 7, 2, 5, 8, 4])
        '▁▂▆▂▄█▃'
    """
    if not values:
        return " " * width
    
    # Sample if too many values
    if len(values) > width:
        step = len(values) / width
        sampled = [values[int(i * step)] for i in range(width)]
    else:
        sampled = values
    
    # Handle all-same values
    min_val = min(sampled)
    max_val = max(sampled)
    
    if max_val == min_val:
        # All same value - show middle height
        return SPARK_BLOCKS[4] * len(sampled)
    
    # Normalize to 0-8 range
    spark = ""
    for v in sampled:
        normalized = (v - min_val) / (max_val - min_val)
        index = int(normalized * 8)
        index = min(8, max(0, index))  # Clamp to valid range
        spark += SPARK_BLOCKS[index]
    
    return spark


def colored_sparkline(values: List[float], width: int = 10) -> str:
    """
    Generate a sparkline with color indicating positive/negative trend.
    
    - Green if overall positive trend
    - Red if overall negative trend
    - Yellow if mixed
    """
    if not values:
        return " " * width
    
    spark = sparkline(values, width)
    
    # Determine overall trend
    positive_count = sum(1 for v in values if v > 0)
    negative_count = sum(1 for v in values if v < 0)
    
    if positive_count > len(values) * 0.6:
        return green(spark)
    elif negative_count > len(values) * 0.6:
        return red(spark)
    else:
        return yellow(spark)


def trend_sparkline(values: List[float], width: int = 8) -> str:
    """
    Generate sparkline with trend indicator.
    
    Shows sparkline + arrow indicating direction.
    """
    if len(values) < 2:
        return sparkline(values, width)
    
    spark = sparkline(values, width - 1)  # Leave room for arrow
    
    # Calculate trend
    first_half = sum(values[:len(values)//2]) / max(1, len(values)//2)
    second_half = sum(values[len(values)//2:]) / max(1, len(values) - len(values)//2)
    
    if second_half > first_half * 1.1:
        arrow = green("↗")
    elif second_half < first_half * 0.9:
        arrow = red("↘")
    else:
        arrow = yellow("→")
    
    return spark + arrow


# =============================================================================
# HISTOGRAMS
# =============================================================================

HIST_BLOCKS = "▏▎▍▌▋▊▉█"


def histogram(
    values: List[float],
    bins: int = 10,
    width: int = 40,
    height: int = 5,
    show_labels: bool = True,
) -> str:
    """
    Generate an ASCII histogram.
    
    Args:
        values: List of numeric values
        bins: Number of histogram bins
        width: Character width of histogram
        height: Number of lines for the histogram
        show_labels: Whether to show min/max labels
    
    Returns:
        Multi-line histogram string
    """
    if not values:
        return "  (no data)\n"
    
    min_val = min(values)
    max_val = max(values)
    
    if min_val == max_val:
        # All same value
        return f"  All values = {min_val:.2f}\n"
    
    # Calculate bin edges
    bin_width = (max_val - min_val) / bins
    bin_counts = [0] * bins
    
    for v in values:
        bin_idx = int((v - min_val) / bin_width)
        bin_idx = min(bin_idx, bins - 1)  # Handle edge case
        bin_counts[bin_idx] += 1
    
    max_count = max(bin_counts)
    if max_count == 0:
        max_count = 1
    
    # Build histogram lines
    lines = []
    
    # Calculate bar widths
    bar_width = width // bins
    
    for row in range(height, 0, -1):
        threshold = (row / height) * max_count
        line = "  "
        for count in bin_counts:
            if count >= threshold:
                # Color based on bin position
                bin_val = min_val + (bin_counts.index(count) + 0.5) * bin_width
                if bin_val < 0:
                    line += red("█" * bar_width)
                else:
                    line += green("█" * bar_width)
            elif count >= threshold - (max_count / height / 2):
                # Partial fill
                if bin_counts.index(count) < bins // 2:
                    line += red("▄" * bar_width)
                else:
                    line += green("▄" * bar_width)
            else:
                line += " " * bar_width
        lines.append(line)
    
    # Add baseline
    lines.append("  " + "─" * (bar_width * bins))
    
    # Add labels
    if show_labels:
        label_line = f"  {min_val:+.1f}" + " " * (bar_width * bins - 14) + f"{max_val:+.1f}"
        lines.append(label_line)
        
        # Add distribution stats
        mean_val = sum(values) / len(values)
        positive_pct = sum(1 for v in values if v > 0) / len(values)
        
        stats_line = f"  n={len(values)} mean={color_value(mean_val, '+.2f')} " \
                     f"positive={color_pct(positive_pct)}"
        lines.append(stats_line)
    
    return "\n".join(lines) + "\n"


def mini_histogram(values: List[float], width: int = 20) -> str:
    """
    Generate a single-line mini histogram.
    
    Uses block characters to show distribution.
    """
    if not values:
        return " " * width
    
    min_val = min(values)
    max_val = max(values)
    
    if min_val == max_val:
        return "─" * width
    
    # Create bins
    bins = width
    bin_width = (max_val - min_val) / bins
    bin_counts = [0] * bins
    
    for v in values:
        bin_idx = int((v - min_val) / bin_width)
        bin_idx = min(bin_idx, bins - 1)
        bin_counts[bin_idx] += 1
    
    max_count = max(bin_counts) or 1
    
    # Build histogram line
    result = ""
    zero_bin = int((0 - min_val) / bin_width) if min_val < 0 < max_val else -1
    
    for i, count in enumerate(bin_counts):
        height = int((count / max_count) * 8)
        char = SPARK_BLOCKS[min(8, max(0, height))] if height > 0 else " "
        
        # Color based on value range this bin represents
        bin_center = min_val + (i + 0.5) * bin_width
        if bin_center < 0:
            result += red(char)
        else:
            result += green(char)
    
    return result


# =============================================================================
# SUMMARY FORMATTERS
# =============================================================================

def format_score_line(
    rank: int,
    params: dict,
    robust_score: float,
    median_test_r: float,
    ratio: float,
    dd_category: str,
    stressed_r: Optional[float],
    passes_gates: bool,
    fold_test_rs: Optional[List[float]] = None,
) -> str:
    """
    Format a single result line with colors and sparkline.
    
    Example output:
    ╭  1. TP=2.30x SL=0.59x │ Score=+15.2 MedTeR=+12.4 Ratio=0.65 DD=clea ▁▂▅█▃▂ ✓
    """
    tp = params.get("tp_mult", 0)
    sl = params.get("sl_mult", 0)
    
    # Sparkline of fold results
    spark = ""
    if fold_test_rs and len(fold_test_rs) > 1:
        spark = " " + colored_sparkline(fold_test_rs, width=6)
    
    # Stressed R
    stress_str = ""
    if stressed_r is not None:
        stress_str = f" Str={color_value(stressed_r, '+.1f')}"
    
    # Build the line
    line = (
        f"  {rank:2d}. "
        f"TP={cyan(f'{tp:.2f}')}x SL={cyan(f'{sl:.2f}')}x │ "
        f"Score={color_value(robust_score, '+6.1f')} "
        f"MedTeR={color_value(median_test_r, '+5.1f')} "
        f"Ratio={color_ratio(ratio)} "
        f"DD={color_dd_category(dd_category)}"
        f"{stress_str}{spark} {gate_symbol(passes_gates)}"
    )
    
    return line


def format_island_summary(island: dict, show_sparklines: bool = True) -> str:
    """
    Format an island summary with colors.
    """
    lines = []
    
    island_id = island.get("island_id", 0)
    n_members = island.get("n_members", 0)
    centroid = island.get("centroid", {})
    param_spread = island.get("param_spread", {})
    
    # Header
    lines.append(f"\n{'─'*60}")
    lines.append(bold(f"ISLAND {island_id}: {n_members} candidates"))
    
    # Centroid
    tp = centroid.get("tp_mult", 0)
    sl = centroid.get("sl_mult", 0)
    lines.append(f"  Centroid: TP={cyan(f'{tp:.2f}')}x SL={cyan(f'{sl:.2f}')}x")
    
    # Spread
    tp_spread = param_spread.get("tp_mult", 0)
    sl_spread = param_spread.get("sl_mult", 0)
    lines.append(f"  Spread:   TP±{tp_spread:.2f} SL±{sl_spread:.2f}")
    
    # Scores
    lines.append("  Scores:")
    mean_robust = island.get("mean_robust_score", 0)
    median_robust = island.get("median_robust_score", 0)
    best_robust = island.get("best_robust_score", 0)
    mean_test_r = island.get("mean_median_test_r", 0)
    mean_ratio = island.get("mean_ratio", 0)
    pct_pass = island.get("pct_pass_gates", 0)
    
    lines.append(f"    Mean Robust:   {color_value(mean_robust, '+.2f')}")
    lines.append(f"    Median Robust: {color_value(median_robust, '+.2f')}")
    lines.append(f"    Best Robust:   {color_value(best_robust, '+.2f')}")
    lines.append(f"    Mean TestR:    {color_value(mean_test_r, '+.2f')}")
    lines.append(f"    Mean Ratio:    {color_ratio(mean_ratio)}")
    lines.append(f"    % Pass Gates:  {color_pct(pct_pass)}")
    
    # Top members
    members = island.get("members", [])[:3]
    if members:
        lines.append("  Top 3:")
        for m in members:
            p = m.get("params", {})
            score = m.get("robust_score", 0)
            test_r = m.get("median_test_r", 0)
            passed = m.get("passes_gates", False)
            lines.append(
                f"    TP={p.get('tp_mult', 0):.2f}x SL={p.get('sl_mult', 0):.2f}x │ "
                f"Score={color_value(score, '+.2f')} TestR={color_value(test_r, '+.2f')} "
                f"{gate_symbol(passed)}"
            )
    
    return "\n".join(lines)


def print_results_summary(
    results: List[dict],
    top_n: int = 30,
    show_histogram: bool = True,
) -> None:
    """
    Print a colorful summary of results with histogram.
    
    Args:
        results: List of result dicts with robust_result
        top_n: Number of top results to show
        show_histogram: Whether to show distribution histogram
    """
    import sys
    
    if not results:
        print(red("  (no results)"), file=sys.stderr)
        return
    
    # Sort by robust score
    sorted_results = sorted(
        results,
        key=lambda r: r.get("robust_result", {}).get("robust_score", -999),
        reverse=True
    )
    
    # Extract scores for histogram
    all_scores = [r.get("robust_result", {}).get("robust_score", 0) for r in sorted_results]
    all_test_rs = [r.get("robust_result", {}).get("median_test_r", 0) for r in sorted_results]
    
    # Stats
    n_tradeable = sum(1 for r in sorted_results if r.get("robust_result", {}).get("passes_gates", False))
    
    print(f"\nTradeable: {color_value(n_tradeable, 'd', 0)}/{len(sorted_results)} " \
          f"({color_pct(n_tradeable/len(sorted_results) if sorted_results else 0)})", file=sys.stderr)
    
    # Histogram
    if show_histogram:
        print(f"\n{bold('TestR Distribution:')}", file=sys.stderr)
        print(histogram(all_test_rs, bins=15, width=45, height=4), file=sys.stderr)
        print(f"  {mini_histogram(all_test_rs, width=45)}", file=sys.stderr)
    
    # Header
    print(f"\n{'─'*80}", file=sys.stderr)
    print(bold(f"TOP {min(top_n, len(sorted_results))} BY ROBUST SCORE") + \
          dim(" (median TestR - DD penalty - stress penalty):"), file=sys.stderr)
    print(dim("  → Uses MEDIAN(TestR) not MEAN - robust to outlier folds"), file=sys.stderr)
    print("─" * 80, file=sys.stderr)
    
    # Results
    for i, r in enumerate(sorted_results[:top_n], 1):
        rr = r.get("robust_result", {})
        params = r.get("params", {})
        
        # Get fold test Rs for sparkline if available
        fold_test_rs = None
        fold_results = rr.get("fold_results", [])
        if fold_results:
            fold_test_rs = [f.get("test_r", 0) for f in fold_results if isinstance(f, dict)]
        
        line = format_score_line(
            rank=i,
            params=params,
            robust_score=rr.get("robust_score", 0),
            median_test_r=rr.get("median_test_r", 0),
            ratio=rr.get("median_ratio", 0),
            dd_category=rr.get("dd_category", "?"),
            stressed_r=rr.get("median_stressed_r"),
            passes_gates=rr.get("passes_gates", False),
            fold_test_rs=fold_test_rs,
        )
        print(line, file=sys.stderr)


def print_islands_summary(islands: List[dict]) -> None:
    """
    Print colorful island summaries.
    """
    import sys
    
    if not islands:
        print(dim("  (no islands formed)"), file=sys.stderr)
        return
    
    print(f"\n{'='*80}", file=sys.stderr)
    print(bold(f"PARAMETER ISLANDS ({len(islands)} regions)"), file=sys.stderr)
    print("='*80", file=sys.stderr)
    
    for island in islands:
        print(format_island_summary(island), file=sys.stderr)


def print_robust_summary(
    results: List[dict],
    n_tradeable: int,
    islands: List[dict],
) -> None:
    """
    Print final robust mode summary with colors.
    """
    import sys
    from statistics import median as stat_median
    
    robust_scores = [r.get("robust_result", {}).get("robust_score", 0) for r in results]
    median_test_rs = [r.get("robust_result", {}).get("median_test_r", 0) for r in results]
    
    print(f"\n{'='*80}", file=sys.stderr)
    print(bold("ROBUST MODE SUMMARY:"), file=sys.stderr)
    
    med_score = stat_median(robust_scores) if robust_scores else 0
    med_test_r = stat_median(median_test_rs) if median_test_rs else 0
    pct_tradeable = n_tradeable / len(results) if results else 0
    
    print(f"  Median of Robust Scores: {color_value(med_score, '+.2f')}", file=sys.stderr)
    print(f"  Median of Median TestR:  {color_value(med_test_r, '+.2f')}", file=sys.stderr)
    print(f"  % Tradeable:             {color_pct(pct_tradeable)}", file=sys.stderr)
    print(f"  Parameter Islands:       {cyan(str(len(islands)))}", file=sys.stderr)
    print("=" * 80, file=sys.stderr)

