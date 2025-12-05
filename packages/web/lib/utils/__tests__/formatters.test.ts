import { describe, it, expect } from 'vitest';
import { formatDate, formatCurrency, formatPercent, formatNumber, formatAbbreviated, getTimeAgo } from '../formatters';

describe('formatters', () => {
  describe('formatDate', () => {
    it('should format a valid date string', () => {
      const date = new Date('2024-01-15T10:30:00Z').toISOString();
      const result = formatDate(date);
      expect(result).toBeTruthy();
      expect(result).not.toBe('N/A');
    });

    it('should return N/A for null', () => {
      expect(formatDate(null)).toBe('N/A');
    });

    it('should return N/A for undefined', () => {
      expect(formatDate(undefined)).toBe('N/A');
    });
  });

  describe('formatCurrency', () => {
    it('should format a number as currency', () => {
      expect(formatCurrency(1234.56)).toContain('$');
      expect(formatCurrency(1234.56)).toContain('1,234.56');
    });

    it('should return N/A for null', () => {
      expect(formatCurrency(null)).toBe('N/A');
    });

    it('should accept custom fraction digits', () => {
      const result = formatCurrency(1234.5678, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
      expect(result).toContain('1,234.5678');
    });
  });

  describe('formatPercent', () => {
    it('should format positive percentage with + sign', () => {
      expect(formatPercent(5.5)).toBe('+5.50%');
    });

    it('should format negative percentage', () => {
      expect(formatPercent(-5.5)).toBe('-5.50%');
    });

    it('should return N/A for null', () => {
      expect(formatPercent(null)).toBe('N/A');
    });
  });

  describe('formatNumber', () => {
    it('should format a number', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56');
    });

    it('should return N/A for null', () => {
      expect(formatNumber(null)).toBe('N/A');
    });
  });

  describe('formatAbbreviated', () => {
    it('should format millions', () => {
      expect(formatAbbreviated(1500000)).toBe('$1.50M');
    });

    it('should format thousands', () => {
      expect(formatAbbreviated(1500)).toBe('$1.50K');
    });

    it('should format small numbers', () => {
      expect(formatAbbreviated(150)).toBe('$150.00');
    });
  });

  describe('getTimeAgo', () => {
    it('should return "Just now" for recent dates', () => {
      const recent = new Date(Date.now() - 30 * 1000).toISOString();
      expect(getTimeAgo(recent)).toBe('Just now');
    });

    it('should return minutes ago', () => {
      const minutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(getTimeAgo(minutesAgo)).toContain('minute');
    });

    it('should return N/A for null', () => {
      expect(getTimeAgo(null)).toBe('N/A');
    });
  });
});

