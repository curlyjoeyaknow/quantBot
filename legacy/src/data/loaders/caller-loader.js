"use strict";
/**
 * Caller Data Loader
 *
 * Loads trading call data from caller tracking database
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallerDataLoader = void 0;
const luxon_1 = require("luxon");
const caller_database_1 = require("../../storage/caller-database");
class CallerDataLoader {
    constructor() {
        this.name = 'caller-loader';
    }
    async load(params) {
        const callerParams = params;
        if (!callerParams.caller) {
            throw new Error('Caller loader requires a caller name');
        }
        const chain = callerParams.chain || 'solana';
        const limit = callerParams.limit || 100;
        const includeFailed = callerParams.includeFailed ?? false;
        const lookbackDays = callerParams.lookbackDays;
        // Get caller alerts
        let alerts;
        if (lookbackDays) {
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
            alerts = await caller_database_1.callerDatabase.getCallerAlertsInRange(callerParams.caller, startTime, endTime);
        }
        else {
            alerts = await caller_database_1.callerDatabase.getCallerAlerts(callerParams.caller, limit);
        }
        // Apply limit if specified and not already applied
        if (lookbackDays && limit && alerts.length > limit) {
            alerts = alerts.slice(0, limit);
        }
        // Note: CallerAlert doesn't have a 'success' field, so we can't filter by it
        // If filtering is needed, it should be done at a higher level
        // Transform to LoadResult format
        return alerts.map(alert => ({
            mint: alert.tokenAddress,
            chain: alert.chain || chain,
            timestamp: luxon_1.DateTime.fromJSDate(alert.alertTimestamp),
            tokenAddress: alert.tokenAddress,
            tokenSymbol: alert.tokenSymbol,
            tokenName: undefined, // CallerAlert doesn't have tokenName
            caller: alert.callerName || callerParams.caller,
            priceAtAlert: alert.priceAtAlert,
            volumeAtAlert: alert.volumeAtAlert,
        }));
    }
    canLoad(source) {
        return source === 'caller' || source.startsWith('caller:');
    }
}
exports.CallerDataLoader = CallerDataLoader;
//# sourceMappingURL=caller-loader.js.map