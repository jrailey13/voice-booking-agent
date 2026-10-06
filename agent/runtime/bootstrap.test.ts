import { describe, it, expect, vi } from "vitest"
import { startAgent } from "./bootstrap"
import { RemoteTracingError } from "./guards"
import { ModelCapabilityError } from "./capability"
import { loadConfig } from "../config"
import type { AgentIO } from "./io"

const io: AgentIO = { prompt: vi.fn(), print: vi.fn() }
const config = loadConfig({}, process.cwd())
const showResponds = (capabilities: string[]) =>
  vi.fn(async () => new Response(JSON.stringify({ capabilities }), { status: 200 })) as unknown as typeof fetch

describe("startAgent", () => {
  it("refuses to start with tracing enabled, before contacting Ollama", async () => {
    const f = showResponds(["tools"])
    await expect(startAgent(config, io, { env: { LANGSMITH_TRACING: "true" }, fetchImpl: f }))
      .rejects.toBeInstanceOf(RemoteTracingError)
    expect(f).not.toHaveBeenCalled()
  })

  it("refuses a model without tool support", async () => {
    await expect(startAgent(config, io, { env: {}, fetchImpl: showResponds(["completion"]) }))
      .rejects.toBeInstanceOf(ModelCapabilityError)
  })

  it("returns a ready agent when checks pass", async () => {
    const agent = await startAgent(config, io, { env: {}, fetchImpl: showResponds(["completion", "tools"]) })
    expect(typeof agent.invoke).toBe("function")
  })
})
