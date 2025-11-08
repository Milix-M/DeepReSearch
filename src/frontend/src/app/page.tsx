"use client";

import { Fragment, useEffect, useRef } from "react";
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
import { formatInterruptContent, mergeClassNames } from "./utils/chat-helpers";

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
    handleSubmit,
    handleSelectThread,
    handlePlanDecision,
    startPlanEditing,
    cancelPlanEditing,
    addPlanSection,
    removePlanSection,
    changePlan,
    resetPlanError,
    setInputValue,
  } = useResearchController();

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
  const shouldShowReport = reportContent.markdown !== null || reportContent.fallback !== null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <ConversationSidebar
        threadList={threadList}
        selectedThreadId={effectiveThreadId}
        healthStatus={healthStatus}
        onSelectThread={handleSelectThread}
        onCreateThread={() => inputRef.current?.focus()}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <ConversationHeader
          title={selectedConversation?.title ?? "Deep Research"}
          subtitle={headerSubtitle}
          errorMessage={errorMessage}
        />
        <section ref={chatScrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div
            className={mergeClassNames(
              "flex w-full gap-6",
              shouldShowReport
                ? "flex-col lg:flex-row lg:items-start xl:mx-auto xl:max-w-6xl"
                : "flex-col"
            )}
          >
            <div
              className={mergeClassNames(
                "flex flex-1 flex-col gap-4",
                shouldShowReport ? "min-w-0" : undefined
              )}
            >
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
              <aside className="w-full flex-none lg:w-[420px]">
                <div className="lg:sticky lg:top-24">
                  <ResearchReportViewer
                    markdownComponents={markdownComponents}
                    markdown={reportContent.markdown}
                    fallback={reportContent.fallback}
                    className="w-full lg:max-w-none shadow-lg ring-1 ring-emerald-400/30"
                  />
                </div>
              </aside>
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
