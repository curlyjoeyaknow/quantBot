import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as path from 'path';
import { withRole, UserRole } from '@/lib/middleware';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';
import { withValidation } from '@/lib/middleware/validation';
import { reportGenerationSchema } from '@/lib/validation/schemas';

const PROJECT_ROOT = path.join(process.cwd(), '..');

interface ReportGenerationStatus {
  isRunning: boolean;
  progress?: {
    currentWeek?: string;
    totalWeeks?: number;
    completedWeeks?: number;
  };
  lastResult?: {
    success: boolean;
    reportsGenerated: number;
    outputDirectory: string;
    errors?: string[];
    warnings?: string[];
  };
}

// In-memory status tracking (in production, use Redis or database)
let reportGenerationStatus: ReportGenerationStatus = {
  isRunning: false,
};

export const POST = rateLimit(RATE_LIMITS.STRICT)(
  withErrorHandling(
    withValidation({ body: reportGenerationSchema })(
      withRole([UserRole.ADMIN], async (request: NextRequest, session, validated) => {
        const options = validated.body!;

        if (reportGenerationStatus.isRunning) {
          return NextResponse.json(
            {
              error: 'Report generation is already running',
              progress: reportGenerationStatus.progress,
            },
            { status: 409 }
          );
        }

        // Build command arguments
        const args = [
          'ts-node',
          path.join(PROJECT_ROOT, 'scripts/generate-weekly-reports-modular.ts'),
          '--strategy-type', options.strategyType,
          '--start-date', options.startDate,
          '--end-date', options.endDate,
          '--chain', options.chain || 'solana',
        ];

        if (options.strategyName) {
          args.push('--strategy-name', options.strategyName);
        }
        if (options.simulationTimestamp) {
          args.push('--simulation-timestamp', options.simulationTimestamp);
        }
        if (options.callers && options.callers.length > 0) {
          args.push('--callers', options.callers.join(','));
        }
        if (options.outputDir) {
          args.push('--output-dir', options.outputDir);
        }
        if (options.runSimulationsIfMissing) {
          args.push('--run-simulations-if-missing');
        }

        // Mark as running
        reportGenerationStatus.isRunning = true;
        reportGenerationStatus.progress = {
          totalWeeks: 0,
          completedWeeks: 0,
        };

        // Spawn process
        const proc = spawn('npx', args, {
          cwd: PROJECT_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          console.log('[Report Generator]', output);

          // Parse progress from output
          const weekMatch = output.match(/Processing week (\d{4}-\d{2}-\d{2})/);
          if (weekMatch) {
            reportGenerationStatus.progress = {
              ...reportGenerationStatus.progress,
              currentWeek: weekMatch[1],
            };
          }

          const completedMatch = output.match(/Generated: (\d+) reports/);
          if (completedMatch) {
            reportGenerationStatus.progress = {
              ...reportGenerationStatus.progress,
              completedWeeks: parseInt(completedMatch[1], 10),
            };
          }
        });

        proc.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          console.error('[Report Generator Error]', output);
        });

        proc.on('close', (code: number) => {
          reportGenerationStatus.isRunning = false;

          if (code === 0) {
            // Parse final result from stdout
            const reportsMatch = stdout.match(/Generated (\d+) weekly reports/);
            const reportsGenerated = reportsMatch ? parseInt(reportsMatch[1], 10) : 0;

            reportGenerationStatus.lastResult = {
              success: true,
              reportsGenerated,
              outputDirectory: options.outputDir || path.join(PROJECT_ROOT, 'data/exports/emails/weekly-reports'),
            };
          } else {
            reportGenerationStatus.lastResult = {
              success: false,
              reportsGenerated: 0,
              outputDirectory: '',
              errors: [stderr || 'Report generation failed'],
            };
          }
        });

        return NextResponse.json({
          message: 'Report generation started',
          options,
        });
      })
    )
  )
);

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(
    withRole([UserRole.ADMIN], async (request: NextRequest, session) => {
      return NextResponse.json(reportGenerationStatus);
    })
  )
);

