import fs from "fs-extra"
import path from "path"

export class PathEscapeError extends Error {
  constructor(requested: string, root: string) {
    super(`Path "${requested}" is outside the allowed root ${root}`)
    this.name = "PathEscapeError"
  }
}

/**
 * Resolve the deepest existing ancestor through realpath, then re-append the
 * parts that don't exist yet. This follows links that already exist (so a link
 * pointing outside the root is caught) while still allowing new write targets.
 */
async function realpathAllowingMissing(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return path.join(real, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      const parent = path.dirname(current)
      if (parent === current) return target // nothing exists, not even the drive
      missing.push(path.basename(current))
      current = parent
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * Map a model-supplied path to an absolute path inside `root`, or throw
 * PathEscapeError. Relative paths resolve against `root`. Links are resolved
 * before the containment check, so `../`, absolute paths and links that point
 * outside the root are all rejected. See ADR-003.
 */
export async function resolveInsideRoot(root: string, requested: string): Promise<string> {
  const realRoot = await fs.realpath(root)
  const lexical = path.resolve(realRoot, requested)
  if (!isInside(realRoot, lexical)) throw new PathEscapeError(requested, realRoot)

  const real = await realpathAllowingMissing(lexical)
  if (!isInside(realRoot, real)) throw new PathEscapeError(requested, realRoot)
  return lexical
}
