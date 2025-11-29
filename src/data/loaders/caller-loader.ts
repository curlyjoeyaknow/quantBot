/**
 * Caller Data Loader
 * 
 * Loads trading call data from caller tracking database
 */

import { DateTime } from 'luxon';
import { DataLoader, LoadParams, LoadResult, CallerLoadParams } from './types';
import { callerDatabase } from '../../storage/caller-database';

export class CallerDataLoader implements DataLoader {
  public readonly name = 'caller-loader';

  async load(params: LoadParams): Promise<LoadResult[]> {
    const callerParams = params as CallerLoadParams;
    
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
      alerts = await callerDatabase.getCallerAlertsInRange(
        callerParams.caller,
        startTime,
        endTime
      );
    } else {
      alerts = await callerDatabase.getCallerAlerts(callerParams.caller, limit);
    }

    // Apply limit if specified and not already applied
    if (lookbackDays && limit && alerts.length > limit) {
      alerts = alerts.slice(0, limit);
    }

    // Note: CallerAlert doesn't have a 'success' field, so we can't filter by it
    // If filtering is needed, it should be done at a higher level

    // Transform to LoadResult format
    return filteredAlerts.map(alert => ({
      mint: alert.tokenAddress,
      chain: alert.chain || chain,
      timestamp: DateTime.fromJSDate(alert.alertTimestamp),
      tokenAddress: alert.tokenAddress,
      tokenSymbol: alert.tokenSymbol,
      tokenName: undefined, // CallerAlert doesn't have tokenName
      caller: alert.callerName || callerParams.caller,
      priceAtAlert: alert.priceAtAlert,
      volumeAtAlert: alert.volumeAtAlert,
    }));
  }

  canLoad(source: string): boolean {
    return source === 'caller' || source.startsWith('caller:');
  }
}

