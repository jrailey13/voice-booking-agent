import crypto from 'crypto';

interface AvailabilityResult {
  date: string;
  availableSlots: Array<{
    time: string;
    available: boolean;
  }>;
}

interface CreateAppointmentParams {
  date: string;
  time: string;
  service: string;
}

interface Appointment {
  id: string;
  date: string;
  time: string;
  service: string;
  status: 'confirmed' | 'pending' | 'cancelled';
}

interface ChatResult {
  id: string;
  message: string;
  timestamp: string;
  conversationId: string;
}

export class BookingService {
  private appointments: Map<string, Appointment> = new Map();
  private conversations: Map<string, string[]> = new Map();

  async checkAvailability(date: string): Promise<AvailabilityResult> {
    // TODO: Check actual availability from database/calendar system
    
    // Mock time slots
    const timeSlots = [
      '09:00 AM', '10:00 AM', '11:00 AM',
      '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM',
    ];

    return {
      date,
      availableSlots: timeSlots.map((time) => ({
        time,
        available: Math.random() > 0.3, // Mock availability
      })),
    };
  }

  async createAppointment(params: CreateAppointmentParams): Promise<Appointment> {
    const appointment: Appointment = {
      id: crypto.randomUUID(),
      date: params.date,
      time: params.time,
      service: params.service,
      status: 'confirmed',
    };

    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  async getAppointments(): Promise<Appointment[]> {
    return Array.from(this.appointments.values());
  }

  async chat(message: string, conversationId?: string): Promise<ChatResult> {
    // TODO: Implement actual conversational AI
    // - Use OpenAI/Claude for natural language understanding
    // - Extract booking intent (date, time, service)
    // - Check availability
    // - Confirm bookings
    // - Handle multi-turn conversations

    const convId = conversationId || crypto.randomUUID();
    
    if (!this.conversations.has(convId)) {
      this.conversations.set(convId, []);
    }
    
    const history = this.conversations.get(convId)!;
    history.push(`User: ${message}`);

    // Mock response based on message content
    let response = '';
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('book') || lowerMessage.includes('appointment')) {
      response = "I'd be happy to help you book an appointment! What service are you interested in? We offer consultations, follow-ups, and initial assessments.";
    } else if (lowerMessage.includes('morning') || lowerMessage.includes('afternoon')) {
      response = "Perfect! I have several slots available. Would Tuesday at 2:00 PM work for you?";
    } else if (lowerMessage.includes('yes') || lowerMessage.includes('confirm')) {
      response = "Excellent! Your appointment has been confirmed. You'll receive a confirmation email shortly. Is there anything else I can help you with?";
    } else if (lowerMessage.includes('available') || lowerMessage.includes('availability')) {
      response = "I can see we have availability on Monday, Wednesday, and Friday this week. Which day works best for you?";
    } else {
      response = "I'm here to help you schedule appointments. What day and time would work best for you?";
    }

    history.push(`Assistant: ${response}`);

    return {
      id: crypto.randomUUID(),
      message: response,
      timestamp: new Date().toISOString(),
      conversationId: convId,
    };
  }
}
