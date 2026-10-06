import { describe, it, expect } from 'vitest';
import { createChatModel, createEmbeddings } from './models';

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
  });

  it('reads LLM_MODEL, EMBEDDING_MODEL and OLLAMA_BASE_URL', () => {
    const env = { LLM_MODEL: 'llama3.1', EMBEDDING_MODEL: 'mxbai-embed-large', OLLAMA_BASE_URL: 'http://gpu:11434' };
    expect(createChatModel(env)).toMatchObject({ model: 'llama3.1', baseUrl: 'http://gpu:11434' });
    expect(createEmbeddings(env)).toMatchObject({ model: 'mxbai-embed-large', baseUrl: 'http://gpu:11434' });
  });
});
