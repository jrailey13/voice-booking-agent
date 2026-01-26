import { useMutation, UseMutationResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface VoiceCallResponse {
  callId: string;
  status: 'initiated' | 'connected' | 'ended';
  websocketUrl: string;
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
