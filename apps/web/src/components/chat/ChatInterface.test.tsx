import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInterface } from "./ChatInterface";

/**
 * These tests cover the mechanism behind the RAG "ask before uploading" fix:
 * RagDemo passes `disabled={files.length === 0}`, and ChatInterface must then
 * block all input paths so a query with no documents never reaches the API.
 */
describe("ChatInterface input gating", () => {
  it("disables the textbox and send button when `disabled` is set", () => {
    render(<ChatInterface messages={[]} onSend={vi.fn()} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not call onSend when disabled, even via the Enter key", () => {
    const onSend = vi.fn();
    render(<ChatInterface messages={[]} onSend={onSend} disabled />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "what are your hours?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("also disables while a reply is streaming (isTyping)", () => {
    render(<ChatInterface messages={[]} onSend={vi.fn()} isTyping />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("enables input and forwards messages when documents are present", () => {
    const onSend = vi.fn();
    render(<ChatInterface messages={[]} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    expect(box).not.toBeDisabled();
    fireEvent.change(box, { target: { value: "what are your hours?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("what are your hours?");
  });
});
