import { useCallback, useState } from "react";
import type { ChatMessage, ResearchInsightState } from "../../types";
import { buildInsightContent } from "../../utils/chat-helpers";
import { INSIGHT_MESSAGE_PREFIX } from "./constants";

interface UseMessageManagerOptions {
    touchConversation: (threadId: string, timestamp: number) => void;
}

type InsightDelta = Partial<Pick<ResearchInsightState, "currentPage" | "reasoning">>;

interface UseMessageManagerResult {
    messagesByThread: Record<string, ChatMessage[]>;
    appendMessage: (threadId: string, message: ChatMessage) => void;
    handleInsightDelta: (threadId: string, delta: InsightDelta) => void;
    resetInsight: (threadId: string) => void;
}

export function useMessageManager({
    touchConversation,
}: UseMessageManagerOptions): UseMessageManagerResult {
    const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
    const [insights, setInsights] = useState<Record<string, ResearchInsightState>>({});

    const appendMessage = useCallback(
        (threadId: string, message: ChatMessage) => {
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
                touchConversation(threadId, message.createdAt);
            }
        },
        [touchConversation]
    );

    const applyInsightMessage = useCallback(
        (threadId: string, insight: ResearchInsightState | null) => {
            const messageId = `${INSIGHT_MESSAGE_PREFIX}${threadId}`;
            const timestamp = insight?.lastUpdated ?? Date.now();
            let shouldTouchConversation = false;

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
                shouldTouchConversation = true;
                return { ...prev, [threadId]: nextMessages };
            });

            if (shouldTouchConversation && insight) {
                touchConversation(threadId, timestamp);
            }
        },
        [touchConversation]
    );

    const handleInsightDelta = useCallback(
        (threadId: string, delta: InsightDelta) => {
            let updatedInsight: ResearchInsightState | null | undefined;
            setInsights((prev) => {
                const current = prev[threadId];
                const now = Date.now();

                const nextInsight: ResearchInsightState = {
                    currentPage:
                        delta.currentPage !== undefined ? delta.currentPage : current?.currentPage,
                    reasoning:
                        delta.reasoning !== undefined ? delta.reasoning : current?.reasoning,
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
        },
        [applyInsightMessage]
    );

    const resetInsight = useCallback(
        (threadId: string) => {
            setInsights((prev) => {
                if (!prev[threadId]) {
                    return prev;
                }
                const next = { ...prev };
                delete next[threadId];
                return next;
            });
            applyInsightMessage(threadId, null);
        },
        [applyInsightMessage]
    );

    return {
        messagesByThread,
        appendMessage,
        handleInsightDelta,
        resetInsight,
    };
}
