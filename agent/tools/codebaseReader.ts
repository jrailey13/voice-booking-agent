import fs from "fs-extra"
import path from "path"
import { readdir, lstat } from "fs/promises"

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".env",
  ".next",
  "target",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".vscode",
  ".idea",
  ".DS_Store"
]

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".cpp",
  ".c",
  ".cs",
  ".php",
  ".rb",
  ".rs",
  ".swift",
  ".kt",
  ".scala",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".sql",
  ".sh",
  ".bash"
]

export interface CodebaseAnalysisOptions {
  rootPath: string
  maxFileSize?: number // in KB
  includeExtensions?: string[]
  excludePatterns?: string[]
}

export interface CodebaseContext {
  projectName: string
  files: {
    path: string
    content: string
  }[]
  summary: {
    fileCount: number
    totalSize: number
    languages: Record<string, number>
  }
}

/**
 * Check if a file should be ignored
 */
function shouldIgnore(
  filePath: string,
  patterns: string[]
): boolean {
  return patterns.some((pattern) => filePath.includes(pattern))
}

/**
 * Get file extension
 */
function getFileExtension(filePath: string): string {
  return path.extname(filePath)
}

/**
 * Detect programming language from extension
 */
function detectLanguage(ext: string): string {
  const languageMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript (React)",
    ".js": "JavaScript",
    ".jsx": "JavaScript (React)",
    ".py": "Python",
    ".go": "Go",
    ".java": "Java",
    ".cpp": "C++",
    ".c": "C",
    ".cs": "C#",
    ".php": "PHP",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".scala": "Scala",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".md": "Markdown",
    ".sql": "SQL",
    ".sh": "Shell",
    ".bash": "Bash"
  }
  return languageMap[ext] || "Other"
}

/**
 * Recursively read files from a directory
 */
async function readFilesRecursive(
  dirPath: string,
  options: CodebaseAnalysisOptions,
  files: Array<{ path: string; content: string; ext: string }> = []
): Promise<Array<{ path: string; content: string; ext: string }>> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      const relativePath = path.relative(options.rootPath, fullPath)

      // Check if should ignore
      if (shouldIgnore(relativePath, options.excludePatterns || DEFAULT_IGNORE_PATTERNS)) {
        continue
      }

      if (entry.isDirectory()) {
        // Recurse into directories
        await readFilesRecursive(fullPath, options, files)
      } else if (entry.isFile()) {
        const ext = getFileExtension(entry.name)

        // Check if file extension matches
        if (
          !options.includeExtensions ||
          options.includeExtensions.includes(ext)
        ) {
          try {
            const stats = await lstat(fullPath)
            const fileSizeKB = stats.size / 1024

            // Check file size limit
            if (options.maxFileSize && fileSizeKB > options.maxFileSize) {
              console.warn(
                `⚠️  Skipping large file: ${relativePath} (${fileSizeKB.toFixed(2)}KB)`
              )
              continue
            }

            const content = await fs.readFile(fullPath, "utf8")
            files.push({
              path: relativePath,
              content,
              ext
            })
          } catch (error) {
            console.warn(`⚠️  Failed to read file: ${relativePath}`)
          }
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️  Error reading directory: ${dirPath}`)
  }

  return files
}

/**
 * Analyze codebase and extract relevant context
 */
export async function analyzeCodebase(
  options: CodebaseAnalysisOptions
): Promise<CodebaseContext> {
  const startTime = Date.now()

  console.log(`\n📂 Analyzing codebase at: ${options.rootPath}`)

  // Set defaults
  const finalOptions = {
    ...options,
    includeExtensions: options.includeExtensions || CODE_EXTENSIONS,
    excludePatterns: options.excludePatterns || DEFAULT_IGNORE_PATTERNS,
    maxFileSize: options.maxFileSize || 100 // 100KB default
  }

  // Read all files
  console.log("🔍 Reading files...")
  const files = await readFilesRecursive(options.rootPath, finalOptions)

  // Sort by path for consistency
  files.sort((a, b) => a.path.localeCompare(b.path))

  // Calculate summary
  const languages: Record<string, number> = {}
  let totalSize = 0

  for (const file of files) {
    const lang = detectLanguage(file.ext)
    languages[lang] = (languages[lang] || 0) + 1
    totalSize += file.content.length
  }

  const projectName = path.basename(options.rootPath)

  const context: CodebaseContext = {
    projectName,
    files: files.map((f) => ({
      path: f.path,
      content: f.content
    })),
    summary: {
      fileCount: files.length,
      totalSize: totalSize,
      languages
    }
  }

  const duration = Date.now() - startTime
  console.log(`✅ Analysis complete in ${duration}ms`)
  console.log(`   📁 Files: ${context.summary.fileCount}`)
  console.log(`   📊 Size: ${(totalSize / 1024).toFixed(2)}KB`)
  console.log(`   🔤 Languages: ${Object.entries(languages).map(([lang, count]) => `${lang} (${count})`).join(", ")}`)

  return context
}

/**
 * Format codebase context for LLM consumption
 */
export function formatCodebaseForLLM(context: CodebaseContext): string {
  let formatted = `# Codebase Analysis\n\n`

  formatted += `**Project**: ${context.projectName}\n`
  formatted += `**Files**: ${context.summary.fileCount}\n`
  formatted += `**Total Size**: ${(context.summary.totalSize / 1024).toFixed(2)}KB\n`
  formatted += `**Languages**: ${Object.entries(context.summary.languages)
    .map(([lang, count]) => `${lang} (${count})`)
    .join(", ")}\n\n`

  formatted += `## Files\n\n`

  for (const file of context.files) {
    formatted += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`
  }

  return formatted
}

/**
 * Format codebase summary for LLM without full contents
 */
export function formatCodebaseSummary(context: CodebaseContext): string {
  let summary = `# Project: ${context.projectName}\n\n`

  summary += `## Summary\n`
  summary += `- Files: ${context.summary.fileCount}\n`
  summary += `- Total Size: ${(context.summary.totalSize / 1024).toFixed(2)}KB\n`
  summary += `- Languages: ${Object.entries(context.summary.languages)
    .map(([lang, count]) => `${lang} (${count})`)
    .join(", ")}\n\n`

  summary += `## Files Structure\n\`\`\`\n`
  for (const file of context.files) {
    const lines = file.content.split("\n").length
    summary += `${file.path} (${lines} lines)\n`
  }
  summary += `\`\`\`\n\n`

  summary += `## Sample Files\n\n`

  // Include first few files as samples
  for (const file of context.files.slice(0, 5)) {
    summary += `### ${file.path}\n`
    // Limit to first 500 chars
    const preview = file.content.substring(0, 500)
    summary += `\`\`\`\n${preview}...\n\`\`\`\n\n`
  }

  return summary
}
