import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Save, Sparkles, TestTube2 } from "lucide-react";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { getAssistantSettings, testAssistantSettings, updateAssistantSettings } from "@/features/assistant/api";
import type { AssistantSettings } from "@/features/assistant/types";

export function AssistantSettingsCard({ showToast }: { showToast: (message: string) => void }) {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getAssistantSettings().then(setSettings).catch((error) => showToast(error instanceof Error ? error.message : "AI 设置加载失败"));
  }, [showToast]);

  if (!settings) {
    return <GlassSurface material="thick" className="rounded-2xl p-5 text-sm text-muted-foreground">正在加载 AI 助手设置...</GlassSurface>;
  }

  const update = <K extends keyof AssistantSettings>(key: K, value: AssistantSettings[K]) => setSettings((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    setSaving(true);
    try {
      const next = await updateAssistantSettings({ ...settings, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) });
      setSettings(next);
      setApiKey("");
      window.dispatchEvent(new Event("msf-assistant-settings-updated"));
      showToast("AI 助手设置已保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "AI 助手设置保存失败");
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      await testAssistantSettings();
      showToast("AI Provider 调用测试成功");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "AI Provider 调用测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <GlassSurface material="thick" className="rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="h-4.5 w-4.5" /></span>
          <div><h2 className="text-base font-semibold text-foreground">AI 助手</h2><p className="mt-1 text-xs text-muted-foreground">仅管理员可见，通过 MSF API 协助查询和操作。</p></div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-lg font-semibold text-foreground"><input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} className="h-5 w-5 accent-primary" />启用</label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Provider
          <select value={settings.provider} onChange={(event) => update("provider", event.target.value)} className="gary-field h-9 w-full px-2 text-sm text-foreground"><option value="openai_compatible">OpenAI Compatible</option></select>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">模型名称
          <input value={settings.model} onChange={(event) => update("model", event.target.value)} placeholder="例如 deepseek-chat" className="gary-field h-9 w-full px-3 text-sm text-foreground" />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground md:col-span-2">Base URL
          <input value={settings.base_url} onChange={(event) => update("base_url", event.target.value)} placeholder="https://api.example.com/v1" className="gary-field h-9 w-full px-3 text-sm text-foreground" />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground md:col-span-2">API Key
          <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.api_key_set ? "已配置，留空表示不修改" : "输入 API Key"} className="gary-field h-9 w-full px-3 pl-9 text-sm text-foreground" /></div>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-foreground md:col-span-2"><input type="checkbox" checked={settings.orb_enabled} onChange={(event) => update("orb_enabled", event.target.checked)} className="h-4 w-4 accent-primary" />显示玻璃球入口</label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
        <GlassButton variant="primary" onClick={() => void save()} disabled={saving} className="h-9 text-xs"><Save className="h-3.5 w-3.5" />{saving ? "保存中" : "保存设置"}</GlassButton>
        <GlassButton variant="tool" onClick={() => void test()} disabled={testing || !settings.api_key_set} className="h-9 text-xs"><TestTube2 className="h-3.5 w-3.5" />{testing ? "测试中" : "测试 Provider"}</GlassButton>
        {settings.api_key_set ? <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />密钥已配置</span> : null}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs leading-5 text-muted-foreground"><Bot className="h-3.5 w-3.5 shrink-0" />执行模式在助手输入框中按会话选择；所有 API、文件和 Shell 操作均记录审计。</p>
    </GlassSurface>
  );
}
