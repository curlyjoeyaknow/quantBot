/**
 * React Query hook for fetching recent alerts
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { RecentAlertsResponse } from '../types';
import { CONSTANTS } from '../constants';

interface UseRecentAlertsParams {
  page: number;
}

export function useRecentAlerts({ page }: UseRecentAlertsParams) {
  return useQuery<RecentAlertsResponse>({
    queryKey: ['recent-alerts', page],
    queryFn: () => {
      return api.get<RecentAlertsResponse>(
        `/recent-alerts?page=${page}&pageSize=${CONSTANTS.FRONTEND.RECENT_ALERTS_PAGE_SIZE}`
      );
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

