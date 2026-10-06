import { describe, it, expect } from 'vitest';
import { hangingFetch, settlesWithin } from '../../test/hangingFetch';
import { createChatModel, createEmbeddings, createBookingAgentModel } from './models';

describe('model factory', () => {
  it('defaults to the local Ollama models the API already uses', () => {
    const chat = createChatModel({});
    const embeddings = createEmbeddings({});
    expect(chat.model).toBe('gemma3');
    expect(chat.baseUrl).toBe('http://localhost:11434');
    expect(embeddings.model).toBe('nomic-embed-text');
    expect(embeddings.baseUrl).toBe('http://localhost:11434');
  });

  it('fails fast instead of retrying (LangChain retries 6 times with backoff by default)', () => {
    // maxRetries is protected on AsyncCaller; read it to pin the configuration.
    const retries = (m: { caller: unknown }) => (m.caller as { maxRetries: number }).maxRetries;
    expect(retries(createChatModel({}))).toBe(0);
    expect(retries(createEmbeddings({}))).toBe(0);
    expect(retries(createBookingAgentModel({}))).toBe(0);
  });

  it('reads LLM_MODEL, EMBEDDING_MODEL and OLLAMA_BASE_URL', () => {
    const env = { LLM_MODEL: 'llama3.1', EMBEDDING_MODEL: 'mxbai-embed-large', OLLAMA_BASE_URL: 'http://gpu:11434' };
    expect(createChatModel(env)).toMatchObject({ model: 'llama3.1', baseUrl: 'http://gpu:11434' });
    expect(createEmbeddings(env)).toMatchObject({ model: 'mxbai-embed-large', baseUrl: 'http://gpu:11434' });
  });

  it('gives the booking agent its own tool-capable model, not LLM_MODEL (gemma3 cannot call tools)', () => {
    expect(createBookingAgentModel({ LLM_MODEL: 'gemma3' })).toMatchObject({ model: 'qwen2.5:7b-instruct', baseUrl: 'http://localhost:11434' });
    expect(createBookingAgentModel({ BOOKING_AGENT_MODEL: 'llama3.1', OLLAMA_BASE_URL: 'http://gpu:11434' }))
      .toMatchObject({ model: 'llama3.1', baseUrl: 'http://gpu:11434' });
  });

  it('cancels the HTTP request when the call signal aborts, even before Ollama answers', async () => {
    // ChatOllama only checks the signal between streamed chunks, so on its own a
    // request that never produces a first token cannot be cancelled.
    const server = hangingFetch();
    for (const model of [
      createChatModel({}, { signal: AbortSignal.timeout(20), fetch: server.fetch }),
      createBookingAgentModel({}, { signal: AbortSignal.timeout(20), fetch: server.fetch }),
    ]) {
      const outcome = await settlesWithin(model.invoke('hi'), 1000);
      expect(outcome).toMatchObject({ status: 'rejected' });
    }
    expect(server.requests).toBe(2);
    expect(server.aborted).toBe(2);
  });

  it('leaves requests alone when no signal is given', async () => {
    const server = hangingFetch();
    const outcome = await settlesWithin(createChatModel({}, { fetch: server.fetch }).invoke('hi'), 50);
    expect(outcome).toEqual({ status: 'pending' });
    expect(server.aborted).toBe(0);
  });
});
