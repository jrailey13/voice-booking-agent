# LangChain Adoption — Architecture (Areas 1 & 2)

**Role:** Systems Architect (DESIGN)
**Date:** 2026-10-05
**Inputs:** [`langchain-fit-assessment.md`](./langchain-fit-assessment.md). Constraints C1–C5, S1–S3, FR1–FR4 and NFR1–NFR3 are referenced by ID.
**Scope:** Area 1 (`agent/` CLI) and Area 2 (RAG service). Area 4 (the booking agent) was deferred here until Q1, qwen2.5's measured latency, was answered. It was later built behind a flag, with its own design doc: [`booking-agent-design.md`](booking-agent-design.md).
**Status:** Proposed. Phase 0 spike is complete (2026-10-05). See §12 for the results and the corrections they caused.

---

## 0. Assumptions about the open questions

The fit assessment left Q2–Q5 open. This design takes these positions so it can proceed. Each one is reversible.

| Q | Assumed position | Why it is safe |
|---|---|---|
| Q2 (accept a latency regression?) | Not needed. Areas 1 and 2 are off the voice path. | C2 is untouched |
| Q3 (LangGraph?) | **Yes, indirectly.** `createAgent` in `langchain@1.x` is built on LangGraph, so the checkpointer, interrupts and threads are all real LangGraph concepts. A hand-built `StateGraph` is an optional later exercise (§9). | Nothing is lost if the user later wants explicit graphs |
| Q4 (fix the history bug first?) | Out of scope here. Fixed separately in `apps/api` (`lib/conversationHistory.ts`). | Done |
| Q5 (zod 4 compatibility) | **Resolved:** `langchain@1.5.15` depends on `zod ^3.25.76 \|\| ^4`, and `@langchain/langgraph` has a peer dependency of `zod ^4.2.0` | Verified from the npm registry, 2026-10-05 |

---

## 1. Technical problem

1. **Agent CLI:** the tools are defined with LangChain but never bound to the model. Tool calls are pulled out of prose with regexes. `ToolMessage.tool_call_id` holds the tool name. Interactive mode **loses all memory between turns**, because `startAgentConversation` calls `runAgent()` with fresh state every time. `write_file` can write **anywhere on disk**, with no confirmation. Once tool calling works properly, the model will actually use that.
2. **RAG service:** the splitting, embedding, retrieval and prompting are all hand-rolled. This is functionally adequate. The goal is to express it in LangChain's standard abstractions (Document, TextSplitter, Embeddings, VectorStore, Retriever, LCEL), **without changing the HTTP contract or the database schema.**

---

## 2. Technology stack

All versions are the current releases, verified on 2026-10-05.

| Package | Version | Used by | Purpose |
|---|---|---|---|
| `@langchain/core` | ^1.2.16 | agent, api | Messages, tools, Documents, Embeddings, VectorStore, Runnables/LCEL, test fakes |
| `@langchain/ollama` | ^1.3.0 | agent, api | `ChatOllama`, `OllamaEmbeddings` |
| `langchain` | ^1.5.15 | **agent only** | `createAgent` and middleware (call limits, human-in-the-loop) |
| `@langchain/langgraph` | ^1.4.x | **agent only** (comes with `langchain`) | `MemorySaver` checkpointer, `Command` for resuming |
| `@langchain/textsplitters` | ^1.0.2 | api | `RecursiveCharacterTextSplitter` |

**Deliberately excluded:**

- **`@langchain/community`.** It has more than 100 optional peer dependencies, which breaks S1. We keep `pdf-parse` and `mammoth` as they are.
- **The `langchain` package in `apps/api`.** It pulls in LangGraph and `langsmith`, and the API needs neither.
- **pgvector.** It would need a schema migration. See §9.

**Module compatibility:** both packages are CommonJS with `moduleResolution: "node"`. `@langchain/core` ships root-level `.d.ts`/`.cjs` stubs for each subpath (for example `documents.d.ts`), so subpath imports should work under node10 resolution. **Phase 0 confirms this.**

---

## 3. Design drivers, in priority order

1. **Learning fidelity (O1).** Use each abstraction the way LangChain intends. Don't wrap it so thinly that nothing is learned.
2. **Contract preservation.** RAG keeps the same HTTP request/response shape and the same Prisma schema (FR3, S2).
3. **Safety of autonomous tools.** Once tool calling actually works, the agent can do real things. Writes must be confined and confirmed.
4. **Locality (C1).** No egress. LangSmith tracing must be impossible by accident.
5. **Offline testability (S3, NFR3).** Every new unit can be tested with LangChain's own fakes.

---

## 4. Area 1 — Agent CLI

### 4.1 Options

| Option | Description | Learning | Code | Verdict |
|---|---|---|---|---|
| A. Manual `bindTools` loop | `model.bindTools(tools)`, then loop on `AIMessage.tool_calls`, executing each and appending `ToolMessage`s | Teaches the primitives | ~80 lines of hand-written loop | Good **kata**. Do it once, don't ship it. |
| **B. `createAgent` + middleware** | The LangChain v1 standard agent: a ReAct loop on LangGraph with a checkpointer, call limits and human-in-the-loop | Teaches the current idioms: threads, interrupts, middleware | Smallest | **Chosen** |
| C. Hand-built `StateGraph` | Explicit nodes and edges for the model, the tools and approval | Deepest understanding of LangGraph | Largest | Later exercise (§9) |

