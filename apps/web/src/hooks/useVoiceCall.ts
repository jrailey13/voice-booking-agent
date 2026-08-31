import { useMutation, UseMutationResult, useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface VoiceCallResponse {
  callId: string;
  status: 'initiated' | 'connected' | 'ended';
  websocketUrl: string;
}

interface VoiceQuotaResponse {
  monthYear: string;
  minutesUsed: number;
  estimatedCost: number;
  requestCount: number;
  monthlyLimitUSD: number;
  remainingBudget: number;
  isLimited: boolean;
}

export const useStartCall = (): UseMutationResult<VoiceCallResponse, Error, void> => {
  return useMutation({
    mutationFn: () => api.voice.startCall(),
  });
};

export const useEndCall = (): UseMutationResult<void, Error, string> => {
  return useMutation({
    mutationFn: (callId: string) => api.voice.endCall(callId),
  });
};

export const useVoiceQuota = (): UseQueryResult<VoiceQuotaResponse, Error> => {
  return useQuery({
    queryKey: ['voiceQuota'],
    queryFn: () => api.voice.getQuota(),
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};
