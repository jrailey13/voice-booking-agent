import { tool } from "@langchain/core/tools"
import { z } from "zod"
import fs from "fs-extra"
import path from "path"
import { analyzeCodebase, formatCodebaseSummary } from "./codebaseReader"

/**
 * Tool: Read a file from the codebase
 */
export const readFileTool = tool(
  async ({ filePath }: { filePath: string }) => {
    try {
      const content = await fs.readFile(filePath, "utf8")
      return `Successfully read file:\n${content.substring(0, 5000)}${content.length > 5000 ? "\n... (truncated)" : ""}`
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a file from the codebase",
    schema: z.object({
      filePath: z.string().describe("Path to the file to read")
    })
  }
)

/**
 * Tool: List files in a directory
 */
export const listFilesTool = tool(
  async ({ dirPath }: { dirPath: string }) => {
    try {
      const files = await fs.readdir(dirPath)
      return `Files in ${dirPath}:\n${files.join("\n")}`
    } catch (error) {
      return `Error listing files: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "list_files",
    description: "List all files in a directory",
    schema: z.object({
      dirPath: z.string().describe("Path to the directory")
    })
  }
)

/**
 * Tool: Analyze the codebase
 */
export const analyzeCodebaseTool = tool(
  async ({ rootPath }: { rootPath: string }) => {
    try {
      const context = await analyzeCodebase({ rootPath })
      const summary = formatCodebaseSummary(context)
      return summary
    } catch (error) {
      return `Error analyzing codebase: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "analyze_codebase",
    description: "Analyze and summarize the structure and contents of a codebase",
    schema: z.object({
      rootPath: z.string().describe("Root path of the codebase to analyze")
    })
  }
)

/**
 * Tool: Write content to a file
 */
export const writeFileTool = tool(
  async ({ filePath, content }: { filePath: string; content: string }) => {
    try {
      const dir = path.dirname(filePath)
      await fs.ensureDir(dir)
      await fs.writeFile(filePath, content, "utf8")
      return `✅ Successfully wrote to ${filePath} (${content.length} bytes)`
    } catch (error) {
      return `Error writing file: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "write_file",
    description: "Write content to a file, creating directories as needed",
    schema: z.object({
      filePath: z.string().describe("Path where to write the file"),
      content: z.string().describe("Content to write to the file")
    })
  }
)

/**
 * Tool: Search for files matching a pattern
 */
export const searchFilesTool = tool(
  async ({ dirPath, pattern }: { dirPath: string; pattern: string }) => {
    try {
      const files: string[] = []
      const walkDir = async (currentPath: string) => {
        const items = await fs.readdir(currentPath)
        for (const item of items) {
          const fullPath = path.join(currentPath, item)
          const stat = await fs.stat(fullPath)
          if (stat.isDirectory()) {
            if (!item.startsWith(".") && item !== "node_modules") {
              await walkDir(fullPath)
            }
          } else if (item.includes(pattern)) {
            files.push(fullPath)
          }
        }
      }
      await walkDir(dirPath)
      return `Found ${files.length} files matching "${pattern}":\n${files.join("\n")}`
    } catch (error) {
      return `Error searching files: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "search_files",
    description: "Search for files matching a pattern in a directory",
    schema: z.object({
      dirPath: z.string().describe("Root directory to search"),
      pattern: z.string().describe("Pattern to match in filenames")
    })
  }
)

/**
 * Tool: Get project structure
 */
export const getProjectStructureTool = tool(
  async ({ dirPath, maxDepth = 3 }: { dirPath: string; maxDepth?: number }) => {
    try {
      const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next"]

      const buildTree = async (
        currentPath: string,
        depth: number,
        prefix: string = ""
      ): Promise<string[]> => {
        if (depth > maxDepth) return []

        const items = await fs.readdir(currentPath)
        const lines: string[] = []

        for (const item of items) {
          if (IGNORE_DIRS.includes(item)) continue

          const fullPath = path.join(currentPath, item)
          const stat = await fs.stat(fullPath)
          const isDir = stat.isDirectory()
          const icon = isDir ? "📁" : "📄"

          lines.push(`${prefix}${icon} ${item}`)

          if (isDir && depth < maxDepth) {
            const subItems = await buildTree(fullPath, depth + 1, prefix + "  ")
            lines.push(...subItems)
          }
        }

        return lines
      }

      const tree = await buildTree(dirPath, 0)
      return `Project Structure:\n${tree.join("\n")}`
    } catch (error) {
      return `Error getting project structure: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "get_project_structure",
    description: "Get the directory structure of a project",
    schema: z.object({
      dirPath: z.string().describe("Root directory path"),
      maxDepth: z.number().optional().describe("Maximum depth to traverse (default: 3)")
    })
  }
)

/**
 * Tool: Ask a clarification question to the user
 */
export const askUserTool = tool(
  async ({ question }: { question: string }) => {
    // In a real CLI, this would prompt the user
    // For now, return a placeholder
    return `Question for user: ${question}\n(In interactive mode, this would prompt for user input)`
  },
  {
    name: "ask_user",
    description: "Ask the user a clarification question",
    schema: z.object({
      question: z.string().describe("Question to ask the user")
    })
  }
)

/**
 * All available tools for the agent
 */
export const agentTools = [
  readFileTool,
  listFilesTool,
  analyzeCodebaseTool,
  writeFileTool,
  searchFilesTool,
  getProjectStructureTool,
  askUserTool
]

/**
 * Tool results processor
 */
export async function processToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  const toolMap: Record<string, (input: any) => any> = {
    read_file: (input) => readFileTool.call(input),
    list_files: (input) => listFilesTool.call(input),
    analyze_codebase: (input) => analyzeCodebaseTool.call(input),
    write_file: (input) => writeFileTool.call(input),
    search_files: (input) => searchFilesTool.call(input),
    get_project_structure: (input) => getProjectStructureTool.call(input),
    ask_user: (input) => askUserTool.call(input)
  }

  const handler = toolMap[toolName]
  if (!handler) {
    return `Unknown tool: ${toolName}`
  }

  try {
    const result = await handler(toolInput)
    // Extract string content from result if it's wrapped
    return typeof result === "string" ? result : String(result)
  } catch (error) {
    return `Error executing tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`
  }
}
