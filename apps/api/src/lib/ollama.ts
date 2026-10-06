import { Ollama } from 'ollama';

/**
 * Ollama client for the voice/booking path. The RAG service uses LangChain's
 * @langchain/ollama instead (lib/ai/models.ts).
 * Ensure Ollama is running: ollama serve
 */
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const LLM_MODEL = process.env.LLM_MODEL || 'gemma3';

export const ollama = new Ollama({
  host: OLLAMA_BASE_URL,
});

/**
 * Check if Ollama is running and models are available
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await ollama.list();
    const hasEmbedding = response.models.some((m) => m.name.includes(EMBEDDING_MODEL));
    const hasLLM = response.models.some((m) => m.name.includes(LLM_MODEL));

    if (!hasEmbedding) {
      console.warn(`Warning: ${EMBEDDING_MODEL} not found. Pull with: ollama pull ${EMBEDDING_MODEL}`);
    }
    if (!hasLLM) {
      console.warn(`Warning: ${LLM_MODEL} not found. Pull with: ollama pull ${LLM_MODEL}`);
    }

    return hasEmbedding && hasLLM;
  } catch (error) {
    console.error('Ollama health check failed:', error);
    return false;
  }
}
