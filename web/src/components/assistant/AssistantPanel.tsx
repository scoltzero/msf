import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type UIEvent } from "react";
import { Blocks, Check, History, Loader2, Maximize2, Minimize2, Plus, Send, Square, X } from "lucide-react";
import { api } from "@/lib/api";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { cn } from "@/lib/utils";
import { deleteAssistantSkill, listAssistantSessions, listAssistantSkills, loadAssistantSession } from "@/features/assistant/api";
import type { AssistantExecutionMode, AssistantSkill } from "@/features/assistant/types";
import { assistantReducer, initialAssistantState } from "@/features/assistant/reducer";
import { streamAssistantAction, streamAssistantMessage } from "@/features/assistant/sse";
import { AssistantMarkdown } from "./AssistantMarkdown";

interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  onStateChange?: (state: "idle" | "thinking" | "tool" | "success" | "warning" | "error") => void;
}

function newSessionId() {
  return `assistant-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function SkillSlot({ skill, deleting, onChoose, onDelete }: { skill: AssistantSkill; deleting: boolean; onChoose: (skill: AssistantSkill) => void; onDelete: (skill: AssistantSkill) => void }) {
  return (
    <div className="assistant-panel__skill-card">
      <button type="button" className="assistant-panel__skill-main" onClick={() => onChoose(skill)}>
        <span className="assistant-panel__skill-name">{skill.name}</span>
        <span className="assistant-panel__skill-description">{skill.description}</span>
      </button>
      <button type="button" className="assistant-panel__skill-delete" onClick={() => onDelete(skill)} disabled={deleting} aria-label={`删除 Skill：${skill.name}`} title="删除 Skill">
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function AssistantPanel({ open, onClose, onStateChange }: AssistantPanelProps) {
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState, (value) => ({ ...value, sessionId: newSessionId() }));
  const [input, setInput] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title?: string; updated_at?: string }>>([]);
  const [skills, setSkills] = useState<AssistantSkill[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillError, setSkillError] = useState("");
  const [deletingSkill, setDeletingSkill] = useState("");
  const [executionMode, setExecutionMode] = useState<AssistantExecutionMode>("confirm_writes");
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollTimersRef = useRef(new Map<HTMLElement, number>());

  const showScrollbarWhileMoving = useCallback((event: UIEvent<HTMLElement>) => {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return;
    element.classList.add("assistant-scroll-active");
    const previous = scrollTimersRef.current.get(element);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      element.classList.remove("assistant-scroll-active");
      scrollTimersRef.current.delete(element);
    }, 700);
    scrollTimersRef.current.set(element, timer);
  }, []);

  useEffect(() => () => {
    scrollTimersRef.current.forEach((timer, element) => {
      window.clearTimeout(timer);
      element.classList.remove("assistant-scroll-active");
    });
    scrollTimersRef.current.clear();
  }, []);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillError("");
    try {
      setSkills(await listAssistantSkills());
    } catch (error) {
      setSkillError((error as Error)?.message || "Skill 加载失败");
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    listAssistantSessions().then((items) => setSessions(items)).catch(() => undefined);
    void refreshSkills();
  }, [open, refreshSkills]);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.messages, state.streaming]);

  useEffect(() => {
    if (state.error) onStateChange?.("error");
    else if (state.toolLabel) onStateChange?.("tool");
    else if (state.streaming) onStateChange?.("thinking");
    else onStateChange?.("idle");
  }, [onStateChange, state.error, state.streaming, state.toolLabel]);

  const statusText = useMemo(() => {
    if (state.toolLabel) return `正在执行：${state.toolLabel}`;
    if (state.streaming) return "正在思考";
    return "管理员助手";
  }, [state.streaming, state.toolLabel]);

  if (!open) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || state.streaming || abortRef.current) return;
    setInput("");
    dispatch({ type: "user", content: text });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAssistantMessage(
        { session_id: state.sessionId, text, execution_mode: executionMode, context: { route: window.location.pathname } },
        (event) => dispatch({ type: "event", event }),
        controller.signal,
      );
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") dispatch({ type: "event", event: { type: "error", message: (error as Error)?.message || "助手请求失败" } });
    } finally {
      abortRef.current = null;
      void refreshSkills();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    void api(`/api/v1/assistant/sessions/${encodeURIComponent(state.sessionId)}/stop`, { method: "POST" }).catch(() => undefined);
    dispatch({ type: "stop" });
  };

  const startNew = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      void api(`/api/v1/assistant/sessions/${encodeURIComponent(state.sessionId)}/stop`, { method: "POST" }).catch(() => undefined);
    }
    dispatch({ type: "hydrate", sessionId: newSessionId(), messages: [] });
    setExecutionMode("confirm_writes");
    setHistoryOpen(false);
    setSkillsOpen(false);
  };

  const chooseSkill = (skill: AssistantSkill) => {
    setInput(skill.prompt);
    setSkillsOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeSkill = async (skill: AssistantSkill) => {
    setDeletingSkill(skill.id);
    setSkillError("");
    try {
      await deleteAssistantSkill(skill.id);
      setSkills((items) => items.filter((item) => item.id !== skill.id));
    } catch (error) {
      setSkillError((error as Error)?.message || "Skill 删除失败");
    } finally {
      setDeletingSkill("");
    }
  };

  const loadSession = async (id: string) => {
    try {
      const session = await loadAssistantSession(id);
      dispatch({ type: "hydrate", sessionId: session.id, messages: session.messages || [] });
      setExecutionMode(session.execution_mode || "confirm_writes");
      setHistoryOpen(false);
    } catch {
      // Keep the current session visible when an old history item has expired.
    }
  };

  const resumeApproval = async (decision: "approve" | "reject") => {
    if (!state.approval) return;
    const action = state.approval;
    dispatch({ type: "event", event: { type: "tool_started", name: action.title, method: action.method, path: action.path } });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAssistantAction(action.action_id, { decision }, (event) => dispatch({ type: "event", event }), controller.signal);
      await refreshSkills();
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") dispatch({ type: "event", event: { type: "error", message: (error as Error)?.message || "操作恢复失败" } });
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <aside className={cn("assistant-panel", fullscreen && "assistant-panel--fullscreen")} role="dialog" aria-label="AI 助手" onScrollCapture={showScrollbarWhileMoving}>
      <GlassSurface material="thick" className="assistant-panel__shell">
        <header className="assistant-panel__header">
          <div className="flex min-w-0 items-center gap-2">
            <span className="assistant-panel__mark" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">智能助手</h2>
              <p className="truncate text-xs text-muted-foreground">{statusText}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={startNew} className="assistant-panel__icon" aria-label="新会话" title="新会话"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="assistant-panel__icon" aria-label="会话历史" title="会话历史"><History className="h-4 w-4" /></button>
            <button type="button" onClick={() => setFullscreen((value) => !value)} className="assistant-panel__icon" aria-label="切换全屏" title="切换全屏">{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            <button type="button" onClick={onClose} className="assistant-panel__icon" aria-label="关闭助手" title="关闭"><X className="h-4 w-4" /></button>
          </div>
        </header>

        {historyOpen ? (
          <div className="assistant-panel__history">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground"><span>历史会话</span><button type="button" onClick={startNew} className="text-primary">新会话</button></div>
            {sessions.length ? sessions.map((session) => <button type="button" key={session.id} onClick={() => void loadSession(session.id)} className="assistant-panel__history-item"><span className="truncate">{session.title || "未命名会话"}</span><span className="text-[10px] text-muted-foreground">{session.updated_at ? new Date(session.updated_at).toLocaleDateString() : ""}</span></button>) : <p className="py-4 text-center text-xs text-muted-foreground">暂无历史会话</p>}
          </div>
        ) : null}

        <div ref={listRef} className="assistant-panel__messages" aria-live="polite">
          {state.messages.length === 0 ? <div className="assistant-panel__empty"><div className="assistant-panel__empty-content"><p className="text-sm font-semibold text-foreground">最近使用的 Skills</p><p className="mt-1 text-xs leading-5 text-muted-foreground">点击卡槽填入执行提示。读操作会直接执行；写操作会先等待你确认。</p>{skillsLoading ? <div className="assistant-panel__skills-loading"><Loader2 className="h-4 w-4 animate-spin" />正在加载 Skills</div> : skills.length ? <div className="assistant-panel__skill-slots" aria-label="最近使用的 Skills">{skills.slice(0, 5).map((skill) => <SkillSlot key={skill.id} skill={skill} deleting={deletingSkill === skill.id} onChoose={chooseSkill} onDelete={(item) => void removeSkill(item)} />)}</div> : <div className="assistant-panel__skills-empty">还没有 Skill。点击输入框左侧的 +，或让 AI 保存一个可复用流程。</div>}{skillError ? <p className="assistant-panel__skill-error">{skillError}</p> : null}<p className="assistant-panel__empty-note">对 AI 说“把这套检查保存成 Skill”，确认后会写入你的专属 Skill 目录。</p></div></div> : state.messages.map((message, index) => <div key={`${index}-${message.role}`} className={cn("assistant-panel__message", message.role === "user" ? "assistant-panel__message--user" : "assistant-panel__message--assistant")}>{message.role === "assistant" ? <AssistantMarkdown content={message.content} /> : <div className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</div>}</div>)}
          {state.toolLabel ? <div className="assistant-panel__tool"><Loader2 className="h-3.5 w-3.5 animate-spin" />{state.toolLabel}</div> : null}
          {state.error ? <div className="assistant-panel__error">{state.error}</div> : null}
          {state.approval ? <div className="assistant-panel__approval"><div className="text-sm font-semibold text-foreground">需要确认操作</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{state.approval.title}</p><code className="mt-2 block overflow-x-auto rounded-lg bg-black/5 p-2 text-[11px] dark:bg-white/10">{state.approval.method} {state.approval.path}</code>{state.approval.details ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-2 text-[11px] leading-4 text-muted-foreground dark:bg-white/10">{state.approval.details}</pre> : null}<div className="mt-3 flex gap-2"><button type="button" onClick={() => void resumeApproval("approve")} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Check className="h-3.5 w-3.5" />确认执行</button><button type="button" onClick={() => void resumeApproval("reject")} className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">拒绝</button></div></div> : null}
        </div>

        {skillsOpen ? <section className="assistant-panel__skill-drawer" aria-label="Skill 列表"><div className="assistant-panel__skill-drawer-header"><span><Blocks className="h-4 w-4" />我的 Skills</span><small>全部 {skills.length}</small></div>{skillsLoading ? <div className="assistant-panel__skills-loading"><Loader2 className="h-4 w-4 animate-spin" />正在加载 Skills</div> : skills.length ? <div className="assistant-panel__skill-drawer-list">{skills.map((skill) => <SkillSlot key={skill.id} skill={skill} deleting={deletingSkill === skill.id} onChoose={chooseSkill} onDelete={(item) => void removeSkill(item)} />)}</div> : <div className="assistant-panel__skills-empty">暂无 Skill</div>}<p className="assistant-panel__skill-drawer-help">创建方式：对 AI 说明流程，并要求“保存成 Skill”。</p></section> : null}

        <footer className="assistant-panel__composer">
          <button type="button" onClick={() => setSkillsOpen((value) => !value)} className="assistant-panel__skill-trigger" aria-label="打开 Skills" title="Skills" aria-expanded={skillsOpen}><Plus className="h-3.5 w-3.5" /></button>
          <select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as AssistantExecutionMode)} className={cn("assistant-panel__mode", executionMode === "full_auto" && "assistant-panel__mode--auto")} aria-label="执行模式" title="当前会话执行模式" disabled={state.streaming || Boolean(state.approval)}>
            <option value="read_only">只读</option>
            <option value="confirm_writes">确认</option>
            <option value="full_auto">自动</option>
          </select>
          <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder="例如：检查 MosDNS 状态并分析异常" aria-label="发送给 AI 助手" />
          {state.streaming ? <button type="button" onClick={stop} className="assistant-panel__send" aria-label="停止生成"><Square className="h-4 w-4" /></button> : <button type="button" onClick={() => void send()} disabled={!input.trim()} className="assistant-panel__send" aria-label="发送"><Send className="h-4 w-4" /></button>}
        </footer>
      </GlassSurface>
    </aside>
  );
}
