import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { CONFIRMATION_CUE, type CommittedBooking } from '../booking.commit';
import type { HistoryMessage } from '../conversationHistory';
import { fallbackResponse } from '../llm';
import { buildBookingTools, spokenDate, SERVICES, type BookingDb } from './tools';

/** Model calls per caller turn. Each one is 5–25s on CPU, so this is the latency cap (ADR-006). */
export const MAX_MODEL_CALLS = 3;

/** Said instead of a confirmation the tools did not back (FR2, ADR-007). */
export const TENTATIVE_REPLY =
  "I haven't booked that yet. Could you tell me the day, time and service you'd like, and I'll check it for you?";

export interface BookingTurnDeps {
  model: BaseChatModel;
  db: BookingDb;
  callbacks?: Callbacks;
}

export interface BookingTurnInput {
  message: string;
  conversationId: string;
  /** Recent stored messages, oldest first; may already end with `message`. */
  history: HistoryMessage[];
  ref?: Date;
  /** Aborts the in-flight model request (ADR-008). */
  signal?: AbortSignal;
}

export interface BookingTurnResult {
  reply: string;
  /** The appointment written during this turn, if any. */
  booking: CommittedBooking | null;
}

function systemPrompt(ref: Date, existing: string | null): string {
  const today = ref.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return [
    `You are the phone receptionist for a small clinic. Today is ${today}.`,
    `Services: ${SERVICES.join(', ')}. Appointments are on the hour from 9 AM to 5 PM.`,
    'As soon as the caller has named a day, a time and a service, call book_appointment. It checks availability itself, so do not check first and do not ask them to confirm again. Include their name and contact if they gave them.',
    'Use check_availability only when the caller asks what is open or has not chosen a time.',
    'Never tell the caller they are booked unless book_appointment returned "Booked". If it returned an error, explain and offer an alternative.',
    'Reply in one or two short spoken sentences, with no lists or markdown.',
    existing ? `This caller is already booked: ${existing}. Do not book again.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const withArticle = (service: string) => `${/^[aeiou]/i.test(service) ? 'an' : 'a'} ${service}`;

/** A confirmation built from the written row, never from model text. */
function confirmationFor(b: CommittedBooking): string {
  return `You're booked for ${withArticle(b.service)} on ${spokenDate(b.date)} at ${b.time}.`;
}

function textOf(message: AIMessage): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .map((part) => ('text' in part ? String(part.text) : ''))
    .join('')
    .trim();
}

function toMessages(history: HistoryMessage[], message: string): BaseMessage[] {
  const messages = history.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)));
  const latest = history[history.length - 1];
  // Services store the caller's message before asking for a reply.
  if (!(latest && latest.role === 'user' && latest.content === message)) messages.push(new HumanMessage(message));
  return messages;
}

/**
 * One caller turn of the booking agent: a bounded tool loop over bindTools
 * (ADR-006). Never throws. A failed or aborted model yields the scripted
 * fallback (C3), or a confirmation built from the row if a booking was
 * already written this turn. A confirmation the tools did not back is
 * replaced (FR2).
 */
export async function runBookingTurn(deps: BookingTurnDeps, input: BookingTurnInput): Promise<BookingTurnResult> {
  const ref = input.ref ?? new Date();
  const { tools, state } = buildBookingTools({ db: deps.db, conversationId: input.conversationId, ref });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const config = { signal: input.signal, callbacks: deps.callbacks };

  try {
    const existing = await describeExisting(deps.db, input.conversationId);
    if (!deps.model.bindTools) throw new Error('booking agent model does not support tool calling');
    const model = deps.model.bindTools(tools);
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt(ref, existing)), ...toMessages(input.history, input.message)];

    for (let call = 0; call < MAX_MODEL_CALLS; call++) {
      const ai = await model.invoke(messages, config);
      messages.push(ai);

      if (!ai.tool_calls?.length) {
        const reply = textOf(ai);
        if (!reply) break;
        // FR2: confirmation-sounding text with no booking behind it is replaced.
        // If the tool refused, say why (true by construction); else ask again.
        const unbacked = CONFIRMATION_CUE.test(reply) && !state.booked && !existing;
        if (unbacked) return { reply: state.refusal ?? TENTATIVE_REPLY, booking: null };
        return { reply, booking: state.booked };
      }

      for (const toolCall of ai.tool_calls) {
        const id = toolCall.id ?? toolCall.name;
        const tool = byName.get(toolCall.name);
        if (!tool) {
          messages.push(new ToolMessage({ content: `Error: unknown tool ${toolCall.name}. Use ${[...byName.keys()].join(' or ')}.`, tool_call_id: id }));
          continue;
        }
        try {
          // Invoked with the whole tool call, a tool returns a ToolMessage carrying its tool_call_id.
          messages.push(await tool.invoke({ ...toolCall, id, type: 'tool_call' }, config));
        } catch (error) {
          // Arguments that fail the schema land here; the model gets to retry.
          messages.push(new ToolMessage({ content: `Error: ${error instanceof Error ? error.message : String(error)}`, tool_call_id: id }));
        }
      }
    }
    console.warn(`Booking agent ended without a reply after ${MAX_MODEL_CALLS} model calls`);
  } catch (error) {
    console.warn('Booking agent failed, using fallback response:', error);
  }

  return {
    reply: state.booked ? confirmationFor(state.booked) : fallbackResponse(input.message),
    booking: state.booked,
  };
}

async function describeExisting(db: BookingDb, conversationId: string): Promise<string | null> {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation?.appointmentId) return null;
  const appt = await db.appointment.findUnique({ where: { id: conversation.appointmentId } });
  return appt ? `${appt.service} on ${spokenDate(appt.date)} at ${appt.time}` : 'an appointment';
}
