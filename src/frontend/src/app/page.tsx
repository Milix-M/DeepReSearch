"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ChatTranscript } from "./components/ChatTranscript";
import { ConversationHeader } from "./components/ConversationHeader";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ExecutionIndicator } from "./components/ExecutionIndicator";
import { PlanInterruptPanel } from "./components/PlanInterruptPanel";
import { ResearchInputForm } from "./components/ResearchInputForm";
import { ResearchPlanViewer } from "./components/ResearchPlanViewer";
import { ResearchReportViewer } from "./components/ResearchReportViewer";
import { useResearchController } from "./hooks/useResearchController";
import { markdownComponents } from "./utils/markdown-components";
import { formatInterruptContent } from "./utils/chat-helpers";

export default function Home() {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);

  const {
    threadList,
    effectiveThreadId,
    selectedConversation,
    selectedMessages,
    currentInterrupt,
    editablePlan,
    planError,
    healthStatus,
    errorMessage,
    inputValue,
    isConnecting,
    executionMessage,
    displayPlan,
    reportContent,
    messagesBeforeInterrupt,
    messagesAfterInterrupt,
    messagesBeforeDecision,
    messagesAfterDecision,
    isEditingPlan,
    overallProgress,
    handleSubmit,
    handleSelectThread,
    beginNewThread,
    handlePlanDecision,
    startPlanEditing,
    cancelPlanEditing,
    addPlanSection,
    removePlanSection,
    changePlan,
    resetPlanError,
    setInputValue,
  } = useResearchController();

  const shouldShowReport = reportContent.markdown !== null || reportContent.fallback !== null;
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const previousReportVisibility = useRef(false);
  const collapsedByReportRef = useRef(false);

  const progressBadgeLabel = overallProgress
    ? `${overallProgress.completed}/${overallProgress.total}`
    : null;
  const progressBadgeTitle = overallProgress
    ? overallProgress.steps
      .map((step, index) => `${step.done ? "[x]" : "[ ]"} ${index + 1}. ${step.label}`)
      .join("\n")
    : null;
  const progressBadgeClassName = overallProgress
    ? "inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100 shadow-[0_16px_30px_-28px_rgba(16,185,129,0.6)]"
    : null;

  useEffect(() => {
    if (!previousReportVisibility.current && shouldShowReport) {
      setIsSidebarMinimized(true);
      collapsedByReportRef.current = true;
    } else if (previousReportVisibility.current && !shouldShowReport && collapsedByReportRef.current) {
      setIsSidebarMinimized(false);
      collapsedByReportRef.current = false;
    }
    previousReportVisibility.current = shouldShowReport;
  }, [shouldShowReport]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    selectedMessages.length,
    currentInterrupt,
    displayPlan,
    reportContent.markdown,
    reportContent.fallback,
    selectedConversation?.status,
    effectiveThreadId,
    executionMessage,
  ]);

  const headerSubtitle = selectedConversation
    ? null
    : "左の一覧からスレッドを選択するか、新しいリサーチを開始してください。";
  const handleToggleSidebar = () => {
    setIsSidebarMinimized((prev) => {
      collapsedByReportRef.current = false;
      return !prev;
    });
  };

  return (
    <div className="relative flex h-screen overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="floating-pulse absolute -left-24 top-20 h-96 w-96 rounded-full bg-emerald-500/25 blur-3xl" />
        <div className="absolute right-20 top-0 h-80 w-80 rounded-full bg-sky-500/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_55%)]" />
      </div>
      <ConversationSidebar
        threadList={threadList}
        selectedThreadId={effectiveThreadId}
        healthStatus={healthStatus}
        onSelectThread={handleSelectThread}
        onCreateThread={() => {
          beginNewThread();
          inputRef.current?.focus();
        }}
        isMinimized={isSidebarMinimized}
        onToggleMinimize={handleToggleSidebar}
      />
      <main className="glass-panel flex h-screen flex-1 flex-col overflow-hidden border-l border-slate-900/40 min-h-0">
        <ConversationHeader
          title={selectedConversation?.title ?? "Deep Research"}
          subtitle={headerSubtitle}
          statusBadgeLabel={progressBadgeLabel}
          statusBadgeClassName={progressBadgeClassName}
          statusBadgeTitle={progressBadgeTitle}
          errorMessage={errorMessage}
          progressSteps={overallProgress?.steps ?? null}
        />
        <section ref={chatScrollRef} className="flex-1 overflow-y-auto px-8 py-8">
          <div className="flex w-full flex-col gap-6 xl:mx-auto xl:max-w-6xl">
            <div className="flex flex-1 flex-col gap-5">
              {currentInterrupt ? (
                <Fragment key="interrupt">
                  <ChatTranscript
                    messages={messagesBeforeInterrupt}
                    markdownComponents={markdownComponents}
                  />
                  <ResearchPlanViewer
                    plan={displayPlan}
                    defaultOpen
                    markdownComponents={markdownComponents}
                  />
                  <PlanInterruptPanel
                    interrupt={currentInterrupt}
                    activeThreadId={effectiveThreadId}
                    editablePlan={editablePlan}
                    planError={planError}
                    isEditing={isEditingPlan}
                    onApprovePlan={() => handlePlanDecision("n")}
                    onSubmitPlan={() => handlePlanDecision("y")}
                    onStartEditing={startPlanEditing}
                    onCancelEditing={cancelPlanEditing}
                    onPlanChange={changePlan}
                    onPlanErrorReset={resetPlanError}
                    onAddSection={addPlanSection}
                    onRemoveSection={removePlanSection}
                    formatInterruptContent={formatInterruptContent}
                  />
                  <ChatTranscript
                    messages={messagesAfterInterrupt}
                    hideEmptyState
                    markdownComponents={markdownComponents}
                  />
                </Fragment>
              ) : (
                <Fragment key="standard">
                  <ChatTranscript
                    messages={messagesBeforeDecision}
                    markdownComponents={markdownComponents}
                  />
                  {displayPlan ? (
                    <ResearchPlanViewer
                      plan={displayPlan}
                      markdownComponents={markdownComponents}
                    />
                  ) : null}
                  <ChatTranscript
                    messages={messagesAfterDecision}
                    hideEmptyState
                    markdownComponents={markdownComponents}
                  />
                </Fragment>
              )}
              {executionMessage ? <ExecutionIndicator message={executionMessage} /> : null}
            </div>
            {shouldShowReport ? (
              <div className="flex justify-center">
                <ResearchReportViewer
                  markdownComponents={markdownComponents}
                  markdown={reportContent.markdown}
                  fallback={reportContent.fallback}
                  className="w-full max-w-3xl"
                />
              </div>
            ) : null}
          </div>
        </section>
        <ResearchInputForm
          inputRef={inputRef}
          value={inputValue}
          isConnecting={isConnecting}
          onChange={setInputValue}
          onSubmit={handleSubmit}
        />
      </main>
    </div>
  );
}
