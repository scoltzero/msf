import { describe, expect, it } from "vitest";
import { parseAssistantSseBlock } from "./sse";

describe("assistant SSE parser", () => {
  it("uses the standard SSE event field as the application event type", () => {
    expect(parseAssistantSseBlock('event: delta\ndata: {"content":"hello"}')).toEqual({ type: "delta", content: "hello" });
    expect(parseAssistantSseBlock('event: error\ndata: {"message":"provider failed"}')).toEqual({ type: "error", message: "provider failed" });
  });

  it("keeps compatibility with payloads that already contain type", () => {
    expect(parseAssistantSseBlock('data: {"type":"done","session_id":"s1"}')).toEqual({ type: "done", session_id: "s1" });
  });

  it("ignores incomplete or malformed frames", () => {
    expect(parseAssistantSseBlock("event: delta\ndata: not-json")).toBeNull();
    expect(parseAssistantSseBlock('data: {"content":"missing type"}')).toBeNull();
    expect(parseAssistantSseBlock("data: [DONE]")).toBeNull();
  });
});
