const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface RagUploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processing' | 'ready' | 'failed';
}

interface RagQueryResponse {
  id: string;
  answer: string;
  timestamp: string;
  sources?: Array<{
    title: string;
    snippet: string;
  }>;
}

interface BookingAvailabilityResponse {
  date: string;
  availableSlots: Array<{
    time: string;
    available: boolean;
  }>;
}

interface BookingAppointmentResponse {
  id: string;
  date: string;
  time: string;
  service: string;
  status: 'confirmed' | 'pending' | 'cancelled';
}

interface CommittedBooking {
  id: string;
  date: string;
  time: string;
  service: string;
  customerName: string | null;
  customerContact: string | null;
}

interface BookingChatResponse {
  id: string;
  message: string;
  timestamp: string;
  conversationId: string;
  appointment?: CommittedBooking;
}

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

export const api = {
  // RAG endpoints
  rag: {
    uploadDocument: async (file: File): Promise<RagUploadResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE_URL}/rag/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    query: async (question: string, fileIds: string[]): Promise<RagQueryResponse> => {
      const response = await fetch(`${API_BASE_URL}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, fileIds }),
      });
      
      if (!response.ok) {
        throw new Error(`Query failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    deleteDocument: async (fileId: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/rag/documents/${fileId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.statusText}`);
      }
    },
  },
  
  // Booking endpoints
  booking: {
    checkAvailability: async (date: string): Promise<BookingAvailabilityResponse> => {
      const response = await fetch(`${API_BASE_URL}/booking/availability?date=${date}`);
      
      if (!response.ok) {
        throw new Error(`Availability check failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    createAppointment: async (data: {
      date: string;
      time: string;
      service: string;
    }): Promise<BookingAppointmentResponse> => {
      const response = await fetch(`${API_BASE_URL}/booking/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`Appointment creation failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    sendMessage: async (
      message: string,
      conversationId?: string
    ): Promise<BookingChatResponse> => {
      const response = await fetch(`${API_BASE_URL}/booking/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId }),
      });
      
      if (!response.ok) {
        throw new Error(`Chat message failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    getAppointments: async (): Promise<BookingAppointmentResponse[]> => {
      const response = await fetch(`${API_BASE_URL}/booking/appointments`);
      
      if (!response.ok) {
        throw new Error(`Get appointments failed: ${response.statusText}`);
      }
      
      return response.json();
    },
  },
  
  // Voice agent endpoints
  voice: {
    startCall: async (): Promise<VoiceCallResponse> => {
      const response = await fetch(`${API_BASE_URL}/voice/start`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error(`Call start failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    
    endCall: async (callId: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/voice/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
      
      if (!response.ok) {
        throw new Error(`Call end failed: ${response.statusText}`);
      }
    },

    getQuota: async (): Promise<VoiceQuotaResponse> => {
      const response = await fetch(`${API_BASE_URL}/voice/quota`);
      
      if (!response.ok) {
        throw new Error(`Quota check failed: ${response.statusText}`);
      }
      
      return response.json();
    },
  },
};
