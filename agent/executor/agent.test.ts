import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest"
import fs from "fs-extra"
import os from "os"
import path from "path"
import { FakeToolCallingModel } from "langchain"
import { MemorySaver } from "@langchain/langgraph"
import { buildAgent, converse, type Agent, type AgentDeps } from "./agent"
import { buildGraphAgent } from "./graphAgent"
import { buildTools } from "../tools/agentTools"
import type { AgentIO } from "../runtime/io"

type ToolCall = { name: string; args: Record<string, unknown>; id: string }

let root: string
let io: { prompt: Mock<AgentIO["prompt"]>; print: Mock<AgentIO["print"]> }

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-")))
  await fs.outputFile(path.join(root, "README.md"), "The secret word is pineapple.")
  io = { prompt: vi.fn<AgentIO["prompt"]>(async () => "y"), print: vi.fn<AgentIO["print"]>() }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.remove(root)
})

// Both engines must behave the same: createAgent, and the StateGraph built by hand.
// They differ in one place: when the user declines one of several writes from a
// single model reply, createAgent's middleware cancels the approved ones too and
// returns to the model; the graph runs the approved ones (ADR-010).
describe.each([
  ["createAgent", buildAgent, { declineCancelsBatch: true }],
  ["hand-built StateGraph", buildGraphAgent, { declineCancelsBatch: false }],
] as const)("converse (%s)", (_engine, build: (deps: AgentDeps) => Agent, { declineCancelsBatch }) => {
  /** An agent whose model emits the given tool calls, one batch per model call. */
  function agentWith(script: ToolCall[][], limits = { modelCalls: 12, toolCalls: 20 }, systemPrompt?: string) {
    return build({
      model: new FakeToolCallingModel({ toolCalls: script }),
      tools: buildTools({ root, io }),
      checkpointer: new MemorySaver(),
      limits,
      systemPrompt,
    })
  }

  describe("turns", () => {
    it("dispatches structured tool calls and returns the final answer", async () => {
      const agent = agentWith([[{ name: "read_file", args: { filePath: "README.md" }, id: "c1" }], []])
      const answer = await converse(agent, "t1", "what is the secret word?", io)
      // The fake model echoes what it saw, so the tool output must have reached it.
      expect(answer).toContain("pineapple")
    })

    it("remembers earlier turns on the same thread", async () => {
      const agent = agentWith([[], []])
      await converse(agent, "t1", "my name is Ada", io)
      expect(await converse(agent, "t1", "what is my name?", io)).toContain("my name is Ada")
    })

    it("gives the model the system prompt", async () => {
      const answer = await converse(agentWith([[]], undefined, "You are Zebra."), "t1", "hi", io)
      expect(answer).toContain("You are Zebra.")
    })

    it("keeps threads isolated", async () => {
      const agent = agentWith([[], []])
      await converse(agent, "t1", "my name is Ada", io)
      expect(await converse(agent, "t2", "what is my name?", io)).not.toContain("Ada")
    })

    describe("write approval", () => {
      const writeCall: ToolCall = { name: "write_file", args: { filePath: "notes/out.md", content: "hello" }, id: "w1" }

      it("asks before writing and writes on approval", async () => {
        io.prompt.mockResolvedValueOnce("y")
        await converse(agentWith([[writeCall], []]), "t1", "save a note", io)
        expect(io.prompt).toHaveBeenCalledWith(expect.stringMatching(/approve/i))
        expect(io.print).toHaveBeenCalledWith(expect.stringContaining("notes/out.md"))
        expect(await fs.readFile(path.join(root, "notes", "out.md"), "utf8")).toBe("hello")
      })

      it("does not write when the user declines, and tells the model", async () => {
        io.prompt.mockResolvedValueOnce("n")
        const answer = await converse(agentWith([[writeCall], []]), "t1", "save a note", io)
        expect(await fs.pathExists(path.join(root, "notes", "out.md"))).toBe(false)
        expect(answer).toContain("declined")
      })

      it("asks about each write when the model makes several at once", async () => {
        const second: ToolCall = { name: "write_file", args: { filePath: "notes/two.md", content: "two" }, id: "w2" }
        io.prompt.mockResolvedValueOnce("y").mockResolvedValueOnce("n")
        await converse(agentWith([[writeCall, second], []]), "t1", "save two notes", io)
        expect(io.prompt).toHaveBeenCalledTimes(2)
        expect(await fs.pathExists(path.join(root, "notes", "out.md"))).toBe(!declineCancelsBatch)
        expect(await fs.pathExists(path.join(root, "notes", "two.md"))).toBe(false)
      })

      it("does not ask for approval for read-only tools", async () => {
        await converse(agentWith([[{ name: "list_files", args: { dirPath: "." }, id: "l1" }], []]), "t1", "ls", io)
        expect(io.prompt).not.toHaveBeenCalled()
      })
    })

    describe("limits", () => {
      const looping = Array.from({ length: 40 }, (_, i) => [
        { name: "list_files", args: { dirPath: "." }, id: `l${i}` },
      ])

      it("stops a model that never stops calling tools (model-call limit)", async () => {
        const answer = await converse(agentWith(looping, { modelCalls: 3, toolCalls: 100 }), "t1", "go", io)
        expect(answer).toMatch(/limit/i)
      })

      it("ends gracefully at the default limits instead of hitting LangGraph's recursion limit", async () => {
        // Regression: LangGraph's default recursionLimit (25 steps) is smaller than
        // 12 model calls + 20 tool calls need, and used to throw GraphRecursionError.
        const answer = await converse(agentWith(looping, { modelCalls: 12, toolCalls: 20 }), "t1", "go", io)
        expect(answer).toMatch(/limit/i)
      })

      it.each([
        ["model-call", { modelCalls: 3, toolCalls: 100 }],
        ["tool-call", { modelCalls: 100, toolCalls: 3 }],
      ])("counts the %s limit per request, so the next turn on the thread starts fresh", async (_kind, limits) => {
        // Regression: createAgent kept the count at the limit, so later turns stopped at once.
        const agent = agentWith(looping, limits)
        expect(await converse(agent, "t1", "go", io)).toMatch(/limit/i)
        // If the count carried over, the second turn would stop before running any tool.
        const listing = vi.spyOn(fs, "readdir")
        await converse(agent, "t1", "go again", io)
        expect(listing).toHaveBeenCalled()
      })

      it("stops a model that never stops calling tools (tool-call limit)", async () => {
        const answer = await converse(agentWith(looping, { modelCalls: 100, toolCalls: 4 }), "t1", "go", io)
        expect(answer).toMatch(/limit/i)
      })
    })
  })
})
