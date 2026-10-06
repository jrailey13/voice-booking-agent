import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { Document } from '@langchain/core/documents';
import { Embeddings } from '@langchain/core/embeddings';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { BaseMessage } from '@langchain/core/messages';
import { buildRagChain, RAG_SYSTEM_PROMPT, NO_RESULTS_ANSWER } from './chain';
import { PrismaVectorStore, type ChunkMetadata } from './prismaVectorStore';
import { FakeRagDb, embedText } from '../../test/fakes';

class WordEmbeddings extends Embeddings {
  constructor() { super({}); }
  async embedDocuments(texts: string[]) { return texts.map(embedText); }
  async embedQuery(text: string) { return embedText(text); }
}

const chunk = (documentId: string, pageContent: string, chunkIndex = 0) =>
  new Document<ChunkMetadata>({ pageContent, metadata: { documentId, documentName: documentId, chunkIndex } });

/** Records what the model was sent. */
class RecordingModel extends FakeListChatModel {
  seen: BaseMessage[][] = [];
  async _generate(messages: BaseMessage[], ...rest: Parameters<FakeListChatModel['_generate']> extends [unknown, ...infer R] ? R : never) {
    this.seen.push(messages);
    return super._generate(messages, ...rest);
  }
}

let db: FakeRagDb;
let store: PrismaVectorStore;
let search: MockInstance<PrismaVectorStore['similaritySearch']>;

/** Seed the fake DB; document ids double as file names to keep assertions short. */
async function seed(chunks: Document<ChunkMetadata>[]) {
  for (const id of new Set(chunks.map((c) => c.metadata.documentId))) {
    await db.ragDocument.create({ data: { id, name: id, size: 1, type: 'text/plain', content: '' } });
  }
  await store.addDocuments(chunks);
}

beforeEach(async () => {
  db = new FakeRagDb();
  store = new PrismaVectorStore(new WordEmbeddings(), db as never);
  search = vi.spyOn(store, 'similaritySearch');
  // "open" appears only in hours.txt, so it ranks first for the questions below.
  await seed([chunk('hours.txt', 'It will open at 9 AM.'), chunk('refunds.txt', 'Thirty-day refunds.')]);
});

const searchArgs = () => search.mock.calls.map(([query, k, filter]) => ({ query, k, filter }));

describe('buildRagChain', () => {
  it('retrieves k chunks from the requested files and answers from them', async () => {
    const model = new RecordingModel({ responses: ['It opens at 9 AM.'] });
    const out = await buildRagChain({ store, model, k: 5 }).invoke({ question: 'When will it open?', fileIds: ['hours.txt', 'refunds.txt'] });

    expect(searchArgs()).toEqual([{ query: 'When will it open?', k: 5, filter: { documentIds: ['hours.txt', 'refunds.txt'] } }]);
    expect(out.answer).toBe('It opens at 9 AM.');
    expect(out.docs.map((d) => d.metadata.documentName)).toEqual(['hours.txt', 'refunds.txt']);
  });

  it('sends the system prompt and the Context/Question/Answer layout', async () => {
    const model = new RecordingModel({ responses: ['x'] });
    await buildRagChain({ store, model }).invoke({ question: 'When will it open?', fileIds: ['hours.txt', 'refunds.txt'] });

    const [system, human] = model.seen[0];
    expect(system.getType()).toBe('system');
    expect(system.content).toBe(RAG_SYSTEM_PROMPT);
    expect(human.getType()).toBe('human');
    expect(human.content).toBe(
      'Context:\n[hours.txt]\nIt will open at 9 AM.\n\n---\n\n[refunds.txt]\nThirty-day refunds.\n\nQuestion: When will it open?\n\nAnswer:'
    );
  });

  it('does not treat braces in documents or questions as template variables', async () => {
    await seed([chunk('code.md', 'const x = { a: 1 }')]);
    const model = new RecordingModel({ responses: ['x'] });
    await buildRagChain({ store, model }).invoke({ question: 'What is {a}?', fileIds: ['code.md'] });
    expect(model.seen[0][1].content).toContain('const x = { a: 1 }');
    expect(model.seen[0][1].content).toContain('Question: What is {a}?');
  });

  it('skips the model and returns the fixed answer when nothing is retrieved', async () => {
    const model = new RecordingModel({ responses: ['should not be used'] });
    const out = await buildRagChain({ store, model }).invoke({ question: 'Q', fileIds: ['missing'] });
    expect(out).toEqual({ answer: NO_RESULTS_ANSWER, docs: [] });
    expect(model.seen).toEqual([]);
  });

  it('defaults to 5 chunks', async () => {
    await buildRagChain({ store, model: new RecordingModel({ responses: ['x'] }) }).invoke({ question: 'Q', fileIds: ['hours.txt'] });
    expect(searchArgs()[0].k).toBe(5);
  });
});
