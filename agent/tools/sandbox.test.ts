import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "fs-extra"
import os from "os"
import path from "path"
import { resolveInsideRoot, PathEscapeError } from "./sandbox"

let base: string
let root: string
let outside: string

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-")))
  root = path.join(base, "repo")
  outside = path.join(base, "secrets")
  await fs.outputFile(path.join(root, "src", "a.ts"), "a")
  await fs.outputFile(path.join(outside, "key.txt"), "secret")
  // A junction is the link type Windows allows without admin; on POSIX it's a dir symlink.
  await fs.symlink(outside, path.join(root, "escape"), "junction")
})

afterAll(() => fs.remove(base))

describe("resolveInsideRoot", () => {
  it("resolves a relative path inside the root to an absolute path", async () => {
    expect(await resolveInsideRoot(root, "src/a.ts")).toBe(path.join(root, "src", "a.ts"))
  })

  it("accepts the root itself", async () => {
    expect(await resolveInsideRoot(root, ".")).toBe(root)
  })

  it("accepts an absolute path that is inside the root", async () => {
    expect(await resolveInsideRoot(root, path.join(root, "src"))).toBe(path.join(root, "src"))
  })

  it("accepts a not-yet-existing file inside the root (write target)", async () => {
    expect(await resolveInsideRoot(root, "new/dir/b.md")).toBe(path.join(root, "new", "dir", "b.md"))
  })

  it.each([
    ["parent traversal", "../secrets/key.txt"],
    ["traversal hidden mid-path", "src/../../secrets/key.txt"],
    ["absolute path outside", "__OUTSIDE__"],
    ["sibling whose name starts with the root's", "../repo-evil/x.txt"],
  ])("rejects %s", async (_label, requested) => {
    const p = requested === "__OUTSIDE__" ? path.join(outside, "key.txt") : requested
    await expect(resolveInsideRoot(root, p)).rejects.toBeInstanceOf(PathEscapeError)
  })

  it("rejects a link inside the root that points outside it", async () => {
    await expect(resolveInsideRoot(root, "escape/key.txt")).rejects.toBeInstanceOf(PathEscapeError)
  })

  it("rejects a new file under a link that points outside the root", async () => {
    await expect(resolveInsideRoot(root, "escape/new.txt")).rejects.toBeInstanceOf(PathEscapeError)
  })
})
