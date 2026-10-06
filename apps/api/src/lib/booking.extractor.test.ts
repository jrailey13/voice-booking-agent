import { describe, it, expect } from 'vitest';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { extractBooking } from './booking.extractor';
import { createChatModel } from './ai/models';
import { fakeOllama } from '../test/fakeOllama';

// Fixed reference so chrono's forward-date resolution is deterministic.
// 2026-09-02 is a Wednesday.
const REF = new Date('2026-09-02T12:00:00');

const READY = {
  ready_to_book: true,
  date: 'October 3, 2026',
  time: '2 PM',
  service: 'consultation',
  customer_name: 'Jane Doe',
  customer_contact: '555-0100',
};

/** extractBooking against the real ChatOllama client, talking to a fake server. */
async function extractWith(reply: unknown, transcript = '...transcript...') {
  const server = fakeOllama(typeof reply === 'string' || reply instanceof Error ? reply : JSON.stringify(reply));
  const result = await extractBooking(transcript, REF, { model: createChatModel({}, { fetch: server.fetch }) });
  return { result, request: server.requests[0] };
}

describe('extractBooking', () => {
  it('returns a normalized booking when the model reports it is ready', async () => {
    const { result } = await extractWith(READY);

    expect(result).toEqual({
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jane Doe',
      customerContact: '555-0100',
    });
  });

  it("constrains Ollama's output to the booking JSON schema, without tool calling (gemma3 has none)", async () => {
    const { request } = await extractWith(READY);

    expect(request.format).toMatchObject({
      type: 'object',
      properties: {
        ready_to_book: { type: 'boolean' },
        date: expect.anything(),
        time: expect.anything(),
        service: expect.anything(),
        customer_name: expect.anything(),
        customer_contact: expect.anything(),
      },
    });
    expect([...request.format.required].sort()).toEqual(
      ['customer_contact', 'customer_name', 'date', 'ready_to_book', 'service', 'time']
    );
    expect(request.tools).toBeUndefined();
    expect(request.model).toBe('gemma3');
  });

  it('sends the instructions as a system message and the transcript as the user turn', async () => {
    const { request } = await extractWith(READY, 'User: Saturday at 2\nAssistant: Booked!');

    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('ready_to_book') });
    expect(request.messages[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('User: Saturday at 2\nAssistant: Booked!'),
    });
  });

  it('snaps an off-grid time to the nearest slot', async () => {
    const { result } = await extractWith({ ...READY, time: '4:15 PM', service: 'follow-up' });

    expect(result?.time).toBe('04:00 PM');
  });

  it('defaults service to consultation when the model omits it', async () => {
    const { result } = await extractWith({ ...READY, time: '9am', service: null });

    expect(result?.service).toBe('consultation');
  });

  it('turns blank customer details into null', async () => {
    const { result } = await extractWith({ ...READY, customer_name: '  ', customer_contact: '' });

    expect(result).toMatchObject({ customerName: null, customerContact: null });
  });

  it('returns null when the model is not ready to book', async () => {
    const { result } = await extractWith({
      ready_to_book: false,
      date: null,
      time: null,
      service: null,
      customer_name: null,
      customer_contact: null,
    });

    expect(result).toBeNull();
  });

  it('returns null when the date cannot be parsed', async () => {
    expect((await extractWith({ ...READY, date: 'whenever is good' })).result).toBeNull();
  });

  it('returns null when the time falls outside business hours', async () => {
    expect((await extractWith({ ...READY, time: '11 PM' })).result).toBeNull();
  });

  it('returns null when the model emits invalid JSON', async () => {
    expect((await extractWith('not json at all {')).result).toBeNull();
  });

  it('returns null when required fields are missing from the JSON', async () => {
    expect((await extractWith({ ready_to_book: true })).result).toBeNull(); // no date/time/service keys
  });

  it('returns null when a field has the wrong type', async () => {
    expect((await extractWith({ ...READY, ready_to_book: 'yes' })).result).toBeNull();
  });

  it('returns null (never throws) when the model call fails', async () => {
    expect((await extractWith(new Error('ollama down'))).result).toBeNull();
  });

  it('reports the model call to the given callbacks (DEBUG tracing)', async () => {
    const starts: string[] = [];
    const handler = BaseCallbackHandler.fromMethods({
      handleChatModelStart: () => void starts.push('model'),
    });
    const server = fakeOllama(JSON.stringify(READY));

    await extractBooking('...', REF, { model: createChatModel({}, { fetch: server.fetch }), callbacks: [handler] });

    expect(starts).toEqual(['model']);
  });
});
