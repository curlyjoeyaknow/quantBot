/**
 * API and external service types
 */

export interface ChainConfig {
  id: string;
  name: string;
  symbol: string;
  rpcUrl: string;
  explorerUrl: string;
  isEVM: boolean;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: string;
  price?: number;
  marketCap?: number;
  volume24h?: number;
}

export interface OHLCVCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BirdeyeResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface BirdeyeTokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
}

export interface BirdeyeOHLCV {
  unixTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface HeliusWebSocketMessage {
  type: string;
  data: any;
}

export interface PriceUpdate {
  tokenAddress: string;
  chain: string;
  price: number;
  timestamp: Date;
  volume24h?: number;
  marketCap?: number;
}

export interface CAAlert {
  tokenAddress: string;
  chain: string;
  alertPrice: number;
  currentPrice: number;
  multiplier: number;
  timestamp: Date;
  chatId: string;
  messageId: string;
}
