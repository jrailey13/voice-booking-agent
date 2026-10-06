import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';

/**
 * LangChain model factories for the local Ollama server. Every model call in
 * the API (replies, extraction, the booking agent, RAG) goes through these.
 * Construction does no I/O; the first request does.
 *
 * maxRetries is 0: LangChain otherwise retries up to 6 times with exponential
 * backoff, so an Ollama outage would hang an upload for minutes instead of
 * failing fast the way the hand-rolled client did.
 */
const NO_RETRIES = { maxRetries: 0 };
const baseUrl = (env: NodeJS.ProcessEnv) => env.OLLAMA_BASE_URL || 'http://localhost:11434';

export interface ChatModelOptions {
  /**
   * Cancels every request this model makes. Pass it here, not only as a call
   * option: ChatOllama checks a call's signal only between streamed chunks, so
   * a request still waiting for its first token (a slow prompt on CPU, or a
   * stuck server) would otherwise never be cancelled.
   */
  signal?: AbortSignal;
  /** The fetch to send requests with. Defaults to the global fetch, read when each request is made. */
  fetch?: typeof fetch;
}

/** A fetch whose requests are also aborted by `signal`. */
export function abortableFetch(signal: AbortSignal, base?: typeof fetch): typeof fetch {
  return (input, init) => {
    const signals = init?.signal ? [init.signal, signal] : [signal];
    return (base ?? globalThis.fetch)(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

function transport({ signal, fetch: base }: ChatModelOptions): { fetch?: typeof fetch } {
  if (signal) return { fetch: abortableFetch(signal, base) };
  return base ? { fetch: base } : {};
}

export function createChatModel(env: NodeJS.ProcessEnv = process.env, options: ChatModelOptions = {}): ChatOllama {
  return new ChatOllama({ model: env.LLM_MODEL || 'gemma3', baseUrl: baseUrl(env), ...NO_RETRIES, ...transport(options) });
}

export function createEmbeddings(env: NodeJS.ProcessEnv = process.env): OllamaEmbeddings {
  return new OllamaEmbeddings({ model: env.EMBEDDING_MODEL || 'nomic-embed-text', baseUrl: baseUrl(env), ...NO_RETRIES });
}

/**
 * The booking agent's model (BOOKING_AGENT=true). Separate from LLM_MODEL
 * because the agent needs tool calling, which gemma3 lacks (ADR-009). Low
 * temperature keeps tool arguments consistent.
 */
export function createBookingAgentModel(env: NodeJS.ProcessEnv = process.env, options: ChatModelOptions = {}): ChatOllama {
  return new ChatOllama({
    model: env.BOOKING_AGENT_MODEL || 'qwen2.5:7b-instruct',
    temperature: 0.2,
    baseUrl: baseUrl(env),
    ...NO_RETRIES,
    ...transport(options),
  });
}
