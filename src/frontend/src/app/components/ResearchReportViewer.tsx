import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

interface ResearchReportViewerProps {
  markdownComponents: Components;
  markdown?: string | null;
  fallback?: string | null;
}

export function ResearchReportViewer({ markdownComponents, markdown, fallback }: ResearchReportViewerProps) {
  return (
    <div className="max-w-3xl rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
      <h3 className="text-sm font-semibold text-emerald-200">レポート</h3>
      {markdown ? (
        <div className="mt-3 space-y-4 rounded-xl bg-slate-950/60 px-4 py-3 text-sm text-emerald-100">
          <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
        </div>
      ) : fallback ? (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950/60 px-4 py-3 text-xs text-emerald-100">
          {fallback}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-emerald-100/70">レポート内容がまだ整形されていません。</p>
      )}
    </div>
  );
}
