/**
 * CallSignal - Canonical event representing a token call
 *
 * Represents one call as a single object that can include both:
 * - The caller intent (the original address post)
 * - The enriched snapshot (bot reply: chain/name/ticker/price/mcap/vol/etc)
 *
 * Design principles:
 * - Stable core: tsMs + token(chain,address) + caller + source
 * - Enrichment optional: you can backtest even if the bot never replied
 * - Auditable: raw texts and message IDs are preserved for "prove it" moments
 * - Decouples chain resolution: chain can come from enrichment, or later via resolveEvmChains
 */

/**
 * Source information for the call (Telegram chat/message context)
 */
export type CallSource = {
  chatId?: string;
  chatName?: string;
  callerMessageId: number; // e.g., 149115
  enrichmentMessageId?: number; // e.g., 149117
  replyToMessageId?: number; // e.g., 149115 (from enrichment message)
};

/**
 * Caller identity information
 */
export type CallerIdentity = {
  displayName: string; // e.g., "TY/ACC NO INFO"
  fromId: string; // e.g., "user1646851996"
};

/**
 * Enricher identity (bot that provided structured data)
 */
export type EnricherIdentity = {
  displayName: string; // e.g., "Phanes [Gold]"
  fromId: string; // e.g., "user7774196337"
  botName?: string; // optional bot identifier
};

/**
 * Token reference (chain + address)
 */
export type TokenRef = {
  address: string; // e.g., "0x566b68138f151c7565d5569e2706d522c31b4444"
  chain: 'bsc' | 'eth' | 'base' | 'arb' | 'op' | 'sol' | 'unknown';
};

/**
 * Token snapshot from bot enrichment (price/mcap/vol at call time)
 */
export type TokenSnapshot = {
  name?: string; // e.g., "Energy Coin"
  symbol?: string; // e.g., "ENERGY"
  priceUsd?: number; // e.g., 0.00006735
  marketCapUsd?: number; // e.g., 67400
  volume24hUsd?: number; // e.g., 358200
  rawText?: string; // keep the bot text for audits
};

/**
 * CallSignal - Canonical token call event
 *
 * Stitching rule: This event is formed by joining:
 * - caller message (messageId = 149115)
 * - bot message (reply_to_message_id = 149115)
 *
 * That join can happen in ingestion workflow, producing one CallSignal.
 */
export type CallSignal = {
  kind: 'token_call';
  tsMs: number; // Caller timestamp in milliseconds (e.g., 1764523933 * 1000)
  token: TokenRef;

  caller: CallerIdentity;
  source: CallSource;

  // Optional enrichment (stitch via reply_to_message_id)
  enrichment?: {
    tsMs: number; // Enrichment timestamp in milliseconds (e.g., 1764523934 * 1000)
    enricher: EnricherIdentity;
    snapshot?: TokenSnapshot;
  };

  // Parsing confidence + audit trail
  parse: {
    confidence: number; // 0..1
    reasons?: string[]; // e.g., ["address_only_call", "chain_from_bot_reply"]
  };
};
