import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { Message } from "@/components/chat/ChatMessage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, MessageSquare, Phone, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { useBookingChat, useAppointments, useCreateAppointment } from "@/hooks/useBookingChat";
import { useToast } from "@/hooks/use-toast";

interface Appointment {
  id: string;
  date: Date;
  time: string;
  service: string;
}

export default function BookingDemo() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I'm your booking assistant. I can help you schedule appointments, check availability, and manage your bookings. How can I assist you today?",
      timestamp: new Date(),
    },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  
  const { toast } = useToast();
  const bookingChat = useBookingChat();
  const createAppointment = useCreateAppointment();
  const { data: appointmentsData } = useAppointments();

  const handleSendMessage = async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const response = await bookingChat.mutateAsync({
        message: content,
        conversationId,
      });
      
      // Update conversation ID for context
      setConversationId(response.conversationId);

      const assistantMessage: Message = {
        id: response.id,
        role: "assistant",
        content: response.message,
        timestamp: new Date(response.timestamp),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      toast({
        title: "Message failed",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      
      // Remove the user message if the query failed
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsTyping(false);
    }
  };

  // Get dates with appointments for calendar highlighting
  const appointmentDates = appointments.map((apt) => apt.date);

  return (
    <Layout>
      <div className="container py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg gradient-bg flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Smart Booking Agent</h1>
                <p className="text-muted-foreground">Schedule appointments via chat or voice</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/voice-agent">
                <Phone className="mr-2 h-4 w-4" />
                Try Voice Agent
              </Link>
            </Button>
          </div>
        </div>

        {/* Tabs for Text/Voice */}
        <Tabs defaultValue="text" className="mb-6">
          <TabsList>
            <TabsTrigger value="text">
              <MessageSquare className="mr-2 h-4 w-4" />
              Text Chat
            </TabsTrigger>
            <TabsTrigger value="voice" asChild>
              <Link to="/voice-agent">
                <Phone className="mr-2 h-4 w-4" />
                Voice Call
              </Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Main Content */}
        <div className="grid lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
          {/* Chat Panel */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Chat with Booking Agent</CardTitle>
              <CardDescription>Ask about availability or book an appointment</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ChatInterface
                messages={messages}
                onSend={handleSendMessage}
                isTyping={isTyping}
                placeholder="Ask about booking an appointment..."
              />
            </CardContent>
          </Card>

          {/* Calendar & Appointments Panel */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Calendar</CardTitle>
                <CardDescription>View availability and appointments</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border pointer-events-auto"
                  modifiers={{
                    booked: appointmentDates,
                  }}
                  modifiersStyles={{
                    booked: {
                      backgroundColor: "hsl(var(--primary) / 0.1)",
                      color: "hsl(var(--primary))",
                      fontWeight: "bold",
                    },
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Appointments</CardTitle>
                <CardDescription>Your scheduled bookings</CardDescription>
              </CardHeader>
              <CardContent>
                {appointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No appointments yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg"
                      >
                        <CheckCircle className="h-5 w-5 text-success mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{apt.service}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <CalendarDays className="h-3 w-3" />
                            <span>{format(apt.date, "MMM d, yyyy")}</span>
                            <Clock className="h-3 w-3 ml-2" />
                            <span>{apt.time}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
