# Booking Agent (Area 4): Design

**Status:** Implemented behind a flag (`BOOKING_AGENT=true`, default off). Results are in §8.
**Inputs:** `docs/langchain-fit-assessment.md` (Area 4, FR2, C2–C4, Q1–Q2) and `docs/langchain-architecture.md` (§9, §12 item 6).

## 1. Problem

Today the reply model "confirms" bookings against slot times written into its system prompt. It never checks real availability. The booking is written afterwards, by a separate extraction pass (`maybeCommitBooking`). If that pass finds the slot taken or cannot parse the conversation, nothing is written, but the caller has already heard "you're booked". That is fit-assessment defect §2.4 #2 and requirement **FR2**: never confirm a booking that was not written.

The idiomatic LangChain fix is to give the model tools: let it check real availability and write the booking itself, then speak.

## 2. Constraints that shape the design

| | Constraint | Consequence |
|---|---|---|
| C2 | Voice latency must not regress more than 10% | Every tool round-trip is another full model pass, about 5–25s on this CPU (§12 of the architecture doc). The agent **cannot** be the default path on this hardware. |
| C3 | Graceful degradation | A slow or failed model must still yield a scripted reply, and the call must not drop. |
| C4 | Booking invariants | At most one appointment per conversation. Date and time normalized to a real slot before any write. Never null out a known detail. |
| FR2 | No false confirmation | Must hold even when the model ignores its instructions. |
| FR4 | Tool-capable model, fail fast | gemma3 cannot call tools, so the agent needs its own model setting and a startup check. |

**Q2 answer (owner, 2026-10-05):** "finish Area 4". Taken as accepting the latency cost **only on a flagged path**. The default path is unchanged, so C2 holds by default.

## 3. Architecture

```
voice.service / booking.service
        │  respondToCaller(message, conversationId)        lib/booking/respond.ts
        ├── BOOKING_AGENT off ─► generateBookingResponse (unchanged)  → { reply, booking: null }
        └── BOOKING_AGENT on  ─► runBookingTurn                        → { reply, booking }
                                   │ history = recentMessages(conversationId)
                                   │ loop ≤ maxModelCalls:
                                   │   model.bindTools([check_availability, book_appointment]).invoke(messages, { signal })
                                   │   no tool calls → reply; else run tools → ToolMessage(tool_call_id) → loop
                                   │ guardConfirmation(reply)          FR2 backstop
                                   ▼
                       timeout / error → scripted fallback (C3), booking still reported if one was written
then: appointment = booking ?? maybeCommitBooking(conversationId)   (enrichment and legacy path unchanged)
```

### Components

| Module | Responsibility |
|---|---|
| `lib/booking/tools.ts` | `buildBookingTools({ db, conversationId, ref })`. `check_availability(date)` returns the open slots for a date. `book_appointment(date, time, service, customerName?, customerContact?)` normalizes date and time, refuses taken slots and second bookings, then writes the appointment and links it to the conversation in one transaction. Successful writes are recorded in `state.booked`. Tools return error text and never throw, so the model can recover. |
| `lib/booking/agent.ts` | `runBookingTurn(deps, input)`. A bounded tool loop over `bindTools`, plus `guardConfirmation`. |
| `lib/booking/respond.ts` | `respondToCaller`. The flag switch, the timeout, the fallback, and model construction. |
| `lib/ai/capability.ts` | `assertToolCapable`, run at API startup when the flag is on. |

### Interfaces

```ts
interface BookingTurnResult { reply: string; booking: CommittedBooking | null }
runBookingTurn(
  deps: { model: BaseChatModel; db: BookingDb; callbacks?: Callbacks; maxModelCalls?: number },
  input: { message: string; conversationId: string; history: HistoryMessage[]; ref?: Date; signal?: AbortSignal },
): Promise<BookingTurnResult>
respondToCaller(message: string, conversationId: string): Promise<BookingTurnResult>
```

## 4. Decisions

