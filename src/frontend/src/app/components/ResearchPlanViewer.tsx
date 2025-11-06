import type { ResearchPlanFormState } from "../types";

interface ResearchPlanViewerProps {
  plan: ResearchPlanFormState | null;
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

export function ResearchPlanViewer({ plan }: ResearchPlanViewerProps) {
  if (!plan) {
    return null;
  }

  const visibleSections = normalizeSections(plan);
  const introduction = plan.structure.introduction.trim();
  const conclusion = plan.structure.conclusion.trim();
  const purpose = plan.purpose.trim();
  const meta = plan.metaAnalysis.trim();

  return (
    <div className="max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-sm font-semibold text-slate-200">現行の調査計画</h3>
      <div className="mt-4 space-y-5 text-sm text-slate-200">
        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">調査目的</h4>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-slate-100">
            {purpose || "(未入力)"}
          </p>
        </section>

        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">ドキュメント構成</h4>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-slate-950/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                イントロダクション
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {introduction || "(未入力)"}
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                結論
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {conclusion || "(未入力)"}
              </p>
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
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {section.focus || "(概要未設定)"}
                  </p>
                  {section.keyQuestions.length > 0 ? (
                    <div className="mt-3 space-y-1 text-sm text-slate-300">
                      {section.keyQuestions.map((question, questionIndex) => (
                        <div
                          key={`question-${index}-${questionIndex}`}
                          className="flex items-start gap-3 border-l-2 border-emerald-400/70 pl-3"
                        >
                          <span className="flex-1 whitespace-pre-wrap leading-relaxed">
                            {question}
                          </span>
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
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-slate-100">
              {meta}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
