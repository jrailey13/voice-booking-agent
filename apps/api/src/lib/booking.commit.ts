import { prisma } from './database';
import { extractBooking } from './booking.extractor';
import { recentMessages } from './conversationHistory';

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

// Extraction is a second full LLM call, so we only pay for it once the assistant
// signals the conversation has actually closed on a booking. This is a cheap
// pre-gate, not the source of truth — the extractor still validates everything.
export const CONFIRMATION_CUE =
  /\b(booked|confirm(?:ed)?|scheduled|reserv(?:e|ed)|all set|you'?re set|see you|locked in)\b/i;

// A cheap signal that the caller is amending a detail (e.g. correcting a
// mis-heard name). Used to justify a re-extraction on an already-booked
// conversation even when no field is blank. False positives only cost an extra
// extraction call — they never corrupt data, since enrichment only overwrites
// with a different, non-null extracted value.
const CORRECTION_CUE =
  /\b(actually|instead|correct(?:ion|ed)?|fix|change|wrong|mis(?:heard|spelled|spelt)|spell(?:ed|ing|s)?|should be|supposed to be)\b/i;

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

export function toCommitted(appt: {
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

function lastUserMessage(
  messages: Array<{ role: string; content: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
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

    // The same recent window the reply model saw, so the confirmation cue is
    // checked against the latest assistant turn.
    const messages = await recentMessages(conversationId);

    // Already booked: the only work left is capturing or correcting customer
    // details. This is not gated by the confirmation cue — a correction ("fix
    // my name") often comes without one. enrichBooking runs its own cheap gate.
    if (conversation.appointmentId) {
      return enrichBooking(conversation.appointmentId, messages, ref);
    }

    // Cheap gate: don't spend an extraction call until the assistant confirms.
    if (!assistantConfirmed(messages)) return null;

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
 * Reconcile the customer details on an already-committed appointment with what
 * the conversation now says. Fills blanks, and applies genuine corrections
 * (e.g. a name the caller re-spells after a mis-hear). Never nulls out a known
 * value, never rewrites a value to itself, and never touches date/time/service.
 *
 * To stay cheap it only spends an extraction call when there is a blank to fill
 * or the latest turn signals a correction — otherwise it does nothing.
 */
async function enrichBooking(
  appointmentId: string,
  messages: Array<{ role: string; content: string }>,
  ref: Date
): Promise<CommittedBooking | null> {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appt) return null;

  const missingDetails = !appt.customerName || !appt.customerContact;
  const correcting = CORRECTION_CUE.test(lastUserMessage(messages));
  if (!missingDetails && !correcting) return null; // nothing to do — skip the LLM

  const booking = await extractBooking(renderTranscript(messages), ref);
  if (!booking) return null;

  // Write a field only when extraction yields a non-null value that differs
  // from what's stored: this both fills blanks and applies corrections without
  // ever clobbering a good value or rewriting it to the same thing.
  const data: { customerName?: string; customerContact?: string } = {};
  if (booking.customerName && booking.customerName !== appt.customerName) {
    data.customerName = booking.customerName;
  }
  if (booking.customerContact && booking.customerContact !== appt.customerContact) {
    data.customerContact = booking.customerContact;
  }
  if (Object.keys(data).length === 0) return null; // no new details

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data,
  });
  return toCommitted(updated);
}
