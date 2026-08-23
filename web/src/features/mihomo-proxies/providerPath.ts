export function sanitizeProxyProviderName(name: string) {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[\/\\ :|]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "provider";
}

export function suggestedProxyProviderPath(name: string) {
  return `./proxy_providers/${sanitizeProxyProviderName(name)}.yaml`;
}
