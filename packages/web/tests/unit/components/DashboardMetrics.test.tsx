/**
 * Unit tests for DashboardMetrics component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardMetrics } from '../../../app/components/dashboard/DashboardMetrics';

describe('DashboardMetrics', () => {
  const mockMetrics = {
    totalCalls: 1234,
    totalCallers: 42,
    totalTokens: 567,
    simulationsToday: 89,
  };

  it('renders all metric cards', () => {
    render(<DashboardMetrics metrics={mockMetrics} />);

    expect(screen.getByText('Total Calls')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();

    expect(screen.getByText('Total Callers')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();

    expect(screen.getByText('Total Tokens')).toBeTruthy();
    expect(screen.getByText('567')).toBeTruthy();

    expect(screen.getByText('Simulations Today')).toBeTruthy();
    expect(screen.getByText('89')).toBeTruthy();
  });

  it('formats large numbers correctly', () => {
    const largeMetrics = {
      totalCalls: 1234567,
      totalCallers: 100,
      totalTokens: 987654,
      simulationsToday: 5000,
    };

    render(<DashboardMetrics metrics={largeMetrics} />);

    expect(screen.getByText('1,234,567')).toBeTruthy();
    expect(screen.getByText('987,654')).toBeTruthy();
  });

  it('handles zero values', () => {
    const zeroMetrics = {
      totalCalls: 0,
      totalCallers: 0,
      totalTokens: 0,
      simulationsToday: 0,
    };

    render(<DashboardMetrics metrics={zeroMetrics} />);

    // All four metrics should show 0
    const zeroElements = screen.getAllByText('0');
    expect(zeroElements.length).toBeGreaterThanOrEqual(4);
  });
});

