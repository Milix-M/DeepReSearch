interface ExecutionIndicatorProps {
  message?: string;
}

export function ExecutionIndicator({ message }: ExecutionIndicatorProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="glass-panel flex items-center gap-3 self-start rounded-2xl border border-emerald-400/40 px-5 py-4 text-sm text-slate-200 shadow-[0_18px_35px_-32px_rgba(16,185,129,0.7)]">
      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-r-transparent shadow-[0_0_12px_rgba(16,185,129,0.45)]" />
      <div className="space-y-1">
        <p>{message}</p>
        <p className="text-xs text-emerald-200/80">処理が完了するまでお待ちください。</p>
      </div>
    </div>
  );
}
