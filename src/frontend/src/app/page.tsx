"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, FormEvent, ReactNode } from "react";
import type { Components } from "react-markdown";
import { apiClient } from "../lib/api-client";
import {
  createResearchSocket,
  sendResumeCommand,
  sendStartCommand,
} from "../lib/ws-client";
import type {
  InterruptPayload,
  ThreadStateResponse,
  WebSocketMessage,
} from "../types/api";
import type {
  ChatMessage,
  ConversationMeta,
  ConversationStatus,
  PlanSectionFormState,
  PlanStructureFormState,
  ResearchInsightState,
  ResearchPlanFormState,
} from "./types";
import { statusClassName, statusLabel } from "./utils/conversation";
import { ConversationSidebar } from "./components/ConversationSidebar";
import { ConversationHeader } from "./components/ConversationHeader";
import { ChatTranscript } from "./components/ChatTranscript";
import { ExecutionIndicator } from "./components/ExecutionIndicator";
import { PlanInterruptPanel } from "./components/PlanInterruptPanel";
import { ResearchPlanViewer } from "./components/ResearchPlanViewer";
import { ResearchInputForm } from "./components/ResearchInputForm";
import { ResearchReportViewer } from "./components/ResearchReportViewer";

interface EventStatusUpdate {
  message?: string;
  clear?: boolean;
}

function truncateInsight(value: string, limit = 320): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mergeClassNames(
  ...values: Array<string | undefined | null | false>
): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function extractEventDetails(
  payload: Record<string, unknown>
): { title?: string; content: string } | null {
  const title = typeof payload.event === "string" ? payload.event : undefined;
  const data = (payload.data as Record<string, unknown> | undefined) ?? undefined;
  const chunk = (data?.chunk ?? {}) as Record<string, unknown> | undefined;
  const delta = (chunk?.delta ?? {}) as Record<string, unknown> | undefined;
  const messages = Array.isArray(chunk?.messages)
    ? (chunk?.messages as Array<Record<string, unknown>>)
    : undefined;

  const firstMessageText = messages
    ?.map((item) => firstNonEmptyString(item?.content))
    .find((text) => text);

  const textCandidate = firstNonEmptyString(
    typeof payload.message === "string" ? payload.message : null,
    typeof data?.output === "string" ? data.output : null,
    typeof data?.message === "string" ? data.message : null,
    typeof data?.text === "string" ? data.text : null,
    typeof chunk?.text === "string" ? chunk.text : null,
    typeof delta?.text === "string" ? delta.text : null,
    typeof delta?.content === "string" ? delta.content : null,
    firstMessageText ?? null
  );

  if (!textCandidate) {
    return null;
  }

  return { title, content: textCandidate };
}

function describeEventStatus(payload: Record<string, unknown>): EventStatusUpdate | null {
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (!eventType) {
    return null;
  }

  const rawName = typeof payload.name === "string" ? payload.name : "";
  const displayName = rawName ? rawName.replace(/[_-]/g, " ") : "";

  const createMessage = (text: string) => ({ message: text });

  switch (eventType) {
    case "on_chain_start":
      return createMessage(
        displayName ? `${displayName} を実行中です...` : "ワークフローを実行中です..."
      );
    case "on_chain_resume":
      return createMessage("ワークフローを再開しています...");
    case "on_chain_end":
      return { clear: true };
    case "on_tool_start":
      return createMessage(
        displayName ? `ツール「${displayName}」を実行中です...` : "ツールを実行中です..."
      );
    case "on_tool_end":
      return { clear: true };
    case "on_llm_start":
      return createMessage("AIに質問しています...");
    case "on_llm_end":
      return { clear: true };
    case "on_retriever_start":
      return createMessage("情報を検索しています...");
    case "on_retriever_end":
      return { clear: true };
    default: {
      const data = payload.data as Record<string, unknown> | undefined;
      const phase = firstNonEmptyString(
        typeof data?.phase === "string" ? data.phase : null,
        typeof data?.status === "string" ? data.status : null
      );
      if (phase) {
        return createMessage(`${phase} を実行中です...`);
      }
      return null;
    }
  }
}

function extractReasoningText(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const chunk = toRecord(data?.chunk);
  const delta = toRecord(chunk?.delta);

  const reasoningValue = delta?.reasoning;
  let reasoning = firstNonEmptyString(
    typeof reasoningValue === "string" ? reasoningValue : null,
    Array.isArray(reasoningValue)
      ? reasoningValue
          .map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }
            const record = toRecord(entry);
            return (
              firstNonEmptyString(
                typeof record?.text === "string" ? record.text : null,
                typeof record?.content === "string" ? record.content : null,
                typeof record?.value === "string" ? record.value : null
              ) ?? ""
            );
          })
          .join("")
      : null,
    reasoningValue && typeof reasoningValue === "object"
      ? firstNonEmptyString(
          typeof (reasoningValue as Record<string, unknown>).text === "string"
            ? (reasoningValue as Record<string, unknown>).text
            : null,
          typeof (reasoningValue as Record<string, unknown>).content === "string"
            ? (reasoningValue as Record<string, unknown>).content
            : null
        )
      : null
  );

  if (!reasoning) {
    reasoning = firstNonEmptyString(
      typeof delta?.text === "string" ? delta.text : null,
      typeof delta?.content === "string" ? delta.content : null,
      typeof chunk?.text === "string" ? chunk.text : null,
      typeof data?.text === "string" ? data.text : null
    );
  }

  if (!reasoning) {
    const messageRecord = toRecord(data?.message);
    reasoning = firstNonEmptyString(
      typeof messageRecord?.content === "string" ? messageRecord.content : null,
      typeof messageRecord?.text === "string" ? messageRecord.text : null
    );
  }

  return reasoning ? truncateInsight(reasoning) : null;
}