### 4.2 Component diagram

```
 index.ts (CLI: --agent | --ask)
     │
     ▼
 runtime/bootstrap.ts ──► guards.assertNoRemoteTracing(env)      (C1)
     │                ──► capability.assertToolCapable(model)     (FR4)
     ▼
 executor/agent.ts
   buildAgent({ model, tools, checkpointer })
     └─ createAgent({
          model: ChatOllama(AGENT_MODEL),
          tools: buildTools({ root, io }),
          systemPrompt,
          middleware: [
            modelCallLimitMiddleware(runLimit=AGENT_MAX_MODEL_CALLS),
            toolCallLimitMiddleware(runLimit=AGENT_MAX_TOOL_CALLS),
            humanInTheLoopMiddleware({ interruptOn: { write_file: true } }),
          ],
          checkpointer: MemorySaver,
        })
   converse(agent, threadId, text, io)  ── handles interrupt → approve/reject → resume
     │
     ▼
 tools/agentTools.ts   buildTools({ root, io })
   read_file · list_files · search_files · get_project_structure · analyze_codebase
   write_file  (sandboxed + needs approval)
   ask_user    (real prompt via io)
     │
     ▼
 tools/sandbox.ts      resolveInsideRoot(root, p)  → absolute path, or throws PathEscapeError
```

### 4.3 Interfaces

```ts
// runtime/guards.ts
/** Throws if any LangSmith/LangChain tracing env var would send data off-host. */
export function assertNoRemoteTracing(env?: NodeJS.ProcessEnv): void;
// Checks: LANGSMITH_TRACING, LANGCHAIN_TRACING_V2, LANGCHAIN_TRACING, LANGSMITH_API_KEY, LANGCHAIN_API_KEY.

// runtime/capability.ts
/** Calls Ollama POST /api/show and throws ModelCapabilityError unless capabilities include "tools". */
export async function assertToolCapable(model: string, baseUrl: string, fetchImpl?: typeof fetch): Promise<void>;

// runtime/io.ts — the only place that touches stdin/stdout, so tests can swap it
export interface AgentIO {
  prompt(question: string): Promise<string>;
  print(text: string): void;
}

// tools/sandbox.ts
export class PathEscapeError extends Error {}
export async function resolveInsideRoot(root: string, requested: string): Promise<string>; // realpath-based, rejects ".." and link escapes (async: realpath)

// tools/agentTools.ts
export interface ToolContext { root: string; io: AgentIO }
export function buildTools(ctx: ToolContext): StructuredToolInterface[];

// executor/agent.ts
export interface AgentDeps {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
  limits: { modelCalls: number; toolCalls: number };
}
export function buildAgent(deps: AgentDeps): ReturnType<typeof createAgent>;

/** One user turn on a persistent thread. Resolves write approvals through io. Returns the final assistant text. */
export async function converse(
  agent: ReturnType<typeof createAgent>,
  threadId: string,
  userText: string,
  io: AgentIO,
): Promise<string>;
```

**Tool contract rules**

- Tools return strings. Errors are **returned** (`"Error: …"`), not thrown, so the model can recover. This matches the current behaviour.
- Every path argument goes through `resolveInsideRoot`. `root` defaults to `process.cwd()` and can be overridden with `AGENT_ROOT`.
- `read_file` takes optional `offset` and `limit` arguments (default limit 5,000 characters). **It must say when it truncates:** append `[truncated: showing chars X–Y of N; call read_file with offset=Y to continue]`. This is a Phase 0 finding (§12): silent truncation produced a confidently wrong answer.
- A tool lookup table must be typed `Record<string, StructuredToolInterface>`. A plain union of `tool()` results is not callable in TypeScript.
- `processToolCall` and `extractToolCalls` are **deleted**. The framework dispatches tools by name.

### 4.4 Data and state

- Conversation state lives in a **`MemorySaver`** checkpointer, keyed by `thread_id`. Interactive mode uses one `thread_id` per CLI session, which fixes the memory loss between turns. `--ask` uses a fresh id each time.
- No persistence across processes. That is deliberate: there is no database in the agent package. A `SqliteSaver` could be added later (§9).

### 4.5 Configuration

| Var | Default | Notes |
|---|---|---|
| `AGENT_MODEL` | `qwen2.5:7b-instruct` | Replaces `OLLAMA_MODEL` in the agent. Must report the `tools` capability (checked at startup). |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | unchanged |
| `OLLAMA_TEMPERATURE` | `0.2` | unchanged |
| `AGENT_ROOT` | `cwd` | sandbox root |
| `AGENT_MAX_MODEL_CALLS` | `12` | per run |
| `AGENT_MAX_TOOL_CALLS` | `20` | per run |

Both limit middlewares use `exitBehavior: "end"`. When the tool limit is hit, the over-limit call is **not executed**. Instead it is answered with a "limit reached" `ToolMessage`, so the transcript shows N+1 tool messages for N executions. This was verified in Phase 0.

