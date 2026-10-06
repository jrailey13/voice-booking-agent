import { describe, it, expect, vi, beforeEach } from 'vitest';

// The commit path composes the extractor with the database. Both are mocked so
// this test exercises only the commit/guard logic (dedupe, availability, wiring).
vi.mock('./booking.extractor', () => ({ extractBooking: vi.fn() }));
vi.mock('./conversationHistory', () => ({ recentMessages: vi.fn() }));
vi.mock('./database', () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    appointment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { maybeCommitBooking } from './booking.commit';
import { extractBooking } from './booking.extractor';
import { recentMessages } from './conversationHistory';
import { prisma } from './database';

const mockExtract = extractBooking as unknown as ReturnType<typeof vi.fn>;
const mockConvFind = prisma.conversation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as unknown as ReturnType<typeof vi.fn>;
// Messages come from recentMessages (newest window, oldest-first), tested in conversationHistory.test.ts.
const mockMsgFind = recentMessages as unknown as ReturnType<typeof vi.fn>;
const mockApptFind = prisma.appointment.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockApptGet = prisma.appointment.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockApptCreate = prisma.appointment.create as unknown as ReturnType<typeof vi.fn>;
const mockApptUpdate = prisma.appointment.update as unknown as ReturnType<typeof vi.fn>;

const READY = {
  date: '2026-10-03',
  time: '02:00 PM',
  service: 'consultation',
  customerName: 'Jane Doe',
  customerContact: '555-0100',
};

describe('maybeCommitBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: null });
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'book me Oct 3 at 2pm' },
      { role: 'assistant', content: "You're booked!" },
    ]);
    mockApptFind.mockResolvedValue(null); // slot free
    mockApptCreate.mockResolvedValue({ id: 'appt-1', ...READY, status: 'confirmed' });
    mockConvUpdate.mockResolvedValue({});
  });

  it('creates and links an appointment when a booking is extracted', async () => {
    mockExtract.mockResolvedValue(READY);

    const result = await maybeCommitBooking('conv-1');

    expect(mockApptCreate).toHaveBeenCalledWith({
      data: {
        date: '2026-10-03',
        time: '02:00 PM',
        service: 'consultation',
        customerName: 'Jane Doe',
        customerContact: '555-0100',
        status: 'confirmed',
      },
    });
    expect(mockConvUpdate).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { appointmentId: 'appt-1' },
    });
    expect(result).toMatchObject({ id: 'appt-1', date: '2026-10-03', time: '02:00 PM' });
  });

  it('reads the recent-message window, so late confirmations are seen', async () => {
    mockExtract.mockResolvedValue(READY);

    await maybeCommitBooking('conv-1');

    expect(mockMsgFind).toHaveBeenCalledWith('conv-1');
  });

  it('returns null and does not create when nothing is extractable', async () => {
    mockExtract.mockResolvedValue(null);

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockApptCreate).not.toHaveBeenCalled();
  });

  it('does not create a second appointment for a fully-booked conversation', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'existing' });
    // Already has name + contact — nothing left to enrich, so no LLM call.
    mockApptGet.mockResolvedValue({
      id: 'existing',
      ...READY,
      status: 'confirmed',
    });

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockApptCreate).not.toHaveBeenCalled();
  });

  it('enriches an already-booked appointment when the name/contact arrive later', async () => {
    // The first commit landed with no customer details (the model confirmed
    // before the caller gave their name). A later turn supplies them.
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'appt-1' });
    mockApptGet.mockResolvedValue({
      id: 'appt-1',
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: null,
      customerContact: null,
      status: 'confirmed',
    });
    mockExtract.mockResolvedValue(READY); // now includes Jane Doe / 555-0100
    mockApptUpdate.mockResolvedValue({
      id: 'appt-1',
      ...READY,
      status: 'confirmed',
    });

    const result = await maybeCommitBooking('conv-1');

    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { customerName: 'Jane Doe', customerContact: '555-0100' },
    });
    expect(mockApptCreate).not.toHaveBeenCalled(); // no double-booking
    expect(result).toMatchObject({ customerName: 'Jane Doe', customerContact: '555-0100' });
  });

  it('does not re-write details that are already present', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'appt-1' });
    mockApptGet.mockResolvedValue({
      id: 'appt-1',
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jane Doe',
      customerContact: null, // only contact is missing
      status: 'confirmed',
    });
    mockExtract.mockResolvedValue(READY);
    mockApptUpdate.mockResolvedValue({
      id: 'appt-1',
      ...READY,
      status: 'confirmed',
    });

    await maybeCommitBooking('conv-1');

    // Only the missing field is updated; the existing name is left untouched.
    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { customerContact: '555-0100' },
    });
  });

  it('applies a later correction to a wrong (mis-heard) name', async () => {
    // The first commit captured a mis-transcribed name; the caller then spells
    // it out to correct it. The stored value must be overwritten, not kept.
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'appt-1' });
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'My last name is spelled R-A-I-L-E-Y, please fix that' },
      { role: 'assistant', content: 'Sure, let me update that for you.' }, // no confirmation cue
    ]);
    mockApptGet.mockResolvedValue({
      id: 'appt-1',
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jameson Reley', // the mis-heard name
      customerContact: null,
      status: 'confirmed',
    });
    mockExtract.mockResolvedValue({
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jameson Railey', // corrected
      customerContact: null,
    });
    mockApptUpdate.mockResolvedValue({
      id: 'appt-1',
      date: '2026-10-03',
      time: '02:00 PM',
      service: 'consultation',
      customerName: 'Jameson Railey',
      customerContact: null,
      status: 'confirmed',
    });

    const result = await maybeCommitBooking('conv-1');

    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { customerName: 'Jameson Railey' },
    });
    expect(result).toMatchObject({ customerName: 'Jameson Railey' });
  });

  it('re-checks details on a correction cue even when nothing is missing', async () => {
    // Both fields are already set, so the missing-field path would skip the LLM.
    // A correction cue in the latest turn must still trigger a re-extraction.
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'appt-1' });
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'Actually, my number should be 555-0199' },
      { role: 'assistant', content: "Done — you're all set." },
    ]);
    mockApptGet.mockResolvedValue({
      id: 'appt-1',
      ...READY, // name + contact both present (555-0100)
      status: 'confirmed',
    });
    mockExtract.mockResolvedValue({ ...READY, customerContact: '555-0199' });
    mockApptUpdate.mockResolvedValue({
      id: 'appt-1',
      ...READY,
      customerContact: '555-0199',
      status: 'confirmed',
    });

    await maybeCommitBooking('conv-1');

    expect(mockExtract).toHaveBeenCalledOnce();
    expect(mockApptUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { customerContact: '555-0199' },
    });
  });

  it('leaves a fully-booked conversation alone when there is no correction cue', async () => {
    // Both details present and the latest turn is ordinary chatter → no LLM call.
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'appt-1' });
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'great, thank you so much!' },
      { role: 'assistant', content: "You're welcome!" },
    ]);
    mockApptGet.mockResolvedValue({ id: 'appt-1', ...READY, status: 'confirmed' });

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockApptUpdate).not.toHaveBeenCalled();
  });

  it('does not book a slot that is already taken', async () => {
    mockExtract.mockResolvedValue(READY);
    mockApptFind.mockResolvedValue({ id: 'other', date: '2026-10-03', time: '02:00 PM' });

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockApptCreate).not.toHaveBeenCalled();
  });

  it('never throws — a failed extraction yields null', async () => {
    mockExtract.mockRejectedValue(new Error('boom'));

    await expect(maybeCommitBooking('conv-1')).resolves.toBeNull();
    expect(mockApptCreate).not.toHaveBeenCalled();
  });

  it('skips the (expensive) extraction until the assistant confirms a booking', async () => {
    // Mid-conversation: the assistant is still gathering details, no confirmation
    // language yet. We must not spend an LLM extraction call on every turn.
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'I want to book something' },
      { role: 'assistant', content: 'Sure! What day and time work for you?' },
    ]);

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('runs extraction once the assistant confirms', async () => {
    mockMsgFind.mockResolvedValue([
      { role: 'user', content: 'Oct 3 at 2pm' },
      { role: 'assistant', content: "All set — you're scheduled for October 3rd at 2 PM." },
    ]);
    mockExtract.mockResolvedValue(READY);

    const result = await maybeCommitBooking('conv-1');

    expect(mockExtract).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 'appt-1' });
  });
});
