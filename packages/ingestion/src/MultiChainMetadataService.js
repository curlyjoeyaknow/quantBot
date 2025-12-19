"use strict";
/**
 * Multi-Chain Metadata Service
 * =============================
 *
 * Fetches token metadata across multiple chains (Solana, Ethereum, Base, BSC).
 * Uses Birdeye API with fallback logic for EVM chains.
 *
 * Key insight: EVM addresses are identical across ETH/Base/BSC.
 * We must try all three chains to determine which one actually has the token.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMultiChainMetadata = fetchMultiChainMetadata;
exports.batchFetchMultiChainMetadata = batchFetchMultiChainMetadata;
const utils_1 = require("@quantbot/utils");
const api_clients_1 = require("@quantbot/api-clients");
const addressValidation_1 = require("./addressValidation");
const MultiChainMetadataCache_1 = require("./MultiChainMetadataCache");
/**
 * Fetch metadata for an address across all relevant chains
 *
 * For Solana addresses: only query Solana
 * For EVM addresses: query ETH, Base, and BSC in parallel (cheap calls)
 *
 * @param address - The token address (full, case-preserved)
 * @param chainHint - Optional hint from context (e.g., from Telegram message)
 * @returns Multi-chain metadata result with all attempted chains
 */
async function fetchMultiChainMetadata(address, chainHint) {
    const birdeyeClient = (0, api_clients_1.getBirdeyeClient)();
    const cache = (0, MultiChainMetadataCache_1.getMetadataCache)();
    // Determine address kind
    const addressKind = (0, addressValidation_1.isEvmAddress)(address) ? 'evm' : (0, addressValidation_1.isSolanaAddress)(address) ? 'solana' : 'evm';
    const result = {
        address,
        addressKind,
        chainHint,
        metadata: [],
    };
    if (addressKind === 'solana') {
        // Solana address: only query Solana chain
        // Check cache first
        const cached = cache.get(address, 'solana');
        if (cached) {
            utils_1.logger.debug('Using cached Solana metadata', {
                address: address.substring(0, 20),
                cacheHit: true,
            });
            result.metadata.push(cached);
            if (cached.found) {
                result.primaryMetadata = cached;
            }
            return result;
        }
        utils_1.logger.debug('Fetching Solana metadata', {
            address: address.substring(0, 20),
        });
        try {
            const metadata = await (0, utils_1.retryWithBackoff)(() => birdeyeClient.getTokenMetadata(address, 'solana'), 3, // maxRetries
            1000, // initialDelayMs (1 second)
            { address: address.substring(0, 20), chain: 'solana' });
            const tokenMetadata = {
                address,
                chain: 'solana',
                name: metadata?.name,
                symbol: metadata?.symbol,
                found: metadata !== null,
            };
            result.metadata.push(tokenMetadata);
            // Cache the result (even if not found, to avoid repeated API calls)
            cache.set(address, 'solana', tokenMetadata);
            if (metadata) {
                result.primaryMetadata = tokenMetadata;
            }
        }
        catch (error) {
            utils_1.logger.warn('Failed to fetch Solana metadata', {
                error: error instanceof Error ? error.message : String(error),
                address: address.substring(0, 20),
            });
            const tokenMetadata = {
                address,
                chain: 'solana',
                found: false,
            };
            result.metadata.push(tokenMetadata);
            // Cache negative result with shorter TTL (5 minutes)
            cache.set(address, 'solana', tokenMetadata, 1000 * 60 * 5);
        }
    }
    else {
        // EVM address: try all three chains (ETH, Base, BSC)
        // Use chainHint to prioritize if available
        const chains = chainHint
            ? [chainHint, ...['ethereum', 'base', 'bsc'].filter((c) => c !== chainHint)]
            : ['ethereum', 'base', 'bsc'];
        // Check cache for any chain first
        const cachedAny = cache.getAnyChain(address, chains);
        if (cachedAny) {
            utils_1.logger.debug('Using cached EVM metadata', {
                address: address.substring(0, 20),
                chain: cachedAny.chain,
                cacheHit: true,
            });
            result.metadata.push(cachedAny.metadata);
            result.primaryMetadata = cachedAny.metadata;
            return result;
        }
        utils_1.logger.debug('Fetching EVM metadata across chains', {
            address: address.substring(0, 20),
            chains,
            chainHint,
        });
        // Check cache for each chain first
        const cachedResults = [];
        const chainsToFetch = [];
        for (const chain of chains) {
            const cached = cache.get(address, chain);
            if (cached) {
                cachedResults.push({ chain, metadata: cached });
                result.metadata.push(cached);
                if (cached.found && !result.primaryMetadata) {
                    result.primaryMetadata = cached;
                }
            }
            else {
                chainsToFetch.push(chain);
            }
        }
        // If we found metadata in cache, return early (unless we need to fetch more)
        if (result.primaryMetadata && chainsToFetch.length === 0) {
            return result;
        }
        // Query all remaining chains in parallel
        if (chainsToFetch.length > 0) {
            const startTime = Date.now();
            const parallelQueries = chainsToFetch.map(async (chain) => {
                const chainStartTime = Date.now();
                try {
                    const metadata = await (0, utils_1.retryWithBackoff)(() => birdeyeClient.getTokenMetadata(address, chain), 3, // maxRetries
                    1000, // initialDelayMs (1 second)
                    { address: address.substring(0, 20), chain });
                    const tokenMetadata = {
                        address,
                        chain,
                        name: metadata?.name,
                        symbol: metadata?.symbol,
                        found: metadata !== null,
                    };
                    // Cache the result
                    cache.set(address, chain, tokenMetadata);
                    const chainDuration = Date.now() - chainStartTime;
                    utils_1.logger.debug('Metadata API call completed', {
                        address: address.substring(0, 20),
                        chain,
                        found: !!metadata,
                        fromCache: false,
                        durationMs: chainDuration,
                    });
                    return { chain, tokenMetadata, error: null };
                }
                catch (error) {
                    utils_1.logger.warn('Failed to fetch EVM metadata', {
                        error: error instanceof Error ? error.message : String(error),
                        address: address.substring(0, 20),
                        chain,
                    });
                    const tokenMetadata = {
                        address,
                        chain,
                        found: false,
                    };
                    // Cache negative result with shorter TTL (5 minutes)
                    cache.set(address, chain, tokenMetadata, 1000 * 60 * 5);
                    return {
                        chain,
                        tokenMetadata,
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            });
            const queryResults = await Promise.all(parallelQueries);
            const endTime = Date.now();
            const totalDuration = endTime - startTime;
            // Track metrics
            const foundCount = queryResults.filter((r) => r.tokenMetadata.found).length;
            const cacheHitCount = cachedResults.length;
            const hintCorrect = chainHint && result.primaryMetadata?.chain === chainHint;
            utils_1.logger.debug('Parallel EVM queries completed', {
                address: address.substring(0, 20),
                durationMs: totalDuration,
                chainsQueried: chainsToFetch.length,
                chainsFound: foundCount,
                cacheHits: cacheHitCount,
                chainHint,
                hintCorrect,
                actualChain: result.primaryMetadata?.chain,
            });
            // Process results in priority order (chainHint first)
            for (const chain of chains) {
                const queryResult = queryResults.find((r) => r.chain === chain);
                if (queryResult) {
                    result.metadata.push(queryResult.tokenMetadata);
                    // Set primary metadata to first successful result (respecting priority order)
                    if (queryResult.tokenMetadata.found && !result.primaryMetadata) {
                        result.primaryMetadata = queryResult.tokenMetadata;
                        utils_1.logger.info('Found token metadata', {
                            address: address.substring(0, 20),
                            chain: queryResult.tokenMetadata.chain,
                            symbol: queryResult.tokenMetadata.symbol,
                            name: queryResult.tokenMetadata.name,
                        });
                    }
                }
            }
        }
    }
    return result;
}
/**
 * Batch fetch metadata for multiple addresses
 *
 * Useful for processing Telegram messages with multiple addresses.
 * Processes addresses in parallel batches to improve performance while respecting rate limits.
 *
 * @param addresses - Array of addresses to fetch
 * @param chainHint - Optional chain hint for all addresses
 * @param batchSize - Number of addresses to process in parallel (default: 5)
 * @returns Array of metadata results
 */
async function batchFetchMultiChainMetadata(addresses, chainHint, batchSize = 5) {
    const results = [];
    // Process in batches
    for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        // Process batch in parallel
        const batchResults = await Promise.all(batch.map(async (address) => {
            try {
                return await fetchMultiChainMetadata(address, chainHint);
            }
            catch (error) {
                utils_1.logger.error('Failed to fetch metadata for address', error, {
                    address: address.substring(0, 20),
                });
                // Add failed result
                return {
                    address,
                    addressKind: (0, addressValidation_1.isEvmAddress)(address) ? 'evm' : 'solana',
                    chainHint,
                    metadata: [],
                };
            }
        }));
        results.push(...batchResults);
        // Small delay between batches to respect rate limits
        if (i + batchSize < addresses.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return results;
}
//# sourceMappingURL=MultiChainMetadataService.js.map