import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';
import { redactSensitiveData } from '@/lib/security/data-redaction';
import { sanitizePath, PathTraversalError } from '@/lib/security/path-sanitizer';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { exists, readFile, writeFile } from '@/lib/utils/fs-async';
import { withValidation } from '@/lib/middleware/validation';
import { configUpdateSchema } from '@/lib/validation/schemas';

const PROJECT_ROOT = path.join(process.cwd(), '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, '.env');
const CONFIG_TEMPLATE = path.join(PROJECT_ROOT, '.env.example');

interface ConfigValue {
  key: string;
  value: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
}

const getConfigHandler = async (request: NextRequest) => {
      // Read current .env file
      let config: Record<string, string> = {};
      if (await exists(CONFIG_FILE)) {
        const envContent = await readFile(CONFIG_FILE, 'utf8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            config[key.trim()] = value;
          }
        });
      }

    // Define known configuration keys with descriptions
    const knownConfigs: Record<string, { description: string; type: 'string' | 'number' | 'boolean' | 'secret' }> = {
      'CLICKHOUSE_HOST': { description: 'ClickHouse server host', type: 'string' },
      'CLICKHOUSE_PORT': { description: 'ClickHouse server port', type: 'number' },
      'CLICKHOUSE_USER': { description: 'ClickHouse username', type: 'string' },
      'CLICKHOUSE_PASSWORD': { description: 'ClickHouse password', type: 'secret' },
      'CLICKHOUSE_DATABASE': { description: 'ClickHouse database name', type: 'string' },
      'TELEGRAM_BOT_TOKEN': { description: 'Telegram bot API token', type: 'secret' },
      'BIRDEYE_API_KEY': { description: 'Birdeye API key', type: 'secret' },
      'ENABLE_BACKGROUND_JOBS': { description: 'Enable background job scheduler', type: 'boolean' },
      'NODE_ENV': { description: 'Node.js environment', type: 'string' },
      'CALLER_DB_PATH': { description: 'Path to caller alerts database', type: 'string' },
      'STRATEGY_RESULTS_DB_PATH': { description: 'Path to strategy results database', type: 'string' },
    };

    const configArray: ConfigValue[] = Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: knownConfigs[key]?.description,
      type: knownConfigs[key]?.type || 'string',
    }));

    // Redact sensitive data before sending response
    const redactedConfig = redactSensitiveData({ config: configArray });

  return NextResponse.json(redactedConfig);
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getConfigHandler)
);

const postHandler = async (request: NextRequest, session: any, validated: any) => {
  const { key, value } = validated.body!;

  // Sanitize the config file path to prevent path traversal
  let safeConfigPath: string;
  try {
    safeConfigPath = sanitizePath(CONFIG_FILE, PROJECT_ROOT, true);
  } catch (error) {
    if (error instanceof PathTraversalError) {
      return NextResponse.json(
        { error: 'Invalid configuration file path' },
        { status: 400 }
      );
    }
    throw error;
  }

  // Read current .env file
  let envLines: string[] = [];
  if (await exists(safeConfigPath)) {
    const content = await readFile(safeConfigPath, 'utf8');
    envLines = content.split('\n');
  }

  // Update or add the key
  let found = false;
  const updatedLines = envLines.map(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    updatedLines.push(`${key}=${value}`);
  }

  // Write back to .env file (using sanitized path)
  await writeFile(safeConfigPath, updatedLines.join('\n') + '\n');

  return NextResponse.json({ 
    success: true, 
    message: `Configuration ${key} updated`,
  });
};

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: configUpdateSchema })(
      withRole([UserRole.ADMIN], postHandler)
    )
  )
);

