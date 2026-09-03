import { useState, useEffect, useRef } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, Mic, MicOff, AlertTriangle, Loader, DollarSign, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStartCall, useEndCall, useVoiceQuota } from '@/hooks/useVoiceCall';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import { VoiceConnection, createVoiceConnection, BookingData } from '@/lib/websocket';
import { elapsedSeconds } from '@/lib/audioDuration';
import { useToast } from '@/hooks/use-toast';

type CallState = 'idle' | 'connecting' | 'connected' | 'recording' | 'processing' | 'error' | 'ended';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  costEstimate?: number;
  timestamp: Date;
}

export default function VoiceAgent() {
  const [callState, setCallState] = useState<CallState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callId, setCallId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingData | null>(null);

  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionRef = useRef<VoiceConnection | null>(null);
  const recordStartRef = useRef<number>(0);

  const { toast } = useToast();
  const startCall = useStartCall();
  const endCall = useEndCall();
  const { data: quotaData, isLoading: quotaLoading } = useVoiceQuota();
  const audioCapture = useAudioCapture();

  // Call duration timer
  useEffect(() => {
    if (callState === 'connected' || callState === 'recording' || callState === 'processing') {
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callState]);

  const addTranscript = (role: 'user' | 'assistant', text: string, costEstimate?: number) => {
    setTranscript((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        role,
        text,
        costEstimate,
        timestamp: new Date(),
      },
    ]);
  };

  const handleStartCall = async () => {
    // Check quota first
    if (quotaData?.isLimited) {
      toast({
        title: 'Quota Exceeded',
        description: `Monthly Whisper quota exceeded. Used $${quotaData.estimatedCost.toFixed(2)} of $${quotaData.monthlyLimitUSD}`,
        variant: 'destructive',
      });
      return;
    }

    setCallState('connecting');
    setTranscript([]);
    setCallDuration(0);
    setBooking(null);

    try {
      const response = await startCall.mutateAsync();
      setCallId(response.callId);

      // Create WebSocket connection
      const connection = createVoiceConnection(response.callId, {
        onTranscript: (data) => {
          addTranscript(data.role, data.text, (data as any).costEstimate);
        },
        onStateChange: (state) => {
          console.log('[voice] server state:', state);
          if (state === 'connected') {
            setCallState('connected');
            toast({
              title: 'Connected',
              description: 'Click Record, speak, then click Stop & Send.',
            });
          } else if (state === 'processing') {
            setCallState('processing');
          } else if (state === 'listening') {
            // Server finished this turn (reply sent, or it errored and recovered).
            setCallState('connected');
          }
        },
        onBooking: (appointment) => {
          setBooking(appointment);
          toast({
            title: 'Appointment booked!',
            description: `${appointment.service} on ${appointment.date} at ${appointment.time}`,
          });
        },
        onError: (error) => {
          toast({
            title: 'Connection Error',
            description: error.message,
            variant: 'destructive',
          });
          setCallState('error');
        },
        onClose: () => {
          if (callState !== 'ended') {
            setCallState('ended');
          }
        },
      });

      connectionRef.current = connection;

      // Prime the mic now so the first recording can't stall on a permission
      // prompt (and any block surfaces immediately, not mid-record).
      const micOk = await audioCapture.requestPermission();
      if (!micOk) {
        toast({
          title: 'Microphone Unavailable',
          description:
            audioCapture.error ??
            'Could not access your microphone. Check Windows mic privacy settings and the browser mic permission.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Call Start Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setCallState('error');
    }
  };

  // Manual push-to-talk: start recording on click, keep going until the user
  // clicks Stop & Send. No fixed window, and an escape hatch at every step.
  const handleStartRecording = async () => {
    if (!connectionRef.current?.isConnected()) {
      toast({
        title: 'Not Connected',
        description: 'WebSocket connection is not established.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setCallState('recording');
      recordStartRef.current = Date.now();
      await audioCapture.startRecording();
      console.log('[voice] recording… click Stop & Send when done');
    } catch (error) {
      // startRecording rethrows on failure — surface it instead of freezing.
      toast({
        title: 'Microphone Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setCallState('connected');
    }
  };

  const handleStopAndSend = async () => {
    try {
      const audioBlob = await audioCapture.stopRecording();
      const durationSeconds = elapsedSeconds(recordStartRef.current, Date.now());

      if (!audioBlob || audioBlob.size === 0) {
        toast({
          title: 'No Audio Captured',
          description: 'Nothing was recorded — check your mic and try again.',
          variant: 'destructive',
        });
        setCallState('connected');
        return;
      }

      setCallState('processing');

      const reader = new FileReader();
      reader.onload = () => {
        const base64Audio = (reader.result as string).split(',')[1];
        console.log(
          '[voice] sending audio frame — base64 len =',
          base64Audio?.length,
          'duration =',
          durationSeconds
        );
        connectionRef.current?.send({
          type: 'audio',
          audio: base64Audio,
          durationSeconds,
        });
        // Stay in 'processing' until the server sends 'listening'.
      };
      reader.onerror = () => {
        toast({
          title: 'Encoding Error',
          description: 'Failed to encode the recording.',
          variant: 'destructive',
        });
        setCallState('connected');
      };
      reader.readAsDataURL(audioBlob);
    } catch (error) {
      toast({
        title: 'Recording Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setCallState('connected');
    }
  };

  const handleEndCall = async () => {
    if (callId) {
      try {
        await endCall.mutateAsync(callId);
      } catch (error) {
        console.error('Error ending call:', error);
      }
    }

    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }

    setCallState('ended');
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Voice Agent</h1>
          <p className="text-lg text-muted-foreground">
            Talk to our booking assistant powered by Whisper and AI
          </p>
        </div>

        {/* Quota Status */}
        {quotaData && (
          <Card className="mb-6 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-semibold">Whisper Usage</p>
                    <p className="text-sm text-muted-foreground">
                      ${quotaData.estimatedCost.toFixed(2)} of ${quotaData.monthlyLimitUSD} (
                      {quotaData.minutesUsed.toFixed(1)} minutes)
                    </p>
                  </div>
                </div>
                {quotaData.isLimited && (
                  <Badge variant="destructive">Quota Exceeded</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Audio Support Alert */}
        {!audioCapture.isSupported && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Audio Not Supported</AlertTitle>
            <AlertDescription>
              Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Edge.
            </AlertDescription>
          </Alert>
        )}

        {/* Permission Alert */}
        {audioCapture.error && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Audio Permission Required</AlertTitle>
            <AlertDescription>{audioCapture.error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Call Interface */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Call Interface</CardTitle>
                <CardDescription>
                  {callState === 'idle' && 'Ready to start a call'}
                  {callState === 'connecting' && 'Connecting...'}
                  {callState === 'connected' && 'Connected - Ready to record'}
                  {callState === 'recording' && 'Recording audio...'}
                  {callState === 'processing' && 'Processing audio...'}
                  {callState === 'error' && 'Call error occurred'}
                  {callState === 'ended' && 'Call ended'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Call Status */}
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Call Duration</p>
                    <p className="text-3xl font-bold font-mono">{formatTime(callDuration)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Status</p>
                    <Badge
                      className={cn(
                        'mt-2',
                        callState === 'idle' && 'bg-gray-500',
                        callState === 'connecting' && 'bg-yellow-500 animate-pulse',
                        callState === 'connected' && 'bg-green-500',
                        callState === 'recording' && 'bg-red-500 animate-pulse',
                        callState === 'processing' && 'bg-blue-500 animate-pulse',
                        callState === 'error' && 'bg-red-700',
                        callState === 'ended' && 'bg-gray-600'
                      )}
                    >
                      {callState}
                    </Badge>
                  </div>
                </div>

                {/* Transcript */}
                <div className="border rounded-lg bg-card">
                  <ScrollArea className="h-96">
                    <div className="p-4 space-y-4">
                      {transcript.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          Call transcript will appear here
                        </p>
                      ) : (
                        transcript.map((entry) => (
                          <div key={entry.id} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={entry.role === 'user' ? 'default' : 'secondary'}>
                                {entry.role}
                              </Badge>
                              {entry.costEstimate && (
                                <Badge variant="outline" className="text-xs">
                                  ${entry.costEstimate.toFixed(4)}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm">{entry.text}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Controls */}
                <div className="flex gap-4">
                  {callState === 'idle' && (
                    <Button
                      onClick={handleStartCall}
                      disabled={!audioCapture.isSupported || startCall.isPending || quotaLoading}
                      className="flex-1 gap-2"
                      size="lg"
                    >
                      {startCall.isPending ? (
                        <>
                          <Loader className="h-4 w-4 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Phone className="h-4 w-4" />
                          Start Call
                        </>
                      )}
                    </Button>
                  )}

                  {callState === 'connected' && (
                    <>
                      <Button
                        onClick={handleStartRecording}
                        className="flex-1 gap-2"
                        size="lg"
                      >
                        <Mic className="h-4 w-4" />
                        Record
                      </Button>
                      <Button
                        onClick={handleEndCall}
                        variant="destructive"
                        className="gap-2"
                        size="lg"
                      >
                        <PhoneOff className="h-4 w-4" />
                        End Call
                      </Button>
                    </>
                  )}

                  {callState === 'recording' && (
                    <>
                      <Button
                        onClick={handleStopAndSend}
                        variant="destructive"
                        className="flex-1 gap-2 animate-pulse"
                        size="lg"
                      >
                        <MicOff className="h-4 w-4" />
                        Stop &amp; Send
                      </Button>
                      <Button
                        onClick={handleEndCall}
                        variant="outline"
                        className="gap-2"
                        size="lg"
                      >
                        <PhoneOff className="h-4 w-4" />
                        End Call
                      </Button>
                    </>
                  )}

                  {callState === 'processing' && (
                    <Button
                      disabled
                      className="flex-1 gap-2"
                      size="lg"
                    >
                      <Loader className="h-4 w-4 animate-spin" />
                      Processing…
                    </Button>
                  )}

                  {(callState === 'error' || callState === 'ended') && (
                    <Button
                      onClick={() => {
                        setCallState('idle');
                        setTranscript([]);
                        setCallDuration(0);
                        setBooking(null);
                      }}
                      className="flex-1 gap-2"
                      size="lg"
                    >
                      <Phone className="h-4 w-4" />
                      New Call
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Info Panel */}
          <div className="space-y-4">
            {/* Confirmed Booking */}
            {booking && (
              <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-green-600" />
                    Appointment Confirmed
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Service:</span> <span className="font-medium capitalize">{booking.service}</span></p>
                  <p><span className="text-muted-foreground">Date:</span> <span className="font-medium">{booking.date}</span></p>
                  <p><span className="text-muted-foreground">Time:</span> <span className="font-medium">{booking.time}</span></p>
                  {booking.customerName && (
                    <p><span className="text-muted-foreground">Name:</span> <span className="font-medium">{booking.customerName}</span></p>
                  )}
                  {booking.customerContact && (
                    <p><span className="text-muted-foreground">Contact:</span> <span className="font-medium">{booking.customerContact}</span></p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">How It Works</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div>
                  <p className="font-semibold mb-1">1. Start Call</p>
                  <p className="text-muted-foreground">Click "Start Call" to initiate a voice connection</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">2. Record Audio</p>
                  <p className="text-muted-foreground">Click Record, speak, then click Stop &amp; Send</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">3. Get Response</p>
                  <p className="text-muted-foreground">AI converts speech to text and responds with booking assistance</p>
                </div>
                <div>
                  <p className="font-semibold mb-1">4. Track Costs</p>
                  <p className="text-muted-foreground">Each message shows estimated Whisper API cost</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Requirements</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex items-center gap-2">
                  {audioCapture.isSupported ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-red-600">✗</span>
                  )}
                  <span>Modern browser with audio support</span>
                </div>
                <div className="flex items-center gap-2">
                  {audioCapture.hasPermission ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-gray-400">○</span>
                  )}
                  <span>Microphone permission granted</span>
                </div>
                <div className="flex items-center gap-2">
                  {!quotaData?.isLimited ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-red-600">✗</span>
                  )}
                  <span>Monthly quota available</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
