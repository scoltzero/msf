export type AssistantExecutionMode = "read_only" | "confirm_writes" | "full_auto";

export interface AssistantSettings {
  enabled: boolean;
  provider: string;
  base_url: string;
  api_key_set: boolean;
  model: string;
  protocol: string;
  context_tokens: number;
  temperature: number;
  request_timeout: number;
  max_tool_rounds: number;
  show_tool_details: boolean;
  orb_enabled: boolean;
}

export interface AssistantStatus {
  enabled: boolean;
  orb_enabled: boolean;
  admin: boolean;
  catalog_ready: boolean;
  catalog_capabilities: number;
  runtime?: "eino";
  runtime_version?: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface AssistantSession {
  id: string;
  title?: string;
  status?: string;
  execution_mode?: AssistantExecutionMode;
  messages?: AssistantMessage[];
  created_at?: string;
  updated_at?: string;
}

export interface AssistantSkill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  source: "default" | "custom";
  created_at?: string;
  updated_at?: string;
}

export interface AssistantApproval {
  action_id: string;
  title: string;
  method: string;
  path: string;
  risk: string;
  details?: string;
  expires_in?: number;
}

export type AssistantSseEvent =
  | { type: "start"; session_id: string }
  | { type: "delta"; content: string }
  | { type: "tool_started"; name: string; method?: string; path?: string }
  | { type: "tool_finished"; name?: string; status: boolean; status_code?: number; message?: string }
  | ({ type: "approval_required" } & AssistantApproval)
  | { type: "protected_result"; title: string; content: string; copy_once?: boolean }
  | { type: "done"; session_id?: string }
  | { type: "error"; message: string };
