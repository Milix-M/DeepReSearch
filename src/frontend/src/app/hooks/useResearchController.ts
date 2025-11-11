import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiClient } from "../../lib/api-client";
import {
  createResearchSocket,
  sendResumeCommand,
  sendStartCommand,
} from "../../lib/ws-client";
import type {
  InterruptPayload,
  ThreadListResponse,
  ThreadStateResponse,
  WebSocketMessage,
} from "../../types/api";
import type {
  ChatMessage,
  ConversationMeta,
  ConversationStatus,
  ResearchInsightState,
  ResearchPlanFormState,
} from "../types";
import {
  buildInsightContent,
  describeEventStatus,
  extractEventDetails,
  extractResearchInsight,
  formatInterruptContent,
  getRecordValue,
  humanizeIdentifier,
  makeThreadTitle,
  normalizeReportContent,
} from "../utils/chat-helpers";
import {
  clonePlanForm,
  createEmptyPlanForm,
  createEmptySection,
  parsePlanValue,
  serializePlanForm,
  validatePlanForm,
} from "../utils/plan-form";

const THREAD_TITLE_STORAGE_KEY = "deep-research:thread-titles";
const INSIGHT_MESSAGE_PREFIX = "insight-log-";
const INTERRUPT_MESSAGE_PREFIX = "interrupt-";

interface ResearchControllerResult {
  threadList: ConversationMeta[];
  effectiveThreadId: string | null;
  selectedConversation: ConversationMeta | undefined;
  selectedMessages: ChatMessage[];
  currentInterrupt: InterruptPayload | null;
  editablePlan: ResearchPlanFormState;
  planError: string | null;
  healthStatus: "loading" | "ok" | "error";
  errorMessage: string | null;
  inputValue: string;
  isConnecting: boolean;
  executionMessage: string | null;
  displayPlan: ResearchPlanFormState | null;
  reportContent: { markdown: string | null; fallback: string | null };
  messagesBeforeInterrupt: ChatMessage[];
  messagesAfterInterrupt: ChatMessage[];
  messagesBeforeDecision: ChatMessage[];
  messagesAfterDecision: ChatMessage[];
  isEditingPlan: boolean;
  overallProgress: {
    completed: number;
    total: number;
    steps: { label: string; done: boolean }[];
  } | null;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleSelectThread: (threadId: string) => void;
  beginNewThread: () => void;
  handlePlanDecision: (decision: "y" | "n") => void;
  startPlanEditing: () => void;
  cancelPlanEditing: () => void;
  addPlanSection: () => void;
  removePlanSection: (index: number) => void;
  changePlan: (updater: (draft: ResearchPlanFormState) => void) => void;
  resetPlanError: () => void;
  setInputValue: (value: string) => void;
}

function loadThreadTitlesFromStorage(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(THREAD_TITLE_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
              acc[key] = trimmed;
            }
          }
          return acc;
        },
        {}
      );
    }
  } catch (error) {
    console.warn("[ui] Failed to load thread titles from storage", error);
  }

  return {};
}

let messageCounter = 0;

function nextMessageId(prefix: string): string {
  messageCounter += 1;
  return `${prefix}-${Date.now()}-${messageCounter}`;
}

