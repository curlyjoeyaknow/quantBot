/**
 * Unit tests for analytics API routes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/analytics/route';

// Mock analytics engine
const mockAnalyzeCalls = vi.fn();
const mockGetAnalyticsEngine = vi.fn(() => ({
  analyzeCalls: mockAnalyzeCalls,
}));

vi.mock('@quantbot/analytics', () => ({
  getAnalyticsEngine: () => mockGetAnalyticsEngine(),
}));

describe('GET /api/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls analytics engine with correct parameters', async () => {
    const mockResult = {
      calls: [],
      callerMetrics: [],
      dashboard: {
        system: {
          totalCalls: 100,
          totalCallers: 5,
          totalTokens: 50,
          simulationsToday: 10,
        },
        topCallers: [],
        recentCalls: [],
        athDistribution: [],
        generatedAt: new Date('2024-01-01'),
      },
    };

    mockAnalyzeCalls.mockResolvedValue(mockResult);

    const request = new NextRequest('http://localhost:3000/api/analytics');
    const response = await GET(request);
    const data = await response.json();

    expect(mockAnalyzeCalls).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      callerNames: undefined,
      limit: undefined,
      enrichWithAth: false,
    });
    expect(response.status).toBe(200);
    expect(data.dashboard).toBeDefined();
  });

  it('parses query parameters correctly', async () => {
    const mockResult = {
      calls: [],
      callerMetrics: [],
      dashboard: {
        system: {
          totalCalls: 0,
          totalCallers: 0,
          totalTokens: 0,
          simulationsToday: 0,
        },
        topCallers: [],
        recentCalls: [],
        athDistribution: [],
        generatedAt: new Date('2024-01-01'),
      },
    };

    mockAnalyzeCalls.mockResolvedValue(mockResult);

    const request = new NextRequest(
      'http://localhost:3000/api/analytics?from=2024-01-01&to=2024-01-31&callerName=TestCaller&limit=10'
    );
    const response = await GET(request);

    expect(mockAnalyzeCalls).toHaveBeenCalledWith({
      from: new Date('2024-01-01'),
      to: new Date('2024-01-31'),
      callerNames: ['TestCaller'],
      limit: 10,
      enrichWithAth: false,
    });
    expect(response.status).toBe(200);
  });

  it('serializes Date objects to ISO strings', async () => {
    const testDate = new Date('2024-01-01T00:00:00Z');
    const mockResult = {
      calls: [
        {
          alertTimestamp: testDate,
          atlTimestamp: testDate,
        },
      ],
      callerMetrics: [
        {
          firstCall: testDate,
          lastCall: testDate,
        },
      ],
      dashboard: {
        generatedAt: testDate,
        recentCalls: [
          {
            alertTimestamp: testDate,
            atlTimestamp: testDate,
          },
        ],
        system: {
          totalCalls: 0,
          totalCallers: 0,
          totalTokens: 0,
          simulationsToday: 0,
        },
        topCallers: [],
        athDistribution: [],
      },
    };

    mockAnalyzeCalls.mockResolvedValue(mockResult);

    const request = new NextRequest('http://localhost:3000/api/analytics');
    const response = await GET(request);
    const data = await response.json();

    expect(data.calls[0].alertTimestamp).toBe(testDate.toISOString());
    expect(data.callerMetrics[0].firstCall).toBe(testDate.toISOString());
    expect(data.dashboard.generatedAt).toBe(testDate.toISOString());
  });

  it('handles errors gracefully', async () => {
    mockAnalyzeCalls.mockRejectedValue(new Error('Analytics engine error'));

    const request = new NextRequest('http://localhost:3000/api/analytics');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe('Analytics engine error');
  });
});
