/**
 * React Query hook for fetching control panel services status
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ControlPanelServicesResponse, ControlPanelServiceStatus } from '../types';
import { CONSTANTS } from '../constants';
import { toastSuccess, toastError } from '../utils/toast';

export function useControlPanelServices() {
  return useQuery<ControlPanelServiceStatus[]>({
    queryKey: ['control-panel', 'services'],
    queryFn: async () => {
      const response = await api.get<ControlPanelServicesResponse>('/control-panel/services');
      return response.services;
    },
    staleTime: 5 * 1000, // 5 seconds
    refetchInterval: CONSTANTS.FRONTEND.CONTROL_PANEL_REFRESH_INTERVAL,
  });
}

export function useControlPanelServiceAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ service, action }: { service: string; action: 'start' | 'stop' }) => {
      return api.post<{ success: boolean; message?: string; error?: string }>(
        '/control-panel/services',
        { service, action }
      );
    },
    onSuccess: (data, variables) => {
      if (data.success) {
        toastSuccess(
          `Service ${variables.action === 'start' ? 'started' : 'stopped'}`,
          data.message
        );
        // Invalidate and refetch after a delay
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['control-panel', 'services'] });
        }, 2000);
      } else {
        toastError('Failed to update service', data.error);
      }
    },
    onError: (error: unknown, variables) => {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      toastError(
        `Failed to ${variables.action} service`,
        errorMsg
      );
    },
  });
}

