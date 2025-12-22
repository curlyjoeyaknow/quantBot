/**
 * Chart Component - ASCII/Unicode charts
 */

/**
 * Simple ASCII candle chart
 */
export function createCandleChart(
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number }>,
  width: number = 80,
  height: number = 20
): string {
  if (candles.length === 0) {
    return 'No data';
  }

  // Find price range
  const prices = candles.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  if (priceRange === 0) {
    return 'No price variation';
  }

  // Create chart
  const lines: string[] = [];
  const chartData = candles.slice(-width);

  for (let y = height - 1; y >= 0; y--) {
    const price = minPrice + (priceRange * y) / (height - 1);
    let line = '';

    for (const candle of chartData) {
      const isInRange = price >= candle.low && price <= candle.high;
      const isOpen = Math.abs(price - candle.open) < priceRange / height / 2;
      const isClose = Math.abs(price - candle.close) < priceRange / height / 2;

      if (isInRange) {
        if (isOpen || isClose) {
          line += '│';
        } else {
          line += ' ';
        }
      } else {
        line += ' ';
      }
    }

    lines.push(line);
  }

  return lines.join('\n');
}
