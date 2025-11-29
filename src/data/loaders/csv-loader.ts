/**
 * CSV Data Loader
 * 
 * Loads trading call data from CSV files
 */

import { promises as fs } from 'fs';
import { parse } from 'csv-parse';
import { DateTime } from 'luxon';
import path from 'path';
import { DataLoader, LoadParams, LoadResult, CsvLoadParams } from './types';

export class CsvDataLoader implements DataLoader {
  public readonly name = 'csv-loader';

  async load(params: LoadParams): Promise<LoadResult[]> {
    const csvParams = params as CsvLoadParams;
    
    if (!csvParams.path) {
      throw new Error('CSV loader requires a path parameter');
    }

    const filePath = path.isAbsolute(csvParams.path) 
      ? csvParams.path 
      : path.join(process.cwd(), csvParams.path);

    // Read CSV file
    const csvContent = await fs.readFile(filePath, 'utf-8');
    
    // Parse CSV
    const records: any[] = await new Promise((resolve, reject) => {
      parse(
        csvContent,
        { 
          columns: true, 
          skip_empty_lines: true,
          relax_column_count: true,
        },
        (err, records) => {
          if (err) reject(err);
          else resolve(records);
        }
      );
    });

    // Transform to LoadResult format
    const results: LoadResult[] = [];
    const startOffsetMinutes = csvParams.startOffsetMinutes ?? 0;
    const durationHours = csvParams.durationHours ?? 24 * 60; // Default 60 days

    for (const record of records) {
      // Filter out bot messages (presale alerts, etc.)
      const sender = (record.sender || record.caller || '').toLowerCase();
      const message = (record.message || record.text || '').toLowerCase();
      const botPatterns = [
        'wen presale',
        'wenpresale',
        'presale',
        'gempad',
        'rick',
        'phanes',
        'bot',
      ];
      const isBotMessage = botPatterns.some(pattern => 
        sender.includes(pattern) || message.includes(pattern)
      );
      if (isBotMessage) {
        continue; // Skip bot messages
      }

      // Extract required fields - trim whitespace that might be introduced during CSV parsing
      const mint = (record[csvParams.mintField] || record.tokenAddress || record.mint || '').trim();
      let chain = (record[csvParams.chainField] || record.chain || 'solana').trim().toLowerCase();
      const timestampStr = (record[csvParams.timestampField] || record.timestamp || record.alertTime || '').trim();

      if (!mint || !timestampStr) {
        continue; // Skip invalid records
      }

      // Smart chain detection: if message mentions a chain, use that instead of CSV value
      // This fixes cases where extraction script incorrectly labeled all 0x addresses as 'bsc'
      if (message.includes('base detected') || message.includes('on base') || message.includes('network=base')) {
        chain = 'base';
      } else if (message.includes('ethereum') || message.includes('eth network')) {
        chain = 'ethereum';
      } else if (message.includes('bsc') || message.includes('binance')) {
        chain = 'bsc';
      } else if (mint.startsWith('0x') && chain === 'bsc') {
        // If it's an EVM address but chain is 'bsc' (default from extraction), 
        // try to infer from URL or other context
        const urlMatch = message.match(/network=(\w+)/i);
        if (urlMatch) {
          const network = urlMatch[1].toLowerCase();
          if (['base', 'ethereum', 'bsc', 'arbitrum', 'polygon'].includes(network)) {
            chain = network;
          }
        }
      }

      // Only include tokens on supported chains: BSC, Ethereum, or Solana
      const supportedChains = ['bsc', 'ethereum', 'solana'];
      if (!supportedChains.includes(chain)) {
        continue; // Skip tokens on other chains (Base, Arbitrum, Polygon, etc.)
      }

      // Parse timestamp
      let timestamp: DateTime;
      try {
        timestamp = DateTime.fromISO(timestampStr);
        if (!timestamp.isValid) {
          timestamp = DateTime.fromJSDate(new Date(timestampStr));
        }
        if (!timestamp.isValid) {
          continue; // Skip invalid timestamps
        }
      } catch {
        continue; // Skip records with unparseable timestamps
      }

      // Apply start offset
      if (startOffsetMinutes > 0) {
        timestamp = timestamp.plus({ minutes: startOffsetMinutes });
      }

      // Apply filters if provided
      if (csvParams.filter) {
        let matches = true;
        for (const [key, value] of Object.entries(csvParams.filter)) {
          if (record[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) {
          continue;
        }
      }

      // Build result
      const result: LoadResult = {
        mint,
        chain,
        timestamp,
        tokenAddress: mint,
        tokenSymbol: record.tokenSymbol || record.symbol,
        tokenName: record.tokenName || record.name,
        caller: record.caller || record.creator || record.sender,
        // Include all original fields for flexibility
        ...record,
      };

      // Add computed fields
      (result as any).endTime = timestamp.plus({ hours: durationHours });

      results.push(result);
    }

    // Apply limit and offset if provided
    let filtered = results;
    if (csvParams.offset) {
      filtered = filtered.slice(csvParams.offset);
    }
    if (csvParams.limit) {
      filtered = filtered.slice(0, csvParams.limit);
    }

    return filtered;
  }

  canLoad(source: string): boolean {
    return source === 'csv' || source.endsWith('.csv');
  }
}

