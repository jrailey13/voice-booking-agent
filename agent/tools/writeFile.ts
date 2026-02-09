import fs from "fs-extra"
import path from "path"
import { WriteFileInput } from "../types"

/**
 * Write content to a file, creating directories as needed
 * @param input - Object containing path and content
 * @returns Success message
 * @throws Error if file write fails
 */
export async function writeFile(input: WriteFileInput): Promise<string> {
  const { path: filePath, content } = input

  if (!filePath?.trim()) {
    throw new Error("File path cannot be empty")
  }

  if (!content?.trim()) {
    throw new Error("Content cannot be empty")
  }

  const dir = path.dirname(filePath)

  try {
    // Ensure directory exists
    await fs.ensureDir(dir)

    // Write file
    await fs.outputFile(filePath, content, "utf8")

    return `✅ Wrote file to ${filePath}`
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to write file to ${filePath}: ${errorMessage}`)
  }
}
