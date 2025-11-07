import type { FormEvent } from "react";
import type { InterruptPayload } from "../../types/api";
import type { ResearchPlanFormState } from "../types";

interface PlanInterruptPanelProps {
  interrupt: InterruptPayload | null;
  activeThreadId: string | null;
  editablePlan: ResearchPlanFormState;
  planError: string | null;
  isEditing: boolean;
  onApprovePlan: () => void; // decision "n"
  onSubmitPlan: () => void; // decision "y"
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onPlanChange: (updater: (draft: ResearchPlanFormState) => void) => void;
  onPlanErrorReset: () => void;
  onAddSection: () => void;
  onRemoveSection: (index: number) => void;
  formatInterruptContent: (value: unknown) => string;
}

export function PlanInterruptPanel({
  interrupt,
  activeThreadId,
  editablePlan,
  planError,
  isEditing,
  onApprovePlan,
  onSubmitPlan,
  onStartEditing,
  onCancelEditing,
  onPlanChange,
  onPlanErrorReset,
  onAddSection,
  onRemoveSection,
  formatInterruptContent,
}: PlanInterruptPanelProps) {
  if (!interrupt || !activeThreadId) {
    return null;
  }

  if (!isEditing) {
    return (
      <div className="max-w-3xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
        <h3 className="text-sm font-semibold text-amber-200">調査計画の確認が求められています</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-amber-100/90">
          {formatInterruptContent(interrupt.value)}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onApprovePlan}
            className="rounded-lg border border-emerald-400/60 bg-emerald-400/20 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:border-emerald-300 hover:bg-emerald-400/30"
          >
            この計画で進行
          </button>
          <button
            type="button"
            onClick={onStartEditing}
            className="rounded-lg border border-amber-400/60 bg-slate-900/80 px-4 py-2 text-sm text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-500/20"
          >
            計画を編集
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmitPlan();
  };

  return (
    <div className="max-w-3xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
      <h3 className="text-sm font-semibold text-amber-200">調査計画の確認が求められています</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm text-amber-100/90">
        {formatInterruptContent(interrupt.value)}
      </p>
      <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
              調査目的
            </label>
            <textarea
              value={editablePlan.purpose}
              onChange={(event) => {
                onPlanChange((draft) => {
                  draft.purpose = event.target.value;
                });
                onPlanErrorReset();
              }}
              rows={3}
              className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
              placeholder="調査の狙いや前提条件を記載してください"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
                イントロダクション概要
              </label>
              <textarea
                value={editablePlan.structure.introduction}
                onChange={(event) => {
                  onPlanChange((draft) => {
                    draft.structure.introduction = event.target.value;
                  });
                  onPlanErrorReset();
                }}
                rows={3}
                className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="レポート冒頭で伝えたいポイント"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
                結論概要
              </label>
              <textarea
                value={editablePlan.structure.conclusion}
                onChange={(event) => {
                  onPlanChange((draft) => {
                    draft.structure.conclusion = event.target.value;
                  });
                  onPlanErrorReset();
                }}
                rows={3}
                className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                placeholder="調査を通じて導きたい結論"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-amber-100">セクション構成</h4>
              <button
                type="button"
                onClick={() => {
                  onAddSection();
                  onPlanErrorReset();
                }}
                className="rounded-lg border border-amber-400/50 px-3 py-1 text-xs font-medium text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-400/20"
              >
                セクションを追加
              </button>
            </div>

            {editablePlan.sections.map((section, index) => {
              const keyQuestionsText = section.keyQuestions.join("\n");
              return (
                <div
                  key={`section-${index}`}
                  className="space-y-3 rounded-xl border border-amber-500/30 bg-slate-950/40 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-amber-100">セクション {index + 1}</p>
                    {editablePlan.sections.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          onRemoveSection(index);
                          onPlanErrorReset();
                        }}
                        className="text-xs text-amber-200 transition-colors hover:text-amber-100"
                      >
                        削除
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
                      タイトル
                    </label>
                    <input
                      type="text"
                      value={section.title}
                      onChange={(event) => {
                        onPlanChange((draft) => {
                          draft.sections[index].title = event.target.value;
                        });
                        onPlanErrorReset();
                      }}
                      className="w-full rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                      placeholder="例: 市場規模の把握"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
                      焦点
                    </label>
                    <textarea
                      value={section.focus}
                      onChange={(event) => {
                        onPlanChange((draft) => {
                          draft.sections[index].focus = event.target.value;
                        });
                        onPlanErrorReset();
                      }}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                      placeholder="このセクションで特に掘り下げたい観点"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
                      主要質問 (1行につき1つ)
                    </label>
                    <textarea
                      value={keyQuestionsText}
                      onChange={(event) => {
                        const lines = event.target.value.split(/\r?\n/);
                        onPlanChange((draft) => {
                          draft.sections[index].keyQuestions = lines;
                        });
                        onPlanErrorReset();
                      }}
                      rows={3}
                      className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
                      placeholder="検討したい質問を1行ずつ入力してください"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-amber-100/80">
              メタ分析メモ (任意)
            </label>
            <textarea
              value={editablePlan.metaAnalysis}
              onChange={(event) => {
                onPlanChange((draft) => {
                  draft.metaAnalysis = event.target.value;
                });
                onPlanErrorReset();
              }}
              rows={3}
              className="w-full resize-none rounded-xl border border-amber-500/30 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
              placeholder="補足のアイデアや注意点があればここに記載"
            />
          </div>
        </div>

        {planError ? <p className="text-xs text-rose-200">{planError}</p> : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-lg border border-amber-400/60 bg-amber-400/20 px-4 py-2 text-sm font-medium text-amber-100 transition-colors hover:border-amber-300 hover:bg-amber-400/30"
          >
            更新して再開
          </button>
          <button
            type="button"
            onClick={onCancelEditing}
            className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-900"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
