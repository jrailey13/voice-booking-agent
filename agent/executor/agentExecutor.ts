import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage
} from "@langchain/core/messages"
import { llm } from "../config"
import { agentTools, processToolCall } from "../tools/agentTools"

/**
 * System prompt for the agentic assistant
 */
const AGENT_SYSTEM_PROMPT = `You are an autonomous software engineering assistant with access to tools for analyzing code, reading files, and making decisions about project work.

Your capabilities:
- Analyze codebases to understand project structure and architecture
- Read and examine specific files
- Search for files matching patterns
- Write files to the filesystem
- Ask clarification questions when needed

You operate in a think-act-observe loop:
1. THINK: Analyze the current situation and what you need to accomplish
2. ACT: Use tools to gather information or take action
3. OBSERVE: Examine the results and decide next steps

Always:
- Explain your reasoning before taking action
- Use tools systematically to accomplish goals
- Provide clear summaries of what you've learned and done
- Ask for clarification if needed
- Be thorough but efficient`

/**
 * State for tracking agent execution
 */
interface AgentState {
  messages: BaseMessage[]
  toolCalls: Array<{ tool: string; input: Record<string, unknown> }>
}

/**
 * Run the agent in a loop until it decides to stop
 */
export async function runAgent(userMessage: string, maxIterations = 10): Promise<string> {
  console.log("\n🤖 Agent starting...\n")

  const state: AgentState = {
    messages: [
      new SystemMessage(AGENT_SYSTEM_PROMPT),
      new HumanMessage(userMessage)
    ],
    toolCalls: []
  }

  let iteration = 0
  let finalResponse = ""

  while (iteration < maxIterations) {
    iteration++
    console.log(`\n📍 Iteration ${iteration}/${maxIterations}`)

    // Get LLM response
    console.log("🧠 Thinking...")
    let response

    try {
      response = await llm.invoke(state.messages)
    } catch (error) {
      console.error("❌ LLM error:", error)
      return `Agent error: ${error instanceof Error ? error.message : String(error)}`
    }

    console.log("💬 LLM response:", String(response.content).substring(0, 200))

    // Add response to messages
    state.messages.push(new AIMessage(response.content))

    // Check if response includes tool use
    // LangChain's invoke may include tool information in the response content or via structured output
    const responseText = String(response.content)
    const hasToolUse =
      responseText.includes("[Tool:") ||
      responseText.includes("{\"tool") ||
      responseText.includes("```json")

    if (!hasToolUse) {
      // No tool use - this is the final response
      console.log("✅ Agent completed")
      finalResponse = responseText
      break
    }

    // Extract tool calls from response
    const toolCalls = extractToolCalls(responseText)

    if (toolCalls.length === 0) {
      // No valid tool calls found despite thinking there might be
      console.log("✅ Agent completed")
      finalResponse = responseText
      break
    }

    // Execute tools
    for (const toolCall of toolCalls) {
      console.log(`🔧 Executing tool: ${toolCall.tool}`)
      const toolResult = await processToolCall(toolCall.tool, toolCall.input)
      console.log(`📤 Tool result: ${toolResult.substring(0, 150)}...`)

      // Add tool result to messages
      state.messages.push(
        new ToolMessage({
          tool_call_id: toolCall.tool,
          content: toolResult
        })
      )

      state.toolCalls.push(toolCall)
    }
  }

  if (iteration >= maxIterations) {
    console.log(`\n⚠️  Agent reached max iterations (${maxIterations})`)
  }

  return finalResponse
}

/**
 * Extract tool calls from LLM response
 * Looks for patterns like [Tool: tool_name] or JSON tool definitions
 */
function extractToolCalls(
  response: string
): Array<{ tool: string; input: Record<string, unknown> }> {
  const toolCalls: Array<{ tool: string; input: Record<string, unknown> }> = []

  // Pattern 1: [Tool: tool_name] with parameters
  const toolPattern = /\[Tool:\s*(\w+)\][\s\S]*?\{([\s\S]*?)\}/g
  let match

  while ((match = toolPattern.exec(response)) !== null) {
    try {
      const toolName = match[1]
      const jsonStr = "{" + match[2]
      const input = JSON.parse(jsonStr)
      toolCalls.push({ tool: toolName, input })
    } catch (e) {
      // Skip invalid JSON
    }
  }

  // Pattern 2: Explicit tool name followed by JSON
  const explicitPattern = /(?:use|call|invoke|execute)\s+(?:the\s+)?(\w+)\s+tool[\s\S]*?\{([\s\S]*?)\}/gi
  while ((match = explicitPattern.exec(response)) !== null) {
    try {
      const toolName = match[1]
      const jsonStr = "{" + match[2]
      const input = JSON.parse(jsonStr)
      toolCalls.push({ tool: toolName, input })
    } catch (e) {
      // Skip invalid JSON
    }
  }

  return toolCalls
}

/**
 * Interactive agent conversation loop for CLI
 */
export async function startAgentConversation(): Promise<void> {
  const readline = await import("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const prompt = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, resolve)
    })
  }

  console.log("🤖 Agent Ready! Type your request or 'quit' to exit.\n")

  while (true) {
    const userInput = await prompt("You: ")

    if (userInput.toLowerCase() === "quit") {
      console.log("Goodbye!")
      rl.close()
      break
    }

    if (!userInput.trim()) {
      continue
    }

    const response = await runAgent(userInput)
    console.log(`\n🤖 Agent: ${response}\n`)
  }
}
