"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiClient } from "../lib/api-client";
import {
  createResearchSocket,
  sendResumeCommand,
  sendStartCommand,
} from "../lib/ws-client";
import type {
  InterruptPayload,
  ThreadStateResponse,
  WebSocketMessage,
} from "../types/api";

type ConversationStatus = "running" | "pending_human" | "completed" | "error";

interface ConversationMeta {
  id: string;
  title: string;
  status: ConversationStatus;
  startedAt: number;
  lastUpdated: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  title?: string;
  content: string;
  createdAt: number;
}

interface EventStatusUpdate {
  message?: string;
  clear?: boolean;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractEventDetails(
  payload: Record<string, unknown>
): { title?: string; content: string } | null {
  const title = typeof payload.event === "string" ? payload.event : undefined;
  const data = (payload.data as Record<string, unknown> | undefined) ?? undefined;
  const chunk = (data?.chunk ?? {}) as Record<string, unknown> | undefined;
  const delta = (chunk?.delta ?? {}) as Record<string, unknown> | undefined;
  const messages = Array.isArray(chunk?.messages)
    ? (chunk?.messages as Array<Record<string, unknown>>)
    : undefined;

  const firstMessageText = messages
    ?.map((item) => firstNonEmptyString(item?.content))
    .find((text) => text);

  const textCandidate = firstNonEmptyString(
    typeof payload.message === "string" ? payload.message : null,
    typeof data?.output === "string" ? data.output : null,
    typeof data?.message === "string" ? data.message : null,
    typeof data?.text === "string" ? data.text : null,
    typeof chunk?.text === "string" ? chunk.text : null,
    typeof delta?.text === "string" ? delta.text : null,
    typeof delta?.content === "string" ? delta.content : null,
    firstMessageText ?? null
  );

  if (!textCandidate) {
    return null;
  }

  return { title, content: textCandidate };
}

function describeEventStatus(payload: Record<string, unknown>): EventStatusUpdate | null {
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (!eventType) {
    return null;
  }

  const rawName = typeof payload.name === "string" ? payload.name : "";
  const displayName = rawName ? rawName.replace(/[_-]/g, " ") : "";

  const createMessage = (text: string) => ({ message: text });

  switch (eventType) {
    case "on_chain_start":
      return createMessage(
        displayName ? `${displayName} を実行中です...` : "ワークフローを実行中です..."
      );
    case "on_chain_resume":
      return createMessage("ワークフローを再開しています...");
    case "on_chain_end":
      return { clear: true };
    case "on_tool_start":
      return createMessage(
        displayName ? `ツール「${displayName}」を実行中です...` : "ツールを実行中です..."
      );
    case "on_tool_end":
      return { clear: true };
    case "on_llm_start":
      return createMessage("AIに質問しています...");
    case "on_llm_end":
      return { clear: true };
    case "on_retriever_start":
      return createMessage("情報を検索しています...");
    case "on_retriever_end":
      return { clear: true };
    default: {
      const data = payload.data as Record<string, unknown> | undefined;
      const phase = firstNonEmptyString(
        typeof data?.phase === "string" ? data.phase : null,
        typeof data?.status === "string" ? data.status : null
      );
      if (phase) {
        return createMessage(`${phase} を実行中です...`);
      }
      return null;
    }
  }
}

function getRecordValue<T>(
  record: Record<string, unknown> | undefined,
  key: string
): T | undefined {
  const value = record?.[key];
  return value as T | undefined;
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeThreadTitle(query: string | undefined, id: string): string {
  if (query) {
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 30 ? `${trimmed.slice(0, 30)}...` : trimmed;
    }
  }
  return `Thread ${id.slice(0, 8)}`;
}

function formatInterruptContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return safeStringify(value);
}

function statusLabel(status: ConversationStatus): string {
  switch (status) {
    case "running":
      return "進行中";
    case "pending_human":
      return "要判断";
    case "completed":
      return "完了";
    case "error":
      return "エラー";
    default:
      return status;
  }
}

