import { Annotation, END, MessagesAnnotation, START, StateGraph, interrupt } from "@langchain/langgraph"
import type { RunnableConfig } from "@langchain/core/runnables"
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"
import type { ToolCall } from "@langchain/core/messages/tool"
import type { Decision, HITLRequest } from "langchain"
import { AGENT_SYSTEM_PROMPT, type Agent, type AgentDeps } from "./agent"

/**
 * The same agent as buildAgent, built by hand on a LangGraph StateGraph instead
 * of createAgent. It exists to show what createAgent does underneath (ADR-010):
 *
 *   START → begin → model ─(tool calls?)─ yes → tools → model …
 *                         └─ no ────────────────────────────→ END
 *
 * - `messages` is the conversation; the checkpointer stores it per thread.
 * - `modelCalls` / `toolCalls` count this request's calls. `begin` resets them,
 *   which is what the middleware's runLimit means.
 * - Writes pause the graph with `interrupt()`, using the same payload as
 *   humanInTheLoopMiddleware, so `converse` drives both engines unchanged.
 */

/** Tools that need the human's approval before they run. */
const NEEDS_APPROVAL = new Set(["write_file"])

const State = Annotation.Root({
  ...MessagesAnnotation.spec,
  modelCalls: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  toolCalls: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
})

type AgentState = typeof State.State

function lastMessage(state: AgentState): BaseMessage | undefined {
  return state.messages[state.messages.length - 1]
}

function pendingToolCalls(state: AgentState): ToolCall[] {
  const last = lastMessage(state)
  return last && AIMessage.isInstance(last) ? last.tool_calls ?? [] : []
}

const limitReached = (kind: string, limit: number) =>
  new AIMessage(`Stopped: this request reached the ${kind} limit (${limit}). Ask again to continue.`)

export function buildGraphAgent(deps: AgentDeps): Agent {
  const { modelCalls: maxModelCalls, toolCalls: maxToolCalls } = deps.limits
  const systemPrompt = new SystemMessage(deps.systemPrompt ?? AGENT_SYSTEM_PROMPT)
  const model = deps.model.bindTools!(deps.tools)
  const toolsByName = new Map(deps.tools.map((tool) => [tool.name, tool]))

  /** A new user turn: reset the per-request counters. */
  const begin = () => ({ modelCalls: 0, toolCalls: 0 })

  /** One model call. The system prompt is added here, so it is never stored. */
  async function callModel(state: AgentState, config: RunnableConfig) {
    if (state.modelCalls >= maxModelCalls) return { messages: [limitReached("model call", maxModelCalls)] }
    const reply = await model.invoke([systemPrompt, ...state.messages], config)
    return { messages: [reply], modelCalls: state.modelCalls + 1 }
  }

  /**
   * Run the tool calls from the last model reply. LangGraph re-runs a node from
   * the top when it resumes after interrupt(), so nothing may happen before the
   * approval that would be wrong to do twice.
   */
  async function runTools(state: AgentState, config: RunnableConfig) {
    const calls = pendingToolCalls(state)

    if (state.toolCalls + calls.length > maxToolCalls) {
      // Every tool call needs an answer, or the model sees a broken history next turn.
      const skipped = calls.map((call) => toolResult(call, "Not run: the tool call limit was reached.", "error"))
      return { messages: [...skipped, limitReached("tool call", maxToolCalls)] }
    }

    const decisions = await approvals(calls)
    const results: ToolMessage[] = []
    for (const call of calls) {
      const decision = decisions.get(call.id)
      if (decision?.type === "reject") {
        results.push(toolResult(call, decision.message ?? `The user declined the ${call.name} call.`, "error"))
      } else {
        results.push(await execute(call, config))
      }
    }
    return { messages: results, toolCalls: state.toolCalls + calls.length }
  }

  /** Pause once for every call that needs approval; the human answers them in order. */
  async function approvals(calls: ToolCall[]): Promise<Map<string | undefined, Decision>> {
    const gated = calls.filter((call) => NEEDS_APPROVAL.has(call.name))
    if (!gated.length) return new Map()
    const request: HITLRequest = {
      actionRequests: gated.map((call) => ({ name: call.name, args: call.args })),
      reviewConfigs: gated.map((call) => ({ actionName: call.name, allowedDecisions: ["approve", "reject"] })),
    }
    const { decisions } = interrupt<HITLRequest, { decisions: Decision[] }>(request)
    return new Map(gated.map((call, i) => [call.id, decisions[i] ?? { type: "reject" }]))
  }

  async function execute(call: ToolCall, config: RunnableConfig): Promise<ToolMessage> {
    const tool = toolsByName.get(call.name)
    if (!tool) return toolResult(call, `Error: there is no tool named ${call.name}.`, "error")
    try {
      // Invoked with the whole ToolCall, a tool returns a ToolMessage carrying the call's id.
      return await tool.invoke({ ...call, type: "tool_call" }, config)
    } catch (error) {
      // Tell the model what went wrong instead of ending the turn.
      return toolResult(call, `Error: ${error instanceof Error ? error.message : String(error)}`, "error")
    }
  }

  /** After the model: run tools if it asked for any, otherwise the turn is over. */
  const afterModel = (state: AgentState) => (pendingToolCalls(state).length ? "tools" : END)
  /** After tools: back to the model, unless the tools node ended the turn on a limit. */
  const afterTools = (state: AgentState) => (AIMessage.isInstance(lastMessage(state)) ? END : "model")

  return new StateGraph(State)
    .addNode("begin", begin)
    .addNode("model", callModel)
    .addNode("tools", runTools)
    .addEdge(START, "begin")
    .addEdge("begin", "model")
    .addConditionalEdges("model", afterModel, ["tools", END])
    .addConditionalEdges("tools", afterTools, ["model", END])
    .compile({ checkpointer: deps.checkpointer })
}

function toolResult(call: ToolCall, content: string, status: "success" | "error"): ToolMessage {
  return new ToolMessage({ content, tool_call_id: call.id ?? "", name: call.name, status })
}
