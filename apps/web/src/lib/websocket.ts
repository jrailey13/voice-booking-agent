const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/api';

export interface TranscriptData {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface VoiceConnectionCallbacks {
  onTranscript?: (data: TranscriptData) => void;
  onStateChange?: (state: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export class VoiceConnection {
  private ws: WebSocket | null = null;
  private callbacks: VoiceConnectionCallbacks;

  constructor(callbacks: VoiceConnectionCallbacks) {
    this.callbacks = callbacks;
  }

  connect(callId: string): void {
    this.ws = new WebSocket(`${WS_BASE_URL}/voice/${callId}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.callbacks.onStateChange?.('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'transcript':
            this.callbacks.onTranscript?.(data);
            break;
          case 'state':
            this.callbacks.onStateChange?.(data.state);
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        this.callbacks.onError?.(error as Error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.callbacks.onError?.(new Error('WebSocket connection error'));
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.callbacks.onClose?.();
    };
  }

  send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const createVoiceConnection = (
  callId: string,
  callbacks: VoiceConnectionCallbacks
): VoiceConnection => {
  const connection = new VoiceConnection(callbacks);
  connection.connect(callId);
  return connection;
};
