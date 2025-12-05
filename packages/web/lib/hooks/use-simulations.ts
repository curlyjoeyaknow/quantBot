/**
 * React Query hook for fetching simulations list
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SimulationsResponse, Simulation } from '../types';

export function useSimulations() {
  return useQuery<Simulation[]>({
    queryKey: ['simulations'],
    queryFn: async () => {
      const response = await api.get<SimulationsResponse>('/simulations');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

