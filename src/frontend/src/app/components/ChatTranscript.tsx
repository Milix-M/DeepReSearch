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
  hideEmptyState: _hideEmptyState = false,
  markdownComponents,
}: ChatTranscriptProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <>
      {messages.map((message) => (
        <div
          key={message.id}
          className={`max-w-3xl rounded-2xl border px-5 py-4 ${
            message.role === "user"
              ? "ml-auto border-emerald-500/30 bg-emerald-500/10"
              : message.role === "assistant"
                ? "mr-auto border-slate-800 bg-slate-900/70"
                : "mr-auto border-amber-500/40 bg-amber-500/10"
          }`}
        >
          {message.title ? (
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {message.title}
            </p>
          ) : null}
          <div className="mt-1 text-left text-sm leading-relaxed">
            <ReactMarkdown components={markdownComponents}>{message.content}</ReactMarkdown>
          </div>
          <p className="mt-3 text-right text-[11px] uppercase tracking-wide text-slate-500">
            {formatTimestamp(message.createdAt)}
          </p>
        </div>
      ))}
    </>
  );
}
