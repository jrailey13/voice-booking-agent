import { z } from 'zod';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import type { Prisma, PrismaClient } from '@prisma/client';
import { SLOTS, normalizeDate, normalizeTime } from '../datetime';
import { toCommitted, type CommittedBooking } from '../booking.commit';

export type BookingTx = Pick<Prisma.TransactionClient, 'appointment' | 'conversation'>;
export type BookingDb = BookingTx & Pick<PrismaClient, '$transaction'>;

/** What the tools did during one turn. `booked` is set only after a committed write. */
export interface BookingToolState {
  booked: CommittedBooking | null;
  /** Why the last booking attempt was refused, worded for the caller. Cleared by a successful booking. */
  refusal: string | null;
}

export const SERVICES = ['consultation', 'follow-up', 'initial assessment'] as const;

const ACTIVE = { in: ['confirmed', 'pending'] };

/** "2026-10-06" → "Tuesday, October 6": what the caller should hear. */
export function spokenDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Loose match against the service list, so "Initial Assessment" or "followup" work. Unknown → null. */
function matchService(text: string): string | null {
  const key = text.toLowerCase().replace(/[^a-z]/g, '');
  return SERVICES.find((s) => s.replace(/[^a-z]/g, '') === key) ?? null;
}

async function openSlots(db: BookingTx, date: string): Promise<string[]> {
  const taken = new Set(
    (await db.appointment.findMany({ where: { date, status: ACTIVE } })).map((a) => a.time)
  );
  return SLOTS.filter((s) => !taken.has(s));
}

const describeOpen = (slots: string[]) => (slots.length ? `Open times: ${slots.join(', ')}.` : 'No open times that day.');

/** Tools return "Error: …" text instead of throwing, so the model can tell the caller and recover. */
async function safely(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (error) {
    console.error('Booking tool failed:', error);
    return 'Error: the booking system had a problem. Apologise and ask the caller to try again.';
  }
}

/** A booking the rules refuse. `message` is for the model; `spoken` is for the caller. */
class Refusal extends Error {
  constructor(message: string, readonly spoken: string) {
    super(message);
  }
}

/**
 * The booking agent's tools, bound to one conversation. All normalization and
 * invariant checks live here, not in the prompt: the model's free text is never
 * written as-is (C4), and `state.booked` is the only proof of a booking (FR2).
 */
export function buildBookingTools(deps: { db: BookingDb; conversationId: string; ref?: Date }): {
  tools: StructuredToolInterface[];
  state: BookingToolState;
} {
  const ref = deps.ref ?? new Date();
  const state: BookingToolState = { booked: null, refusal: null };

  const checkAvailability = tool(
    async ({ date }) =>
      safely(async () => {
        const day = normalizeDate(date, ref);
        if (!day) return `Error: could not understand the date "${date}". Ask the caller for a specific day.`;
        return `${spokenDate(day)} (${day}). ${describeOpen(await openSlots(deps.db, day))}`;
      }),
    {
      name: 'check_availability',
      description: 'List the open appointment times for one day. Accepts natural dates like "tomorrow" or "October 6".',
      schema: z.object({ date: z.string().describe('The day to check, in words or YYYY-MM-DD') }),
    }
  );

  const bookAppointment = tool(
    async ({ date, time, service, customerName, customerContact }) =>
      safely(async () => {
        try {
          const day = normalizeDate(date, ref);
          if (!day) {
            throw new Refusal(
              `could not understand the date "${date}". Ask the caller for a specific day.`,
              "Sorry, I didn't catch the day. Which day would you like?"
            );
          }
          const slot = normalizeTime(time, ref);
          if (!slot) {
            throw new Refusal(
              `could not match the time "${time}" to an opening hour (9 AM to 5 PM, on the hour).`,
              'Sorry, appointments are on the hour from 9 AM to 5 PM. Which time would you like?'
            );
          }
          const kind = matchService(service);
          if (!kind) {
            const list = SERVICES.join(', ');
            throw new Refusal(`unknown service "${service}". The services are ${list}.`, `Sorry, we offer ${list}. Which would you like?`);
          }

          // Check and write in one transaction, so the slot cannot be taken in between.
          const appointment = await deps.db.$transaction(async (tx) => {
            const conversation = await tx.conversation.findUnique({ where: { id: deps.conversationId } });
            if (conversation?.appointmentId) {
              const existing = await tx.appointment.findUnique({ where: { id: conversation.appointmentId } });
              const what = existing ? `${existing.service} on ${spokenDate(existing.date)} at ${existing.time}` : 'an appointment';
              throw new Refusal(`this caller is already booked (${what}). Only one booking per call.`, `You're already booked for ${what}.`);
            }
            if (await tx.appointment.findFirst({ where: { date: day, time: slot, status: ACTIVE } })) {
              const taken = `${slot} on ${spokenDate(day)} is already taken. ${describeOpen(await openSlots(tx, day))}`;
              throw new Refusal(taken, `Sorry, ${taken}`);
            }
            const created = await tx.appointment.create({
              data: {
                date: day,
                time: slot,
                service: kind,
                customerName: customerName || null,
                customerContact: customerContact || null,
                status: 'confirmed',
              },
            });
            await tx.conversation.update({ where: { id: deps.conversationId }, data: { appointmentId: created.id } });
            return created;
          });

          state.booked = toCommitted(appointment);
          state.refusal = null;
          const who = appointment.customerName ? ` for ${appointment.customerName}` : '';
          // No id in the text: the model would read it aloud. The client gets the row itself.
          return `Booked: ${kind} on ${spokenDate(day)} at ${slot}${who}.`;
        } catch (error) {
          if (!(error instanceof Refusal)) throw error;
          state.refusal = error.spoken;
          return `Error: ${error.message}`;
        }
      }),
    {
      name: 'book_appointment',
      description:
        'Book an appointment once the caller has named a day, time and service. Checks availability itself. ' +
        'Returns "Booked: …" on success or "Error: …" explaining why not, with the open times.',
      schema: z.object({
        date: z.string().describe('The day, in words or YYYY-MM-DD'),
        time: z.string().describe('The time, e.g. "2 PM"'),
        service: z.string().describe(`One of: ${SERVICES.join(', ')}`),
        customerName: z.string().nullish().describe("The caller's name, if given"),
        customerContact: z.string().nullish().describe("The caller's phone number or email, if given"),
      }),
    }
  );

  return { tools: [checkAvailability, bookAppointment], state };
}
