export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the API but deny access; try the HTTP fallback.
    }
  }
  const focused = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("复制失败，请检查浏览器剪贴板权限");
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
