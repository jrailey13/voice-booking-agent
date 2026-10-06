import { prisma } from './database';

/**
 * How many stored messages the reply model and the booking extractor see.
 * Shared so both read the same window of the conversation.
 */
export const CONTEXT_MESSAGES = 10;

export interface HistoryMessage {
  role: string;
  content: string;
}

/**
 * The most recent `limit` messages of a conversation, oldest first.
 *
 * Fetches newest-first and reverses: an ascending query with `take` would
 * return the *first* messages, and the model would stop seeing new turns once
 * a conversation grew past the window.
 */
export async function recentMessages(
  conversationId: string,
  limit: number = CONTEXT_MESSAGES
): Promise<HistoryMessage[]> {
  const newestFirst = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return newestFirst.reverse();
}