### 4.6 Failure scenarios

| Scenario | Behaviour |
|---|---|
| The configured model lacks tool support (for example gemma3) | Startup fails with: `Model gemma3 does not support tool calling; set AGENT_MODEL (e.g. qwen2.5:7b-instruct)` |
| Ollama is down | The capability check fails at startup with the existing "ensure `ollama serve`" tips |
| The model loops on tools | Call-limit middleware stops the run, and the CLI prints a partial-result notice |
| The model hallucinates tool arguments | The tool's Zod schema rejects them, and the error goes back to the model as a `ToolMessage` |
| A path escapes the sandbox (`../../`, absolute path, symlink) | `PathEscapeError`, returned to the model as an error string. **Nothing is written.** |
| The user rejects a write | The middleware returns a rejection to the model, and the run continues |
| Tracing env vars are set | The process refuses to start (C1) |

### 4.7 Testing (adds `vitest` to `agent/`)

- `sandbox.test.ts`: covers traversal, absolute paths, symlinks and paths inside the root.
- `guards.test.ts` and `capability.test.ts`, using an injected `fetchImpl`.
- `agent.test.ts`: uses `FakeToolCallingModel` (exported by `langchain`) to script tool calls. It asserts that tools are dispatched, that multi-turn memory works on the same `thread_id`, that the call limits stop a looping model, and that `write_file` interrupts and then resumes on approve or reject.

---

## 5. Area 2 — RAG service

### 5.1 Options

| Option | Description | Verdict |
|---|---|---|
| A. Swap only the embeddings and splitter | Smallest change, least learned | Rejected: too thin |
| **B. Custom `PrismaVectorStore` + LCEL chain** | Implement the `VectorStore` contract on the **existing** `rag_chunks` table. Retrieval through `asRetriever()`. Answer through a piped Runnable. | **Chosen.** No migration, and it teaches the extension points. |
| C. `PGVectorStore` from community + pgvector | The "real" production pattern | Rejected for now: schema migration, the pgvector extension, and the community dependency (S1). Evolution path (§9). |
| D. In-memory vector store | Simple | Rejected: `langchain` v1 no longer exports `MemoryVectorStore`, and it would not persist |

### 5.2 Component diagram

```
 routes/rag.ts           (UNCHANGED: same endpoints, same bodies, same responses)
     │
     ▼
 services/rag.service.ts (same public methods: uploadDocument / queryDocuments / deleteDocument)
     │
     ├── upload ─► rag/extract.ts           extractText(buffer, mimetype, filename)  (moved as-is)
     │            rag/ingest.ts             splitter.createDocuments → embeddings.embedDocuments
     │                                      → prisma.$transaction(tx => create RagDocument
     │                                                                  + PrismaVectorStore(tx).addVectors)
     │
     └── query ──► rag/chain.ts             buildRagChain({ store, model })
                     input {question, fileIds}
                       │ RunnablePassthrough.assign(docs = store.asRetriever({k:5, filter:{documentIds}}))
                       │ RunnablePassthrough.assign(answer = formatDocs │ ChatPromptTemplate │ ChatOllama │ StringOutputParser)
                     output {answer, docs}
                   rag.service maps docs → sources[] (same shape as today) and writes QueryLog

 lib/ai/models.ts        getChatModel() · getEmbeddings()     (singletons, env-configured)
 lib/ai/guards.ts        assertNoRemoteTracing()              (called once in src/index.ts)
 rag/prismaVectorStore.ts  class PrismaVectorStore extends VectorStore
```

The voice and booking path (`lib/llm.ts`, `lib/booking.*`, `lib/ollama.ts#ollama`) is **not touched**. `lib/ollama.ts` keeps `ollama`, `checkOllamaHealth` and `cosineSimilarity`. `generateEmbedding` and `generateAnswer` are removed once nothing calls them.

### 5.3 Interfaces

```ts
// lib/ai/models.ts
export function getChatModel(): ChatOllama;           // LLM_MODEL, OLLAMA_BASE_URL
export function getEmbeddings(): OllamaEmbeddings;    // EMBEDDING_MODEL (nomic-embed-text)

// rag/prismaVectorStore.ts
type PrismaLike = Pick<PrismaClient, 'ragChunk'>;      // works with prisma or a $transaction tx
export interface ChunkMetadata { documentId: string; documentName: string; chunkIndex: number }
export interface ChunkFilter { documentIds: string[] }

export class PrismaVectorStore extends VectorStore {
  declare FilterType: ChunkFilter;
  constructor(embeddings: EmbeddingsInterface, db: PrismaLike);
  _vectorstoreType(): 'prisma-float-array';
  /** Requires metadata.documentId and metadata.chunkIndex. Inserts rows with createMany. */
  addVectors(vectors: number[][], documents: Document<ChunkMetadata>[]): Promise<void>;
  addDocuments(documents: Document<ChunkMetadata>[]): Promise<void>; // embeds, then addVectors
  /** Brute-force cosine similarity over the chunks of the filtered documents (same algorithm as today). An empty filter returns []. */
  similaritySearchVectorWithScore(query: number[], k: number, filter?: ChunkFilter): Promise<[Document<ChunkMetadata>, number][]>;
}

// rag/chain.ts
export interface RagInput  { question: string; fileIds: string[] }
export interface RagOutput { answer: string; docs: Document<ChunkMetadata>[] }
export function buildRagChain(deps: { store: PrismaVectorStore; model: BaseChatModel; k?: number }): Runnable<RagInput, RagOutput>;

// rag/ingest.ts
export async function ingestDocument(
  deps: { db: PrismaClient; embeddings: EmbeddingsInterface; splitter: TextSplitter },
  doc: { id: string; name: string; size: number; type: string; text: string },
): Promise<{ chunkCount: number }>;
```

