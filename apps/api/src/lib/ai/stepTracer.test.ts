import { describe, it, expect, beforeEach } from 'vitest';
import { Embeddings } from '@langchain/core/embeddings';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { StepTracer, debugCallbacks } from './stepTracer';
import { RagService } from '../../services/rag.service';
import { FakeRagDb, embedText } from '../../test/fakes';

class WordEmbeddings extends Embeddings {
  constructor() { super({}); }
  async embedDocuments(texts: string[]) { return texts.map(embedText); }
  async embedQuery(text: string) { return embedText(text); }
}

/** A clock that advances 0.5s per reading, so durations are predictable. */
function steppingClock() {
  let t = 0;
  return () => (t += 500);
}

let lines: string[];
beforeEach(() => { lines = []; });

describe('StepTracer', () => {
  it('prints the retrieval and the model call of a RAG query, in order', async () => {
    const tracer = new StepTracer((line) => lines.push(line), steppingClock());
    const service = new RagService({
      db: new FakeRagDb() as never,
      embeddings: new WordEmbeddings(),
      model: new FakeListChatModel({ responses: ['It opens at 9 AM.'] }),
      callbacks: [tracer],
    });
    const doc = await service.uploadDocument({ filename: 'hours.txt', mimetype: 'text/plain', buffer: Buffer.from('We open at 9 AM.') });

    await service.queryDocuments('When do you open?', [doc.id]);

    expect(lines).toEqual([
      '· retriever "When do you open?"',
      '· retriever 0.5s → 1 docs (hours.txt)',
      '· model     started (2 messages)',
      '· model     0.5s → answer (17 chars)',
    ]);
  });

  it('reports a failed retrieval with the elapsed time', async () => {
    const tracer = new StepTracer((line) => lines.push(line), steppingClock());
    await tracer.handleRetrieverStart({ lc: 1, type: 'not_implemented', id: ['x'] }, 'q', 'r1');
    await tracer.handleRetrieverError(new Error('embed failed'), 'r1');
    expect(lines[1]).toBe('· retriever failed after 0.5s: embed failed');
  });
});

describe('debugCallbacks', () => {
  it('returns a StepTracer only for DEBUG=true', () => {
    expect(debugCallbacks({ DEBUG: 'true' })).toEqual([expect.any(StepTracer)]);
    expect(debugCallbacks({ DEBUG: 'false' })).toEqual([]);
    expect(debugCallbacks({})).toEqual([]);
  });
});
