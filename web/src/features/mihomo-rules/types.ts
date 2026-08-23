/** Domain types for the Mihomo rule runtime and configuration editor.
 *
 * Controller payloads have changed shape a few times.  The feature boundary
 * intentionally exposes only normalized values to React components; wire
 * compatibility belongs in normalize.ts and ruleApi.ts.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type RuleConfigAuthorityMode = "generated" | "default" | "custom" | "unknown";

export type RuleConfigAuthority = {
  mode: RuleConfigAuthorityMode;
  isDefault: boolean;
  activePath: string;
  activeName: string;
  runtimePath: string;
  canEditRules: boolean;
  canEditRuleProviders: boolean;
};

export type RuleCapabilities = {
  ruleToggle: boolean;
  ruleStats: boolean;
  providerUpdate: boolean;
};

export type RuntimeRule = {
  /** Stable Controller id/uuid.  It is never a filtered-list index. */
  id: string;
  /** Native UUID used by Meta-compatible PUT /rules/{uuid} toggles. */
  uuid?: string;
  /** Original 1-based matching position returned by Mihomo. */
  index: number;
  /** Display value from Controller, preserving its casing (RuleSet, MATCH…). */
  type: string;
  /** Lower-case/normalized key for filtering and colour maps only. */
  normalizedType: string;
  payload: string;
  /** Rule target (proxy/adapter/strategy group). */
  target: string;
  provider?: string;
  disabled: boolean;
  size?: number;
  hitCount?: number;
  missCount?: number;
  lastHitAt?: string;
  lastMissAt?: string;
  raw: unknown;
};

export type RuntimeRuleProvider = {
  name: string;
  type: string;
  behavior?: string;
  vehicleType?: string;
  format?: string;
  url?: string;
  path?: string;
  interval?: number;
  size?: number;
  ruleCount?: number;
  updatedAt?: string;
  updating: boolean;
  lastUpdateError?: string;
  usingStaleCache: boolean;
  /** Normalized configuration object, including unknown fields. */
  config?: JsonObject;
  runtime?: JsonObject;
  raw: unknown;
};

export type RuleTargetMember = {
  name: string;
  type?: string;
  kind: "node" | "group";
  delay?: number;
  alive?: boolean;
  providerName?: string;
};

export type RuleTargetState = {
  groupName: string;
  type?: string;
  selectedName?: string;
  members: RuleTargetMember[];
  chain: string[];
  finalNode?: string;
  delay?: number;
  cycleDetected: boolean;
  missingReference?: string;
};

export type RuleStore = {
  /** Always Controller order; selectors filter but never sort this array. */
  rules: RuntimeRule[];
  providers: Record<string, RuntimeRuleProvider>;
  providerNames: string[];
  targets: Record<string, RuleTargetState>;
  capabilities: RuleCapabilities;
  authority: RuleConfigAuthority;
  fetchedAt: number;
  source: "controller" | "cache" | "unknown";
  controllerAvailable: boolean;
};

export type RuleStoreAction =
  | { type: "replace"; store: RuleStore }
  | { type: "merge"; store: RuleStore }
  | { type: "patch-rule"; id: string; patch: Partial<Pick<RuntimeRule, "disabled" | "hitCount" | "missCount" | "lastHitAt" | "lastMissAt">> }
  | { type: "patch-provider"; name: string; patch: Partial<RuntimeRuleProvider> }
  | { type: "provider-updating"; name: string; updating: boolean }
  | { type: "clear" };

export type RuleRuntimeSnapshot = {
  store: RuleStore;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  visible: boolean;
};

export type RuleSearchMode = "plain" | "regex";

export type RuleSearchResult = {
  rule: RuntimeRule;
  matches: RuleHighlightSegment[];
};

export type RuleHighlightSegment = { text: string; matched: boolean };

export type RuleProviderDraft = {
  name: string;
  /** Complete object from the source; structured fields are merged over it. */
  value: JsonObject;
};

export type RuleConfigDraft = {
  rulesText: string;
  providers: RuleProviderDraft[];
  /** Optional complete YAML editor contents for advanced mode. */
  yamlText?: string;
  mode: "structured" | "yaml";
  dirty: boolean;
};

export type RuleConfigSnapshot = {
  authority: RuleConfigAuthority;
  rules: string[];
  ruleProviders: Record<string, JsonObject>;
  yamlText?: string;
  raw?: unknown;
};

export type RuleValidationIssue = {
  message: string;
  path?: string;
  line?: number;
  severity?: "error" | "warning";
};

export type RuleValidationResult = {
  valid: boolean;
  message?: string;
  issues: RuleValidationIssue[];
  raw?: unknown;
};

export type RuleDisconnectResult = {
  matched: number;
  closed: number;
  failedIds: string[];
};

export type RuleToggleResult = {
  disabled: boolean;
  disconnect?: RuleDisconnectResult;
};

export type RuleRuntimeRequests = {
  rules?: unknown;
  providers?: unknown;
  proxies?: unknown;
  authority?: unknown;
};

export type RuleRuntimeLoadResult = {
  store: RuleStore;
  responses: RuleRuntimeRequests;
  errors: Error[];
};

export const DEFAULT_RULE_AUTHORITY: RuleConfigAuthority = {
  mode: "unknown",
  isDefault: false,
  activePath: "",
  activeName: "",
  runtimePath: "configs/mihomo/config.yaml",
  canEditRules: false,
  canEditRuleProviders: false,
};

export const EMPTY_RULE_CAPABILITIES: RuleCapabilities = {
  ruleToggle: false,
  ruleStats: false,
  providerUpdate: false,
};

export const EMPTY_RULE_STORE: RuleStore = {
  rules: [],
  providers: {},
  providerNames: [],
  targets: {},
  capabilities: EMPTY_RULE_CAPABILITIES,
  authority: DEFAULT_RULE_AUTHORITY,
  fetchedAt: 0,
  source: "unknown",
  controllerAvailable: false,
};

export function createEmptyRuleStore(): RuleStore {
  return {
    ...EMPTY_RULE_STORE,
    providers: {},
    providerNames: [],
    targets: {},
    capabilities: { ...EMPTY_RULE_CAPABILITIES },
    authority: { ...DEFAULT_RULE_AUTHORITY },
  };
}