**ADR-006: A hand-written tool loop, not `createAgent`, on the voice path.**
- *Context:* Area 1 already uses `createAgent`. Here the number of model calls *is* the latency, and the conversation already lives in Postgres.
- *Decision:* A loop of about 30 lines over `model.bindTools`, `AIMessage.tool_calls` and `ToolMessage`, capped at 3 model calls.
- *Alternatives:* `createAgent` with call-limit middleware. That adds `langchain` and `@langchain/langgraph` to the API (S1), plus a checkpointer to keep in sync with Postgres, or a stateless graph.
- *Consequences:* Every model call is visible in one function and the cap is exact. It also teaches the lower layer `createAgent` is built on. No human-in-the-loop here: the caller already consented by asking to book.

**ADR-007: FR2 is enforced in code, not only in the prompt.**
- *Context:* Small models do not always follow "never say booked unless the tool succeeded".
- *Decision:* `guardConfirmation` replaces a reply that matches the confirmation cue (`CONFIRMATION_CUE` from `booking.commit.ts`) when no booking was written this turn and the conversation had none before. The replacement is a tentative reply.
- *Consequences:* A false confirmation is impossible by construction. The cost is an occasional stilted reply when the model merely *mentions* booking ("would you like me to book that?"). That reply is harmless, and the tentative wording still moves the call forward. The cue regex is shared with the commit gate, so the two agree on what "confirmed" sounds like.

**ADR-008: Real cancellation with `AbortSignal`, not `Promise.race`.**
- *Decision:* The turn gets `AbortSignal.timeout(BOOKING_AGENT_TIMEOUT_MS)`. The HTTP request to Ollama is actually cancelled, where the old race left it running in the background.
- *Correction (2026-10-06):* passing the signal only as a LangChain call option was **not enough**. `ChatOllama` checks a call's signal only between streamed chunks, so a request still waiting for its first token was never cancelled. A turn against a slow or stuck Ollama ignored the deadline (reproduced: still pending 3s after a 200ms timeout). The unit tests missed it because the scripted model honours the signal itself. Fix: `respondToCaller` builds the model per turn with `createBookingAgentModel(env, { signal })`. That gives ChatOllama a `fetch` bound to the deadline (`abortableFetch` in `lib/ai/models.ts`), so the request itself is aborted. A test drives the real `ChatOllama` against a fetch that never answers.
- *Consequences:* A timeout after a successful `book_appointment` still reports the booking (`state.booked`), so the UI shows it even though the spoken reply is the fallback. That fails safe: a missing confirmation, never a false one.

**ADR-009: The agent model is separate from `LLM_MODEL`.**
- *Decision:* `BOOKING_AGENT_MODEL` (default `qwen2.5:7b-instruct`). When `BOOKING_AGENT=true`, the API checks at startup that the model has the `tools` capability and refuses to start otherwise (FR4).

## 5. Invariants (C4) and where they live

| Invariant | Enforced by |
|---|---|
| One appointment per conversation | `book_appointment` refuses when `conversation.appointmentId` is set, and the commit path checks the same field |
| Real slot before any write | `normalizeDate` / `normalizeTime` + `isValidSlot` in the tool. The model's free text is never written as-is. |
| No double-booking of a slot | Clash query inside the write transaction |
| Never null out a known detail | The tool only creates. Later detail changes still go through `enrichBooking`. |

## 6. Failure scenarios

| Scenario | Behaviour |
|---|---|
| Model hallucinates tool arguments ("Tuesdayish") | Tool returns "Error: could not understand the date", and the model asks the caller |
| Model loops on tools | Capped at 3 model calls, then the fallback reply |
| Slot taken between check and book | The clash check sits inside the write transaction, so the tool returns the conflict |
| Ollama down or slow | Abort or error → scripted fallback (C3) |
| Model says "booked" without booking | `guardConfirmation` replaces the reply (FR2) |
| Flag on, model lacks tools | API refuses to start with a fix in the message (FR4) |

