import {
  createAgent,
  humanInTheLoopMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  type Decision,
  type HITLRequest,
  type Interrupt,
} from "langchain"
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { BaseMessage } from "@langchain/core/messages"
import type { Callbacks } from "@langchain/core/callbacks/manager"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { AgentIO } from "../runtime/io"

export const AGENT_SYSTEM_PROMPT = `You are a software engineering assistant working inside one project directory.
All file paths are relative to the project root. Use the tools to look at the code before answering; do not guess file contents.
Long files are returned in pages: if read_file says the output was truncated, read the next page before concluding something is absent.
Writing a file requires the user's approval; if they decline, accept it and continue without writing.
Answer concisely and say which files you looked at.`

export interface AgentDeps {
  model: BaseChatModel
  tools: StructuredToolInterface[]
  checkpointer: BaseCheckpointSaver
  limits: { modelCalls: number; toolCalls: number }
  systemPrompt?: string
}

/**
 * The LangChain v1 agent: a ReAct loop on LangGraph. The checkpointer keeps each
 * thread's conversation; the middleware bounds runaway loops and pauses for a
 * human before any write. See ADR-001 and ADR-003.
 */
export function buildAgent(deps: AgentDeps) {
  return createAgent({
    model: deps.model,
    tools: deps.tools,
    systemPrompt: deps.systemPrompt ?? AGENT_SYSTEM_PROMPT,
    middleware: [
      modelCallLimitMiddleware({ runLimit: deps.limits.modelCalls, exitBehavior: "end" }),
      toolCallLimitMiddleware({ runLimit: deps.limits.toolCalls, exitBehavior: "end" }),
      humanInTheLoopMiddleware({ interruptOn: { write_file: { allowedDecisions: ["approve", "reject"] } } }),
    ],
    checkpointer: deps.checkpointer,
  })
}

export type Agent = ReturnType<typeof buildAgent>

const PREVIEW_CHARS = 800

// LangGraph counts every node visit (model, tools, each middleware hook) against
// recursionLimit, which defaults to 25: fewer steps than our own call limits
// need, so runs would die with GraphRecursionError first. Keep it as a high
// backstop; the call-limit middleware is the real bound.
export const RECURSION_BACKSTOP = 500

function describeAction(action: HITLRequest["actionRequests"][number]): string {
  const { filePath, content } = action.args as { filePath?: string; content?: string }
  if (action.name === "write_file" && typeof content === "string") {
    const preview = content.length > PREVIEW_CHARS
      ? `${content.slice(0, PREVIEW_CHARS)}\n… (${content.length - PREVIEW_CHARS} more characters)`
      : content
    return `\n✏️  The agent wants to write ${filePath} (${content.length} characters):\n${"-".repeat(40)}\n${preview}\n${"-".repeat(40)}`
  }
  return `\n✏️  The agent wants to run ${action.name} ${JSON.stringify(action.args)}`
}

async function decide(action: HITLRequest["actionRequests"][number], io: AgentIO): Promise<Decision> {
  io.print(describeAction(action))
  const answer = (await io.prompt("Approve? [y/N] ")).trim().toLowerCase()
  if (answer === "y" || answer === "yes") return { type: "approve" }
  return { type: "reject", message: `The user declined the ${action.name} call. Do not retry it unless they ask.` }
}

function textOf(message: BaseMessage | undefined): string {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  return message.content
    .map((part) => (typeof part === "string" ? part : "text" in part ? String(part.text) : ""))
    .join("")
}

export interface ConverseOptions {
  /** LangChain callback handlers for the turn, e.g. a StepTracer when DEBUG=true. */
  callbacks?: Callbacks
}

/**
 * Run one user turn on a persistent thread. Whenever the agent pauses for
 * approval, ask the human through `io` and resume with their decisions.
 * Returns the agent's final text for the turn.
 */
export async function converse(
  agent: Agent,
  threadId: string,
  userText: string,
  io: AgentIO,
  options: ConverseOptions = {}
): Promise<string> {
  // Callbacks passed at invoke time reach every nested run: model calls, tools, middleware.
  const config = { configurable: { thread_id: threadId }, recursionLimit: RECURSION_BACKSTOP, callbacks: options.callbacks }
  let result = await agent.invoke({ messages: [{ role: "user", content: userText }] }, config)

  for (;;) {
    const pending = (result as { __interrupt__?: Interrupt<HITLRequest>[] }).__interrupt__
    if (!pending?.length) break
    const decisions: Decision[] = []
    for (const action of pending[0].value.actionRequests) decisions.push(await decide(action, io))
    result = await agent.invoke(new Command({ resume: { decisions } }), config)
  }

  return textOf(result.messages[result.messages.length - 1])
}
