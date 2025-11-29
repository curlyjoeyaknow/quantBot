// Job scheduler for background tasks
import { StrategyComputeJob } from './strategy-compute-job';
import { DashboardComputeJob } from './dashboard-compute-job';

export class JobScheduler {
  private strategyJob: StrategyComputeJob;
  private dashboardJob: DashboardComputeJob;
  private intervals: NodeJS.Timeout[] = [];

  constructor() {
    this.strategyJob = new StrategyComputeJob();
    this.dashboardJob = new DashboardComputeJob();
  }

  /**
   * Start all scheduled jobs
   */
  start(): void {
    // Run strategy computation every 6 hours
    const strategyInterval = setInterval(async () => {
      try {
        console.log('[JobScheduler] Starting strategy computation job...');
        const progress = await this.strategyJob.run(50, 500); // Process 500 alerts at a time
        console.log('[JobScheduler] Strategy job completed:', progress);
      } catch (error) {
        console.error('[JobScheduler] Strategy job failed:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Run dashboard computation every hour
    const dashboardInterval = setInterval(async () => {
      try {
        console.log('[JobScheduler] Starting dashboard computation job...');
        const metrics = await this.dashboardJob.run();
        console.log('[JobScheduler] Dashboard job completed:', metrics.computed_at);
      } catch (error) {
        console.error('[JobScheduler] Dashboard job failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    this.intervals.push(strategyInterval, dashboardInterval);

    // Run initial jobs immediately
    this.runInitialJobs();
  }

  /**
   * Run initial jobs on startup
   */
  private async runInitialJobs(): Promise<void> {
    // Run strategy job once on startup (small batch)
    setTimeout(async () => {
      try {
        console.log('[JobScheduler] Running initial strategy computation...');
        await this.strategyJob.run(50, 100);
      } catch (error) {
        console.error('[JobScheduler] Initial strategy job failed:', error);
      }
    }, 5000); // Wait 5 seconds after startup

    // Run dashboard job once on startup
    setTimeout(async () => {
      try {
        console.log('[JobScheduler] Running initial dashboard computation...');
        await this.dashboardJob.run();
      } catch (error) {
        console.error('[JobScheduler] Initial dashboard job failed:', error);
      }
    }, 10000); // Wait 10 seconds after startup
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
  }

  /**
   * Manually trigger strategy computation
   */
  async runStrategyJob(batchSize: number = 50, maxAlerts: number = 1000) {
    return await this.strategyJob.run(batchSize, maxAlerts);
  }

  /**
   * Manually trigger dashboard computation
   */
  async runDashboardJob() {
    return await this.dashboardJob.run();
  }

  /**
   * Get strategy job progress
   */
  getStrategyJobProgress() {
    return this.strategyJob.getProgress();
  }

  /**
   * Check if strategy job is running
   */
  isStrategyJobRunning() {
    return this.strategyJob.isJobRunning();
  }
}

// Export singleton instance
export const jobScheduler = new JobScheduler();

