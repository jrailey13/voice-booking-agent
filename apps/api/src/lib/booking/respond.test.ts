import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMessage } from '@langchain/core/messages';

vi.mock('../llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm')>()),
  generateBookingResponse: vi.fn(async () => 'legacy reply'),
}));
vi.mock('../conversationHistory', () => ({ recentMessages: vi.fn(async () => []) }));

import { respondToCaller, assertBookingAgentReady, bookingAgentEnabled } from './respond';
import { generateBookingResponse, fallbackResponse } from '../llm';
import { recentMessages } from '../conversationHistory';
import { FakeBookingDb } from '../../test/fakes';
import { ScriptedModel, toolCall } from '../../test/scriptedModel';
import { hangingFetch, settlesWithin } from '../../test/hangingFetch';

const legacy = vi.mocked(generateBookingResponse);
const history = vi.mocked(recentMessages);

let db: FakeBookingDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = new FakeBookingDb();
  db.conversations.push({ id: 'conv-1', appointmentId: null });
});

describe('respondToCaller', () => {
  it('uses the existing reply path unless BOOKING_AGENT=true', async () => {
    const model = new ScriptedModel([]);
    for (const env of [{}, { BOOKING_AGENT: 'false' }, { BOOKING_AGENT: '1' }]) {
      expect(await respondToCaller('hi', 'conv-1', { env, deps: { model, db: db as never } }))
        .toEqual({ reply: 'legacy reply', booking: null });
    }
    expect(legacy).toHaveBeenCalledWith('hi', 'conv-1');
    expect(model.seen).toEqual([]);
    expect(history).not.toHaveBeenCalled();
  });

  it('runs the agent over the recent history when BOOKING_AGENT=true', async () => {
    history.mockResolvedValueOnce([{ role: 'user', content: 'Tuesday at 2 for a consultation' }]);
    const model = new ScriptedModel([
      toolCall('book_appointment', { date: 'October 6', time: '2pm', service: 'consultation' }),
      new AIMessage("You're booked for Tuesday at 2."),
    ]);

    const result = await respondToCaller('Tuesday at 2 for a consultation', 'conv-1', {
      env: { BOOKING_AGENT: 'true' },
      deps: { model, db: db as never },
    });

    expect(history).toHaveBeenCalledWith('conv-1');
    expect(legacy).not.toHaveBeenCalled();
    expect(result.reply).toBe("You're booked for Tuesday at 2.");
    expect(result.booking).toMatchObject({ time: '02:00 PM', service: 'consultation' });
  });

  it('falls back when the whole turn exceeds BOOKING_AGENT_TIMEOUT_MS', async () => {
    const result = await respondToCaller('I want to book', 'conv-1', {
      env: { BOOKING_AGENT: 'true', BOOKING_AGENT_TIMEOUT_MS: '20' },
      deps: { model: new ScriptedModel(['hang']), db: db as never },
    });
    expect(result).toEqual({ reply: fallbackResponse('I want to book'), booking: null });
  });

  it('times out on the real Ollama model when the server never answers, and cancels the request', async () => {
    const server = hangingFetch();
    vi.stubGlobal('fetch', server.fetch);
    try {
      const outcome = await settlesWithin(
        respondToCaller('I want to book', 'conv-1', {
          env: { BOOKING_AGENT: 'true', BOOKING_AGENT_TIMEOUT_MS: '20' },
          deps: { db: db as never },
        }),
        1000,
      );
      expect(outcome).toEqual({ status: 'fulfilled', value: { reply: fallbackResponse('I want to book'), booking: null } });
      expect(server.aborted).toBe(server.requests);
      expect(server.requests).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('bookingAgentEnabled', () => {
  it('is on only for BOOKING_AGENT=true', () => {
    expect(bookingAgentEnabled({ BOOKING_AGENT: 'true' })).toBe(true);
    expect(bookingAgentEnabled({})).toBe(false);
  });
});

describe('assertBookingAgentReady', () => {
  const capable = () =>
    vi.fn(async () => new Response(JSON.stringify({ capabilities: ['tools'] }), { status: 200 })) as unknown as typeof fetch;

  it('checks nothing when the agent is off', async () => {
    const f = capable();
    await assertBookingAgentReady({}, f);
    expect(f).not.toHaveBeenCalled();
  });

  it("checks the agent model's tool support when it is on", async () => {
    const f = capable();
    await assertBookingAgentReady({ BOOKING_AGENT: 'true', BOOKING_AGENT_MODEL: 'llama3.1' }, f);
    expect(f).toHaveBeenCalledWith('http://localhost:11434/api/show', expect.objectContaining({ body: JSON.stringify({ model: 'llama3.1' }) }));
  });

  it('rejects an invalid timeout setting', async () => {
    await expect(assertBookingAgentReady({ BOOKING_AGENT: 'true', BOOKING_AGENT_TIMEOUT_MS: 'soon' }, capable()))
      .rejects.toThrow('BOOKING_AGENT_TIMEOUT_MS');
  });
});