function statusClassName(status: ConversationStatus, active: boolean): string {
  const base =
    "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide";
  if (active) {
    return `${base} bg-emerald-500/20 text-emerald-300`;
  }
  switch (status) {
    case "running":
      return `${base} bg-slate-700/70 text-slate-200`;
    case "pending_human":
      return `${base} bg-amber-500/20 text-amber-200`;
    case "completed":
      return `${base} bg-emerald-500/20 text-emerald-200`;
    case "error":
      return `${base} bg-rose-500/20 text-rose-200`;
    default:
      return `${base} bg-slate-700/70 text-slate-200`;
  }
}

function formatPlanDraft(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return safeStringify(value);
  }
  return "";
}

export default function Home() {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingQueryRef = useRef<string>("");
  const activeThreadRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);

  const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  const [pendingInterrupts, setPendingInterrupts] = useState<Record<string, InterruptPayload | null>>({});
  const [threadStates, setThreadStates] = useState<Record<string, ThreadStateResponse>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [planDrafts, setPlanDrafts] = useState<Record<string, string>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "ok" | "error">(
    "loading"
  );
  const [activeSteps, setActiveSteps] = useState<Record<string, string>>({});

  const threadList = useMemo(
    () =>
      Object.values(conversations).sort(
        (a, b) => b.lastUpdated - a.lastUpdated
      ),
    [conversations]
  );
  const effectiveThreadId =
    activeThreadId ?? (threadList.length > 0 ? threadList[0].id : null);

  const selectedConversation = effectiveThreadId
    ? conversations[effectiveThreadId]
    : undefined;
  const selectedMessages = effectiveThreadId
    ? messagesByThread[effectiveThreadId] ?? []
    : [];
  const currentState = effectiveThreadId
    ? threadStates[effectiveThreadId]
    : undefined;
  const currentInterrupt = effectiveThreadId
    ? pendingInterrupts[effectiveThreadId] ?? null
    : null;
  const planDraft = effectiveThreadId
    ? planDrafts[effectiveThreadId] ?? ""
    : "";

  const refreshThreadState = useCallback(async (threadId: string) => {
    try {
      const state = await apiClient.getThreadState(threadId);
      setThreadStates((prev) => ({ ...prev, [threadId]: state }));
      return state;
    } catch (error) {
      console.error("[ui] Failed to fetch thread state", error);
      return undefined;
    }
  }, []);

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    setMessagesByThread((prev) => {
      const nextMessages = prev[threadId] ? [...prev[threadId], message] : [message];
      return { ...prev, [threadId]: nextMessages };
    });
    setConversations((prev) => {
      const existing = prev[threadId];
      if (!existing) {
        return prev;
      }
      return {
        ...prev,
        [threadId]: { ...existing, lastUpdated: message.createdAt },
      };
    });
  }, []);

  const ensureConversation = useCallback(
    (threadId: string, title: string | undefined, status: ConversationStatus) => {
      const now = Date.now();
      setConversations((prev) => {
        const existing = prev[threadId];
        const conversation: ConversationMeta = existing
          ? {
            ...existing,
            title: title ?? existing.title,
            status:
              existing.status === "completed" && status !== "completed"
                ? existing.status
                : status,
            lastUpdated: now,
          }
          : {
            id: threadId,
            title: makeThreadTitle(title, threadId),
            status,
            startedAt: now,
            lastUpdated: now,
          };
        return { ...prev, [threadId]: conversation };
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    apiClient
      .health()
      .then(() => {
        if (!cancelled) {
          setHealthStatus("ok");
        }
      })
      .catch((error) => {
        console.error("[ui] health check failed", error);
        if (!cancelled) {
          setHealthStatus("error");
          setErrorMessage((prev) => prev ?? "APIへの接続に失敗しました。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncThreads = async () => {
      try {
        const listing = await apiClient.listThreads();
        if (cancelled) {
          return;
        }
        setErrorMessage((prev) => (prev === "APIへの接続に失敗しました。" ? null : prev));

        setConversations((prev) => {
          const now = Date.now();
          const next: Record<string, ConversationMeta> = { ...prev };

          const updateStatus = (id: string, status: ConversationStatus) => {
            const existing = next[id];
            if (existing) {
              const keepStatus =
                existing.status === "completed" && status !== "completed"
                  ? existing.status
                  : status;
              next[id] = { ...existing, status: keepStatus, lastUpdated: now };
              return;
            }
            next[id] = {
              id,
              title: makeThreadTitle(undefined, id),
              status,
              startedAt: now,
              lastUpdated: now,
            };
          };

          listing.active_thread_ids.forEach((id) => updateStatus(id, "running"));
          listing.pending_interrupt_ids.forEach((id) =>
            updateStatus(id, "pending_human")
          );
          return next;
        });

        listing.pending_interrupt_ids.forEach((id) => {
          if (!cancelled) {
            refreshThreadState(id);
          }
        });
      } catch (error) {
        console.error("[ui] failed to fetch threads", error);
        if (!cancelled) {
          setErrorMessage((prev) => prev ?? "APIへの接続に失敗しました。");
        }
      }
    };

    syncThreads();
    const timer = window.setInterval(syncThreads, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshThreadState]);

  useEffect(() => () => {
    socketRef.current?.close();
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isConnecting) {
        return;
      }
      const query = inputValue.trim();
      if (!query) {
        return;
      }

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const previousThreadId = activeThreadRef.current;
        if (previousThreadId) {
          setActiveSteps((prev) => {
            const next = { ...prev };
            delete next[previousThreadId];
            return next;
          });
        }
        socketRef.current.close(1000, "new-session");
      }

      pendingQueryRef.current = query;
      setInputValue("");
      setErrorMessage(null);
      setIsConnecting(true);

      const socket = createResearchSocket({
        onOpen: () => {
          try {
            sendStartCommand(socket, { query });
          } catch (error) {
            console.error("[ui] failed to send start command", error);
            setErrorMessage("リサーチの開始に失敗しました。");
            setIsConnecting(false);
          }
        },
        onMessage: async (message: WebSocketMessage) => {
          if (message.type === "thread_started") {
            const now = Date.now();
            const title = makeThreadTitle(pendingQueryRef.current, message.thread_id);
            ensureConversation(message.thread_id, title, "running");
            appendMessage(message.thread_id, {
              id: `user-${now}`,
              role: "user",
              content: pendingQueryRef.current,
              createdAt: now,
            });
            appendMessage(message.thread_id, {
              id: `system-${now + 1}`,
              role: "system",
              content: "リサーチを開始しました。",
              createdAt: now + 1,
            });
            pendingQueryRef.current = "";
            setActiveThreadId(message.thread_id);
            activeThreadRef.current = message.thread_id;
            setIsConnecting(false);
            setActiveSteps((prev) => ({
              ...prev,
              [message.thread_id]: "リサーチを準備中です...",
            }));
            return;
          }

          if (!message.thread_id) {
            return;
          }

          if (message.type === "event") {
            const statusUpdate = describeEventStatus(message.payload);
            if (statusUpdate) {
              setActiveSteps((prev) => {
                const next = { ...prev };
                if (statusUpdate.clear) {
                  delete next[message.thread_id];
                } else if (statusUpdate.message) {
                  next[message.thread_id] = statusUpdate.message;
                }
                return next;
              });
            }

            const details = extractEventDetails(message.payload);
            if (details) {
              const createdAt = Date.now();
              appendMessage(message.thread_id, {
                id: `event-${createdAt}`,
                role: "assistant",
                title: details.title,
                content: details.content,
                createdAt,
              });
            }
            return;
          }

          if (message.type === "interrupt") {
            const interrupt = message.interrupt;
            const createdAt = Date.now();
            ensureConversation(message.thread_id, undefined, "pending_human");
            appendMessage(message.thread_id, {
              id: `interrupt-${createdAt}`,
              role: "system",
              content: formatInterruptContent(interrupt.value),
              createdAt,
            });
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            setPendingInterrupts((prev) => ({
              ...prev,
              [message.thread_id]: interrupt,
            }));
            const snapshot = await refreshThreadState(message.thread_id);
            const plan = formatPlanDraft(
              getRecordValue<unknown>(snapshot?.state, "research_plan") ??
              interrupt.value
            );
            setPlanDrafts((prev) => ({
              ...prev,
              [message.thread_id]: plan,
            }));
            setEditingThreadId(null);
            setPlanError(null);
            return;
          }

          if (message.type === "complete") {
            ensureConversation(message.thread_id, undefined, "completed");
            appendMessage(message.thread_id, {
              id: `complete-${Date.now()}`,
              role: "assistant",
              content: "リサーチが完了しました。",
              createdAt: Date.now(),
            });
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            setPendingInterrupts((prev) => ({
              ...prev,
              [message.thread_id]: null,
            }));
            const state: ThreadStateResponse = {
              thread_id: message.thread_id,
              status: "completed",
              state: message.state,
              pending_interrupt: null,
            };
            setThreadStates((prev) => ({
              ...prev,
              [message.thread_id]: state,
            }));
            setEditingThreadId(null);
            setPlanError(null);
            return;
          }

          if (message.type === "error") {
            const targetId = message.thread_id ?? activeThreadRef.current;
            if (targetId) {
              ensureConversation(targetId, undefined, "error");
              appendMessage(targetId, {
                id: `error-${Date.now()}`,
                role: "system",
                content: message.message,
                createdAt: Date.now(),
              });
              setActiveSteps((prev) => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
            }
            setErrorMessage(message.message);
          }
        },
        onError: (event: Event) => {
          console.error("[ui] websocket error", event);
          setErrorMessage("WebSocket接続でエラーが発生しました。");
        },
        onClose: () => {
          const threadId = activeThreadRef.current;
          if (threadId) {
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[threadId];
              return next;
            });
          }
          socketRef.current = null;
          activeThreadRef.current = null;
          setIsConnecting(false);
        },
      });

      socketRef.current = socket;
    },
    [appendMessage, ensureConversation, inputValue, isConnecting, refreshThreadState]
  );

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
      setEditingThreadId(null);
      setPlanError(null);
      refreshThreadState(threadId);
    },
    [refreshThreadState]
  );

  const handlePlanDecision = useCallback(
    (decision: "y" | "n") => {
      const threadId = effectiveThreadId;
      if (!threadId) {
        return;
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setErrorMessage("WebSocketが接続されていません。");
        return;
      }
      if (activeThreadRef.current !== threadId) {
        setErrorMessage("このスレッドは現在のセッションで操作できません。");
        return;
      }

      if (decision === "n") {
        sendResumeCommand(socket, { decision: "n" });
        appendMessage(threadId, {
          id: `decision-${Date.now()}`,
          role: "user",
          content: "この計画で進行します。",
          createdAt: Date.now(),
        });
        setEditingThreadId(null);
        setPlanError(null);
        setPendingInterrupts((prev) => ({
          ...prev,
          [threadId]: null,
        }));
        setActiveSteps((prev) => ({
          ...prev,
          [threadId]: "リサーチを再開しています...",
        }));
        return;
      }

      const draft = planDrafts[threadId] ?? "";
      if (!draft.trim()) {
        setPlanError("調査計画の内容を入力してください。");
        return;
      }
      try {
        const parsed = JSON.parse(draft);
        sendResumeCommand(socket, { decision: "y", plan: parsed });
        appendMessage(threadId, {
          id: `decision-${Date.now()}`,
          role: "user",
          content: "計画を更新しました。",
          createdAt: Date.now(),
        });
        setPlanError(null);
        setEditingThreadId(null);
        setPendingInterrupts((prev) => ({
          ...prev,
          [threadId]: null,
        }));
        setActiveSteps((prev) => ({
          ...prev,
          [threadId]: "リサーチを再開しています...",
        }));
      } catch (error) {
        console.error("[ui] failed to parse plan", error);
        setPlanError("JSON形式で入力してください。");
      }
    },
    [appendMessage, effectiveThreadId, planDrafts]
  );

  const healthIndicatorClass =
    healthStatus === "ok"
      ? "bg-emerald-400"
      : healthStatus === "error"
        ? "bg-rose-400"
        : "bg-slate-500 animate-pulse";

  const researchPlan = getRecordValue<unknown>(currentState?.state, "research_plan");
  const researchReport = getRecordValue<unknown>(currentState?.state, "research_report");
  const hasResearchPlan = researchPlan !== undefined && researchPlan !== null;
  const hasResearchReport = researchReport !== undefined && researchReport !== null;
  const activeStepMessage = effectiveThreadId ? activeSteps[effectiveThreadId] : undefined;

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    selectedMessages.length,
    currentInterrupt,
    hasResearchPlan,
    hasResearchReport,
    selectedConversation?.status,
    effectiveThreadId,
  ]);

  const showExecutionIndicator =
    selectedConversation?.status === "running" && !currentInterrupt;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="hidden h-full w-80 flex-col overflow-hidden border-r border-slate-900/80 bg-slate-900/60 md:flex">
        <div className="border-b border-slate-800 px-6 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">DeepReSearch Console</h1>
            <span className={`h-2 w-2 rounded-full ${healthIndicatorClass}`} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {healthStatus === "ok"
              ? "バックエンドと接続済み"
              : healthStatus === "error"
                ? "バックエンドに接続できません"
                : "接続を確認中"}
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.focus()}
            className="mt-5 w-full rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800"
          >
            新しいリサーチを作成
          </button>
        </div>
        <div className="flex-1 px-3 py-4">
          {threadList.length === 0 ? (
            <p className="px-3 text-xs text-slate-500">
              リサーチ履歴がまだありません。
            </p>
          ) : (
            threadList.map((thread) => {
              const isActive = effectiveThreadId === thread.id;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleSelectThread(thread.id)}
                  className={`mb-2 w-full rounded-xl border px-4 py-3 text-left transition-colors last:mb-0 ${isActive
                    ? "border-slate-700 bg-slate-800/80"
                    : "border-transparent bg-transparent hover:border-slate-800 hover:bg-slate-900/60"
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {thread.title}
                    </p>
                    <span className={statusClassName(thread.status, isActive)}>
                      {statusLabel(thread.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatTimestamp(thread.lastUpdated)}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-slate-900/70 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                {selectedConversation?.title ?? "Deep Research"}
              </h2>
              <p className="text-sm text-slate-400">
                {selectedConversation
                  ? `ステータス: ${statusLabel(selectedConversation.status)}`
                  : "左の一覧からスレッドを選択するか、新しいリサーチを開始してください。"}
              </p>
            </div>
            {selectedConversation && (
              <span className={statusClassName(selectedConversation.status, false)}>
                {statusLabel(selectedConversation.status)}
              </span>
            )}
          </div>
          {errorMessage && (
            <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
              {errorMessage}
            </p>
          )}
        </header>
        <section ref={chatScrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-4">
            {selectedMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800/80 bg-slate-900/40 px-6 py-10 text-center text-sm text-slate-500">
                ここにリサーチの進行ログが表示されます。
              </div>
            ) : (
              selectedMessages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-3xl rounded-2xl border px-5 py-4 ${message.role === "user"
                    ? "self-end border-emerald-500/30 bg-emerald-500/10 text-right"
                    : message.role === "assistant"
                      ? "border-slate-800 bg-slate-900/70"
                      : "border-amber-500/40 bg-amber-500/10"
                    }`}
                >
                  {message.title && (
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {message.title}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>
                  <p className="mt-3 text-right text-[11px] uppercase tracking-wide text-slate-500">
                    {formatTimestamp(message.createdAt)}
                  </p>
                </div>
              ))
            )}

            {showExecutionIndicator && (
              <div className="flex items-center gap-3 self-start rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 text-sm text-slate-200">
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-r-transparent" />
                <div className="space-y-1">
                  <p>{activeStepMessage ?? "リサーチを実行中です..."}</p>
                  <p className="text-xs text-slate-400">完了までお待ちください。</p>
                </div>
              </div>
            )}

            {currentInterrupt && (
              <div className="max-w-3xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
                <h3 className="text-sm font-semibold text-amber-200">
                  調査計画の確認が求められています
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-amber-100/90">
                  {formatInterruptContent(currentInterrupt.value)}
                </p>
                {editingThreadId === effectiveThreadId ? (
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handlePlanDecision("y");
                    }}
                  >
                    <textarea
                      value={planDraft}
                      onChange={(event) => {
                        if (!effectiveThreadId) {
                          return;
                        }
                        setPlanDrafts((prev) => ({
                          ...prev,
                          [effectiveThreadId]: event.target.value,
                        }));
                      }}
                      className="h-48 w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                      placeholder="JSON形式で調査計画を入力してください"
                    />
                    {planError && (
                      <p className="text-xs text-rose-200">{planError}</p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        className="rounded-lg border border-amber-400/60 bg-amber-400/20 px-4 py-2 text-sm font-medium text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-400/30"
                      >
                        更新して再開
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingThreadId(null);
                          setPlanError(null);
                        }}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900"
                      >
                        キャンセル
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handlePlanDecision("n")}
                      className="rounded-lg border border-emerald-400/60 bg-emerald-400/20 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-300 hover:bg-emerald-400/30"
                    >
                      この計画で進行
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!effectiveThreadId) {
                          return;
                        }
                        const plan = formatPlanDraft(
                          researchPlan ?? currentInterrupt.value
                        );
                        setPlanDrafts((prev) => ({
                          ...prev,
                          [effectiveThreadId]: plan,
                        }));
                        setEditingThreadId(effectiveThreadId);
                        setPlanError(null);
                      }}
                      className="rounded-lg border border-amber-400/60 bg-slate-900/80 px-4 py-2 text-sm text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-500/20"
                    >
                      計画を編集
                    </button>
                  </div>
                )}
              </div>
            )}

            {hasResearchPlan && (
              <div className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <h3 className="text-sm font-semibold text-slate-200">現行の調査計画</h3>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                  {safeStringify(researchPlan)}
                </pre>
              </div>
            )}

            {hasResearchReport && (
              <div className="max-w-3xl rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
                <h3 className="text-sm font-semibold text-emerald-200">レポート</h3>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950/60 px-4 py-3 text-xs text-emerald-100">
                  {safeStringify(researchReport)}
                </pre>
              </div>
            )}
          </div>
        </section>
        <footer className="shrink-0 border-t border-slate-900/70 px-6 py-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Deep Research クエリ
            </label>
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              rows={3}
              placeholder="調査したい内容を入力してください"
              className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 shadow-inner focus:border-emerald-400 focus:outline-none"
              disabled={isConnecting}
            />
            <div className="flex items-center justify-between">
              <div className="flex-1" />
              <button
                type="submit"
                disabled={isConnecting || inputValue.trim().length === 0}
                className="inline-flex items-center justify-center rounded-xl border border-emerald-500 bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500 hover:border-emerald-400 hover:bg-emerald-400"
              >
                {isConnecting ? "接続中..." : "リサーチ開始"}
              </button>
            </div>
          </form>
        </footer>
      </main>
    </div>
  );
}
