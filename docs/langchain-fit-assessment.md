# LangChain Fit Assessment — Problem Framing & Constraints

**Role:** Systems Engineer (EXPLORE + CONSTRAIN)
**Date:** 2026-10-05
**Status:** Input for `systems_architect`. Contains no design.

---

## 1. The question

> Should LangChain be incorporated into this project, and where?

The question has **two objectives**, and they pull against each other. We have to weigh them separately:

| # | Objective | Who benefits | Success looks like |
|---|---|---|---|
| O1 | **Learning:** build real understanding of LangChain's core abstractions | The developer | They can explain and use the core concepts: chat models, messages, tool binding, structured output, retrievers, agents/graphs |
| O2 | **Product fit:** LangChain solves a real problem in this system | Callers and (future) businesses | A measurable improvement in booking correctness or maintainability, with no latency regression |

Something can meet O1 without meeting O2. That is acceptable if we say so openly. The failure we want to avoid is adopting LangChain *for* O1 while *calling* it O2, and then paying for it on the voice critical path.

---

## 2. Current state (observed, not assumed)

### 2.1 LangChain is already in the repo, but only nominally

`agent/` depends on `langchain`, `@langchain/core` and `@langchain/ollama` (v1.x). It uses only a thin slice of them:

- `ChatOllama` and the message classes (`agent/config.ts`, `agent/executor/agentExecutor.ts`).
- Tools are declared with `tool()` (`agent/tools/agentTools.ts`), but **they are never bound to the model**. Tool calls are pulled out of free text with regexes (`extractToolCalls`, `agentExecutor.ts:136`). `ToolMessage.tool_call_id` is filled with the tool *name*, not a real call id.
- **Implication:** the project imports LangChain but skips its main value, structured tool calling. That gap is the clearest learning opportunity in the repo.

### 2.2 The API does not use LangChain

`apps/api` talks to Ollama directly through the `ollama` client:

| Concern | Where | How it works today |
|---|---|---|
| Booking conversation | `lib/llm.ts` | Hand-built prompt string. History comes from Postgres. Timeout is a `Promise.race`. Scripted fallback replies. |
| Booking extraction | `lib/booking.extractor.ts` | A second LLM call with `format: 'json'`, then Zod validation, then chrono normalization |
| Commit gating | `lib/booking.commit.ts` | Regex cues (`CONFIRMATION_CUE`, `CORRECTION_CUE`) decide when to pay for extraction |
| Retrieval (RAG) | `services/rag.service.ts`, `lib/ollama.ts` | Hand-rolled 500/100 chunking, `nomic-embed-text` embeddings, cosine similarity in JS |

### 2.3 Facts about the runtime environment

- **The default model `gemma3` (4.3B, Q4_K_M) cannot do tool calling in Ollama.** `ollama show gemma3` lists only `completion` and `vision`. *Verified 2026-10-05.*
- `qwen2.5:7b-instruct` is installed locally and supports tool calling. It is about 1.6× the parameters of gemma3, so on CPU it should be **slower** per turn. *This needs to be measured.*
- `gpt-oss:20b-cloud` is also installed. It is a **cloud** model, so using it would break the project's "nothing leaves the machine" property.
- Measured latency on CPU: **~20s per normal turn, ~50s per commit turn**. The LLM accounts for nearly all of it. Each extra LLM call in a turn adds roughly 15–25s.

### 2.4 Defects found during exploration (not LangChain-specific)

We should not let these get blamed on, or "fixed by", a framework:

1. **The context window holds the *first* 10 messages, not the *last* 10.** Both `lib/llm.ts:14` and `lib/booking.commit.ts:98` run `orderBy: createdAt asc` + `take: 10`. After 10 messages the model stops seeing new turns. `assistantConfirmed()` keeps checking an old assistant message. The README says "last 10 turns."
   *Fixed 2026-10-05:* both now read through `lib/conversationHistory.ts` (`recentMessages`: newest 10, returned oldest first). The fix also stopped the reply prompt from repeating the caller's message, which the services store before asking for a reply. The old window had hidden that duplicate.
2. **A caller can be told "you're booked" when nothing was booked.** The reply model "confirms" against slot times hardcoded in its system prompt. It never checks real availability. If the slot is taken, `maybeCommitBooking` quietly returns `null` (`booking.commit.ts:121`), but the caller has already heard the confirmation.

   *Addressed behind a flag 2026-10-05:* with `BOOKING_AGENT=true` the model books through tools, and a code-level guard replaces any confirmation the tools did not back. See `docs/booking-agent-design.md`. The default path still has this defect.

Defect 2 is a **real user problem**, and it is the strongest product argument for anything that lets the model consult real state before it speaks. LangChain is one route to that, not the only one.

---

## 3. Stakeholders & scenarios

