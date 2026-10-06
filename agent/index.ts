import dotenv from "dotenv"
import { randomUUID } from "crypto"
import { loadConfig, type Config } from "./config"
import { startAgent } from "./runtime/bootstrap"
import { createConsoleIO, type ConsoleIO } from "./runtime/io"
import { converse, type Agent, type ConverseOptions } from "./executor/agent"
import { StepTracer } from "./runtime/stepTracer"

dotenv.config({ quiet: true })

/**
 * Main entry point for the AI agent CLI.
 */
async function run(): Promise<void> {
  const mode = process.argv[2]
  const argument = process.argv[3]

  if (mode === "--help" || mode === "-h") {
    printUsage()
    return
  }
  if (mode && !["--agent", "-a", "--ask"].includes(mode)) {
    console.error(`\n❌ Unknown mode: ${mode}\n`)
    printUsage()
    process.exitCode = 1
    return
  }

  const io = createConsoleIO()
  try {
    const config = loadConfig()
    printBanner(config)
    const agent = await startAgent(config, io)
    // DEBUG=true prints every model and tool step as it happens.
    const options: ConverseOptions = config.debug ? { callbacks: [new StepTracer((line) => io.print(line))] } : {}

    if (mode === "--ask") {
      const question = argument || "Analyze this codebase and suggest improvements"
      const answer = await converse(agent, randomUUID(), question, io, options)
      io.print(`\n🤖 ${answer}\n`)
    } else {
      await interactive(agent, io, options)
    }
  } catch (error) {
    reportError(error)
    process.exitCode = 1
  } finally {
    io.close()
  }
}

/** One thread for the whole session, so the agent remembers earlier turns. */
async function interactive(agent: Agent, io: ConsoleIO, options: ConverseOptions): Promise<void> {
  const threadId = randomUUID()
  io.print("🤖 Agent ready. Type your request, or 'quit' to exit.\n")
  for (;;) {
    const input = (await io.prompt("You: ")).trim()
    if (input.toLowerCase() === "quit") break
    if (!input) continue
    try {
      io.print(`\n🤖 ${await converse(agent, threadId, input, io, options)}\n`)
    } catch (error) {
      // A failed turn (e.g. Ollama went away) shouldn't end the session.
      reportError(error)
    }
  }
  io.print("Goodbye!")
}

function printBanner(config: Config): void {
  console.log(`\n${"=".repeat(60)}\n🤖 Agentic AI Assistant\n${"=".repeat(60)}`)
  console.log(`   Model:  ${config.model} (temperature ${config.temperature})`)
  console.log(`   Engine: ${config.engine === "graph" ? "hand-built LangGraph StateGraph" : "createAgent"}`)
  console.log(`   Ollama: ${config.ollamaBaseUrl}`)
  console.log(`   Root:   ${config.root}  (tools cannot read or write outside it)`)
  console.log(`   Limits: ${config.maxModelCalls} model calls, ${config.maxToolCalls} tool calls per request`)
  if (config.debug) console.log("   Debug:  printing each model and tool step")
  console.log("")
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n❌ ${message}`)
  if (process.env.DEBUG === "true" && error instanceof Error) console.error(error.stack)
}

function printUsage(): void {
  console.log(`
Usage: npm run dev -- [MODE] [ARGUMENT]

Modes:
  --agent, -a          Interactive session (default). The agent remembers the conversation.
  --ask "QUESTION"     Answer a single question and exit.
  --help, -h           Show this help.

Environment variables:
  AGENT_MODEL            Tool-capable Ollama model (default: qwen2.5:7b-instruct)
  OLLAMA_TEMPERATURE     0-2 (default: 0.2)
  OLLAMA_BASE_URL        Ollama server (default: http://localhost:11434)
  AGENT_ROOT             Directory the tools are confined to (default: current directory)
  AGENT_MAX_MODEL_CALLS  Model calls allowed per request (default: 12)
  AGENT_MAX_TOOL_CALLS   Tool calls allowed per request (default: 20)
  AGENT_ENGINE           "create-agent" (default) or "graph": the same agent hand-built on a StateGraph
  DEBUG                  "true" prints each model and tool step, and stack traces

Writing a file always asks for your approval first.
`)
}

run()
