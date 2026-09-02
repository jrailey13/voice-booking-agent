import { prisma } from './database';
import { extractBooking } from './booking.extractor';

/**
 * An appointment that was just written to the database as a result of the
 * conversation reaching a committable state.
 */
export interface CommittedBooking {
  id: string;
  date: string;
  time: string;
  service: string;
  customerName: string | null;
  customerContact: string | null;
}

// How many recent turns to feed the extractor. Matches the context window used
// for generation in generateBookingResponse.
const CONTEXT_TURNS = 10;

// Extraction is a second full LLM call, so we only pay for it once the assistant
// signals the conversation has actually closed on a booking. This is a cheap
// pre-gate, not the source of truth — the extractor still validates everything.
const CONFIRMATION_CUE =
  /\b(booked|confirm(?:ed)?|scheduled|reserv(?:e|ed)|all set|you'?re set|see you|locked in)\b/i;

function assistantConfirmed(
  messages: Array<{ role: string; content: string }>
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return CONFIRMATION_CUE.test(messages[i].content);
    }
  }
  return false;
}

/**
 * Inspect a conversation and, if it has reached a concrete, available booking,
 * create the appointment and link it to the conversation. Idempotent per
 * conversation: once a conversation is linked to an appointment it will not
 * create another. Returns the created booking, or null if there is nothing to
 * commit (not ready, slot taken, or already booked). Never throws.
 */
export async function maybeCommitBooking(
  conversationId: string,
  ref: Date = new Date()
): Promise<CommittedBooking | null> {
  try {
    // Guard: never create a second appointment for the same conversation.
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.appointmentId) return null;

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: CONTEXT_TURNS,
    });
    // Cheap gate: don't spend an extraction call until the assistant confirms.
    if (!assistantConfirmed(messages)) return null;

    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const booking = await extractBooking(transcript, ref);
    if (!booking) return null;

    // Don't book a slot that's already taken (by another appointment).
    const clash = await prisma.appointment.findFirst({
      where: {
        date: booking.date,
        time: booking.time,
        status: { in: ['confirmed', 'pending'] },
      },
    });
    if (clash) return null;

    const appointment = await prisma.appointment.create({
      data: {
        date: booking.date,
        time: booking.time,
        service: booking.service,
        customerName: booking.customerName,
        customerContact: booking.customerContact,
        status: 'confirmed',
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { appointmentId: appointment.id },
    });

    return {
      id: appointment.id,
      date: appointment.date,
      time: appointment.time,
      service: appointment.service,
      customerName: appointment.customerName ?? null,
      customerContact: appointment.customerContact ?? null,
    };
  } catch (error) {
    console.error('Booking commit failed:', error);
    return null;
  }
}
