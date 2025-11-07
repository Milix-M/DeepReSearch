interface ExecutionIndicatorProps {
  message?: string;
}

export function ExecutionIndicator({ message }: ExecutionIndicatorProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 self-start rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 text-sm text-slate-200">
      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-r-transparent" />
      <div className="space-y-1">
        <p>{message}</p>
        <p className="text-xs text-slate-400">処理が完了するまでお待ちください。</p>
      </div>
    </div>
  );
}
