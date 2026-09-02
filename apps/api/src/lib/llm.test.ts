import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Isolate generateBookingResponse from Ollama and the database so the test is
// fast and deterministic and exercises only the timeout-race / fallback logic.
vi.mock("./ollama", () => ({ ollama: { generate: vi.fn() } }));
vi.mock("./database", () => ({
  prisma: { conversationMessage: { findMany: vi.fn(), create: vi.fn() } },
}));

import { generateBookingResponse } from "./llm";
import { ollama } from "./ollama";
import { prisma } from "./database";

const mockGenerate = ollama.generate as unknown as ReturnType<typeof vi.fn>;
const mockFindMany = prisma.conversationMessage
  .findMany as unknown as ReturnType<typeof vi.fn>;

describe("generateBookingResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]); // no prior history
  });

  afterEach(() => {
    delete process.env.OLLAMA_TIMEOUT_MS;
  });

  it("returns the model's reply (trimmed) when Ollama responds within the timeout", async () => {
    process.env.OLLAMA_TIMEOUT_MS = "500";
    mockGenerate.mockResolvedValue({ response: "  Tuesday at 2 PM works.  " });

    const reply = await generateBookingResponse("book me in", "conv-1");

    expect(reply).toBe("Tuesday at 2 PM works.");
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it("falls back to a scripted reply when Ollama exceeds OLLAMA_TIMEOUT_MS", async () => {
    process.env.OLLAMA_TIMEOUT_MS = "30";
    // Resolves, but only after 150ms — well past the 30ms budget. This is the
    // regression lock: with the old hard-coded 10s timeout the race would be
    // won by the model and this assertion would fail.
    mockGenerate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ response: "SHOULD NOT BE USED" }), 150)
        )
    );

    const reply = await generateBookingResponse(
      "I want to book an appointment",
      "conv-2"
    );

    // The "book"/"appointment" branch of the fallback.
    expect(reply).toContain("I'd be happy to help you book an appointment");
    expect(reply).not.toContain("SHOULD NOT BE USED");
  });

  it("honors the configured timeout — a slow-but-in-budget call still returns the model text", async () => {
    process.env.OLLAMA_TIMEOUT_MS = "300";
    mockGenerate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ response: "Confirmed for 3 PM." }), 50)
        )
    );

    const reply = await generateBookingResponse("3pm please", "conv-3");

    expect(reply).toBe("Confirmed for 3 PM.");
  });

  it("selects the fallback branch by keyword when the model is unavailable", async () => {
    process.env.OLLAMA_TIMEOUT_MS = "10";
    mockGenerate.mockReturnValue(new Promise(() => {}));

    const reply = await generateBookingResponse(
      "does the afternoon work",
      "conv-4"
    );

    expect(reply).toContain("slots available");
  });
});
