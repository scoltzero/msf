export const MAX_PROXY_REGEX_LENGTH = 128;

export type SafeSearchMatcher = {
  query: string;
  regex: boolean;
  valid: boolean;
  error?: string;
  expression?: RegExp;
  test(value: string): boolean;
};

export type SafeSearchOptions = {
  regex?: boolean;
  maxLength?: number;
};

function escapedAt(value: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}
/** A conservative ReDoS guard for browser-side regular expressions.
 *
 * It intentionally rejects ambiguous nested quantifiers and look-behind. A
 * false negative only falls back to a plain search in the UI; accepting a
 * potentially exponential expression is not worth the convenience here.
 */
export function isSafeProxyRegex(pattern: string): boolean {
  if (pattern.length > MAX_PROXY_REGEX_LENGTH) return false;
  if (/\\(?:[1-9][0-9]*|k<[^>]+>)/.test(pattern)) return false;
  if (/(?:\(\?[<!=]|\(\?>)/.test(pattern)) return false;

  let depth = 0;
  let quantifiers = 0;
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escapedAt(pattern, index)) continue;
    if (character === "[") inClass = true;
    if (character === "]") inClass = false;
    if (inClass) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "*" || character === "+" || character === "?" || character === "{") {
      quantifiers += 1;
      // A quantified group containing another quantifier is the common
      // catastrophic-backtracking shape: (a+)+, (.*){2}, etc.
      const before = pattern.slice(0, index);
      const opening = before.lastIndexOf("(");
      const closing = before.lastIndexOf(")");
      if (closing >= opening && opening >= 0 && /[*+?}]\s*$/.test(before.slice(opening + 1, closing))) return false;
      if (index > 0 && /[*+?}]$/.test(pattern.slice(0, index))) return false;
      if (depth > 3) return false;
    }
  }
  return quantifiers <= 32;
}

function invalidMatcher(query: string, regex: boolean, error: string): SafeSearchMatcher {
  return {
    query,
    regex,
    valid: false,
    error,
    test: () => false,
  };
}

export function compileSafeSearch(query: string, options: SafeSearchOptions = {}): SafeSearchMatcher {
  const normalized = query.trim();
  const regex = options.regex === true;
  const maxLength = options.maxLength ?? MAX_PROXY_REGEX_LENGTH;
  if (!normalized) {
    return { query: normalized, regex, valid: true, test: () => true };
  }
  if (!regex) {
    const lower = normalized.toLocaleLowerCase();
    return {
      query: normalized,
      regex: false,
      valid: true,
      test: (value) => value.toLocaleLowerCase().includes(lower),
    };
  }
  if (normalized.length > maxLength || normalized.length > MAX_PROXY_REGEX_LENGTH) {
    return invalidMatcher(normalized, true, `正则表达式不能超过 ${Math.min(maxLength, MAX_PROXY_REGEX_LENGTH)} 个字符`);
  }
  if (!isSafeProxyRegex(normalized)) return invalidMatcher(normalized, true, "正则表达式可能造成性能风险");
  try {
    const expression = new RegExp(normalized, "iu");
    return {
      query: normalized,
      regex: true,
      valid: true,
      expression,
      test: (value) => expression.test(value),
    };
  } catch (error) {
    return invalidMatcher(normalized, true, `正则表达式无效：${error instanceof Error ? error.message : "编译失败"}`);
  }
}

export const compileProxySearch = compileSafeSearch;

export function matchesSearch(value: string, queryOrMatcher: string | SafeSearchMatcher, options?: SafeSearchOptions): boolean {
  const matcher = typeof queryOrMatcher === "string" ? compileSafeSearch(queryOrMatcher, options) : queryOrMatcher;
  return matcher.valid && matcher.test(value);
}

export function proxySearchError(query: string, options: SafeSearchOptions = {}): string | undefined {
  return compileSafeSearch(query, options).error;
}
