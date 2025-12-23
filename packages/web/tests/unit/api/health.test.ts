/**
 * Unit tests for health check API route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/health/route';

// Mock analytics engine
const mockGetAnalyticsEngine = vi.fn();
vi.mock('@quantbot/analytics', () => ({
  getAnalyticsEngine: () => mockGetAnalyticsEngine(),
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy status when all checks pass', async () => {
    mockGetAnalyticsEngine.mockReturnValue({});

    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.api).toBe(true);
    expect(data.checks.analytics).toBe(true);
    expect(data.checks.timestamp).toBeDefined();
    expect(data.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(data.version).toBeDefined();
  });

  it('returns degraded status when analytics engine is unavailable', async () => {
    mockGetAnalyticsEngine.mockImplementation(() => {
      throw new Error('Analytics engine unavailable');
    });

    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200); // API is still healthy
    expect(data.status).toBe('degraded');
    expect(data.checks.api).toBe(true);
    expect(data.checks.analytics).toBe(false);
  });

  it('returns unhealthy status on unexpected errors', async () => {
    // Mock a scenario that causes an error
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.error).toBeDefined();

    vi.restoreAllMocks();
  });

  it('includes response time in response', async () => {
    mockGetAnalyticsEngine.mockReturnValue({});

    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET();
    const data = await response.json();

    expect(data.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof data.responseTimeMs).toBe('number');
  });
});
