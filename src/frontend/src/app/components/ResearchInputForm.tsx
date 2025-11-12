"use client";

import { useRef } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";

interface ResearchInputFormProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  isConnecting: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ResearchInputForm({
  inputRef,
  value,
  isConnecting,
  onChange,
  onSubmit,
}: ResearchInputFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (isConnecting || value.trim().length === 0) {
      return;
    }
    formRef.current?.requestSubmit();
  };

  return (
    <footer className="glass-panel shrink-0 border-t border-slate-900/40 px-8 py-6">
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="調べたい内容を入力"
          className="w-full resize-none rounded-2xl border border-slate-700/60 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 shadow-inner transition-all duration-300 focus:border-emerald-400 focus:outline-none focus:shadow-[0_18px_40px_-32px_rgba(16,185,129,0.65)]"
          disabled={isConnecting}
        />
        <div className="flex items-center justify-between">
          <p className="hidden text-xs text-slate-500 md:block">
            Enter ⏎ で送信 / Shift + Enter で改行
          </p>
          <button
            type="submit"
            disabled={isConnecting || value.trim().length === 0}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-400/70 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 px-5 py-2 text-sm font-semibold text-slate-950 shadow-[0_22px_45px_-25px_rgba(16,185,129,0.75)] transition-all hover:from-emerald-300 hover:via-emerald-400 hover:to-teal-400 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            {isConnecting ? "接続中..." : "リサーチ開始"}
          </button>
        </div>
      </form>
    </footer>
  );
}
