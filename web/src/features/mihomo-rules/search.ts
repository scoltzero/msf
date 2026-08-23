import type { RuleHighlightSegment, RuleSearchMode, RuntimeRule } from "./types";

export const MAX_RULE_REGEX_LENGTH = 128;

export type RuleSearchMatcher = {
  query: string;
  mode: RuleSearchMode;
  valid: boolean;
  error?: string;
  test(value: string): boolean;
  ranges(value: string): Array<[number, number]>;
};

function escapedAt(value: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

/** Conservative browser-side ReDoS guard.  It intentionally rejects
 * backreferences, look-behind, nested quantifiers and very deep groups. */
export function isSafeRuleRegex(pattern: string): boolean {
  if (pattern.length > MAX_RULE_REGEX_LENGTH) return false;
  if (/\\(?:[1-9][0-9]*|k<[^>]+>)/.test(pattern)) return false;
  if (/(?:\(\?[<!=]|\(\?>)/.test(pattern)) return false;
  if (/\([^()]*[*+?][^()]*\)[*+?{]/.test(pattern)) return false;
  let depth = 0;
  let inClass = false;
  let quantifiers = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escapedAt(pattern, index)) continue;
    if (character === "[") inClass = true;
    if (character === "]") inClass = false;
    if (inClass) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (depth > 4) return false;
    if (character === "*" || character === "+" || character === "?" || character === "{") {
      quantifiers += 1;
      if (index > 0 && /[*+?}]$/.test(pattern.slice(0, index))) return false;
      const before = pattern.slice(0, index);
      const opening = before.lastIndexOf("(");
      const closing = before.lastIndexOf(")");
      if (opening > closing && /[*+?}]\s*$/.test(before.slice(opening + 1))) return false;
    }
  }
  return quantifiers <= 32;
}

function invalid(query: string, mode: RuleSearchMode, error: string): RuleSearchMatcher {
  return { query, mode, valid: false, error, test: () => false, ranges: () => [] };
}

export function compileRuleSearch(query: string, mode: RuleSearchMode = "plain"): RuleSearchMatcher {
  const normalized = query.trim();
  if (!normalized) return { query: "", mode, valid: true, test: () => true, ranges: () => [] };
  if (mode !== "regex") {
    const lower = normalized.toLocaleLowerCase();
    return {
      query: normalized,
      mode: "plain",
      valid: true,
      test: (value) => value.toLocaleLowerCase().includes(lower),
      ranges: (value) => {
        const result: Array<[number, number]> = [];
        const haystack = value.toLocaleLowerCase();
        let cursor = 0;
        while (cursor <= haystack.length) {
          const index = haystack.indexOf(lower, cursor);
          if (index < 0) break;
          result.push([index, index + normalized.length]);
          cursor = index + Math.max(1, normalized.length);
        }
        return result;
      },
    };
  }
  if (normalized.length > MAX_RULE_REGEX_LENGTH) return invalid(normalized, mode, `正则表达式不能超过 ${MAX_RULE_REGEX_LENGTH} 个字符`);
  if (!isSafeRuleRegex(normalized)) return invalid(normalized, mode, "正则表达式可能造成性能风险");
  try {
    const expression = new RegExp(normalized, "iu");
    const ranged = new RegExp(normalized, "giu");
    return {
      query: normalized,
      mode,
      valid: true,
      test: (value) => expression.test(value),
      ranges: (value) => {
        const result: Array<[number, number]> = [];
        ranged.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = ranged.exec(value))) {
          const start = match.index;
          const end = start + Math.max(match[0].length, 1);
          result.push([start, end]);
          if (match[0].length === 0) ranged.lastIndex += 1;
        }
        return result;
      },
    };
  } catch (error) {
    return invalid(normalized, mode, `正则表达式无效：${error instanceof Error ? error.message : "编译失败"}`);
  }
}

export function highlightText(value: string, matcher: RuleSearchMatcher): RuleHighlightSegment[] {
  if (!value) return [{ text: "", matched: false }];
  const ranges = matcher.valid ? matcher.ranges(value) : [];
  if (ranges.length === 0) return [{ text: value, matched: false }];
  const segments: RuleHighlightSegment[] = [];
  let cursor = 0;
  for (const [rawStart, rawEnd] of ranges) {
    const start = Math.max(cursor, Math.min(value.length, rawStart));
    const end = Math.max(start, Math.min(value.length, rawEnd));
    if (start > cursor) segments.push({ text: value.slice(cursor, start), matched: false });
    if (end > start) segments.push({ text: value.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), matched: false });
  return segments;
}

export function searchableRuleText(rule: RuntimeRule, target?: { selectedName?: string; finalNode?: string }): string {
  return [rule.type, rule.payload, rule.target, rule.provider, target?.selectedName, target?.finalNode].filter(Boolean).join(" ");
}

export function filterRules(rules: readonly RuntimeRule[], query: string, mode: RuleSearchMode = "plain", targets?: Record<string, { selectedName?: string; finalNode?: string }>): { rules: RuntimeRule[]; matcher: RuleSearchMatcher } {
  const matcher = compileRuleSearch(query, mode);
  if (!matcher.valid) return { rules: [], matcher };
  if (!matcher.query) return { rules: [...rules], matcher };
  return {
    rules: rules.filter((rule) => matcher.test(searchableRuleText(rule, targets?.[rule.target]))),
    matcher,
  };
}

export function ruleSearchError(query: string, mode: RuleSearchMode = "plain"): string | undefined {
  return compileRuleSearch(query, mode).error;
}
