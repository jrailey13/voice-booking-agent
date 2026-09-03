import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { prisma } from '../lib/database';
import { transcribeAudio, checkWhisperQuota, getMonthlyUsageStats } from '../lib/whisper';
import { generateBookingResponse } from '../lib/llm';
import { maybeCommitBooking } from '../lib/booking.commit';

interface StartCallResult {
  callId: string;
  status: 'initiated' | 'connected' | 'ended';
  websocketUrl: string;
}

interface CallMetadata {
  id: string;
  callId: string;
  startedAt: Date;
  status: 'initiated' | 'connected' | 'ended';
  durationSeconds: number;
  transcript: string;
  audioChunks: Buffer[];
  conversationId?: string;
}

export class VoiceService {
  private activeCalls: Map<string, CallMetadata> = new Map();

  async startCall(): Promise<StartCallResult> {
    const callId = crypto.randomUUID();

    // Create voice call record in database
    const voiceCall = await prisma.voiceCall.create({
      data: {
        callId,
        status: 'initiated',
      },
    });

    // Create conversation for this call
    const conversation = await prisma.conversation.create({
      data: {},
    });

    this.activeCalls.set(callId, {
      id: voiceCall.id,
      callId,
      startedAt: new Date(),
      status: 'initiated',
      durationSeconds: 0,
      transcript: '',
      audioChunks: [],
      conversationId: conversation.id,
    });

    return {
      callId,
      status: 'initiated',
      websocketUrl: `/voice/${callId}`,
    };
  }