function extractResearchInsight(
  payload: Record<string, unknown>
): { currentPage?: string; reasoning?: string } | null {
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (!eventType) {
    return null;
  }

  const name = typeof payload.name === "string" ? payload.name : "";
  const data = toRecord(payload.data);

  if (eventType === "on_tool_start" && name === "web_research") {
    const inputValue = data?.input;
    let query: string | null = null;
    let section: string | null = null;

    if (typeof inputValue === "string") {
      query = inputValue;
    } else if (inputValue && typeof inputValue === "object") {
      const inputRecord = toRecord(inputValue);
      if (inputRecord) {
        query = typeof inputRecord.query === "string" ? inputRecord.query : query;
        section =
          typeof inputRecord.section === "string" ? inputRecord.section : section;
      }
    }

    if (query) {
      const message = section
        ? `${section} を調べるために「${query}」を検索中`
        : `「${query}」を検索中`;
      return { currentPage: truncateInsight(message, 200) };
    }
  }

  if (eventType === "on_tool_end" && name === "web_research") {
    const output = data?.output;
    if (Array.isArray(output) && output.length > 0) {
      const firstResult = toRecord(output[0]);
      const title = typeof firstResult?.title === "string" ? firstResult.title.trim() : "";
      const url = typeof firstResult?.url === "string" ? firstResult.url.trim() : "";
      const snippet =
        typeof firstResult?.snippet === "string" ? firstResult.snippet.trim() : "";

      const pageLabel = firstNonEmptyString(
        title && url ? `${title} (${url})` : null,
        url,
        title
      );

      if (pageLabel) {
        const summary = snippet ? `${pageLabel}\n${snippet}` : pageLabel;
        return { currentPage: truncateInsight(summary) };
      }
    }
  }

  if (eventType.startsWith("on_llm")) {
    const reasoning = extractReasoningText(payload);
    if (reasoning) {
      return { reasoning };
    }
  }

  if (eventType === "on_chain_stream" || eventType === "on_chain_end") {
    const reasoning = extractReasoningText(payload);
    if (reasoning) {
      return { reasoning };
    }
  }

  return null;
}

function buildInsightContent(insight: ResearchInsightState): string {
  const blocks: string[] = [];
  if (insight.currentPage) {
    blocks.push(`調査中のページ\n${insight.currentPage}`);
  }
  if (insight.reasoning) {
    blocks.push(`LLMの思考\n${insight.reasoning}`);
  }
  if (blocks.length === 0) {
    return "リサーチの進捗を記録しています。";
  }
  return blocks.join("\n\n");
}

function getRecordValue<T>(
  record: Record<string, unknown> | undefined,
  key: string
): T | undefined {
  const value = record?.[key];
  return value as T | undefined;
}

function makeThreadTitle(query: string | undefined, id: string): string {
  if (query) {
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 30 ? `${trimmed.slice(0, 30)}...` : trimmed;
    }
  }
  return `Thread ${id.slice(0, 8)}`;
}

function formatInterruptContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return safeStringify(value);
}

function normalizeReportContent(value: unknown): { markdown: string | null; fallback: string | null } {
  if (value === null || value === undefined) {
    return { markdown: null, fallback: null };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { markdown: null, fallback: null };
    }
    return { markdown: value, fallback: null };
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (entry && typeof entry === "object") {
          const record = toRecord(entry);
          if (record) {
            const candidate = firstNonEmptyString(
              typeof record.markdown === "string" ? record.markdown : null,
              typeof record.content === "string" ? record.content : null,
              typeof record.text === "string" ? record.text : null,
              typeof record.summary === "string" ? record.summary : null
            );
            if (candidate) {
              return candidate.trim();
            }
          }
          return safeStringify(entry);
        }
        if (entry === null || entry === undefined) {
          return "";
        }
        return String(entry);
      })
      .filter((segment): segment is string => segment.trim().length > 0);
    if (parts.length > 0) {
      return { markdown: parts.join("\n\n"), fallback: null };
    }
    return { markdown: null, fallback: null };
  }

  const record = toRecord(value);
  if (record) {
    const candidate = firstNonEmptyString(
      typeof record.markdown === "string" ? record.markdown : null,
      typeof record.md === "string" ? record.md : null,
      typeof record.report === "string" ? record.report : null,
      typeof record.content === "string" ? record.content : null,
      typeof record.text === "string" ? record.text : null,
      typeof record.summary === "string" ? record.summary : null,
      typeof record.value === "string" ? record.value : null
    );
    if (candidate && candidate.trim().length > 0) {
      return { markdown: candidate, fallback: null };
    }

    const sections = record.sections;
    if (Array.isArray(sections)) {
      const sectionMarkdown = sections
        .map((section) => {
          const sectionRecord = toRecord(section);
          if (!sectionRecord) {
            return null;
          }
          const title = firstNonEmptyString(
            typeof sectionRecord.title === "string" ? sectionRecord.title : null,
            typeof sectionRecord.heading === "string" ? sectionRecord.heading : null
          );
          const body = firstNonEmptyString(
            typeof sectionRecord.content === "string" ? sectionRecord.content : null,
            typeof sectionRecord.summary === "string" ? sectionRecord.summary : null,
            typeof sectionRecord.text === "string" ? sectionRecord.text : null
          );
          const bulletSource = Array.isArray(sectionRecord.points)
            ? sectionRecord.points
            : Array.isArray(sectionRecord.items)
              ? sectionRecord.items
              : Array.isArray(sectionRecord.bullets)
                ? sectionRecord.bullets
                : null;
          const bullets = bulletSource
            ? bulletSource
                .map((item) => {
                  if (typeof item === "string") {
                    return item.trim();
                  }
                  const itemRecord = toRecord(item);
                  if (!itemRecord) {
                    return null;
                  }
                  return firstNonEmptyString(
                    typeof itemRecord.text === "string" ? itemRecord.text : null,
                    typeof itemRecord.content === "string" ? itemRecord.content : null
                  );
                })
                .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
            : [];

          const lines: string[] = [];
          if (title) {
            lines.push(`# ${title.trim()}`);
          }
          if (body) {
            lines.push(body.trim());
          }
          if (bullets.length > 0) {
            lines.push(...bullets.map((entry) => `- ${entry.trim()}`));
          }
          if (lines.length === 0) {
            return null;
          }
          return lines.join("\n\n");
        })
        .filter((section): section is string => Boolean(section && section.trim().length > 0));
      if (sectionMarkdown.length > 0) {
        return { markdown: sectionMarkdown.join("\n\n"), fallback: null };
      }
    }

    return { markdown: null, fallback: safeStringify(record) };
  }

  return { markdown: String(value), fallback: null };
}

