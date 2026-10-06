import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./database', () => ({
  prisma: { conversationMessage: { findMany: vi.fn() } },
}));

import { recentMessages, CONTEXT_MESSAGES } from './conversationHistory';
import { prisma } from './database';

const mockFindMany = prisma.conversationMessage.findMany as unknown as ReturnType<typeof vi.fn>;

describe('recentMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the database for the newest messages, not the oldest', async () => {
    mockFindMany.mockResolvedValue([]);

    await recentMessages('conv-1');

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1' },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_MESSAGES,
    });
  });

  it('returns them oldest-first so they read as a transcript', async () => {
    // The database answers newest-first for a desc query.
    mockFindMany.mockResolvedValue([
      { role: 'assistant', content: 'm3' },
      { role: 'user', content: 'm2' },
      { role: 'assistant', content: 'm1' },
    ]);

    const messages = await recentMessages('conv-1');

    expect(messages.map((m) => m.content)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps a window of 10 messages by default and accepts another limit', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(CONTEXT_MESSAGES).toBe(10);

    await recentMessages('conv-1', 4);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
  });
});
