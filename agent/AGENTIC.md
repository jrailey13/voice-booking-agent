# How the agent works

This is a map from LangChain concepts to the code that uses them. It's written for learning LangChain by reading a small, real agent.

## 1. Tool calling is structured, not parsed

A **tool** is a function plus a name, a description and a Zod schema (`tool()` in `tools/agentTools.ts`). LangChain turns the schema into JSON Schema and sends it to the model alongside the messages. A tool-capable model replies with an `AIMessage` whose `tool_calls` field holds `{ name, args, id }` objects. That field is structured data from the model, not text we pattern-match.

Each result goes back as a `ToolMessage` carrying the same `tool_call_id`, which is how the model connects a result to its request.

This is why the model matters. Ollama only fills in `tool_calls` for models that advertise the `tools` capability. `gemma3` doesn't, so `runtime/capability.ts` asks Ollama (`POST /api/show`) before starting.

The loop by hand is about 20 lines: `model.bindTools(tools)`, invoke it, and while there are `tool_calls`, run each one, append a `ToolMessage` and invoke again. Writing it once is the best way to see what the next section automates.

## 2. `createAgent` runs that loop as a LangGraph graph

`executor/agent.ts` calls `createAgent({ model, tools, systemPrompt, middleware, checkpointer })` from the `langchain` package. Underneath is a LangGraph state graph: a **model node** and a **tools node**, looping until the model answers without tool calls. The graph state is the message list.

Two LangGraph concepts show through:

- **The checkpointer and threads.** `MemorySaver` stores the graph state after every step, keyed by `configurable.thread_id`. Calling `invoke` again with the same thread id continues the conversation. That is the agent's memory. The interactive CLI uses one thread per session, and each `--ask` uses a new one.
- **The recursion limit.** LangGraph counts every node visit, including middleware hooks, and stops at `recursionLimit` (default 25). Our call limits allow more steps than that, so `converse` sets a high backstop (`RECURSION_BACKSTOP`) and lets the middleware do the real limiting. This was found by a failing test.

## 3. Middleware shapes the loop

Middleware hooks run before and after model and tool calls. Three are used:

| Middleware | Effect |
|---|---|
| `modelCallLimitMiddleware({ runLimit, exitBehavior: "end" })` | After N model calls in one request, ends the run with a "limit reached" message |
| `toolCallLimitMiddleware({ runLimit, exitBehavior: "end" })` | After N tool executions, refuses further calls. The refused call gets a "limit reached" `ToolMessage` and is **not** executed. |
| `humanInTheLoopMiddleware({ interruptOn: { write_file: … } })` | Pauses the graph before `write_file` runs |

## 4. Human-in-the-loop is an interrupt plus a resume

When the model calls `write_file`, the middleware raises a LangGraph **interrupt**. `invoke` returns early with `result.__interrupt__[0].value.actionRequests`, which lists the pending calls with their arguments. The graph state is saved by the checkpointer, so nothing is lost while the agent waits.

`converse` shows you the file and content, asks `Approve? [y/N]`, and resumes the same thread:

```ts
await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config)
// or { type: "reject", message: "The user declined…" }: the tool is skipped and the model sees the message
```

This is why an interrupt **requires** a checkpointer: resuming means reloading the paused state.

## 5. Safety lives in the tools, not the prompt

Prompts are suggestions. The real limits are in code:

- `tools/sandbox.ts` resolves every path, including through links, and refuses anything outside the root.
- Tools return `"Error: …"` instead of throwing, so the model can read the problem and try again.
- `read_file` always reports truncation. Silent truncation once led the model to answer confidently from the half of the file it never saw.
- `runtime/guards.ts` refuses to start if LangSmith tracing variables are set, because `langchain` depends on `langsmith`.

## 6. Callbacks show each step

Every LangChain run (model call, tool call, retriever) reports start, end and error events to **callback handlers**. `runtime/stepTracer.ts` is a small handler that prints one line per step. With `DEBUG=true`, `index.ts` passes it to `converse`, which puts it in the invoke config. Callbacks given at invoke time reach every nested run, so one handler sees the whole turn:

```
· model     started (2 messages)
· model     88.0s → tool calls: read_file
· tool      read_file {"filePath":"apps/api/package.json"}
· tool      read_file 0.0s → 1134 chars
· model     started (4 messages)
· model     44.5s → answer (61 chars)
```

This is the local alternative to LangSmith tracing, which the agent refuses (§5). LangChain also ships a `ConsoleCallbackHandler`, but it prints every run as JSON, which is too much to read.

## 7. Testing without a model

`FakeToolCallingModel` (from `langchain`) is scripted with the tool calls to emit on each model call, and it echoes the conversation as its text. `executor/agent.test.ts` uses it to check tool dispatch, memory, approval and rejection, and both call limits, all offline in milliseconds. Live behaviour was checked separately against `qwen2.5:7b-instruct` (see §12 of the architecture doc).
