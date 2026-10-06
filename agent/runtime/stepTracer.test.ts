import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs-extra"
import os from "os"
import path from "path"
import { FakeToolCallingModel } from "langchain"
import { MemorySaver } from "@langchain/langgraph"
import { buildAgent, converse } from "../executor/agent"
import { buildTools } from "../tools/agentTools"
import { StepTracer } from "./stepTracer"
import type { AgentIO } from "./io"

let root: string
let lines: string[]
const io: AgentIO = { prompt: async () => "y", print: () => {} }

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "trace-")))
  await fs.outputFile(path.join(root, "README.md"), "The secret word is pineapple.")
  lines = []
})

afterEach(() => fs.remove(root))

/** A clock that advances 1.5s per reading, so durations are predictable. */
function steppingClock() {
  let t = 0
  return () => (t += 1500)
}

describe("StepTracer", () => {
  it("prints each model call and tool call of an agent turn, in order", async () => {
    const agent = buildAgent({
      model: new FakeToolCallingModel({ toolCalls: [[{ name: "read_file", args: { filePath: "README.md" }, id: "c1" }], []] }),
      tools: buildTools({ root, io }),
      checkpointer: new MemorySaver(),
      limits: { modelCalls: 12, toolCalls: 20 },
    })
    const tracer = new StepTracer((line) => lines.push(line), steppingClock())

    await converse(agent, "t1", "what is the secret word?", io, { callbacks: [tracer] })

    expect(lines).toEqual([
      expect.stringMatching(/^· model\s+started \(2 messages\)$/),
      expect.stringMatching(/^· model\s+1\.5s → tool calls: read_file$/),
      expect.stringMatching(/^· tool\s+read_file \{"filePath":"README\.md"\}$/),
      expect.stringMatching(/^· tool\s+read_file 1\.5s → \d+ chars$/),
      expect.stringMatching(/^· model\s+started \(4 messages\)$/),
      expect.stringMatching(/^· model\s+1\.5s → answer \(\d+ chars\)$/),
    ])
  })

  it("prints nothing when no tracer is passed", async () => {
    const agent = buildAgent({
      model: new FakeToolCallingModel({ toolCalls: [[]] }),
      tools: buildTools({ root, io }),
      checkpointer: new MemorySaver(),
      limits: { modelCalls: 12, toolCalls: 20 },
    })
    const printed: string[] = []
    await converse(agent, "t1", "hi", { ...io, print: (t) => printed.push(t) })
    expect(printed).toEqual([])
  })

  it("reports failures with the elapsed time", async () => {
    const tracer = new StepTracer((line) => lines.push(line), steppingClock())
    await tracer.handleToolStart({ lc: 1, type: "not_implemented", id: ["x"] }, "{}", "r1", undefined, [], {}, "read_file")
    await tracer.handleToolError(new Error("disk on fire"), "r1")
    await tracer.handleLLMError(new Error("connection refused"), "r2")

    expect(lines.slice(1)).toEqual([
      "· tool      read_file failed after 1.5s: disk on fire",
      "· model     failed: connection refused",
    ])
  })

  it("shortens long tool input to one line", async () => {
    const tracer = new StepTracer((line) => lines.push(line))
    await tracer.handleToolStart({ lc: 1, type: "not_implemented", id: ["x"] }, `{"content":"${"a\n".repeat(200)}"}`, "r1", undefined, [], {}, "write_file")
    expect(lines[0]).not.toContain("\n")
    expect(lines[0].length).toBeLessThanOrEqual(140)
    expect(lines[0]).toMatch(/…$/)
  })
})
