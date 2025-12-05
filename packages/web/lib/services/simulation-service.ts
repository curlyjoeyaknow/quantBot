/**
 * Simulation Service
 * ==================
 * Business logic for simulations
 */

import * as path from 'path';
import { exists, readdir, readFile, isDirectory } from '../utils/fs-async';
import { sanitizePath, sanitizeFilename, PathTraversalError } from '../security/path-sanitizer';
import { parse } from 'csv-parse/sync';
import { Simulation, SimulationSummary } from '../types/api';

interface TradeHistoryRow {
  [key: string]: string | number;
}

const EXPORTS_DIR = path.join(process.cwd(), '../..', 'data', 'exports');

export class SimulationService {
  /**
   * List all simulations
   */
  async listSimulations(): Promise<Simulation[]> {
    if (!(await exists(EXPORTS_DIR))) {
      return [];
    }

    const simulations: Simulation[] = [];
    const entries = await readdir(EXPORTS_DIR, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Sanitize directory name to prevent path traversal
        let safeDirName: string;
        try {
          safeDirName = sanitizeFilename(entry.name);
        } catch (error) {
          // Skip invalid directory names
          continue;
        }

        // Sanitize the full path
        let simPath: string;
        try {
          simPath = sanitizePath(safeDirName, EXPORTS_DIR);
        } catch (error) {
          // Skip invalid paths
          continue;
        }

        const summaryPath = path.join(simPath, 'summary.json');
        const tradeHistoryPath = path.join(simPath, 'trade_history.csv');

        let summary: SimulationSummary | null = null;
        if (await exists(summaryPath)) {
          try {
            const summaryContent = await readFile(summaryPath, 'utf8');
            summary = JSON.parse(summaryContent);
          } catch (error) {
            // Ignore parse errors
          }
        }

        // Look for any CSV files as trade history
        let tradeHistory: string | undefined;
        try {
          const dirFiles = await readdir(simPath) as string[];
          const csvFiles = dirFiles.filter(f => f.endsWith('.csv') && f.includes('trade'));
          if (csvFiles.length > 0) {
            // Sanitize CSV filename
            const safeCsvFile = sanitizeFilename(csvFiles[0]);
            tradeHistory = sanitizePath(safeCsvFile, simPath);
          } else if (await exists(tradeHistoryPath)) {
            tradeHistory = tradeHistoryPath;
          }
        } catch (error) {
          // Ignore errors when reading directory
        }

        simulations.push({
          name: safeDirName,
          path: simPath,
          summary: summary || undefined,
          tradeHistoryPath: tradeHistory,
        });
      }
    }

    return simulations;
  }

  /**
   * Get simulation details by name
   */
  async getSimulationByName(name: string): Promise<{ summary: SimulationSummary | null; tradeHistory: TradeHistoryRow[] }> {
    // Sanitize the simulation name to prevent path traversal
    let safeSimName: string;
    try {
      safeSimName = sanitizeFilename(name);
    } catch (error) {
      if (error instanceof PathTraversalError) {
        throw new Error('Invalid simulation name');
      }
      throw error;
    }

    // Sanitize the full path
    let simPath: string;
    try {
      simPath = sanitizePath(safeSimName, EXPORTS_DIR);
    } catch (error) {
      if (error instanceof PathTraversalError) {
        throw new Error('Invalid simulation path');
      }
      throw error;
    }
    
    if (!(await exists(simPath))) {
      throw new Error('Simulation not found');
    }

    // Get summary
    const summaryPath = path.join(simPath, 'summary.json');
    let summary: SimulationSummary | null = null;
    if (await exists(summaryPath)) {
      try {
        const summaryContent = await readFile(summaryPath, 'utf8');
        summary = JSON.parse(summaryContent);
      } catch (error) {
        // Ignore
      }
    }

    // Get trade history
    const dirFiles = await readdir(simPath) as string[];
    const csvFiles = dirFiles.filter(f => f.endsWith('.csv') && f.includes('trade'));
    let tradeHistory: TradeHistoryRow[] = [];
    
    if (csvFiles.length > 0) {
      // Sanitize the CSV filename
      let safeCsvFile: string;
      try {
        safeCsvFile = sanitizeFilename(csvFiles[0]);
      } catch (error) {
        // If filename is invalid, skip it
        safeCsvFile = csvFiles[0];
      }

      // Sanitize the full path to the CSV file
      let tradeHistoryPath: string;
      try {
        tradeHistoryPath = sanitizePath(safeCsvFile, simPath);
      } catch (error) {
        if (error instanceof PathTraversalError) {
          // Skip invalid paths
          tradeHistoryPath = path.join(simPath, safeCsvFile);
        } else {
          throw error;
        }
      }

      try {
        const csvContent = await readFile(tradeHistoryPath, 'utf8');
        tradeHistory = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
        });
      } catch (error) {
        // Ignore parse errors
      }
    }

    return {
      summary,
      tradeHistory,
    };
  }
}

export const simulationService = new SimulationService();