## 7. Test strategy

- **Unit tests offline:** a scripted chat model returns predetermined `AIMessage`s with `tool_calls`. An in-memory booking database stands in for Postgres.
- **Contract tests:** existing tests stay green, and with the flag off the services take the old path. One test pins that `respondToCaller` does not touch the agent when the flag is off.
- **Live run:** qwen2.5 against Postgres through `POST /api/booking/chat`, covering a normal booking, a taken slot (FR2), and turn latency against the flag-off baseline (Q1).

## 8. Results (2026-10-05)

**Built and verified offline:** 129 API tests pass and `tsc` is clean. The tests cover the tools, the loop, the FR2 guard, the bounds, abort, fallback and the flag switch.

**Live, through `POST /api/booking/chat`** (CPU only, local Postgres):

| Scenario | Agent off (gemma3, existing path) | Agent on (qwen2.5 + tools) |
|---|---|---|
| "Tomorrow at 2 PM, I'm Sam" | Booked by extraction. The *spoken* reply called tomorrow "October 26th" (it is October 6) and confirmed on the next turn. | One `book_appointment` call, written in 0.1s. The reply matched the row. |
| Taken slot (tomorrow 10 AM) | Not run. Today's path can confirm a taken slot by construction (§1). | Tool refused and nothing was written. The guard replaced the model's reply. The caller then chose 11 AM, which was booked. |

**Q1, turn latency (seconds, whole HTTP turn = model + commit):**

| | Samples | Median | Range |
|---|---|---|---|
| Agent off | 28.7, 30.0, 28.1, 32.0, 29.4, 37.2 (3 measured conversations, warm) | **29.7** | 28.1–37.2 |
| Agent on | 30.3, 25.7, 53.0, 50.9, 20.7 (ad-hoc conversations, warm, after the prompt fix) | **30.3** | 20.7–53.0 |

Per step, from the `DEBUG=true` trace: a model call that picks a tool takes 11–13s, the answer after a tool result takes 8–22s, and a tool runs in 0.1s. A plain answer with no tool takes 30–34s.

**Reading:** the medians are close, because the agent mode drops the separate extraction pass that commit turns pay for today. The spread is much worse: turns with a refusal or a long history reached 51–53s. With 5 samples, C2 (≤10% regression) is **not shown to hold**, so the flag stays **off by default**.

**The controlled agent-on runs did not complete.** Claude Code stopped the background measurement because the machine ran critically low on memory. Agent mode keeps qwen2.5 (7B) loaded next to gemma3, which RAG and extraction still use, and this machine struggles to hold both. **That is a deployment finding in its own right:** run agent mode on a machine with headroom for two models, or point `LLM_MODEL` at the same qwen2.5 so only one model is resident.

**Behaviour fixes made during the live run:**
1. The first prompt said to book "only once the caller has agreed". qwen2.5 kept re-checking availability and asking again, so it never booked. The prompt and tool description now say: book as soon as day, time and service are named, because the tool checks availability itself. This also saves a model call per booking.
2. The tool result included the appointment id, and the model read it aloud. Removed; the client receives the row itself.
3. The guard's false positive ("10 AM is already **booked**") replaced a useful refusal with the generic tentative reply. Now, when the tool refused, the guard speaks the tool's own refusal ("Sorry, 10:00 AM on Tuesday, October 6 is already taken. Open times: …"). That is true by construction.

**Known limitations:**
- When the model retried a booking after a refusal, it omitted the caller's name, which was given on an earlier turn. The appointment was written without it. The existing `enrichBooking` path fills it in on the next turn, at the cost of one extraction call.
- The guard still uses the shared regex cue, so a harmless reply that mentions "booked" without a refusal behind it becomes the tentative reply. This is safe but sometimes stilted (ADR-007).
- History stores only text, so the model does not see its own earlier tool calls. It relies on the stored replies and on the tools to re-derive state.
