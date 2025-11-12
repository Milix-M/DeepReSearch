import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

interface ResearchReportViewerProps {
  markdownComponents: Components;
  markdown?: string | null;
  fallback?: string | null;
  className?: string;
}

export function ResearchReportViewer({
  markdownComponents,
  markdown,
  fallback,
  className,
}: ResearchReportViewerProps) {
  const containerClassName = [
    "glass-elevated relative max-w-3xl overflow-hidden rounded-3xl border border-emerald-400/30 px-6 py-6",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClassName}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-400/60 via-emerald-300/40 to-transparent" />
      <h3 className="text-sm font-semibold uppercase tracking-widest text-emerald-200">
        レポート
      </h3>
      {markdown ? (
        <div className="mt-4 space-y-4 rounded-2xl border border-emerald-400/20 bg-slate-950/70 px-5 py-4 text-sm leading-relaxed text-emerald-100 shadow-[0_24px_40px_-32px_rgba(16,185,129,0.6)]">
          <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
        </div>
      ) : fallback ? (
          <div className="mt-4 space-y-4 rounded-2xl border border-emerald-400/20 bg-slate-950/70 px-5 py-4 text-sm leading-relaxed text-emerald-100 shadow-[0_24px_40px_-32px_rgba(16,185,129,0.6)]">
          <ReactMarkdown components={markdownComponents}>{fallback}</ReactMarkdown>
        </div>
      ) : (
            <p className="mt-4 text-sm text-emerald-100/70">レポート内容がまだ整形されていません。</p>
      )}
    </div>
  );
}
