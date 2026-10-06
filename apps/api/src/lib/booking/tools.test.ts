import { describe, it, expect, beforeEach } from 'vitest';
import { buildBookingTools, type BookingToolState } from './tools';
import { FakeBookingDb } from '../../test/fakes';

// Monday 5 October 2026, so "tomorrow" is Tuesday 2026-10-06.
const REF = new Date(2026, 9, 5, 10, 0);

let db: FakeBookingDb;
let state: BookingToolState;
let tools: ReturnType<typeof buildBookingTools>['tools'];

const call = (name: string, args: Record<string, unknown>) =>
  tools.find((t) => t.name === name)!.invoke(args) as Promise<string>;

beforeEach(() => {
  db = new FakeBookingDb();
  db.conversations.push({ id: 'conv-1', appointmentId: null });
  ({ tools, state } = buildBookingTools({ db: db as never, conversationId: 'conv-1', ref: REF }));
});

describe('check_availability', () => {
  it('lists the open slots for a natural-language date', async () => {
    db.appointments.push({ id: 'a', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'confirmed' });

    const out = await call('check_availability', { date: 'tomorrow' });

    expect(out).toContain('Tuesday, October 6');
    expect(out).toContain('01:00 PM');
    expect(out).not.toContain('02:00 PM');
  });

  it('ignores cancelled appointments', async () => {
    db.appointments.push({ id: 'a', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'cancelled' });
    expect(await call('check_availability', { date: 'October 6' })).toContain('02:00 PM');
  });

  it('returns an error the model can act on for an unreadable date', async () => {
    expect(await call('check_availability', { date: 'whenever' })).toMatch(/^Error: .*date/);
  });
});

describe('book_appointment', () => {
  const tuesday2pm = { date: 'tomorrow', time: '2pm', service: 'consultation', customerName: 'Jane Doe', customerContact: '555-0100' };

  it('writes a normalized appointment, links it to the conversation and records it', async () => {
    const out = await call('book_appointment', tuesday2pm);

    expect(db.appointments).toEqual([
      expect.objectContaining({ date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: 'Jane Doe', customerContact: '555-0100', status: 'confirmed' }),
    ]);
    expect(db.conversations[0].appointmentId).toBe(db.appointments[0].id);
    expect(state.booked).toMatchObject({ id: db.appointments[0].id, date: '2026-10-06', time: '02:00 PM' });
    expect(out).toMatch(/^Booked: consultation on Tuesday, October 6 at 02:00 PM/);
  });

  it('accepts a missing name and contact', async () => {
    await call('book_appointment', { date: 'tomorrow', time: '9am', service: 'follow-up', customerName: null });
    expect(db.appointments[0]).toMatchObject({ time: '09:00 AM', service: 'follow-up', customerName: null, customerContact: null });
  });

  it('refuses a taken slot and offers the open ones, writing nothing', async () => {
    db.appointments.push({ id: 'a', date: '2026-10-06', time: '02:00 PM', service: 'consultation', customerName: null, customerContact: null, status: 'confirmed' });

    const out = await call('book_appointment', tuesday2pm);

    expect(out).toMatch(/^Error: 02:00 PM on Tuesday, October 6 is already taken/);
    expect(out).toContain('03:00 PM');
    expect(db.appointments).toHaveLength(1);
    expect(state.booked).toBeNull();
    expect(state.refusal).toMatch(/^Sorry, 02:00 PM on Tuesday, October 6 is already taken\. Open times: /);
  });

  it('refuses a second booking in the same conversation', async () => {
    await call('book_appointment', tuesday2pm);
    const out = await call('book_appointment', { ...tuesday2pm, time: '3pm' });

    expect(out).toMatch(/^Error: this caller is already booked/);
    expect(db.appointments).toHaveLength(1);
  });

  it('refuses times outside business hours rather than guessing', async () => {
    expect(await call('book_appointment', { ...tuesday2pm, time: '8pm' })).toMatch(/^Error: .*time/);
    expect(db.appointments).toEqual([]);
    expect(state.refusal).toMatch(/^Sorry, .*9 AM to 5 PM/);
  });

  it('records no refusal when booking succeeds', async () => {
    await call('book_appointment', tuesday2pm);
    expect(state.refusal).toBeNull();
  });

  it('refuses an unknown service rather than inventing one', async () => {
    expect(await call('book_appointment', { ...tuesday2pm, service: 'massage' })).toMatch(/^Error: .*consultation, follow-up, initial assessment/);
  });

  it('matches services loosely ("Initial Assessment", "followup")', async () => {
    await call('book_appointment', { ...tuesday2pm, service: 'Initial Assessment' });
    expect(db.appointments[0].service).toBe('initial assessment');
  });

  it('reports a database failure as an error and leaves nothing half-written', async () => {
    db.failNextCreate = true;
    expect(await call('book_appointment', tuesday2pm)).toMatch(/^Error: /);
    expect(db.appointments).toEqual([]);
    expect(db.conversations[0].appointmentId).toBeNull();
    expect(state.booked).toBeNull();
  });
});
