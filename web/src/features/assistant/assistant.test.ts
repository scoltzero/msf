import { describe, expect, it } from "vitest";
import { assistantReducer, initialAssistantState } from "./reducer";

describe("assistant reducer", () => {
  it("builds a streamed assistant message and approval state", () => {
    let state = { ...initialAssistantState, sessionId: "s1" };
    state = assistantReducer(state, { type: "user", content: "检查状态" });
    state = assistantReducer(state, { type: "event", event: { type: "start", session_id: "s1" } });
    state = assistantReducer(state, { type: "event", event: { type: "delta", content: "服务正常" } });
    expect(state.messages.at(-1)).toEqual({ role: "assistant", content: "服务正常" });
    state = assistantReducer(state, { type: "event", event: { type: "approval_required", action_id: "a1", title: "重启 MosDNS", method: "POST", path: "/api/v1/services/mosdns/restart", risk: "reversible_write" } });
    expect(state.approval?.action_id).toBe("a1");
    expect(state.streaming).toBe(false);
  });

  it("clears an active stream without deleting the conversation", () => {
    const state = assistantReducer({ ...initialAssistantState, sessionId: "s1", streaming: true, messages: [{ role: "user", content: "hi" }] }, { type: "stop" });
    expect(state.streaming).toBe(false);
    expect(state.messages).toHaveLength(1);
  });

  it("dismisses approval without deleting the conversation", () => {
    const original = {
      ...initialAssistantState,
      sessionId: "s1",
      messages: [{ role: "user" as const, content: "restart" }],
      approval: { action_id: "a1", title: "重启服务", method: "POST", path: "/api/v1/services/mosdns/restart", risk: "reversible_write" },
    };
    const state = assistantReducer(original, { type: "dismiss_approval" });
    expect(state.approval).toBeNull();
    expect(state.messages).toEqual(original.messages);
  });
});
