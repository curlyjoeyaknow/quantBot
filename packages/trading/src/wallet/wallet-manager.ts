/**
 * Wallet Manager
 * 
 * Manages encrypted wallet storage in PostgreSQL
 */

import * as crypto from 'crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { queryPostgres } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { Wallet } from '../types';

export interface WalletManagerOptions {
  encryptionKey: string; // AES-256 key (32 bytes hex or base64)
}

/**
 * Wallet Manager - secure encrypted key storage
 */
export class WalletManager {
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(options: WalletManagerOptions) {
    
    // Convert encryption key to buffer
    if (options.encryptionKey.length === 64) {
      // Hex string
      this.encryptionKey = Buffer.from(options.encryptionKey, 'hex');
    } else {
      // Base64 or raw string - pad/truncate to 32 bytes
      const keyBuffer = Buffer.from(options.encryptionKey, 'base64');
      this.encryptionKey = keyBuffer.slice(0, 32);
      if (this.encryptionKey.length < 32) {
        // Pad with zeros if needed
        this.encryptionKey = Buffer.concat([this.encryptionKey, Buffer.alloc(32 - this.encryptionKey.length)]);
      }
    }

    if (this.encryptionKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (256 bits)');
    }
  }

  /**
   * Add a wallet for a user
   */
  async addWallet(
    userId: number,
    privateKey: string | Uint8Array,
    name: string
  ): Promise<Wallet> {
    try {
      // Convert private key to Keypair to get public key
      let keypair: Keypair;
      if (typeof privateKey === 'string') {
        // Base58 string
        const { bs58 } = await import('bs58');
        const secretKey = bs58.decode(privateKey);
        keypair = Keypair.fromSecretKey(secretKey);
      } else {
        keypair = Keypair.fromSecretKey(privateKey);
      }

      const publicKey = keypair.publicKey.toBase58();

      // Encrypt private key
      const encryptedPrivateKey = this.encrypt(privateKey instanceof Uint8Array ? privateKey : Buffer.from(privateKey));

      // Check if wallet already exists
      const existing = await this.getWalletByPublicKey(userId, publicKey);
      if (existing) {
        throw new Error('Wallet with this public key already exists');
      }

      // Insert into database
      const query = `
        INSERT INTO wallets (user_id, public_key, encrypted_private_key, name)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const values = [userId, publicKey, encryptedPrivateKey, name];
      const result = await queryPostgres(query, values);

      return this.mapRowToWallet(result.rows[0]);
    } catch (error) {
      logger.error('Failed to add wallet', error as Error, { userId, name });
      throw error;
    }
  }

  /**
   * Get wallet by ID
   */
  async getWallet(walletId: number): Promise<Wallet | null> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM wallets WHERE id = $1`,
        [walletId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToWallet(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get wallet', error as Error, { walletId });
      throw error;
    }
  }

  /**
   * Get wallet by public key for a user
   */
  async getWalletByPublicKey(userId: number, publicKey: string): Promise<Wallet | null> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM wallets WHERE user_id = $1 AND public_key = $2`,
        [userId, publicKey]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToWallet(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get wallet by public key', error as Error, { userId, publicKey });
      throw error;
    }
  }

  /**
   * Get active wallet for a user (or first wallet if multiple)
   */
  async getActiveWallet(userId: number, walletId?: number): Promise<Wallet | null> {
    try {
      if (walletId) {
        return this.getWallet(walletId);
      }

      // Get first active wallet
      const result = await queryPostgres(
        `SELECT * FROM wallets WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToWallet(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get active wallet', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Get all wallets for a user
   */
  async getUserWallets(userId: number): Promise<Wallet[]> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM wallets WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows.map((row) => this.mapRowToWallet(row));
    } catch (error) {
      logger.error('Failed to get user wallets', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Get Keypair from wallet (decrypts private key)
   */
  async getKeypair(walletId: number): Promise<Keypair> {
    const wallet = await this.getWallet(walletId);
    if (!wallet) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    // Decrypt private key
    const decrypted = this.decrypt(wallet.encryptedPrivateKey);
    return Keypair.fromSecretKey(decrypted);
  }

  /**
   * Remove a wallet
   */
  async removeWallet(walletId: number): Promise<void> {
    try {
      await queryPostgres(`DELETE FROM wallets WHERE id = $1`, [walletId]);
    } catch (error) {
      logger.error('Failed to remove wallet', error as Error, { walletId });
      throw error;
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private encrypt(data: Uint8Array | Buffer): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine iv + authTag + encrypted data
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private decrypt(encryptedData: string): Buffer {
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract components
    const iv = combined.slice(0, 16);
    const authTag = combined.slice(16, 32);
    const encrypted = combined.slice(32);

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }

  /**
   * Map database row to Wallet
   */
  private mapRowToWallet(row: any): Wallet {
    return {
      id: parseInt(row.id),
      userId: parseInt(row.user_id),
      publicKey: row.public_key,
      encryptedPrivateKey: row.encrypted_private_key,
      name: row.name,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
    };
  }
}

