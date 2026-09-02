import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the extractor from a live Ollama server.
vi.mock('./ollama', () => ({ ollama: { generate: vi.fn() } }));

import { extractBooking } from './booking.extractor';
import { ollama } from './ollama';

const mockGenerate = ollama.generate as unknown as ReturnType<typeof vi.fn>;

// Fixed reference so chrono's forward-date resolution is deterministic.
// 2026-09-02 is a Wednesday.
const REF = new Date('2026-09-02T12:00:00');

function modelReturns(json: unknown) {
  mockGenerate.mockResolvedValue({ response: JSON.stringify(json) });
}

describe('extractBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a normalized booking when the model reports it is ready', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'October 3, 2026',
      time: '2 PM',
      service: 'consultation',
      customer_name: 'Jane Doe',
      customer_contact: '555-0100',
    });

    const result = await extractBooking('...transcript...', REF);

    expect(result).toEqual({
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jane Doe',
      customerContact: '555-0100',
    });
  });

  it('requests JSON-formatted output from the model', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'October 3, 2026',
      time: '2 PM',
      service: 'consultation',
      customer_name: null,
      customer_contact: null,
    });

    await extractBooking('...', REF);

    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({ format: 'json' });
  });

  it('snaps an off-grid time to the nearest slot', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'October 3, 2026',
      time: '4:15 PM',
      service: 'follow-up',
      customer_name: null,
      customer_contact: null,
    });

    const result = await extractBooking('...', REF);

    expect(result?.time).toBe('04:00 PM');
  });

  it('defaults service to consultation when the model omits it', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'October 3, 2026',
      time: '9am',
      service: null,
      customer_name: null,
      customer_contact: null,
    });

    const result = await extractBooking('...', REF);

    expect(result?.service).toBe('consultation');
  });

  it('returns null when the model is not ready to book', async () => {
    modelReturns({
      ready_to_book: false,
      date: null,
      time: null,
      service: null,
      customer_name: null,
      customer_contact: null,
    });

    expect(await extractBooking('...', REF)).toBeNull();
  });

  it('returns null when the date cannot be parsed', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'whenever is good',
      time: '2 PM',
      service: 'consultation',
      customer_name: null,
      customer_contact: null,
    });

    expect(await extractBooking('...', REF)).toBeNull();
  });

  it('returns null when the time falls outside business hours', async () => {
    modelReturns({
      ready_to_book: true,
      date: 'October 3, 2026',
      time: '11 PM',
      service: 'consultation',
      customer_name: null,
      customer_contact: null,
    });

    expect(await extractBooking('...', REF)).toBeNull();
  });

  it('returns null when the model emits invalid JSON', async () => {
    mockGenerate.mockResolvedValue({ response: 'not json at all {' });

    expect(await extractBooking('...', REF)).toBeNull();
  });

  it('returns null when required fields are missing from the JSON', async () => {
    modelReturns({ ready_to_book: true }); // no date/time/service keys

    expect(await extractBooking('...', REF)).toBeNull();
  });

  it('returns null (never throws) when the model call fails', async () => {
    mockGenerate.mockRejectedValue(new Error('ollama down'));

    expect(await extractBooking('...', REF)).toBeNull();
  });
});
