import { describe, it, expect } from 'vitest';
import {
  createPortfolio,
  openPosition,
  closePosition,
  partialExit,
  getPosition,
  getPositionsByToken,
  getOpenPositions,
  getClosedPositions,
  calculatePortfolioMetrics,
} from '../../../src/position/portfolio';
import type { Portfolio } from '../../../src/position/portfolio';

describe('Portfolio Management', () => {
  describe('createPortfolio', () => {
    it('should create a new portfolio', () => {
      const portfolio = createPortfolio(1000);
      expect(portfolio.initialCapital).toBe(1000);
      expect(portfolio.currentCapital).toBe(1000);
      expect(portfolio.positions.size).toBe(0);
    });
  });

  describe('openPosition', () => {
    it('should open a new position in portfolio', () => {
      const portfolio = createPortfolio(1000);
      const { portfolio: updatedPortfolio, position } = openPosition(
        portfolio,
        {
          tokenAddress: 'test',
          chain: 'solana',
        },
        {
          timestamp: 1000,
          price: 1.0,
          size: 1.0,
          reason: 'initial',
        }
      );
      expect(updatedPortfolio.positions.size).toBe(1);
      expect(updatedPortfolio.positions.has(position.id)).toBe(true);
      expect(position.status).toBe('open');
    });
  });

  describe('closePosition', () => {
    it('should close a position in portfolio', () => {
      const portfolio = createPortfolio(1000);
      const { portfolio: portfolioWithPosition, position } = openPosition(
        portfolio,
        {
          tokenAddress: 'test',
          chain: 'solana',
        },
        {
          timestamp: 1000,
          price: 1.0,
          size: 1.0,
          reason: 'initial',
        }
      );
      const { portfolio: closedPortfolio } = closePosition(portfolioWithPosition, position.id, {
        timestamp: 2000,
        price: 2.0,
        size: 1.0,
        reason: 'target',
      });
      const closedPosition = closedPortfolio.positions.get(position.id);
      expect(closedPosition?.status).toBe('closed');
      expect(closedPosition?.size).toBe(0);
    });
  });

  describe('partialExit', () => {
    it('should partially exit a position', () => {
      const portfolio = createPortfolio(1000);
      const { portfolio: portfolioWithPosition, position } = openPosition(
        portfolio,
        {
          tokenAddress: 'test',
          chain: 'solana',
        },
        {
          timestamp: 1000,
          price: 1.0,
          size: 1.0,
          reason: 'initial',
        }
      );
      const { portfolio: updatedPortfolio } = partialExit(portfolioWithPosition, position.id, {
        timestamp: 2000,
        price: 2.0,
        size: 0.5,
        reason: 'target',
      });
      const updatedPosition = updatedPortfolio.positions.get(position.id);
      expect(updatedPosition?.size).toBe(0.5);
      expect(updatedPosition?.status).toBe('open');
    });
  });

  describe('getOpenPositions', () => {
    it('should return only open positions', () => {
      const portfolio = createPortfolio(1000);
      const { portfolio: p1, position: pos1 } = openPosition(
        portfolio,
        { tokenAddress: 'test1', chain: 'solana' },
        { timestamp: 1000, price: 1.0, size: 1.0, reason: 'initial' }
      );
      const { portfolio: p2 } = openPosition(
        p1,
        { tokenAddress: 'test2', chain: 'solana' },
        { timestamp: 2000, price: 1.0, size: 1.0, reason: 'initial' }
      );
      const { portfolio: p3 } = closePosition(p2, pos1.id, {
        timestamp: 3000,
        price: 2.0,
        size: 1.0,
        reason: 'target',
      });
      const openPositions = getOpenPositions(p3);
      expect(openPositions.length).toBe(1);
    });
  });

  describe('calculatePortfolioMetrics', () => {
    it('should calculate portfolio metrics', () => {
      const portfolio = createPortfolio(1000);
      const { portfolio: p1, position: pos1 } = openPosition(
        portfolio,
        { tokenAddress: 'test', chain: 'solana' },
        { timestamp: 1000, price: 1.0, size: 1.0, reason: 'initial' }
      );
      const { portfolio: p2 } = closePosition(p1, pos1.id, {
        timestamp: 2000,
        price: 2.0,
        size: 1.0,
        reason: 'target',
      });
      const metrics = calculatePortfolioMetrics(p2);
      expect(metrics.totalPositions).toBe(1);
      expect(metrics.closedPositions).toBe(1);
      expect(metrics.winners).toBe(1);
      expect(metrics.winRate).toBe(1.0);
    });
  });
});
