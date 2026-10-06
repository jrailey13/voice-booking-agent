import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate generateBookingResponse from the database. The model is the real
// ChatOllama client, talking to a fake Ollama server through an injected fetch.
vi.mock("./database", () => ({
  prisma: { conversationMessage: { findMany: vi.fn(), create: vi.fn() } },
}));

import { generateBookingResponse } from "./llm";
import { prisma } from "./database";
import { fakeOllama } from "../test/fakeOllama";
import { hangingFetch } from "../test/hangingFetch";

const mockFindMany = prisma.conversationMessage
  .findMany as unknown as ReturnType<typeof vi.fn>;

/** Answers like the fake server, but only after `ms`. */
function slowFetch(server: { fetch: typeof fetch }, ms: number): typeof fetch {
  return (input, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => server.fetch(input, init).then(resolve, reject), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
}

describe("generateBookingResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]); // no prior history
  });

  it("returns the model's reply (trimmed) when Ollama responds within the timeout", async () => {
    const server = fakeOllama("  Tuesday at 2 PM works.  ");

    const reply = await generateBookingResponse("book me in", "conv-1", {
      env: { OLLAMA_TIMEOUT_MS: "500" },
      fetch: server.fetch,
    });

    expect(reply).toBe("Tuesday at 2 PM works.");
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].model).toBe("gemma3");
  });

  it("falls back to a scripted reply when Ollama exceeds OLLAMA_TIMEOUT_MS, and cancels the request", async () => {
    // Regression lock: with the old hard-coded 10s timeout the model would win
    // and this would return its text.
    const server = fakeOllama("SHOULD NOT BE USED");
    const aborted = vi.fn();
    const fetch: typeof globalThis.fetch = (input, init) => {
      init?.signal?.addEventListener("abort", aborted);
      return slowFetch(server, 150)(input, init);
    };

    const reply = await generateBookingResponse("I want to book an appointment", "conv-2", {
      env: { OLLAMA_TIMEOUT_MS: "30" },
      fetch,
    });

    // The "book"/"appointment" branch of the fallback.
    expect(reply).toContain("I'd be happy to help you book an appointment");
    expect(reply).not.toContain("SHOULD NOT BE USED");
    expect(aborted).toHaveBeenCalled();
  });

  it("honors the configured timeout — a slow-but-in-budget call still returns the model text", async () => {
    const server = fakeOllama("Confirmed for 3 PM.");

    const reply = await generateBookingResponse("3pm please", "conv-3", {
      env: { OLLAMA_TIMEOUT_MS: "300" },
      fetch: slowFetch(server, 50),
    });

    expect(reply).toBe("Confirmed for 3 PM.");
  });

  it("sends the system prompt, then the latest stored messages oldest first, as chat turns", async () => {
    const server = fakeOllama("ok");
    // A desc query: the database answers newest-first.
    mockFindMany.mockResolvedValue([
      { role: "user", content: "turn 12" },
      { role: "assistant", content: "turn 11" },
    ]);

    await generateBookingResponse("turn 12", "conv-5", { env: {}, fetch: server.fetch });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
    const messages = server.requests[0].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["system", "assistant", "user"]);
    expect(messages[0].content).toContain("booking assistant");
    expect(messages.slice(1).map((m: { content: string }) => m.content)).toEqual(["turn 11", "turn 12"]);
  });

  it("appends the caller's message when it is not stored yet", async () => {
    const server = fakeOllama("ok");
    mockFindMany.mockResolvedValue([{ role: "assistant", content: "Hello!" }]);

    await generateBookingResponse("2pm please", "conv-7", { env: {}, fetch: server.fetch });

    const messages = server.requests[0].messages;
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "2pm please" });
  });

  it("does not repeat the caller's message when it is already stored", async () => {
    const server = fakeOllama("ok");
    mockFindMany.mockResolvedValue([{ role: "user", content: "2pm please" }]);

    await generateBookingResponse("2pm please", "conv-6", { env: {}, fetch: server.fetch });

    const contents = server.requests[0].messages.map((m: { content: string }) => m.content);
    expect(contents.filter((c: string) => c === "2pm please")).toHaveLength(1);
  });

  it("selects the fallback branch by keyword when the model is unavailable", async () => {
    const server = hangingFetch();

    const reply = await generateBookingResponse("does the afternoon work", "conv-4", {
      env: { OLLAMA_TIMEOUT_MS: "10" },
      fetch: server.fetch,
    });

    expect(reply).toContain("slots available");
    expect(server.aborted).toBe(1);
  });

  it("falls back when Ollama fails outright", async () => {
    const server = fakeOllama(new Error("connection refused"));

    const reply = await generateBookingResponse("hello", "conv-8", { env: {}, fetch: server.fetch });

    expect(reply).toContain("What day and time would work best");
  });
});
