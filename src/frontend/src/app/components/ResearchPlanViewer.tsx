import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { ResearchPlanFormState } from "../types";

interface ResearchPlanViewerProps {
  plan: ResearchPlanFormState | null;
  defaultOpen?: boolean;
  markdownComponents: Components;
}

function normalizeSections(plan: ResearchPlanFormState | null) {
  if (!plan) {
    return [] as Array<{ title: string; focus: string; keyQuestions: string[] }>;
  }
  return plan.sections
    .map((section) => {
      const title = section.title.trim();
      const focus = section.focus.trim();
      const keyQuestions = section.keyQuestions
        .map((question) => question.trim())
        .filter((question) => question.length > 0);
      return { title, focus, keyQuestions };
    })
    .filter((section) => section.title || section.focus || section.keyQuestions.length > 0);
}

export function ResearchPlanViewer({ plan, defaultOpen = false, markdownComponents }: ResearchPlanViewerProps) {
  if (!plan) {
    return null;
  }

  const visibleSections = normalizeSections(plan);
  const introduction = plan.structure.introduction.trim();
  const conclusion = plan.structure.conclusion.trim();
  const purpose = plan.purpose.trim();
  const meta = plan.metaAnalysis.trim();
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryPreview = purpose || visibleSections[0]?.title || "内容を確認";

  const renderMarkdownBlock = (value: string, placeholder: string) => {
    if (!value) {
      return <p className="text-slate-500">{placeholder}</p>;
    }
    return <ReactMarkdown components={markdownComponents}>{value}</ReactMarkdown>;
  };

  useEffect(() => {
    if (!detailsRef.current) {
      return;
    }
    detailsRef.current.open = defaultOpen;
  }, [defaultOpen, plan]);

  return (
    <details
      ref={detailsRef}
      className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-200">
        <span>調査計画</span>
        <span className="text-xs font-normal text-slate-400">
          {summaryPreview.length > 40 ? `${summaryPreview.slice(0, 40)}…` : summaryPreview}
        </span>
      </summary>
      <div className="mt-4 space-y-5 text-sm text-slate-200">
        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">調査目的</h4>
          <div className="mt-2 rounded-xl bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-slate-100">
            {renderMarkdownBlock(purpose, "(未入力)")}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">ドキュメント構成</h4>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-slate-950/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                イントロダクション
              </p>
              <div className="mt-2 text-sm leading-relaxed text-slate-100">
                {renderMarkdownBlock(introduction, "(未入力)")}
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                結論
              </p>
              <div className="mt-2 text-sm leading-relaxed text-slate-100">
                {renderMarkdownBlock(conclusion, "(未入力)")}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              セクション一覧
            </h4>
            <span className="text-xs text-slate-500">{visibleSections.length} 件</span>
          </div>
          <div className="mt-3 space-y-3">
            {visibleSections.length === 0 ? (
              <p className="text-sm text-slate-500">表示可能なセクションがまだありません。</p>
            ) : (
              visibleSections.map((section, index) => (
                <article
                  key={`plan-section-${index}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"
                >
                  <header className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-100">
                      {section.title || `セクション ${index + 1}`}
                    </p>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">
                      #{index + 1}
                    </span>
                  </header>
                  <div className="mt-2 text-sm leading-relaxed text-slate-200">
                    {renderMarkdownBlock(section.focus, "(概要未設定)")}
                  </div>
                  {section.keyQuestions.length > 0 ? (
                    <div className="mt-3 space-y-1 text-sm text-slate-300">
                      {section.keyQuestions.map((question, questionIndex) => (
                        <div
                          key={`question-${index}-${questionIndex}`}
                          className="flex items-start gap-3 border-l-2 border-emerald-400/70 pl-3"
                        >
                          <div className="flex-1 leading-relaxed">
                            <ReactMarkdown components={markdownComponents}>{question}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        {meta ? (
          <section>
            <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              メタ分析メモ
            </h4>
            <div className="mt-2 rounded-xl bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-slate-100">
              <ReactMarkdown components={markdownComponents}>{meta}</ReactMarkdown>
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
