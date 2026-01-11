import { describe, it, expect } from 'vitest';
import {
  createPosition,
  executeEntry,
  executeExit,
  updatePosition,
  calculateUnrealizedPnl,
  calculateTotalPnl,
  calculatePnlPercent,
  getPositionSummary,
  isPositionOpen,
  isPositionClosed,
  canReEntry,
} from '../../../src/position/position';
import type { Position } from '../../../src/types';

describe('Position Management', () => {
  describe('createPosition', () => {
    it('should create a new position', () => {
      const position = createPosition({
        tokenAddress: '7pXs123456789012345678901234567890pump',
        chain: 'solana',
        side: 'long',
        initialSize: 1.0,
        maxReEntries: 3,
      });
      expect(position.status).toBe('pending');
      expect(position.tokenAddress).toBe('7pXs123456789012345678901234567890pump');
      expect(position.chain).toBe('solana');
      expect(position.side).toBe('long');
      expect(position.initialSize).toBe(1.0);
      expect(position.maxReEntries).toBe(3);
    });
  });

  describe('executeEntry', () => {
    it('should execute entry and update position', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 0.5,
        reason: 'initial',
      });
      expect(entryPosition.status).toBe('open');
      expect(entryPosition.size).toBe(0.5);
      expect(entryPosition.averageEntryPrice).toBe(1.0);
      expect(entryPosition.openTimestamp).toBe(1000);
    });

    it('should calculate weighted average entry price', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      let entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 0.5,
        reason: 'initial',
      });
      entryPosition = executeEntry(entryPosition, {
        timestamp: 2000,
        price: 2.0,
        size: 0.5,
        reason: 're_entry',
      });
      expect(entryPosition.averageEntryPrice).toBe(1.5); // (1.0 * 0.5 + 2.0 * 0.5) / 1.0
      expect(entryPosition.size).toBe(1.0);
    });
  });

  describe('executeExit', () => {
    it('should execute exit and calculate PnL', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 1.0,
        reason: 'initial',
      });
      const exitPosition = executeExit(entryPosition, {
        timestamp: 2000,
        price: 2.0,
        size: 0.5,
        reason: 'target',
      });
      expect(exitPosition.size).toBe(0.5);
      expect(exitPosition.realizedPnl).toBe(0.5); // (2.0 - 1.0) * 0.5
    });

    it('should close position when fully exited', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 1.0,
        reason: 'initial',
      });
      const exitPosition = executeExit(entryPosition, {
        timestamp: 2000,
        price: 2.0,
        size: 1.0,
        reason: 'target',
      });
      expect(exitPosition.status).toBe('closed');
      expect(exitPosition.size).toBe(0);
      expect(exitPosition.closeTimestamp).toBe(2000);
    });
  });

  describe('calculateUnrealizedPnl', () => {
    it('should calculate unrealized PnL for long position', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
        side: 'long',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 1.0,
        reason: 'initial',
      });
      const unrealizedPnl = calculateUnrealizedPnl(entryPosition, 2.0);
      expect(unrealizedPnl).toBe(1.0); // (2.0 - 1.0) * 1.0
    });

    it('should return 0 for closed position', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const unrealizedPnl = calculateUnrealizedPnl(position, 2.0);
      expect(unrealizedPnl).toBe(0);
    });
  });

  describe('calculateTotalPnl', () => {
    it('should calculate total PnL (realized + unrealized)', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 1.0,
        reason: 'initial',
      });
      const exitPosition = executeExit(entryPosition, {
        timestamp: 2000,
        price: 2.0,
        size: 0.5,
        reason: 'target',
      });
      const totalPnl = calculateTotalPnl(exitPosition, 2.5);
      expect(totalPnl).toBeGreaterThan(0.5); // Realized + unrealized
    });
  });

  describe('isPositionOpen', () => {
    it('should return true for open position', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      const entryPosition = executeEntry(position, {
        timestamp: 1000,
        price: 1.0,
        size: 1.0,
        reason: 'initial',
      });
      expect(isPositionOpen(entryPosition)).toBe(true);
    });

    it('should return false for closed position', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
      });
      expect(isPositionOpen(position)).toBe(false);
    });
  });

  describe('canReEntry', () => {
    it('should allow re-entry if under max count', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
        maxReEntries: 3,
      });
      expect(canReEntry(position)).toBe(true);
    });

    it('should not allow re-entry if max count reached', () => {
      const position = createPosition({
        tokenAddress: 'test',
        chain: 'solana',
        maxReEntries: 1,
      });
      position.reEntryCount = 1;
      expect(canReEntry(position)).toBe(false);
    });
  });
});
