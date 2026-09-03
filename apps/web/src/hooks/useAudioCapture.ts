import { useRef, useState } from 'react';

interface AudioCapture {
  isSupported: boolean;
  isRecording: boolean;
  hasPermission: boolean;
  error: string | null;
  /** Prime/confirm mic access up front so recording never hangs on a prompt. */
  requestPermission: () => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
}

// getUserMedia can hang indefinitely when a permission prompt is left
// unanswered or the OS blocks the mic. Race it against a timeout so the UI
// surfaces a clear error instead of freezing forever.
const GUM_TIMEOUT_MS = 20000;

async function getMicStream(): Promise<MediaStream> {
  return Promise.race([
    navigator.mediaDevices.getUserMedia({ audio: true }),
    new Promise<MediaStream>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Microphone did not respond — check that a mic is connected and that you allowed access.'
            )
          ),
        GUM_TIMEOUT_MS
      )
    ),
  ]);
}

// Not every browser supports webm/opus (Safari doesn't). Pick the first
// container the browser can actually record; ffmpeg on the server decodes
// any of these. undefined lets MediaRecorder choose its own default.
function pickMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function friendlyMicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (/NotAllowed|Permission/i.test(msg)) {
    return 'Microphone permission denied — click the mic icon in the address bar and allow access.';
  }
  if (/NotFound|Devices/i.test(msg)) {
    return 'No microphone found — connect a mic and try again.';
  }
  return msg;
}

export const useAudioCapture = (): AudioCapture => {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!(
      navigator.mediaDevices?.getUserMedia ||
      (navigator as any).webkitGetUserMedia ||
      (navigator as any).mozGetUserMedia
    );

  const requestPermission = async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Audio recording not supported in this browser.');
      return false;
    }
    try {
      console.log('[audio] requesting microphone permission…');
      const stream = await getMicStream();
      // We only wanted to trigger/confirm the prompt — release immediately.
      stream.getTracks().forEach((t) => t.stop());
      setHasPermission(true);
      setError(null);
      console.log('[audio] microphone permission granted');
      return true;
    } catch (err) {
      const friendly = friendlyMicError(err);
      setError(friendly);
      setHasPermission(false);
      console.error('[audio] permission error:', friendly);
      return false;
    }
  };

  const startRecording = async (): Promise<void> => {
    if (!isSupported) {
      const msg = 'Audio recording not supported in this browser.';
      setError(msg);
      throw new Error(msg);
    }

    try {
      console.log('[audio] startRecording: acquiring mic…');
      const stream = await getMicStream();
      streamRef.current = stream;
      setHasPermission(true);
      setError(null);

      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onerror = (event: any) => {
        const msg = `Recording error: ${event?.error ?? 'unknown'}`;
        setError(msg);
        setIsRecording(false);
        console.error('[audio]', msg);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      console.log('[audio] recording started, mime =', mediaRecorder.mimeType);
    } catch (err) {
      const friendly = friendlyMicError(err);
      setError(friendly);
      setHasPermission(false);
      // Release any half-acquired stream so we don't leak the mic.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      console.error('[audio] startRecording failed:', friendly);
      throw new Error(friendly); // let the caller reset UI state and toast
    }
  };

  const stopRecording = async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current;
      if (!mediaRecorder) {
        console.warn('[audio] stopRecording called with no active recorder');
        resolve(null);
        return;
      }

      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setIsRecording(false);

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        console.log(
          '[audio] recording stopped — bytes =',
          audioBlob.size,
          'type =',
          type
        );
        resolve(audioBlob);
      };

      mediaRecorder.stop();
    });
  };

  return {
    isSupported,
    isRecording,
    hasPermission,
    error,
    requestPermission,
    startRecording,
    stopRecording,
  };
};