export function useResearchController(): ResearchControllerResult {
  const socketRef = useRef<WebSocket | null>(null);
  const pendingQueryRef = useRef<string>("");
  const activeThreadRef = useRef<string | null>(null);

  const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  const [pendingInterrupts, setPendingInterrupts] = useState<Record<string, InterruptPayload | null>>({});
  const [threadStates, setThreadStates] = useState<Record<string, ThreadStateResponse>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [inputValue, setInputValueState] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [planForms, setPlanForms] = useState<Record<string, ResearchPlanFormState>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activeSteps, setActiveSteps] = useState<Record<string, string>>({});
  const [isDraftingNewThread, setIsDraftingNewThread] = useState(false);
  const [threadTitles, setThreadTitles] = useState<Record<string, string>>(() =>
    loadThreadTitlesFromStorage()
  );
  const threadTitlesRef = useRef<Record<string, string>>(threadTitles);
  const [, setInsights] = useState<Record<string, ResearchInsightState>>({});

  const threadList = useMemo(
    () =>
      Object.values(conversations).sort(
        (a, b) => b.lastUpdated - a.lastUpdated
      ),
    [conversations]
  );
  const effectiveThreadId = useMemo(() => {
    if (isDraftingNewThread) {
      return null;
    }
    return activeThreadId ?? (threadList.length > 0 ? threadList[0].id : null);
  }, [activeThreadId, isDraftingNewThread, threadList]);

  const selectedConversation = effectiveThreadId ? conversations[effectiveThreadId] : undefined;
  const selectedMessages = effectiveThreadId ? messagesByThread[effectiveThreadId] ?? [] : [];
  const currentState = effectiveThreadId ? threadStates[effectiveThreadId] : undefined;
  const currentInterrupt = effectiveThreadId ? pendingInterrupts[effectiveThreadId] ?? null : null;
  const activePlanForm = effectiveThreadId ? planForms[effectiveThreadId] ?? null : null;
  const editablePlan = activePlanForm ?? createEmptyPlanForm();

  useEffect(() => {
    threadTitlesRef.current = threadTitles;
  }, [threadTitles]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(THREAD_TITLE_STORAGE_KEY, JSON.stringify(threadTitles));
    } catch (error) {
      console.warn("[ui] Failed to persist thread titles", error);
    }
  }, [threadTitles]);

  const rememberTitle = useCallback((threadId: string, rawTitle: string) => {
    const trimmed = rawTitle.trim();
    if (!trimmed) {
      return;
    }
    setThreadTitles((prev) => {
      if (prev[threadId] === trimmed) {
        return prev;
      }
      return { ...prev, [threadId]: trimmed };
    });
  }, []);

  const resolveConversationTitle = useCallback(
    (threadId: string, rawTitle?: string) => {
      const candidate = rawTitle?.trim() || threadTitlesRef.current[threadId] || "";
      if (candidate) {
        return makeThreadTitle(candidate, threadId);
      }
      return makeThreadTitle(undefined, threadId);
    },
    []
  );

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

  const applyInsightMessage = useCallback(
    (threadId: string, insight: ResearchInsightState | null) => {
      const messageId = `${INSIGHT_MESSAGE_PREFIX}${threadId}`;
      const timestamp = insight?.lastUpdated ?? Date.now();

      setMessagesByThread((prev) => {
        const currentMessages = prev[threadId] ?? [];
        const insightIndex = currentMessages.findIndex((message) => message.id === messageId);

        if (!insight || (!insight.currentPage && !insight.reasoning)) {
          if (insightIndex === -1) {
            return prev;
          }
          const nextMessages = [...currentMessages];
          nextMessages.splice(insightIndex, 1);
          return { ...prev, [threadId]: nextMessages };
        }

        const insightDisplay = buildInsightContent(insight);
        const nextMessage: ChatMessage = {
          id: messageId,
          role: "assistant",
          title: "リサーチ進行状況",
          content: insightDisplay.content,
          reasoning: insightDisplay.reasoning,
          createdAt: timestamp,
        };

        const nextMessages =
          insightIndex === -1
            ? [...currentMessages, nextMessage]
            : currentMessages.map((message, index) =>
                index === insightIndex ? nextMessage : message
              );

        return { ...prev, [threadId]: nextMessages };
      });

      if (insight && (insight.currentPage || insight.reasoning)) {
        setConversations((prev) => {
          const existing = prev[threadId];
          if (!existing || existing.lastUpdated >= timestamp) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: { ...existing, lastUpdated: timestamp },
          };
        });
      }
    },
    []
  );

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    let didAppend = false;
    setMessagesByThread((prev) => {
      const currentMessages = prev[threadId] ?? [];
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (
        lastMessage &&
        lastMessage.role === message.role &&
        lastMessage.title === message.title &&
        lastMessage.content === message.content
      ) {
        return prev;
      }
      didAppend = true;
      const nextMessages = [...currentMessages, message];
      return { ...prev, [threadId]: nextMessages };
    });
    if (didAppend) {
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
    }
  }, []);

  const ensureConversation = useCallback(
    (threadId: string, rawTitle: string | undefined, status: ConversationStatus) => {
      const now = Date.now();
      if (rawTitle) {
        rememberTitle(threadId, rawTitle);
      }
      const displayTitle = resolveConversationTitle(threadId, rawTitle);
      setConversations((prev) => {
        const existing = prev[threadId];
        const conversation: ConversationMeta = existing
          ? {
              ...existing,
              title: displayTitle,
              status:
                existing.status === "completed" && status !== "completed"
                  ? existing.status
                  : status,
              lastUpdated: now,
            }
          : {
              id: threadId,
              title: displayTitle,
              status,
              startedAt: now,
              lastUpdated: now,
            };
        return { ...prev, [threadId]: conversation };
      });
    },
    [rememberTitle, resolveConversationTitle]
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
  .catch((error: unknown) => {
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
  const listing: ThreadListResponse = await apiClient.listThreads();
        if (cancelled) {
          return;
        }
        setErrorMessage((prev) => (prev === "APIへの接続に失敗しました。" ? null : prev));

        setConversations((prev) => {
          const now = Date.now();
          const next: Record<string, ConversationMeta> = { ...prev };

          const updateStatus = (id: string, status: ConversationStatus) => {
            const existing = next[id];
            const title = resolveConversationTitle(id);
            if (existing) {
              const keepStatus =
                existing.status === "completed" && status !== "completed"
                  ? existing.status
                  : status;
              next[id] = {
                ...existing,
                title,
                status: keepStatus,
                lastUpdated: now,
              };
              return;
            }
            next[id] = {
              id,
              title,
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
      } catch (error: unknown) {
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
  }, [refreshThreadState, resolveConversationTitle]);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    []
  );

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
      setInputValueState("");
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
            const queryText = pendingQueryRef.current;
            ensureConversation(message.thread_id, queryText, "running");
            appendMessage(message.thread_id, {
              id: nextMessageId("user"),
              role: "user",
              content: queryText,
              createdAt: now,
            });
            appendMessage(message.thread_id, {
              id: nextMessageId("system"),
              role: "system",
              content: "リサーチを開始しました。",
              createdAt: now + 1,
            });
            pendingQueryRef.current = "";
            setIsDraftingNewThread(false);
            setActiveThreadId(message.thread_id);
            activeThreadRef.current = message.thread_id;
            setIsConnecting(false);
            setActiveSteps((prev) => ({
              ...prev,
              [message.thread_id]: "調査計画を作成しています...",
            }));
            setInsights((prev) => {
              if (!prev[message.thread_id]) {
                return prev;
              }
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            applyInsightMessage(message.thread_id, null);
            return;
          }

          if (!message.thread_id) {
            return;
          }

          if (message.type === "event") {
            const threadId = message.thread_id;
            const statusUpdate = describeEventStatus(message.payload);
            let progressContent: string | null = null;
            let shouldLogProgress = false;
            if (statusUpdate) {
              setActiveSteps((prev) => {
                const next = { ...prev };
                if (statusUpdate.clear) {
                  delete next[threadId];
                } else if (statusUpdate.message) {
                  next[threadId] = statusUpdate.message;
                }
                return next;
              });
              if (statusUpdate.message) {
                progressContent = statusUpdate.message;
                shouldLogProgress = statusUpdate.log !== false;
              }
            }

            const insightDelta = extractResearchInsight(message.payload);
            if (insightDelta) {
              let updatedInsight: ResearchInsightState | null | undefined;
              setInsights((prev) => {
                const current = prev[threadId];
                const now = Date.now();

                const nextInsight: ResearchInsightState = {
                  currentPage:
                    insightDelta.currentPage !== undefined
                      ? insightDelta.currentPage
                      : current?.currentPage,
                  reasoning:
                    insightDelta.reasoning !== undefined
                      ? insightDelta.reasoning
                      : current?.reasoning,
                  lastUpdated: now,
                };

                const shouldRemove = !nextInsight.currentPage && !nextInsight.reasoning;
                if (shouldRemove) {
                  if (!current) {
                    updatedInsight = undefined;
                    return prev;
                  }
                  const next = { ...prev };
                  delete next[threadId];
                  updatedInsight = null;
                  return next;
                }

                if (
                  current &&
                  current.currentPage === nextInsight.currentPage &&
                  current.reasoning === nextInsight.reasoning
                ) {
                  updatedInsight = undefined;
                  return prev;
                }

                updatedInsight = nextInsight;
                return { ...prev, [threadId]: nextInsight };
              });
              if (updatedInsight !== undefined) {
                applyInsightMessage(threadId, updatedInsight ?? null);
              }
            }

            if (
              progressContent &&
              shouldLogProgress &&
              !/on chain|search/i.test(progressContent)
            ) {
              const createdAt = Date.now();
              appendMessage(threadId, {
                id: nextMessageId("status"),
                role: "assistant",
                title: "進捗",
                content: progressContent,
                createdAt,
              });
            } else {
              const details = extractEventDetails(message.payload);
              if (details) {
                const titleText = humanizeIdentifier(details.title);
                if (
                  titleText &&
                  (titleText.toLowerCase().includes("on chain") ||
                    titleText.toLowerCase().startsWith("search"))
                ) {
                  return;
                }
                const createdAt = Date.now();
                appendMessage(threadId, {
                  id: nextMessageId("event"),
                  role: "assistant",
                  title: titleText || "進捗",
                  content: details.content,
                  createdAt,
                });
              }
            }
            return;
          }

          if (message.type === "interrupt") {
            const interrupt = message.interrupt;
            const createdAt = Date.now();
            ensureConversation(message.thread_id, undefined, "pending_human");
            const interruptContent = formatInterruptContent(interrupt.value).trim();
            if (interruptContent && interruptContent !== "調査計画を編集しますか？") {
              appendMessage(message.thread_id, {
                id: nextMessageId("interrupt"),
                role: "system",
                content: interruptContent,
                createdAt,
              });
            }
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
            const planSource =
              getRecordValue<unknown>(snapshot?.state, "research_plan") ??
              interrupt.value;
            setPlanForms((prev) => ({
              ...prev,
              [message.thread_id]: parsePlanValue(planSource),
            }));
            setEditingThreadId(null);
            setPlanError(null);
            return;
          }

          if (message.type === "complete") {
            ensureConversation(message.thread_id, undefined, "completed");
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
              const createdAt = Date.now();
              appendMessage(targetId, {
                id: nextMessageId("error"),
                role: "system",
                content: message.message,
                createdAt,
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
    [appendMessage, applyInsightMessage, ensureConversation, inputValue, isConnecting, refreshThreadState]
  );

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
      setEditingThreadId(null);
      setPlanError(null);
      setIsDraftingNewThread(false);
      refreshThreadState(threadId);
    },
    [refreshThreadState]
  );

  const beginNewThread = useCallback(() => {
    setIsDraftingNewThread(true);
    setActiveThreadId(null);
    activeThreadRef.current = null;
    setEditingThreadId(null);
    setPlanError(null);
    setErrorMessage(null);
    setInputValueState("");
  }, []);

  const updatePlanFormState = useCallback(
    (threadId: string, updater: (draft: ResearchPlanFormState) => void) => {
      setPlanForms((prev) => {
        const current = prev[threadId] ?? createEmptyPlanForm();
        const draft = clonePlanForm(current);
        updater(draft);
        return { ...prev, [threadId]: draft };
      });
    },
    []
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
        const createdAt = Date.now();
        appendMessage(threadId, {
          id: nextMessageId("decision"),
          role: "user",
          content: "調査計画を承認しました。",
          createdAt,
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

      const planForm = planForms[threadId];
      if (!planForm) {
        setPlanError("調査計画を編集してから送信してください。");
        return;
      }
      const validationError = validatePlanForm(planForm);
      if (validationError) {
        setPlanError(validationError);
        return;
      }

      const payload = serializePlanForm(planForm);
      sendResumeCommand(socket, { decision: "y", plan: payload });
      const createdAt = Date.now();
      appendMessage(threadId, {
        id: nextMessageId("decision"),
        role: "user",
        content: "計画を更新しました。",
        createdAt,
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
    },
    [appendMessage, effectiveThreadId, planForms]
  );

  const researchParametersValue = getRecordValue<unknown>(currentState?.state, "research_parameters");
  const researchPlanValue = getRecordValue<unknown>(currentState?.state, "research_plan");
  const researchReportValue = (() => {
    const directReport = getRecordValue<unknown>(currentState?.state, "report");
    if (directReport !== undefined) {
      return directReport;
    }
    return getRecordValue<unknown>(currentState?.state, "research_report");
  })();
  const activeStepMessage = effectiveThreadId ? activeSteps[effectiveThreadId] : undefined;

  const displayPlan = useMemo(() => {
    if (researchPlanValue === undefined || researchPlanValue === null) {
      return null;
    }
    return parsePlanValue(researchPlanValue);
  }, [researchPlanValue]);

  const reportContent = useMemo(
    () => normalizeReportContent(researchReportValue),
    [researchReportValue]
  );
  const hasReport = reportContent.markdown !== null || reportContent.fallback !== null;

  const overallProgress = useMemo(() => {
    if (!selectedConversation) {
      return null;
    }

    const steps = [
      { label: "クエリ分析", done: Boolean(researchParametersValue) },
      { label: "調査計画", done: researchPlanValue !== undefined && researchPlanValue !== null },
      {
        label: "調査実行",
        done: selectedConversation.status === "completed" || hasReport,
      },
      { label: "最終レポート", done: hasReport },
    ];

    const completed = steps.reduce((count, step) => (step.done ? count + 1 : count), 0);
    return { completed, total: steps.length, steps };
  }, [hasReport, researchParametersValue, researchPlanValue, selectedConversation]);

  const executionMessage = useMemo(() => {
    const showExecutionIndicator = selectedConversation?.status === "running" && !currentInterrupt;
    return showExecutionIndicator
      ? activeStepMessage ?? "調査計画を作成しています..."
      : null;
  }, [activeStepMessage, currentInterrupt, selectedConversation?.status]);

  const interruptMessageIndex = useMemo(() => {
    if (!currentInterrupt) {
      return -1;
    }
    for (let index = selectedMessages.length - 1; index >= 0; index -= 1) {
      if (selectedMessages[index]?.id?.startsWith(INTERRUPT_MESSAGE_PREFIX)) {
        return index;
      }
    }
    return -1;
  }, [currentInterrupt, selectedMessages]);

  const messagesBeforeInterrupt = useMemo(() => {
    if (interruptMessageIndex === -1) {
      return selectedMessages;
    }
    return selectedMessages.slice(0, interruptMessageIndex + 1);
  }, [interruptMessageIndex, selectedMessages]);

  const messagesAfterInterrupt = useMemo(() => {
    if (interruptMessageIndex === -1) {
      return [] as ChatMessage[];
    }
    return selectedMessages.slice(interruptMessageIndex + 1);
  }, [interruptMessageIndex, selectedMessages]);

  const decisionMessageIndex = useMemo(() => {
    if (currentInterrupt) {
      return -1;
    }
    return selectedMessages.findIndex((message) => message.id?.startsWith("decision"));
  }, [currentInterrupt, selectedMessages]);

  const messagesBeforeDecision = useMemo(() => {
    if (decisionMessageIndex === -1) {
      return currentInterrupt ? [] : selectedMessages;
    }
    return selectedMessages.slice(0, decisionMessageIndex);
  }, [currentInterrupt, decisionMessageIndex, selectedMessages]);

  const messagesAfterDecision = useMemo(() => {
    if (decisionMessageIndex === -1) {
      return [] as ChatMessage[];
    }
    return selectedMessages.slice(decisionMessageIndex);
  }, [decisionMessageIndex, selectedMessages]);

  const isEditingPlan = editingThreadId === effectiveThreadId;

  const startPlanEditing = useCallback(() => {
    if (!effectiveThreadId) {
      return;
    }
    const source = researchPlanValue ?? currentInterrupt?.value;
    setPlanForms((prev) => ({
      ...prev,
      [effectiveThreadId]: parsePlanValue(source),
    }));
    setEditingThreadId(effectiveThreadId);
    setPlanError(null);
  }, [currentInterrupt?.value, effectiveThreadId, researchPlanValue]);

  const cancelPlanEditing = useCallback(() => {
    setEditingThreadId(null);
    setPlanError(null);
  }, []);

  const changePlan = useCallback(
    (updater: (draft: ResearchPlanFormState) => void) => {
      if (!effectiveThreadId) {
        return;
      }
      updatePlanFormState(effectiveThreadId, updater);
    },
    [effectiveThreadId, updatePlanFormState]
  );

  const addPlanSection = useCallback(() => {
    changePlan((draft) => {
      draft.sections.push(createEmptySection());
    });
    setPlanError(null);
  }, [changePlan]);

  const removePlanSection = useCallback(
    (index: number) => {
      changePlan((draft) => {
        draft.sections.splice(index, 1);
        if (draft.sections.length === 0) {
          draft.sections.push(createEmptySection());
        }
      });
      setPlanError(null);
    },
    [changePlan]
  );

  const resetPlanError = useCallback(() => {
    setPlanError(null);
  }, []);

  return {
    threadList,
    effectiveThreadId,
    selectedConversation,
    selectedMessages,
    currentInterrupt,
    editablePlan,
    planError,
    healthStatus,
    errorMessage,
    inputValue,
    isConnecting,
    executionMessage,
    displayPlan,
    reportContent,
    messagesBeforeInterrupt,
    messagesAfterInterrupt,
    messagesBeforeDecision,
    messagesAfterDecision,
    isEditingPlan,
    overallProgress,
    handleSubmit,
    handleSelectThread,
    beginNewThread,
    handlePlanDecision,
    startPlanEditing,
    cancelPlanEditing,
    addPlanSection,
    removePlanSection,
    changePlan,
    resetPlanError,
    setInputValue: setInputValueState,
  };
}
