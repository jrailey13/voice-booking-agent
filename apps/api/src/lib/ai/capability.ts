export class ModelCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

/**
 * Fail fast at startup if the booking agent's model cannot do structured tool
 * calling (FR4, ADR-009). Ollama would otherwise reject it on the first call,
 * mid-conversation. Mirrors agent/runtime/capability.ts.
 */
export async function assertToolCapable(
  model: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch (error) {
    throw new ModelCapabilityError(
      `Cannot reach Ollama at ${baseUrl} (${error instanceof Error ? error.message : String(error)}). ` +
        'Ensure it is running: ollama serve'
    );
  }

  if (!response.ok) {
    throw new ModelCapabilityError(
      `Ollama does not have model ${model} (HTTP ${response.status}). Pull it with: ollama pull ${model}`
    );
  }

  const info = (await response.json()) as { capabilities?: string[] };
  if (!info.capabilities?.includes('tools')) {
    throw new ModelCapabilityError(
      `Model ${model} does not support tool calling; set BOOKING_AGENT_MODEL (e.g. qwen2.5:7b-instruct)`
    );
  }
}
