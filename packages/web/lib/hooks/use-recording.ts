/**
 * React Query hook for fetching recording status
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { RecordingData } from '../types';
import { CONSTANTS } from '../constants';

interface UseRecordingParams {
  enabled?: boolean;
}

export function useRecording({ enabled = true }: UseRecordingParams = {}) {
  return useQuery<RecordingData>({
    queryKey: ['recording'],
    queryFn: () => api.get<RecordingData>('/recording'),
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: enabled ? CONSTANTS.FRONTEND.RECORDING_REFRESH_INTERVAL : false,
    enabled,
  });
}

