import { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { Serialized } from "@langchain/core/load/serializable"
import type { BaseMessage } from "@langchain/core/messages"
import type { LLMResult } from "@langchain/core/outputs"

const MAX_INPUT_CHARS = 100

type Started = { name: string; at: number }

/**
 * A LangChain callback handler that prints one line per step: each model call
 * (what it decided) and each tool call (its input and how much it returned).
 *
 * Local observability for DEBUG=true. Nothing leaves the machine, unlike
 * LangSmith tracing (ADR-005). LangChain's built-in ConsoleCallbackHandler
 * dumps every run as JSON, which is too much to read while learning.
 */
export class StepTracer extends BaseCallbackHandler {
  name = "step_tracer"
  private readonly started = new Map<string, Started>()

  constructor(
    private readonly print: (line: string) => void,
    private readonly now: () => number = Date.now
  ) {
    super()
  }

  private line(kind: string, text: string): void {
    this.print(`· ${kind.padEnd(9)} ${text}`)
  }

  private start(runId: string, name: string): void {
    this.started.set(runId, { name, at: this.now() })
  }

  /** Name and elapsed time of a run, forgetting it. */
  private finish(runId: string): { name: string; elapsed: string } | undefined {
    const run = this.started.get(runId)
    if (!run) return undefined
    this.started.delete(runId)
    return { name: run.name, elapsed: `${((this.now() - run.at) / 1000).toFixed(1)}s` }
  }

  async handleChatModelStart(_llm: Serialized, messages: BaseMessage[][], runId: string): Promise<void> {
    this.start(runId, "model")
    this.line("model", `started (${messages[0]?.length ?? 0} messages)`)
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const run = this.finish(runId)
    const generation = output.generations[0]?.[0] as { text?: string; message?: { tool_calls?: { name: string }[] } } | undefined
    const toolCalls = generation?.message?.tool_calls ?? []
    const outcome = toolCalls.length
      ? `tool calls: ${toolCalls.map((c) => c.name).join(", ")}`
      : `answer (${generation?.text?.length ?? 0} chars)`
    this.line("model", `${run?.elapsed ?? "?"} → ${outcome}`)
  }

  async handleLLMError(error: Error, runId: string): Promise<void> {
    const run = this.finish(runId)
    this.line("model", `failed${run ? ` after ${run.elapsed}` : ""}: ${error.message}`)
  }

  async handleToolStart(
    _tool: Serialized,
    input: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string
  ): Promise<void> {
    const name = runName ?? "tool"
    this.start(runId, name)
    this.line("tool", `${name} ${oneLine(input)}`)
  }

  async handleToolEnd(output: unknown, runId: string): Promise<void> {
    const run = this.finish(runId)
    this.line("tool", `${run?.name ?? "tool"} ${run?.elapsed ?? "?"} → ${contentLength(output)} chars`)
  }

  async handleToolError(error: Error, runId: string): Promise<void> {
    const run = this.finish(runId)
    this.line("tool", `${run?.name ?? "tool"} failed${run ? ` after ${run.elapsed}` : ""}: ${error.message}`)
  }
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ")
  return flat.length > MAX_INPUT_CHARS ? `${flat.slice(0, MAX_INPUT_CHARS)}…` : flat
}

/** Tools return a ToolMessage when called from the agent, or a plain string. */
function contentLength(output: unknown): number {
  const content = typeof output === "object" && output !== null && "content" in output ? output.content : output
  return typeof content === "string" ? content.length : JSON.stringify(content ?? "").length
}
