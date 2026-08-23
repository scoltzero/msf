/** YAML safety checks used before structured rule-provider saves. */

export type YamlUnsafeFeature = "anchor" | "alias" | "merge-key";

export type YamlSafetyResult = {
  safe: boolean;
  features: YamlUnsafeFeature[];
  message?: string;
};

function withoutComments(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => {
      let quoted = false;
      let quote = "";
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if ((character === "'" || character === '"') && line[index - 1] !== "\\") {
          if (!quoted) { quoted = true; quote = character; }
          else if (quote === character) quoted = false;
        }
        if (character === "#" && !quoted) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}
export function detectYamlUnsafeFeatures(value: string): YamlUnsafeFeature[] {
  const source = withoutComments(value);
  const features = new Set<YamlUnsafeFeature>();
  if (/(^|[\s,:\[{])&[A-Za-z0-9_-]+(?=\s|$|[,\]}])/.test(source)) features.add("anchor");
  if (/(^|[\s,:\[{])\*[A-Za-z0-9_-]+(?=\s|$|[,\]}])/.test(source)) features.add("alias");
  if (/(^|\n)\s*<<\s*:/.test(source)) features.add("merge-key");
  return Array.from(features);
}

export function checkYamlSafety(value: string): YamlSafetyResult {
  const features = detectYamlUnsafeFeatures(value);
  return {
    safe: features.length === 0,
    features,
    message: features.length ? "该区域包含 YAML 锚点或别名，请使用 YAML 编辑模式" : undefined,
  };
}

export function hasYamlAnchorsAliasesOrMerge(value: string): boolean {
  return !checkYamlSafety(value).safe;
}

export function formatYamlUnsafeFeatures(features: readonly YamlUnsafeFeature[]): string {
  const labels: Record<YamlUnsafeFeature, string> = { anchor: "anchor", alias: "alias", "merge-key": "merge key" };
  return features.map((item) => labels[item]).join("、");
}
