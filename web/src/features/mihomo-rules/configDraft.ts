import type { JsonObject, RuleConfigDraft, RuleProviderDraft } from "./types";
import { checkYamlSafety } from "./yamlSafety";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonValue(value: unknown): import("./types").JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null);
  const source = record(value);
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(source)) {
    const normalized = jsonValue(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return (jsonValue(value) as JsonObject | undefined) ?? {};
}

/** Recursively merge visible structured fields over an unknown original. */
export function deepMergeJsonObject(original: JsonObject, patch: JsonObject): JsonObject {
  const result = cloneJsonObject(original);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const left = result[key];
    if (left && typeof left === "object" && !Array.isArray(left) && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMergeJsonObject(left as JsonObject, value as JsonObject);
    } else {
      result[key] = jsonValue(value) ?? null;
    }
  }
  return result;
}

export function serializeRulesText(value: string): string[] {
  // Preserve every non-empty line byte-for-byte (apart from CR line endings).
  return value.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line).filter((line) => line.trim() !== "");
}

export function rulesTextFromLines(lines: readonly string[]): string {
  return lines.join("\n");
}

function yamlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : JSON.stringify(value);
}

function yamlScalar(value: import("./types").JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function yamlObject(value: JsonObject, indent: number): string[] {
  const lines: string[] = [];
  const prefix = " ".repeat(indent);
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      lines.push(`${prefix}${yamlKey(key)}:`);
      lines.push(...yamlObject(item as JsonObject, indent + 2));
    } else {
      lines.push(`${prefix}${yamlKey(key)}: ${yamlScalar(item as import("./types").JsonValue)}`);
    }
  }
  return lines;
}

/** Generate a legal partial YAML document when the API does not return the
 * source YAML. Quoted rule strings and consistently indented provider fields
 * keep commas, colons and non-ASCII names lossless. */
export function serializeRuleConfigYaml(rulesText: string, providers: Record<string, JsonObject>): string {
  const lines = ["rules:"];
  const rules = serializeRulesText(rulesText);
  if (rules.length === 0) lines.push("  []");
  else rules.forEach((line) => lines.push(`  - ${JSON.stringify(line)}`));
  lines.push("rule-providers:");
  const names = Object.keys(providers);
  if (names.length === 0) lines.push("  {}");
  else {
    for (const name of names) {
      lines.push(`  ${yamlKey(name)}:`);
      const fields = yamlObject(providers[name], 4);
      lines.push(...(fields.length ? fields : ["    {}"]));
    }
  }
  return `${lines.join("\n")}\n`;
}

export function parseProviderDrafts(value: unknown): RuleProviderDraft[] {
  const source = record(value);
  return Object.entries(source).map(([name, item]) => ({ name, value: cloneJsonObject(record(item) as JsonObject) }));
}

export function serializeProviderDrafts(drafts: readonly RuleProviderDraft[]): Record<string, JsonObject> {
  const result: Record<string, JsonObject> = {};
  for (const draft of drafts) {
    const name = draft.name.trim();
    if (!name) continue;
    result[name] = cloneJsonObject(draft.value);
  }
  return result;
}

export function mergeProviderDraft(original: RuleProviderDraft, patch: JsonObject): RuleProviderDraft {
  return { name: original.name, value: deepMergeJsonObject(original.value, patch) };
}

export function createRuleConfigDraft(input: { rules?: readonly string[]; providers?: Record<string, JsonObject>; yamlText?: string; mode?: "structured" | "yaml" }): RuleConfigDraft {
  const rulesText = rulesTextFromLines(input.rules ?? []);
  const providers = input.providers ?? {};
  return {
    rulesText,
    providers: parseProviderDrafts(providers),
    yamlText: input.yamlText ?? serializeRuleConfigYaml(rulesText, providers),
    mode: input.mode ?? "structured",
    dirty: false,
  };
}

export function draftHasUnsafeStructuredYaml(draft: RuleConfigDraft): boolean {
  if (draft.mode === "yaml") return false;
  const providers = draft.providers.map((item) => JSON.stringify(item.value)).join("\n");
  return !checkYamlSafety(`${draft.yamlText ?? ""}\n${draft.rulesText}\n${providers}`).safe;
}
