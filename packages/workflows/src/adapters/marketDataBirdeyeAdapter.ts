import type {
  Candle,
  MarketDataPort,
  MarketDataOhlcvRequest,
  MarketDataMetadataRequest,
  HistoricalPriceRequest,
  HistoricalPriceResponse,
  Chain,
} from '@quantbot/core';
import type { BirdeyeClient } from '@quantbot/infra/api-clients';
import { ValidationError } from '@quantbot/infra/utils';

// TokenMetadata from MarketDataPort (has chain field)
type MarketDataTokenMetadata = {
  address: string;
  chain: Chain;
  name?: string;
  symbol?: string;
  decimals?: number;
  price?: number;
  logoURI?: string;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
};

/**
 * MarketDataPort adapter wrapping BirdeyeClient
 *
 * This adapter isolates the shape alignment between:
 * - MarketDataPort interface (from @quantbot/core)
 * - BirdeyeClient implementation (from @quantbot/api-clients)
 *
 * All mapping logic lives here, keeping workflows clean.
 */
export function createMarketDataBirdeyeAdapter(client: BirdeyeClient): MarketDataPort {
  return {
    async fetchOhlcv(request: MarketDataOhlcvRequest): Promise<Candle[]> {
      // CRITICAL: Verify address is not truncated before passing to Birdeye client
      if (request.tokenAddress.length < 32) {
        const { logger } = await import('@quantbot/infra/utils');
        logger.error('Address is truncated in MarketDataPort adapter', {
          tokenAddress: request.tokenAddress,
          length: request.tokenAddress.length,
          expectedMin: 32,
          chain: request.chain,
        });
        throw new ValidationError(
          `Address is truncated in adapter: ${request.tokenAddress.length} chars (expected >= 32)`,
          {
            tokenAddress: request.tokenAddress,
            length: request.tokenAddress.length,
            expectedMin: 32,
            chain: request.chain,
          }
        );
      }

      // Convert port request to Birdeye client format
      const startTime = new Date(request.from * 1000); // Convert seconds to milliseconds
      const endTime = new Date(request.to * 1000);

      // Map interval format (port uses '1H', Birdeye uses '1H' or '1h')
      const birdeyeInterval = request.interval;

      // Normalize chain
      const chain = request.chain === 'evm' ? 'ethereum' : request.chain;

      // Call Birdeye client
      const response = await client.fetchOHLCVData(
        request.tokenAddress, // Full address - verify it's not truncated
        startTime,
        endTime,
        birdeyeInterval,
        chain
      );

      if (!response || !response.items) {
        return [];
      }

      // Map Birdeye response to core Candle format
      return response.items.map((item) => ({
        timestamp: item.unixTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }));
    },

    async fetchMetadata(
      request: MarketDataMetadataRequest
    ): Promise<MarketDataTokenMetadata | null> {
      // Normalize chain
      const chain = request.chain === 'evm' ? 'ethereum' : (request.chain ?? 'solana');

      // Call Birdeye client (only returns name and symbol)
      const metadata = await client.getTokenMetadata(request.tokenAddress, chain);

      if (!metadata) {
        return null;
      }

      // Map Birdeye metadata to core TokenMetadata format
      // Note: Birdeye's getTokenMetadata only returns { name, symbol }
      // Other fields would need to come from a different endpoint
      const result: MarketDataTokenMetadata = {
        address: request.tokenAddress,
        chain: (request.chain ?? chain) as Chain,
        name: metadata.name,
        symbol: metadata.symbol,
        // These fields are not available from Birdeye's getTokenMetadata endpoint
        decimals: undefined,
        price: undefined,
        logoURI: undefined,
        priceChange24h: undefined,
        volume24h: undefined,
        marketCap: undefined,
      };
      return result;
    },

    async fetchHistoricalPriceAtTime(
      request: HistoricalPriceRequest
    ): Promise<HistoricalPriceResponse> {
      // Normalize chain
      const chain = request.chain === 'evm' ? 'ethereum' : (request.chain ?? 'solana');

      // Call Birdeye client (unixTime is in seconds)
      const result = await client.fetchHistoricalPriceAtUnixTime(
        request.tokenAddress,
        request.unixTime,
        chain
      );

      if (!result) {
        return null;
      }

      // Map Birdeye response to core HistoricalPriceResponse format
      return {
        unixTime: result.unixTime,
        value: result.value,
        price: result.price ?? result.value,
      };
    },
  };
}
