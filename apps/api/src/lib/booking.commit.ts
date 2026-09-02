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

function toCommitted(appt: {
  id: string;
  date: string;
  time: string;
  service: string;
  customerName: string | null;
  customerContact: string | null;
}): CommittedBooking {
  return {
    id: appt.id,
    date: appt.date,
    time: appt.time,
    service: appt.service,
    customerName: appt.customerName ?? null,
    customerContact: appt.customerContact ?? null,
  };
}

function renderTranscript(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

/**
 * Inspect a conversation and reconcile it with the appointment table. If the
 * conversation has reached a concrete, available booking it is created and
 * linked; if it was already booked but the caller only later gave their name or
 * contact, those missing details are back-filled onto the existing appointment.
 * At most one appointment is ever created per conversation. Returns the booking
 * that was written (created or enriched), or null if there was nothing to do.
 * Never throws.
 */
export async function maybeCommitBooking(
  conversationId: string,
  ref: Date = new Date()
): Promise<CommittedBooking | null> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return null;

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: CONTEXT_TURNS,
    });
    // Cheap gate: don't spend an extraction call until the assistant confirms.
    if (!assistantConfirmed(messages)) return null;

    // Already booked: only work left is back-filling missing customer details.
    if (conversation.appointmentId) {
      return enrichBooking(conversation.appointmentId, messages, ref);
    }

    const booking = await extractBooking(renderTranscript(messages), ref);
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

    return toCommitted(appointment);
  } catch (error) {
    console.error('Booking commit failed:', error);
    return null;
  }
}

/**
 * Back-fill a name/contact onto an appointment that was committed before the
 * caller supplied them. Never overwrites a value already present, never changes
 * the date/time/service, and skips the LLM call entirely once both details are
 * already on record.
 */
async function enrichBooking(
  appointmentId: string,
  messages: Array<{ role: string; content: string }>,
  ref: Date
): Promise<CommittedBooking | null> {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) return null;
  if (appt.customerName && appt.customerContact) return null; // nothing to add

  const booking = await extractBooking(renderTranscript(messages), ref);
  if (!booking) return null;

  const data: { customerName?: string; customerContact?: string } = {};
  if (!appt.customerName && booking.customerName) data.customerName = booking.customerName;
  if (!appt.customerContact && booking.customerContact) {
    data.customerContact = booking.customerContact;
  }
  if (Object.keys(data).length === 0) return null; // no new details

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data,
  });
  return toCommitted(updated);
}
