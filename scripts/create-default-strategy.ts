#!/usr/bin/env ts-node
/**
 * Create default strategy in PostgreSQL if it doesn't exist
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

const DEFAULT_STRATEGY = {
  name: 'Default Strategy',
  version: '1',
  category: 'multi-target',
  description: 'Default multi-target strategy: 50% @ 2x, 30% @ 3x, 20% @ 5x',
  config_json: {
    strategy: [
      { percent: 0.5, target: 2.0 },
      { percent: 0.3, target: 3.0 },
      { percent: 0.2, target: 5.0 },
    ],
    stopLoss: {
      initial: -0.2,
      trailing: 'none',
    },
    entry: {
      initialEntry: 0.0,
      trailingEntry: 'none',
      maxWaitTime: 0,
    },
    costs: {
      entrySlippageBps: 300,
      exitSlippageBps: 300,
      takerFeeBps: 50,
      borrowAprBps: 0,
    },
  },
  is_active: true,
};

async function createDefaultStrategy() {
  try {
    console.log('🚀 Creating default strategy...\n');

    // Check if strategy already exists
    const checkResult = await pgPool.query(
      `SELECT id FROM strategies WHERE name = $1 AND version = $2`,
      [DEFAULT_STRATEGY.name, DEFAULT_STRATEGY.version]
    );

    if (checkResult.rows.length > 0) {
      console.log(`✅ Strategy "${DEFAULT_STRATEGY.name}" already exists (ID: ${checkResult.rows[0].id})`);
      await pgPool.end();
      return;
    }

    // Create strategy
    const result = await pgPool.query(
      `INSERT INTO strategies (name, version, category, description, config_json, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        DEFAULT_STRATEGY.name,
        DEFAULT_STRATEGY.version,
        DEFAULT_STRATEGY.category,
        DEFAULT_STRATEGY.description,
        JSON.stringify(DEFAULT_STRATEGY.config_json),
        DEFAULT_STRATEGY.is_active,
      ]
    );

    console.log(`✅ Created strategy "${DEFAULT_STRATEGY.name}" with ID: ${result.rows[0].id}`);
    await pgPool.end();
  } catch (error: any) {
    console.error('❌ Error creating strategy:', error.message);
    await pgPool.end();
    process.exit(1);
  }
}

if (require.main === module) {
  createDefaultStrategy();
}

export { createDefaultStrategy };

