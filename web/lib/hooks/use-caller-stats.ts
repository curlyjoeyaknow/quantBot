/**
 * React Query hook for fetching caller statistics
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CallerStatsData } from '../types';

export function useCallerStats() {
  return useQuery<CallerStatsData>({
    queryKey: ['callers', 'stats'],
    queryFn: () => api.get<CallerStatsData>('/callers/stats'),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

