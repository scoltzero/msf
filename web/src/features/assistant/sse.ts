import { getToken } from "@/lib/api";
import type { AssistantExecutionMode, AssistantSseEvent } from "./types";

function resolveAssistantUrl(path: string) {
  return path;
}

export async function streamAssistantMessage(
  payload: { session_id: string; text: string; execution_mode: AssistantExecutionMode; context?: Record<string, unknown> },
  onEvent: (event: AssistantSseEvent) => void,
  signal: AbortSignal,
) {
  return streamAssistantRequest("/api/v1/assistant/chat/stream", payload, onEvent, signal);
}

export async function streamAssistantAction(
  actionId: string,
  payload: { decision: "approve" | "reject"; reason?: string },
  onEvent: (event: AssistantSseEvent) => void,
  signal: AbortSignal,
) {
  return streamAssistantRequest(`/api/v1/assistant/actions/${encodeURIComponent(actionId)}/resume/stream`, payload, onEvent, signal);
}

async function streamAssistantRequest(path: string, payload: unknown, onEvent: (event: AssistantSseEvent) => void, signal: AbortSignal) {
  const response = await fetch(resolveAssistantUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `助手请求失败 (${response.status})`);
  }
  if (!response.body) throw new Error("助手没有返回流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalReceived = false;
  const dispatch = (event: AssistantSseEvent) => {
    if (event.type === "done" || event.type === "error" || event.type === "approval_required") terminalReceived = true;
    onEvent(event);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach((block) => consumeSseBlock(block, dispatch));
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeSseBlock(buffer, dispatch);
  if (!terminalReceived && !signal.aborted) throw new Error("助手流式响应意外结束，请重试");
}

function consumeSseBlock(block: string, onEvent: (event: AssistantSseEvent) => void) {
  const parsed = parseAssistantSseBlock(block);
  if (parsed) onEvent(parsed);
}

export function parseAssistantSseBlock(block: string): AssistantSseEvent | null {
  const lines = block.split(/\r?\n/);
  const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const type = typeof parsed.type === "string" ? parsed.type : eventName;
    if (!type) return null;
    return { ...parsed, type } as AssistantSseEvent;
  } catch {
    return null;
  }
}
