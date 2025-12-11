"use strict";
/**
 * Score new tokens using Brook's selection patterns
 * This script can be used to identify tokens that match Brook's criteria
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreTokens = scoreTokens;
exports.extractTokenFeatures = extractTokenFeatures;
const luxon_1 = require("luxon");
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const birdeye_client_1 = require("../../src/api/birdeye-client");
const logger_1 = require("../../src/utils/logger");
const analyze_brook_token_selection_1 = require("./analyze-brook-token-selection");
(0, dotenv_1.config)();
/**
 * Extract features from a token at current time
 */
async function extractTokenFeatures(tokenAddress, chain = 'solana') {
    const now = luxon_1.DateTime.now();
    const nowUnix = Math.floor(now.toSeconds());
    const startUnix = nowUnix - 86400; // 24 hours before
    try {
        // Fetch candles
        const birdeyeData = await birdeye_client_1.birdeyeClient.fetchOHLCVData(tokenAddress, new Date(startUnix * 1000), new Date(nowUnix * 1000), '5m');
        if (!birdeyeData || !birdeyeData.items || birdeyeData.items.length === 0) {
            return null;
        }
        const candles = birdeyeData.items
            .map(item => ({
            timestamp: item.unixTime,
            price: parseFloat(item.close) || 0,
            volume: parseFloat(item.volume) || 0,
        }))
            .sort((a, b) => a.timestamp - b.timestamp);
        if (candles.length === 0) {
            return null;
        }
        const currentCandle = candles[candles.length - 1];
        const price = currentCandle.price;
        const volume = currentCandle.volume;
        // Get market cap (estimate if not available)
        let marketCap = 0;
        try {
            // Try to get from Birdeye token info
            const response = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`, {
                headers: {
                    'X-API-KEY': process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || '',
                    'accept': 'application/json',
                    'x-chain': chain,
                },
            });
            const data = await response.json();
            marketCap = data?.data?.marketCap || 0;
        }
        catch {
            // Estimate: assume 1B supply for pump.fun tokens
            marketCap = price * 1000000000;
        }
        // Price changes
        const price15mAgo = candles
            .filter(c => nowUnix - c.timestamp <= 900)
            .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
        const price1hAgo = candles
            .filter(c => nowUnix - c.timestamp <= 3600)
            .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
        const price24hAgo = candles
            .filter(c => nowUnix - c.timestamp <= 86400)
            .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
        const priceChange15m = price15mAgo ? ((price - price15mAgo) / price15mAgo) * 100 : 0;
        const priceChange1h = price1hAgo ? ((price - price1hAgo) / price1hAgo) * 100 : 0;
        const priceChange24h = price24hAgo ? ((price - price24hAgo) / price24hAgo) * 100 : 0;
        // Volume analysis
        const volume1hAgo = candles
            .filter(c => nowUnix - c.timestamp <= 3600 && nowUnix - c.timestamp > 1800)
            .reduce((sum, c) => sum + c.volume, 0);
        const volume1hBefore = candles
            .filter(c => nowUnix - c.timestamp <= 1800 && nowUnix - c.timestamp > 0)
            .reduce((sum, c) => sum + c.volume, 0);
        const volumeChange1h = volume1hAgo > 0
            ? ((volume1hBefore - volume1hAgo) / volume1hAgo) * 100
            : 0;
        const avgVolume24h = candles
            .filter(c => nowUnix - c.timestamp <= 86400)
            .reduce((sum, c) => sum + c.volume, 0) / Math.max(1, candles.filter(c => nowUnix - c.timestamp <= 86400).length);
        // Volatility
        const priceChanges24h = candles
            .filter(c => nowUnix - c.timestamp <= 86400)
            .map((c, i, arr) => {
            if (i === 0)
                return 0;
            const prev = arr[i - 1];
            return prev.price > 0 ? ((c.price - prev.price) / prev.price) * 100 : 0;
        })
            .filter(change => change !== 0);
        const avgChange = priceChanges24h.reduce((sum, c) => sum + c, 0) / Math.max(1, priceChanges24h.length);
        const variance = priceChanges24h.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / Math.max(1, priceChanges24h.length);
        const volatility24h = Math.sqrt(variance);
        // Timing
        const hourOfDay = now.hour;
        const dayOfWeek = now.weekday % 7;
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        // Market cap category
        let marketCapCategory;
        if (marketCap < 1000000) {
            marketCapCategory = 'micro';
        }
        else if (marketCap < 10000000) {
            marketCapCategory = 'small';
        }
        else if (marketCap < 100000000) {
            marketCapCategory = 'mid';
        }
        else {
            marketCapCategory = 'large';
        }
        return {
            price,
            volume,
            marketCap,
            priceChange15m,
            priceChange1h,
            priceChange24h,
            volumeChange1h,
            avgVolume24h,
            hourOfDay,
            dayOfWeek,
            isWeekend,
            volatility24h,
            marketCapCategory,
        };
    }
    catch (error) {
        logger_1.logger.warn('Failed to extract features', {
            tokenAddress: tokenAddress.substring(0, 20),
            error: error.message,
        });
        return null;
    }
}
/**
 * Score a token and provide reasons
 */
function scoreToken(features, scoreModel) {
    const score = scoreModel(features);
    const reasons = [];
    // Market cap
    if (features.marketCapCategory === 'micro' || features.marketCapCategory === 'small') {
        reasons.push(`✅ ${features.marketCapCategory} market cap (${(features.marketCap / 1000000).toFixed(2)}M)`);
    }
    else {
        reasons.push(`⚠️  ${features.marketCapCategory} market cap (may be too large)`);
    }
    // Price action
    if (features.priceChange24h >= 5 && features.priceChange24h <= 20 && features.priceChange1h >= 0 && features.priceChange1h <= 10) {
        reasons.push(`✅ Optimal price action: +${features.priceChange24h.toFixed(1)}% (24h), +${features.priceChange1h.toFixed(1)}% (1h)`);
    }
    else if (features.priceChange24h > 50) {
        reasons.push(`⚠️  Very high 24h pump: +${features.priceChange24h.toFixed(1)}% (may be too late)`);
    }
    else if (features.priceChange24h < -20) {
        reasons.push(`📉 Significant dip: ${features.priceChange24h.toFixed(1)}% (could be opportunity)`);
    }
    else {
        reasons.push(`📊 Price action: +${features.priceChange24h.toFixed(1)}% (24h), +${features.priceChange1h.toFixed(1)}% (1h)`);
    }
    // Volume
    if (features.volumeChange1h > 50) {
        reasons.push(`✅ Strong volume spike: +${features.volumeChange1h.toFixed(1)}%`);
    }
    else if (features.volumeChange1h > 20) {
        reasons.push(`✅ Volume increasing: +${features.volumeChange1h.toFixed(1)}%`);
    }
    else if (features.volumeChange1h < 0) {
        reasons.push(`⚠️  Volume decreasing: ${features.volumeChange1h.toFixed(1)}%`);
    }
    // Volatility
    if (features.volatility24h > 5 && features.volatility24h < 20) {
        reasons.push(`✅ Moderate volatility: ${features.volatility24h.toFixed(1)}%`);
    }
    else if (features.volatility24h > 50) {
        reasons.push(`⚠️  Very high volatility: ${features.volatility24h.toFixed(1)}% (risky)`);
    }
    // Timing
    if (features.hourOfDay >= 14 && features.hourOfDay <= 22) {
        reasons.push(`✅ US market hours (better timing)`);
    }
    return { score, reasons };
}
/**
 * Score multiple tokens
 */
async function scoreTokens(tokenAddresses, chain = 'solana', forceRebuild = false) {
    // The scoring model uses hardcoded weights, so we can build it directly
    // We only need to call analyzeBrookCalls if we want to rebuild the model weights
    // For now, we'll use a dummy analysis array since weights are hardcoded
    logger_1.logger.info('Initializing scoring model...');
    // Create a minimal analysis array - the model weights are hardcoded anyway
    const dummyAnalyses = [];
    const scoreModel = (0, analyze_brook_token_selection_1.buildScoringModel)(dummyAnalyses);
    logger_1.logger.info('Scoring tokens', { count: tokenAddresses.length });
    const scores = [];
    for (const address of tokenAddresses) {
        try {
            const features = await extractTokenFeatures(address, chain);
            if (!features) {
                logger_1.logger.warn('Could not extract features', { tokenAddress: address.substring(0, 20) });
                continue;
            }
            const { score, reasons } = scoreToken(features, scoreModel);
            scores.push({
                tokenAddress: address,
                score,
                features,
                reasons,
            });
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        catch (error) {
            logger_1.logger.warn('Failed to score token', {
                tokenAddress: address.substring(0, 20),
                error: error.message,
            });
        }
    }
    // Sort by score
    scores.sort((a, b) => b.score - a.score);
    return scores;
}
/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: ts-node score-tokens-like-brook.ts <token1> [token2] [token3] ...');
        console.log('Example: ts-node score-tokens-like-brook.ts So11111111111111111111111111111111111111112');
        process.exit(1);
    }
    logger_1.logger.info('Scoring tokens', { count: args.length });
    const scores = await scoreTokens(args);
    console.log('\n🎯 TOKEN SCORES (Brook-style selection)\n');
    console.log('='.repeat(80));
    for (const tokenScore of scores) {
        console.log(`\n📍 ${tokenScore.tokenAddress.substring(0, 20)}...`);
        console.log(`   Score: ${tokenScore.score.toFixed(2)}`);
        console.log(`   Price: $${tokenScore.features.price.toFixed(8)}`);
        console.log(`   Market Cap: ${(tokenScore.features.marketCap / 1000000).toFixed(2)}M (${tokenScore.features.marketCapCategory})`);
        console.log(`   Price 24h: ${tokenScore.features.priceChange24h.toFixed(1)}%`);
        console.log(`   Volume 1h: ${tokenScore.features.volumeChange1h.toFixed(1)}%`);
        console.log(`   Reasons:`);
        for (const reason of tokenScore.reasons) {
            console.log(`     ${reason}`);
        }
    }
    // Save results
    const outputDir = path.join(process.cwd(), 'data/exports/brook-analysis');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `token-scores-${luxon_1.DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(scores, null, 2));
    console.log(`\n✅ Results saved to: ${outputPath}`);
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=score-tokens-like-brook.js.map