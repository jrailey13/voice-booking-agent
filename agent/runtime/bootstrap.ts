import { ChatOllama } from "@langchain/ollama"
import { MemorySaver } from "@langchain/langgraph"
import type { Config } from "../config"
import { buildAgent, type Agent } from "../executor/agent"
import { buildTools } from "../tools/agentTools"
import { assertNoRemoteTracing } from "./guards"
import { assertToolCapable } from "./capability"
import type { AgentIO } from "./io"

export interface StartOptions {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

/**
 * Run the startup checks, then wire the model, tools and checkpointer into an
 * agent. The tracing check runs first so nothing is contacted when it fails.
 */
export async function startAgent(config: Config, io: AgentIO, options: StartOptions = {}): Promise<Agent> {
  assertNoRemoteTracing(options.env ?? process.env)
  await assertToolCapable(config.model, config.ollamaBaseUrl, options.fetchImpl)

  return buildAgent({
    model: new ChatOllama({ model: config.model, temperature: config.temperature, baseUrl: config.ollamaBaseUrl }),
    tools: buildTools({ root: config.root, io }),
    checkpointer: new MemorySaver(),
    limits: { modelCalls: config.maxModelCalls, toolCalls: config.maxToolCalls },
  })
}