  async endCall(callId: string): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) return;

    // Calculate duration
    const durationSeconds = Math.round(
      (Date.now() - call.startedAt.getTime()) / 1000
    );

    // Update voice call in database
    await prisma.voiceCall.update({
      where: { callId },
      data: {
        status: 'ended',
        durationSeconds,
        transcript: call.transcript,
        endedAt: new Date(),
      },
    });

    this.activeCalls.delete(callId);
  }

  async handleWebSocketMessage(callId: string, data: any, socket: WebSocket): Promise<void> {
    const call = this.activeCalls.get(callId);
    if (!call) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Call not found',
      }));
      return;
    }

    // Handle different message types
    switch (data.type) {
      case 'audio':
        await this.handleAudioData(callId, data, socket, call);
        break;

      case 'mute':
        // Handle mute toggle
        socket.send(JSON.stringify({
          type: 'state',
          state: 'muted',
        }));
        break;

      case 'quota':
        // Send current quota info
        const usage = await getMonthlyUsageStats();
        socket.send(JSON.stringify({
          type: 'quota',
          data: usage,
        }));
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  }

  private async handleAudioData(
    callId: string,
    data: any,
    socket: WebSocket,
    call: CallMetadata
  ): Promise<void> {
    try {
      // Check quota first
      const quotaStatus = await checkWhisperQuota();
      if (!quotaStatus.isAllowed) {
        socket.send(JSON.stringify({
          type: 'error',
          message: `Quota exceeded: ${quotaStatus.reason}`,
          quotaStatus,
        }));
        return;
      }

      // Get audio buffer from WebSocket data. The client sends the audio as a
      // base64 string, so it MUST be decoded as base64 — Buffer.from(str)
      // defaults to utf-8 and would corrupt every byte before Whisper sees it.
      const audioBuffer = Buffer.from(data.audio, 'base64');
      const durationSeconds = data.durationSeconds || 10; // Default estimate if not provided

      // Send processing state
      socket.send(JSON.stringify({
        type: 'state',
        state: 'processing',
      }));

      // Per-stage latency instrumentation. The perceived "how long until it
      // answers" number is sttMs + llmMs (+ commitMs on the confirming turn);
      // these are logged so a real run yields a measured figure, not a guess.
      const turnStart = Date.now();

      // Transcribe audio using Whisper
      let transcript = '';
      let costEstimate = 0;
      let sttMs = 0;

      try {
        const sttStart = Date.now();
        const result = await transcribeAudio(audioBuffer, durationSeconds);
        sttMs = Date.now() - sttStart;
        transcript = result.text;
        costEstimate = result.costEstimate;
        call.transcript += (call.transcript ? ' ' : '') + transcript;
      } catch (error) {
        console.error('Whisper transcription error:', error);
        socket.send(JSON.stringify({
          type: 'error',
          message: `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }));
        
        // Send listening state so user can retry
        socket.send(JSON.stringify({
          type: 'state',
          state: 'listening',
        }));
        return;
      }

      // Dev-only: when CAPTURE_AUDIO=1, persist each clip (and what Whisper
      // heard) so real UI turns become replayable STT fixtures. No-op otherwise.
      await this.captureFixture(callId, audioBuffer, transcript);

      // Send transcript to user
      socket.send(JSON.stringify({
        type: 'transcript',
        role: 'user',
        text: transcript,
        costEstimate,
        timestamp: new Date().toISOString(),
      }));

      // Save user message to conversation
      if (call.conversationId) {
        await prisma.conversationMessage.create({
          data: {
            conversationId: call.conversationId,
            role: 'user',
            content: transcript,
          },
        });

        // Generate booking response
        const llmStart = Date.now();
        const assistantResponse = await generateBookingResponse(transcript, call.conversationId);
        const llmMs = Date.now() - llmStart;

        // Send assistant response
        socket.send(JSON.stringify({
          type: 'transcript',
          role: 'assistant',
          text: assistantResponse,
          timestamp: new Date().toISOString(),
        }));

        // Save assistant message
        await prisma.conversationMessage.create({
          data: {
            conversationId: call.conversationId,
            role: 'assistant',
            content: assistantResponse,
          },
        });

        // If the conversation has reached a concrete, available booking, commit
        // it and tell the client so it can surface the confirmed appointment.
        const commitStart = Date.now();
        const appointment = await maybeCommitBooking(call.conversationId);
        const commitMs = Date.now() - commitStart;
        if (appointment) {
          socket.send(JSON.stringify({
            type: 'booking',
            appointment,
            timestamp: new Date().toISOString(),
          }));
        }

        // The user-perceived latency is response-start after they stop talking:
        // STT + LLM, plus the extraction pass only on the turn that commits.
        console.log(
          `⏱️  turn latency: stt=${sttMs}ms llm=${llmMs}ms commit=${commitMs}ms ` +
            `total=${Date.now() - turnStart}ms`
        );
      }

      // Send listening state to indicate ready for next input
      socket.send(JSON.stringify({
        type: 'state',
        state: 'listening',
      }));
    } catch (error) {
      console.error('Error handling audio data:', error);
      socket.send(JSON.stringify({
        type: 'error',
        message: `Error processing audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }));
    }
  }

  /**
   * Dev-only fixture capture. Gated behind CAPTURE_AUDIO=1 so it is inert in
   * normal runs. Writes the raw clip the browser sent (webm/opus — the exact
   * bytes the decode+STT path consumes) plus a sidecar of what Whisper heard,
   * so a real UI turn can be replayed as a deterministic STT test. Best-effort:
   * a capture failure must never break the call.
   */
  private async captureFixture(
    callId: string,
    audioBuffer: Buffer,
    transcript: string
  ): Promise<void> {
    if (process.env.CAPTURE_AUDIO !== '1') return;
    try {
      const dir = path.join(process.cwd(), 'test', 'fixtures', 'audio');
      await fs.mkdir(dir, { recursive: true });
      const stamp = `${Date.now()}-${callId.slice(0, 8)}`;
      await fs.writeFile(path.join(dir, `${stamp}.webm`), audioBuffer);
      await fs.writeFile(path.join(dir, `${stamp}.txt`), transcript, 'utf8');
      console.log(`🎙️  captured fixture ${stamp} — heard: "${transcript}"`);
    } catch (error) {
      console.error('Fixture capture failed (ignored):', error);
    }
  }

  cleanupCall(callId: string): void {
    const call = this.activeCalls.get(callId);
    if (call) {
      // Update database with final state
      prisma.voiceCall.update({
        where: { callId },
        data: {
          status: 'ended',
          durationSeconds: Math.round((Date.now() - call.startedAt.getTime()) / 1000),
          transcript: call.transcript,
          endedAt: new Date(),
        },
      }).catch((error) => console.error('Error updating call:', error));
    }

    this.activeCalls.delete(callId);
  }
}
