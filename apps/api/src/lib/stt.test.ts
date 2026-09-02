import { describe, it, expect, vi } from 'vitest';

// Mock the heavy transformers.js pipeline: the factory returns a fake ASR
// function so these tests are fast and never download a model. vi.hoisted lets
// the mocks exist before the hoisted vi.mock factory references them.
const { fakeAsr, pipelineMock } = vi.hoisted(() => {
  const fakeAsr = vi.fn(async (_pcm: Float32Array) => ({ text: '  Book me a consultation.  ' }));
  const pipelineMock = vi.fn(async () => fakeAsr);
  return { fakeAsr, pipelineMock };
});
vi.mock('@huggingface/transformers', () => ({ pipeline: pipelineMock }));

import { transcribe } from './stt';

describe('transcribe (local STT)', () => {
  it('returns trimmed model text and loads the pipeline only once', async () => {
    const first = await transcribe(new Float32Array([0, 0, 0]));
    expect(first).toBe('Book me a consultation.');
    expect(pipelineMock).toHaveBeenCalledTimes(1); // model loaded on first call

    const second = await transcribe(new Float32Array([1, 1, 1]));
    expect(second).toBe('Book me a consultation.');
    expect(pipelineMock).toHaveBeenCalledTimes(1); // singleton: not reloaded
    expect(fakeAsr).toHaveBeenCalledTimes(2);
  });

  it('joins chunked (array) output into one string', async () => {
    fakeAsr.mockResolvedValueOnce([{ text: 'Tuesday' }, { text: 'at 2 PM' }] as any);
    const text = await transcribe(new Float32Array([0]));
    expect(text).toBe('Tuesday at 2 PM');
  });
});
