import { api, apiData } from "@/lib/api";
import type { AssistantSession, AssistantSettings, AssistantSkill, AssistantStatus } from "./types";

export async function getAssistantStatus() {
  const payload = await api<unknown>("/api/v1/assistant/status");
  return apiData<AssistantStatus>(payload, payload as AssistantStatus);
}

export async function getAssistantSettings() {
  const payload = await api<unknown>("/api/v1/assistant/settings");
  return apiData<AssistantSettings>(payload, payload as AssistantSettings);
}

export async function updateAssistantSettings(patch: Partial<AssistantSettings> & { api_key?: string }) {
  const payload = await api<unknown>("/api/v1/assistant/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return apiData<AssistantSettings>(payload, payload as AssistantSettings);
}

export async function testAssistantSettings() {
  const payload = await api<unknown>("/api/v1/assistant/settings/test", { method: "POST" });
  return apiData<{ message?: string }>(payload, payload as { message?: string });
}

export async function listAssistantSessions() {
  const payload = await api<unknown>("/api/v1/assistant/sessions");
  return apiData<AssistantSession[]>(payload, []);
}

export async function loadAssistantSession(id: string) {
  const payload = await api<unknown>(`/api/v1/assistant/sessions/${encodeURIComponent(id)}`);
  return apiData<AssistantSession>(payload, payload as AssistantSession);
}

export async function deleteAssistantSession(id: string) {
  await api(`/api/v1/assistant/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listAssistantSkills() {
  const payload = await api<unknown>("/api/v1/assistant/skills");
  return apiData<AssistantSkill[]>(payload, []);
}

export async function deleteAssistantSkill(id: string) {
  await api(`/api/v1/assistant/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}
