interface ConversationHeaderProps {
  title: string;
  subtitle?: string | null;
  statusBadgeLabel?: string | null;
  statusBadgeClassName?: string | null;
  errorMessage?: string | null;
}

export function ConversationHeader({
  title,
  subtitle,
  statusBadgeLabel,
  statusBadgeClassName,
  errorMessage,
}: ConversationHeaderProps) {
  return (
    <header className="shrink-0 border-b border-slate-900/70 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {statusBadgeLabel && statusBadgeClassName ? (
          <span className={statusBadgeClassName}>{statusBadgeLabel}</span>
        ) : null}
      </div>
      {errorMessage && (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          {errorMessage}
        </p>
      )}
    </header>
  );
}
