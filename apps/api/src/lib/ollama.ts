import { Ollama } from 'ollama';

/**
 * Ollama client configuration
 * Ensure Ollama is running: ollama serve
 */
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const LLM_MODEL = process.env.LLM_MODEL || 'gemma3';

export const ollama = new Ollama({
  host: OLLAMA_BASE_URL,
});

/**
 * Generate embeddings for text using Ollama
 * @param text - Text to embed
 * @returns Vector embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.embeddings[0];
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Generate answer using Ollama LLM with context
 * @param prompt - Question or prompt
 * @param context - Context from relevant documents
 * @returns Generated answer
 */
export async function generateAnswer(prompt: string, context: string): Promise<string> {
  try {
    const systemPrompt = `You are a helpful assistant that answers questions based on provided documents. 
Always use only the information provided in the context to answer questions. 
If the answer is not in the context, say "I don't have enough information to answer this question."`;

    const fullPrompt = `Context:
${context}

Question: ${prompt}

Answer:`;

    const response = await ollama.generate({
      model: LLM_MODEL,
      prompt: fullPrompt,
      system: systemPrompt,
      stream: false,
    });

    return response.response.trim();
  } catch (error) {
    console.error('Error generating answer:', error);
    throw new Error('Failed to generate answer');
  }
}

/**
 * Calculate cosine similarity between two vectors
 * Used for finding relevant documents
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score (0-1)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

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