**Contract invariants (FR3)**

- **The `POST /api/rag/query` response is unchanged:** `{ id, answer, timestamp, sources: [{ title, snippet }] }`. `sources` holds the unique document names, in rank order. `snippet` is the first 150 characters of that document's top chunk + `'...'`.
- **The empty-retrieval reply is unchanged:** `'No relevant information found in the provided documents.'` The model is not called in that case.
- **The system prompt is moved verbatim** from `generateAnswer`, so answers stay comparable.
- **The `POST /api/rag/upload` response is unchanged**, including returning `status: 'failed'` with HTTP 200 on error. That quirk is kept, not fixed, to preserve the contract.
- **`QueryLog` is written as today.**

### 5.4 Data model

**No schema change.** The mapping to the existing tables:

| LangChain concept | Storage |
|---|---|
| `Document.pageContent` | `rag_chunks.content` |
| embedding vector | `rag_chunks.embedding` (`Float[]`) |
| `metadata.documentId` / `chunkIndex` | `rag_chunks.documentId` / `chunkIndex` |
| `metadata.documentName` | joined from `rag_documents.name` at query time |

**Behaviour change, accepted:** `RecursiveCharacterTextSplitter` (size 500, overlap 100) splits on paragraph, then line, then word boundaries rather than at fixed character offsets. Existing chunks stay valid, because the same embedding model is used. New uploads get better-shaped chunks. No re-index is required. An optional `scripts/reindex-rag.ts` could re-ingest from `rag_documents.content`.

**Atomicity improves:** the embeddings are computed **before** the transaction. The document row and its chunks are then written in a single `$transaction`, the same all-or-nothing behaviour as today's nested `createMany`, and the slow network work stays outside the transaction.

### 5.5 Performance

- **Upload time is unchanged.** *(Corrected after Phase 0.)* The original claim was that batched `embedDocuments` would be faster. Measured: 40 chunks took 9.5s sequentially (today) and 9.6s with `OllamaEmbeddings.embedDocuments`. CPU inference is the bottleneck, and batching does not parallelize it. The vectors are identical (768-d, within 1e-3), so existing chunks stay compatible.
- **Queries cost the same.** It is one embedding plus one generation, and the brute-force cosine algorithm is unchanged. The O(chunks in the selected files) memory load is unchanged too. It is acceptable for a personal corpus. pgvector is the scaling path (§9).

### 5.6 Failure scenarios

| Scenario | Behaviour |
|---|---|
| Ollama is down during upload | Embedding fails before the transaction, nothing is written, and the response is `status: 'failed'` (same as today) |
| The DB fails during upload | The transaction rolls back and leaves no orphan document (same as today) |
| Ollama is down during a query | The chain rejects and the route returns 500 (same as today) |
| `fileIds` refer to deleted documents | The retriever returns [] and the fixed "no relevant information" reply is sent |
| Tracing env vars are set | The API refuses to start (C1) |

### 5.7 Testing

- `prismaVectorStore.test.ts`: uses `SyntheticEmbeddings` from `@langchain/core/utils/testing` and a mocked `prisma.ragChunk`, in the same `vi.mock('./database')` style as `booking.commit.test.ts`. It checks the ranking order, `k`, filter scoping, the empty filter, and the metadata required by `addVectors`.
- `chain.test.ts`: uses `FakeListChatModel` plus a store stub. It checks the answer passthrough, that `docs` are returned, and the prompt contents.
- `rag.service.test.ts`: tests the **contract**. That covers the source-mapping shape, the 150-character snippet, the empty-retrieval reply and the `QueryLog` write.
- `ingest.test.ts`: checks that embeddings are computed outside the transaction and that a failure writes nothing.

---

## 6. Security & compliance

| Concern | Control |
|---|---|
| Data egress (C1) | `assertNoRemoteTracing` runs at startup in **both** packages. It is unit-tested. Only `localhost` Ollama is configured. |
| Agent filesystem writes | Confined to `AGENT_ROOT` (realpath-based) **and** they need interactive approval |
| Agent filesystem reads | Confined to `AGENT_ROOT`. This prevents reads like `~/.ssh` being driven by prompt injection from repo files the agent reads. |
| Prompt injection through RAG documents | Accepted risk. The RAG chain has no tools, so injection can only change the answer text. |
| Supply chain | Only the packages in §2. `@langchain/community` is excluded. **Gap found in Phase 0:** `agent/.gitignore` excludes `package-lock.json`, and `agent/.npmrc` sets `legacy-peer-deps=true`. So the agent's versions are **not** pinned, and peer conflicts are hidden. Phase 1 tracks the lockfile and removes `legacy-peer-deps`. The install is clean without it (verified). |

