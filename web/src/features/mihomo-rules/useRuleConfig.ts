import { useCallback, useRef, useState } from "react";
import { canEditRules, canEditRuleProviders } from "./configAuthority";
import { createRuleConfigDraft } from "./configDraft";
import { ruleApi, type RuleApi } from "./ruleApi";
import type { RuleConfigDraft, RuleConfigSnapshot, RuleValidationResult } from "./types";

export type RuleConfigRuntime = {
  snapshot?: RuleConfigSnapshot;
  draft: RuleConfigDraft;
  loading: boolean;
  saving: boolean;
  validating: boolean;
  error?: string;
  validation?: RuleValidationResult;
  load(): Promise<RuleConfigSnapshot | undefined>;
  setDraft(next: RuleConfigDraft | ((current: RuleConfigDraft) => RuleConfigDraft)): void;
  validate(): Promise<RuleValidationResult>;
  save(): Promise<unknown>;
  discard(): void;
};

export function useRuleConfig(options: { api?: RuleApi; enabled?: boolean } = {}): RuleConfigRuntime {
  const client = options.api ?? ruleApi;
  const [snapshot, setSnapshot] = useState<RuleConfigSnapshot>();
  const [draft, setDraftState] = useState<RuleConfigDraft>(() => createRuleConfigDraft({}));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [validation, setValidation] = useState<RuleValidationResult>();
  const draftRef = useRef(draft);
  const snapshotRef = useRef(snapshot);

  const setDraft = useCallback((next: RuleConfigDraft | ((current: RuleConfigDraft) => RuleConfigDraft)) => {
    setDraftState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      draftRef.current = { ...value, dirty: value.dirty === true || JSON.stringify(value) !== JSON.stringify(current) };
      return draftRef.current;
    });
  }, []);

  const load = useCallback(async (): Promise<RuleConfigSnapshot | undefined> => {
    if (options.enabled === false) return undefined;
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.getConfig();
      snapshotRef.current = next;
      setSnapshot(next);
      const nextDraft = createRuleConfigDraft({ rules: next.rules, providers: next.ruleProviders, yamlText: next.yamlText });
      draftRef.current = nextDraft;
      setDraftState(nextDraft);
      setValidation(undefined);
      return next;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "加载规则配置失败";
      setError(message);
      throw reason;
    } finally {
      setLoading(false);
    }
  }, [client, options.enabled]);

  const validate = useCallback(async (): Promise<RuleValidationResult> => {
    setValidating(true);
    try {
      const result = await client.validateConfig(draftRef.current);
      setValidation(result);
      return result;
    } finally {
      setValidating(false);
    }
  }, [client]);

  const save = useCallback(async (): Promise<unknown> => {
    const authority = snapshotRef.current?.authority;
    if (!canEditRules(authority) || !canEditRuleProviders(authority)) throw new Error("默认配置只读；请在配置管理中应用自定义配置后再编辑");
    setSaving(true);
    setError(undefined);
    try {
      const checked = await client.validateConfig(draftRef.current);
      setValidation(checked);
      if (!checked.valid) throw new Error(checked.message || "配置校验失败，未写入");
      const result = await client.saveConfig(draftRef.current);
      const next = await client.getConfig();
      snapshotRef.current = next;
      setSnapshot(next);
      const nextDraft = createRuleConfigDraft({ rules: next.rules, providers: next.ruleProviders, yamlText: next.yamlText });
      draftRef.current = nextDraft;
      setDraftState(nextDraft);
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败，未写入";
      setError(message);
      throw reason;
    } finally {
      setSaving(false);
    }
  }, [client]);

  const discard = useCallback(() => {
    const current = snapshotRef.current;
    const nextDraft = createRuleConfigDraft({ rules: current?.rules ?? [], providers: current?.ruleProviders ?? {}, yamlText: current?.yamlText });
    draftRef.current = nextDraft;
    setDraftState(nextDraft);
    setValidation(undefined);
  }, []);

  return { snapshot, draft, loading, saving, validating, error, validation, load, setDraft, validate, save, discard };
}
