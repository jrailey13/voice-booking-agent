// API Types and Interfaces

export interface RagUploadResponse {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'processing' | 'ready' | 'failed';
}

export interface RagQueryRequest {
  question: string;
  fileIds: string[];
}

export interface RagQueryResponse {
  id: string;
  answer: string;
  timestamp: string;
  sources?: Array<{
    title: string;
    snippet: string;
  }>;
}

export interface BookingAvailabilityResponse {
  date: string;
  availableSlots: Array<{
    time: string;
    available: boolean;
  }>;
}

export interface CreateAppointmentRequest {
  date: string;
  time: string;
  service: string;
}

export interface AppointmentResponse {
  id: string;
  date: string;
  time: string;
  service: string;
  status: 'confirmed' | 'pending' | 'cancelled';
}

export interface BookingChatRequest {
  message: string;
  conversationId?: string;
}

export interface BookingChatResponse {
  id: string;
  message: string;
  timestamp: string;
  conversationId: string;
}

export interface VoiceCallResponse {
  callId: string;
  status: 'initiated' | 'connected' | 'ended';
  websocketUrl: string;
}

export interface EndCallRequest {
  callId: string;
}

export interface WebSocketTranscriptMessage {
  type: 'transcript';
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface WebSocketStateMessage {
  type: 'state';
  state: 'connected' | 'speaking' | 'listening' | 'ended';
}

export type WebSocketMessage = WebSocketTranscriptMessage | WebSocketStateMessage;

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
