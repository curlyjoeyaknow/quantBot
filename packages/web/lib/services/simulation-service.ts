/**
 * Simulation Service - PostgreSQL Version
 * Handles simulation run data and results
 */

import { postgresManager } from '../db/postgres-manager';
import { cache, cacheKeys } from '../cache';
import { CONSTANTS } from '../constants';

export interface SimulationRun {
  id: number;
  strategy_name: string;
  token_symbol?: string;
  token_address: string;
  chain: string;
  run_type: string;
  status: string;
  final_pnl?: number;
  win_rate?: number;
  trade_count?: number;
  started_at: Date;
  completed_at?: Date;
  created_at: Date;
}

export interface SimulationDetails extends SimulationRun {
  config_json: any;
  data_selection_json: any;
  max_drawdown?: number;
  sharpe_ratio?: number;
  avg_trade_return?: number;
  metadata_json?: any;
}

export class SimulationService {
  /**
   * List all simulations with optional filtering
   */
  async listSimulations(options: {
    limit?: number;
    offset?: number;
    status?: string;
    strategyId?: number;
  } = {}): Promise<{ simulations: SimulationRun[]; total: number }> {
    const { limit = 50, offset = 0, status, strategyId } = options;

    try {
      let countQuery = `
        SELECT COUNT(*) as total
        FROM simulation_runs sr
        WHERE 1=1
      `;

      let dataQuery = `
        SELECT 
          sr.id,
          s.name as strategy_name,
          t.symbol as token_symbol,
          t.address as token_address,
          t.chain,
          sr.run_type,
          sr.status,
          srs.final_pnl,
          srs.win_rate,
          srs.trade_count,
          sr.started_at,
          sr.completed_at,
          sr.created_at
        FROM simulation_runs sr
        LEFT JOIN strategies s ON s.id = sr.strategy_id
        LEFT JOIN tokens t ON t.id = sr.token_id
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (status) {
        countQuery += ` AND sr.status = $${paramIndex}`;
        dataQuery += ` AND sr.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (strategyId) {
        countQuery += ` AND sr.strategy_id = $${paramIndex}`;
        dataQuery += ` AND sr.strategy_id = $${paramIndex}`;
        params.push(strategyId);
        paramIndex++;
      }

      dataQuery += ` ORDER BY sr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const [countResult, dataResult] = await Promise.all([
        postgresManager.query(countQuery, params.slice(0, -2)),
        postgresManager.query(dataQuery, params),
      ]);

      const simulations: SimulationRun[] = dataResult.rows.map((row: any) => ({
        id: row.id,
        strategy_name: row.strategy_name,
        token_symbol: row.token_symbol,
        token_address: row.token_address,
        chain: row.chain,
        run_type: row.run_type,
        status: row.status,
        final_pnl: row.final_pnl ? parseFloat(row.final_pnl) : undefined,
        win_rate: row.win_rate ? parseFloat(row.win_rate) : undefined,
        trade_count: row.trade_count ? parseInt(row.trade_count) : undefined,
        started_at: new Date(row.started_at),
        completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
        created_at: new Date(row.created_at),
      }));

      return {
        simulations,
        total: parseInt(countResult.rows[0].total),
      };
    } catch (error) {
      console.error('Error listing simulations:', error);
      throw error;
    }
  }

  /**
   * Get simulation details by ID
   */
  async getSimulationDetails(id: number): Promise<SimulationDetails | null> {
    try {
      const result = await postgresManager.query(
        `
        SELECT 
          sr.*,
          s.name as strategy_name,
          t.symbol as token_symbol,
          t.address as token_address,
          srs.final_pnl,
          srs.max_drawdown,
          srs.win_rate,
          srs.trade_count,
          srs.sharpe_ratio,
          srs.avg_trade_return,
          srs.metadata_json
        FROM simulation_runs sr
        LEFT JOIN strategies s ON s.id = sr.strategy_id
        LEFT JOIN tokens t ON t.id = sr.token_id
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
        WHERE sr.id = $1
        `,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        id: row.id,
        strategy_name: row.strategy_name,
        token_symbol: row.token_symbol,
        token_address: row.token_address,
        chain: row.chain,
        run_type: row.run_type,
        status: row.status,
        config_json: row.config_json,
        data_selection_json: row.data_selection_json,
        final_pnl: row.final_pnl ? parseFloat(row.final_pnl) : undefined,
        max_drawdown: row.max_drawdown ? parseFloat(row.max_drawdown) : undefined,
        win_rate: row.win_rate ? parseFloat(row.win_rate) : undefined,
        trade_count: row.trade_count ? parseInt(row.trade_count) : undefined,
        sharpe_ratio: row.sharpe_ratio ? parseFloat(row.sharpe_ratio) : undefined,
        avg_trade_return: row.avg_trade_return ? parseFloat(row.avg_trade_return) : undefined,
        metadata_json: row.metadata_json,
        started_at: new Date(row.started_at),
        completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
        created_at: new Date(row.created_at),
      };
    } catch (error) {
      console.error('Error fetching simulation details:', error);
      throw error;
    }
  }

  /**
   * Get simulation statistics
   */
  async getSimulationStats(): Promise<any> {
    try {
      const result = await postgresManager.query(`
        SELECT 
          COUNT(*) as total_simulations,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
          AVG(srs.final_pnl) as avg_pnl,
          MAX(srs.final_pnl) as best_pnl,
          MIN(srs.final_pnl) as worst_pnl
        FROM simulation_runs sr
        LEFT JOIN simulation_results_summary srs ON srs.simulation_run_id = sr.id
      `);

      return result.rows[0];
    } catch (error) {
      console.error('Error fetching simulation stats:', error);
      throw error;
    }
  }
}

export const simulationService = new SimulationService();
