import { describe, it, expect, vi, beforeEach } from 'vitest';

// Contract tests for RagService: they pin what the HTTP routes return and what
// gets stored, independent of how the service talks to Ollama or Prisma. They
// were written against the hand-rolled implementation and must keep passing
// after the LangChain rework (FR3 in docs/langchain-fit-assessment.md).

const { ollama, db } = await vi.hoisted(async () => {
  const { createFakeOllama, FakeRagDb } = await import('../test/fakes');
  const ollama = createFakeOllama();
  // Ollama clients capture fetch when constructed (at module load), so stub first.
  globalThis.fetch = ollama.fetch;
  return { ollama, db: new FakeRagDb() };
});

vi.mock('../lib/database', () => ({ prisma: db }));

import { RagService } from './rag.service';

// Spelled out with explicit joins: the original prompt has a trailing space on
// its first two lines, which editors tend to strip from a template literal.
const SYSTEM_PROMPT = [
  'You are a helpful assistant that answers questions based on provided documents. ',
  'Always use only the information provided in the context to answer questions. ',
  'If the answer is not in the context, say "I don\'t have enough information to answer this question."',
].join('\n');

const HOURS = 'Office hours. The office opens at 9 AM and closes at 5 PM on weekdays. The office is closed on weekends.';
// Short sections (under 100 characters) so each survives whole under any
// chunking with 100 characters of overlap, the old fixed window included.
const REFUNDS = Array.from({ length: 30 }, (_, i) =>
  `Refund rule ${i}: refunds are allowed within thirty days with a receipt.`
).join('\n\n');

const service = new RagService();

async function upload(name: string, text: string) {
  return service.uploadDocument({ filename: name, mimetype: 'text/plain', buffer: Buffer.from(text, 'utf-8') });
}

beforeEach(() => {
  ollama.reset();
  db.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('uploadDocument', () => {
  it('returns the upload response shape', async () => {
    const res = await upload('hours.txt', HOURS);
    expect(res).toEqual({ id: expect.any(String), name: 'hours.txt', size: Buffer.byteLength(HOURS), type: 'text/plain', status: 'ready' });
  });

  it('stores the document text and chunks of at most 500 characters covering it', async () => {
    const res = await upload('refunds.txt', REFUNDS);
    expect(db.documents).toEqual([expect.objectContaining({ id: res.id, name: 'refunds.txt', content: REFUNDS })]);

    const chunks = db.chunks.filter((c) => c.documentId === res.id).sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(500);
      expect(c.embedding).toHaveLength(64);
    }
    // Every sentence of the source survives somewhere in the chunks.
    for (const sentence of REFUNDS.split('\n\n')) {
      expect(chunks.some((c) => c.content.includes(sentence))).toBe(true);
    }
  });

  it('reports failed and stores nothing when embedding fails', async () => {
    ollama.failEmbeddings = true;
    const res = await upload('hours.txt', HOURS);
    expect(res.status).toBe('failed');
    expect(db.documents).toEqual([]);
    expect(db.chunks).toEqual([]);
  });

  it('reports failed and leaves no orphan rows when the database write fails', async () => {
    db.failNextWrite = true;
    const res = await upload('hours.txt', HOURS);
    expect(res.status).toBe('failed');
    expect(db.documents).toEqual([]);
    expect(db.chunks).toEqual([]);
  });
});

describe('queryDocuments', () => {
  it('returns the answer with the query response shape', async () => {
    const hours = await upload('hours.txt', HOURS);
    ollama.answer = 'It opens at 9 AM.';
    const res = await service.queryDocuments('When does the office open?', [hours.id]);
    expect(res).toEqual({
      id: expect.any(String),
      answer: 'It opens at 9 AM.',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      sources: [{ title: 'hours.txt', snippet: HOURS.substring(0, 150) + '...' }],
    });
  });

  it('sends the fixed system prompt and the Context/Question/Answer layout', async () => {
    const hours = await upload('hours.txt', HOURS);
    await service.queryDocuments('When does the office open?', [hours.id]);
    expect(ollama.llmRequests).toHaveLength(1);
    const { system, user } = ollama.llmRequests[0];
    // Line endings in the source prompt follow the checkout (CRLF on Windows); they are not part of the contract.
    expect(system.replace(/\r\n/g, '\n')).toBe(SYSTEM_PROMPT);
    expect(user).toBe(`Context:\n[hours.txt]\n${HOURS}\n\nQuestion: When does the office open?\n\nAnswer:`);
  });

  it('puts at most 5 chunks in context, best match first, separated by ---', async () => {
    const hours = await upload('hours.txt', HOURS);
    const refunds = await upload('refunds.txt', REFUNDS);
    await service.queryDocuments('When does the office open on weekdays?', [hours.id, refunds.id]);

    const context = ollama.llmRequests[0].user.replace(/^Context:\n/, '').split('\n\nQuestion:')[0];
    const blocks = context.split('\n\n---\n\n');
    expect(blocks.length).toBe(5);
    expect(blocks[0]).toBe(`[hours.txt]\n${HOURS}`);
    for (const block of blocks) {
      const [, name, content] = block.match(/^\[(.+?)\]\n([\s\S]*)$/)!;
      expect(db.chunks.some((c) => c.content === content && db.documents.find((d) => d.id === c.documentId)?.name === name)).toBe(true);
    }
  });

  it('lists each source document once, in rank order, with a 150-character snippet of its best chunk', async () => {
    const hours = await upload('hours.txt', HOURS);
    const refunds = await upload('refunds.txt', REFUNDS);
    const res = await service.queryDocuments('When does the office open on weekdays?', [hours.id, refunds.id]);

    expect(res.sources!.map((s) => s.title)).toEqual(['hours.txt', 'refunds.txt']);
    const context = ollama.llmRequests[0].user;
    const firstRefundChunk = context.split('[refunds.txt]\n')[1].split('\n\n---\n\n')[0].split('\n\nQuestion:')[0];
    expect(res.sources![1].snippet).toBe(firstRefundChunk.substring(0, 150) + '...');
  });

  it('only retrieves from the requested documents', async () => {
    const hours = await upload('hours.txt', HOURS);
    await upload('refunds.txt', REFUNDS);
    const res = await service.queryDocuments('refund policy receipt', [hours.id]);
    expect(res.sources!.map((s) => s.title)).toEqual(['hours.txt']);
    expect(ollama.llmRequests[0].user).not.toContain('refunds.txt');
  });

  it('answers without calling the model when nothing is retrieved', async () => {
    const res = await service.queryDocuments('anything', ['missing-doc']);
    expect(res).toEqual({
      id: expect.any(String),
      answer: 'No relevant information found in the provided documents.',
      timestamp: expect.any(String),
      sources: [],
    });
    expect(ollama.llmRequests).toHaveLength(0);
    expect(db.queryLogs).toHaveLength(0);
  });

  it('logs the question, answer and requested file ids', async () => {
    const hours = await upload('hours.txt', HOURS);
    ollama.answer = 'Nine.';
    await service.queryDocuments('When does the office open?', [hours.id]);
    expect(db.queryLogs).toEqual([{ question: 'When does the office open?', answer: 'Nine.', sources: [hours.id] }]);
  });
});

describe('deleteDocument', () => {
  it('removes the document and its chunks', async () => {
    const hours = await upload('hours.txt', HOURS);
    const refunds = await upload('refunds.txt', REFUNDS);
    await service.deleteDocument(hours.id);
    expect(db.documents.map((d) => d.id)).toEqual([refunds.id]);
    expect(db.chunks.every((c) => c.documentId === refunds.id)).toBe(true);
  });
});
