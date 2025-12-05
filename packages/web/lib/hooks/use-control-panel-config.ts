/**
 * React Query hook for fetching and updating control panel configuration
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ControlPanelConfigResponse, ConfigValue } from '../types';
import { toastSuccess, toastError } from '../utils/toast';

export function useControlPanelConfig() {
  return useQuery<ConfigValue[]>({
    queryKey: ['control-panel', 'config'],
    queryFn: async () => {
      const response = await api.get<ControlPanelConfigResponse>('/control-panel/config');
      return response.config;
    },
    staleTime: 5 * 1000, // 5 seconds
  });
}

export function useControlPanelConfigUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return api.post('/control-panel/config', { key, value });
    },
    onSuccess: (_, variables) => {
      toastSuccess('Configuration updated', `Successfully updated ${variables.key}`);
      queryClient.invalidateQueries({ queryKey: ['control-panel', 'config'] });
    },
    onError: (error: unknown, variables) => {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toastError('Failed to update configuration', errorMsg);
    },
  });
}

