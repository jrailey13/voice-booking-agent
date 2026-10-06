import { describe, it, expect, vi } from "vitest"
import { FakeToolCallingModel } from "langchain"
import { MemorySaver } from "@langchain/langgraph"
import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { converse } from "./agent"
import { buildGraphAgent } from "./graphAgent"

// Behaviour shared with createAgent is tested in agent.test.ts, against both
// engines. These cover what only the hand-built graph does.

const io = { prompt: vi.fn(async () => "y"), print: vi.fn() }
const failing = tool(async () => { throw new Error("disk on fire") }, {
  name: "explode",
  description: "Always fails.",
  schema: z.object({}),
})

function graphWith(script: Array<Array<{ name: string; args: Record<string, unknown>; id: string }>>) {
  const checkpointer = new MemorySaver()
  const agent = buildGraphAgent({
    model: new FakeToolCallingModel({ toolCalls: script }),
    tools: [failing],
    checkpointer,
    limits: { modelCalls: 12, toolCalls: 20 },
    systemPrompt: "You are Zebra.",
  })
  return agent as typeof agent & { getState(c: object): Promise<{ values: { messages: { content: unknown; getType(): string }[] } }> }
}

describe("buildGraphAgent", () => {
  it("keeps the system prompt out of the stored thread, so it is not repeated each turn", async () => {
    const agent = graphWith([[], []])
    await converse(agent, "t1", "one", io)
    await converse(agent, "t1", "two", io)
    const { values } = await agent.getState({ configurable: { thread_id: "t1" } })
    expect(values.messages.map((m) => m.getType())).toEqual(["human", "ai", "human", "ai"])
  })

  it("reports a failing tool to the model as an error instead of ending the turn", async () => {
    const answer = await converse(graphWith([[{ name: "explode", args: {}, id: "e1" }], []]), "t1", "go", io)
    expect(answer).toContain("Error: disk on fire")
  })

  it("reports a call to a tool that does not exist", async () => {
    const answer = await converse(graphWith([[{ name: "rm_rf", args: {}, id: "x1" }], []]), "t1", "go", io)
    expect(answer).toContain("there is no tool named rm_rf")
  })
})
