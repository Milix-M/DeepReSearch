import type { ConversationMeta } from "../types";
import { formatTimestamp, statusClassName, statusLabel } from "../utils/conversation";

type HealthStatus = "loading" | "ok" | "error";

interface ConversationSidebarProps {
  threadList: ConversationMeta[];
  selectedThreadId: string | null;
  healthStatus: HealthStatus;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
}

const healthStatusText: Record<HealthStatus, string> = {
  loading: "接続を確認中",
  ok: "バックエンドと接続済み",
  error: "バックエンドに接続できません",
};

const healthIndicatorClassName: Record<HealthStatus, string> = {
  loading: "bg-slate-500 animate-pulse",
  ok: "bg-emerald-400",
  error: "bg-rose-400",
};

export function ConversationSidebar({
  threadList,
  selectedThreadId,
  healthStatus,
  onSelectThread,
  onCreateThread,
}: ConversationSidebarProps) {
  return (
    <aside className="hidden h-full w-80 flex-col overflow-hidden border-r border-slate-900/80 bg-slate-900/60 md:flex">
      <div className="border-b border-slate-800 px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">DeepReSearch Console</h1>
          <span className={`h-2 w-2 rounded-full ${healthIndicatorClassName[healthStatus]}`} />
        </div>
        <p className="mt-2 text-xs text-slate-400">{healthStatusText[healthStatus]}</p>
        <button
          type="button"
          onClick={onCreateThread}
          className="mt-5 w-full rounded-lg border border-slate-700/80 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800"
        >
          新しいリサーチを作成
        </button>
      </div>
      <div className="flex-1 px-3 py-4">
        {threadList.length === 0 ? (
          <p className="px-3 text-xs text-slate-500">リサーチ履歴がまだありません。</p>
        ) : (
          threadList.map((thread) => {
            const isActive = selectedThreadId === thread.id;
            const label = statusLabel(thread.status);
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={`mb-2 w-full rounded-xl border px-4 py-3 text-left transition-colors last:mb-0 ${
                  isActive
                    ? "border-slate-700 bg-slate-800/80"
                    : "border-transparent bg-transparent hover:border-slate-800 hover:bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-100">{thread.title}</p>
                  {label && (
                    <span className={statusClassName(thread.status, isActive)}>{label}</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatTimestamp(thread.lastUpdated)}</p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
