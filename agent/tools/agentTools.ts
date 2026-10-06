import { tool, type StructuredToolInterface } from "@langchain/core/tools"
import { z } from "zod"
import fs from "fs-extra"
import path from "path"
import { analyzeCodebase, formatCodebaseSummary } from "./codebaseReader"
import { resolveInsideRoot } from "./sandbox"
import type { AgentIO } from "../runtime/io"

export interface ToolContext {
  /** Every path argument is resolved inside this directory (ADR-003). */
  root: string
  /** How ask_user reaches the human. */
  io: AgentIO
}

const DEFAULT_READ_LIMIT = 5000
const MAX_READ_LIMIT = 20000
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next"]

/**
 * Tools report failures as "Error: ..." strings instead of throwing, so the
 * model sees what went wrong and can correct its next call.
 */
async function safely(action: () => Promise<string>): Promise<string> {
  try {
    return await action()
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Build the agent's tools, bound to a sandbox root and an IO channel. */
export function buildTools({ root, io }: ToolContext): StructuredToolInterface[] {
  const inside = (p: string) => resolveInsideRoot(root, p)
  const display = (abs: string) => path.relative(root, abs) || "."

  const readFile = tool(
    ({ filePath, offset = 0, limit = DEFAULT_READ_LIMIT }) =>
      safely(async () => {
        const content = await fs.readFile(await inside(filePath), "utf8")
        const end = Math.min(offset + limit, content.length)
        const slice = content.slice(offset, end)
        // Silent truncation produced confident wrong answers in the Phase 0
        // spike, so always say when there is more and how to get it.
        return end < content.length
          ? `${slice}\n[truncated: showing chars ${offset}–${end} of ${content.length}; call read_file with offset=${end} to continue]`
          : slice
      }),
    {
      name: "read_file",
      description: "Read a text file. Paths are relative to the project root. Long files are returned in pages; follow the offset hint to read more.",
      schema: z.object({
        filePath: z.string().describe("File path relative to the project root"),
        offset: z.number().int().min(0).optional().describe("Character offset to start from (default 0)"),
        limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional().describe(`Maximum characters to return (default ${DEFAULT_READ_LIMIT})`),
      }),
    }
  )

  const listFiles = tool(
    ({ dirPath }) =>
      safely(async () => {
        const entries = await fs.readdir(await inside(dirPath), { withFileTypes: true })
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n")
      }),
    {
      name: "list_files",
      description: "List the entries of a directory (directories end with /). Paths are relative to the project root.",
      schema: z.object({ dirPath: z.string().describe("Directory path relative to the project root, e.g. 'src'") }),
    }
  )

  const searchFiles = tool(
    ({ dirPath, pattern }) =>
      safely(async () => {
        const matches: string[] = []
        const walk = async (dir: string) => {
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            // Dirent.isDirectory() is false for links, so the walk never leaves the root.
            if (entry.isDirectory()) {
              if (!entry.name.startsWith(".") && !IGNORE_DIRS.includes(entry.name)) await walk(full)
            } else if (entry.name.includes(pattern)) {
              matches.push(display(full))
            }
          }
        }
        await walk(await inside(dirPath))
        return `Found ${matches.length} files matching "${pattern}":\n${matches.join("\n")}`
      }),
    {
      name: "search_files",
      description: "Find files whose name contains a pattern, searching a directory recursively (skips node_modules, .git, build output).",
      schema: z.object({
        dirPath: z.string().describe("Directory to search, relative to the project root"),
        pattern: z.string().describe("Substring to match in file names"),
      }),
    }
  )

  const getProjectStructure = tool(
    ({ dirPath, maxDepth = 3 }) =>
      safely(async () => {
        const buildTree = async (dir: string, depth: number, prefix: string): Promise<string[]> => {
          const lines: string[] = []
          for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (IGNORE_DIRS.includes(entry.name)) continue
            lines.push(`${prefix}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}`)
            if (entry.isDirectory() && depth < maxDepth) {
              lines.push(...(await buildTree(path.join(dir, entry.name), depth + 1, prefix + "  ")))
            }
          }
          return lines
        }
        const start = await inside(dirPath)
        return `Project structure of ${display(start)}:\n${(await buildTree(start, 0, "")).join("\n")}`
      }),
    {
      name: "get_project_structure",
      description: "Show the directory tree of a project, skipping node_modules, .git and build output.",
      schema: z.object({
        dirPath: z.string().describe("Directory relative to the project root"),
        maxDepth: z.number().int().min(0).max(6).optional().describe("Maximum depth to traverse (default 3)"),
      }),
    }
  )

  const analyze = tool(
    ({ rootPath }) =>
      safely(async () => formatCodebaseSummary(await analyzeCodebase({ rootPath: await inside(rootPath) }))),
    {
      name: "analyze_codebase",
      description: "Summarise a codebase: file count, languages, file list and sample contents.",
      schema: z.object({ rootPath: z.string().describe("Directory to analyse, relative to the project root") }),
    }
  )

  // Requires human approval before it runs: see humanInTheLoopMiddleware in executor/agent.ts.
  const writeFile = tool(
    ({ filePath, content }) =>
      safely(async () => {
        const target = await inside(filePath)
        await fs.outputFile(target, content, "utf8")
        return `Wrote ${display(target)} (${content.length} characters)`
      }),
    {
      name: "write_file",
      description: "Write content to a file inside the project, creating directories as needed. The user must approve each write.",
      schema: z.object({
        filePath: z.string().describe("File path relative to the project root"),
        content: z.string().describe("Full content to write"),
      }),
    }
  )

  const askUser = tool(
    ({ question }) => safely(() => io.prompt(`\n❓ ${question}\nYou: `)),
    {
      name: "ask_user",
      description: "Ask the user a clarification question and wait for their answer.",
      schema: z.object({ question: z.string().describe("The question to ask") }),
    }
  )

  return [readFile, listFiles, searchFiles, getProjectStructure, analyze, writeFile, askUser]
}
