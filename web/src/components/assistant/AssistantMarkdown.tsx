import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function splitTrailingJson(content: string): { markdown: string; json: unknown | null } {
  let attempts = 0;
  for (let index = 0; index < content.length && attempts < 64; index += 1) {
    const char = content[index];
    if (char !== "{" && char !== "[") continue;
    const previous = index > 0 ? content[index - 1] : "\n";
    if (index > 0 && previous !== "\n" && previous !== ":" && !/\s/.test(previous)) continue;
    attempts += 1;
    const candidate = content.slice(index).trim();
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return { markdown: content.slice(0, index).trimEnd(), json: parsed };
    } catch {
      // Try the next plausible JSON boundary.
    }
  }
  return { markdown: content, json: null };
}

function safeMarkdownUrl(url: string) {
  const value = url.trim();
  if (/^(https?:|mailto:|#)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "";
}

export function AssistantMarkdown({ content }: { content: string }) {
  const parsed = splitTrailingJson(content);
  return (
    <div className="assistant-panel__markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ children, href, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="assistant-panel__markdown-image">[图片：{alt || "未命名"}]</span>,
        }}
      >
        {parsed.markdown}
      </ReactMarkdown>
      {parsed.json !== null ? (
        <details className="assistant-panel__raw-data">
          <summary>查看原始数据</summary>
          <pre><code>{JSON.stringify(parsed.json, null, 2)}</code></pre>
        </details>
      ) : null}
    </div>
  );
}