---

## 7. Deployment & operations

- Nothing new to deploy. Both packages run locally, as they do today.
- New env vars are documented in `agent/.env.example` and `apps/api/.env.example`.
- **Observability:** `ChatOllama` and the chain accept LangChain **callbacks**. A local `ConsoleCallbackHandler` can be switched on with `DEBUG=true` to log each step (model call, tool call, retriever hits) without LangSmith. This is good for learning, and it does not break C1.
- Docs to update: the README "Also in this repo" section, `agent/AGENTIC.md` (the tool-use section describes the regex patterns, which are going away) and `OLLAMA_RAG_README.md`.

---

## 8. Delivery plan

| Phase | Work | Exit criteria |
|---|---|---|
| **0. Spike** (½ day) — ✅ **done**, §12 | `npm install` in `agent/` (it is not installed today). Add packages to the API. Typecheck a subpath import under node10 resolution. Confirm the `humanInTheLoopMiddleware` resume payload shape against the installed version. Run one `bindTools` call on qwen2.5 by hand (the Option A kata). | Typecheck is green in both packages. One real tool call has round-tripped. |
| **1. Agent** — ✅ **done**, §13 | guards, capability, sandbox, tools, `createAgent`, `converse`, tests, docs | §4.7 tests are green. A manual session reads files, remembers context across turns, and asks before writing. |
| **2. RAG** — ✅ **done**, §14 | models, store, ingest, chain, service rewiring, tests, docs | §5.7 tests are green. Existing API tests are green. A manual upload and query through the web UI returns the same response shape. |

Each phase ships as its own reversible commit series (S2). Phase 2 does not depend on Phase 1.

---

## 9. Evolution strategy

| Next step | Trigger | Notes |
|---|---|---|
| **Hand-built `StateGraph` agent (Q3 deep dive)** | **Done** (2026-10-06), `AGENT_ENGINE=graph` | The same agent as explicit `begin` → `model` → `tools` nodes, run by the same tests as `createAgent`. Writing it found two `createAgent` behaviours, one of them a bug in the shipped CLI (fixed). ADR-010, §15. |
| `SqliteSaver` checkpointer | When agent threads should survive restarts | Swaps in through `AgentDeps.checkpointer` with no other change |
| pgvector + `PGVectorStore` | When the corpus gets large enough that brute-force search is slow | Add a migration for a `vector(768)` column. `PrismaVectorStore` is behind the `VectorStore` interface, so the chain does not change. |
| **Area 3: structured-output extraction** | **Done** (2026-10-06) | `extractBooking` uses `ChatOllama.withStructuredOutput(RawBookingSchema, { method: "jsonSchema" })`. Ollama constrains decoding to the schema, and LangChain validates the reply, replacing `format: 'json'` + `JSON.parse` + `safeParse`. JSON Schema, not tool calling, because gemma3 has no tools. Live on gemma3, 3 paired runs: same extraction, 8.9/8.7/6.9s vs 12.4/8.7/6.7s before. Tests drive the real `ChatOllama` against a fake Ollama server and pin the `format` it sends. The default reply (`lib/llm.ts`) moved to `ChatOllama` in the same step: history is sent as chat messages, and the timeout cancels the request. `lib/ollama.ts` and the `ollama` package are gone, so every model call in the API now goes through LangChain. |
| **Area 4: booking agent** | **Done, behind `BOOKING_AGENT=true`** (2026-10-05) | Tools `check_availability` / `book_appointment`, a bounded `bindTools` loop, and a code-level FR2 guard. Off by default because of C2. Design, decisions (ADR-006 to ADR-009) and measured latency: [`booking-agent-design.md`](booking-agent-design.md). |

---

## 10. Self-critique

- **Weak assumption: qwen2.5 calls tools reliably.** A 7B local model may skip tools or invent arguments. The mitigations are the call limits, Zod schemas and returning errors to the model. **Phase 0 tests this before we commit to Phase 1.**
- **The custom VectorStore is non-standard.** A reader who knows LangChain expects `PGVectorStore`. We accept that because writing the extension point is itself a learning goal, and §9 provides the migration path.
- **Two Ollama clients in `apps/api`.** `ollama` (voice/booking) and `@langchain/ollama` (RAG) both talk to the same server. That is redundant, and we tolerate it until Area 4 decides how the voice path is handled. Unifying them now would touch the latency-critical path, which is a non-goal.
- **`createAgent` hides the loop.** It is the most likely way to "use LangChain without learning it". The Phase 0 kata (Option A) exists for exactly that reason. Skipping it would be a mistake.
- **Is RAG worth touching at all?** Functionally it is close to a no-op. It is justified only by O1, and the fit assessment says so openly. If learning time is short, do Phase 1 only.

---

## 11. ADRs

### ADR-001: Use `createAgent` (LangChain v1) for the agent CLI
- **Context:** The current loop parses tool calls with regexes, has no memory between turns and runs writes unconfined.
- **Decision:** Use `createAgent` with a `MemorySaver` checkpointer, call-limit middleware and human-in-the-loop on `write_file`.
- **Alternatives:** A manual `bindTools` loop (kept as a learning kata), or a hand-built `StateGraph` (deferred exercise).
- **Consequences:** The least custom code, and it uses current idioms. Depends on LangGraph through `langchain`. The loop is abstracted, which the kata offsets.

