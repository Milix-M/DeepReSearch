import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMeta, ConversationStatus } from "../../types";
import { makeThreadTitle } from "../../utils/chat-helpers";
import { THREAD_TITLE_STORAGE_KEY } from "./constants";

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

interface UseThreadRegistryResult {
    conversations: Record<string, ConversationMeta>;
    threadList: ConversationMeta[];
    activeThreadId: string | null;
    setActiveThreadId: (threadId: string | null) => void;
    effectiveThreadId: string | null;
    isDraftingNewThread: boolean;
    setIsDraftingNewThread: (value: boolean) => void;
    ensureConversation: (
        threadId: string,
        rawTitle: string | undefined,
        status: ConversationStatus
    ) => void;
    resolveConversationTitle: (threadId: string, rawTitle?: string) => string;
    mutateConversations: (
        updater: (prev: Record<string, ConversationMeta>) => Record<string, ConversationMeta>
    ) => void;
    touchConversation: (threadId: string, timestamp: number) => void;
}

export function useThreadRegistry(): UseThreadRegistryResult {
    const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [isDraftingNewThread, setIsDraftingNewThread] = useState(false);
    const [threadTitles, setThreadTitles] = useState<Record<string, string>>(() =>
        loadThreadTitlesFromStorage()
    );
    const threadTitlesRef = useRef<Record<string, string>>(threadTitles);

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

                if (
                    existing &&
                    existing.title === conversation.title &&
                    existing.status === conversation.status &&
                    existing.lastUpdated === conversation.lastUpdated
                ) {
                    return prev;
                }

                return { ...prev, [threadId]: conversation };
            });
        },
        [rememberTitle, resolveConversationTitle]
    );

    const mutateConversations = useCallback(
        (
            updater: (prev: Record<string, ConversationMeta>) => Record<string, ConversationMeta>
        ) => {
            setConversations((prev) => updater(prev));
        },
        []
    );

    const touchConversation = useCallback((threadId: string, timestamp: number) => {
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
    }, []);

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

    return {
        conversations,
        threadList,
        activeThreadId,
        setActiveThreadId,
        effectiveThreadId,
        isDraftingNewThread,
        setIsDraftingNewThread,
        ensureConversation,
        resolveConversationTitle,
        mutateConversations,
        touchConversation,
    };
}
