/**
 * React Query hook for fetching system health status
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { HealthData } from '../types';
import { CONSTANTS } from '../constants';

interface UseHealthParams {
  enabled?: boolean;
}

export function useHealth({ enabled = true }: UseHealthParams = {}) {
  return useQuery<HealthData>({
    queryKey: ['health', 'detailed'],
    queryFn: () => api.get<HealthData>('/health/detailed'),
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: enabled ? CONSTANTS.FRONTEND.HEALTH_REFRESH_INTERVAL : false,
    enabled,
  });
}