### ADR-002: Agent model is `qwen2.5:7b-instruct`, with a capability check at startup
- **Context:** gemma3 lacks the `tools` capability in Ollama (verified).
- **Decision:** Add a separate `AGENT_MODEL` env var, defaulting to qwen2.5. Fail fast unless `/api/show` reports `tools`.
- **Alternatives:** Keep gemma3 and prompt-engineer the tool calls (that is what exists today, and it is fragile). Use a cloud model (breaks C1).
- **Consequences:** The agent runs slower per call than gemma3 would. That is acceptable off the voice path.

### ADR-003: Sandbox the agent's filesystem tools and require approval for writes
- **Context:** Working tool calling turns the model's intentions into real side effects.
- **Decision:** All paths are resolved inside `AGENT_ROOT` using realpath, and `write_file` goes through human-in-the-loop.
- **Alternatives:** Approval only, or the sandbox only.
- **Consequences:** One extra keypress per write. Prompt injection from files the agent reads cannot reach outside the repo.

### ADR-004: RAG uses a custom `PrismaVectorStore` over the existing schema
- **Context:** FR3 and S2 require the contract to be preserved. pgvector needs a migration, and the community package breaks S1.
- **Decision:** Subclass `VectorStore` from `@langchain/core/vectorstores` on top of `rag_chunks`, keeping brute-force cosine search.
- **Alternatives:** `PGVectorStore` (deferred, §9), `MemoryVectorStore` (no longer in v1, and not persistent), or only swapping the embeddings and splitter (too thin).
- **Consequences:** No migration, and we learn the extension point. Scaling is unchanged. Moving to pgvector later is a swap behind the interface.

### ADR-005: Make remote tracing a startup error
- **Context:** `langchain` depends on `langsmith`. Tracing is switched on purely by env vars, and that would breach C1 silently.
- **Decision:** Both packages refuse to start if any tracing or LangSmith key variable is set. Local observability goes through callbacks.
- **Alternatives:** Document it only (relies on memory). Uninstall `langsmith` (not possible: it is a hard dependency).
- **Consequences:** If remote tracing is ever wanted, it needs a deliberate code change, which is the intent.

