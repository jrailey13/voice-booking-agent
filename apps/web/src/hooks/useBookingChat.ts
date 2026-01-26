import { useMutation, UseMutationResult, useQuery, UseQueryResult } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface BookingChatParams {
  message: string;
  conversationId?: string;
}

interface BookingChatResponse {
  id: string;
  message: string;
  timestamp: string;
  conversationId: string;
}

export const useBookingChat = (): UseMutationResult<BookingChatResponse, Error, BookingChatParams> => {
  return useMutation({
    mutationFn: ({ message, conversationId }: BookingChatParams) =>
      api.booking.sendMessage(message, conversationId),
  });
};

interface CreateAppointmentParams {
  date: string;
  time: string;
  service: string;
}

interface AppointmentResponse {
  id: string;
  date: string;
  time: string;
  service: string;
  status: 'confirmed' | 'pending' | 'cancelled';
}

export const useCreateAppointment = (): UseMutationResult<AppointmentResponse, Error, CreateAppointmentParams> => {
  return useMutation({
    mutationFn: (data: CreateAppointmentParams) => 
      api.booking.createAppointment(data),
  });
};

interface AvailabilityResponse {
  date: string;
  availableSlots: Array<{
    time: string;
    available: boolean;
  }>;
}

export const useAvailability = (date?: string): UseQueryResult<AvailabilityResponse, Error> => {
  return useQuery({
    queryKey: ['availability', date],
    queryFn: () => api.booking.checkAvailability(date!),
    enabled: !!date,
  });
};

export const useAppointments = (): UseQueryResult<AppointmentResponse[], Error> => {
  return useQuery({
    queryKey: ['appointments'],
    queryFn: () => api.booking.getAppointments(),
  });
};
