/**
 * React Query hook for fetching dashboard metrics
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { DashboardMetrics } from '../types';

export function useDashboardMetrics() {
  return useQuery<DashboardMetrics>({
    queryKey: ['dashboard', 'metrics'],
    queryFn: () => api.get<DashboardMetrics>('/dashboard'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

