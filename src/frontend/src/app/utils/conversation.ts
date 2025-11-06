import type { ConversationStatus } from "../types";

export function statusLabel(status: ConversationStatus): string | null {
  switch (status) {
    case "running":
      return "進行中";
    case "pending_human":
      return null;
    case "completed":
      return "完了";
    case "error":
      return "エラー";
    default:
      return status;
  }
}

export function statusClassName(status: ConversationStatus, active: boolean): string {
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

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "";
  }
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
