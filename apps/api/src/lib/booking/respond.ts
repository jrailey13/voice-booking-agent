import { prisma } from '../database';
import { generateBookingResponse } from '../llm';
import { recentMessages } from '../conversationHistory';
import { createBookingAgentModel } from '../ai/models';
import { assertToolCapable } from '../ai/capability';
import { debugCallbacks } from '../ai/stepTracer';
import { runBookingTurn, type BookingTurnDeps, type BookingTurnResult } from './agent';

export type { BookingTurnResult } from './agent';

/** The agent can make several model calls per turn, so it gets a longer budget than OLLAMA_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 90_000;

export interface RespondOptions {
  env?: NodeJS.ProcessEnv;
  deps?: Partial<BookingTurnDeps>;
}

export const bookingAgentEnabled = (env: NodeJS.ProcessEnv = process.env) => env.BOOKING_AGENT === 'true';

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.BOOKING_AGENT_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`BOOKING_AGENT_TIMEOUT_MS must be a positive integer (milliseconds), got "${raw}"`);
  }
  return value;
}

/**
 * Reply to the caller. With BOOKING_AGENT=true the booking agent answers and
 * may book during the turn (docs/booking-agent-design.md). Otherwise the
 * existing reply path runs, unchanged, and `booking` is always null.
 */
export async function respondToCaller(
  message: string,
  conversationId: string,
  options: RespondOptions = {}
): Promise<BookingTurnResult> {
  const env = options.env ?? process.env;
  if (!bookingAgentEnabled(env)) {
    return { reply: await generateBookingResponse(message, conversationId), booking: null };
  }

  // A model per turn, bound to the turn's deadline so a timeout cancels the
  // HTTP request too. Construction does no I/O.
  const signal = AbortSignal.timeout(timeoutMs(env));
  const deps: BookingTurnDeps = {
    model: options.deps?.model ?? createBookingAgentModel(env, { signal }),
    db: options.deps?.db ?? prisma,
    callbacks: options.deps?.callbacks ?? debugCallbacks(env),
  };
  return runBookingTurn(deps, {
    message,
    conversationId,
    history: await recentMessages(conversationId),
    signal,
  });
}

/**
 * Startup check (FR4): when the agent is on, its settings must be valid and its
 * model must support tool calling. Otherwise the API should not start.
 */
export async function assertBookingAgentReady(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!bookingAgentEnabled(env)) return;
  timeoutMs(env);
  const model = createBookingAgentModel(env);
  await assertToolCapable(model.model, model.baseUrl, fetchImpl);
}
