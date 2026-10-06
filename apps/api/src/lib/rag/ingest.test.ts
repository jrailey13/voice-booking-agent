import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Embeddings } from '@langchain/core/embeddings';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ingestDocument } from './ingest';
import { FakeRagDb, embedText } from '../../test/fakes';

class WordEmbeddings extends Embeddings {
  calls: string[][] = [];
  fail = false;
  constructor() { super({}); }
  async embedDocuments(texts: string[]) {
    if (this.fail) throw new Error('embedding service down');
    this.calls.push(texts);
    return texts.map(embedText);
  }
  async embedQuery(text: string) { return embedText(text); }
}

const TEXT = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} explains one rule of the policy.`).join('\n\n');
const meta = { id: 'doc-1', name: 'policy.txt', size: 1234, type: 'text/plain' };

let db: FakeRagDb;
let embeddings: WordEmbeddings;
const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 200, chunkOverlap: 40 });

beforeEach(() => {
  db = new FakeRagDb();
  embeddings = new WordEmbeddings();
});

describe('ingestDocument', () => {
  it('stores the document and its split, embedded chunks', async () => {
    const { chunkCount } = await ingestDocument({ db: db as never, embeddings, splitter }, { ...meta, text: TEXT });

    expect(db.documents).toEqual([{ ...meta, content: TEXT }]);
    expect(chunkCount).toBe(db.chunks.length);
    expect(chunkCount).toBeGreaterThan(1);
    expect(db.chunks.map((c) => c.chunkIndex)).toEqual(db.chunks.map((_, i) => i));
    for (const c of db.chunks) {
      expect(c.documentId).toBe('doc-1');
      expect(c.content.length).toBeLessThanOrEqual(200);
      expect(c.embedding).toEqual(embedText(c.content));
    }
  });

  it('embeds all chunks before opening the transaction', async () => {
    const order: string[] = [];
    const embed = embeddings.embedDocuments.bind(embeddings);
    embeddings.embedDocuments = async (t) => { order.push('embed'); return embed(t); };
    const tx = db.$transaction;
    db.$transaction = (async (fn: never) => { order.push('transaction'); return tx(fn); }) as never;

    await ingestDocument({ db: db as never, embeddings, splitter }, { ...meta, text: TEXT });
    expect(order).toEqual(['embed', 'transaction']);
  });

  it('writes nothing when embedding fails', async () => {
    embeddings.fail = true;
    await expect(ingestDocument({ db: db as never, embeddings, splitter }, { ...meta, text: TEXT })).rejects.toThrow('embedding service down');
    expect(db.documents).toEqual([]);
    expect(db.chunks).toEqual([]);
  });

  it('rolls back the document row when the chunk write fails', async () => {
    const createMany = db.ragChunk.createMany;
    db.ragChunk.createMany = vi.fn(async () => { throw new Error('disk full'); }) as never;
    await expect(ingestDocument({ db: db as never, embeddings, splitter }, { ...meta, text: TEXT })).rejects.toThrow('disk full');
    db.ragChunk.createMany = createMany;
    expect(db.documents).toEqual([]);
    expect(db.chunks).toEqual([]);
  });

  it('stores an empty document with no chunks', async () => {
    const { chunkCount } = await ingestDocument({ db: db as never, embeddings, splitter }, { ...meta, text: '' });
    expect(chunkCount).toBe(0);
    expect(db.documents).toHaveLength(1);
    expect(embeddings.calls).toEqual([]);
  });
});
