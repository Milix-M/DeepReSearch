interface ConversationHeaderProps {
  title: string;
  subtitle?: string | null;
  statusBadgeLabel?: string | null;
  statusBadgeClassName?: string | null;
  statusBadgeTitle?: string | null;
  errorMessage?: string | null;
  progressSteps?: { label: string; done: boolean }[] | null;
}

export function ConversationHeader({
  title,
  subtitle,
  statusBadgeLabel,
  statusBadgeClassName,
  statusBadgeTitle,
  errorMessage,
  progressSteps,
}: ConversationHeaderProps) {
  return (
    <header className="relative glass-panel shrink-0 px-8 py-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              {title}
            </h2>
            {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
          </div>
          {statusBadgeLabel && statusBadgeClassName ? (
            <span className={statusBadgeClassName} title={statusBadgeTitle ?? undefined}>
              {statusBadgeLabel}
            </span>
          ) : null}
        </div>
        {progressSteps && progressSteps.length > 0 ? (
          <ol className="glass-panel flex flex-wrap gap-3 rounded-2xl border border-slate-800/50 px-5 py-4 text-xs text-slate-300">
            {progressSteps.map((step, index) => (
              <li
                key={`${step.label}-${index}`}
                className={
                  step.done
                    ? "flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-emerald-100 shadow-[0_16px_30px_-28px_rgba(16,185,129,0.55)]"
                    : "flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-slate-400"
                }
              >
                <span
                  className={
                    step.done
                      ? "flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-400/30 text-[11px] font-semibold text-emerald-900"
                      : "flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/70 text-[11px] font-semibold text-slate-400"
                  }
                >
                  {step.done ? (
                    <svg
                      aria-hidden
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12l4 4 10-10" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="text-xs font-medium tracking-wide">{step.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      {errorMessage ? (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/15 px-5 py-3 text-xs text-rose-100 shadow-[0_12px_30px_-24px_rgba(248,113,113,0.6)]">
          {errorMessage}
        </p>
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
    </header>
  );
}
