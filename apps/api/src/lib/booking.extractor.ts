import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from './ai/models';
import { debugCallbacks } from './ai/stepTracer';
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

// Shape the model must emit. withStructuredOutput sends it to Ollama as a JSON
// Schema, which constrains decoding, and validates the reply against it. Keys
// are required (so a truncated extraction is rejected) but values may be null
// while the conversation is still gathering details. Times/dates arrive as free
// text and are normalized below.
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

export interface ExtractDeps {
  /** Must support JSON Schema output; any Ollama chat model does. Defaults to LLM_MODEL. */
  model?: BaseChatModel;
  callbacks?: Callbacks;
}

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
  ref: Date = new Date(),
  deps: ExtractDeps = {}
): Promise<ExtractedBooking | null> {
  let data: z.infer<typeof RawBookingSchema>;
  try {
    // jsonSchema, not tool calling: gemma3 cannot call tools, and Ollama
    // enforces a JSON Schema format on any model.
    const model: BaseChatModel = deps.model ?? createChatModel();
    const extractor = model.withStructuredOutput(RawBookingSchema, {
      name: 'booking',
      method: 'jsonSchema',
    });
    data = await extractor.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`Conversation so far:
${transcript}

Extract the booking as JSON.`),
      ],
      { callbacks: deps.callbacks ?? debugCallbacks() }
    );
  } catch (error) {
    // The model call failed, or its reply was not valid JSON matching the schema.
    console.warn('Booking extraction failed:', error);
    return null;
  }

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
