import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest"
import fs from "fs-extra"
import os from "os"
import path from "path"
import type { StructuredToolInterface } from "@langchain/core/tools"
import { buildTools } from "./agentTools"
import type { AgentIO } from "../runtime/io"

let base: string
let root: string
let io: { prompt: Mock<AgentIO["prompt"]>; print: Mock<AgentIO["print"]> }
let tools: Record<string, StructuredToolInterface>

const run = (name: string, args: Record<string, unknown>) => tools[name].invoke(args) as Promise<string>

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tools-")))
  root = path.join(base, "repo")
  await fs.outputFile(path.join(root, "README.md"), "# Demo\nhello")
  await fs.outputFile(path.join(root, "src", "index.ts"), "export const x = 1\n")
  await fs.outputFile(path.join(root, "node_modules", "dep", "index.js"), "ignored")
  await fs.outputFile(path.join(base, "secret.txt"), "secret")
  io = { prompt: vi.fn<AgentIO["prompt"]>(async () => "blue"), print: vi.fn<AgentIO["print"]>() }
  tools = Object.fromEntries(buildTools({ root, io }).map((t) => [t.name, t]))
})

afterEach(() => fs.remove(base))

describe("buildTools", () => {
  it("exposes the expected tool names", () => {
    expect(Object.keys(tools).sort()).toEqual([
      "analyze_codebase", "ask_user", "get_project_structure", "list_files",
      "read_file", "search_files", "write_file",
    ])
  })
})

describe("read_file", () => {
  it("reads a file relative to the root", async () => {
    expect(await run("read_file", { filePath: "README.md" })).toBe("# Demo\nhello")
  })

  it("reports truncation and how to continue", async () => {
    await fs.outputFile(path.join(root, "big.txt"), "a".repeat(120))
    const out = await run("read_file", { filePath: "big.txt", limit: 50 })
    expect(out.startsWith("a".repeat(50) + "\n")).toBe(true)
    expect(out).toContain("[truncated: showing chars 0–50 of 120; call read_file with offset=50 to continue]")
  })

  it("continues from an offset", async () => {
    await fs.outputFile(path.join(root, "big.txt"), "a".repeat(100) + "b".repeat(20))
    expect(await run("read_file", { filePath: "big.txt", offset: 100, limit: 50 })).toBe("b".repeat(20))
  })

  it("returns (not throws) an error for a path outside the root", async () => {
    const out = await run("read_file", { filePath: "../secret.txt" })
    expect(out).toMatch(/^Error: .*outside the allowed root/)
  })

  it("returns an error for a missing file", async () => {
    expect(await run("read_file", { filePath: "nope.txt" })).toMatch(/^Error: /)
  })
})

describe("write_file", () => {
  it("writes inside the root, creating directories", async () => {
    const out = await run("write_file", { filePath: "docs/out.md", content: "hi" })
    expect(out).toContain("docs")
    expect(await fs.readFile(path.join(root, "docs", "out.md"), "utf8")).toBe("hi")
  })

  it("refuses to write outside the root and writes nothing", async () => {
    const out = await run("write_file", { filePath: "../pwned.txt", content: "x" })
    expect(out).toMatch(/^Error: /)
    expect(await fs.pathExists(path.join(base, "pwned.txt"))).toBe(false)
  })
})

describe("list_files / search_files / get_project_structure", () => {
  it("lists a directory", async () => {
    expect((await run("list_files", { dirPath: "." })).split("\n")).toEqual(
      expect.arrayContaining(["README.md", "src/", "node_modules/"])
    )
  })

  it("searches by filename, skipping node_modules, with root-relative paths", async () => {
    const out = await run("search_files", { dirPath: ".", pattern: "index" })
    expect(out).toContain(path.join("src", "index.ts"))
    expect(out).not.toContain("node_modules")
    expect(out).not.toContain(root)
  })

  it("renders a tree without node_modules", async () => {
    const out = await run("get_project_structure", { dirPath: "." })
    expect(out).toContain("src")
    expect(out).toContain("index.ts")
    expect(out).not.toContain("node_modules")
  })

  it.each(["list_files", "search_files", "get_project_structure", "analyze_codebase"])(
    "%s rejects a directory outside the root",
    async (name) => {
      const args = name === "search_files" ? { dirPath: "..", pattern: "x" }
        : name === "analyze_codebase" ? { rootPath: ".." } : { dirPath: ".." }
      expect(await run(name, args)).toMatch(/^Error: .*outside the allowed root/)
    }
  )
})

describe("analyze_codebase", () => {
  it("summarises the codebase", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    const out = await run("analyze_codebase", { rootPath: "." })
    expect(out).toContain("Files:")
    expect(out).toContain(path.join("src", "index.ts"))
  })
})

describe("ask_user", () => {
  it("asks the human through io and returns their answer", async () => {
    expect(await run("ask_user", { question: "Favourite colour?" })).toBe("blue")
    expect(io.prompt).toHaveBeenCalledWith(expect.stringContaining("Favourite colour?"))
  })
})
