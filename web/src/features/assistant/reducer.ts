import type { AssistantApproval, AssistantMessage, AssistantSseEvent } from "./types";

export interface AssistantState {
  sessionId: string;
  messages: AssistantMessage[];
  streaming: boolean;
  approval: AssistantApproval | null;
  toolLabel: string;
  error: string;
}

export const initialAssistantState: AssistantState = {
  sessionId: "",
  messages: [],
  streaming: false,
  approval: null,
  toolLabel: "",
  error: "",
};

export type AssistantAction =
  | { type: "hydrate"; sessionId: string; messages: AssistantMessage[] }
  | { type: "user"; content: string }
  | { type: "event"; event: AssistantSseEvent }
  | { type: "dismiss_approval" }
  | { type: "clear" }
  | { type: "stop" };

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  if (action.type === "hydrate") return { ...state, sessionId: action.sessionId, messages: action.messages, error: "" };
  if (action.type === "clear") return { ...initialAssistantState, sessionId: state.sessionId };
  if (action.type === "dismiss_approval") return { ...state, approval: null };
  if (action.type === "stop") return { ...state, streaming: false, toolLabel: "" };
  if (action.type === "user") return { ...state, messages: [...state.messages, { role: "user", content: action.content }], error: "" };
  const event = action.event;
  if (event.type === "start") return { ...state, sessionId: event.session_id, streaming: true, error: "" };
  if (event.type === "delta") {
    const messages = [...state.messages];
    const last = messages.at(-1);
    if (last?.role === "assistant") messages[messages.length - 1] = { ...last, content: last.content + event.content };
    else messages.push({ role: "assistant", content: event.content });
    return { ...state, messages, streaming: true };
  }
  if (event.type === "tool_started") return { ...state, streaming: true, approval: null, toolLabel: event.name || "调用 MSF API" };
  if (event.type === "tool_finished") return { ...state, toolLabel: "" };
  if (event.type === "approval_required") return { ...state, streaming: false, approval: event, toolLabel: "" };
  if (event.type === "done") return { ...state, streaming: false, approval: null, toolLabel: "" };
  if (event.type === "error") return { ...state, streaming: false, approval: null, error: event.message, toolLabel: "" };
  return state;
}
