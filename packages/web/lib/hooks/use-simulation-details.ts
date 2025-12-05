/**
 * React Query hook for fetching simulation details
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { SimulationDetails } from '../types';

interface UseSimulationDetailsParams {
  name: string | null;
  enabled?: boolean;
}

export function useSimulationDetails({ name, enabled = true }: UseSimulationDetailsParams) {
  return useQuery<SimulationDetails>({
    queryKey: ['simulations', name],
    queryFn: () => api.get<SimulationDetails>(`/simulations/${encodeURIComponent(name!)}`),
    enabled: enabled && name !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

