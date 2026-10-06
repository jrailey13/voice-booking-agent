import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';

/**
 * LangChain model factories for the local Ollama server. Same env vars and
 * defaults as lib/ollama.ts, which the voice/booking path still uses directly.
 * Construction does no I/O; the first request does.
 *
 * maxRetries is 0: LangChain otherwise retries up to 6 times with exponential
 * backoff, so an Ollama outage would hang an upload for minutes instead of
 * failing fast the way the hand-rolled client did.
 */
const NO_RETRIES = { maxRetries: 0 };
const baseUrl = (env: NodeJS.ProcessEnv) => env.OLLAMA_BASE_URL || 'http://localhost:11434';

export function createChatModel(env: NodeJS.ProcessEnv = process.env): ChatOllama {
  return new ChatOllama({ model: env.LLM_MODEL || 'gemma3', baseUrl: baseUrl(env), ...NO_RETRIES });
}

export function createEmbeddings(env: NodeJS.ProcessEnv = process.env): OllamaEmbeddings {
  return new OllamaEmbeddings({ model: env.EMBEDDING_MODEL || 'nomic-embed-text', baseUrl: baseUrl(env), ...NO_RETRIES });
}

/**
 * The booking agent's model (BOOKING_AGENT=true). Separate from LLM_MODEL
 * because the agent needs tool calling, which gemma3 lacks (ADR-009). Low
 * temperature keeps tool arguments consistent.
 */
export function createBookingAgentModel(env: NodeJS.ProcessEnv = process.env): ChatOllama {
  return new ChatOllama({
    model: env.BOOKING_AGENT_MODEL || 'qwen2.5:7b-instruct',
    temperature: 0.2,
    baseUrl: baseUrl(env),
    ...NO_RETRIES,
  });
}
