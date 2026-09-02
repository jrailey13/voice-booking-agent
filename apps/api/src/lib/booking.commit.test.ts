import { describe, it, expect, vi, beforeEach } from 'vitest';

// The commit path composes the extractor with the database. Both are mocked so
// this test exercises only the commit/guard logic (dedupe, availability, wiring).
vi.mock('./booking.extractor', () => ({ extractBooking: vi.fn() }));
vi.mock('./database', () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn() },
    appointment: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { maybeCommitBooking } from './booking.commit';
import { extractBooking } from './booking.extractor';
import { prisma } from './database';

const mockExtract = extractBooking as unknown as ReturnType<typeof vi.fn>;
const mockConvFind = prisma.conversation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockConvUpdate = prisma.conversation.update as unknown as ReturnType<typeof vi.fn>;
const mockMsgFind = prisma.conversationMessage.findMany as unknown as ReturnType<typeof vi.fn>;
const mockApptFind = prisma.appointment.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockApptCreate = prisma.appointment.create as unknown as ReturnType<typeof vi.fn>;

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

  it('returns null and does not create when nothing is extractable', async () => {
    mockExtract.mockResolvedValue(null);

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockApptCreate).not.toHaveBeenCalled();
  });

  it('does not double-book a conversation already linked to an appointment', async () => {
    mockConvFind.mockResolvedValue({ id: 'conv-1', appointmentId: 'existing' });

    const result = await maybeCommitBooking('conv-1');

    expect(result).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockApptCreate).not.toHaveBeenCalled();
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
