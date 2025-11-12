"use client";

import { useMemo } from "react";
import type { ConversationMeta } from "../types";
import { formatTimestamp } from "../utils/conversation";
import { mergeClassNames } from "../utils/chat-helpers";

type HealthStatus = "loading" | "ok" | "error";

interface ConversationSidebarProps {
  threadList: ConversationMeta[];
  selectedThreadId: string | null;
  healthStatus: HealthStatus;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

const healthStatusText: Record<HealthStatus, string | null> = {
  loading: null,
  ok: null,
  error: "バックエンドに接続できません",
};

export function ConversationSidebar({
  threadList,
  selectedThreadId,
  healthStatus,
  onSelectThread,
  onCreateThread,
  isMinimized = false,
  onToggleMinimize,
}: ConversationSidebarProps) {
  const statusText = healthStatusText[healthStatus];
  const initialsByThread = useMemo(() => {
    return threadList.reduce<Record<string, string>>((acc, thread) => {
      const trimmed = (thread.title ?? "").trim();
      acc[thread.id] = trimmed ? trimmed.slice(0, 2) : "--";
      return acc;
    }, {});
  }, [threadList]);

  return (
    <aside
      className={mergeClassNames(
        "glass-panel hidden h-screen flex-shrink-0 flex-col overflow-hidden border-r border-slate-900/50 transition-[width] duration-300 ease-out md:sticky md:top-0 md:flex",
        isMinimized ? "md:w-24" : "md:w-[21rem]"
      )}
    >
      <div
        className={mergeClassNames(
          "border-b border-slate-800/60",
          isMinimized ? "px-2 py-4" : "px-6 py-6"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className={mergeClassNames("text-lg font-semibold", isMinimized ? "sr-only" : undefined)}>
              OSS DeepResearch
            </h1>
            {statusText ? (
              <p className={mergeClassNames("mt-2 text-xs text-slate-400", isMinimized ? "sr-only" : undefined)}>
                {statusText}
              </p>
            ) : null}
          </div>
          {onToggleMinimize ? (
            <button
              type="button"
              onClick={onToggleMinimize}
              className="flex h-10 w-10 flex-col items-center justify-center gap-1 rounded-lg border border-slate-700/60 bg-slate-900/60 transition-all hover:border-emerald-400/60 hover:bg-emerald-400/20"
              aria-label={isMinimized ? "サイドバーを展開" : "サイドバーを最小化"}
            >
              <span className="sr-only">{isMinimized ? "サイドバーを展開" : "サイドバーを最小化"}</span>
              <span aria-hidden className="flex w-6 flex-col gap-1.5">
                <span className="h-0.5 w-full rounded bg-slate-200"></span>
                <span
                  className={
                    isMinimized
                      ? "h-0.5 w-4 self-center rounded bg-slate-200"
                      : "h-0.5 w-full rounded bg-slate-200"
                  }
                ></span>
                <span className="h-0.5 w-full rounded bg-slate-200"></span>
              </span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCreateThread}
          className={mergeClassNames(
            "mt-5 w-full rounded-xl border border-emerald-400/30 bg-slate-900/70 text-sm font-semibold text-emerald-100 transition-colors hover:border-emerald-300 hover:bg-emerald-500/20",
            isMinimized ? "px-0 py-2" : "px-4 py-2"
          )}
          aria-label="新しいリサーチを作成"
        >
          {isMinimized ? <span className="text-base">+</span> : "新しいリサーチを作成"}
        </button>
      </div>
      <div
        className={mergeClassNames(
          "flex-1 space-y-1 overflow-y-auto pr-1",
          isMinimized ? "px-2 py-3" : "px-3 py-4"
        )}
      >
        {threadList.length === 0 ? (
          <p className={mergeClassNames("px-3 text-xs text-slate-500", isMinimized ? "sr-only" : undefined)}>
            リサーチ履歴がまだありません。
          </p>
        ) : (
          threadList.map((thread) => {
            const isActive = selectedThreadId === thread.id;
            const baseClass = mergeClassNames(
              "group relative mb-2 w-full overflow-hidden rounded-2xl border transition-all duration-200 last:mb-0",
              isActive
                ? "border-emerald-400/35 bg-slate-900/80 shadow-[0_18px_28px_-26px_rgba(45,212,191,0.55)]"
                : "border-transparent bg-transparent hover:border-emerald-400/20 hover:bg-slate-900/70",
              isMinimized ? "px-0 py-2 text-center" : "px-4 py-3 text-left"
            );

            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={baseClass}
                title={thread.title ?? undefined}
                aria-label={thread.title ?? "スレッド"}
              >
                {isMinimized ? (
                  <span className="block text-sm font-semibold text-slate-100">
                    {initialsByThread[thread.id]}
                  </span>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-slate-100 group-hover:text-emerald-100">
                      {thread.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 group-hover:text-emerald-200/70">
                      {formatTimestamp(thread.lastUpdated)}
                    </p>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