### ADR-010: Keep a hand-built `StateGraph` engine beside `createAgent`
- **Context:** `createAgent` hides the loop (§10). The Q3 deep dive asked for the same agent built by hand on LangGraph, to see what the abstraction does.
- **Decision:** `executor/graphAgent.ts` builds the agent as a `StateGraph`: a `begin` node that zeroes the per-request counters, a `model` node, a `tools` node that pauses with `interrupt()` before writes, and two conditional edges. It uses the same interrupt payload as `humanInTheLoopMiddleware`, so `converse` and the approval prompt drive both engines unchanged. `AGENT_ENGINE=graph` selects it. `createAgent` stays the default.
- **Alternatives:** Replace `createAgent` (loses the reference implementation and the library's maintenance). Keep the graph in a spike folder (it would rot; as a selectable engine it stays under test).
- **Consequences:** About 130 lines that we own. The shared behaviour suite runs against both engines, so any difference between them is either pinned in a test or a failing test. The one deliberate difference is described in §15.

---

## 12. Phase 0 spike results (2026-10-05)

Environment: Windows 11, CPU only, Node 25.1, Ollama 0.34.4. The spike scripts are in `agent/spike/` and `apps/api/src/__spike__/` and are not intended to be committed.

### 12.1 Exit criteria

| Criterion | Result |
|---|---|
| Typecheck green in both packages (CommonJS, `moduleResolution: node`) | ✅ `tsc --noEmit` is clean in `agent/` and `apps/api/`, with every subpath import §4–§5 needs |
| One real tool call round-trips | ✅ qwen2.5: 3/3 questions picked the right tool with valid arguments and zero bad calls |
| Existing API tests unaffected | ✅ 40 passed and 1 skipped, the same as before |

### 12.2 Installed versions

`langchain@1.5.15`, `@langchain/core@1.2.16`, `@langchain/ollama@1.3.0`, `@langchain/langgraph@1.4.19`, `@langchain/textsplitters@1.0.2`. There is a single deduplicated `@langchain/core` in each package, and zod 4 is used throughout (4.6.5 in the agent, 4.5.4 in the API). The new packages add **no** `npm audit` findings. All existing advisories are in pre-existing dependencies.

### 12.3 Assumptions confirmed (offline, `agent/spike/hitl.spike.ts`, `apps/api/src/__spike__/rag.spike.ts`)

- **HITL.** `result.__interrupt__[0].value.actionRequests` carries the pending `write_file` call. Resuming with `new Command({ resume: { decisions: [{ type: "approve" }] } })` executes the tool. Resuming with `{ type: "reject", message }` skips it and feeds the message to the model. The interrupt needs a checkpointer.
- **`MemorySaver` threads.** The same `thread_id` keeps earlier turns, and a different one is isolated. This fixes the memory loss between turns.
- **Call limits.** `modelCallLimitMiddleware({ runLimit: 3, exitBehavior: "end" })` and `toolCallLimitMiddleware({ runLimit: 4 })` stop a looping model after exactly N executions (§4.5 note).
- **Custom `VectorStore`.** The subclass with `FilterType`, `asRetriever({ k, filter })` and the empty-filter behaviour all work. The LCEL `RunnablePassthrough.assign(docs).assign(answer)` returns `{ answer, docs }` as specified. `RecursiveCharacterTextSplitter(500/100)` produced chunks of at most 477 characters.

### 12.4 Live measurements (`agent/spike/kata.spike.ts`, a hand-written `bindTools` loop)

| Model | Tool selection | Per-call latency | Notes |
|---|---|---|---|
| `qwen2.5:7b-instruct` | 3/3 correct, 0 invalid args | Tool-choosing call **5–7s**. Final answer with file contents in context **33–68s**. The first call of the session is ~33s (model load). | Latency grows with how much file text is in context, because prompt processing dominates on CPU |
| `gemma3` | — | — | Ollama rejects the call: `gemma3:latest does not support tools`. This confirms ADR-002. |

### 12.5 Design corrections from the spike

1. **§5.5, upload speed.** The claimed speedup was false. Measured: no change (§5.5 has been updated).
2. **§4.3, `read_file`.** Silent truncation at 3,000 characters cut off `README.md` before the Whisper default. qwen2.5 then answered vaguely instead of saying it hadn't seen the value. `read_file` now has to report truncation and support `offset` and `limit`.
3. **§4.3, typing.** Tool maps need `StructuredToolInterface`.
4. **§6, supply chain.** The agent lockfile is gitignored and `legacy-peer-deps` is on. Fix both in Phase 1.
5. **Agent latency expectation.** A two-step task (choose tool → answer) takes about 40–75s on this CPU. That is acceptable for a dev CLI. Keep the defaults for tool output size modest (`read_file` limit), because every character in context costs prefill time.
6. **Area 4 signal (Q1, partial).** On this hardware a tool round-trip with qwen2.5 costs at least one extra 5–7s call, plus a slower answer call than gemma3's 16–27s. That already breaks the C2 latency budget for the voice path. Area 4 stays deferred until there is a faster tool-capable model or a GPU. *(Later: built as an opt-in mode instead, with the full Q1 measurement. See [`booking-agent-design.md`](booking-agent-design.md) §8.)*

---

## 13. Phase 1 results (2026-10-05)

**Exit criteria met.**

- **Offline:** 58 vitest tests in `agent/` (guards, capability, sandbox, tools, config, bootstrap, agent), and `tsc --noEmit` is clean.
- **Live, `qwen2.5:7b-instruct`, scripted three-turn session:**

| Turn | Result | Time |
|---|---|---|
| "Which web framework does the API use?" | Read `apps/api/package.json` and answered Fastify | 128s (includes the cold model load) |
| "Which file did you just read?" | Answered `apps/api/package.json` from memory | 9s |
| "Write a summary to notes/smoke.md" | One approval prompt. Declined. Nothing written. The agent acknowledged the refusal. | 30s |

- **CLI startup refusals verified:** `AGENT_MODEL=gemma3` gives "does not support tool calling", and `LANGSMITH_TRACING=true` gives a refusal before Ollama is contacted.

### Differences from the design

1. **Recursion backstop (new).** LangGraph's default `recursionLimit` of 25 counts every node visit, including middleware hooks. That is fewer steps than the §4.5 call limits need, so at the default limits runs died with `GraphRecursionError` before the middleware could end them. `converse` now sets `recursionLimit: RECURSION_BACKSTOP` (500), so the middleware is the binding limit. A regression test pins this.
2. **`resolveInsideRoot` is async**, because `realpath` is async. Not-yet-existing write targets are handled by resolving the deepest existing ancestor.
3. **`OLLAMA_MODEL` is no longer read by the agent.** Older `.env` files set it to `gemma3`, which would have been silently ignored or would have failed. The agent reads only `AGENT_MODEL`.
4. **Config is pure.** `loadConfig(env, cwd)` has no import-time side effects. dotenv and model construction moved to the entry point and bootstrap.
5. **Removed as dead code:** `executor/agentExecutor.ts` (the regex loop), `tools/writeFile.ts` (unused), `types.ts`.
6. **`DEBUG=true` step tracing (§7): added after Phase 2.** `StepTracer` (`agent/runtime/stepTracer.ts`, `apps/api/src/lib/ai/stepTracer.ts`) is a callback handler that prints one line per model, tool or retriever step. Building it exposed a Phase 2 defect: the RAG chain's lambdas did not pass `config` to the runnables they invoked, so invoke-time callbacks never reached the retriever or the model. Fixed and pinned by a test in `chain.test.ts`.
7. **Supply chain (§6 gap closed):** `agent/package-lock.json` is now tracked and `agent/.npmrc` (`legacy-peer-deps`) is removed.

---

## 14. Phase 2 results (2026-10-05)

**Exit criteria met.**

- **Offline:** the API suite runs 82 tests and they all pass (1 is skipped, the opt-in STT fixture test). `tsc --noEmit` is clean. That includes 12 **contract tests** for `RagService`. They were written and committed (`925b247`) *before* the rework, passed against the hand-rolled implementation, and pass unchanged against the LangChain one.
- **Live, against Postgres and Ollama, through the real HTTP API:**

| Check | Result |
|---|---|
| Upload a 1.25 KB text file | `ready` in 1.6s. 3 chunks, each starting and ending on a paragraph boundary, 768-d |
| "What is the fee for a late cancellation?" | Correct ("a 40 dollar fee"), citing the right file. 22s, including the cold model load. |
| Query a document stored with the **old** fixed-window chunks | Correct answer and snippet. 5.4s. **No re-index needed.** |
| Delete | 204. The document and its chunks are gone (cascade). |

These checks used `curl` against the same endpoints the web client calls (`apps/web/src/lib/api.ts`). The web UI itself was not clicked through. The test document and the 3 test query-log rows were removed afterwards. The database was left as it was found.

### Differences from the design

1. **`maxRetries: 0` on the LangChain models (new).** `ChatOllama` and `OllamaEmbeddings` retry up to 6 times with exponential backoff by default. The hand-rolled client failed immediately, so an Ollama outage would have hung uploads for minutes. A contract test caught this as a timeout. It is now pinned by a unit test.
2. **The chain retrieves through `store.asRetriever` with a per-request filter.** The chain test therefore runs against a real `PrismaVectorStore` over the in-memory fake DB, not a hand-made stub.
3. **`RagInput`/`RagOutput` are type aliases, not interfaces.** `RunnablePassthrough.assign` needs `Record<string, unknown>`-compatible types, and interfaces have no index signature.
4. **Prompt line endings.** The original system prompt was a template literal in a CRLF-checked-out file, so on Windows it was actually sent with `\r\n`. The moved prompt is built with explicit `\n` joins, keeping its original trailing spaces. The contract test normalises line endings.
5. **`lib/ollama.ts`** lost `generateEmbedding`, `generateAnswer` and `cosineSimilarity`. The voice and booking path's `ollama` client and `checkOllamaHealth` are untouched (non-goal).
6. **Not done:** the optional `scripts/reindex-rag.ts`. The live check showed old chunks work as they are.

## 15. Hand-built StateGraph agent (2026-10-06)

`agent/executor/graphAgent.ts`, selected with `AGENT_ENGINE=graph` (ADR-010).

```
START → begin → model ─(tool calls?)─ yes → tools ─(ended on a limit?)─ no → model …
                      └─ no ──→ END                └─ yes ──→ END
```

| Concern | `createAgent` | Hand-built graph |
|---|---|---|
| State | `messages` plus middleware state (`runModelCallCount`, `threadToolCallCount`, …) | `messages`, `modelCalls`, `toolCalls` (`Annotation.Root`) |
| System prompt | `systemPrompt` option | Prepended in the `model` node, never stored in the thread |
| Call limits | `modelCallLimitMiddleware` / `toolCallLimitMiddleware` | Checked in the `model` and `tools` nodes; `begin` resets them per request |
| Approval | `humanInTheLoopMiddleware` (`afterModel` hook) | `interrupt()` at the top of the `tools` node, before anything runs. LangGraph re-runs the node on resume, so nothing before the interrupt may have side effects. |
| Tool errors | The tool node reports them | Caught in `execute`, returned to the model as an error `ToolMessage` |
| Size | 3 middleware + config | ~130 lines |

**Tests.** The behaviour suite in `executor/agent.test.ts` runs against both engines: 13 behaviours × 2. `executor/graphAgent.test.ts` adds three graph-only tests (the prompt stays out of stored state, a failing tool, an unknown tool). Each mechanism was mutation-checked: removing the counter reset, the approval gate, the decline handling, the system prompt, or the error catch each fails at least one test.

**What writing it found in `createAgent` (langchain 1.5.15):**
1. **Bug, fixed: the call limits never reset after they were hit.** The middleware zeroes its per-run counts in an `afterAgent` hook, and `exitBehavior: "end"` jumps past it. In the interactive CLI, one request that reached a limit left the count at the limit, so every later request in the session stopped at once with "Model call limits exceeded". A `ResetRunLimits` middleware in `buildAgent` now zeroes the counts in `beforeAgent`. Regression tests cover both limits, on both engines.
2. **Difference, kept and pinned: declining one write cancels the whole batch.** When one model reply holds several writes and the user approves one and declines another, `humanInTheLoopMiddleware` drops the approved call too (it is removed from the message, not run) and returns to the model. The user is not told. The graph runs the approved calls and reports the declined ones. The shared test asserts each engine's behaviour.

**Live check (qwen2.5, CPU).** Both engines were given "What port does the API server listen on by default? Check the code." over the repo. The graph ran 8 model calls and 7 tool calls in 3m42s, then answered that it could not find the port and guessed 3000. `createAgent` guessed file paths until it hit its 12-call limit, after 5m56s. The answer is 3001 (`apps/api/src/index.ts`). Neither engine was at fault: the toolset has no content search (`search_files` matches file names only), so the model can only find code by guessing paths. A `grep`-style tool is the obvious next improvement for both engines.

