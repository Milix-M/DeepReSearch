import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { ChatMessage } from "../types";
import { formatTimestamp } from "../utils/conversation";

interface ChatTranscriptProps {
  messages: ChatMessage[];
  hideEmptyState?: boolean;
  markdownComponents: Components;
}

export function ChatTranscript({
  messages,
  hideEmptyState = false,
  markdownComponents,
}: ChatTranscriptProps) {
  if (messages.length === 0) {
    if (hideEmptyState) {
      return null;
    }
    return (
      <p className="glass-panel rounded-2xl border border-dashed border-slate-700/60 px-6 py-8 text-center text-sm text-slate-400">
        メッセージはまだありません。
      </p>
    );
  }

  return (
    <>
      {messages.map((message, index) => {
        const animationDelay = `${Math.min(index, 8) * 60}ms`;
        const baseClasses =
          message.role === "user"
            ? "ml-auto border-emerald-400/50 bg-gradient-to-br from-emerald-500/20 via-emerald-400/10 to-transparent shadow-[0_24px_45px_-28px_rgba(16,185,129,0.7)]"
            : message.role === "assistant"
              ? "mr-auto border-slate-700/60 bg-slate-900/70"
              : "mr-auto border-amber-500/50 bg-amber-500/10";

        return (
          <div
            key={message.id}
            className={`message-card max-w-3xl rounded-2xl border px-5 py-4 transition-all duration-300 ${baseClasses}`}
            style={{ animationDelay }}
          >
            {message.title ? (
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {message.title}
              </p>
            ) : null}
            <div className="mt-1 text-left text-sm leading-relaxed text-slate-100">
              <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
            </div>
            {message.reasoning ? (
              <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-950/70 px-3 py-2 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  LLMの思考
                </p>
                <div className="mt-1 text-xs leading-relaxed text-slate-200">
                  <ReactMarkdown components={markdownComponents}>{message.reasoning}</ReactMarkdown>
                </div>
              </div>
            ) : null}
            <p className="mt-4 text-right text-[11px] uppercase tracking-wide text-slate-500">
              {formatTimestamp(message.createdAt)}
            </p>
          </div>
        );
      })}
    </>
  );
}
