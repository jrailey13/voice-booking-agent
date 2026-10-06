import { describe, it, expect } from "vitest"
import path from "path"
import { loadConfig } from "./config"

describe("loadConfig", () => {
  it("uses the documented defaults", () => {
    expect(loadConfig({}, "/work/repo")).toEqual({
      model: "qwen2.5:7b-instruct",
      temperature: 0.2,
      ollamaBaseUrl: "http://localhost:11434",
      root: path.resolve("/work/repo"),
      maxModelCalls: 12,
      maxToolCalls: 20,
      debug: false,
    })
  })

  it("turns on step tracing only for DEBUG=true", () => {
    expect(loadConfig({ DEBUG: "true" }, "/r").debug).toBe(true)
    expect(loadConfig({ DEBUG: "1" }, "/r").debug).toBe(false)
    expect(loadConfig({ DEBUG: "false" }, "/r").debug).toBe(false)
  })

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      AGENT_MODEL: "llama3.1",
      OLLAMA_TEMPERATURE: "0",
      OLLAMA_BASE_URL: "http://gpu-box:11434",
      AGENT_ROOT: "sub/dir",
      AGENT_MAX_MODEL_CALLS: "5",
      AGENT_MAX_TOOL_CALLS: "7",
    }, "/work/repo")
    expect(config).toMatchObject({
      model: "llama3.1",
      temperature: 0,
      ollamaBaseUrl: "http://gpu-box:11434",
      root: path.resolve("/work/repo", "sub/dir"),
      maxModelCalls: 5,
      maxToolCalls: 7,
    })
  })

  it("ignores the legacy OLLAMA_MODEL so gemma3 in an old .env doesn't silently become the agent model", () => {
    expect(loadConfig({ OLLAMA_MODEL: "gemma3" }, "/r").model).toBe("qwen2.5:7b-instruct")
  })

  it.each([
    ["AGENT_MAX_MODEL_CALLS", "zero", "0"],
    ["AGENT_MAX_TOOL_CALLS", "not a number", "lots"],
    ["OLLAMA_TEMPERATURE", "out of range", "3"],
  ])("rejects %s that is %s", (name, _label, value) => {
    expect(() => loadConfig({ [name]: value }, "/r")).toThrow(name)
  })
})
