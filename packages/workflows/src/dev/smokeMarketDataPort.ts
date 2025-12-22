/**
 * Smoke test for MarketDataPort adapter
 *
 * Quick verification that the adapter wiring doesn't regress.
 * Run this to ensure the Birdeye adapter is properly wired.
 */

import { createProductionPorts } from '../context/createProductionPorts.js';
import { createTokenAddress } from '@quantbot/core';

export async function smokeMarketDataPort(): Promise<void> {
  const ports = await createProductionPorts();

  // Test with SOL (well-known token)
  const solMint = createTokenAddress('So11111111111111111111111111111111111111112');

  try {
    // Test metadata fetch
    const metadata = await ports.marketData.fetchMetadata({
      tokenAddress: solMint,
      chain: 'solana',
    });

    if (metadata) {
      console.log('✅ MarketDataPort metadata fetch works:', {
        address: metadata.address,
        name: metadata.name,
        symbol: metadata.symbol,
      });
    } else {
      console.log('⚠️  MarketDataPort metadata fetch returned null (may be expected)');
    }

    // Test OHLCV fetch (small window)
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    const candles = await ports.marketData.fetchOhlcv({
      tokenAddress: solMint,
      chain: 'solana',
      interval: '1m',
      from: oneHourAgo,
      to: now,
    });

    console.log('✅ MarketDataPort OHLCV fetch works:', {
      candleCount: candles.length,
      firstCandle: candles[0] ? { timestamp: candles[0].timestamp, close: candles[0].close } : null,
    });

    // Test historical price
    const historicalPrice = await ports.marketData.fetchHistoricalPriceAtTime({
      tokenAddress: solMint,
      unixTime: oneHourAgo,
      chain: 'solana',
    });

    if (historicalPrice) {
      console.log('✅ MarketDataPort historical price fetch works:', {
        unixTime: historicalPrice.unixTime,
        price: historicalPrice.price ?? historicalPrice.value,
      });
    } else {
      console.log('⚠️  MarketDataPort historical price fetch returned null (may be expected)');
    }

    console.log('✅ All MarketDataPort smoke tests passed!');
  } catch (error) {
    console.error('❌ MarketDataPort smoke test failed:', error);
    throw error;
  }
}

// Allow running directly: tsx packages/workflows/src/dev/smokeMarketDataPort.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  smokeMarketDataPort()
    .then(() => {
      console.log('Smoke test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Smoke test failed:', error);
      process.exit(1);
    });
}
