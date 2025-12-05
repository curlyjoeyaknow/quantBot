/**
 * React Query hooks for live trade strategies
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LiveTradeStrategy } from '../types/live-trade';

interface StrategiesResponse {
  strategies: LiveTradeStrategy[];
}

export function useLiveTradeStrategies() {
  return useQuery<StrategiesResponse>({
    queryKey: ['live-trade-strategies'],
    queryFn: () => api.get<StrategiesResponse>('/live-trade/strategies'),
    staleTime: 30 * 1000,
  });
}

export function useUpdateLiveTradeStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ strategyId, enabled }: { strategyId: string; enabled: boolean }) => {
      return api.put('/live-trade/strategies', { strategyId, enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['live-trade-strategies'] });
    },
  });
}

export function useUpdateLiveTradeStrategies() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (strategies: LiveTradeStrategy[]) => {
      return api.post('/live-trade/strategies', { strategies });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['live-trade-strategies'] });
    },
  });
}

