/**
 * React Query hook for fetching callers list
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CallersResponse } from '../types';

export function useCallers() {
  return useQuery<string[]>({
    queryKey: ['callers'],
    queryFn: async () => {
      const response = await api.get<CallersResponse>('/callers');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

