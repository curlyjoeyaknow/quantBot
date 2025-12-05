/**
 * React Query hook for fetching optimization results
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { OptimizationsResponse, OptimizationResult } from '../types';

export function useOptimizations() {
  return useQuery<OptimizationResult[]>({
    queryKey: ['optimizations'],
    queryFn: async () => {
      const response = await api.get<OptimizationsResponse>('/optimizations');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

