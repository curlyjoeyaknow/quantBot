import { NextRequest, NextResponse } from 'next/server';
import * as path from 'path';
import { ServiceManager } from '@/lib/services/service-manager';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withValidation } from '@/lib/middleware/validation';
import { serviceControlSchema } from '@/lib/validation/schemas';

const PROJECT_ROOT = path.join(process.cwd(), '..');
const PID_FILE_DIR = path.join(PROJECT_ROOT, '.pids');

// Initialize service manager
const serviceManager = new ServiceManager(PID_FILE_DIR);

// Service configurations
const SERVICE_CONFIGS: Record<string, { processPatterns: string[]; command: string[]; cwd: string }> = {
  'telegram-bot': {
    processPatterns: [
      'ts-node.*bot\\.ts',
      'node.*bot\\.js',
      'src/bot\\.ts',
      'npm.*start.*bot'
    ],
    command: ['npx', 'ts-node', 'src/bot.ts'],
    cwd: PROJECT_ROOT,
  },
  'recording': {
    processPatterns: [
      'extract.*clickhouse',
      'recording',
      'record.*service'
    ],
    command: ['npx', 'ts-node', 'scripts/extract-bot-tokens-to-clickhouse.ts'],
    cwd: PROJECT_ROOT,
  },
  'bonding-curve-monitor': {
    processPatterns: [
      'bonding.*curve',
      'monitor.*bonding',
      'helius.*monitor'
    ],
    command: ['npx', 'ts-node', 'src/bot.ts'],
    cwd: PROJECT_ROOT,
  },
  'simulation-engine': {
    processPatterns: [
      'simulate',
      'simulation',
      'test-tenkan'
    ],
    command: ['npm', 'run', 'simulate'],
    cwd: PROJECT_ROOT,
  },
  'optimization': {
    processPatterns: [
      'optimize',
      'optimization',
      'optimize-tenkan'
    ],
    command: ['npm', 'run', 'optimize:strategies'],
    cwd: PROJECT_ROOT,
  },
};

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  pid?: number;
  lastCheck: string;
}

const getServicesHandler = async (request: NextRequest) => {
  const services: ServiceStatus[] = [];

  // Check status for each configured service
  for (const [serviceName, config] of Object.entries(SERVICE_CONFIGS)) {
    try {
      const status = await serviceManager.checkServiceStatus(
        serviceName,
        config.processPatterns
      );
      services.push(status);
    } catch (error: any) {
      console.error(`Error checking service ${serviceName}:`, error);
      services.push({
        name: serviceName,
        status: 'unknown',
        lastCheck: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ services });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getServicesHandler)
);

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: serviceControlSchema })(
      withRole([UserRole.ADMIN], async (request: NextRequest, session, validated) => {
        const { service, action } = validated.body!;

        // Validate service name
        if (!(service in SERVICE_CONFIGS)) {
          return NextResponse.json(
            { error: `Unknown service: ${service}` },
            { status: 400 }
          );
        }

        const config = SERVICE_CONFIGS[service];

        if (action === 'stop') {
        try {
          const stopped = await serviceManager.stopServiceByName(
            service,
            config.processPatterns
          );

          return NextResponse.json({
            success: true,
            message: `${service} ${stopped ? 'stopped' : 'was not running'}`,
            action: 'stop',
          });
          } catch (error: any) {
            console.error(`Error stopping service ${service}:`, error);
            return NextResponse.json(
              {
                success: false,
                error: `Failed to stop ${service}: ${error.message}`,
                action: 'stop',
              },
              { status: 500 }
            );
          }
        } else {
          // Start service
          try {
            // Check if already running
            const status = await serviceManager.checkServiceStatus(
              service,
              config.processPatterns
            );

            if (status.status === 'running') {
              return NextResponse.json(
                {
                  success: false,
                  error: `${service} is already running`,
                  action: 'start',
                  pid: status.pid,
                },
                { status: 409 }
              );
            }

            // Start the service
            const result = await serviceManager.startService({
              name: service,
              command: config.command,
              cwd: config.cwd,
              processPatterns: config.processPatterns,
            });

            if (result.success && result.pid) {
              return NextResponse.json({
                success: true,
                message: `${service} started successfully`,
                action: 'start',
                pid: result.pid,
              });
            } else {
              return NextResponse.json(
                {
                  success: false,
                  error: result.error || `Failed to start ${service}`,
                  action: 'start',
                },
                { status: 500 }
              );
            }
          } catch (error: any) {
            console.error(`Error starting service ${service}:`, error);
            return NextResponse.json(
              {
                success: false,
                error: `Failed to start ${service}: ${error.message}`,
                action: 'start',
              },
              { status: 500 }
            );
          }
        }
      })
    )
  )
);
