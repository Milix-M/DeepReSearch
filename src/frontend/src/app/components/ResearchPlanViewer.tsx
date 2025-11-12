"use client";

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
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!detailsRef.current) {
      return;
    }
    if (!plan) {
      detailsRef.current.open = false;
      return;
    }
    detailsRef.current.open = defaultOpen;
  }, [defaultOpen, plan]);

  if (!plan) {
    return null;
  }

  const visibleSections = normalizeSections(plan);
  const introduction = plan.structure.introduction.trim();
  const conclusion = plan.structure.conclusion.trim();
  const purpose = plan.purpose.trim();
  const meta = plan.metaAnalysis.trim();
  const summaryPreview = purpose || visibleSections[0]?.title || "内容を確認";

  const renderMarkdownBlock = (value: string, placeholder: string) => {
    if (!value) {
      return <p className="text-slate-500">{placeholder}</p>;
    }
    return <ReactMarkdown components={markdownComponents}>{value}</ReactMarkdown>;
  };

  return (
    <details
      ref={detailsRef}
      className="group glass-panel max-w-3xl rounded-3xl border border-slate-700/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/30"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-100">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-200">
            PLAN
          </span>
          調査計画
        </span>
        <span className="flex items-center gap-3 text-xs font-normal text-slate-400">
          <span>{summaryPreview.length > 40 ? `${summaryPreview.slice(0, 40)}…` : summaryPreview}</span>
          <svg
            aria-hidden
            className="h-4 w-4 text-slate-400 transition-transform duration-300 group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </summary>
      <div className="mt-5 space-y-6 text-sm text-slate-200">
        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">調査目的</h4>
          <div className="mt-2 rounded-2xl border border-slate-700/50 bg-slate-950/70 px-5 py-4 text-sm leading-relaxed text-slate-100">
            {renderMarkdownBlock(purpose, "(未入力)")}
          </div>
        </section>

        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">ドキュメント構成</h4>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-700/50 bg-slate-950/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                イントロダクション
              </p>
              <div className="mt-2 text-sm leading-relaxed text-slate-100">
                {renderMarkdownBlock(introduction, "(未入力)")}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-700/50 bg-slate-950/70 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
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
                  className="rounded-2xl border border-slate-700/60 bg-slate-950/60 p-5 shadow-[0_18px_35px_-32px_rgba(94,234,212,0.55)]"
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
                    <div className="mt-3 space-y-2 text-sm text-slate-300">
                      {section.keyQuestions.map((question, questionIndex) => (
                        <div
                          key={`question-${index}-${questionIndex}`}
                          className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-2"
                        >
                          <div className="flex-1 leading-relaxed text-emerald-100">
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
            <div className="mt-2 rounded-2xl border border-slate-700/50 bg-slate-950/70 px-5 py-4 text-sm leading-relaxed text-slate-100">
              <ReactMarkdown components={markdownComponents}>{meta}</ReactMarkdown>
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
