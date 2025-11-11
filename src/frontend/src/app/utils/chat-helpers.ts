import type { ResearchInsightState } from "../types";

export interface EventStatusUpdate {
  message?: string;
  clear?: boolean;
  log?: boolean;
}

const TOOL_STATUS_MESSAGES: Record<string, string> = {
  web_research: "ウェブ検索を実行しています...",
  reflect_on_results: "検索結果を分析しています...",
  get_current_date: "最新の日付情報を取得しています...",
};

export function truncateInsight(value: string, limit = 320): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
}

export function firstNonEmptyString(...values: unknown[]): string | null {
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

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function mergeClassNames(
  ...values: Array<string | undefined | null | false>
): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export function humanizeIdentifier(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  const normalized = raw.toLowerCase();
  if (normalized.includes("runnablesequence")) {
    return "研究ステップ";
  }
  if (normalized.includes("plan")) {
    return "調査計画";
  }
  if (normalized.includes("analyze")) {
    return "クエリ分析";
  }
  if (normalized.includes("search")) {
    return "調査検索";
  }
  if (normalized.includes("reflect")) {
    return "結果の振り返り";
  }
  if (normalized.includes("report")) {
    return "レポート生成";
  }
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function describeEventStatus(payload: Record<string, unknown>): EventStatusUpdate | null {
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (!eventType) {
    return null;
  }

  const rawName = typeof payload.name === "string" ? payload.name : "";
  const displayName = humanizeIdentifier(rawName);

  const createMessage = (text: string, options?: { log?: boolean }) => ({
    message: text,
    log: options?.log ?? true,
  });

  switch (eventType) {
    case "on_chain_start":
      return createMessage(
        displayName ? `${displayName}を進めています...` : "調査ワークフローを開始しています...",
        { log: false }
      );
    case "on_chain_resume":
      return createMessage("調査を再開しています...", { log: false });
    case "on_chain_end":
      return { clear: true };
    case "on_tool_start":
      if (rawName) {
        const toolMessage = TOOL_STATUS_MESSAGES[rawName.toLowerCase()];
        if (toolMessage) {
          return createMessage(toolMessage);
        }
      }
      return createMessage(
        displayName ? `${displayName}ツールを使っています...` : "ツールを使っています...",
        { log: false }
      );
    case "on_tool_end":
      return { clear: true };
    case "on_llm_start":
      return createMessage("AIに確認しています...", { log: false });
    case "on_llm_end":
      return { clear: true };
    case "on_retriever_start":
      return createMessage("参考情報を検索しています...", { log: false });
    case "on_retriever_end":
      return { clear: true };
    default: {
      const data = payload.data as Record<string, unknown> | undefined;
      const phase = firstNonEmptyString(
        typeof data?.phase === "string" ? data.phase : null,
        typeof data?.status === "string" ? data.status : null
      );
      if (phase) {
        const friendly = humanizeIdentifier(phase);
        return createMessage(
          friendly ? `${friendly}を進めています...` : "処理を進めています..."
        );
      }
      return null;
    }
  }
}

export function extractEventDetails(
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

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
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

export function extractResearchInsight(
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

export function buildInsightContent(insight: ResearchInsightState): {
  content: string;
  reasoning?: string;
} {
  const sections: string[] = [];
  const currentPage = insight.currentPage?.trim();
  const reasoning = insight.reasoning?.trim();

  if (currentPage) {
    sections.push(`調査中のページ\n${currentPage}`);
  }

  const content = sections.length > 0
    ? sections.join("\n\n")
    : reasoning
      ? "LLMの思考を更新しました。"
      : "リサーチの進捗を記録しています。";

  return reasoning
    ? { content, reasoning }
    : { content };
}

export function getRecordValue<T>(
  record: Record<string, unknown> | undefined,
  key: string
): T | undefined {
  const value = record?.[key];
  return value as T | undefined;
}

export function makeThreadTitle(query: string | undefined, id: string): string {
  if (query) {
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 30 ? `${trimmed.slice(0, 30)}...` : trimmed;
    }
  }
  return `Thread ${id.slice(0, 8)}`;
}

export function formatInterruptContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return safeStringify(value);
}

export function normalizeReportContent(value: unknown): { markdown: string | null; fallback: string | null } {
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
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));

    if (parts.length > 0) {
      return { markdown: parts.join("\n\n"), fallback: null };
    }
  }

  return { markdown: null, fallback: safeStringify(value) };
}
