/**
 * Shared fakes for RAG service tests. Importing this module stubs global fetch
 * with the fake Ollama server, so import it before anything that constructs an
 * Ollama client.
 */
import { createFakeOllama, FakeRagDb } from './fakes';

export const ollama = createFakeOllama();
export const db = new FakeRagDb();

globalThis.fetch = ollama.fetch;
