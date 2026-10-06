import { describe, it, expect, beforeEach } from 'vitest';
import { Document } from '@langchain/core/documents';
import { FakeEmbeddings } from '@langchain/core/utils/testing';
import { Embeddings } from '@langchain/core/embeddings';
import { PrismaVectorStore, type ChunkMetadata } from './prismaVectorStore';
import { FakeRagDb, embedText } from '../../test/fakes';

/** Deterministic bag-of-words embeddings, so ranking is predictable. */
class WordEmbeddings extends Embeddings {
  constructor() { super({}); }
  async embedDocuments(texts: string[]) { return texts.map(embedText); }
  async embedQuery(text: string) { return embedText(text); }
}

let db: FakeRagDb;
let store: PrismaVectorStore;

const doc = (documentId: string, documentName: string, chunkIndex: number, pageContent: string) =>
  new Document<ChunkMetadata>({ pageContent, metadata: { documentId, documentName, chunkIndex } });

beforeEach(async () => {
  db = new FakeRagDb();
  await db.ragDocument.create({ data: { id: 'd1', name: 'hours.txt', size: 1, type: 'text/plain', content: '' } });
  await db.ragDocument.create({ data: { id: 'd2', name: 'refunds.txt', size: 1, type: 'text/plain', content: '' } });
  store = new PrismaVectorStore(new WordEmbeddings(), db as never);
  await store.addDocuments([
    doc('d1', 'hours.txt', 0, 'The office opens at 9 AM on weekdays.'),
    doc('d2', 'refunds.txt', 0, 'Refunds are allowed within thirty days.'),
    doc('d2', 'refunds.txt', 1, 'A receipt is required for every refund.'),
  ]);
});

describe('PrismaVectorStore', () => {
  it('persists chunks with their embedding, document and index', () => {
    expect(db.chunks).toEqual([
      expect.objectContaining({ documentId: 'd1', chunkIndex: 0, content: 'The office opens at 9 AM on weekdays.', embedding: embedText('The office opens at 9 AM on weekdays.') }),
      expect.objectContaining({ documentId: 'd2', chunkIndex: 0 }),
      expect.objectContaining({ documentId: 'd2', chunkIndex: 1 }),
    ]);
  });

  it('rejects documents without the metadata it needs to store them', async () => {
    await expect(store.addDocuments([new Document({ pageContent: 'x', metadata: {} })])).rejects.toThrow(/documentId/);
  });

  it('ranks by cosine similarity, best first, with scores and metadata', async () => {
    const results = await store.similaritySearchWithScore('refunds receipt required', 3, { documentIds: ['d1', 'd2'] });
    expect(results.map(([d]) => d.pageContent)).toEqual([
      'A receipt is required for every refund.',
      'Refunds are allowed within thirty days.',
      'The office opens at 9 AM on weekdays.',
    ]);
    expect(results[0][0].metadata).toEqual({ documentId: 'd2', documentName: 'refunds.txt', chunkIndex: 1 });
    expect(results[0][1]).toBeGreaterThan(results[1][1]);
  });

  it('returns at most k results', async () => {
    expect(await store.similaritySearch('office', 2, { documentIds: ['d1', 'd2'] })).toHaveLength(2);
  });

  it('only searches the requested documents', async () => {
    const results = await store.similaritySearch('refund receipt', 5, { documentIds: ['d1'] });
    expect(results.map((d) => d.metadata.documentName)).toEqual(['hours.txt']);
  });

  it('returns nothing without a document filter, rather than searching everything', async () => {
    expect(await store.similaritySearch('office', 5)).toEqual([]);
    expect(await store.similaritySearch('office', 5, { documentIds: [] })).toEqual([]);
  });

  it('works as a LangChain retriever', async () => {
    const retriever = store.asRetriever({ k: 1, filter: { documentIds: ['d1', 'd2'] } });
    const [top] = await retriever.invoke('when does the office open');
    expect(top.metadata.documentName).toBe('hours.txt');
  });

  it('accepts any LangChain Embeddings implementation', async () => {
    const other = new PrismaVectorStore(new FakeEmbeddings(), db as never);
    await other.addDocuments([doc('d1', 'hours.txt', 1, 'more')]);
    expect(db.chunks).toHaveLength(4);
  });
});
