/**
 * Wallet Manager Unit Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { WalletManager } from '../src/wallet/wallet-manager';

// Mock the queryPostgres function
const mockQueryPostgres = vi.fn();
vi.mock('@quantbot/data', () => ({
  queryPostgres: (...args: any[]) => mockQueryPostgres(...args),
}));

describe('WalletManager', () => {
  let walletManager: WalletManager;
  const testEncryptionKey = 'a'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    walletManager = new WalletManager({
      encryptionKey: testEncryptionKey,
    });
    mockQueryPostgres.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createWallet', () => {
    it('should create a new wallet with encrypted private key', async () => {
      const keypair = Keypair.generate();
      const userId = 123;

      mockQueryPostgres.mockResolvedValue({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: keypair.publicKey.toBase58(),
          encrypted_private_key: 'encrypted-key',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const wallet = await walletManager.createWallet(userId, keypair, 'solana');

      expect(wallet).toBeDefined();
      expect(wallet.id).toBe(1);
      expect(wallet.userId).toBe(123);
      expect(wallet.chain).toBe('solana');
      expect(wallet.publicKey).toBe(keypair.publicKey.toBase58());
      expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
    });

    it('should store encrypted private key in database', async () => {
      const keypair = Keypair.generate();
      
      mockQueryPostgres.mockResolvedValue({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: keypair.publicKey.toBase58(),
          encrypted_private_key: 'some-encrypted-data',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await walletManager.createWallet(123, keypair, 'solana');

      const call = mockQueryPostgres.mock.calls[0];
      const sql = call[0];
      const params = call[1];

      expect(sql).toContain('INSERT INTO wallets');
      expect(params).toHaveLength(4);
      expect(params[0]).toBe(123); // user_id
      expect(params[1]).toBe('solana'); // chain
      expect(params[2]).toBe(keypair.publicKey.toBase58()); // public_key
      expect(params[3]).toBeTruthy(); // encrypted_private_key (should not be empty)
    });
  });

  describe('getWallet', () => {
    it('should retrieve a wallet by ID', async () => {
      const publicKey = Keypair.generate().publicKey.toBase58();

      mockQueryPostgres.mockResolvedValue({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: publicKey,
          encrypted_private_key: 'encrypted-key',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const wallet = await walletManager.getWallet(1);

      expect(wallet).toBeDefined();
      expect(wallet?.id).toBe(1);
      expect(wallet?.publicKey).toBe(publicKey);
    });

    it('should return null for non-existent wallet', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const wallet = await walletManager.getWallet(999);

      expect(wallet).toBeNull();
    });
  });

  describe('getUserWallets', () => {
    it('should retrieve all wallets for a user', async () => {
      const publicKey1 = Keypair.generate().publicKey.toBase58();
      const publicKey2 = Keypair.generate().publicKey.toBase58();

      mockQueryPostgres.mockResolvedValue({
        rows: [
          {
            id: '1',
            user_id: '123',
            chain: 'solana',
            public_key: publicKey1,
            encrypted_private_key: 'encrypted-key-1',
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
          {
            id: '2',
            user_id: '123',
            chain: 'solana',
            public_key: publicKey2,
            encrypted_private_key: 'encrypted-key-2',
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const wallets = await walletManager.getUserWallets(123, 'solana');

      expect(wallets).toHaveLength(2);
      expect(wallets[0].publicKey).toBe(publicKey1);
      expect(wallets[1].publicKey).toBe(publicKey2);
    });

    it('should return empty array when no wallets found', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      const wallets = await walletManager.getUserWallets(123, 'solana');

      expect(wallets).toEqual([]);
    });
  });

  describe('deleteWallet', () => {
    it('should delete a wallet', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      await walletManager.deleteWallet(1);

      expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
      const call = mockQueryPostgres.mock.calls[0];
      expect(call[0]).toContain('DELETE FROM wallets');
      expect(call[1]).toEqual([1]);
    });
  });

  describe('getKeypair', () => {
    it('should decrypt and return keypair', async () => {
      const originalKeypair = Keypair.generate();
      
      // First, create the wallet
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: originalKeypair.publicKey.toBase58(),
          encrypted_private_key: 'will-be-encrypted',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await walletManager.createWallet(123, originalKeypair, 'solana');

      // Get the encrypted key from the create call
      const createCall = mockQueryPostgres.mock.calls[0];
      const encryptedKey = createCall[1][3]; // The encrypted private key parameter

      // Now mock getWallet to return the wallet with encrypted key
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: originalKeypair.publicKey.toBase58(),
          encrypted_private_key: encryptedKey,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      const decryptedKeypair = await walletManager.getKeypair(1);

      expect(decryptedKeypair).toBeDefined();
      expect(decryptedKeypair.publicKey.toBase58()).toBe(originalKeypair.publicKey.toBase58());
      // Note: Secret keys should match exactly
      expect(decryptedKeypair.secretKey).toEqual(originalKeypair.secretKey);
    });

    it('should throw error for non-existent wallet', async () => {
      mockQueryPostgres.mockResolvedValue({ rows: [] });

      await expect(walletManager.getKeypair(999)).rejects.toThrow('Wallet not found');
    });
  });

  describe('encryption/decryption', () => {
    it('should encrypt and decrypt private key correctly', async () => {
      const keypair = Keypair.generate();
      
      // Create wallet (encrypts the key)
      mockQueryPostgres.mockResolvedValueOnce({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: keypair.publicKey.toBase58(),
          encrypted_private_key: 'encrypted',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      await walletManager.createWallet(123, keypair, 'solana');

      const createCall = mockQueryPostgres.mock.calls[0];
      const encryptedKey = createCall[1][3];

      // The encrypted key should be different from the original
      const originalKeyBase58 = Buffer.from(keypair.secretKey).toString('base64');
      expect(encryptedKey).not.toBe(originalKeyBase58);

      // The encrypted key should be a non-empty string
      expect(encryptedKey).toBeTruthy();
      expect(typeof encryptedKey).toBe('string');
    });

    it('should produce different ciphertexts for same key (IV randomization)', async () => {
      const keypair = Keypair.generate();
      
      mockQueryPostgres.mockResolvedValue({
        rows: [{
          id: '1',
          user_id: '123',
          chain: 'solana',
          public_key: keypair.publicKey.toBase58(),
          encrypted_private_key: 'encrypted',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });

      // Create wallet twice with same keypair
      await walletManager.createWallet(123, keypair, 'solana');
      const encrypted1 = mockQueryPostgres.mock.calls[0][1][3];

      mockQueryPostgres.mockClear();
      await walletManager.createWallet(124, keypair, 'solana');
      const encrypted2 = mockQueryPostgres.mock.calls[0][1][3];

      // Due to random IV, encrypted values should be different
      expect(encrypted1).not.toBe(encrypted2);
    });
  });
});

