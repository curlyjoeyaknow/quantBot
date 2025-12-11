import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '@quantbot/utils';

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  maxConnections: number;
}

let pool: Pool | null = null;

function buildConfigFromEnv(): PostgresConfig {
  const {
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DATABASE,
    POSTGRES_MAX_CONNECTIONS,
  } = process.env;

  return {
    host: POSTGRES_HOST || 'localhost',
    port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
    user: POSTGRES_USER || 'quantbot',
    password: POSTGRES_PASSWORD || '',
    database: POSTGRES_DATABASE || 'quantbot',
    maxConnections: POSTGRES_MAX_CONNECTIONS ? Number(POSTGRES_MAX_CONNECTIONS) : 10,
  };
}

export function getPostgresPool(): Pool {
  if (pool) {
    return pool;
  }

  const config = buildConfigFromEnv();

  pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password || undefined,
    database: config.database,
    max: config.maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (error: Error) => {
    logger.error('Postgres pool error', error, {
      host: config.host,
      database: config.database,
    });
  });

  logger.info('Postgres pool created', {
    host: config.host,
    database: config.database,
  });

  return pool;
}

export async function getPostgresClient(): Promise<PoolClient> {
  const client = await getPostgresPool().connect();
  return client;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const client = await getPostgresClient();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

export async function withPostgresTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresClient();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      logger.error('Postgres rollback failed', rollbackError as Error);
    });
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
  logger.info('Postgres pool closed');
}

