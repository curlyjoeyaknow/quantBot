import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const CALLER_DB_PATH = process.env.CALLER_DB_PATH || path.join(process.cwd(), '../..', 'caller_alerts.db');

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async getDatabase(): Promise<Database> {
    if (this.db) {
      return this.db;
    }

    if (this.isInitializing && this.initPromise) {
      await this.initPromise;
      if (this.db) return this.db;
    }

    this.isInitializing = true;
    this.initPromise = new Promise((resolve, reject) => {
      const db = new Database(CALLER_DB_PATH, (err) => {
        if (err) {
          this.isInitializing = false;
          this.initPromise = null;
          reject(err);
        } else {
          this.db = db;
          this.isInitializing = false;
          this.initPromise = null;
          resolve();
        }
      });
    });

    await this.initPromise;
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            resolve();
          }
        });
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const get = promisify(db.get.bind(db));
      await get('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

export const dbManager = DatabaseManager.getInstance();

