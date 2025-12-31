/**
 * Histogram Formatter
 *
 * Creates ASCII histograms for console output
 */

/**
 * Create a horizontal bar histogram
 */
export function createHistogram(
  data: Array<{ label: string; value: number }>,
  options: {
    width?: number;
    maxBars?: number;
    showValues?: boolean;
    title?: string;
  } = {}
): string {
  const { width = 60, maxBars = 20, showValues = true, title } = options;

  if (data.length === 0) {
    return title ? `${title}\n(no data)` : '(no data)';
  }

  // Sort by value descending and limit
  const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, maxBars);
  const maxValue = Math.max(...sorted.map((d) => d.value));

  if (maxValue === 0) {
    return title ? `${title}\n(all values are zero)` : '(all values are zero)';
  }

  const lines: string[] = [];

  if (title) {
    lines.push(title);
    lines.push('');
  }

  // Find longest label for alignment
  const maxLabelLength = Math.max(...sorted.map((d) => d.label.length));

  for (const item of sorted) {
    const barLength = Math.round((item.value / maxValue) * width);
    const bar = '█'.repeat(barLength);
    const padding = ' '.repeat(Math.max(0, maxLabelLength - item.label.length));
    const valueStr = showValues ? ` ${formatNumber(item.value)}` : '';
    lines.push(`${item.label}${padding} │${bar}${valueStr}`);
  }

  return lines.join('\n');
}

/**
 * Format number with appropriate units (K, M, B)
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

/**
 * Create a multi-series histogram (e.g., candles by interval and chain)
 */
export function createMultiSeriesHistogram(
  series: Array<{
    name: string;
    data: Array<{ label: string; value: number }>;
  }>,
  options: {
    width?: number;
    maxBars?: number;
    showValues?: boolean;
  } = {}
): string {
  const lines: string[] = [];

  for (const s of series) {
    const histogram = createHistogram(s.data, {
      ...options,
      title: s.name,
    });
    lines.push(histogram);
    if (series.indexOf(s) < series.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}
