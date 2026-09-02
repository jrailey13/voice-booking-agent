import { z } from 'zod';
import { ollama } from './ollama';
import { normalizeDate, normalizeTime } from './datetime';

/**
 * A booking that has been extracted from the conversation and normalized to
 * the canonical shape the database expects. `date` is 'YYYY-MM-DD' and `time`
 * is a valid bookable slot.
 */
export interface ExtractedBooking {
  date: string;
  time: string;
  service: string;
  customerName: string | null;
  customerContact: string | null;
}

// Shape we ask the model to emit. Keys are required (so a truncated extraction
// is rejected) but values may be null while the conversation is still gathering
// details. Times/dates arrive as free text and are normalized below.
const RawBookingSchema = z.object({
  ready_to_book: z.boolean(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  service: z.string().nullable(),
  customer_name: z.string().nullable(),
  customer_contact: z.string().nullable(),
});

const DEFAULT_SERVICE = 'consultation';

const SYSTEM_PROMPT = `You extract structured appointment details from a booking conversation.
Return ONLY a JSON object with these keys:
- ready_to_book: boolean — true only if the customer has agreed to a specific date AND time.
- date: the requested date in plain words (e.g. "October 3, 2026", "next Tuesday"), or null.
- time: the requested time in plain words (e.g. "2 PM", "9am"), or null.
- service: one of "consultation", "follow-up", "initial assessment", or null if unstated.
- customer_name: the customer's name, or null.
- customer_contact: a phone number or email, or null.
Do not invent details the customer did not provide. If unsure, use null and ready_to_book=false.`;

/**
 * Ask the model whether the conversation has produced a committable booking and,
 * if so, extract and normalize it. Returns null whenever the conversation is not
 * ready, the extraction is malformed, or the date/time cannot be resolved to a
 * concrete bookable slot. Never throws — a failed extraction is just "no commit".
 *
 * @param transcript Rendered conversation (user/assistant turns).
 * @param ref Reference date for resolving relative dates ("next Tuesday").
 */
export async function extractBooking(
  transcript: string,
  ref: Date = new Date()
): Promise<ExtractedBooking | null> {
  let raw: unknown;
  try {
    const response = await ollama.generate({
      model: process.env.LLM_MODEL || 'gemma3',
      system: SYSTEM_PROMPT,
      prompt: `Conversation so far:\n${transcript}\n\nExtract the booking as JSON.`,
      format: 'json',
      stream: false,
    });
    raw = JSON.parse(response.response);
  } catch (error) {
    console.warn('Booking extraction failed (model or JSON parse):', error);
    return null;
  }

  const parsed = RawBookingSchema.safeParse(raw);
  if (!parsed.success) return null;

  const data = parsed.data;
  if (!data.ready_to_book) return null;
  if (!data.date || !data.time) return null;

  const date = normalizeDate(data.date, ref);
  const time = normalizeTime(data.time, ref);
  if (!date || !time) return null;

  return {
    date,
    time,
    service: data.service?.trim() || DEFAULT_SERVICE,
    customerName: data.customer_name?.trim() || null,
    customerContact: data.customer_contact?.trim() || null,
  };
}
