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
- *Decision:* The turn gets `AbortSignal.timeout(OLLAMA_TIMEOUT_MS)`, passed through the LangChain call options. The HTTP request to Ollama is actually cancelled, where the old race left it running in the background.
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

## 8. Results

*Filled in after implementation.*
