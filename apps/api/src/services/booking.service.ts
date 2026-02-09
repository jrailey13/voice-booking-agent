import { prisma } from '../lib/database';
import { generateBookingResponse } from '../lib/llm';

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
    const appointment = await prisma.appointment.create({
      data: {
        date: params.date,
        time: params.time,
        service: params.service,
        status: 'confirmed',
      },
    });

    return {
      id: appointment.id,
      date: appointment.date,
      time: appointment.time,
      service: appointment.service,
      status: appointment.status as 'confirmed' | 'pending' | 'cancelled',
    };
  }

  async getAppointments(): Promise<Appointment[]> {
    const appointments = await prisma.appointment.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return appointments.map((apt) => ({
      id: apt.id,
      date: apt.date,
      time: apt.time,
      service: apt.service,
      status: apt.status as 'confirmed' | 'pending' | 'cancelled',
    }));
  }

  async chat(message: string, conversationId?: string): Promise<ChatResult> {
    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!conversation) {
        conversation = await prisma.conversation.create({ data: {} });
      }
    } else {
      conversation = await prisma.conversation.create({ data: {} });
    }

    // Save user message
    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: message,
      },
    });

    // Generate response using LLM
    const response = await generateBookingResponse(message, conversation.id);

    // Save assistant message
    const assistantMessage = await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: response,
      },
    });

    return {
      id: assistantMessage.id,
      message: response,
      timestamp: assistantMessage.createdAt.toISOString(),
      conversationId: conversation.id,
    };
  }
}