| Persona | Need | How LangChain could matter |
|---|---|---|
| **Developer-learner** (primary today) | Hands-on practice with LangChain idioms in a codebase they know | Direct |
| **Caller** (simulated today, browser mic) | Book correctly, quickly, without false confirmations | Only indirectly, through correctness and latency |
| **Future service-business operator** (not real yet) | Trustworthy bookings, privacy, low running cost | Indirectly, through maintainability and swapping models or providers |

The project is a personal, undeployed portfolio piece with no users (README, Status). **Learning and portfolio value are legitimate business objectives here.** A LangChain line on the résumé that is backed by correct, idiomatic use is worth more than one backed by the current regex parser.

---

## 4. Real problems vs. assumed problems

| Candidate problem | Real? | Would LangChain address it? |
|---|---|---|
| The model confirms bookings without checking availability (§2.4 #2) | **Real, user-visible** | Partly. Tool calling is the idiomatic pattern. It needs a tool-capable model (§2.3), and every tool round-trip adds a full LLM pass. |
| The agent CLI's tool calling is fragile, being regex over prose | **Real** (dev tool) | **Yes, directly.** This is LangChain's core use case. |
| RAG is hand-rolled | Real but **low pain**: it works and is tested | Yes, as a replacement for the loaders, splitters, embeddings and retriever. The gain is mostly learning and convention, not capability. |
| Extraction is brittle JSON | **Mostly assumed.** `format:'json'` + Zod + null-on-failure is already robust | Marginally (structured output). Replacing it is close to a no-op. |
| Conversation memory is wrong (§2.4 #1) | **Real** | **No.** It is a one-line query bug. A framework memory abstraction would hide it, not fix it. |
| Latency (~20s/turn) | **Real, the #1 UX problem** | **No.** LangChain adds overhead and makes multi-call patterns easy, so it is more likely to make latency **worse**. |
| Switching models or providers is hard | Assumed | Somewhat. The `ollama` client is already thin. The value would only appear with a non-Ollama provider, which the local-only constraint rules out. |

---

## 5. Constraints

### 5.1 Hard constraints (non-negotiable unless the owner says otherwise)

- **C1 — Local-only inference.** No transcript, audio or document may leave the host, and no paid API may be used. This excludes cloud models (including `gpt-oss:*-cloud`) and LangSmith tracing that sends data off-host.
- **C2 — The voice path must not regress.** The median normal-turn latency must not get worse by more than **10%** (about 2s) against the `⏱️ turn latency` baseline. Commit turns must not get worse by more than **10%**.
- **C3 — Graceful degradation is kept.** If the LLM times out or is unreachable, the caller still gets a scripted reply. The call is never dropped.
- **C4 — Booking safety invariants are kept.** At most one appointment per conversation. Never null out a known customer field. Never invent details. Date and time are normalized to a real slot before any write. The existing `booking.commit.test.ts` / `booking.extractor.test.ts` suites keep passing, or are replaced by equivalents.
- **C5 — TypeScript / Node stack.** LangChain.js only, no Python. Must be compatible with `zod@4` (the API already uses 4.5.x) and with Fastify's async model.

### 5.2 Soft constraints

- **S1:** Keep the dependency footprint small. Use `@langchain/core` + `@langchain/ollama` (plus `@langchain/langgraph` only if graph-based agents are in scope), not the whole `langchain` meta-package, unless a feature needs it.
- **S2:** Adoption should be incremental and reversible per subsystem. No big-bang rewrite.
- **S3:** The changes have to stay testable offline (no live Ollama in unit tests), as the current vitest suite is.

### 5.3 Non-goals

- Fixing latency. That is a separate effort (model size, quantization, GPU, collapsing the two LLM passes) and must not be bundled with this work.
- Telephony, multi-tenancy, auth, deployment.
- Adopting LangChain everywhere for consistency's sake.
- Cloud observability (LangSmith) — see C1.

---

## 6. Requirements for any adoption

### Functional

- **FR1:** Wherever the model invokes tools, it must do so through the framework's structured tool-calling mechanism, not by parsing free text.
- **FR2:** A tool-using booking flow (if pursued) must **never tell the caller "confirmed"** for a slot that was not written. Confirmation must follow a successful write, or be phrased as tentative.
- **FR3:** Any replacement of RAG must keep source citations and the current query API contract (`POST /api/rag/query` response shape).
- **FR4:** The model choice must be configurable via env, as `LLM_MODEL` is today. A subsystem that needs tool calling must fail fast with a clear error if the configured model lacks that capability. It must not silently degrade.

### Non-functional

- **NFR1:** Latency meets C2. Before/after numbers must be recorded with the existing turn-latency log.
- **NFR2:** No new network egress (C1). Verify by setting no LangSmith env vars and leaving tracing disabled.
- **NFR3:** Unit tests run without Ollama, using fake chat models or mocks.

---

## 7. Opportunity areas, ranked

Ranked by **learning value ÷ product risk**. This says *where* LangChain could apply, not *how* to build it. Design belongs to the architect.

| Rank | Area | Learning value | Product risk | Notes |
|---|---|---|---|---|
| 1 | **`agent/` CLI** — make it use LangChain properly | High: tool binding, tool messages, the agent loop, possibly LangGraph | **None.** Off the voice path, a dev tool | Needs a tool-capable model, e.g. `qwen2.5:7b-instruct`. Latency matters little here. |
| 2 | **RAG service** | High: loaders, splitters, embeddings, vector stores, retrievers, LCEL chains | Low. Not on the voice path. Contract is preserved (FR3). | Mainly a learning and convention gain. Functional gain is small. |
| 3 | **Booking extraction** (structured output) | Medium | Low–medium | Close to a no-op functionally. Only worth it as a stepping stone to #4. **Done 2026-10-06:** `withStructuredOutput` with `method: "jsonSchema"`; same answers and latency as `format: 'json'` live (see architecture doc §9). |
| 4 | **Booking conversation as a tool-using agent** | Highest | **High.** Voice path, C2 latency, needs model swap away from gemma3 | The only area with a real **user** benefit (fixes §2.4 #2). It conflicts directly with C2 on current hardware unless the tool round-trips stay within the latency budget. |

---

## 8. Success metrics

**Learning (O1)**
- The developer can implement, without reference, a chat model call with bound tools, a structured-output call validated by Zod, and a retriever-backed chain.
- At least one subsystem uses LangChain idiomatically: no regex tool parsing, real `tool_call_id`s.

**Product (O2)** — only applies if area #4 is pursued
- **False-confirmation rate = 0** across a scripted test set that includes double-booked slots (today it is non-zero by construction, §2.4 #2).
- Normal-turn p50 latency within C2. Commit-turn p50 latency within C2.
- All existing booking invariant tests pass (C4).

**Hygiene**
- No new outbound network calls (C1).
- Dependency additions are limited to what S1 lists.

---

## 9. Risks & non-obvious failure modes

| Risk | Why it matters |
|---|---|
| **The tool loop multiplies latency.** An agent that calls `check_availability` and then answers needs ≥2 LLM passes, about 40s+ per turn on CPU | Voice UX gets worse, and it already sits at about 20s |
| **Swapping models changes behaviour.** Going from gemma3 to qwen2.5 to get tool support changes tone, accuracy and extraction quality, beyond adding tools | Regressions get blamed on LangChain when the model change caused them |
| **Small local models call tools badly.** They hallucinate arguments, loop, or skip tools entirely | Agent reliability is worse than benchmarks suggest. Needs an iteration cap and validation. |
| **Abstraction hides defects.** Framework memory classes would wrap the §2.4 #1 query bug, not expose it | Fix #1 directly first |
| **Version churn.** LangChain.js changes APIs often (v0 → v1 changed agents and imports) | Tutorials and LLM-generated code are often out of date. Pin versions. |
| **Telemetry egress by default.** LangSmith tracing turns on through env vars | Silent breach of C1 if someone sets them |
| **Zod 3/4 mismatch** between `@langchain/core` and the API's `zod@4.5` | Type errors or runtime schema failures. Validate early. |

---

## 10. Open questions / validation needed

1. **Q1:** What is qwen2.5:7b-instruct's measured turn latency on this CPU, compared with gemma3? This decides whether area #4 is feasible at all under C2. *(Measure with the existing turn-latency log.)*
2. **Q2:** Does the owner accept a temporary latency regression in area #4 for the learning value, perhaps behind a feature flag, with gemma3 as the default? If so, C2 relaxes for the flagged path only.
3. **Q3:** Is LangGraph in scope for learning? It is LangChain's current recommended way to build agents, so learning only the older `AgentExecutor` patterns is of limited value.
4. **Q4:** Should defects §2.4 #1 and #2 be fixed *before* any LangChain work? (Recommended: #1 yes, since it is trivial and independent. #2 can be the motivating problem for area #4.)
5. **Q5:** Confirm that `@langchain/core` v1 accepts zod v4 schemas in `tool()` and `withStructuredOutput()`.

---

## 11. Bottom line for the architect

- **Yes for learning**, in the low-risk areas first (**#1 agent CLI**, then **#2 RAG**). They are off the voice path, they directly fix the current misuse of LangChain, and they cover most of the concepts worth learning.
- **Conditional yes for product** (**#4 booking agent**). It is the only area with a real user benefit (no false confirmations). It is blocked by the gemma3 tool-capability gap and bounded by C2 latency. Feasibility depends on Q1.
- **No** for extraction-only replacement, memory abstraction or latency. LangChain does not solve those problems here.
- Fix §2.4 #1 independently. It is a bug, not a framework gap.
