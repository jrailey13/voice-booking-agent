import { describe, it, expect, vi } from 'vitest';
import { assertToolCapable, ModelCapabilityError } from './capability';

const BASE = 'http://localhost:11434';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('assertToolCapable', () => {
  it('passes when Ollama reports the tools capability', async () => {
    const f = fakeFetch(200, { capabilities: ['completion', 'tools'] });
    await expect(assertToolCapable('qwen2.5:7b-instruct', BASE, f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith(`${BASE}/api/show`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'qwen2.5:7b-instruct' }),
    }));
  });

  it('rejects a model without tool support and names the setting to change', async () => {
    const err = await assertToolCapable('gemma3', BASE, fakeFetch(200, { capabilities: ['completion', 'vision'] })).catch((e) => e);
    expect(err).toBeInstanceOf(ModelCapabilityError);
    expect(err.message).toContain('gemma3 does not support tool calling');
    expect(err.message).toContain('BOOKING_AGENT_MODEL');
  });

  it('rejects a model Ollama does not have', async () => {
    const err = await assertToolCapable('nope', BASE, fakeFetch(404, { error: 'not found' })).catch((e) => e);
    expect(err).toBeInstanceOf(ModelCapabilityError);
    expect(err.message).toContain('ollama pull nope');
  });

  it('reports an unreachable Ollama clearly', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const err = await assertToolCapable('qwen2.5:7b-instruct', BASE, f).catch((e) => e);
    expect(err).toBeInstanceOf(ModelCapabilityError);
    expect(err.message).toContain('ollama serve');
  });
});
