/**
 * React Query hook for fetching caller history with filters
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CallerHistoryResponse, CallerHistoryFilters } from '../types';
import { CONSTANTS } from '../constants';

interface UseCallerHistoryParams {
  page: number;
  filters: CallerHistoryFilters;
}

export function useCallerHistory({ page, filters }: UseCallerHistoryParams) {
  return useQuery<CallerHistoryResponse>({
    queryKey: ['caller-history', page, filters],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: CONSTANTS.FRONTEND.DEFAULT_PAGE_SIZE.toString(),
      });

      if (filters.caller) params.append('caller', filters.caller);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.minMarketCap) params.append('minMarketCap', filters.minMarketCap);
      if (filters.maxMarketCap) params.append('maxMarketCap', filters.maxMarketCap);
      if (filters.minMaxGain) params.append('minMaxGain', filters.minMaxGain);
      if (filters.maxMaxGain) params.append('maxMaxGain', filters.maxMaxGain);
      if (filters.isDuplicate !== '') params.append('isDuplicate', filters.isDuplicate);

      return api.get<CallerHistoryResponse>(`/caller-history?${params.toString()}`);
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