const THREAD_TITLE_STORAGE_KEY = "deepresearch.thread_titles";

let messageSequence = 0;

function nextMessageId(prefix: string): string {
  messageSequence += 1;
  return `${prefix}-${Date.now()}-${messageSequence}`;
}

function sanitizeTitleRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const entries: Array<[string, string]> = [];
  for (const [key, rawTitle] of Object.entries(value)) {
    if (typeof rawTitle === "string") {
      const trimmed = rawTitle.trim();
      if (trimmed) {
        entries.push([key, trimmed]);
      }
    }
  }
  return Object.fromEntries(entries);
}

function loadThreadTitlesFromStorage(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const stored = window.localStorage.getItem(THREAD_TITLE_STORAGE_KEY);
    if (!stored) {
      return {};
    }
    return sanitizeTitleRecord(JSON.parse(stored));
  } catch (error) {
    console.warn("[ui] Failed to load thread titles", error);
    return {};
  }
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  children?: ReactNode;
};

const markdownComponents: Components = {
  h1(props: ComponentPropsWithoutRef<"h1">) {
    const { children, className, ...rest } = props;
    return (
      <h2
        className={mergeClassNames("mt-6 text-xl font-semibold text-emerald-200", className)}
        {...rest}
      >
        {children}
      </h2>
    );
  },
  h2(props: ComponentPropsWithoutRef<"h2">) {
    const { children, className, ...rest } = props;
    return (
      <h3
        className={mergeClassNames("mt-6 text-lg font-semibold text-emerald-200", className)}
        {...rest}
      >
        {children}
      </h3>
    );
  },
  h3(props: ComponentPropsWithoutRef<"h3">) {
    const { children, className, ...rest } = props;
    return (
      <h4
        className={mergeClassNames("mt-5 text-base font-semibold text-emerald-100", className)}
        {...rest}
      >
        {children}
      </h4>
    );
  },
  h4(props: ComponentPropsWithoutRef<"h4">) {
    const { children, className, ...rest } = props;
    return (
      <h5
        className={mergeClassNames("mt-4 text-sm font-semibold text-emerald-100", className)}
        {...rest}
      >
        {children}
      </h5>
    );
  },
  p(props: ComponentPropsWithoutRef<"p">) {
    const { children, className, ...rest } = props;
    return (
      <p
        className={mergeClassNames("leading-relaxed text-emerald-100", className)}
        {...rest}
      >
        {children}
      </p>
    );
  },
  a(props: ComponentPropsWithoutRef<"a">) {
    const { children, className, ...rest } = props;
    return (
      <a
        className={mergeClassNames(
          "text-emerald-300 underline underline-offset-4 hover:text-emerald-200",
          className
        )}
        target="_blank"
        rel="noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  },
  ul(props: ComponentPropsWithoutRef<"ul">) {
    const { className, ...rest } = props;
    return (
      <ul
        className={mergeClassNames("ml-5 list-disc space-y-2 marker:text-emerald-300", className)}
        {...rest}
      />
    );
  },
  ol(props: ComponentPropsWithoutRef<"ol">) {
    const { className, ...rest } = props;
    return (
      <ol
        className={mergeClassNames("ml-5 list-decimal space-y-2 marker:text-emerald-300", className)}
        {...rest}
      />
    );
  },
  li(props: ComponentPropsWithoutRef<"li">) {
    const { children, className, ...rest } = props;
    return (
      <li className={mergeClassNames("leading-relaxed", className)} {...rest}>
        {children}
      </li>
    );
  },
  blockquote(props: ComponentPropsWithoutRef<"blockquote">) {
    const { children, className, ...rest } = props;
    return (
      <blockquote
        className={mergeClassNames(
          "border-l-2 border-emerald-400/70 pl-4 text-emerald-100/80",
          className
        )}
        {...rest}
      >
        {children}
      </blockquote>
    );
  },
  code({ inline, className, children, ...props }: MarkdownCodeProps) {
    if (inline) {
      return (
        <code className="rounded-md bg-slate-900/80 px-1.5 py-0.5 text-emerald-200" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs text-slate-100">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  table(props: ComponentPropsWithoutRef<"table">) {
    const { children, className, ...rest } = props;
    return (
      <div className="overflow-x-auto">
        <table
          className={mergeClassNames("w-full border-collapse text-sm", className)}
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },
  th(props: ComponentPropsWithoutRef<"th">) {
    const { children, className, ...rest } = props;
    return (
      <th
        className={mergeClassNames(
          "border border-slate-800 bg-slate-900/80 px-3 py-2 text-left font-semibold text-emerald-100",
          className
        )}
        {...rest}
      >
        {children}
      </th>
    );
  },
  td(props: ComponentPropsWithoutRef<"td">) {
    const { children, className, ...rest } = props;
    return (
      <td
        className={mergeClassNames("border border-slate-800 px-3 py-2 text-emerald-50", className)}
        {...rest}
      >
        {children}
      </td>
    );
  },
};

function createEmptySection(): PlanSectionFormState {
  return { title: "", focus: "", keyQuestions: [] };
}

function createEmptyPlanForm(): ResearchPlanFormState {
  return {
    purpose: "",
    sections: [createEmptySection()],
    structure: { introduction: "", conclusion: "" },
    metaAnalysis: "",
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parsePlanValue(value: unknown): ResearchPlanFormState {
  const base = createEmptyPlanForm();
  if (value === null || value === undefined) {
    return base;
  }

  let root: unknown = value;
  if (typeof value === "string") {
    try {
      root = JSON.parse(value) as unknown;
    } catch (error) {
      console.warn("[ui] Failed to parse plan JSON", error);
      return base;
    }
  }

  const rootRecord = toRecord(root);
  if (!rootRecord) {
    return base;
  }

  const planRecord =
    toRecord(rootRecord["research_plan"]) ?? toRecord(rootRecord["plan"]) ?? rootRecord;

  const structureRecord = toRecord(planRecord["structure"]);

  const sectionsValue = planRecord["sections"];
  const sections: PlanSectionFormState[] = Array.isArray(sectionsValue)
    ? sectionsValue
        .map((item) => {
          const sectionRecord = toRecord(item);
          if (!sectionRecord) {
            return createEmptySection();
          }
          const keysValue =
            sectionRecord["key_questions"] ?? sectionRecord["keyQuestions"];
          const questions = Array.isArray(keysValue)
            ? keysValue
                .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
                .filter((entry) => entry !== undefined)
            : [];
          return {
            title:
              typeof sectionRecord["title"] === "string"
                ? (sectionRecord["title"] as string)
                : "",
            focus:
              typeof sectionRecord["focus"] === "string"
                ? (sectionRecord["focus"] as string)
                : "",
            keyQuestions: questions,
          };
        })
        .filter(Boolean)
    : [createEmptySection()];

  const plan: ResearchPlanFormState = {
    purpose:
      typeof planRecord["purpose"] === "string"
        ? (planRecord["purpose"] as string)
        : "",
    sections: sections.length > 0 ? sections : [createEmptySection()],
    structure: {
      introduction:
        typeof structureRecord?.["introduction"] === "string"
          ? (structureRecord["introduction"] as string)
          : "",
      conclusion:
        typeof structureRecord?.["conclusion"] === "string"
          ? (structureRecord["conclusion"] as string)
          : "",
    },
    metaAnalysis:
      typeof rootRecord["meta_analysis"] === "string"
        ? (rootRecord["meta_analysis"] as string)
        : typeof rootRecord["metaAnalysis"] === "string"
          ? (rootRecord["metaAnalysis"] as string)
          : "",
  };

  return plan;
}

function serializePlanForm(plan: ResearchPlanFormState): Record<string, unknown> {
  const sections = plan.sections
    .map((section) => {
      const title = section.title.trim();
      const focus = section.focus.trim();
      const keyQuestions = section.keyQuestions
        .map((question) => question.trim())
        .filter((question) => question.length > 0);
      if (!title && !focus && keyQuestions.length === 0) {
        return null;
      }
      return {
        title,
        focus,
        key_questions: keyQuestions,
      };
    })
    .filter((section): section is { title: string; focus: string; key_questions: string[] } =>
      Boolean(section)
    );

  return {
    research_plan: {
      purpose: plan.purpose.trim(),
      sections,
      structure: {
        introduction: plan.structure.introduction.trim(),
        conclusion: plan.structure.conclusion.trim(),
      },
    },
    meta_analysis: plan.metaAnalysis.trim(),
  };
}

function validatePlanForm(plan: ResearchPlanFormState): string | null {
  if (!plan.purpose.trim()) {
    return "調査目的を入力してください。";
  }

  const sections = plan.sections.filter((section) => {
    const hasTitle = section.title.trim().length > 0;
    const hasFocus = section.focus.trim().length > 0;
    const hasQuestions = section.keyQuestions.some((question) => question.trim().length > 0);
    return hasTitle || hasFocus || hasQuestions;
  });
  if (sections.length === 0) {
    return "少なくとも1つのセクションのタイトルと概要を入力してください。";
  }

  if (!plan.structure.introduction.trim()) {
    return "イントロダクションの概要を入力してください。";
  }

  if (!plan.structure.conclusion.trim()) {
    return "結論の概要を入力してください。";
  }

  return null;
}

function clonePlanForm(plan: ResearchPlanFormState): ResearchPlanFormState {
  return {
    purpose: plan.purpose,
    metaAnalysis: plan.metaAnalysis,
    structure: { ...plan.structure },
    sections: plan.sections.map((section) => ({
      title: section.title,
      focus: section.focus,
      keyQuestions: [...section.keyQuestions],
    })),
  };
}

const INSIGHT_MESSAGE_PREFIX = "insight-log-";
const INTERRUPT_MESSAGE_PREFIX = "interrupt-";

export default function Home() {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingQueryRef = useRef<string>("");
  const activeThreadRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);

  const [conversations, setConversations] = useState<Record<string, ConversationMeta>>({});
  const [messagesByThread, setMessagesByThread] = useState<Record<string, ChatMessage[]>>({});
  const [pendingInterrupts, setPendingInterrupts] = useState<Record<string, InterruptPayload | null>>({});
  const [threadStates, setThreadStates] = useState<Record<string, ThreadStateResponse>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [planForms, setPlanForms] = useState<Record<string, ResearchPlanFormState>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "ok" | "error">(
    "loading"
  );
  const [activeSteps, setActiveSteps] = useState<Record<string, string>>({});
  const [threadTitles, setThreadTitles] = useState<Record<string, string>>(() =>
    loadThreadTitlesFromStorage()
  );
  const threadTitlesRef = useRef<Record<string, string>>(threadTitles);
  const [, setInsights] = useState<Record<string, ResearchInsightState>>({});

  const threadList = useMemo(
    () =>
      Object.values(conversations).sort(
        (a, b) => b.lastUpdated - a.lastUpdated
      ),
    [conversations]
  );
  const effectiveThreadId =
    activeThreadId ?? (threadList.length > 0 ? threadList[0].id : null);

  const selectedConversation = effectiveThreadId
    ? conversations[effectiveThreadId]
    : undefined;
  const selectedMessages = effectiveThreadId
    ? messagesByThread[effectiveThreadId] ?? []
    : [];
  const selectedStatusLabel = selectedConversation
    ? statusLabel(selectedConversation.status)
    : null;
  const currentState = effectiveThreadId
    ? threadStates[effectiveThreadId]
    : undefined;
  const currentInterrupt = effectiveThreadId
    ? pendingInterrupts[effectiveThreadId] ?? null
    : null;
  const activePlanForm = effectiveThreadId
    ? planForms[effectiveThreadId] ?? null
    : null;
  const editablePlan = activePlanForm ?? createEmptyPlanForm();
  useEffect(() => {
    threadTitlesRef.current = threadTitles;
  }, [threadTitles]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        THREAD_TITLE_STORAGE_KEY,
        JSON.stringify(threadTitles)
      );
    } catch (error) {
      console.warn("[ui] Failed to persist thread titles", error);
    }
  }, [threadTitles]);

  const rememberTitle = useCallback((threadId: string, rawTitle: string) => {
    const trimmed = rawTitle.trim();
    if (!trimmed) {
      return;
    }
    setThreadTitles((prev) => {
      if (prev[threadId] === trimmed) {
        return prev;
      }
      return { ...prev, [threadId]: trimmed };
    });
  }, []);

  const resolveConversationTitle = useCallback((threadId: string, rawTitle?: string) => {
    const candidate = rawTitle?.trim() || threadTitlesRef.current[threadId] || "";
    if (candidate) {
      return makeThreadTitle(candidate, threadId);
    }
    return makeThreadTitle(undefined, threadId);
  }, []);

  const refreshThreadState = useCallback(async (threadId: string) => {
    try {
      const state = await apiClient.getThreadState(threadId);
      setThreadStates((prev) => ({ ...prev, [threadId]: state }));
      return state;
    } catch (error) {
      console.error("[ui] Failed to fetch thread state", error);
      return undefined;
    }
  }, []);

  const applyInsightMessage = useCallback(
    (threadId: string, insight: ResearchInsightState | null) => {
      const messageId = `${INSIGHT_MESSAGE_PREFIX}${threadId}`;
      const timestamp = insight?.lastUpdated ?? Date.now();

      setMessagesByThread((prev) => {
        const currentMessages = prev[threadId] ?? [];
        const insightIndex = currentMessages.findIndex((message) => message.id === messageId);

        if (!insight || (!insight.currentPage && !insight.reasoning)) {
          if (insightIndex === -1) {
            return prev;
          }
          const nextMessages = [...currentMessages];
          nextMessages.splice(insightIndex, 1);
          return { ...prev, [threadId]: nextMessages };
        }

        const nextMessage: ChatMessage = {
          id: messageId,
          role: "assistant",
          title: "リサーチ進行状況",
          content: buildInsightContent(insight),
          createdAt: timestamp,
        };

        const nextMessages =
          insightIndex === -1
            ? [...currentMessages, nextMessage]
            : currentMessages.map((message, index) =>
                index === insightIndex ? nextMessage : message
              );

        return { ...prev, [threadId]: nextMessages };
      });

      if (insight && (insight.currentPage || insight.reasoning)) {
        setConversations((prev) => {
          const existing = prev[threadId];
          if (!existing || existing.lastUpdated >= timestamp) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: { ...existing, lastUpdated: timestamp },
          };
        });
      }
    },
    []
  );

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    setMessagesByThread((prev) => {
      const nextMessages = prev[threadId] ? [...prev[threadId], message] : [message];
      return { ...prev, [threadId]: nextMessages };
    });
    setConversations((prev) => {
      const existing = prev[threadId];
      if (!existing) {
        return prev;
      }
      return {
        ...prev,
        [threadId]: { ...existing, lastUpdated: message.createdAt },
      };
    });
  }, []);

  const ensureConversation = useCallback(
    (threadId: string, rawTitle: string | undefined, status: ConversationStatus) => {
      const now = Date.now();
      if (rawTitle) {
        rememberTitle(threadId, rawTitle);
      }
      const displayTitle = resolveConversationTitle(threadId, rawTitle);
      setConversations((prev) => {
        const existing = prev[threadId];
        const conversation: ConversationMeta = existing
          ? {
            ...existing,
            title: displayTitle,
            status:
              existing.status === "completed" && status !== "completed"
                ? existing.status
                : status,
            lastUpdated: now,
          }
          : {
            id: threadId,
            title: displayTitle,
            status,
            startedAt: now,
            lastUpdated: now,
          };
        return { ...prev, [threadId]: conversation };
      });
    },
    [rememberTitle, resolveConversationTitle]
  );

  useEffect(() => {
    let cancelled = false;
    apiClient
      .health()
      .then(() => {
        if (!cancelled) {
          setHealthStatus("ok");
        }
      })
      .catch((error) => {
        console.error("[ui] health check failed", error);
        if (!cancelled) {
          setHealthStatus("error");
          setErrorMessage((prev) => prev ?? "APIへの接続に失敗しました。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncThreads = async () => {
      try {
        const listing = await apiClient.listThreads();
        if (cancelled) {
          return;
        }
        setErrorMessage((prev) => (prev === "APIへの接続に失敗しました。" ? null : prev));

        setConversations((prev) => {
          const now = Date.now();
          const next: Record<string, ConversationMeta> = { ...prev };

          const updateStatus = (id: string, status: ConversationStatus) => {
            const existing = next[id];
            const title = resolveConversationTitle(id);
            if (existing) {
              const keepStatus =
                existing.status === "completed" && status !== "completed"
                  ? existing.status
                  : status;
              next[id] = {
                ...existing,
                title,
                status: keepStatus,
                lastUpdated: now,
              };
              return;
            }
            next[id] = {
              id,
              title,
              status,
              startedAt: now,
              lastUpdated: now,
            };
          };

          listing.active_thread_ids.forEach((id) => updateStatus(id, "running"));
          listing.pending_interrupt_ids.forEach((id) =>
            updateStatus(id, "pending_human")
          );
          return next;
        });

        listing.pending_interrupt_ids.forEach((id) => {
          if (!cancelled) {
            refreshThreadState(id);
          }
        });
      } catch (error) {
        console.error("[ui] failed to fetch threads", error);
        if (!cancelled) {
          setErrorMessage((prev) => prev ?? "APIへの接続に失敗しました。");
        }
      }
    };

    syncThreads();
    const timer = window.setInterval(syncThreads, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshThreadState, resolveConversationTitle]);

  useEffect(() => () => {
    socketRef.current?.close();
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isConnecting) {
        return;
      }
      const query = inputValue.trim();
      if (!query) {
        return;
      }

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const previousThreadId = activeThreadRef.current;
        if (previousThreadId) {
          setActiveSteps((prev) => {
            const next = { ...prev };
            delete next[previousThreadId];
            return next;
          });
        }
        socketRef.current.close(1000, "new-session");
      }

      pendingQueryRef.current = query;
      setInputValue("");
      setErrorMessage(null);
      setIsConnecting(true);

      const socket = createResearchSocket({
        onOpen: () => {
          try {
            sendStartCommand(socket, { query });
          } catch (error) {
            console.error("[ui] failed to send start command", error);
            setErrorMessage("リサーチの開始に失敗しました。");
            setIsConnecting(false);
          }
        },
        onMessage: async (message: WebSocketMessage) => {
          if (message.type === "thread_started") {
            const now = Date.now();
            const queryText = pendingQueryRef.current;
            ensureConversation(message.thread_id, queryText, "running");
            appendMessage(message.thread_id, {
              id: nextMessageId("user"),
              role: "user",
              content: queryText,
              createdAt: now,
            });
            appendMessage(message.thread_id, {
              id: nextMessageId("system"),
              role: "system",
              content: "リサーチを開始しました。",
              createdAt: now + 1,
            });
            pendingQueryRef.current = "";
            setActiveThreadId(message.thread_id);
            activeThreadRef.current = message.thread_id;
            setIsConnecting(false);
            setActiveSteps((prev) => ({
              ...prev,
              [message.thread_id]: "リサーチを準備中です...",
            }));
            setInsights((prev) => {
              if (!prev[message.thread_id]) {
                return prev;
              }
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            applyInsightMessage(message.thread_id, null);
            return;
          }

          if (!message.thread_id) {
            return;
          }

          if (message.type === "event") {
            const threadId = message.thread_id;
            const statusUpdate = describeEventStatus(message.payload);
            if (statusUpdate) {
              setActiveSteps((prev) => {
                const next = { ...prev };
                if (statusUpdate.clear) {
                  delete next[threadId];
                } else if (statusUpdate.message) {
                  next[threadId] = statusUpdate.message;
                }
                return next;
              });
            }

            const insightDelta = extractResearchInsight(message.payload);
            if (insightDelta) {
              let updatedInsight: ResearchInsightState | null | undefined;
              setInsights((prev) => {
                const current = prev[threadId];
                const now = Date.now();

                const nextInsight: ResearchInsightState = {
                  currentPage:
                    insightDelta.currentPage !== undefined
                      ? insightDelta.currentPage
                      : current?.currentPage,
                  reasoning:
                    insightDelta.reasoning !== undefined
                      ? insightDelta.reasoning
                      : current?.reasoning,
                  lastUpdated: now,
                };

                const shouldRemove = !nextInsight.currentPage && !nextInsight.reasoning;
                if (shouldRemove) {
                  if (!current) {
                    updatedInsight = undefined;
                    return prev;
                  }
                  const next = { ...prev };
                  delete next[threadId];
                  updatedInsight = null;
                  return next;
                }

                if (
                  current &&
                  current.currentPage === nextInsight.currentPage &&
                  current.reasoning === nextInsight.reasoning
                ) {
                  updatedInsight = undefined;
                  return prev;
                }

                updatedInsight = nextInsight;
                return { ...prev, [threadId]: nextInsight };
              });
              if (updatedInsight !== undefined) {
                applyInsightMessage(threadId, updatedInsight ?? null);
              }
            }

            const details = extractEventDetails(message.payload);
            if (details) {
              const createdAt = Date.now();
              appendMessage(threadId, {
                id: nextMessageId("event"),
                role: "assistant",
                title: details.title,
                content: details.content,
                createdAt,
              });
            }
            return;
          }

          if (message.type === "interrupt") {
            const interrupt = message.interrupt;
            const createdAt = Date.now();
            ensureConversation(message.thread_id, undefined, "pending_human");
            appendMessage(message.thread_id, {
              id: nextMessageId("interrupt"),
              role: "system",
              content: formatInterruptContent(interrupt.value),
              createdAt,
            });
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            setPendingInterrupts((prev) => ({
              ...prev,
              [message.thread_id]: interrupt,
            }));
            const snapshot = await refreshThreadState(message.thread_id);
            const planSource =
              getRecordValue<unknown>(snapshot?.state, "research_plan") ??
              interrupt.value;
            setPlanForms((prev) => ({
              ...prev,
              [message.thread_id]: parsePlanValue(planSource),
            }));
            setEditingThreadId(null);
            setPlanError(null);
            return;
          }

          if (message.type === "complete") {
            ensureConversation(message.thread_id, undefined, "completed");
            const createdAt = Date.now();
            appendMessage(message.thread_id, {
              id: nextMessageId("complete"),
              role: "assistant",
              content: "リサーチが完了しました。",
              createdAt,
            });
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[message.thread_id];
              return next;
            });
            setPendingInterrupts((prev) => ({
              ...prev,
              [message.thread_id]: null,
            }));
            const state: ThreadStateResponse = {
              thread_id: message.thread_id,
              status: "completed",
              state: message.state,
              pending_interrupt: null,
            };
            setThreadStates((prev) => ({
              ...prev,
              [message.thread_id]: state,
            }));
            setEditingThreadId(null);
            setPlanError(null);
            return;
          }

          if (message.type === "error") {
            const targetId = message.thread_id ?? activeThreadRef.current;
            if (targetId) {
              ensureConversation(targetId, undefined, "error");
              const createdAt = Date.now();
              appendMessage(targetId, {
                id: nextMessageId("error"),
                role: "system",
                content: message.message,
                createdAt,
              });
              setActiveSteps((prev) => {
                const next = { ...prev };
                delete next[targetId];
                return next;
              });
            }
            setErrorMessage(message.message);
          }
        },
        onError: (event: Event) => {
          console.error("[ui] websocket error", event);
          setErrorMessage("WebSocket接続でエラーが発生しました。");
        },
        onClose: () => {
          const threadId = activeThreadRef.current;
          if (threadId) {
            setActiveSteps((prev) => {
              const next = { ...prev };
              delete next[threadId];
              return next;
            });
          }
          socketRef.current = null;
          activeThreadRef.current = null;
          setIsConnecting(false);
        },
      });

      socketRef.current = socket;
    },
    [
      appendMessage,
      applyInsightMessage,
      ensureConversation,
      inputValue,
      isConnecting,
      refreshThreadState,
    ]
  );

  const handleSelectThread = useCallback(
    (threadId: string) => {
      setActiveThreadId(threadId);
      setEditingThreadId(null);
      setPlanError(null);
      refreshThreadState(threadId);
    },
    [refreshThreadState]
  );

  const updatePlanFormState = useCallback(
    (threadId: string, updater: (draft: ResearchPlanFormState) => void) => {
      setPlanForms((prev) => {
        const current = prev[threadId] ?? createEmptyPlanForm();
        const draft = clonePlanForm(current);
        updater(draft);
        return { ...prev, [threadId]: draft };
      });
    },
    []
  );

  const handlePlanDecision = useCallback(
    (decision: "y" | "n") => {
      const threadId = effectiveThreadId;
      if (!threadId) {
        return;
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setErrorMessage("WebSocketが接続されていません。");
        return;
      }
      if (activeThreadRef.current !== threadId) {
        setErrorMessage("このスレッドは現在のセッションで操作できません。");
        return;
      }

      if (decision === "n") {
        sendResumeCommand(socket, { decision: "n" });
        const createdAt = Date.now();
        appendMessage(threadId, {
          id: nextMessageId("decision"),
          role: "user",
          content: "この計画で進行します。",
          createdAt,
        });
        setEditingThreadId(null);
        setPlanError(null);
        setPendingInterrupts((prev) => ({
          ...prev,
          [threadId]: null,
        }));
        setActiveSteps((prev) => ({
          ...prev,
          [threadId]: "リサーチを再開しています...",
        }));
        return;
      }

      const planForm = planForms[threadId];
      if (!planForm) {
        setPlanError("調査計画を編集してから送信してください。");
        return;
      }
      const validationError = validatePlanForm(planForm);
      if (validationError) {
        setPlanError(validationError);
        return;
      }

      const payload = serializePlanForm(planForm);
      sendResumeCommand(socket, { decision: "y", plan: payload });
      const createdAt = Date.now();
      appendMessage(threadId, {
        id: nextMessageId("decision"),
        role: "user",
        content: "計画を更新しました。",
        createdAt,
      });
      setPlanError(null);
      setEditingThreadId(null);
      setPendingInterrupts((prev) => ({
        ...prev,
        [threadId]: null,
      }));
      setActiveSteps((prev) => ({
        ...prev,
        [threadId]: "リサーチを再開しています...",
      }));
    },
    [appendMessage, effectiveThreadId, planForms]
  );

  const researchPlanValue = getRecordValue<unknown>(currentState?.state, "research_plan");
  const researchReportValue = getRecordValue<unknown>(currentState?.state, "research_report");
  const activeStepMessage = effectiveThreadId ? activeSteps[effectiveThreadId] : undefined;

  const displayPlan = useMemo(() => {
    if (researchPlanValue === undefined || researchPlanValue === null) {
      return null;
    }
    return parsePlanValue(researchPlanValue);
  }, [researchPlanValue]);

  const reportContent = useMemo(
    () => normalizeReportContent(researchReportValue),
    [researchReportValue]
  );

  const showExecutionIndicator = selectedConversation?.status === "running" && !currentInterrupt;
  const executionMessage = showExecutionIndicator
    ? activeStepMessage ?? "リサーチを実行中です..."
    : null;

  const interruptMessageIndex = useMemo(() => {
    if (!currentInterrupt) {
      return -1;
    }
    for (let index = selectedMessages.length - 1; index >= 0; index -= 1) {
      if (selectedMessages[index]?.id?.startsWith(INTERRUPT_MESSAGE_PREFIX)) {
        return index;
      }
    }
    return -1;
  }, [currentInterrupt, selectedMessages]);

  const messagesBeforeInterrupt = useMemo(() => {
    if (interruptMessageIndex === -1) {
      return selectedMessages;
    }
    return selectedMessages.slice(0, interruptMessageIndex + 1);
  }, [interruptMessageIndex, selectedMessages]);

  const messagesAfterInterrupt = useMemo(() => {
    if (interruptMessageIndex === -1) {
      return [] as ChatMessage[];
    }
    return selectedMessages.slice(interruptMessageIndex + 1);
  }, [interruptMessageIndex, selectedMessages]);

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
    ? selectedStatusLabel
      ? `ステータス: ${selectedStatusLabel}`
      : null
    : "左の一覧からスレッドを選択するか、新しいリサーチを開始してください。";
  const headerBadgeClass = selectedConversation && selectedStatusLabel
    ? statusClassName(selectedConversation.status, false)
    : null;
  const shouldShowReport = researchReportValue !== undefined && researchReportValue !== null;
  const isEditingPlan = editingThreadId === effectiveThreadId;

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
          statusBadgeLabel={selectedConversation && selectedStatusLabel ? selectedStatusLabel : null}
          statusBadgeClassName={headerBadgeClass}
          errorMessage={errorMessage}
        />
        <section ref={chatScrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col gap-4">
            {currentInterrupt ? (
              <>
                <ChatTranscript messages={messagesBeforeInterrupt} />
                <PlanInterruptPanel
                  interrupt={currentInterrupt}
                  activeThreadId={effectiveThreadId}
                  editablePlan={editablePlan}
                  planError={planError}
                  isEditing={isEditingPlan}
                  onApprovePlan={() => handlePlanDecision("n")}
                  onSubmitPlan={() => handlePlanDecision("y")}
                  onStartEditing={() => {
                    if (!effectiveThreadId) {
                      return;
                    }
                    const source = researchPlanValue ?? currentInterrupt?.value;
                    setPlanForms((prev) => ({
                      ...prev,
                      [effectiveThreadId]: parsePlanValue(source),
                    }));
                    setEditingThreadId(effectiveThreadId);
                    setPlanError(null);
                  }}
                  onCancelEditing={() => {
                    setEditingThreadId(null);
                    setPlanError(null);
                  }}
                  onPlanChange={(updater) => {
                    if (!effectiveThreadId) {
                      return;
                    }
                    updatePlanFormState(effectiveThreadId, updater);
                  }}
                  onPlanErrorReset={() => setPlanError(null)}
                  onAddSection={() => {
                    if (!effectiveThreadId) {
                      return;
                    }
                    updatePlanFormState(effectiveThreadId, (draft) => {
                      draft.sections.push(createEmptySection());
                    });
                    setPlanError(null);
                  }}
                  onRemoveSection={(index) => {
                    if (!effectiveThreadId) {
                      return;
                    }
                    updatePlanFormState(effectiveThreadId, (draft) => {
                      draft.sections.splice(index, 1);
                      if (draft.sections.length === 0) {
                        draft.sections.push(createEmptySection());
                      }
                    });
                    setPlanError(null);
                  }}
                  formatInterruptContent={formatInterruptContent}
                />
                <ChatTranscript messages={messagesAfterInterrupt} hideEmptyState />
              </>
            ) : (
              <ChatTranscript messages={selectedMessages} />
            )}
            {executionMessage ? <ExecutionIndicator message={executionMessage} /> : null}
            <ResearchPlanViewer plan={displayPlan} />
            {shouldShowReport ? (
              <ResearchReportViewer
                markdownComponents={markdownComponents}
                markdown={reportContent.markdown}
                fallback={reportContent.fallback}
              />
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
