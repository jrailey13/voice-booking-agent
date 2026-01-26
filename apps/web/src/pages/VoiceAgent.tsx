import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, MessageSquare, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStartCall, useEndCall } from "@/hooks/useVoiceCall";
import { VoiceConnection, createVoiceConnection } from "@/lib/websocket";
import { useToast } from "@/hooks/use-toast";

type CallState = "idle" | "connecting" | "connected" | "speaking" | "listening" | "ended";

interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export default function VoiceAgent() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callId, setCallId] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionRef = useRef<VoiceConnection | null>(null);
  
  const { toast } = useToast();
  const startCall = useStartCall();
  const endCall = useEndCall();

  // Call duration timer
  useEffect(() => {
    if (callState === "connected" || callState === "speaking" || callState === "listening") {
      intervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [callState]);

  const addTranscript = (role: "user" | "assistant", text: string) => {
    setTranscript((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        role,
        text,
        timestamp: new Date(),
      },
    ]);
  };

  const handleStartCall = async () => {
    setCallState("connecting");
    setTranscript([]);
    setCallDuration(0);
    
    try {
      const response = await startCall.mutateAsync();
      setCallId(response.callId);
      
      // Create WebSocket connection
      const connection = createVoiceConnection(response.callId, {
        onTranscript: (data) => {
          addTranscript(data.role, data.text);
        },
        onStateChange: (state) => {
          if (state === "connected") {
            setCallState("connected");
          } else if (state === "speaking") {
            setCallState("speaking");
          } else if (state === "listening") {
            setCallState("listening");
          }
        },
        onError: (error) => {
          toast({
            title: "Connection error",
            description: error.message,
            variant: "destructive",
          });
          handleEndCall();
        },
        onClose: () => {
          if (callState !== "ended") {
            setCallState("ended");
          }
        },
      });
      
      connectionRef.current = connection;
    } catch (error) {
      toast({
        title: "Call failed",
        description: "Failed to start call. Please try again.",
        variant: "destructive",
      });
      setCallState("idle");
    }
  };

  const handleEndCall = async () => {
    if (callId) {
      try {
        await endCall.mutateAsync(callId);
      } catch (error) {
        console.error("Failed to end call:", error);
      }
    }
    
    // Close WebSocket connection
    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }
    
    setCallState("ended");
    addTranscript("assistant", "Thank you for calling. Goodbye!");
    setTimeout(() => {
      setCallState("idle");
      setCallId(null);
    }, 3000);
  };

  const simulateUserSpeech = () => {
    if (callState === "listening" || callState === "connected") {
      const userPhrases = [
        "I'd like to book an appointment for next Tuesday.",
        "What times do you have available in the afternoon?",
        "Yes, please confirm that booking.",
        "That works perfectly, thank you!",
      ];
      addTranscript("user", userPhrases[Math.floor(Math.random() * userPhrases.length)]);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const isCallActive = ["connecting", "connected", "speaking", "listening"].includes(callState);

  return (
    <Layout>
      <div className="container py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg gradient-bg flex items-center justify-center">
                <Phone className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Voice Agent</h1>
                <p className="text-muted-foreground">Talk to the AI booking assistant</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/booking-demo">
                <MessageSquare className="mr-2 h-4 w-4" />
                Switch to Text Chat
              </Link>
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Voice Interface */}
          <Card className="lg:col-span-1">
            <CardHeader className="text-center pb-2">
              <CardTitle>Voice Call</CardTitle>
              <CardDescription>
                {callState === "idle" && "Click the button to start a call"}
                {callState === "connecting" && "Connecting..."}
                {callState === "connected" && "Connected - Listening"}
                {callState === "speaking" && "AI is speaking..."}
                {callState === "listening" && "Listening to you..."}
                {callState === "ended" && "Call ended"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center pt-8 pb-12">
              {/* Audio Visualizer */}
              <div className="relative mb-8">
                {/* Pulse rings */}
                {isCallActive && (
                  <>
                    <div className="absolute inset-0 rounded-full gradient-bg animate-pulse-ring opacity-20" />
                    <div
                      className="absolute inset-0 rounded-full gradient-bg animate-pulse-ring opacity-20"
                      style={{ animationDelay: "0.5s" }}
                    />
                  </>
                )}
                
                {/* Main call button */}
                <button
                  onClick={isCallActive ? handleEndCall : handleStartCall}
                  className={cn(
                    "relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
                    isCallActive
                      ? "bg-destructive hover:bg-destructive/90"
                      : "gradient-bg hover:opacity-90"
                  )}
                >
                  {isCallActive ? (
                    <PhoneOff className="h-12 w-12 text-primary-foreground" />
                  ) : (
                    <Phone className="h-12 w-12 text-primary-foreground" />
                  )}
                </button>

                {/* Audio wave visualization */}
                {(callState === "speaking" || callState === "listening") && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-end gap-1 h-8">
                    {[...Array(7)].map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-1.5 rounded-full animate-wave",
                          callState === "speaking" ? "bg-primary" : "bg-accent"
                        )}
                        style={{
                          height: `${Math.random() * 20 + 10}px`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Call duration */}
              {isCallActive && (
                <div className="text-2xl font-mono font-bold mb-6">
                  {formatDuration(callDuration)}
                </div>
              )}

              {/* Status indicator */}
              <div className="flex items-center gap-2 mb-6">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    callState === "idle" && "bg-muted-foreground",
                    callState === "connecting" && "bg-warning animate-pulse",
                    (callState === "connected" || callState === "listening") && "bg-success",
                    callState === "speaking" && "bg-primary animate-pulse",
                    callState === "ended" && "bg-destructive"
                  )}
                />
                <span className="text-sm text-muted-foreground capitalize">{callState}</span>
              </div>

              {/* Call controls */}
              {isCallActive && (
                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("rounded-full h-12 w-12", isMuted && "bg-destructive/10")}
                    onClick={() => setIsMuted(!isMuted)}
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn("rounded-full h-12 w-12", isSpeakerOff && "bg-destructive/10")}
                    onClick={() => setIsSpeakerOff(!isSpeakerOff)}
                  >
                    {isSpeakerOff ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </Button>
                </div>
              )}

              {/* Demo: Simulate user speech button */}
              {(callState === "listening" || callState === "connected") && (
                <Button
                  variant="secondary"
                  className="mt-6"
                  onClick={simulateUserSpeech}
                >
                  Simulate Speaking
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Transcript Panel */}
          <Card className="lg:col-span-1 flex flex-col h-[500px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Live Transcript</CardTitle>
              <CardDescription>Real-time transcription of the conversation</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4">
                {transcript.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-center">
                    <div>
                      <Phone className="h-12 w-12 mx-auto mb-4 opacity-20" />
                      <p>Start a call to see the transcript</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {transcript.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "flex gap-3",
                          entry.role === "user" ? "flex-row-reverse" : ""
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-4 py-2",
                            entry.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="text-sm">{entry.text}</p>
                          <span className="text-xs opacity-70">
                            {entry.timestamp.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
