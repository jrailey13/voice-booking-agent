# Agent CLI

A terminal assistant for exploring a codebase, built on LangChain v1's `createAgent` and a local Ollama model. It reads files, searches and summarises the project, asks you clarifying questions, and can write files after you approve each write. Everything runs on the machine.

How it works, in LangChain terms, is in [AGENTIC.md](./AGENTIC.md). The design and its decisions are in [`docs/langchain-architecture.md`](../docs/langchain-architecture.md).

## Requirements

- Node 20+
- [Ollama](https://ollama.com) running locally, with a model that supports **tool calling**:

```bash
ollama pull qwen2.5:7b-instruct
```

`gemma3`, the model the voice agent uses, cannot call tools. The agent checks this at startup and refuses to run with a model that can't call tools.

## Usage

```bash
cd agent
npm install
cp .env.example .env            # optional; the defaults work

npm run dev                     # interactive session
npm run dev -- --ask "Which web framework does apps/api use?"
npm run dev -- --help
```

Note the `--` before the flags. Without it, npm consumes them itself.

The tools are confined to the **directory you start from**, or to `AGENT_ROOT`. To explore the whole repo from `agent/`, run `AGENT_ROOT=.. npm run dev`.

An interactive session remembers the conversation until you type `quit`. Each `--ask` starts a fresh conversation.

## Tools

| Tool | What it does |
|---|---|
| `read_file` | Reads a file in pages of 5,000 characters (`offset`/`limit`). It always says when there is more. |
| `list_files` | Lists a directory. Directories end with `/`. |
| `search_files` | Finds files by name, skipping `node_modules`, `.git` and build output |
| `get_project_structure` | Shows the directory tree |
| `analyze_codebase` | File count, languages, file list and sample contents |
| `ask_user` | Asks you a question and waits for your answer |
| `write_file` | Writes a file, **only after you approve it** at a `y/N` prompt |

Every path is resolved inside the root. `../`, absolute paths elsewhere, and links that point outside the root are all refused.

## Configuration

| Variable | Default | |
|---|---|---|
| `AGENT_MODEL` | `qwen2.5:7b-instruct` | Must support tool calling |
| `OLLAMA_TEMPERATURE` | `0.2` | 0–2 |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `AGENT_ROOT` | current directory | The sandbox for every tool |
| `AGENT_MAX_MODEL_CALLS` | `12` | Per request. The run ends with a notice when it is reached. |
| `AGENT_MAX_TOOL_CALLS` | `20` | Per request |
| `DEBUG` | `false` | `true` prints each model call and tool call as it happens, plus stack traces on errors |

The agent **refuses to start** if `LANGSMITH_TRACING`, `LANGCHAIN_TRACING_V2`, `LANGCHAIN_TRACING`, `LANGSMITH_API_KEY` or `LANGCHAIN_API_KEY` is set. Any of them would send your code to LangSmith.

## Speed

On a CPU-only machine, expect about 5–7s for the model to choose a tool. Answering with file contents in context takes 30–70s, longer when it has read large files. The first request also loads the model. A GPU, or a smaller tool-capable model, helps most.

## Development

```bash
npm test          # vitest, fully offline (uses LangChain's fake models)
npx tsc --noEmit  # typecheck
```

```
agent/
├── index.ts                 CLI: modes, banner, interactive loop
├── config.ts                env → Config (pure)
├── executor/agent.ts        buildAgent (createAgent + middleware) and converse (one turn + approvals)
├── runtime/
│   ├── bootstrap.ts         startup checks, then wires model + tools + checkpointer
│   ├── guards.ts            refuses remote tracing
│   ├── capability.ts        refuses models without tool support
│   └── io.ts                the terminal seam (prompt/print)
└── tools/
    ├── agentTools.ts        the seven tools, bound to a root and an IO
    ├── sandbox.ts           resolveInsideRoot: path confinement
    └── codebaseReader.ts    used by analyze_codebase
```
