import path from "path"

export interface Config {
  /** Must be a tool-capable Ollama model (checked at startup). */
  model: string
  temperature: number
  ollamaBaseUrl: string
  /** Sandbox root: every tool path resolves inside it. */
  root: string
  maxModelCalls: number
  maxToolCalls: number
  /** DEBUG=true: print each model and tool step (StepTracer) and error stacks. */
  debug: boolean
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`)
  return value
}

function temperature(env: NodeJS.ProcessEnv): number {
  const raw = env.OLLAMA_TEMPERATURE
  if (raw === undefined || raw === "") return 0.2
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`OLLAMA_TEMPERATURE must be a number between 0 and 2, got "${raw}"`)
  }
  return value
}

/**
 * Read agent configuration from the environment. Pure, so it can be tested
 * without touching process.env. OLLAMA_MODEL is deliberately not read: it holds
 * gemma3 in older .env files, and gemma3 cannot call tools (ADR-002).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  return {
    model: env.AGENT_MODEL || "qwen2.5:7b-instruct",
    temperature: temperature(env),
    ollamaBaseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434",
    root: path.resolve(cwd, env.AGENT_ROOT || "."),
    maxModelCalls: positiveInt(env, "AGENT_MAX_MODEL_CALLS", 12),
    maxToolCalls: positiveInt(env, "AGENT_MAX_TOOL_CALLS", 20),
    debug: env.DEBUG === "true",
  }
}
