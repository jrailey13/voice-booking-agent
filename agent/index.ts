import { runAgent, startAgentConversation } from "./executor/agentExecutor"
import { config } from "./config"

/**
 * Main entry point for the AI agent
 * The agent operates in agentic mode with autonomous tool use and decision-making
 */
async function run(): Promise<void> {
  try {
    // Determine mode from command line arguments
    const mode = process.argv[2]
    const argument = process.argv[3]

    console.log("\n" + "=".repeat(60))
    console.log("🤖 Agentic AI Assistant")
    console.log("=".repeat(60) + "\n")

    console.log("📋 Configuration:")
    console.log(`   - Ollama Model: ${config.ollamaModel}`)
    console.log(`   - Temperature: ${config.ollamaTemperature}`)
    console.log(`   - Base URL: ${config.ollamaBaseUrl}\n`)

    // Interactive agentic mode
    if (mode === "--agent" || mode === "-a" || !mode) {
      console.log("🤖 Interactive Agent Mode")
      console.log(`   - Multi-turn conversation with autonomous tool use`)
      console.log(`   - Type 'quit' to exit\n`)
      await startAgentConversation()
      return
    }

    // Single-turn agent request
    if (mode === "--ask") {
      const question = argument || "Analyze this codebase and suggest improvements"
      console.log("💭 Single Question Mode")
      console.log(`   Question: "${question}"\n`)
      const response = await runAgent(question)
      console.log("\n" + "=".repeat(60))
      console.log("Response:")
      console.log("=".repeat(60))
      console.log(response)
      console.log("=".repeat(60) + "\n")
      return
    }

    // Unknown mode
    console.error(`\n❌ Unknown mode: ${mode}\n`)
    printUsage()
    process.exit(1)
  } catch (error) {
    console.error("\n" + "=".repeat(60))
    console.error("❌ Error occurred during execution")
    console.error("=".repeat(60))

    if (error instanceof Error) {
      console.error(`\nError: ${error.message}`)

      // Print stack trace in verbose mode
      if (process.env.DEBUG === "true") {
        console.error("\nStack trace:")
        console.error(error.stack)
      }
    } else {
      console.error(`\nUnexpected error: ${String(error)}`)
    }

    console.error("\n💡 Tips:")
    console.error("   - Ensure Ollama is running: ollama serve")
    console.error("   - Check model exists: ollama pull llama3.1")
    console.error("   - Check .env file configuration")
    console.error("   - Run with DEBUG=true for full stack trace")
    console.error("   - Run with --help to see usage\n")

    process.exit(1)
  }
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Usage: npm run dev [MODE] [ARGUMENT]

Modes (optional - interactive mode is default):
  --agent, -a              Interactive agentic mode (default)
                           Multi-turn conversation with tool use
                           Example: npm run dev --agent

  --ask [QUESTION]         Single question to the agent
                           Example: npm run dev --ask "What's the architecture?"

  --help, -h               Show this help message

Examples:
  npm run dev                                     # Default interactive mode
  npm run dev --agent                             # Explicit interactive mode
  npm run dev --ask "Analyze this codebase"       # Single question
  DEBUG=true npm run dev:debug --agent            # Verbose output

Environment Variables:
  OLLAMA_MODEL             Model to use (default: gemma3)
  OLLAMA_TEMPERATURE       Temperature 0-1 (default: 0.2)
  OLLAMA_BASE_URL          Ollama server URL (default: http://localhost:11434)
  DEBUG                    Set to "true" for detailed output

Features:
  ✨ Autonomous tool use     - Agent decides which tools to use
  🧠 Multi-turn conversations - Remember context between messages
  📁 File operations         - Read, write, search files
  🔍 Code analysis          - Analyze project structure
  💡 Intelligent reasoning   - Think-act-observe loop
`)
}

// Show help if requested
if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  printUsage()
  process.exit(0)
}

// Run the agent
run()