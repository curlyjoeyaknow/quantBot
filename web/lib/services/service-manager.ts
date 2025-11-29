/**
 * Service Manager
 * ===============
 * Secure service management without shell command injection vulnerabilities.
 * Uses Node.js child_process spawn/execFile instead of exec.
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execFileAsync = promisify(execFile);

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  pid?: number;
  lastCheck: string;
}

interface ServiceConfig {
  name: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  processPatterns: string[];
}

/**
 * Validates and sanitizes a PID value
 */
function validatePid(pid: unknown): number | null {
  if (typeof pid !== 'number' && typeof pid !== 'string') {
    return null;
  }
  const pidNum = typeof pid === 'string' ? parseInt(pid, 10) : pid;
  if (isNaN(pidNum) || pidNum <= 0 || pidNum > 2147483647) {
    return null;
  }
  return pidNum;
}

/**
 * Safely checks if a process exists by PID
 */
async function checkProcessExists(pid: number): Promise<boolean> {
  try {
    // Use execFile with specific command and args - no shell injection possible
    await execFileAsync('ps', ['-p', pid.toString(), '-o', 'pid='], {
      timeout: 5000,
      maxBuffer: 1024,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets process command line arguments safely
 */
async function getProcessArgs(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', pid.toString(), '-o', 'args='], {
      timeout: 5000,
      maxBuffer: 10240,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Lists processes matching a pattern safely
 * Uses ps with specific arguments - no shell injection
 */
async function findProcessesByPattern(pattern: string): Promise<Array<{ pid: number; args: string }>> {
  try {
    // Use ps with specific format, then filter in Node.js (not in shell)
    const { stdout } = await execFileAsync('ps', ['aux'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024, // 1MB buffer
    });

    const processes: Array<{ pid: number; args: string }> = [];
    const lines = stdout.split('\n');
    
    // Compile regex pattern safely (pattern is already validated)
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');

    for (const line of lines) {
      // Parse ps output: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const match = line.match(/^\S+\s+(\d+)\s+[\d.]+\s+[\d.]+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
      if (match) {
        const pid = parseInt(match[1], 10);
        const args = match[2];
        
        if (pid && regex.test(args)) {
          processes.push({ pid, args });
        }
      }
    }

    return processes;
  } catch {
    return [];
  }
}

/**
 * Validates a process pattern to prevent injection
 */
function validateProcessPattern(pattern: string): boolean {
  // Only allow alphanumeric, spaces, dots, dashes, underscores, and wildcards
  // No shell metacharacters allowed
  return /^[a-zA-Z0-9.\s_\-*]+$/.test(pattern) && pattern.length <= 200;
}

/**
 * Service Manager class
 */
export class ServiceManager {
  private pidFileDir: string;

  constructor(pidFileDir: string) {
    this.pidFileDir = pidFileDir;
  }

  /**
   * Gets the PID file path for a service
   */
  private getPidFilePath(serviceName: string): string {
    // Validate service name to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) {
      throw new Error('Invalid service name');
    }
    return path.join(this.pidFileDir, `${serviceName}.pid`);
  }

  /**
   * Reads PID from file
   */
  private async readPidFile(serviceName: string): Promise<number | null> {
    try {
      const pidFile = this.getPidFilePath(serviceName);
      const content = await fs.readFile(pidFile, 'utf8');
      return validatePid(content.trim());
    } catch {
      return null;
    }
  }

  /**
   * Writes PID to file
   */
  private async writePidFile(serviceName: string, pid: number): Promise<void> {
    try {
      await fs.mkdir(this.pidFileDir, { recursive: true });
      const pidFile = this.getPidFilePath(serviceName);
      await fs.writeFile(pidFile, pid.toString(), 'utf8');
    } catch (error) {
      console.error(`Failed to write PID file for ${serviceName}:`, error);
    }
  }

  /**
   * Deletes PID file
   */
  private async deletePidFile(serviceName: string): Promise<void> {
    try {
      const pidFile = this.getPidFilePath(serviceName);
      await fs.unlink(pidFile);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Checks if a service is running
   */
  async checkServiceStatus(
    serviceName: string,
    processPatterns: string[]
  ): Promise<ServiceStatus> {
    // Validate all patterns
    for (const pattern of processPatterns) {
      if (!validateProcessPattern(pattern)) {
        throw new Error(`Invalid process pattern: ${pattern}`);
      }
    }

    // Check PID file first
    const pidFromFile = await this.readPidFile(serviceName);
    if (pidFromFile) {
      const exists = await checkProcessExists(pidFromFile);
      if (exists) {
        const args = await getProcessArgs(pidFromFile);
        if (args) {
          // Check if process matches any pattern
          const matches = processPatterns.some(pattern => {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
            return regex.test(args);
          });

          if (matches) {
            return {
              name: serviceName,
              status: 'running',
              pid: pidFromFile,
              lastCheck: new Date().toISOString(),
            };
          }
        }
        // Process exists but doesn't match - remove stale PID file
        await this.deletePidFile(serviceName);
      } else {
        // Process doesn't exist - remove stale PID file
        await this.deletePidFile(serviceName);
      }
    }

    // Check by process pattern
    for (const pattern of processPatterns) {
      const processes = await findProcessesByPattern(pattern);
      if (processes.length > 0) {
        // Use the first matching process
        const { pid } = processes[0];
        await this.writePidFile(serviceName, pid);
        return {
          name: serviceName,
          status: 'running',
          pid,
          lastCheck: new Date().toISOString(),
        };
      }
    }

    return {
      name: serviceName,
      status: 'stopped',
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Stops a service by PID
   */
  async stopService(pid: number): Promise<boolean> {
    const validPid = validatePid(pid);
    if (!validPid) {
      return false;
    }

    try {
      // Try graceful shutdown first (SIGTERM)
      process.kill(validPid, 'SIGTERM');
      
      // Wait up to 2 seconds for graceful shutdown
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const exists = await checkProcessExists(validPid);
        if (!exists) {
          return true;
        }
      }

      // Force kill if still running
      const stillExists = await checkProcessExists(validPid);
      if (stillExists) {
        process.kill(validPid, 'SIGKILL');
        return true;
      }

      return true;
    } catch (error) {
      console.error(`Error stopping process ${validPid}:`, error);
      return false;
    }
  }

  /**
   * Starts a service
   */
  async startService(config: ServiceConfig): Promise<{ success: boolean; pid?: number; error?: string }> {
    // Validate command
    if (!Array.isArray(config.command) || config.command.length === 0) {
      return { success: false, error: 'Invalid command' };
    }

    // Validate all patterns
    for (const pattern of config.processPatterns) {
      if (!validateProcessPattern(pattern)) {
        return { success: false, error: `Invalid process pattern: ${pattern}` };
      }
    }

    try {
      // Spawn process (not exec - no shell injection)
      const [command, ...args] = config.command;
      const child = spawn(command, args, {
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      // Unref to allow parent to exit
      child.unref();

      // Wait a moment for process to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if process is still running
      if (child.pid && !child.killed) {
        await this.writePidFile(config.name, child.pid);
        
        // Verify it's actually running
        const exists = await checkProcessExists(child.pid);
        if (exists) {
          return { success: true, pid: child.pid };
        }
      }

      return { success: false, error: 'Process failed to start' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to start service' };
    }
  }

  /**
   * Stops a service by name
   */
  async stopServiceByName(serviceName: string, processPatterns: string[]): Promise<boolean> {
    // Validate patterns
    for (const pattern of processPatterns) {
      if (!validateProcessPattern(pattern)) {
        throw new Error(`Invalid process pattern: ${pattern}`);
      }
    }

    let stopped = false;

    // Try PID file first
    const pid = await this.readPidFile(serviceName);
    if (pid) {
      stopped = await this.stopService(pid);
      if (stopped) {
        await this.deletePidFile(serviceName);
      }
    }

    // Also try to find and stop by pattern
    for (const pattern of processPatterns) {
      const processes = await findProcessesByPattern(pattern);
      for (const { pid: processPid } of processes) {
        if (await this.stopService(processPid)) {
          stopped = true;
        }
      }
    }

    return stopped;
  }
}

